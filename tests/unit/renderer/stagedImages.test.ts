import { afterEach, describe, expect, it, vi } from 'vitest'
import { SCREENSHOT_NOT_ITS_TYPE, SCREENSHOT_TOO_LARGE } from '../../../src/shared/agents'
import { STAGING_FAILED, stagingError } from '../../../src/renderer/src/agents/stagedImages'

describe('a failed staging, as the composer words it', () => {
  it('drops the channel Electron prefixes to whatever main threw', () => {
    expect(stagingError(new Error(`Error invoking remote method 'sotto:agents:stage-attachment': Error: ${SCREENSHOT_TOO_LARGE}`)))
      .toBe(SCREENSHOT_TOO_LARGE)
    expect(stagingError(new Error(SCREENSHOT_NOT_ITS_TYPE))).toBe(SCREENSHOT_NOT_ITS_TYPE)
  })
  it('gives a plain sentence for a refusal that has none of its own', () => {
    const plain = STAGING_FAILED
    expect(stagingError(new Error("Error invoking remote method 'sotto:agents:stage-attachment': Error: AGENT_SENDER_REJECTED"))).toBe(plain)
    expect(stagingError(new Error('[{"code":"invalid_type","path":["bytes"]}]'))).toBe(plain)
    expect(stagingError(new Error("Error invoking remote method 'sotto:agents:stage-attachment': ZodError: [{\"code\":\"too_big\"}]"))).toBe(plain)
    expect(stagingError('not an error')).toBe(plain)
  })
})

describe('the thumbnails a window keeps for its chips', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
  /** The window's cache starts empty, and every read of an image's bytes is counted. Here the canvas draws nothing, so each image is kept as it is. */
  async function withContent(sizeOf: (digest: string) => number) {
    vi.resetModules()
    const attachmentContent = vi.fn(async ({ digest }: { digest: string }) => ({ mimeType: 'image/png' as const, bytes: new Uint8Array(sizeOf(digest)) }))
    vi.stubGlobal('sotto', { agents: { attachmentContent } })
    const { thumbnailFor } = await import('../../../src/renderer/src/agents/stagedImages')
    const show = async (digest: string) => { await thumbnailFor(null, { digest }) }
    return { attachmentContent, show, reads: (digest: string) => attachmentContent.mock.calls.filter(([request]) => request.digest === digest).length }
  }
  it('keeps the most recently used, so a chip shown again moves to the end', async () => {
    const { show, reads } = await withContent(() => 100)
    await show('a'); await show('b'); await show('a')
    for (let index = 0; index < 63; index += 1) await show(`more-${index}`)
    // 65 were shown and 64 are kept: the one shown least recently goes, not the one first shown.
    await show('a'); await show('b')
    expect(reads('a')).toBe(1); expect(reads('b')).toBe(2)
  })
  it('bounds the bytes it keeps, which images kept as they are would otherwise fill', async () => {
    const { show, reads } = await withContent(() => 1024 * 1024)
    for (const digest of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) await show(digest)
    // Each is a data URL of about 1.4 million characters, and the cache keeps 8 MiB of them.
    await show('g'); await show('a')
    expect(reads('g')).toBe(1); expect(reads('a')).toBe(2)
  })
})
