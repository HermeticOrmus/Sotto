import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_MAX_ATTACHMENT_BYTES, type AgentAttachment } from '../../../src/shared/agents'
import { ScreenshotInput } from '../../../src/renderer/src/agents/ScreenshotInput'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function Harness({ supported = true }: { supported?: boolean }) {
  const [images, setImages] = useState<AgentAttachment[]>([])
  return <ScreenshotInput attachments={images} onChange={setImages} disabled={false} supported={supported}><textarea aria-label="Prompt" /></ScreenshotInput>
}
const file = () => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'shot.png', { type: 'image/png' })
const MB = 1024 * 1024
/** A small PNG that reports `size` bytes, so a test can cross the limits without allocating them. */
const sized = (name: string, size: number) => Object.defineProperty(new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' }), 'size', { value: size })
/** An attachment already on the composer that decodes to `bytes` bytes. */
const attached = (id: string, bytes: number): AgentAttachment => ({ id, name: `${id}.png`, mimeType: 'image/png', dataUrl: `data:image/png;base64,${'A'.repeat(bytes / 3 * 4)}` })
/** Counts every FileReader constructed while the test runs. */
function countReaders(): { count: number } {
  const readers = { count: 0 }
  const Original = globalThis.FileReader
  vi.stubGlobal('FileReader', class extends Original { constructor() { super(); readers.count += 1 } })
  return readers
}
describe('screenshot attachment input', () => {
  it('reads a screenshot and allows removal before delivery', async () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Screenshot files'), { target: { files: [file()] } })
    expect(await screen.findByRole('img', { name: 'shot.png' })).toHaveAttribute('src', expect.stringContaining('data:image/png;base64,'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove shot.png' }))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
  it('accepts pasted screenshot files without inserting clipboard text', async () => {
    render(<Harness />)
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { items: [{ kind: 'file', getAsFile: file }] } })
    expect(await screen.findByRole('img', { name: 'shot.png' })).toBeVisible()
    expect(screen.getByRole('textbox')).toHaveValue('')
  })
  it('rejects unsupported files and models with useful feedback', async () => {
    const view = render(<Harness />)
    fireEvent.change(screen.getByLabelText('Screenshot files'), { target: { files: [new File(['text'], 'note.txt', { type: 'text/plain' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('PNG, JPEG, GIF, or WebP')
    view.rerender(<Harness supported={false} />)
    expect(screen.getByRole('button', { name: 'Attach screenshots' })).toBeDisabled()
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { items: [{ kind: 'file', getAsFile: file }] } })
    expect(screen.getByRole('alert')).toHaveTextContent('does not support screenshots')
  })
  it('refuses dropped screenshots that total more than 20 MB before reading any of them', () => {
    const readers = countReaders()
    const change = vi.fn()
    const read = vi.fn(() => () => undefined)
    render(<ScreenshotInput attachments={[]} onChange={change} onRead={read} disabled={false} supported><textarea aria-label="Prompt" /></ScreenshotInput>)
    fireEvent.drop(screen.getByRole('textbox'), { dataTransfer: { files: [sized('a.png', 8 * MB), sized('b.png', 8 * MB), sized('c.png', 8 * MB)], types: ['Files'] } })
    expect(screen.getByRole('alert')).toHaveTextContent('Screenshots must total 20 MB or less. Remove an image or choose smaller files.')
    expect(readers.count).toBe(0)
    expect(read).not.toHaveBeenCalled()
    expect(change).not.toHaveBeenCalled()
  })
  it('counts the screenshots already attached toward the 20 MB total', () => {
    const readers = countReaders()
    const change = vi.fn()
    render(<ScreenshotInput attachments={[attached('kept-a', 9 * MB), attached('kept-b', 9 * MB)]} onChange={change} disabled={false} supported><textarea aria-label="Prompt" /></ScreenshotInput>)
    fireEvent.drop(screen.getByRole('textbox'), { dataTransfer: { files: [sized('c.png', 3 * MB)], types: ['Files'] } })
    expect(screen.getByRole('alert')).toHaveTextContent('must total 20 MB or less')
    expect(readers.count).toBe(0)
    expect(change).not.toHaveBeenCalled()
  })
  it('still reads screenshots that total exactly 20 MB', async () => {
    const readers = countReaders()
    const change = vi.fn()
    render(<ScreenshotInput attachments={[]} onChange={change} disabled={false} supported><textarea aria-label="Prompt" /></ScreenshotInput>)
    fireEvent.drop(screen.getByRole('textbox'), { dataTransfer: { files: [sized('a.png', AGENT_MAX_ATTACHMENT_BYTES / 2), sized('b.png', AGENT_MAX_ATTACHMENT_BYTES / 2)], types: ['Files'] } })
    await waitFor(() => expect(change).toHaveBeenCalledWith([expect.objectContaining({ name: 'a.png' }), expect.objectContaining({ name: 'b.png' })]))
    expect(readers.count).toBe(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('names the oversized screenshot rather than the total when one file is over 10 MB', () => {
    const readers = countReaders()
    render(<Harness />)
    fireEvent.drop(screen.getByRole('textbox'), { dataTransfer: { files: [sized('huge.png', 25 * MB)], types: ['Files'] } })
    expect(screen.getByRole('alert')).toHaveTextContent('Each screenshot must be 10 MB or smaller.')
    expect(readers.count).toBe(0)
  })
  it('does not attach an in-flight file read to a thread after the input unmounts', async () => {
    const change = vi.fn()
    const handedOn = vi.fn()
    const view = render(<ScreenshotInput attachments={[]} onChange={change} onRead={() => handedOn} disabled={false} supported><textarea /></ScreenshotInput>)
    fireEvent.change(screen.getByLabelText('Screenshot files'), { target: { files: [file()] } })
    view.unmount()
    // The read is over only once its screenshots have been handed on, or dropped for want of a draft to take them.
    await waitFor(() => expect(handedOn).toHaveBeenCalledOnce())
    expect(change).not.toHaveBeenCalled()
  })
  it('adds nothing and says it is still adding while an earlier input reads for the same draft', () => {
    const read = vi.fn(() => () => undefined)
    render(<ScreenshotInput attachments={[]} onChange={vi.fn()} onRead={read} pending disabled={false} supported><textarea aria-label="Prompt" /></ScreenshotInput>)
    expect(screen.getByRole('status')).toHaveTextContent('Adding screenshots...')
    expect(screen.getByRole('button', { name: 'Attach screenshots' })).toBeDisabled()
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { items: [{ kind: 'file', getAsFile: file }] } })
    expect(read).not.toHaveBeenCalled()
  })
  it('shows what became of screenshots an earlier input read', () => {
    render(<ScreenshotInput attachments={[]} onChange={vi.fn()} notice="A screenshot did not fit." disabled={false} supported><textarea aria-label="Prompt" /></ScreenshotInput>)
    expect(screen.getByRole('alert')).toHaveTextContent('A screenshot did not fit.')
  })
})

/**
 * Chromium's decoder and offscreen canvas, as far as the composer uses them: each file decodes to the size
 * `sizes` gives its name, and a canvas writes a short blob of whatever type it is asked for.
 */
function stubCanvas(sizes: Record<string, { width: number, height: number }>) {
  const drawn: { width: number, height: number, type: string }[] = []
  vi.stubGlobal('createImageBitmap', async (source: File) => ({ ...sizes[source.name]!, close: () => undefined }))
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(readonly width: number, readonly height: number) {}
    getContext() { return { drawImage: () => undefined } }
    async convertToBlob({ type }: { type: string }) { drawn.push({ width: this.width, height: this.height, type }); return new Blob([new Uint8Array(12)], { type }) }
  })
  return drawn
}
const screenshotOf = (name: string, type: string) => new File([new Uint8Array(4096)], name, { type })
const decodedBytes = (dataUrl: string) => atob(dataUrl.slice(dataUrl.indexOf(',') + 1)).length
async function attach(name: string, type: string): Promise<{ attachment: AgentAttachment, change: ReturnType<typeof vi.fn>, rerender: (attachments: AgentAttachment[]) => void }> {
  const change = vi.fn()
  const input = (attachments: AgentAttachment[]) => <ScreenshotInput attachments={attachments} onChange={change} disabled={false} supported><textarea aria-label="Prompt" /></ScreenshotInput>
  const view = render(input([]))
  fireEvent.change(screen.getByLabelText('Screenshot files'), { target: { files: [screenshotOf(name, type)] } })
  await waitFor(() => expect(change).toHaveBeenCalledTimes(1))
  const [attachment] = change.mock.calls[0]![0] as AgentAttachment[]
  return { attachment: attachment!, change, rerender: attachments => view.rerender(input(attachments)) }
}

describe('scaling screenshots down to the bound', () => {
  it('scales a 3840x2160 PNG to 2576x1449, keeps it a PNG and says so on its chip', async () => {
    const drawn = stubCanvas({ '4k.png': { width: 3840, height: 2160 } })
    const { attachment, rerender } = await attach('4k.png', 'image/png')
    expect(drawn).toEqual([{ width: 2576, height: 1449, type: 'image/png' }])
    expect(attachment).toMatchObject({ name: '4k.png', mimeType: 'image/png', dimensions: { original: { width: 3840, height: 2160 }, sent: { width: 2576, height: 1449 } } })
    expect(attachment.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(decodedBytes(attachment.dataUrl)).toBe(12)
    rerender([attachment])
    // The sent size is on the chip itself, where a keyboard user sees it too; the tooltip adds the size before.
    expect(screen.getByText('Resized to 2576 x 1449', { exact: true })).toBeVisible()
    expect(screen.getByText('Resized to 2576 x 1449', { exact: true }).parentElement).toHaveAttribute('title', 'Resized from 3840 by 2160 to 2576 by 1449 pixels')
    expect(screen.getByText('Resized from 3840 by 2160 to 2576 by 1449 pixels')).toHaveClass('tt-visually-hidden')
  })
  it('hands a 1200x800 PNG on byte for byte and shows no note', async () => {
    const drawn = stubCanvas({ 'small.png': { width: 1200, height: 800 } })
    const { attachment, rerender } = await attach('small.png', 'image/png')
    expect(drawn).toEqual([])
    expect(decodedBytes(attachment.dataUrl)).toBe(4096)
    expect(attachment.dimensions).toEqual({ original: { width: 1200, height: 800 }, sent: { width: 1200, height: 800 } })
    rerender([attachment])
    expect(screen.getByRole('img', { name: 'small.png' })).toBeVisible()
    expect(screen.queryByText(/^Resized/u)).not.toBeInTheDocument()
  })
  it('keeps a JPEG a JPEG', async () => {
    const drawn = stubCanvas({ 'photo.jpg': { width: 4032, height: 3024 } })
    const { attachment } = await attach('photo.jpg', 'image/jpeg')
    expect(drawn).toEqual([{ width: 2576, height: 1932, type: 'image/jpeg' }])
    expect(attachment).toMatchObject({ mimeType: 'image/jpeg', dimensions: { sent: { width: 2576, height: 1932 } } })
    expect(attachment.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true)
  })
})

describe('reading several screenshots at once', () => {
  it('decodes one at a time, so at most one decoded image is in memory', async () => {
    let alive = 0, most = 0
    // Each decode waits until the test lets it finish, so a second one started meanwhile would be seen.
    const decodes: (() => void)[] = []
    vi.stubGlobal('createImageBitmap', async () => {
      alive += 1; most = Math.max(most, alive)
      await new Promise<void>(resolve => { decodes.push(resolve) })
      return { width: 3840, height: 2160, close: () => { alive -= 1 } }
    })
    vi.stubGlobal('OffscreenCanvas', class {
      constructor(readonly width: number, readonly height: number) {}
      getContext() { return { drawImage: () => undefined } }
      async convertToBlob({ type }: { type: string }) { return new Blob([new Uint8Array(12)], { type }) }
    })
    const change = vi.fn()
    render(<ScreenshotInput attachments={[]} onChange={change} disabled={false} supported><textarea aria-label="Prompt" /></ScreenshotInput>)
    const files = ['a', 'b', 'c', 'd'].map(name => screenshotOf(`${name}.png`, 'image/png'))
    fireEvent.change(screen.getByLabelText('Screenshot files'), { target: { files } })
    for (let finished = 0; finished < files.length; finished += 1) {
      await waitFor(() => expect(decodes).toHaveLength(finished + 1))
      // Every decode started so far is still held, and only one has started.
      expect(alive).toBe(1)
      decodes[finished]!()
    }
    await waitFor(() => expect(change).toHaveBeenCalledTimes(1))
    expect((change.mock.calls[0]![0] as AgentAttachment[]).map(image => image.name)).toEqual(['a.png', 'b.png', 'c.png', 'd.png'])
    expect(most).toBe(1)
    expect(alive).toBe(0)
  })
  it('hands screenshots that finish reading after the composer closes to the draft they were attached to', async () => {
    const change = vi.fn()
    const late = vi.fn()
    const view = render(<ScreenshotInput attachments={[]} onChange={change} onAddAfterClose={late} disabled={false} supported><textarea /></ScreenshotInput>)
    fireEvent.change(screen.getByLabelText('Screenshot files'), { target: { files: [file()] } })
    view.unmount()
    await waitFor(() => expect(late).toHaveBeenCalledWith([expect.objectContaining({ name: 'shot.png', dataUrl: expect.stringContaining('data:image/png;base64,') })]))
    expect(change).not.toHaveBeenCalled()
  })
})
