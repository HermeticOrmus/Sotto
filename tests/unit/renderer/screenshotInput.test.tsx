import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_MAX_ATTACHMENT_BYTES, type AgentAttachmentHandle, type AgentAttachmentStageRequest } from '../../../src/shared/agents'
import { ScreenshotInput } from '../../../src/renderer/src/agents/ScreenshotInput'
import { handleOf } from '../../fixtures/stagedImages'

/** Every staging the window asks main for, answered with the handle main would give. */
let staged: AgentAttachmentStageRequest[] = []
beforeEach(() => {
  staged = []
  vi.stubGlobal('sotto', { agents: { stageAttachment: vi.fn(async (request: AgentAttachmentStageRequest) => {
    staged.push(request); return handleOf(request.bytes, crypto.randomUUID(), request.name)
  }) } })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function Harness({ supported = true }: { supported?: boolean }) {
  const [images, setImages] = useState<AgentAttachmentHandle[]>([])
  return <ScreenshotInput target="workshop" attachments={images} onChange={setImages} disabled={false} supported={supported}><textarea aria-label="Prompt" /></ScreenshotInput>
}
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const file = () => new File([new Uint8Array(PNG_SIGNATURE)], 'shot.png', { type: 'image/png' })
const MB = 1024 * 1024
/** A small PNG that reports `size` bytes, so a test can cross the limits without allocating them. */
const sized = (name: string, size: number) => Object.defineProperty(new File([new Uint8Array(PNG_SIGNATURE)], name, { type: 'image/png' }), 'size', { value: size })
/** An attachment already on the composer whose content is `bytes` long. */
const attached = (id: string, bytes: number): AgentAttachmentHandle => ({ id, name: `${id}.png`, mimeType: 'image/png', sizeBytes: bytes, digest: 'a'.repeat(64) })

describe('screenshot attachment input', () => {
  it('stages a screenshot once, for the thread it is attached to, and allows removal before delivery', async () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Screenshot files'), { target: { files: [file()] } })
    // The chip names the image while its thumbnail is made, and keeps the name once it shows.
    await waitFor(() => expect(screen.getByRole('img', { name: 'shot.png' })).toBeVisible())
    expect(staged).toEqual([expect.objectContaining({ threadId: 'workshop', name: 'shot.png', mimeType: 'image/png', bytes: new Uint8Array(PNG_SIGNATURE) })])
    fireEvent.click(screen.getByRole('button', { name: 'Remove shot.png' }))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
  it('accepts pasted screenshot files without inserting clipboard text', async () => {
    render(<Harness />)
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { items: [{ kind: 'file', getAsFile: file }] } })
    await waitFor(() => expect(screen.getByRole('img', { name: 'shot.png' })).toBeVisible())
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
    expect(staged).toEqual([])
  })
  it('says so when main refuses to stage an image, and attaches nothing', async () => {
    vi.stubGlobal('sotto', { agents: { stageAttachment: vi.fn(async () => { throw new Error('The image content does not match its file type.') }) } })
    const change = vi.fn()
    render(<ScreenshotInput target="workshop" attachments={[]} onChange={change} disabled={false} supported><textarea aria-label="Prompt" /></ScreenshotInput>)
    fireEvent.change(screen.getByLabelText('Screenshot files'), { target: { files: [file()] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('The image content does not match its file type.')
    expect(change).not.toHaveBeenCalled()
  })
  it('refuses dropped screenshots that total more than 20 MB before staging any of them', () => {
    const change = vi.fn()
    const reading = vi.fn()
    render(<ScreenshotInput target="workshop" attachments={[]} onChange={change} onReadingChange={reading} disabled={false} supported><textarea aria-label="Prompt" /></ScreenshotInput>)
    fireEvent.drop(screen.getByRole('textbox'), { dataTransfer: { files: [sized('a.png', 8 * MB), sized('b.png', 8 * MB), sized('c.png', 8 * MB)], types: ['Files'] } })
    expect(screen.getByRole('alert')).toHaveTextContent('Screenshots must total 20 MB or less. Remove an image or choose smaller files.')
    expect(staged).toEqual([])
    expect(reading).not.toHaveBeenCalledWith(true)
    expect(change).not.toHaveBeenCalled()
  })
  it('counts the screenshots already attached toward the 20 MB total', () => {
    const change = vi.fn()
    render(<ScreenshotInput target="workshop" attachments={[attached('kept-a', 9 * MB), attached('kept-b', 9 * MB)]} onChange={change} disabled={false} supported><textarea aria-label="Prompt" /></ScreenshotInput>)
    fireEvent.drop(screen.getByRole('textbox'), { dataTransfer: { files: [sized('c.png', 3 * MB)], types: ['Files'] } })
    expect(screen.getByRole('alert')).toHaveTextContent('must total 20 MB or less')
    expect(staged).toEqual([])
    expect(change).not.toHaveBeenCalled()
  })
  it('still stages screenshots that total exactly 20 MB', async () => {
    const change = vi.fn()
    render(<ScreenshotInput target="workshop" attachments={[]} onChange={change} disabled={false} supported><textarea aria-label="Prompt" /></ScreenshotInput>)
    fireEvent.drop(screen.getByRole('textbox'), { dataTransfer: { files: [sized('a.png', AGENT_MAX_ATTACHMENT_BYTES / 2), sized('b.png', AGENT_MAX_ATTACHMENT_BYTES / 2)], types: ['Files'] } })
    await waitFor(() => expect(change).toHaveBeenCalledWith([expect.objectContaining({ name: 'a.png' }), expect.objectContaining({ name: 'b.png' })]))
    expect(staged).toHaveLength(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('names the oversized screenshot rather than the total when one file is over 10 MB', () => {
    render(<Harness />)
    fireEvent.drop(screen.getByRole('textbox'), { dataTransfer: { files: [sized('huge.png', 25 * MB)], types: ['Files'] } })
    expect(screen.getByRole('alert')).toHaveTextContent('Each screenshot must be 10 MB or smaller.')
    expect(staged).toEqual([])
  })
  it('does not attach an in-flight staging to a thread after the input unmounts', async () => {
    const change = vi.fn()
    const reading = vi.fn()
    const view = render(<ScreenshotInput target="workshop" attachments={[]} onChange={change} onReadingChange={reading} disabled={false} supported><textarea /></ScreenshotInput>)
    fireEvent.change(screen.getByLabelText('Screenshot files'), { target: { files: [file()] } })
    view.unmount()
    await waitFor(() => expect(reading).toHaveBeenLastCalledWith(false))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(change).not.toHaveBeenCalled()
  })
})
