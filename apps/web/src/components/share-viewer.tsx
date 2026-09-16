'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Sidebar, RightPanel } from '@/components/dashboard'
import PdfViewer from '@/components/PdfViewer'
import PhotoSwipeLightbox from 'photoswipe/lightbox'
import 'photoswipe/style.css'
import {
  AlertTriangle, ArrowLeft, ChevronRight, Download, Eye, File, FileText, Folder, Grid, Image as ImageIcon,
  List as ListIcon, Lock, Music, ShieldAlert, Video, X
} from 'lucide-react'
import { formatDate } from '@/lib/format-date'

type ShareData = {
  id: string
  fileId: string
  name: string
  isFolder: boolean
  relativePath: string
  mimeType: string
  size: string
  category: string
  accessType: 'PUBLIC' | 'USER'
  hasPasskey: boolean
  readOnly: boolean
  expiresAt: string | null
  volumeId: number | null
}

type User = { id: string; username: string; role: string }
type FileItem = {
  name: string
  relativePath: string
  isFolder: boolean
  size: number
  mimeType: string
  category: string
  extension: string
  modifiedAt: string
  createdAt: string
}

function formatBytes(bytes = 0) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`
}


function effectiveMime(item: Pick<FileItem, 'mimeType' | 'name'>) {
  const mime = String(item.mimeType || '')
  if (mime && mime !== 'application/octet-stream') return mime
  const ext = item.name.slice(item.name.lastIndexOf('.')).toLowerCase()
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf', '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  }
  return map[ext] || mime
}
function effectiveCategory(item: Pick<FileItem, 'mimeType' | 'name' | 'category'>) {
  if (item.category && item.category !== 'others') return item.category
  const mime = effectiveMime(item)
  if (mime.startsWith('image/')) return 'images'
  if (mime.startsWith('video/')) return 'videos'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/pdf') return 'documents'
  return item.category
}

function getItemIcon(item: Pick<FileItem, 'isFolder' | 'category'>, size = 22) {
  if (item.isFolder) return <Folder className="fill-amber-100 text-amber-500" size={size} />
  switch (item.category) {
    case 'images': return <ImageIcon className="text-rose-500" size={size} />
    case 'videos': return <Video className="text-amber-500" size={size} />
    case 'audio': return <Music className="text-violet-500" size={size} />
    case 'documents': return <FileText className="text-blue-500" size={size} />
    default: return <File className="text-slate-400" size={size} />
  }
}

function normalizePath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

function withinRoot(root: string, target: string) {
  const r = normalizePath(root)
  const t = normalizePath(target)
  if (r === t) return true
  return Boolean(r) && t.startsWith(`${r}/`)
}

export function ShareViewer({ share }: { share: any }) {
  const [data, setData] = useState<ShareData | null>(null)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [passkey, setPasskey] = useState('')
  const [passkeyUnlocked, setPasskeyUnlocked] = useState(false)
  const [passkeyError, setPasskeyError] = useState('')
  const [items, setItems] = useState<FileItem[]>([])
  const [currentPath, setCurrentPath] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [search, setSearch] = useState('')
  const [previewItem, setPreviewItem] = useState<FileItem | null>(null)
  const [previewText, setPreviewText] = useState('')

  const addDownloadUrl = useCallback((item: Pick<FileItem, 'relativePath' | 'name'>) => {
    if (!data) return ''
    const qs = new URLSearchParams({ path: item.relativePath, mode: 'download' })
    if (data.volumeId != null) qs.set('vol', String(data.volumeId))
    return `/api/share/${share.token}/content?${qs.toString()}`
  }, [data, share.token])

  useEffect(() => {
    let active = true
    Promise.all([
      fetch(`/api/share/${share.token}`).then((res) => res.ok ? res.json() : null),
      fetch('/api/auth/me').then((res) => res.ok ? res.json() : null),
    ]).then(([shareData, auth]) => {
      if (!active) return
      if (shareData) setData(shareData)
      if (auth?.user) setCurrentUser(auth.user)
    }).finally(() => active && setAuthChecked(true))
    return () => { active = false }
  }, [share.token])

  const isGuest = !currentUser || currentUser.role?.toUpperCase() === 'GUEST'
  const needPasskey = Boolean(data?.hasPasskey && isGuest && !passkeyUnlocked)

  const loadFolder = useCallback(async (path: string) => {
    if (!data || !data.isFolder) return
    if (!withinRoot(data.relativePath, path)) return
    setLoading(true)
    setLoadError('')
    try {
      const qs = new URLSearchParams({ mode: 'list', path })
      if (data.volumeId != null) qs.set('vol', String(data.volumeId))
      const res = await fetch(`/api/share/${share.token}/content?${qs.toString()}`)
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload.error || `Failed to load folder (HTTP ${res.status})`)
      setItems(payload.items || [])
      setCurrentPath(path)
    } catch (err: any) {
      setLoadError(err.message || 'Folder tidak dapat dibuka')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [data, share.token])

  useEffect(() => {
    if (!data || needPasskey || !data.isFolder) return
    loadFolder(data.relativePath)
  }, [data, needPasskey, loadFolder])

  const previewUrl = useMemo(() => {
    if (!data || !previewItem) return ''
    const qs = new URLSearchParams({ path: previewItem.relativePath, mode: 'preview' })
    if (data.volumeId != null) qs.set('vol', String(data.volumeId))
    return `/api/share/${share.token}/content?${qs.toString()}`
  }, [data, previewItem, share.token])

  const openImageViewer = useCallback(async (targetItem: FileItem) => {
    const directItem: FileItem = {
      name: data?.name || '',
      relativePath: data?.relativePath || '',
      isFolder: false,
      size: Number(data?.size || 0),
      mimeType: data?.mimeType || '',
      category: effectiveCategory({ mimeType: data?.mimeType || '', name: data?.name || '', category: data?.category || 'others' }),
      extension: '',
      modifiedAt: '',
      createdAt: '',
    }
    const galleryItems = data?.isFolder
      ? items.filter((item) => !item.isFolder && effectiveCategory(item) === 'images')
      : [directItem]
    const startIndex = Math.max(0, galleryItems.findIndex((item) => item.relativePath === targetItem.relativePath))
    const dataSource = await Promise.all(galleryItems.map(async (item) => {
      const qs = new URLSearchParams({ path: item.relativePath, mode: 'preview' })
      if (data?.volumeId != null) qs.set('vol', String(data.volumeId))
      const src = `/api/share/${share.token}/content?${qs.toString()}`
      const dimensions = await new Promise<{ w: number; h: number }>((resolve) => {
        const image = new Image()
        image.onload = () => resolve({ w: image.naturalWidth || 1, h: image.naturalHeight || 1 })
        image.onerror = () => resolve({ w: 1, h: 1 })
        image.src = src
      })
      return { src, w: dimensions.w, h: dimensions.h, alt: item.name }
    }))
    if (!dataSource.length) return

    const lightbox = new PhotoSwipeLightbox({
      dataSource,
      pswpModule: () => import('photoswipe'),
    })
    lightbox.init()
    lightbox.loadAndOpen(startIndex >= 0 ? startIndex : 0)
  }, [addDownloadUrl, data, items, share.token])

  useEffect(() => {
    const candidate = previewItem || (!data?.isFolder ? {
      name: data?.name || '', relativePath: data?.relativePath || '', isFolder: false,
      size: Number(data?.size || 0), mimeType: data?.mimeType || '', category: data?.category || 'others',
      extension: '', modifiedAt: '', createdAt: '',
    } : null)
    if (!candidate || (!candidate.mimeType.startsWith('text/') && candidate.mimeType !== 'application/json')) {
      setPreviewText('')
      return
    }
    const qs = new URLSearchParams({ path: candidate.relativePath, mode: 'preview' })
    if (data?.volumeId != null) qs.set('vol', String(data.volumeId))
    fetch(`/api/share/${share.token}/content?${qs.toString()}`)
      .then((r) => r.ok ? r.text() : Promise.reject(new Error('preview unavailable')))
      .then(setPreviewText)
      .catch(() => setPreviewText(''))
  }, [data, previewItem, share.token])

  if (!data || !authChecked) {
    return <div className="min-h-screen bg-slate-50 p-8 text-center text-sm text-slate-500">Memuat viewer share...</div>
  }

  if (data.accessType === 'USER' && !currentUser) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-md">
        <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-200">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600"><Lock size={28} /></div>
          <h2 className="mt-4 text-center text-xl font-bold text-slate-800">Akses Terbatas</h2>
          <p className="mt-2 text-center text-sm text-slate-500">Konten ini hanya dapat diakses oleh pengguna yang sudah login.</p>
          <Link href={`/login?redirect=/s/${share.token}`} className="mt-6 flex w-full justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white">Login Sekarang</Link>
        </div>
      </div>
    )
  }

  if (needPasskey) {
    const handleVerify = async (e: React.FormEvent) => {
      e.preventDefault()
      setPasskeyError('')
      const res = await fetch(`/api/share/${share.token}/verify-passkey`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passkey }),
      })
      const payload = await res.json().catch(() => ({}))
      if (res.ok && payload.valid) setPasskeyUnlocked(true)
      else setPasskeyError(payload.error || 'Passkey salah')
    }
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-md">
        <form onSubmit={handleVerify} className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-slate-200">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600"><ShieldAlert size={28} /></div>
          <h2 className="mt-4 text-center text-xl font-bold text-slate-800">Masukkan Passkey</h2>
          <p className="mt-2 text-center text-sm text-slate-500">Masukkan passkey untuk membuka konten yang dibagikan.</p>
          <input autoFocus type="password" value={passkey} onChange={(e) => setPasskey(e.target.value)} placeholder="Masukkan Passkey..." className="mt-5 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-indigo-500" />
          {passkeyError && <p className="mt-2 text-xs font-medium text-rose-600">{passkeyError}</p>}
          <button type="submit" className="mt-5 flex w-full justify-center rounded-xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white">Buka Konten</button>
        </form>
      </div>
    )
  }

  const filteredItems = items.filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()))
  const rootPath = normalizePath(data.relativePath)
  const currentParts = normalizePath(currentPath).split('/').filter(Boolean)
  const rootParts = rootPath.split('/').filter(Boolean)
  const relativeBreadcrumbs = currentParts.slice(rootParts.length)

  const openItem = (item: FileItem) => {
    if (item.isFolder) {
      loadFolder(item.relativePath)
      return
    }
    if (effectiveCategory(item) === 'images') {
      openImageViewer(item)
      return
    }
    setPreviewItem(item)
  }

  const goParent = () => {
    if (normalizePath(currentPath) === rootPath) return
    const parts = normalizePath(currentPath).split('/').filter(Boolean)
    const parent = parts.slice(0, -1).join('/')
    if (withinRoot(rootPath, parent)) loadFolder(parent)
    else loadFolder(rootPath)
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#eef2ff,_transparent_34%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] p-0 text-slate-700 md:p-6">
      <div className="mx-auto flex min-h-screen overflow-hidden border border-white/70 bg-white/70 shadow-[0_20px_80px_rgba(99,102,241,0.12)] backdrop-blur-xl md:grid md:h-[calc(100vh-3rem)] md:min-h-[760px] md:grid-cols-[240px_minmax(0,1fr)_320px] md:gap-6 md:rounded-[2rem] md:p-5">
        <Sidebar shareToken={isGuest ? share.token : undefined} />
        <section className="min-w-0 overflow-y-auto p-4 md:p-0 md:pr-1">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="font-semibold text-slate-500">Shared</span><ChevronRight size={14} />
                <span className="truncate">{data.name}</span>
              </div>
              <h1 className="mt-1 truncate text-2xl font-bold tracking-tight text-slate-800">{data.isFolder ? 'Shared Folder' : 'Shared File'}</h1>
              <div className="mt-2 flex items-center gap-2">
                <p className="text-sm text-slate-500">{data.readOnly ? 'Read-only' : 'Shared'} viewer • {data.accessType === 'PUBLIC' ? 'Public link' : 'Authorized user'}</p>
                {!data.isFolder && (
                  <a
                    href={addDownloadUrl({ relativePath: data.relativePath, name: data.name })}
                    download={data.name}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
                    title="Download file"
                  >
                    <Download size={14} />
                    Download
                  </a>
                )}
              </div>
            </div>
            {data.isFolder && (
              <div className="flex shrink-0 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                <button onClick={() => setViewMode('grid')} className={`rounded-lg p-2 ${viewMode === 'grid' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400'}`} title="Grid"><Grid size={16} /></button>
                <button onClick={() => setViewMode('list')} className={`rounded-lg p-2 ${viewMode === 'list' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400'}`} title="List"><ListIcon size={16} /></button>
              </div>
            )}
          </div>

          {data.isFolder ? (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200/70">
                <button onClick={goParent} disabled={normalizePath(currentPath) === rootPath} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowLeft size={18} /></button>
                <button onClick={() => loadFolder(rootPath)} className="rounded-lg px-2 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50">{data.name}</button>
                {relativeBreadcrumbs.map((part, index) => (
                  <React.Fragment key={`${part}-${index}`}>
                    <ChevronRight size={13} className="text-slate-300" />
                    <span className="text-xs font-medium text-slate-600">{part}</span>
                  </React.Fragment>
                ))}
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search this folder..." className="ml-auto min-w-[180px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-indigo-500" />
              </div>

              {loading ? (
                <div className="rounded-2xl bg-white p-12 text-center text-sm text-slate-400 shadow-sm ring-1 ring-slate-200/70">Memuat isi folder...</div>
              ) : loadError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center text-sm text-rose-700"><AlertTriangle className="mx-auto mb-2" size={22} />{loadError}</div>
              ) : filteredItems.length === 0 ? (
                <div className="rounded-2xl bg-white p-12 text-center text-sm text-slate-400 shadow-sm ring-1 ring-slate-200/70">Folder kosong.</div>
              ) : viewMode === 'grid' ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredItems.map((item) => (
                    <button key={item.relativePath} onDoubleClick={() => openItem(item)} onClick={() => openItem(item)} className="group rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200/70 transition hover:-translate-y-0.5 hover:shadow-md">
                      <div className="flex items-start justify-between gap-3">
                        <div className="rounded-2xl bg-slate-50 p-3">{getItemIcon(item, 26)}</div>
                        {item.isFolder ? <Eye size={16} className="text-slate-300 opacity-0 transition group-hover:opacity-100" /> : (
                          <a href={addDownloadUrl(item)} download={item.name} onClick={(e) => e.stopPropagation()} className="rounded-lg p-1.5 text-slate-400 opacity-0 transition hover:bg-indigo-50 hover:text-indigo-600 group-hover:opacity-100" title="Download">
                            <Download size={16} />
                          </a>
                        )}
                      </div>
                      <p className="mt-4 truncate text-sm font-semibold text-slate-800 group-hover:text-indigo-600">{item.name}</p>
                      <p className="mt-1 text-xs text-slate-400">{item.isFolder ? 'Folder' : `${formatBytes(item.size)} • ${formatDate(item.modifiedAt)}`}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
                  <table className="w-full text-left text-sm"><thead className="border-b border-slate-100 text-xs font-semibold text-slate-400"><tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Size</th><th className="px-4 py-3">Modified</th><th className="px-4 py-3 text-right w-16"></th></tr></thead>
                    <tbody className="divide-y divide-slate-100">{filteredItems.map((item) => <tr key={item.relativePath} onClick={() => openItem(item)} className="cursor-pointer hover:bg-slate-50"><td className="px-4 py-3"><div className="flex items-center gap-3 font-medium text-slate-700">{getItemIcon(item, 19)}<span className="truncate">{item.name}</span></div></td><td className="px-4 py-3 text-xs text-slate-500">{item.isFolder ? '-' : formatBytes(item.size)}</td><td className="px-4 py-3 text-xs text-slate-400">{formatDate(item.modifiedAt)}</td><td className="px-4 py-3 text-right">{!item.isFolder && <a href={addDownloadUrl(item)} download={item.name} onClick={(e) => e.stopPropagation()} className="inline-flex rounded-lg p-1.5 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600" title="Download"><Download size={16} /></a>}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <FilePreview item={{ name: data.name, relativePath: data.relativePath, isFolder: false, size: Number(data.size), mimeType: data.mimeType, category: data.category, extension: '', modifiedAt: '', createdAt: '' }} src={(() => { const qs = new URLSearchParams({ path: data.relativePath, mode: 'preview' }); if (data.volumeId != null) qs.set('vol', String(data.volumeId)); return `/api/share/${share.token}/content?${qs.toString()}` })()} text={previewText} onImageClick={() => openImageViewer({ name: data.name, relativePath: data.relativePath, isFolder: false, size: Number(data.size), mimeType: data.mimeType, category: data.category, extension: '', modifiedAt: '', createdAt: '' })} />
          )}
        </section>
        <RightPanel />
      </div>

      {previewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) setPreviewItem(null) }}>
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[1.75rem] bg-white shadow-2xl ring-1 ring-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="min-w-0 flex items-center gap-3"><div>{getItemIcon(previewItem, 22)}</div><div className="min-w-0"><h3 className="truncate text-base font-bold text-slate-800">{previewItem.name}</h3><p className="text-xs text-slate-400">{formatBytes(previewItem.size)} • {previewItem.mimeType}</p></div></div>
              <button onClick={() => setPreviewItem(null)} className="rounded-full p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-4">
              <FilePreview item={previewItem} src={previewUrl} text={previewText} />
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function FilePreview({ item, src, text, onImageClick }: { item: FileItem; src: string; text: string; onImageClick?: () => void }) {
  const mimeType = effectiveMime(item)
  const category = effectiveCategory(item)
  if (category === 'images' || mimeType.startsWith('image/')) return <div className="flex min-h-[55vh] items-center justify-center"><button type="button" onClick={onImageClick} className="cursor-zoom-in rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400" title="Open image viewer"><img src={src} alt={item.name} className="max-h-[75vh] max-w-full rounded-xl object-contain shadow-sm" /></button></div>
  if (mimeType === 'application/pdf' || item.name.toLowerCase().endsWith('.pdf')) return <div className="mx-auto min-h-[70vh] max-w-4xl overflow-hidden rounded-xl bg-white shadow-sm"><PdfViewer src={src} fileName={item.name} /></div>
  if (category === 'videos' || mimeType.startsWith('video/')) return <div className="flex min-h-[55vh] items-center justify-center"><video src={src} controls playsInline className="max-h-[72vh] max-w-full rounded-xl bg-black shadow-sm" /></div>
  if (category === 'audio' || mimeType.startsWith('audio/')) return <div className="mx-auto flex min-h-[35vh] max-w-xl flex-col items-center justify-center rounded-2xl bg-white p-8 shadow-sm"><Music className="text-violet-500" size={48} /><p className="mt-4 text-base font-semibold text-slate-800">{item.name}</p><audio src={src} controls className="mt-6 w-full" /></div>
  if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') return <pre className="mx-auto min-h-[55vh] max-w-4xl whitespace-pre-wrap rounded-2xl bg-white p-6 font-mono text-sm leading-6 text-slate-700 shadow-sm">{text || 'Memuat isi file...'}</pre>
  return <div className="mx-auto flex min-h-[45vh] max-w-xl flex-col items-center justify-center rounded-2xl bg-white p-8 text-center shadow-sm"><FileText className="text-blue-500" size={48} /><h3 className="mt-4 text-base font-semibold text-slate-800">{item.name}</h3><p className="mt-2 text-sm leading-6 text-slate-500">Format ini belum memiliki renderer bawaan browser. File tetap tersedia dalam mode read-only tanpa tombol download.</p></div>
}
