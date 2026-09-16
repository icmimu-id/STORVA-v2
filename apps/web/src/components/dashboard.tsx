'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { formatDate } from '@/lib/format-date'
import {
  LayoutDashboard,
  FolderOpen,
  Star,
  Trash2,
  HardDrive,
  Activity,
  Settings as SettingsIcon,
  FileText,
  Image as ImageIcon,
  Video,
  Music,
  Archive,
  Upload,
  FolderPlus,
  Search,
  MoreHorizontal,
  Download,
  Eye,
  File,
  LogIn,
  LogOut,
  User,
  Users,
  Menu,
  X,
} from 'lucide-react'

const NAV_ITEMS = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
  { label: 'My Files', icon: FolderOpen, path: '/files' },
  { label: 'Favorites', icon: Star, path: '/favorites' },
  { label: 'Trash', icon: Trash2, path: '/trash' },
]

const CATEGORIES = [
  { label: 'Documents', icon: FileText, category: 'documents' },
  { label: 'Images', icon: ImageIcon, category: 'images' },
  { label: 'Videos', icon: Video, category: 'videos' },
  { label: 'Audio', icon: Music, category: 'audio' },
  { label: 'Archives', icon: Archive, category: 'archives' },
]

const SYSTEM = [
  { label: 'Storage', icon: HardDrive, path: '/settings/storage' },
  { label: 'Activity', icon: Activity, path: '/settings/activity' },
  { label: 'Users', icon: Users, path: '/settings/users' },
  { label: 'Settings', icon: SettingsIcon, path: '/settings/connection' },
]

