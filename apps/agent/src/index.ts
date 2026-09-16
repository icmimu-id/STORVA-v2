// Must be set before any fs async work happens (libuv reads it lazily on first
// threadpool use, but we still want this as early as possible). Default is 4,
// which is easily starved when statfs/chokidar/sharp/uploads all share it —
// a single slow/disconnected volume can then make the whole agent look
// "offline" even though the process is alive. Overridable via env.
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16'

import 'dotenv/config'
import express from 'express'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import multer from 'multer'
import sharp from 'sharp'
import { resolveSafePath } from '@storva/validation'
import { uploadSessions, syncQueue, storageVolumes, MAX_VOLUMES, type StorageVolume } from './db'
import { authenticateToken } from './middleware/auth'
import { AGENT_CHANNEL, AGENT_VERSION, getAgentVersionInfo } from './version'

const app = express()
app.use(express.json())

const PORT = process.env.STORVA_AGENT_PORT || 5125

// ── Windows system folders — always EPERM even as Administrator ───────────────
const WINDOWS_SYSTEM_DIRS = new Set([
  'System Volume Information', '$Recycle.Bin', '$RECYCLE.BIN',
  'Recovery', '$WinREAgent', 'Config.Msi', 'MSOCache', 'PerfLogs',
])

// ── Parse STORVA_STORAGE_PATHS (comma-separated, max 8) ──────────────────────
// Falls back to legacy STORVA_STORAGE_PATH for backward compat.
function parseStoragePaths(): string[] {
  const multi = process.env.STORVA_STORAGE_PATHS
  if (multi) {
    return multi.split(',').map((p) => p.trim()).filter(Boolean).slice(0, MAX_VOLUMES)
  }
  const single = process.env.STORVA_STORAGE_PATH
  if (single?.trim()) return [single.trim()]
  return [path.join(process.cwd(), 'storage')]
}

// ── MIME helpers ──────────────────────────────────────────────────────────────
const MIME_MAP: Record<string, string> = {
  '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.zip': 'application/zip', '.rar': 'application/x-rar-compressed',
  '.7z': 'application/x-7z-compressed', '.tar': 'application/x-tar', '.gz': 'application/gzip',
}
function getMimeType(filename: string): string {
  return MIME_MAP[path.extname(filename).toLowerCase()] || 'application/octet-stream'
}
// A statfs() (or any fs call) on a disconnected/sleeping/network volume can
// hang indefinitely — there's no OS-level timeout. Race it against a timer so
// one bad volume can't stall /health (and starve the threadpool for everyone
// else, including the reconciler and other volumes' health checks).
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

function getCategory(mime: string): string {
  if (mime.startsWith('image/')) return 'images'
  if (mime.startsWith('video/')) return 'videos'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('7z') || mime.includes('tar') || mime.includes('gzip')) return 'archives'
  if (mime.startsWith('text/') || mime.includes('pdf') || mime.includes('document') || mime.includes('sheet') || mime.includes('presentation') || mime.includes('msword')) return 'documents'
  return 'others'
}

// ── Volume accessibility map ──────────────────────────────────────────────────
const volumeErrors = new Map<number, string | null>()

async function ensureVolumeDir(vol: StorageVolume): Promise<string | null> {
  try {
    // Drive roots (e.g. D:\) already exist — skip mkdir, just check access
    const rootExists = await fsp.stat(vol.storage_path).then(() => true).catch(() => false)
    if (!rootExists) await fsp.mkdir(vol.storage_path, { recursive: true })
    await fsp.access(vol.storage_path, fs.constants.R_OK | fs.constants.W_OK)
    // Always create .trash as a real subdirectory
    await fsp.mkdir(path.join(vol.storage_path, '.trash'), { recursive: true })
    return null
  } catch (err: any) {
    return err?.message || String(err)
  }
}

