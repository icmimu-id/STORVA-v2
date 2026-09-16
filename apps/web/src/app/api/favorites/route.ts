import { repository } from '@/lib/repository'
import { getCurrentUser } from '@/lib/authUtils'

async function getOrCreateDevice(userId: string) {
  const existing = await repository.device.findFirst({ where: { userId } })
  if (existing) return existing

  return repository.device.create({
    data: {
      userId,
      deviceName: 'Local Agent (auto-registered)',
      publicKey: `auto:${userId}`,
      agentVersion: '0.1.0',
    },
  })
}

function inferCategory(mime: string, isFolder: boolean) {
  if (isFolder) return 'folder'
  if (mime.startsWith('image/')) return 'images'
  if (mime.startsWith('video/')) return 'videos'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('text/') || mime.includes('pdf') || mime.includes('document') || mime.includes('sheet')) return 'documents'
  return 'others'
}

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const favorites = await repository.fileMetadata.findMany({
      where: { userId: user.id, isFavorite: true },
      orderBy: { updatedAt: 'desc' },
    })

    // BigInt serialization string conversion
    const items = favorites
      .filter((f: any) => f.isDeleted !== true)
      .map((f: any) => ({ ...f, size: f.size.toString(), category: inferCategory(f.mimeType || '', Boolean(f.isFolder)) }))
    return Response.json({ items })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { fileId, relativePath, name, isFolder, size, mimeType, extension, isFavorite, volumeId } = await req.json()
    const user = await getCurrentUser(req)
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!fileId && !relativePath) return Response.json({ error: 'fileId or relativePath required' }, { status: 400 })

    const normPath = relativePath ? relativePath.replace(/\\/g, '/').replace(/^\/+/, '') : relativePath

    let file = fileId
      ? await repository.fileMetadata.findUnique({ where: { id: fileId } })
      : await repository.fileMetadata.findFirst({ where: { userId: user.id, relativePath: normPath } })

    if (file) {
      file = await repository.fileMetadata.update({
        where: { id: file.id },
        data: { isFavorite: Boolean(isFavorite), volumeId: volumeId != null ? Number(volumeId) : file.volumeId ?? null },
      })
    } else {
      if (!normPath) return Response.json({ error: 'File metadata not found' }, { status: 404 })
      const device = await getOrCreateDevice(user.id)
      file = await repository.fileMetadata.create({
        data: {
          userId: user.id,
          deviceId: device.id,
          name: name || normPath.split('/').pop() || normPath,
          relativePath: normPath,
          isFolder: Boolean(isFolder),
          isFavorite: Boolean(isFavorite),
          isDeleted: false,
          volumeId: volumeId != null ? Number(volumeId) : null,
          size: BigInt(Number(size) || 0),
          mimeType: mimeType || 'application/octet-stream',
          extension: extension || '',
        }
      })
    }

    return Response.json({ success: true, isFavorite: file.isFavorite })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
