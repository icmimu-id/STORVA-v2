import { repository } from '@/lib/repository'
import { getCurrentUser } from '@/lib/authUtils'
import { NextRequest, NextResponse } from 'next/server'

const EXT_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
}
function effectiveMime(file: any) {
  const current = String(file.mimeType || '')
  if (current && current !== 'application/octet-stream') return current
  const name = String(file.name || file.relativePath || '')
  return EXT_MIME[name.slice(name.lastIndexOf('.')).toLowerCase()] || current || 'application/octet-stream'
}
function getCategory(file: any) {
  if (file.isFolder) return 'folder'
  const mime = effectiveMime(file)
  if (mime.startsWith('image/')) return 'images'
  if (mime.startsWith('video/')) return 'videos'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('text/') || mime.includes('pdf') || mime.includes('document') || mime.includes('sheet') || mime.includes('presentation') || mime.includes('msword')) return 'documents'
  return 'others'
}

function normalizePath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try {
    const share = await repository.shareLink.findUnique({ where: { token } })
    if (!share) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
      return NextResponse.json({ error: 'Expired' }, { status: 410 })
    }

    const file = await repository.fileMetadata.findUnique({ where: { id: share.fileId } })
    if (!file) return NextResponse.json({ error: 'Shared file not found' }, { status: 404 })

    // Check privacy rule
    const currentUser = await getCurrentUser(req)
    const rules: any[] = await repository.privacyRule.findMany({}).catch(() => [])
    const target = normalizePath(file.relativePath)
    const matchedRule = rules
      .filter((r) => {
        const rp = normalizePath(r.relativePath)
        return target === rp || target.startsWith(`${rp}/`)
      })
      .sort((a, b) => normalizePath(b.relativePath).length - normalizePath(a.relativePath).length)[0]

    if (matchedRule?.isPrivate) {
      const isAdmin = currentUser?.role?.toLowerCase() === 'admin'
      const allowed: string[] = JSON.parse(matchedRule.allowedUsers || '[]')
      if (!isAdmin && (!currentUser || !allowed.includes(currentUser.id))) {
        return NextResponse.json({ error: 'Access denied to private content' }, { status: 403 })
      }
    }

    return NextResponse.json({
      id: share.id,
      fileId: share.fileId,
      name: file.name,
      isFolder: file.isFolder,
      relativePath: file.relativePath,
      mimeType: effectiveMime(file),
      category: getCategory(file),
      size: file.size.toString(),
      accessType: share.accessType,
      hasPasskey: Boolean(share.passwordHash),
      readOnly: share.readOnly,
      volumeId: share.volumeId ?? null,
      expiresAt: share.expiresAt,
      createdAt: share.createdAt,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
