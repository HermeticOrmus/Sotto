import { agentImageSizeSchema, type AgentAttachmentDimensions, type AgentImageSize } from '../../../shared/agents'

/**
 * The longest edge, in pixels, that any model Sotto sends a screenshot to reads. Claude 4.7 and later
 * downscale anything longer than 2576 px before the model sees it; Codex scales a pasted image to fit
 * 2048 px itself before its request leaves the computer; Grok Build takes no screenshots through its
 * client. Pixels past this bound cost transfer, framing, storage and memory and change nothing a model
 * reads, so the composer scales a larger screenshot down to it. ADR-0030 records the decision and what
 * would raise it; the sources are in `docs/perf/2026-09-26-screenshot-resize.md`.
 */
export const SCREENSHOT_MAX_LONG_EDGE = 2576

/** JPEG and WebP are written at the quality Chromium uses when none is given. */
const LOSSY_QUALITY = 0.92
/** The formats a canvas can write back as themselves. A GIF is left as it is, since a canvas cannot write one. */
const RESIZABLE = new Set(['image/png', 'image/jpeg', 'image/webp'])
/**
 * How much of a file is read to find its size without decoding it. A PNG, GIF or WebP names its size in its
 * first 30 bytes; a JPEG names it after its metadata segments, which a camera or an editor can make large.
 */
const HEADER_BYTES = 256 * 1024
/**
 * The most pixels one image is decoded at, which is also the largest canvas Chromium draws (16384 x 16384). Decoding
 * takes four bytes a pixel, so an image past this would hold more than a gigabyte in the renderer; it goes as attached.
 */
export const SCREENSHOT_MAX_DECODE_PIXELS = 16384 * 16384

/** `size` scaled down so its longer edge is `bound`, with its aspect ratio kept, or `size` itself when it already fits. */
export function fitLongEdge(size: AgentImageSize, bound = SCREENSHOT_MAX_LONG_EDGE): AgentImageSize {
  const long = Math.max(size.width, size.height)
  if (long <= bound) return size
  const scale = bound / long
  return size.width >= size.height
    ? { width: bound, height: Math.max(1, Math.round(size.height * scale)) }
    : { width: Math.max(1, Math.round(size.width * scale)), height: bound }
}

const sameSize = (a: AgentImageSize, b: AgentImageSize): boolean => a.width === b.width && a.height === b.height

/** What a file's first bytes say about it, before anything is decoded. */
export interface ImageHeader {
  /** The size the image is shown at: a JPEG turned by its EXIF orientation has its sides swapped, as the decoder does. */
  readonly size: AgentImageSize
  /**
   * An animated PNG or WebP, or a PNG that may be one because its first bytes end before its image data
   * begins. Scaling one down would keep only its first frame, so it is never scaled.
   */
  readonly animated: boolean
}

const ascii = (bytes: Uint8Array, at: number, length: number): string => String.fromCharCode(...bytes.subarray(at, at + length))
const view = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

function pngHeader(bytes: Uint8Array): ImageHeader | null {
  if (bytes.length < 24 || ascii(bytes, 1, 3) !== 'PNG' || ascii(bytes, 12, 4) !== 'IHDR') return null
  const data = view(bytes)
  const size = { width: data.getUint32(16), height: data.getUint32(20) }
  // An animated PNG names its animation (acTL) before its first image data (IDAT).
  for (let at = 8; at + 8 <= bytes.length; at += 12 + data.getUint32(at)) {
    const type = ascii(bytes, at + 4, 4)
    if (type === 'acTL') return { size, animated: true }
    if (type === 'IDAT') return { size, animated: false }
  }
  // A large metadata chunk (a colour profile, text or EXIF) pushed the image data past the bytes read, so
  // whether an animation chunk comes first is unknown. It is treated as animated and goes as attached.
  return { size, animated: true }
}

/** The EXIF orientation (1 to 8) in the APP1 segment between `start` and `end`, or null when it names none. */
function exifOrientation(bytes: Uint8Array, start: number, end: number): number | null {
  if (end - start < 14 || ascii(bytes, start, 4) !== 'Exif' || bytes[start + 4] !== 0 || bytes[start + 5] !== 0) return null
  const tiff = new DataView(bytes.buffer, bytes.byteOffset + start + 6, end - start - 6)
  const order = ascii(bytes, start + 6, 2)
  if (order !== 'II' && order !== 'MM') return null
  const little = order === 'II'
  if (tiff.getUint16(2, little) !== 42) return null
  const ifd = tiff.getUint32(4, little)
  if (ifd + 2 > tiff.byteLength) return null
  const count = tiff.getUint16(ifd, little)
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12
    if (entry + 12 > tiff.byteLength) return null
    if (tiff.getUint16(entry, little) !== 0x0112) continue
    const orientation = tiff.getUint16(entry + 8, little)
    return orientation >= 1 && orientation <= 8 ? orientation : null
  }
  return null
}

function jpegHeader(bytes: Uint8Array): ImageHeader | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  const data = view(bytes)
  let orientation = 1
  let at = 2
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null
    const marker = bytes[at + 1]!
    // Fill bytes, and the markers that carry no length.
    if (marker === 0xff) { at += 1; continue }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { at += 2; continue }
    // The image ended, or its data began, before any frame header named its size.
    if (marker === 0xd9 || marker === 0xda) return null
    const length = data.getUint16(at + 2)
    if (length < 2) return null
    // SOF0 to SOF15 name the frame's size; C4, C8 and CC share the range but are other segments.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (at + 9 > bytes.length) return null
      const height = data.getUint16(at + 5), width = data.getUint16(at + 7)
      // Orientations 5 to 8 turn the image a quarter, and the decoder shows it turned.
      return { size: orientation >= 5 ? { width: height, height: width } : { width, height }, animated: false }
    }
    if (marker === 0xe1 && orientation === 1) orientation = exifOrientation(bytes, at + 4, Math.min(at + 2 + length, bytes.length)) ?? 1
    at += 2 + length
  }
  return null
}

