import React, { useEffect, useRef, useState, type ReactNode } from 'react'
import { Paperclip, X } from 'lucide-react'
import { AGENT_IMAGE_MIME_TYPES, AGENT_MAX_ATTACHMENT_BYTES, AGENT_MAX_ATTACHMENTS, AGENT_MAX_IMAGE_BYTES, agentAttachmentsSchema, attachmentSizeBytes, type AgentAttachment, type AgentAttachmentDimensions } from '../../../shared/agents'
import { Button } from '../components/Button'
import { readScreenshot, wasResized } from './screenshotResize'
import './screenshots.css'

// The refusals a file's own type and size decide, checked before anything is read.
const NOT_A_SCREENSHOT = 'Choose PNG, JPEG, GIF, or WebP screenshots.'
const TOO_LARGE = 'Each screenshot must be 10 MB or smaller.'
const TOO_LARGE_IN_TOTAL = 'Screenshots must total 20 MB or less. Remove an image or choose smaller files.'

function checkImage(file: File): void {
  if (!(AGENT_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) throw new Error(NOT_A_SCREENSHOT)
  if (file.size > AGENT_MAX_IMAGE_BYTES) throw new Error(TOO_LARGE)
}

async function readImage(file: File): Promise<AgentAttachment> {
  const { dataUrl, dimensions } = await readScreenshot(file)
  return { id: crypto.randomUUID(), name: file.name || 'Screenshot.png', mimeType: file.type as AgentAttachment['mimeType'], dataUrl, ...(dimensions ? { dimensions } : {}) }
}

/** "Resized from 3840 by 2160 to 2576 by 1449 pixels": sizes only, for the chip's tooltip and accessible name. */
function resizedDescription({ original, sent }: AgentAttachmentDimensions): string {
  return `Resized from ${original.width} by ${original.height} to ${sent.width} by ${sent.height} pixels`
}

export function ScreenshotInput({ attachments, onChange, onAddAfterClose, disabled, supported, children, onRead, pending = false, notice = null }: {
  readonly attachments: AgentAttachment[]
  readonly onChange: (attachments: AgentAttachment[]) => void
  /**
   * Where screenshots go that finish reading after this composer has closed, as it does when the user moves to
   * another thread while they are read. It is given only the new ones, to add to the draft they were attached
   * to. Without it they are dropped.
   */
  readonly onAddAfterClose?: (images: AgentAttachment[]) => void
  readonly disabled: boolean
  readonly supported: boolean
  readonly children: ReactNode
  /**
   * Called as screenshots start being read. It returns what to call once they have been handed on, which
   * happens after this input has closed when the user moved on meanwhile.
   */
  readonly onRead?: () => () => void
  /** Screenshots an earlier input started reading for this draft are still being read, so nothing more is added yet. */
  readonly pending?: boolean
  /** What became of screenshots read after an earlier input closed, shown until the user adds more. */
  readonly notice?: string | null
}): ReactNode {
  const picker = useRef<HTMLInputElement>(null)
  const current = useRef(attachments)
  current.current = attachments
  const latestChange = useRef(onChange)
  latestChange.current = onChange
  const latestAddAfterClose = useRef(onAddAfterClose)
  latestAddAfterClose.current = onAddAfterClose
  const reading = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [readingHere, setReadingHere] = useState(false)
  const busy = readingHere || pending
  const [error, setError] = useState<string | null>(null)
  const add = async (files: File[]): Promise<void> => {
    if (disabled || reading.current || pending) return
    if (!supported) { setError('This model does not support screenshots. Choose a model with image support.'); return }
    setError(null)
    if (files.length + current.current.length > AGENT_MAX_ATTACHMENTS) { setError(`Attach up to ${AGENT_MAX_ATTACHMENTS} screenshots at a time.`); return }
    // Every refusal that the file sizes alone can decide comes before any file is read and encoded.
    try { files.forEach(checkImage) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read these screenshots.'); return }
    const total = current.current.reduce((sum, item) => sum + attachmentSizeBytes(item.dataUrl), 0) + files.reduce((sum, file) => sum + file.size, 0)
    if (total > AGENT_MAX_ATTACHMENT_BYTES) { setError(TOO_LARGE_IN_TOTAL); return }
    reading.current = true; setReadingHere(true)
    const handedOn = onRead?.()
    try {
      // One at a time, so at most one decoded image is held in memory however many are added at once.
      const images: AgentAttachment[] = []
      for (const file of files) images.push(await readImage(file))
      if (!mounted.current) { latestAddAfterClose.current?.(images); return }
      // The schema stays the authority: it checks what was actually read, not what the files claimed.
      const result = agentAttachmentsSchema.safeParse([...current.current, ...images])
      if (!result.success) { setError(TOO_LARGE_IN_TOTAL); return }
      latestChange.current(result.data)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read these screenshots.') }
    finally {
      handedOn?.()
      if (mounted.current) { reading.current = false; setReadingHere(false) }
    }
  }
  return <div className="screenshot-input" onPaste={event => {
    const files = [...event.clipboardData.items].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => file !== null)
    if (files.length) { event.preventDefault(); void add(files) }
  }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }} onDrop={event => {
    if (event.dataTransfer.files.length) { event.preventDefault(); void add([...event.dataTransfer.files]) }
  }}>
    {children}
    {attachments.length > 0 && <div className="screenshot-previews" aria-label="Attached screenshots">{attachments.map(attachment => <figure key={attachment.id}>
      <img src={attachment.dataUrl} alt={attachment.name} /><figcaption title={attachment.name}>{attachment.name}</figcaption>
      {wasResized(attachment.dimensions) && <small className="screenshot-previews__resized" title={resizedDescription(attachment.dimensions)}>
        <span aria-hidden="true">Resized</span><span className="tt-visually-hidden">{resizedDescription(attachment.dimensions)}</span></small>}
      <button type="button" title={`Remove ${attachment.name}`} aria-label={`Remove ${attachment.name}`} disabled={disabled || busy} onClick={() => onChange(current.current.filter(item => item.id !== attachment.id))}><X size={12} /></button>
    </figure>)}</div>}
    <div className="screenshot-input__tools"><input ref={picker} type="file" accept={AGENT_IMAGE_MIME_TYPES.join(',')} multiple aria-label="Screenshot files" hidden onChange={event => { const files = [...(event.target.files ?? [])]; event.target.value = ''; void add(files) }} />
      <Button type="button" variant="ghost" iconOnly aria-label="Attach screenshots" disabled={disabled || busy || !supported} onClick={() => picker.current?.click()}><Paperclip size={16} /></Button>
      {busy && <small role="status">Adding screenshots...</small>}
      {(error ?? notice) && <small className="agent-error" role="alert">{error ?? notice}</small>}
    </div>
  </div>
}