async function initVolumes() {
  storageVolumes.seed(parseStoragePaths())
  for (const vol of storageVolumes.list()) {
    if (!vol.enabled || !vol.storage_path) { volumeErrors.set(vol.id, null); continue }
    const err = await ensureVolumeDir(vol)
    volumeErrors.set(vol.id, err)
    if (err) console.error(`[Storva Agent] Volume #${vol.id} "${vol.label}" (${vol.storage_path}): ${err}`)
    else console.log(`[Storva Agent] Volume #${vol.id} "${vol.label}" → ${vol.storage_path} ✓`)
  }
}

// ── Volume resolver ───────────────────────────────────────────────────────────
function resolveVolume(volParam?: string): { vol: StorageVolume; error: string | null } | { vol: null; error: string } {
  const active = storageVolumes.listActive()
  if (active.length === 0) return { vol: null, error: 'No active storage volumes configured' }
  if (volParam !== undefined) {
    const id = parseInt(volParam, 10)
    const found = storageVolumes.getById(id)
    if (!found) return { vol: null, error: `Volume id=${id} not found` }
    if (!found.enabled) return { vol: null, error: `Volume "${found.label}" is disabled` }
    return { vol: found, error: volumeErrors.get(found.id) ?? null }
  }
  const first = active[0]
  return { vol: first, error: volumeErrors.get(first.id) ?? null }
}

// ── Multer (vol-aware) ────────────────────────────────────────────────────────
const diskStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    try {
      const { vol, error } = resolveVolume(req.query.vol as string | undefined)
      if (!vol) return cb(new Error(error as string), '')
      cb(null, resolveSafePath(vol.storage_path, (req.query.path as string) || ''))
    } catch (err: any) { cb(err, '') }
  },
  filename: (_req, file, cb) => cb(null, file.originalname),
})
const upload = multer({ storage: diskStorage })

// ═════════════════════════════════════════════════════════════════════════════
// ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════════

// 1. Health — no auth, public, always fast (statfs only)
app.get('/health', async (_req, res) => {
  const allVols = storageVolumes.list()
  const volumes = await Promise.all(allVols.map(async (vol) => {
    const storedError = volumeErrors.get(vol.id)
    let disk: object | null = null
    if (vol.enabled && storedError === null) {
      disk = await withTimeout(fsp.statfs(vol.storage_path), 2000).then((s) => ({
        totalBytes: s.bsize * s.blocks,
        freeBytes: s.bsize * s.bavail,
        usedBytes: s.bsize * (s.blocks - s.bavail),
      })).catch(() => null)
      // Note: on timeout the underlying statfs syscall may still be in flight
      // on the libuv threadpool — we just stop waiting on it here so /health
      // stays responsive. That's fine for a status check.
    }
    return {
      id: vol.id, label: vol.label, storagePath: vol.storage_path,
      enabled: vol.enabled === 1,
      accessible: vol.enabled === 1 && storedError === null,
      error: storedError || null, disk,
    }
  }))
  const primary = volumes.find((v) => v.accessible) ?? volumes[0] ?? null
  res.json({
    status: primary?.accessible ? 'online' : 'degraded',
    storageRoot: primary?.storagePath ?? null,
    storageAccessible: primary?.accessible ?? false,
    storageError: primary?.error ?? null,
    timestamp: Date.now(), version: AGENT_VERSION,
    disk: primary?.disk ?? null,
    volumes,
    // Reconciler runs in a separate child process now (see reconciler-process.ts)
    // so a heavy initial scan can never delay this response. This just reports
    // whether that process is currently up and which paths it's watching —
    // it's informational only and never affects `status` above.
    reconciler: {
      running: reconcilerReady,
      pid: reconcilerProc?.pid ?? null,
      watchedPaths: reconcilerWatchedPaths,
    },
  })
})

// 1b. Version
app.get('/version', (_req, res) => res.json(getAgentVersionInfo()))