function webpHeader(bytes: Uint8Array): ImageHeader | null {
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null
  const data = view(bytes)
  switch (ascii(bytes, 12, 4)) {
    case 'VP8 ':
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null
      return { size: { width: data.getUint16(26, true) & 0x3fff, height: data.getUint16(28, true) & 0x3fff }, animated: false }
    case 'VP8L': {
      if (bytes[20] !== 0x2f) return null
      const bits = data.getUint32(21, true)
      return { size: { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }, animated: false }
    }
    case 'VP8X': {
      const u24 = (at: number) => bytes[at]! | bytes[at + 1]! << 8 | bytes[at + 2]! << 16
      return { size: { width: u24(24) + 1, height: u24(27) + 1 }, animated: (bytes[20]! & 0x02) !== 0 }
    }
    default: return null
  }
}

function gifHeader(bytes: Uint8Array): ImageHeader | null {
  if (bytes.length < 10 || ascii(bytes, 0, 3) !== 'GIF') return null
  // A GIF is never scaled, so whether it is animated does not matter here.
  return { size: { width: view(bytes).getUint16(6, true), height: view(bytes).getUint16(8, true) }, animated: false }
}

/**
 * What an image's first bytes say about its size, read by its own signature whatever type it claims. Null when
 * they are not a PNG, JPEG, WebP or GIF, do not name a plausible size, or name it past the bytes given.
 */
export function readImageHeader(bytes: Uint8Array): ImageHeader | null {
  try {
    const header = pngHeader(bytes) ?? jpegHeader(bytes) ?? webpHeader(bytes) ?? gifHeader(bytes)
    return header && agentImageSizeSchema.safeParse(header.size).success ? header : null
  } catch { return null }
}

async function headerOf(file: Blob): Promise<ImageHeader | null> {
  return readImageHeader(new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer().catch(() => new ArrayBuffer(0))))
}

/** An image decoded once, which can be drawn again at another size. */
export interface DecodedScreenshot {
  readonly size: AgentImageSize
  /** The image drawn at `size` and written as `mimeType`, or null when that cannot be done here. */
  encode(size: AgentImageSize, mimeType: string): Promise<Blob | null>
  close(): void
}
export type ScreenshotDecoder = (file: Blob) => Promise<DecodedScreenshot | null>

/**
 * Decodes with the renderer's own image decoder and redraws on an offscreen canvas. Null where either is missing.
 * The canvas is sRGB, so a Display P3 capture's colours are converted to their nearest sRGB ones.
 */
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
  /** Absent when the image's size could not be read here, in which case the file goes as it is, as before. */
  readonly dimensions?: AgentAttachmentDimensions
}

const untouched = (file: Blob, size: AgentImageSize): PreparedScreenshot => ({ blob: file, dimensions: { original: size, sent: size } })

/**
 * The screenshot as the composer hands it on. One whose longer edge is past `bound` is scaled down to it in
 * its own format; anything else, and anything that cannot be scaled without changing its format, growing or
 * losing its animation, goes as the user attached it. Never scales up. An image whose first bytes show it
 * fits is never decoded, so only one that may need scaling pays for a decode, and one whose first bytes show it
 * too large to decode safely is not decoded either.
 */
export async function prepareScreenshot(file: Blob, decode: ScreenshotDecoder = canvasDecoder, bound = SCREENSHOT_MAX_LONG_EDGE): Promise<PreparedScreenshot> {
  const header = await headerOf(file).catch(() => null)
  if (header && (sameSize(fitLongEdge(header.size, bound), header.size) || header.animated || !RESIZABLE.has(file.type)
    || header.size.width * header.size.height > SCREENSHOT_MAX_DECODE_PIXELS)) return untouched(file, header.size)
  const decoded = await decode(file).catch(() => null)
  if (!decoded) return { blob: file }
  try {
    const original = decoded.size
    if (!agentImageSizeSchema.safeParse(original).success) return { blob: file }
    const sent = fitLongEdge(original, bound)
    if (sameSize(sent, original) || !RESIZABLE.has(file.type)) return untouched(file, original)
    const blob = await decoded.encode(sent, file.type).catch(() => null)
    if (!blob || blob.size === 0 || blob.size >= file.size) return untouched(file, original)
    return { blob, dimensions: { original, sent } }
  } finally { decoded.close() }
}

/** The bytes of a base64 data URL of `mimeType`, decoded natively where the renderer can, or null when it is not one. */
export function dataUrlBlob(dataUrl: string, mimeType: string): Blob | null {
  const prefix = `data:${mimeType};base64,`
  if (!dataUrl.startsWith(prefix)) return null
  const base64 = dataUrl.slice(prefix.length)
  try {
    // Chromium decodes base64 natively; the loop is for a runtime without it, such as an older test environment.
    const native = Uint8Array as unknown as { fromBase64?: (text: string) => Uint8Array<ArrayBuffer> }
    if (native.fromBase64) return new Blob([native.fromBase64(base64)], { type: mimeType })
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return new Blob([bytes], { type: mimeType })
  } catch { return null }
}

/** Whether an attachment went out smaller than it came in. */
export function wasResized(dimensions: AgentAttachmentDimensions | undefined): dimensions is AgentAttachmentDimensions {
  return dimensions !== undefined && !sameSize(dimensions.original, dimensions.sent)
}
