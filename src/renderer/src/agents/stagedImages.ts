import { useEffect, useState } from 'react'
import type { AgentAttachmentHandle, AgentBridge } from '../../../shared/agents'

/** The long edge of a chip's thumbnail, in pixels: twice the chip's own size, so it stays sharp at 200%. */
export const THUMBNAIL_EDGE = 256
/** Thumbnails kept for the life of the window, newest last; one is a few kilobytes. */
const THUMBNAIL_CACHE = 64
const thumbnails = new Map<string, Promise<string | null>>()

function agents(): AgentBridge | undefined { return window.sotto?.agents ?? window.sottoWidget?.agents }

function remember(digest: string, thumbnail: Promise<string | null>): Promise<string | null> {
  thumbnails.delete(digest)
  if (thumbnails.size >= THUMBNAIL_CACHE) thumbnails.delete(thumbnails.keys().next().value!)
  thumbnails.set(digest, thumbnail)
  // A thumbnail that could not be made may be made later, from bytes read again.
  void thumbnail.then(source => { if (source === null && thumbnails.get(digest) === thumbnail) thumbnails.delete(digest) })
  return thumbnail
}

/** The largest image a chip shows as it is when the canvas will not draw a thumbnail of it. */
const UNDRAWN_LIMIT = 1024 * 1024
/**
 * What a chip shows: a bounded copy of the image, drawn once in this window. A small image the canvas will not
 * decode, which an image element may still show, is shown as it is; otherwise the chip shows the image's name.
 */
async function chipSource(image: Blob): Promise<string | null> {
  const drawn = await drawThumbnail(image)
  if (drawn !== null || image.size > UNDRAWN_LIMIT || typeof FileReader === 'undefined') return drawn
  return new Promise(resolve => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(image)
  })
}

async function drawThumbnail(image: Blob): Promise<string | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null
  try {
    const bitmap = await createImageBitmap(image)
    const scale = Math.min(1, THUMBNAIL_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) { bitmap.close(); return null }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return canvas.toDataURL('image/png')
  } catch { return null }
}

/**
 * Hands an image's bytes to main once and answers with its handle (ADR-0030). `threadId` is the thread the draft
 * belongs to, which decides the host that keeps it; null is the coordinator's composer on the selected host. Anything
 * that changes the image before it is sent, such as a downscale, runs before this and hands over its result.
 */
export async function stageImage(threadId: string | null, image: { readonly name: string; readonly mimeType: string; readonly blob: Blob }): Promise<AgentAttachmentHandle> {
  const bridge = agents()
  if (!bridge?.stageAttachment) throw new Error('Screenshots cannot be attached in this window. Nothing was attached.')
  const bytes = new Uint8Array(await image.blob.arrayBuffer())
  const handle = await bridge.stageAttachment({ threadId, name: image.name, mimeType: image.mimeType as AgentAttachmentHandle['mimeType'], bytes })
  if (!thumbnails.has(handle.digest)) remember(handle.digest, chipSource(new Blob([bytes], { type: handle.mimeType })))
  return handle
}

/** The chip's thumbnail: drawn when the image was staged here, or from the bytes its host still keeps. */
export function thumbnailFor(threadId: string | null, handle: Pick<AgentAttachmentHandle, 'digest'>): Promise<string | null> {
  const cached = thumbnails.get(handle.digest)
  if (cached) return cached
  const bridge = agents()
  if (!bridge?.attachmentContent) return Promise.resolve(null)
  return remember(handle.digest, bridge.attachmentContent({ threadId, digest: handle.digest })
    .then(content => content ? chipSource(new Blob([new Uint8Array(content.bytes)], { type: content.mimeType })) : null, () => null))
}

/** undefined while the thumbnail is being drawn or read, null when there is none to show. */
export function useThumbnail(threadId: string | null, handle: Pick<AgentAttachmentHandle, 'digest'>): string | null | undefined {
  const [source, setSource] = useState<{ digest: string; value: string | null } | undefined>(undefined)
  useEffect(() => {
    let live = true
    void thumbnailFor(threadId, handle).then(value => { if (live) setSource({ digest: handle.digest, value }) })
    return () => { live = false }
  }, [threadId, handle.digest])
  return source?.digest === handle.digest ? source.value : undefined
}
