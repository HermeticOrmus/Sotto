import { join } from 'node:path'
import { readdir, unlink } from 'node:fs/promises'
import { z } from 'zod'
import { agentAttachmentHandlesSchema, agentAttachmentsSchema, hasRasterImageSignature,
  type AgentAttachmentHandle, type AgentHostSnapshot } from '../../shared/agents'
import { AtomicJsonStore } from '../storage/atomicJsonStore'
import { RefusedImage, type AttachmentStore } from './attachmentStore'

export const ATTACHMENT_PREVIEW_RETENTION_MS = 7 * 86_400_000
export const MAX_ATTACHMENT_PREVIEW_BYTES = 100 * 1024 * 1024
const identity = {
  threadId: z.string().min(1).max(512), messageId: z.string().min(1).max(512), commandId: z.string().min(1).max(512),
  storedAt: z.number().finite(),
}
const entrySchema = z.object({ ...identity, attachments: agentAttachmentHandlesSchema })
/** Version 1 kept each image's bytes inline; they are staged into the attachment store when it is read (ADR-0030). */
const inlineEntrySchema = z.object({ ...identity, attachments: agentAttachmentsSchema.refine(items => items.every(hasRasterImageSignature)) })
type Entry = z.infer<typeof entrySchema>
type Read = { version: 1 | 2; entries: unknown[] }
type Cached = Entry & { retain: boolean }

/**
 * Submitted content only. No native transcript ingestion, URL fetching, or path resolution. An entry names the
 * staged images its message carried; the bytes are the attachment store's, which keeps them while an entry here
 * (or anything else) owns them. Retention here is the entries': seven days and 100 MiB of the handles' sizes.
 */
