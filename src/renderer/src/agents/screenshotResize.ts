import type { AgentAttachmentDimensions } from '../../../shared/agents'

/**
 * The longest edge, in pixels, that any model Sotto sends a screenshot to reads. Claude 4.7 and later
 * downscale anything longer than 2576 px before the model sees it; Codex scales a pasted image to fit
 * 2048 px itself before its request leaves the computer; Grok Build takes no screenshots through its
 * client. Pixels past this bound cost transfer, framing, storage and memory and change nothing a model
 * reads, so the composer scales a larger screenshot down to it. The sources are in
 * `docs/perf/2026-09-26-screenshot-resize.md`.
 */
export const SCREENSHOT_MAX_LONG_EDGE = 2576

/** JPEG and WebP are written at the quality Chromium uses when none is given. */
const LOSSY_QUALITY = 0.92
/** The formats a canvas can write back as themselves. A GIF is left as it is, since a canvas cannot write one. */
const RESIZABLE = new Set(['image/png', 'image/jpeg', 'image/webp'])

export interface ImageSize { readonly width: number; readonly height: number }

/** `size` scaled down so its longer edge is `bound`, with its aspect ratio kept, or `size` itself when it already fits. */
export function fitLongEdge(size: ImageSize, bound = SCREENSHOT_MAX_LONG_EDGE): ImageSize {
  const long = Math.max(size.width, size.height)
  if (long <= bound) return size
  const scale = bound / long
  return size.width >= size.height
    ? { width: bound, height: Math.max(1, Math.round(size.height * scale)) }
    : { width: Math.max(1, Math.round(size.width * scale)), height: bound }
}

/** An image decoded once, which can be drawn again at another size. */
export interface DecodedScreenshot {
  readonly size: ImageSize
  /** The image drawn at `size` and written as `mimeType`, or null when that cannot be done here. */
  encode(size: ImageSize, mimeType: string): Promise<Blob | null>
  close(): void
}
export type ScreenshotDecoder = (file: Blob) => Promise<DecodedScreenshot | null>

/** Decodes with the renderer's own image decoder and redraws on an offscreen canvas. Null where either is missing. */
export const canvasDecoder: ScreenshotDecoder = async file => {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return null
  const bitmap = await createImageBitmap(file)
  return {
    size: { width: bitmap.width, height: bitmap.height },
    async encode(size, mimeType) {
      const canvas = new OffscreenCanvas(size.width, size.height)
      const context = canvas.getContext('2d')
      if (!context) return null
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(bitmap, 0, 0, size.width, size.height)
      const blob = await canvas.convertToBlob({ type: mimeType, quality: LOSSY_QUALITY })
      // A canvas that cannot write the type falls back to PNG; that would change the format, so it is refused.
      return blob.type === mimeType ? blob : null
    },
    close() { bitmap.close() },
  }
}

export interface PreparedScreenshot {
  /** What is sent: the file itself, or its scaled-down copy in the same format. */
  readonly blob: Blob
  /** Absent when the image could not be decoded here, in which case the file goes as it is, as before. */
  readonly dimensions?: AgentAttachmentDimensions
}

const plausible = (size: ImageSize): boolean => Number.isInteger(size.width) && Number.isInteger(size.height)
  && size.width >= 1 && size.height >= 1 && size.width <= 65_535 && size.height <= 65_535

/**
 * The screenshot as the composer hands it on. One whose longer edge is past `bound` is scaled down to it in
 * its own format; anything else, and anything that cannot be scaled without changing its format or growing,
 * goes as the user attached it. Never scales up.
 */
export async function prepareScreenshot(file: Blob, decode: ScreenshotDecoder = canvasDecoder, bound = SCREENSHOT_MAX_LONG_EDGE): Promise<PreparedScreenshot> {
  const decoded = await decode(file).catch(() => null)
  if (!decoded) return { blob: file }
  try {
    const original = decoded.size
    if (!plausible(original)) return { blob: file }
    const untouched: PreparedScreenshot = { blob: file, dimensions: { original, sent: original } }
    const sent = fitLongEdge(original, bound)
    if (sent === original || !RESIZABLE.has(file.type)) return untouched
    const blob = await decoded.encode(sent, file.type).catch(() => null)
    if (!blob || blob.size === 0 || blob.size >= file.size) return untouched
    return { blob, dimensions: { original, sent } }
  } finally { decoded.close() }
}

/** Whether an attachment went out smaller than it came in. */
export function wasResized(dimensions: AgentAttachmentDimensions | undefined): dimensions is AgentAttachmentDimensions {
  return dimensions !== undefined && (dimensions.original.width !== dimensions.sent.width || dimensions.original.height !== dimensions.sent.height)
}