// 2. Storage stats — recursive walk for category aggregation
app.get('/storage/stats', async (req, res) => {
  const { vol, error } = resolveVolume(req.query.vol as string | undefined)
  if (!vol) return res.status(400).json({ error })
  try {
    const fsStats = await withTimeout(fsp.statfs(vol.storage_path), 2000).catch(() => null)
    const totalBytes = fsStats ? fsStats.bsize * fsStats.blocks : 0
    const freeBytes = fsStats ? fsStats.bsize * fsStats.bavail : 0
    const usedBytes = fsStats ? fsStats.bsize * (fsStats.blocks - fsStats.bavail) : 0
    const percentUsed = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 10000) / 100 : 0

    const byCategory: Record<string, number> = {
      images: 0, videos: 0, audio: 0, archives: 0, documents: 0, others: 0
    }

    const walk = async (dir: string) => {
      const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const e of entries) {
        if (e.name === '.trash' || e.name === '.staging' || e.name === '.DS_Store' || WINDOWS_SYSTEM_DIRS.has(e.name)) continue
        const full = path.join(dir, e.name)
        if (e.isDirectory()) {
          await walk(full)
        } else {
          const st = await fsp.stat(full).catch(() => null)
          if (st) {
            const cat = getCategory(getMimeType(e.name))
            byCategory[cat] = (byCategory[cat] || 0) + st.size
          }
        }
      }
    }

    // Fast walk (limit 5s)
    await withTimeout(walk(vol.storage_path), 5000).catch(() => {})

    res.json({
      status: 'online',
      volumeId: vol.id, volumeLabel: vol.label, storagePath: vol.storage_path,
      totalBytes, freeBytes, usedBytes, percentUsed,
      byCategory,
    })
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})

// 3. Volumes — list
app.get('/volumes', authenticateToken('read'), (_req, res) => {
  const vols = storageVolumes.list().map((vol) => ({
    id: vol.id, label: vol.label, storagePath: vol.storage_path,
    enabled: vol.enabled === 1,
    accessible: vol.enabled === 1 && (volumeErrors.get(vol.id) ?? null) === null,
    error: volumeErrors.get(vol.id) ?? null,
  }))
  res.json({ volumes: vols, max: MAX_VOLUMES })
})

// 4. Volumes — add
app.post('/volumes', authenticateToken('write'), async (req, res) => {
  const { storagePath, label } = req.body as { storagePath?: string; label?: string }
  if (!storagePath?.trim()) return res.status(400).json({ error: 'storagePath is required' })
  if (storageVolumes.list().length >= MAX_VOLUMES)
    return res.status(400).json({ error: `Maximum ${MAX_VOLUMES} volumes reached` })
  const id = storageVolumes.add(storagePath.trim(), label?.trim())
  if (id === null) return res.status(409).json({ error: 'Path already registered' })
  const vol = storageVolumes.getById(id)!
  const err = await ensureVolumeDir(vol)
  volumeErrors.set(id, err)
  if (err) console.error(`[Storva Agent] New volume #${id}: ${err}`)
  res.status(201).json({
    id, label: vol.label, storagePath: vol.storage_path,
    enabled: true, accessible: err === null, error: err,
  })
})

// 5. Volumes — patch (toggle / relabel)
app.patch('/volumes/:id', authenticateToken('write'), async (req, res) => {
  const id = parseInt(req.params.id as string, 10)
  const vol = storageVolumes.getById(id)
  if (!vol) return res.status(404).json({ error: 'Volume not found' })
  const { enabled, label } = req.body as { enabled?: boolean; label?: string }
  if (typeof enabled === 'boolean') {
    storageVolumes.setEnabled(id, enabled)
    if (enabled) { const err = await ensureVolumeDir(vol); volumeErrors.set(id, err) }
  }
  if (typeof label === 'string' && label.trim()) storageVolumes.setLabel(id, label.trim())
  const updated = storageVolumes.getById(id)!
  res.json({
    id: updated.id, label: updated.label, storagePath: updated.storage_path,
    enabled: updated.enabled === 1,
    accessible: updated.enabled === 1 && (volumeErrors.get(id) ?? null) === null,
    error: volumeErrors.get(id) ?? null,
  })
})

// 6. Volumes — remove
app.delete('/volumes/:id', authenticateToken('write'), (req, res) => {
  const id = parseInt(req.params.id as string, 10)
  if (!storageVolumes.getById(id)) return res.status(404).json({ error: 'Volume not found' })
  if (storageVolumes.list().length <= 1) return res.status(400).json({ error: 'Cannot remove the last volume' })
  storageVolumes.remove(id)
  volumeErrors.delete(id)
  res.json({ success: true, removed: id })
})