function formatBytes(bytes: number = 0) {
  if (!bytes || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`
}


export function TabSwitcher({ tabs, activeTab, onChange }: { tabs: string[], activeTab: string, onChange: (tab: string) => void }) {
  return (
    <div className="flex gap-1 p-1 bg-slate-100 rounded-xl mb-6">
      {tabs.map(tab => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === tab ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}

export function Sidebar({ shareToken }: { shareToken?: string } = {}) {
  const pathname = usePathname()
  const router = useRouter()
  const { user } = useAuth()
  // When a guest arrives via a share link, keep My Files inside that share scope.
  // Authenticated users retain the normal /files destination.
  const guestMyFilesPath = shareToken ? `/s/${shareToken}` : '/files'

  const handleSignOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    router.push('/login')
  }

  const [isMobileOpen, setIsMobileOpen] = useState(false)

  return (
    <>
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-white/80 backdrop-blur-md sticky top-0 z-50 border-b border-slate-100">
        <button onClick={() => setIsMobileOpen(true)} className="p-2 text-slate-600"><Menu size={20} /></button>
        {shareToken ? (
          <span className="font-extrabold text-xl bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-indigo-400">Storva.</span>
        ) : (
          <Link href="/" className="font-extrabold text-xl bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-indigo-400">Storva.</Link>
        )}
        {user ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-700">{user.username}</span>
            <button onClick={handleSignOut} className="p-2 text-slate-600"><LogOut size={20} /></button>
          </div>
        ) : (
          <Link href="/login" className="flex items-center gap-1.5 p-2 text-slate-600 hover:text-indigo-600 transition">
            <LogIn size={20} />
            <span className="text-xs font-semibold">Sign In</span>
          </Link>
        )}
      </div>

      {/* Mobile Sidebar Overlay */}
      {isMobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setIsMobileOpen(false)} />
          <aside className="relative w-[280px] bg-indigo-600 p-6 text-indigo-100 flex flex-col">
            <button onClick={() => setIsMobileOpen(false)} className="absolute top-4 right-4 p-2"><X /></button>
            {shareToken ? (
              <span className="mb-12 block text-center font-extrabold text-3xl tracking-tight text-white">Storva.</span>
            ) : (
              <Link href="/" className="mb-12 text-center font-extrabold text-3xl tracking-tight text-white">Storva.</Link>
            )}
            <nav className="flex-1 space-y-4">
              {(user ? NAV_ITEMS : [{ label: 'My Files', icon: FolderOpen, path: guestMyFilesPath }]).map((item) => (
                <Link
                  key={item.label}
                  href={item.path}
                  onClick={() => setIsMobileOpen(false)}
                  className={`flex items-center gap-4 px-4 py-3 rounded-2xl transition-all ${pathname === item.path ? 'bg-white/10 text-white' : 'hover:bg-white/5 text-indigo-100/60'
                    }`}
                >
                  <item.icon size={22} />
                  <span className="font-semibold text-sm">{item.label}</span>
                </Link>
              ))}
              {user?.role?.toLowerCase() === 'admin' && (
                <>
                  <div className="pt-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-indigo-100/45">Settings</div>
                  {SYSTEM.map((item) => (
                    <Link
                      key={item.label}
                      href={item.path}
                      onClick={() => setIsMobileOpen(false)}
                      className={`flex items-center gap-4 px-4 py-3 rounded-2xl transition-all ${pathname === item.path ? 'bg-white/10 text-white' : 'hover:bg-white/5 text-indigo-100/60'
                        }`}
                    >
                      <item.icon size={22} />
                      <span className="font-semibold text-sm">{item.label}</span>
                    </Link>
                  ))}
                </>
              )}
            </nav>
          </aside>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex h-full min-h-0 w-[240px] flex-col overflow-hidden rounded-[2rem] bg-indigo-600 pt-12 p-6 pb-6 text-indigo-100">
        <div className="mb-9 flex justify-center">
          {shareToken ? (
            <span className="font-extrabold text-5xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-indigo-200">Storva.</span>
          ) : (
            <Link href="/" className="font-extrabold text-5xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-indigo-200">Storva.</Link>
          )}
        </div>

        <nav className="flex-1 space-y-4">
          {(user ? NAV_ITEMS : [{ label: 'My Files', icon: FolderOpen, path: guestMyFilesPath }]).map((item) => (
            <Link
              key={item.label}
              href={item.path}
              className={`flex items-center gap-4 px-4 py-3 rounded-2xl transition-all ${pathname === item.path ? 'bg-white/10 text-white' : 'hover:bg-white/5 text-indigo-100/60'
                }`}
            >
              <item.icon size={22} strokeWidth={pathname === item.path ? 2.5 : 2} />
              <span className="font-semibold text-sm">{item.label}</span>
            </Link>
          ))}

          {user?.role?.toLowerCase() === 'admin' && (
            <>
              <div className="pt-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-indigo-100/45">Settings</div>
              {SYSTEM.map((item) => (
                <Link
                  key={item.label}
                  href={item.path}
                  className={`flex items-center gap-4 px-4 py-3 rounded-2xl transition-all ${pathname === item.path ? 'bg-white/10 text-white' : 'hover:bg-white/5 text-indigo-100/60'
                    }`}
                >
                  <item.icon size={22} strokeWidth={pathname === item.path ? 2.5 : 2} />
                  <span className="font-semibold text-sm">{item.label}</span>
                </Link>
              ))}
            </>
          )}
        </nav>

        <div className="mt-8 rounded-3xl bg-white/10 p-5 ring-1 ring-white/20 backdrop-blur-sm">
          <p className="text-[10px] font-medium uppercase tracking-wider text-indigo-200">Welcome!</p>
          <p className="mt-1 text-lg font-bold leading-tight text-white">To HASANA Cloud.</p>
          <p className="mt-3 text-xs leading-relaxed text-indigo-100/70">
            Personal cloud, accessible anywhere. Manage files across your devices securely.
          </p>
        </div>
      </aside>
    </>
  )
}

export function HeroCard({ status = 'online' as string }) {
  const online = status === 'online'
  const dotColor = online ? 'bg-emerald-400' : 'bg-rose-400'
  const label = online ? 'Local' : 'Offline'
  return (
    <header className="relative overflow-hidden rounded-[1.5rem] bg-gradient-to-br from-indigo-600 via-indigo-500 to-violet-500 p-6 text-white shadow-[0_20px_50px_rgba(79,70,229,0.28)] md:p-8">
      <div className="pointer-events-none absolute -right-8 -top-8 h-48 w-48 rounded-full bg-white/5" />
      <div className="pointer-events-none absolute -bottom-12 right-16 h-32 w-32 rounded-full bg-white/5" />
      <div className="relative grid gap-6 md:grid-cols-[1.4fr_0.8fr]">
        <div>
          <p className="text-sm text-white/70">Welcome to Storva 👋</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight md:text-3xl">
            Your Personal NAS Storage
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/70">
            Local-first storage with live drive synchronization and remote access.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/files"
              className="flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-indigo-600 shadow-sm transition hover:shadow-md hover:bg-white/95"
            >
              <Upload size={16} /> Upload & Browse
            </Link>
            <Link
              href="/files"
              className="flex items-center gap-2 rounded-xl border border-white/30 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/10"
            >
              <FolderPlus size={16} /> Manage Folders
            </Link>
          </div>
        </div>
        <div className="rounded-[1.25rem] bg-white/10 p-5 ring-1 ring-white/20 backdrop-blur-sm">
          <div className="text-xs font-medium text-white/60 uppercase tracking-wider">Connection</div>
          <div className="mt-3 flex items-center gap-2 text-xl font-bold">
            <span className={`h-3 w-3 rounded-full ${dotColor} shadow-sm`} />
            {label}
          </div>
          <div className="mt-4 space-y-2 text-sm text-white/70">
            <div className="flex justify-between"><span>Agent</span><span className={online ? 'text-emerald-300' : 'text-rose-300'}>{online ? '● Online' : '○ Offline'}</span></div>
            <div className="flex justify-between"><span>Storage</span><span className={online ? 'text-emerald-300' : 'text-rose-300'}>{online ? '● Synchronized' : '○ Unavailable'}</span></div>
          </div>
        </div>
      </div>
    </header>
  )
}

export function StorageCards() {
  const [stats, setStats] = useState<any>(null)

  useEffect(() => {
    fetch('/api/storage/status')
      .then((r) => r.json())
      .then((d) => setStats(d))
      .catch(() => { })
  }, [])

  const byCat = stats?.byCategory || {}
  const fileTotal = Object.values(byCat as Record<string, number>).reduce((a, b) => a + (b || 0), 0) || 1

  const cards = [
    { label: 'Images', icon: ImageIcon, color: 'bg-indigo-500', value: byCat.images || 0 },
    { label: 'Videos', icon: Video, color: 'bg-rose-500', value: byCat.videos || 0 },
    { label: 'Music', icon: Music, color: 'bg-orange-500', value: byCat.audio || 0 },
    { label: 'Apps', icon: Archive, color: 'bg-blue-500', value: byCat.others || 0 },
  ]

  return (
    <div className="flex flex-wrap gap-4">
      {cards.map((c) => (
        <div key={c.label} className="flex h-[100px] w-[100px] flex-col items-center justify-center gap-2 rounded-3xl bg-white shadow-sm ring-1 ring-slate-100 transition hover:shadow-md">
          <div className={`p-2 rounded-xl text-white ${c.color}`}><c.icon size={20} /></div>
          <span className="text-xs font-bold text-slate-700">{c.label}</span>
        </div>
      ))}
      <div className="flex h-[100px] w-[100px] flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-200 text-slate-300">
        <span className="text-2xl font-light">+</span>
        <span className="text-[10px] font-bold">Add</span>
      </div>
    </div>
  )
}

export function RecentFilesTable() {
  const [files, setFiles] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/agent/files')
      .then((r) => r.json())
      .then((d) => {
        const onlyFiles = (d.items || []).filter((i: any) => !i.isFolder)
        setFiles(onlyFiles.slice(0, 5))
      })
      .catch(() => { })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="rounded-[1.5rem] bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-800">Recent Files on Drive</h2>
        <Link href="/files" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
          View All
        </Link>
      </div>
      <div className="mt-4 overflow-hidden rounded-xl border border-slate-100">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50/80 text-xs text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Size</th>
              <th className="px-4 py-3 font-medium">Last Modified</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-xs text-slate-400">
                  Loading files from drive...
                </td>
              </tr>
            ) : files.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-xs text-slate-400">
                  No files found on drive. <Link href="/files" className="text-indigo-600 underline">Upload one</Link>
                </td>
              </tr>
            ) : (
              files.map((f) => (
                <tr key={f.name} className="border-t border-slate-100 transition hover:bg-slate-50/50">
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-lg bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-600 uppercase">
                      {f.extension || 'FILE'}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-700">
                    <Link href={`/files`} className="hover:text-indigo-600">
                      {f.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatBytes(f.size)}</td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(f.modifiedAt)}</td>
                  <td className="px-4 py-3">
                    <a
                      href={`/api/agent/download?path=${encodeURIComponent(f.relativePath || f.name)}`}
                      download={f.name}
                      title="Download"
                      className="text-slate-400 hover:text-indigo-600"
                    >
                      <Download size={16} />
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function FoldersCard() {
  const [folders, setFolders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/agent/files')
      .then((r) => r.json())
      .then((d) => {
        const onlyFolders = (d.items || []).filter((i: any) => i.isFolder)
        setFolders(onlyFolders.slice(0, 4))
      })
      .catch(() => { })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="rounded-[1.5rem] bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-800">Folders on Drive</h2>
        <Link href="/files" className="text-slate-400 hover:text-slate-600">
          <MoreHorizontal size={16} />
        </Link>
      </div>
      <div className="mt-4 space-y-3">
        {loading ? (
          <div className="py-6 text-center text-xs text-slate-400">Loading folders from drive...</div>
        ) : folders.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-400">
            No folders created yet.{' '}
            <Link href="/files" className="text-indigo-600 underline">
              Create a folder
            </Link>
          </div>
        ) : (
          folders.map((f) => (
            <Link
              key={f.name}
              href={`/files?path=${encodeURIComponent(f.relativePath || f.name)}`}
              className="flex items-center gap-4 rounded-xl bg-slate-50/80 p-4 transition hover:bg-slate-100 block"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
                <FolderOpen size={20} />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-slate-700">{f.name}</div>
                <div className="text-xs text-slate-400">Last modified: {formatDate(f.modifiedAt)}</div>
              </div>
            </Link>
          ))
        )}
      </div>
      <Link
        href="/files"
        className="mt-4 block text-center w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
      >
        View All Folders
      </Link>
    </div>
  )
}

export function RightPanel() {
  const [stats, setStats] = useState<any>(null)
  const [activities, setActivities] = useState<any[]>([])
  const { user, loading } = useAuth()
  const router = useRouter()

  const handleSignOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    router.push('/login')
  }

  useEffect(() => {
    fetch('/api/storage/status')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setStats(d))
      .catch(() => { })

    fetch('/api/activity?page=1&limit=3')
      .then((r) => r.json())
      .then((d) => setActivities(d.items || []))
      .catch(() => { })
  }, [])

  const usedBytes = stats?.usedBytes || 0
  const totalBytes = stats?.totalBytes || 1
  const percentUsed = Math.round(stats?.percentUsed || 0)

  return (
    <aside className="hidden rounded-[1.5rem] bg-white p-5 shadow-sm ring-1 ring-slate-200/70 md:flex md:flex-col">
      {/* Auth Widget moved here */}
      <div className="mb-4">
        {loading ? (
          <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
        ) : user ? (
          <div className="flex items-center justify-between rounded-xl bg-gradient-to-r from-indigo-50 to-violet-50 px-3.5 py-2.5 ring-1 ring-indigo-100/70">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white shadow-sm">
                {(user.username ?? 'A')[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-slate-800">{user.username ?? 'Admin'}</div>
                <div className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Signed in
                </div>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              title="Sign Out"
              className="ml-2 flex items-center justify-center rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
            >
              <LogOut size={14} />
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/25 transition-all duration-200 hover:from-indigo-500 hover:to-violet-500 hover:shadow-lg hover:shadow-indigo-500/30 hover:scale-[1.01] active:scale-[0.99]"
          >
            <LogIn size={15} className="transition-transform group-hover:-translate-x-0.5" />
            Sign In
          </Link>
        )}
      </div>

      <Link
        href="/files"
        className="flex items-center gap-2 rounded-xl bg-slate-100/80 px-4 py-3 text-sm text-slate-400 hover:text-slate-600 hover:bg-slate-200/70 transition"
      >
        <Search size={16} />
        Search Drive & Files
      </Link>

      {user && (
        <>
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-slate-800">Storage Drive</h3>
            <div
              className="mt-4 mx-auto flex h-44 w-44 items-center justify-center rounded-full p-5"
              style={{
                background: `conic-gradient(#4f46e5 0% ${percentUsed}%, #e2e8f0 ${percentUsed}% 100%)`,
              }}
            >
              <div className="flex h-full w-full items-center justify-center rounded-full bg-white shadow-inner">
                <div className="text-center">
                  <div className="text-2xl font-bold text-indigo-600">{formatBytes(usedBytes)}</div>
                  <div className="text-[11px] text-slate-400">Used of {formatBytes(totalBytes)}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Activities</h3>
              <Link href="/settings/activity" className="text-xs font-medium text-indigo-600">
                View All
              </Link>
            </div>
            <div className="mt-3 space-y-3">
              {activities.length === 0 ? (
                <div className="rounded-xl bg-slate-50/80 p-3 text-xs text-slate-400">No recent activities</div>
              ) : (
                activities.map((act, i) => (
                  <div key={i} className="rounded-xl bg-slate-50/80 p-3">
                    <div className="text-[10px] font-medium text-indigo-500">{formatDate(act.createdAt)}</div>
                    <div className="mt-1 text-sm text-slate-600">
                      <span className="font-semibold">{act.action}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      <div className="mt-auto rounded-[1.25rem] bg-gradient-to-br from-violet-50 to-indigo-50 p-5 text-center ring-1 ring-indigo-100/50">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-400/30">
          <HardDrive size={28} />
        </div>
        <div className="mt-3 text-sm font-semibold text-slate-700">
          Storva Drive Status: <span className="text-emerald-600 font-bold">Online</span>
        </div>
        <p className="mt-1 text-xs text-slate-400">{percentUsed}% disk used</p>
      </div>
    </aside>
  )
}
