import { repository } from '@/lib/repository'
import { getCurrentUser } from '@/lib/authUtils'
import { signAgentToken } from '@storva/shared-auth'
import { NextRequest, NextResponse } from 'next/server'

const AGENT_URL = process.env.STORVA_AGENT_URL || 'http://127.0.0.1:5125'
const SHARE_COOKIE_PREFIX = 'storva-share:'
const SECRET = process.env.SIGNING_PRIVATE_KEY || 'super-secret-signing-key-minimum-32-chars-long'
import { createHmac } from 'node:crypto'

function normalize(value: string) {
  return value.replace(/\\/g, '/').replace(/^\/+/g, '').replace(/\/+$/g, '')
}

function signShareAccess(token: string) {
  const payload = `${SHARE_COOKIE_PREFIX}${token}`
  const sig = createHmac('sha256', SECRET).update(payload).digest('hex')
  return `${payload}.${sig}`
}

function hasShareAccess(req: NextRequest, token: string) {
  const cookie = req.cookies.get(`share_${token}`)?.value
  if (!cookie) return false
  return cookie === signShareAccess(token)
}

function withinRoot(root: string, target: string) {
  const r = normalize(root)
  const t = normalize(target)
  if (r === t) return true
  return Boolean(r) && t.startsWith(`${r}/`)
}

async function canAccessPrivatePath(path: string, user: any) {
  const rules: any[] = await repository.privacyRule.findMany({}).catch(() => [])
  const target = normalize(path)
  const matchedRule = rules
    .filter((r) => {
      const rulePath = normalize(r.relativePath)
      return target === rulePath || target.startsWith(`${rulePath}/`)
    })
    .sort((a, b) => normalize(b.relativePath).length - normalize(a.relativePath).length)[0]

  if (!matchedRule?.isPrivate) return true
  if (user?.role?.toLowerCase() === 'admin') return true

  const allowed: string[] = JSON.parse(matchedRule.allowedUsers || '[]')
  return Boolean(user && allowed.includes(user.id))
}

async function getShare(token: string) {
  const share = await repository.shareLink.findUnique({ where: { token } })
  if (!share) return null
  if (share.expiresAt && new Date(share.expiresAt) < new Date()) return null
  const file = await repository.fileMetadata.findUnique({ where: { id: share.fileId } })
  if (!file) return null
  return { share, file }
}

async function proxyToAgent(req: NextRequest, agentPath: string, search: URLSearchParams) {
  const currentUser = await getCurrentUser(req)
  const userId = currentUser?.id || 'dev-user'
  const token = await signAgentToken(userId, 'share-viewer', ['storage:read'], 300)
  const url = new URL(`/${agentPath}`, AGENT_URL)
  search.forEach((value, key) => url.searchParams.append(key, value))

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (req.headers.get('range')) headers.Range = req.headers.get('range')!

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 300_000)
  try {
    const res = await fetch(url.toString(), { method: 'GET', headers, signal: controller.signal })
    const response = new NextResponse(res.body, { status: res.status, statusText: res.statusText })
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = res.headers.get(h)
      if (value) response.headers.set(h, value)
    }
    return response
  } finally {
    clearTimeout(timer)
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try {
    const record = await getShare(token)
    if (!record) return NextResponse.json({ error: 'Not found or expired' }, { status: 404 })

    const { share, file } = record
    const currentUser = await getCurrentUser(req)
    if (share.accessType === 'USER' && !currentUser) {
      return NextResponse.json({ error: 'Login required' }, { status: 401 })
    }
    if (share.passwordHash && (!currentUser || currentUser.role?.toUpperCase() === 'GUEST') && !hasShareAccess(req, token)) {
      return NextResponse.json({ error: 'Passkey required' }, { status: 401 })
    }

    const requested = normalize(req.nextUrl.searchParams.get('path') || file.relativePath)
    const root = normalize(file.relativePath)
    if (!withinRoot(root, requested)) {
      return NextResponse.json({ error: 'Path is outside shared item' }, { status: 403 })
    }
    if (!(await canAccessPrivatePath(requested, currentUser))) {
      return NextResponse.json({ error: 'Access denied to private content' }, { status: 403 })
    }

    const agentSearch = new URLSearchParams()
    if (share.volumeId != null) agentSearch.set('vol', String(share.volumeId))
    agentSearch.set('path', requested)

    const mode = req.nextUrl.searchParams.get('mode') || (file.isFolder ? 'list' : 'preview')
    if (mode === 'list') {
      return proxyToAgent(req, 'files', agentSearch)
    }
    if (mode === 'download') {
      return proxyToAgent(req, 'download', agentSearch)
    }
    return proxyToAgent(req, 'preview', agentSearch)
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Share content unavailable' }, { status: 500 })
  }
}
