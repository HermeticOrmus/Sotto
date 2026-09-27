import React, { useEffect, useRef, useState, type ReactNode } from 'react'
import { Paperclip, X } from 'lucide-react'
import { AGENT_IMAGE_MIME_TYPES, AGENT_MAX_ATTACHMENT_BYTES, AGENT_MAX_ATTACHMENTS, AGENT_MAX_IMAGE_BYTES, agentAttachmentHandlesSchema, attachmentHandlesBytes,
  SCREENSHOT_TOO_LARGE, SCREENSHOT_WRONG_TYPE, SCREENSHOTS_TOO_LARGE_IN_TOTAL, type AgentAttachmentDimensions, type AgentAttachmentHandle } from '../../../shared/agents'
import { Button } from '../components/Button'
import { prepareScreenshot, wasResized } from './screenshotResize'
import { stageImage, useThumbnail } from './stagedImages'
import './screenshots.css'

// The refusals a file's own type and size decide, checked before anything is read.
function checkImage(file: File): void {
  if (!(AGENT_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) throw new Error(SCREENSHOT_WRONG_TYPE)
  if (file.size > AGENT_MAX_IMAGE_BYTES) throw new Error(SCREENSHOT_TOO_LARGE)
}

/** Scales a screenshot past the bound down in its own format (ADR-0030), then stages what is sent (ADR-0031). */
async function stageFile(target: string | null, file: File): Promise<AgentAttachmentHandle> {
  const { blob, dimensions } = await prepareScreenshot(file)
  return stageImage(target, { name: file.name || 'Screenshot.png', mimeType: file.type, blob, ...(dimensions ? { dimensions } : {}) })
}

/** "Resized from 3840 by 2160 to 2576 by 1449 pixels": sizes only, for the chip's tooltip and what a screen reader reads. */
function resizedDescription({ original, sent }: AgentAttachmentDimensions): string {
  return `Resized from ${original.width} by ${original.height} to ${sent.width} by ${sent.height} pixels`
}

/** One attached image: its thumbnail, drawn in this window, or a placeholder with its name while the thumbnail is read and when there is none. */
function Chip({ target, attachment, disabled, onRemove }: { readonly target: string | null; readonly attachment: AgentAttachmentHandle; readonly disabled: boolean; readonly onRemove: () => void }): ReactNode {
  const thumbnail = useThumbnail(target, attachment)
  return <figure>
    {thumbnail ? <img src={thumbnail} alt={attachment.name} /> : <span className="screenshot-previews__placeholder" role="img" aria-label={attachment.name} />}
    <figcaption title={attachment.name}>{attachment.name}</figcaption>
    {wasResized(attachment.dimensions) && <small className="screenshot-previews__resized" title={resizedDescription(attachment.dimensions)}>
      <span aria-hidden="true">Resized to {attachment.dimensions.sent.width} x {attachment.dimensions.sent.height}</span><span className="tt-visually-hidden">{resizedDescription(attachment.dimensions)}</span></small>}
    <button type="button" title={`Remove ${attachment.name}`} aria-label={`Remove ${attachment.name}`} disabled={disabled} onClick={onRemove}><X size={12} /></button>
  </figure>
}

/**
 * Where screenshots join a draft. Each is scaled to the screenshot bound when it is past it, then staged once, on
 * the host that runs `target` (ADR-0031), and the draft carries its handle; the chips draw their own thumbnails.
 */
export function ScreenshotInput({ target, attachments, onChange, onAddAfterClose, disabled, supported, children, onRead, pending = false, notice = null }: {
  /** The thread the draft belongs to, or null for the coordinator's composer. */
  readonly target: string | null
  readonly attachments: readonly AgentAttachmentHandle[]
  readonly onChange: (attachments: AgentAttachmentHandle[]) => void
  /**
   * Where screenshots go that finish staging after this composer has closed, as it does when the user moves to
   * another thread while they are read. It is given only the new ones, to add to the draft they were attached
   * to. Without it they are dropped.
   */
  readonly onAddAfterClose?: (images: AgentAttachmentHandle[]) => void
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
    // Every refusal that the file sizes alone can decide comes before any file is read and staged.
    try { files.forEach(checkImage) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read these screenshots.'); return }
    const total = attachmentHandlesBytes(current.current) + files.reduce((sum, file) => sum + file.size, 0)
    if (total > AGENT_MAX_ATTACHMENT_BYTES) { setError(SCREENSHOTS_TOO_LARGE_IN_TOTAL); return }
    reading.current = true; setReadingHere(true)
    const handedOn = onRead?.()
    try {
      // One at a time, so at most one decoded image is held in memory however many are added at once.
      const images: AgentAttachmentHandle[] = []
      for (const file of files) images.push(await stageFile(target, file))
      if (!mounted.current) { latestAddAfterClose.current?.(images); return }
      // The schema stays the authority: it checks what was actually staged, not what the files claimed.
      const result = agentAttachmentHandlesSchema.safeParse([...current.current, ...images])
      if (!result.success) { setError(SCREENSHOTS_TOO_LARGE_IN_TOTAL); return }
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
    {attachments.length > 0 && <div className="screenshot-previews" aria-label="Attached screenshots">{attachments.map(attachment =>
      <Chip key={attachment.id} target={target} attachment={attachment} disabled={disabled || busy}
        onRemove={() => onChange(current.current.filter(item => item.id !== attachment.id))} />)}</div>}
    <div className="screenshot-input__tools"><input ref={picker} type="file" accept={AGENT_IMAGE_MIME_TYPES.join(',')} multiple aria-label="Screenshot files" hidden onChange={event => { const files = [...(event.target.files ?? [])]; event.target.value = ''; void add(files) }} />
      <Button type="button" variant="ghost" iconOnly aria-label="Attach screenshots" disabled={disabled || busy || !supported} onClick={() => picker.current?.click()}><Paperclip size={16} /></Button>
      {busy && <small role="status">Adding screenshots...</small>}
      {(error ?? notice) && <small className="agent-error" role="alert">{error ?? notice}</small>}
    </div>
  </div>
}
