import React, { useEffect, useRef, useState, type ReactNode } from 'react'
import { Paperclip, X } from 'lucide-react'
import { AGENT_IMAGE_MIME_TYPES, AGENT_MAX_ATTACHMENT_BYTES, AGENT_MAX_ATTACHMENTS, AGENT_MAX_IMAGE_BYTES, agentAttachmentHandlesSchema, type AgentAttachmentHandle } from '../../../shared/agents'
import { Button } from '../components/Button'
import { stageImage, useThumbnail } from './stagedImages'
import './screenshots.css'

// The refusals a file's own type and size decide, checked before anything is read.
const NOT_A_SCREENSHOT = 'Choose PNG, JPEG, GIF, or WebP screenshots.'
const TOO_LARGE = 'Each screenshot must be 10 MB or smaller.'
const TOO_LARGE_IN_TOTAL = 'Screenshots must total 20 MB or less. Remove an image or choose smaller files.'

function checkImage(file: File): void {
  if (!(AGENT_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) throw new Error(NOT_A_SCREENSHOT)
  if (file.size > AGENT_MAX_IMAGE_BYTES) throw new Error(TOO_LARGE)
}

/** One attached image: its thumbnail, drawn in this window, or its name alone while there is none. */
function Chip({ target, attachment, disabled, onRemove }: { readonly target: string | null; readonly attachment: AgentAttachmentHandle; readonly disabled: boolean; readonly onRemove: () => void }): ReactNode {
  const thumbnail = useThumbnail(target, attachment)
  return <figure>
    {thumbnail ? <img src={thumbnail} alt={attachment.name} /> : <span className="screenshot-previews__pending" role="img" aria-label={attachment.name} />}
    <figcaption title={attachment.name}>{attachment.name}</figcaption>
    <button type="button" title={`Remove ${attachment.name}`} aria-label={`Remove ${attachment.name}`} disabled={disabled} onClick={onRemove}><X size={12} /></button>
  </figure>
}

/**
 * Where screenshots join a draft. Each is staged once, on the host that runs `target` (ADR-0030), and the draft
 * carries its handle; the chips draw their own thumbnails.
 */
export function ScreenshotInput({ target, attachments, onChange, disabled, supported, children, onReadingChange }: {
  /** The thread the draft belongs to, or null for the coordinator's composer. */
  readonly target: string | null
  readonly attachments: readonly AgentAttachmentHandle[]
  readonly onChange: (attachments: AgentAttachmentHandle[]) => void
  readonly disabled: boolean
  readonly supported: boolean
  readonly children: ReactNode
  readonly onReadingChange?: (reading: boolean) => void
}): ReactNode {
  const picker = useRef<HTMLInputElement>(null)
  const current = useRef(attachments)
  current.current = attachments
  const latestChange = useRef(onChange)
  latestChange.current = onChange
  const reading = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; onReadingChange?.(false) } }, [onReadingChange])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const add = async (files: File[]): Promise<void> => {
    if (disabled || reading.current) return
    if (!supported) { setError('This model does not support screenshots. Choose a model with image support.'); return }
    setError(null)
    if (files.length + current.current.length > AGENT_MAX_ATTACHMENTS) { setError(`Attach up to ${AGENT_MAX_ATTACHMENTS} screenshots at a time.`); return }
    // Every refusal that the file sizes alone can decide comes before any file is read and staged.
    try { files.forEach(checkImage) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read these screenshots.'); return }
    const total = current.current.reduce((sum, item) => sum + item.sizeBytes, 0) + files.reduce((sum, file) => sum + file.size, 0)
    if (total > AGENT_MAX_ATTACHMENT_BYTES) { setError(TOO_LARGE_IN_TOTAL); return }
    reading.current = true; setBusy(true); onReadingChange?.(true)
    try {
      const images = await Promise.all(files.map(file => stageImage(target, { name: file.name || 'Screenshot.png', mimeType: file.type, blob: file })))
      if (!mounted.current) return
      // The schema stays the authority: it checks what was actually staged, not what the files claimed.
      const result = agentAttachmentHandlesSchema.safeParse([...current.current, ...images])
      if (!result.success) { setError(TOO_LARGE_IN_TOTAL); return }
      latestChange.current(result.data)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not read these screenshots.') }
    finally { if (mounted.current) { reading.current = false; setBusy(false); onReadingChange?.(false) } }
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
      {error && <small className="agent-error" role="alert">{error}</small>}
    </div>
  </div>
}
