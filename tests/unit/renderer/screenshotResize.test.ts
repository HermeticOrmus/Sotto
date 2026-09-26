import { describe, expect, it, vi } from 'vitest'
import { fitLongEdge, prepareScreenshot, SCREENSHOT_MAX_LONG_EDGE, wasResized, type ImageSize, type ScreenshotDecoder } from '../../../src/renderer/src/agents/screenshotResize'

/** A decoder that reports `size` and writes a blob of `encodedBytes` bytes in whatever type it is asked for. */
function fakeDecoder(size: ImageSize, encodedBytes = 10) {
  const encode = vi.fn(async (_size: ImageSize, mimeType: string) => new Blob([new Uint8Array(encodedBytes)], { type: mimeType }))
  const close = vi.fn()
  const decode: ScreenshotDecoder = async () => ({ size, encode, close })
  return { decode, encode, close }
}
const file = (type: string, bytes = 1000) => new File([new Uint8Array(bytes)], 'shot', { type })

describe('the screenshot bound', () => {
  it('is Claude 4.7 and later models\' long edge, the most any model Sotto sends screenshots to reads', () => {
    expect(SCREENSHOT_MAX_LONG_EDGE).toBe(2576)
  })
  it('scales a 3840x2160 capture to the bound with its aspect ratio kept', () => {
    // Claude's own documentation lists 3840x2160 as becoming 2576x1449 on its high-resolution tier.
    expect(fitLongEdge({ width: 3840, height: 2160 })).toEqual({ width: 2576, height: 1449 })
    expect(fitLongEdge({ width: 2160, height: 3840 })).toEqual({ width: 1449, height: 2576 })
  })
  it('leaves an image at or under the bound as it is and never scales up', () => {
    const small = { width: 1200, height: 800 }
    expect(fitLongEdge(small)).toBe(small)
    const exact = { width: 2576, height: 100 }
    expect(fitLongEdge(exact)).toBe(exact)
  })
  it('keeps a very thin image at least one pixel across', () => {
    expect(fitLongEdge({ width: 60_000, height: 2 })).toEqual({ width: 2576, height: 1 })
  })
})

describe('preparing a screenshot to hand on', () => {
  it('scales a 3840x2160 PNG down to the bound as a PNG and records both sizes', async () => {
    const { decode, encode, close } = fakeDecoder({ width: 3840, height: 2160 })
    const prepared = await prepareScreenshot(file('image/png'), decode)
    expect(encode).toHaveBeenCalledWith({ width: 2576, height: 1449 }, 'image/png')
    expect(prepared.blob.type).toBe('image/png')
    expect(prepared.dimensions).toEqual({ original: { width: 3840, height: 2160 }, sent: { width: 2576, height: 1449 } })
    expect(wasResized(prepared.dimensions)).toBe(true)
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('hands a 1200x800 PNG on untouched', async () => {
    const original = file('image/png')
    const { decode, encode, close } = fakeDecoder({ width: 1200, height: 800 })
    const prepared = await prepareScreenshot(original, decode)
    expect(prepared.blob).toBe(original)
    expect(encode).not.toHaveBeenCalled()
    expect(prepared.dimensions).toEqual({ original: { width: 1200, height: 800 }, sent: { width: 1200, height: 800 } })
    expect(wasResized(prepared.dimensions)).toBe(false)
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('keeps a JPEG a JPEG, and a WebP a WebP', async () => {
    for (const type of ['image/jpeg', 'image/webp']) {
      const { decode, encode } = fakeDecoder({ width: 5120, height: 2880 })
      const prepared = await prepareScreenshot(file(type), decode)
      expect(encode).toHaveBeenCalledWith({ width: 2576, height: 1449 }, type)
      expect(prepared.blob.type).toBe(type)
    }
  })
  it('leaves a GIF as it is, since a canvas cannot write one', async () => {
    const original = file('image/gif')
    const { decode, encode } = fakeDecoder({ width: 3840, height: 2160 })
    const prepared = await prepareScreenshot(original, decode)
    expect(prepared.blob).toBe(original)
    expect(encode).not.toHaveBeenCalled()
    expect(wasResized(prepared.dimensions)).toBe(false)
  })
  it('sends the original when the scaled copy would not be smaller', async () => {
    const original = file('image/jpeg', 1000)
    const { decode } = fakeDecoder({ width: 3840, height: 2160 }, 1000)
    const prepared = await prepareScreenshot(original, decode)
    expect(prepared.blob).toBe(original)
    expect(prepared.dimensions).toEqual({ original: { width: 3840, height: 2160 }, sent: { width: 3840, height: 2160 } })
  })
  it('sends the original when the copy cannot be written in the same format', async () => {
    const original = file('image/webp')
    const close = vi.fn()
    const decode: ScreenshotDecoder = async () => ({ size: { width: 3840, height: 2160 }, encode: async () => null, close })
    expect((await prepareScreenshot(original, decode)).blob).toBe(original)
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('sends the file as before, with no sizes, when it cannot be decoded here', async () => {
    const original = file('image/png')
    expect(await prepareScreenshot(original, async () => null)).toEqual({ blob: original })
    expect(await prepareScreenshot(original, async () => { throw new Error('not an image') })).toEqual({ blob: original })
  })
})