export class AttachmentPreviews {
  private entries: Cached[] = []
  private serial: Promise<unknown> = Promise.resolve()
  private enabled: boolean
  private dirty = false
  private readonly store: AtomicJsonStore<Read>
  constructor(private readonly directory: string, private readonly content: Pick<AttachmentStore, 'read' | 'stage'>,
    private readonly historyEnabled: () => boolean = () => true, private readonly now: () => number = Date.now) {
    this.enabled = historyEnabled()
    this.store = new AtomicJsonStore<Read>(join(directory, 'attachment-previews.json'), value => {
      const saved = z.object({ version: z.union([z.literal(1), z.literal(2)]), entries: z.array(z.unknown()) }).parse(value)
      return { version: saved.version, entries: saved.entries }
    }, () => ({ version: 2, entries: [] }))
  }
  private enqueue(work: () => Promise<void>): Promise<void> {
    const pending = this.serial.then(work)
    this.serial = pending.catch(() => undefined)
    return pending
  }
  async load(): Promise<void> {
    await this.enqueue(async () => {
      // AtomicJsonStore removes failed writes; a process crash can leave its private temporary file.
      // Only this store's generated basenames qualify, and initialization precedes any writes.
      const names = await readdir(this.directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return []
        throw error
      })
      for (const name of names) if (/^attachment-previews\.json\.tmp-\d+-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(name)) {
        await unlink(join(this.directory, name)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
      }
      // Cache corruption must not create an untracked copy of private image content.
      const saved = await this.store.peek()
      this.enabled = this.historyEnabled()
      const entries: Entry[] = []
      if (this.enabled) for (const item of saved.entries) {
        if (saved.version === 2) { const parsed = entrySchema.safeParse(item); if (parsed.success) entries.push(parsed.data); continue }
        const inline = inlineEntrySchema.safeParse(item)
        if (!inline.success) continue
        const handles: AgentAttachmentHandle[] = []
        for (const attachment of inline.data.attachments) {
          const bytes = Buffer.from(attachment.dataUrl.slice(attachment.dataUrl.indexOf(',') + 1), 'base64')
          const handle = await this.content.stage({ name: attachment.name, mimeType: attachment.mimeType, bytes })
            .catch((error: unknown) => { if (error instanceof RefusedImage) return null; throw error })
          if (handle) handles.push({ ...handle, id: attachment.id })
        }
        if (handles.length) entries.push({ ...inline.data, attachments: handles })
      }
      const seen = new Set<string>()
      this.entries = entries.filter(entry => {
        const key = JSON.stringify([entry.threadId, entry.messageId])
        if (seen.has(key)) return false
        seen.add(key); return true
      }).map(entry => ({ ...entry, retain: true }))
      this.dirty = saved.version !== 2
      this.prune()
      await this.write()
    })
  }
  private prune(): boolean {
    const before = this.entries.length
    const enabled = this.historyEnabled()
    if (enabled !== this.enabled) this.dirty = true
    if (!enabled && this.enabled) this.entries = []
    this.enabled = enabled
    const now = this.now()
    this.entries = this.entries.filter(entry => entry.storedAt > now - ATTACHMENT_PREVIEW_RETENTION_MS && entry.storedAt <= now)
    this.entries.sort((a, b) => a.storedAt - b.storedAt)
    let bytes = this.entries.reduce((sum, entry) => sum + this.size(entry), 0)
    while (bytes > MAX_ATTACHMENT_PREVIEW_BYTES) bytes -= this.size(this.entries.shift()!)
    this.dirty ||= before !== this.entries.length
    return this.dirty
  }
  private size(entry: Entry): number {
    return entry.attachments.reduce((sum, attachment) => sum + attachment.sizeBytes, 0)
  }
  private async write(): Promise<void> {
    await this.store.write({ version: 2, entries: this.enabled
      ? this.entries.filter(entry => entry.retain).map(entry => ({ threadId: entry.threadId, messageId: entry.messageId,
        commandId: entry.commandId, storedAt: entry.storedAt, attachments: entry.attachments })) : [] })
    this.dirty = false
  }
  maintain(): Promise<void> {
    return this.enqueue(async () => { if (this.prune()) await this.write() })
  }
  /** Every content a live entry names, retained on disk or held for this run alone: what the attachment store keeps for previews. */
  digests(): Set<string> {
    return new Set([...this.live().values()].flatMap(entry => entry.attachments.map(attachment => attachment.digest)))
  }
  /** Every content any entry still names, live or not: what a privacy change may be about to release. */
  named(): Set<string> {
    return new Set(this.entries.flatMap(entry => entry.attachments.map(attachment => attachment.digest)))
  }
  /**
   * Records the images a prompt carried once the provider has it. The entry is live at once, so the next publish
   * carries its marker; the disk write follows in order and nothing waits on it to send. A failed write drops the
   * entry again, which the window shows as an unavailable preview: the message itself was already sent.
   */
  remember(threadId: string, messageId: string, commandId: string, attachments: readonly AgentAttachmentHandle[]): Promise<void> {
    let entry: Entry
    try { entry = entrySchema.parse({ threadId, messageId, commandId, storedAt: this.now(), attachments }) }
    catch (error) { return Promise.reject(error) }
    this.prune()
    const existing = this.entries.find(item => item.threadId === threadId && item.messageId === messageId)
    if (existing) {
      if (existing.commandId !== commandId || JSON.stringify(existing.attachments) !== JSON.stringify(entry.attachments)) {
        return Promise.reject(new Error('That message already owns different attachment previews.'))
      }
      // A retry never extends retention or changes identity.
      return this.enqueue(async () => { if (this.dirty) await this.write() })
    }
    if (!attachments.length) return Promise.resolve()
    const cached: Cached = { ...entry, retain: this.enabled }
    this.entries = [...this.entries, cached]
    this.dirty = true
    this.prune()
    return this.enqueue(async () => {
      try { await this.write() }
      catch (cause) {
        // Only this preview goes. What it pushed out under the size limit stays out: restoring entries here
        // could bring back ones a privacy change has since cleared.
        this.entries = this.entries.filter(item => item !== cached)
        throw new Error('Could not save the previews of the screenshots in this message. The message was sent; only its previews are unavailable. Check access to local storage.', { cause })
      }
    })
  }
  /** Entries retention and the privacy setting still allow, keyed by thread and message. */
  private live(): Map<string, Entry> {
    const now = this.now()
    return new Map(this.entries.filter(entry => entry.storedAt > now - ATTACHMENT_PREVIEW_RETENTION_MS
      && entry.storedAt <= now && (this.historyEnabled() || !entry.retain))
      .map(entry => [JSON.stringify([entry.threadId, entry.messageId]), entry]))
  }
  /** Only the exact user message that submitted these bytes may show them. */
  private permits(message: AgentHostSnapshot['threads'][number]['messages'][number], entry: Entry): boolean {
    return message.role === 'user' && (message.commandId === undefined || message.commandId === entry.commandId)
  }
  /**
   * Decorate only an outbound clone. Workspace/native history must never cache these bytes, and the
   * published state carries markers alone: the window asks for one image at a time through preview().
   */
  decorate(snapshot: AgentHostSnapshot): void {
    const entries = this.live()
    for (const thread of snapshot.threads) for (const message of thread.messages) {
      // Provider content cannot mint previews, including when no local record exists.
      for (const attachment of message.attachments ?? []) delete attachment.preview
      const entry = entries.get(JSON.stringify([thread.id, message.id]))
      if (!entry || !this.permits(message, entry)) continue
      const local = entry.attachments.map(attachment => ({ id: attachment.id, name: attachment.name, mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes, preview: { available: true as const } }))
      message.attachments = [...local, ...(message.attachments ?? []).filter(attachment => !local.some(item => item.id === attachment.id))]
    }
  }
  /** The bytes behind one marker, as a data URL, under exactly the rules decorate() places it by. */
  async preview(snapshot: AgentHostSnapshot, threadId: string, messageId: string, attachmentId: string): Promise<string | null> {
    const entry = this.live().get(JSON.stringify([threadId, messageId]))
    if (!entry) return null
    const message = snapshot.threads.find(thread => thread.id === threadId)?.messages.find(item => item.id === messageId)
    if (!message || !this.permits(message, entry)) return null
    const attachment = entry.attachments.find(item => item.id === attachmentId)
    const bytes = attachment ? await this.content.read(attachment.digest) : null
    return attachment && bytes ? `data:${attachment.mimeType};base64,${bytes.toString('base64')}` : null
  }
}