// 7. Volumes — reorder
app.post('/volumes/reorder', authenticateToken('write'), (req, res) => {
  const { ids } = req.body as { ids?: number[] }
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' })
  storageVolumes.reorder(ids)
  res.json({ success: true })
})

// 8. List files/folders
app.get('/files', authenticateToken('read'), async (req, res) => {
  const { vol, error } = resolveVolume(req.query.vol as string | undefined)
  if (!vol) return res.status(400).json({ error })
  if (error) return res.status(503).json({ error: `Volume "${vol.label}" not accessible: ${error}` })
  try {
    const subPath = (req.query.path as string) || ''
    const targetDir = resolveSafePath(vol.storage_path, subPath)
    const entries = await fsp.readdir(targetDir, { withFileTypes: true })
    const settled = await Promise.allSettled(
      entries
        .filter((e) => e.name !== '.trash' && e.name !== '.staging' && e.name !== '.DS_Store'
          && !e.name.endsWith('.uploading.tmp') && !WINDOWS_SYSTEM_DIRS.has(e.name))
        .map(async (entry) => {
          const full = path.join(targetDir, entry.name)
          const st = await fsp.stat(full)
          const mime = entry.isDirectory() ? 'inode/directory' : getMimeType(entry.name)
          return {
            name: entry.name,
            relativePath: path.relative(vol.storage_path, full),
            isFolder: entry.isDirectory(), size: st.size, mimeType: mime,
            category: entry.isDirectory() ? 'folder' : getCategory(mime),
            extension: path.extname(entry.name).replace('.', ''),
            modifiedAt: st.mtime, createdAt: st.birthtime,
          }
        })
    )
    const items = settled.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled').map((r) => r.value)
    res.json({ volumeId: vol.id, volumeLabel: vol.label, path: subPath || '/', items })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// 9. Create folder
app.post('/folder', authenticateToken('write'), async (req, res) => {
  const { vol, error } = resolveVolume(req.query.vol as string | undefined)
  if (!vol) return res.status(400).json({ error })
  if (error) return res.status(503).json({ error })
  try {
    const { dirPath, folderName } = req.body
    if (!folderName) return res.status(400).json({ error: 'folderName required' })
    await fsp.mkdir(resolveSafePath(vol.storage_path, path.join(dirPath || '', folderName)), { recursive: true })
    res.json({ success: true, created: folderName })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// 10. Upload
app.post('/upload', authenticateToken('write'), upload.array('files'), (req, res) => {
  const uploaded = (req.files as Express.Multer.File[] | undefined) || []
  res.json({ success: true, count: uploaded.length, files: uploaded.map((f) => ({ name: f.originalname, size: f.size })) })
})

// 11. Download
app.get('/download', authenticateToken('read'), async (req, res) => {
  const { vol, error } = resolveVolume(req.query.vol as string | undefined)
  if (!vol) return res.status(400).json({ error })
  if (error) return res.status(503).json({ error })
  try {
    const filePath = req.query.path as string
    if (!filePath) return res.status(400).json({ error: 'Path required' })
    const safeFile = resolveSafePath(vol.storage_path, filePath)
    const stats = await fsp.stat(safeFile)
    if (stats.isDirectory()) return res.status(400).json({ error: 'Cannot download directory' })
    const mime = getMimeType(safeFile)
    const range = req.headers.range
    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-')
      const start = parseInt(startStr, 10)
      const end = endStr ? parseInt(endStr, 10) : stats.size - 1
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${stats.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': mime })
      fs.createReadStream(safeFile, { start, end }).pipe(res)
    } else {
      res.writeHead(200, { 'Content-Length': stats.size, 'Content-Type': mime, 'Content-Disposition': `attachment; filename="${path.basename(safeFile)}"`, 'Accept-Ranges': 'bytes' })
      fs.createReadStream(safeFile).pipe(res)
    }
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// 12. Rename
app.post('/rename', authenticateToken('write'), async (req, res) => {
  const { vol, error } = resolveVolume(req.query.vol as string | undefined)
  if (!vol) return res.status(400).json({ error })
  if (error) return res.status(503).json({ error })
  try {
    const { filePath, newName } = req.body
    if (!filePath || !newName) return res.status(400).json({ error: 'filePath and newName required' })
    const src = resolveSafePath(vol.storage_path, filePath)
    const dest = resolveSafePath(vol.storage_path, path.join(path.dirname(filePath), newName))
    await fsp.rename(src, dest)
    res.json({ success: true })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// 13. Move
app.post('/move', authenticateToken('write'), async (req, res) => {
  const { vol, error } = resolveVolume(req.query.vol as string | undefined)
  if (!vol) return res.status(400).json({ error })
  if (error) return res.status(503).json({ error })
  try {
    const { sourcePath, destinationPath } = req.body
    await fsp.rename(resolveSafePath(vol.storage_path, sourcePath), resolveSafePath(vol.storage_path, destinationPath))
    res.json({ success: true })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// 14. Copy
app.post('/copy', authenticateToken('write'), async (req, res) => {
  const { vol, error } = resolveVolume(req.query.vol as string | undefined)
  if (!vol) return res.status(400).json({ error })
  if (error) return res.status(503).json({ error })
  try {
    const { sourcePath, destinationPath } = req.body
    await fsp.cp(resolveSafePath(vol.storage_path, sourcePath), resolveSafePath(vol.storage_path, destinationPath), { recursive: true })
    res.json({ success: true })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// 15. Soft delete → .trash
app.post('/delete', authenticateToken('delete'), async (req, res) => {
  const { vol, error } = resolveVolume(req.query.vol as string | undefined)
  if (!vol) return res.status(400).json({ error })
  if (error) return res.status(503).json({ error })
  try {
    const { filePath } = req.body
    if (!filePath) return res.status(400).json({ error: 'filePath required' })
    const src = resolveSafePath(vol.storage_path, filePath)
    const trashDir = path.join(vol.storage_path, '.trash')
    await fsp.mkdir(trashDir, { recursive: true })
    await fsp.rename(src, path.join(trashDir, `${Date.now()}_${path.basename(src)}`))
    res.json({ success: true, movedToTrash: true })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// 16. List trash
app.get('/trash', authenticateToken('read'), async (req, res) => {
  const { vol, error } = resolveVolume(req.query.vol as string | undefined)
  if (!vol) return res.status(400).json({ error })
  if (error) return res.status(503).json({ error })
  try {
    const trashDir = path.join(vol.storage_path, '.trash')
    await fsp.mkdir(trashDir, { recursive: true })
    const entries = await fsp.readdir(trashDir, { withFileTypes: true })
    const items = await Promise.all(entries.map(async (entry) => {
      const st = await fsp.stat(path.join(trashDir, entry.name))
      const sep = entry.name.indexOf('_')
      return {
        trashName: entry.name,
        originalName: sep > 0 ? entry.name.substring(sep + 1) : entry.name,
        isFolder: entry.isDirectory(), size: st.size,
        deletedAt: sep > 0 ? new Date(parseInt(entry.name.substring(0, sep), 10)) : st.mtime,
      }
    }))
    res.json({ volumeId: vol.id, items })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// 17. Restore from trash
app.post('/trash/restore', authenticateToken('write'), async (req, res) => {
  const { vol, error } = resolveVolume(req.query.vol as string | undefined)
  if (!vol) return res.status(400).json({ error })
  if (error) return res.status(503).json({ error })
  try {
    const { trashName, restorePath } = req.body
    if (!trashName) return res.status(400).json({ error: 'trashName required' })
    const trashDir = path.join(vol.storage_path, '.trash')
    const trashFile = path.join(trashDir, trashName)
    if (!trashFile.startsWith(trashDir)) return res.status(400).json({ error: 'Invalid trash item' })
    const sep = trashName.indexOf('_')
    const originalName = sep > 0 ? trashName.substring(sep + 1) : trashName
    await fsp.rename(trashFile, resolveSafePath(vol.storage_path, path.join(restorePath || '', originalName)))
    res.json({ success: true })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// 18. Permanent delete from trash
app.post('/trash/delete', authenticateToken('delete'), async (req, res) => {
  const { vol, error } = resolveVolume(req.query.vol as string | undefined)
  if (!vol) return res.status(400).json({ error })
  if (error) return res.status(503).json({ error })
  try {
    const { trashName } = req.body
    if (!trashName) return res.status(400).json({ error: 'trashName required' })
    const trashDir = path.join(vol.storage_path, '.trash')
    const trashFile = path.join(trashDir, trashName)
    if (!trashFile.startsWith(trashDir)) return res.status(400).json({ error: 'Invalid trash item' })
    await fsp.rm(trashFile, { recursive: true, force: true })
    res.json({ success: true, permanentlyDeleted: true })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// 19. Empty trash
app.post('/trash/empty', authenticateToken('delete'), async (req, res) => {
  const { vol, error } = resolveVolume(req.query.vol as string | undefined)
  if (!vol) return res.status(400).json({ error })
  if (error) return res.status(503).json({ error })
  try {
    const trashDir = path.join(vol.storage_path, '.trash')
    const entries = await fsp.readdir(trashDir).catch(() => [])
    for (const e of entries) await fsp.rm(path.join(trashDir, e), { recursive: true, force: true })
    res.json({ success: true, cleared: entries.length })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// 20. File info
app.get('/info', authenticateToken('read'), async (req, res) => {
  const { vol, error } = resolveVolume(req.query.vol as string | undefined)
  if (!vol) return res.status(400).json({ error })
  if (error) return res.status(503).json({ error })
  try {
    const filePath = req.query.path as string
    if (!filePath) return res.status(400).json({ error: 'Path required' })
    const safe = resolveSafePath(vol.storage_path, filePath)
    const st = await fsp.stat(safe)
    const mime = st.isDirectory() ? 'inode/directory' : getMimeType(safe)
    let checksum: string | null = null
    if (!st.isDirectory() && st.size < 100 * 1024 * 1024) {
      checksum = crypto.createHash('sha256').update(await fsp.readFile(safe)).digest('hex')
    }
    res.json({
      name: path.basename(safe), relativePath: filePath, isFolder: st.isDirectory(),
      size: st.size, mimeType: mime, category: st.isDirectory() ? 'folder' : getCategory(mime),
      extension: path.extname(safe).replace('.', ''), checksum,
      createdAt: st.birthtime, modifiedAt: st.mtime,
    })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// 21. Search
app.get('/search', authenticateToken('read'), async (req, res) => {
  const { vol, error } = resolveVolume(req.query.vol as string | undefined)
  if (!vol) return res.status(400).json({ error })
  if (error) return res.status(503).json({ error })
  try {
    const query = ((req.query.q as string) || '').toLowerCase()
    if (!query) return res.status(400).json({ error: 'q required' })
    const results: any[] = []
    const MAX = 50
    async function walk(dir: string, rel: string) {
      if (results.length >= MAX) return
      const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const e of entries) {
        if (results.length >= MAX) return
        if (e.name === '.trash' || WINDOWS_SYSTEM_DIRS.has(e.name)) continue
        const full = path.join(dir, e.name)
        const r = path.join(rel, e.name)
        if (e.name.toLowerCase().includes(query)) {
          const st = await fsp.stat(full).catch(() => null)
          if (st) results.push({ name: e.name, relativePath: r, isFolder: e.isDirectory(), size: st.size, modifiedAt: st.mtime })
        }
        if (e.isDirectory()) await walk(full, r)
      }
    }
    await walk(vol.storage_path, '')
    res.json({ query, volumeId: vol.id, results, total: results.length })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// 22. Chunked upload — create session
app.post('/upload/session', authenticateToken('write'), async (req, res) => {
  const { vol, error } = resolveVolume(req.query.vol as string | undefined)
  if (!vol) return res.status(400).json({ error })
  if (error) return res.status(503).json({ error })
  try {
    const { relativePath, totalChunks, checksum } = req.body
    if (!relativePath || !Number.isInteger(totalChunks) || totalChunks < 1)
      return res.status(400).json({ error: 'Invalid upload session params' })
    const id = crypto.randomUUID()
    uploadSessions.create(id, relativePath, totalChunks, checksum)
    await fsp.mkdir(resolveSafePath(vol.storage_path, path.join('.staging', id)), { recursive: true })
    res.status(201).json({ uploadId: id })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// 23. Chunked upload — receive chunk
app.post('/upload/chunk', authenticateToken('write'), express.raw({ type: 'application/octet-stream', limit: '100mb' }), async (req, res) => {
  const { vol, error } = resolveVolume(req.query.vol as string | undefined)
  if (!vol) return res.status(400).json({ error })
  if (error) return res.status(503).json({ error })
  try {
    const id = req.query.uploadId as string
    const index = Number(req.query.index)
    const session: any = uploadSessions.get(id)
    if (!session || !Number.isInteger(index) || index < 0 || index >= session.total_chunks)
      return res.status(400).json({ error: 'Invalid chunk' })
    await fsp.writeFile(resolveSafePath(vol.storage_path, path.join('.staging', id, String(index))), req.body)
    uploadSessions.incrementChunk(id)
    const updated: any = uploadSessions.get(id)
    if (updated.received_chunks >= updated.total_chunks) {
      const finalPath = resolveSafePath(vol.storage_path, updated.relative_path)
      await fsp.mkdir(path.dirname(finalPath), { recursive: true })
      const temp = `${finalPath}.uploading.tmp`
      const out = fs.createWriteStream(temp)
      for (let i = 0; i < updated.total_chunks; i++) {
        await new Promise<void>((resolve, reject) =>
          fs.createReadStream(resolveSafePath(vol.storage_path, path.join('.staging', id, String(i))))
            .pipe(out, { end: false }).on('finish', resolve).on('error', reject)
        )
      }
      out.end()
      await new Promise<void>((resolve, reject) => out.on('close', resolve).on('error', reject))
      await fsp.rename(temp, finalPath)
      await fsp.rm(resolveSafePath(vol.storage_path, path.join('.staging', id)), { recursive: true, force: true })
      uploadSessions.complete(id)
      syncQueue.push('FILE_UPLOADED', { relativePath: updated.relative_path })
      return res.json({ success: true, completed: true })
    }
    res.json({ success: true, completed: false, received: updated.received_chunks, total: updated.total_chunks })
  } catch (err: any) { res.status(400).json({ error: err.message }) }
})

// 24. Inline preview
app.get('/preview', authenticateToken('read'), async (req, res) => {
  const { vol, error } = resolveVolume(req.query.vol as string | undefined)
  if (!vol) return res.status(400).json({ error })
  if (error) return res.status(503).json({ error })
  try {
    const safe = resolveSafePath(vol.storage_path, req.query.path as string)
    const stat = await fsp.stat(safe)
    if (stat.isDirectory()) return res.status(400).json({ error: 'Cannot preview directory' })
    const mime = getMimeType(safe)
    const range = req.headers.range
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!match || (!match[1] && !match[2])) {
        res.set('Content-Range', `bytes */${stat.size}`)
        return res.status(416).end()
      }
      let start = match[1] ? parseInt(match[1], 10) : stat.size - parseInt(match[2], 10)
      let end = match[2] && match[1] ? parseInt(match[2], 10) : stat.size - 1
      if (isNaN(start) || isNaN(end) || start > end || start < 0 || end >= stat.size) {
        res.set('Content-Range', `bytes */${stat.size}`)
        return res.status(416).end()
      }
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': mime,
      })
      fs.createReadStream(safe, { start, end }).pipe(res)
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
      })
      fs.createReadStream(safe).pipe(res)
    }
  } catch (err: any) { res.status(404).json({ error: err.message }) }
})

// 25. Thumbnail
app.get('/thumbnail', authenticateToken('read'), async (req, res) => {
  const { vol, error } = resolveVolume(req.query.vol as string | undefined)
  if (!vol) return res.status(400).json({ error })
  if (error) return res.status(503).json({ error })
  try {
    const safe = resolveSafePath(vol.storage_path, req.query.path as string)
    const st = await fsp.stat(safe)
    if (st.isDirectory()) return res.status(400).json({ error: 'Not a file' })
    const buffer = await sharp(safe).resize(200, 200, { fit: 'cover' }).toBuffer()
    res.type('image/jpeg').send(buffer)
  } catch (err: any) { res.status(500).json({ error: err.message }) }
})

// ── Reconciliation (runs in its own process — see reconciler-process.ts) ──────
import { fork, ChildProcess } from 'node:child_process'

let reconcilerProc: ChildProcess | null = null
let reconcilerReady = false
let reconcilerWatchedPaths: string[] = []
let reconcilerRestarts = 0
const MAX_RECONCILER_RESTARTS = 10

function reconcilerScriptPath(): string {
  // Dev (tsx watch src/index.ts) runs straight from .ts — fork the .ts
  // sibling so it goes through the same loader. Prod runs from dist/*.js
  // after `tsc` — fork the compiled .js sibling instead.
  const isTs = __filename.endsWith('.ts')
  return path.join(__dirname, isTs ? 'reconciler-process.ts' : 'reconciler-process.js')
}

function startReconcilerProcess(volumePaths: string[]) {
  if (volumePaths.length === 0) {
    console.warn('[Storva Agent] No accessible volumes — reconciler process not started')
    return
  }

  reconcilerReady = false
  reconcilerProc = fork(reconcilerScriptPath(), [], {
    env: { ...process.env, STORVA_RECONCILE_PATHS: volumePaths.join(',') },
    stdio: 'inherit',
  })

  reconcilerProc.on('message', (msg: any) => {
    if (msg?.type === 'ready') {
      reconcilerReady = true
      reconcilerWatchedPaths = msg.paths ?? volumePaths
      reconcilerRestarts = 0 // a clean ready resets the crash-loop counter
      console.log(`[Storva Agent] Reconciler process ready (pid ${reconcilerProc?.pid})`)
    }
  })

  reconcilerProc.on('exit', (code, signal) => {
    reconcilerReady = false
    const wasIntentional = shuttingDown
    reconcilerProc = null
    if (wasIntentional) return

    console.error(`[Storva Agent] Reconciler process exited (code=${code}, signal=${signal})`)
    if (reconcilerRestarts >= MAX_RECONCILER_RESTARTS) {
      console.error('[Storva Agent] Reconciler process crash-looping — giving up on auto-restart. File sync will be stale until the agent is restarted.')
      return
    }
    reconcilerRestarts++
    const delay = Math.min(1000 * 2 ** reconcilerRestarts, 30_000)
    console.log(`[Storva Agent] Restarting reconciler process in ${delay}ms (attempt ${reconcilerRestarts}/${MAX_RECONCILER_RESTARTS})...`)
    setTimeout(() => startReconcilerProcess(volumePaths), delay)
  })
}

let shuttingDown = false
function shutdown() {
  shuttingDown = true
  if (reconcilerProc) reconcilerProc.kill('SIGTERM')
  process.exit()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// ── Startup ───────────────────────────────────────────────────────────────────
async function start() {
  await initVolumes()

  const accessiblePaths: string[] = []
  for (const vol of storageVolumes.listActive()) {
    if (volumeErrors.get(vol.id) === null) {
      accessiblePaths.push(vol.storage_path)
    } else {
      console.warn(`[Storva Agent] Skipping watcher for volume #${vol.id} "${vol.label}" — not accessible`)
    }
  }

  startReconcilerProcess(accessiblePaths)

  app.listen(PORT, () => {
    const active = storageVolumes.listActive()
    const ok = active.filter((v) => volumeErrors.get(v.id) === null)
    console.log(`Storva Agent v${AGENT_VERSION} (${AGENT_CHANNEL})`)
    console.log(`  Port   : ${PORT}`)
    console.log(`  Volumes: ${ok.length}/${active.length} accessible`)
    active.forEach((v) => {
      const err = volumeErrors.get(v.id)
      console.log(`    [${v.id}] ${v.label}  →  ${v.storage_path}  ${err ? '✗ ' + err : '✓'}`)
    })
  })
}

start()
