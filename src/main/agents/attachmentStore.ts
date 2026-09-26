import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { AGENT_IMAGE_MIME_TYPES, AGENT_MAX_IMAGE_BYTES, agentAttachmentHandleSchema, attachmentDigestSchema, bytesHaveRasterSignature,
  type AgentAttachment, type AgentAttachmentDimensions, type AgentAttachmentHandle } from '../../shared/agents'
import { AtomicJsonStore } from '../storage/atomicJsonStore'

type ImageType = typeof AGENT_IMAGE_MIME_TYPES[number]
const EXTENSIONS: Record<ImageType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
const TYPES = new Map(Object.entries(EXTENSIONS).map(([type, extension]) => [extension, type as ImageType]))
const CONTENT_FILE = /^([a-f0-9]{64})\.(png|jpg|gif|webp)$/u
const INDEX_FILE = 'index.json'
const WINDOWS_RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80, 160] as const
/**
 * How long content nothing owns is kept (ADR-0031). It is what lets a refused prompt go back to its composer, or be
 * sent again from the window's own copy, without staging again; after it the content is removed.
 */
export const UNOWNED_ATTACHMENT_GRACE_MS = 60 * 60_000

const entrySchema = z.object({ digest: attachmentDigestSchema, mimeType: z.enum(AGENT_IMAGE_MIME_TYPES),
  sizeBytes: z.number().int().min(1).max(AGENT_MAX_IMAGE_BYTES), stagedAt: z.number().finite() }).strict()
type Entry = z.infer<typeof entrySchema>
type Index = { version: 1; entries: Entry[] }
/** Content this store keeps: on disk under its digest, or in memory alone while history is off. */
interface Held extends Entry { memory?: Buffer; unownedSince: number | null }

/** Content staging refuses for what it is (its type, its size, its signature), not for a failure to keep it. */
export class RefusedImage extends Error {}

/**
 * Stages one image a file from before ADR-0031 kept inline, answering with its handle under the image's own ID, or
 * null for one that is not the image it claims. Failing to keep one is thrown: that is storage, not the image.
 */
export type StageInline = (attachment: AgentAttachment) => Promise<AgentAttachmentHandle | null>
export function inlineStager(store: Pick<AttachmentStore, 'stage'>): StageInline {
  return async attachment => {
    const bytes = Buffer.from(attachment.dataUrl.slice(attachment.dataUrl.indexOf(',') + 1), 'base64')
    try { return { ...await store.stage({ name: attachment.name, mimeType: attachment.mimeType, bytes, ...(attachment.dimensions ? { dimensions: attachment.dimensions } : {}) }), id: attachment.id } }
    catch (error) { if (error instanceof RefusedImage) return null; throw error }
  }
}

export const MISSING_ATTACHMENT = 'An image in this message is no longer kept on this computer. Remove it and attach it again. Nothing else was changed.'
/** The same, from a headless host: the desktop reading it is not the machine that lost the image. */
export const MISSING_REMOTE_ATTACHMENT = 'An image in this message is no longer kept on its host. Remove it and attach it again. Nothing else was changed.'
export const MISMATCHED_ATTACHMENT = 'An image in this message does not match the copy Sotto kept. Remove it and attach it again. Nothing was sent.'

/**
 * One host's staged images (ADR-0031). Each distinct content is one file named by its SHA-256, beside a small index
 * of digest, type, size and staging time: no names, no thread IDs, no text. Staging commits the bytes and the index
 * before it answers, so nothing can be saved pointing at content that is not on disk. What to keep is the caller's:
 * `sweep` is handed every digest something still owns.
 */
export class AttachmentStore {
  private readonly held = new Map<string, Held>()
  private readonly folder: string
  private readonly index: AtomicJsonStore<Index>
  private serial: Promise<unknown> = Promise.resolve()
  /**
   * `missing` is the sentence a handle whose content is gone is refused with: this computer's on the desktop,
   * MISSING_REMOTE_ATTACHMENT on a headless host, whose refusals a desktop shows.
   */
  constructor(directory: string, private readonly historyEnabled: () => boolean = () => true, private readonly now: () => number = () => Date.now(),
    readonly missing: string = MISSING_ATTACHMENT) {
    this.folder = join(directory, 'attachments')
    this.index = new AtomicJsonStore(join(this.folder, INDEX_FILE), value => {
      const saved = z.object({ version: z.literal(1), entries: z.array(z.unknown()) }).parse(value)
      return { version: 1, entries: saved.entries.flatMap(item => { const parsed = entrySchema.safeParse(item); return parsed.success ? [parsed.data] : [] }) }
    }, () => ({ version: 1, entries: [] }))
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.serial.then(work)
    this.serial = pending.catch(() => undefined)
    return pending
  }
  private file(entry: Pick<Entry, 'digest' | 'mimeType'>): string { return join(this.folder, `${entry.digest}.${EXTENSIONS[entry.mimeType]}`) }

  /**
   * Reads the index and squares it with the folder. Every content counts as unowned from now, so one staged just
   * before a crash, whose draft was never saved, is removed a grace period into this run. A content file the index
   * does not name (a crash between the rename and the index write) is taken back into it; temporary files and
   * anything else in the folder are removed, and an entry whose file is gone is dropped.
   */
  load(): Promise<void> {
    return this.enqueue(async () => {
      const names = await readdir(this.folder).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
      this.held.clear()
      if (names === null) return
      const saved = await this.index.peek()
      const indexed = new Map(saved.entries.map(entry => [entry.digest, entry]))
      const now = this.now()
      for (const name of names) {
        if (name === INDEX_FILE) continue
        const match = CONTENT_FILE.exec(name)
        const mimeType = match ? TYPES.get(match[2]!) : undefined
        const size = match && mimeType ? await stat(join(this.folder, name)).then(info => info.isFile() ? info.size : 0, () => 0) : 0
        if (!match || !mimeType || size < 1 || size > AGENT_MAX_IMAGE_BYTES || this.held.has(match[1]!)) {
          await unlink(join(this.folder, name)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT' && error.code !== 'EISDIR' && error.code !== 'EPERM') throw error })
          continue
        }
        const entry = indexed.get(match[1]!)
        this.held.set(match[1]!, { digest: match[1]!, mimeType, sizeBytes: size, stagedAt: entry?.stagedAt ?? now, unownedSince: now })
      }
      if (saved.entries.length !== this.held.size || saved.entries.some(entry => !this.held.has(entry.digest))) await this.writeIndex()
    })
  }
  private writeIndex(): Promise<void> {
    return this.index.write({ version: 1, entries: [...this.held.values()].filter(item => !item.memory)
      .map(({ digest, mimeType, sizeBytes, stagedAt }) => ({ digest, mimeType, sizeBytes, stagedAt })) })
  }

  /**
   * Keeps an image's bytes once and answers with its handle. The type, size and signature are checked here, whoever
   * sent them. With history on the bytes are on disk, and in the index, before this resolves; with it off they are
   * kept in memory and nothing is written.
   */
  stage(input: { readonly name: string; readonly mimeType: string; readonly bytes: Uint8Array; readonly dimensions?: AgentAttachmentDimensions | undefined }): Promise<AgentAttachmentHandle> {
    const mimeType = input.mimeType as ImageType
    if (!(AGENT_IMAGE_MIME_TYPES as readonly string[]).includes(input.mimeType)) return Promise.reject(new RefusedImage('Choose PNG, JPEG, GIF, or WebP screenshots.'))
    if (input.bytes.byteLength < 1 || input.bytes.byteLength > AGENT_MAX_IMAGE_BYTES) return Promise.reject(new RefusedImage('Each screenshot must be 10 MB or smaller.'))
    if (!bytesHaveRasterSignature(mimeType, input.bytes)) return Promise.reject(new RefusedImage('The image content does not match its file type.'))
    const bytes = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength)
    const digest = createHash('sha256').update(bytes).digest('hex')
    // The sizes are the composer's word for what it attached and staged; they describe, and are never read as content.
    const parsed = agentAttachmentHandleSchema.safeParse({ id: randomUUID(), name: input.name.trim() || 'Screenshot', mimeType, sizeBytes: bytes.byteLength, digest,
      ...(input.dimensions ? { dimensions: input.dimensions } : {}) })
    if (!parsed.success) return Promise.reject(new RefusedImage('Could not read this screenshot’s name or size. Nothing was attached. Try again.'))
    const handle = parsed.data
    return this.enqueue(async () => {
      const now = this.now()
      const existing = this.held.get(digest)
      // Re-staging content starts its grace again; the same bytes are never written twice.
      if (existing) { existing.unownedSince = existing.unownedSince === null ? null : now; return handle }
      if (!this.historyEnabled()) {
        this.held.set(digest, { digest, mimeType, sizeBytes: bytes.byteLength, stagedAt: now, memory: Buffer.from(bytes), unownedSince: now })
        return handle
      }
      await this.writeContent({ digest, mimeType }, bytes)
      const held: Held = { digest, mimeType, sizeBytes: bytes.byteLength, stagedAt: now, unownedSince: now }
      this.held.set(digest, held)
      try { await this.writeIndex() }
      catch (error) {
        // Without its index entry the content still comes back at the next start and is removed there.
        this.held.delete(digest)
        await unlink(this.file(held)).catch(() => undefined)
        throw error
      }
      return handle
    })
  }
  private async writeContent(entry: Pick<Entry, 'digest' | 'mimeType'>, bytes: Buffer): Promise<void> {
    await mkdir(this.folder, { recursive: true })
    const target = this.file(entry)
    const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(bytes); await handle.sync()
    } catch (error) {
      await handle.close().catch(() => undefined); await unlink(temporary).catch(() => undefined); throw error
    }
    await handle.close()
    for (let attempt = 0; ; attempt += 1) {
      try { await rename(temporary, target); return }
      catch (error) {
        const retry = WINDOWS_RENAME_RETRY_DELAYS_MS[attempt]
        const code = (error as NodeJS.ErrnoException).code
        if (process.platform !== 'win32' || retry === undefined || (code !== 'EPERM' && code !== 'EBUSY')) {
          await unlink(temporary).catch(() => undefined); throw error
        }
        await delay(retry)
      }
    }
  }

  has(digest: string): boolean { return this.held.has(digest) }
  /** Whether content is only in memory: kept while history was off, and gone after a restart. */
  inMemory(digest: string): boolean { return Boolean(this.held.get(digest)?.memory) }
  /**
   * Refuses handles whose content this store does not keep, or whose type or size disagree with it, before a
   * command that carries them does anything. A window's handle is a claim; the store is what it is checked against.
   */
  verify(handles: readonly Pick<AgentAttachmentHandle, 'digest' | 'mimeType' | 'sizeBytes'>[] | undefined): void {
    for (const handle of handles ?? []) {
      const held = this.held.get(handle.digest)
      if (!held) throw new Error(this.missing)
      if (held.mimeType !== handle.mimeType || held.sizeBytes !== handle.sizeBytes) throw new Error(MISMATCHED_ATTACHMENT)
    }
  }
  /** Whether a handle names content this store keeps, as the handle describes it: what `verify` asks of each one. */
  keeps(handle: Pick<AgentAttachmentHandle, 'digest' | 'mimeType' | 'sizeBytes'>): boolean {
    const held = this.held.get(handle.digest)
    return held !== undefined && held.mimeType === handle.mimeType && held.sizeBytes === handle.sizeBytes
  }
  /**
   * The bytes a digest names, or null when this store no longer keeps them. Bytes read from disk are hashed first:
   * a file truncated, damaged or replaced since it was staged is not the image the user attached, so it is treated
   * as gone rather than sent under their digest. Staging the same image again writes it afresh.
   */
  async read(digest: string): Promise<Buffer | null> {
    const held = this.held.get(digest)
    if (!held) return null
    if (held.memory) return held.memory
    let bytes: Buffer
    try { bytes = await readFile(this.file(held)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    if (createHash('sha256').update(bytes).digest('hex') === digest) return bytes
    if (this.held.get(digest) === held) this.held.delete(digest)
    return null
  }
  /** The type a digest was staged as, so a reader can say what the bytes are. */
  mimeType(digest: string): ImageType | null { return this.held.get(digest)?.mimeType ?? null }

  /**
   * Removes content nothing owns once it has been unowned for `graceMs`. Owned content starts its grace again the
   * next time nothing owns it. Content in `releaseNow` that nothing owns goes at once, without a grace: that is what
   * turning history off asks for the content only previews kept.
   */
  sweep(owned: ReadonlySet<string> | (() => ReadonlySet<string>), graceMs = UNOWNED_ATTACHMENT_GRACE_MS, releaseNow: ReadonlySet<string> = new Set()): Promise<void> {
    return this.enqueue(async () => {
      // Asked when the sweep runs, not when it was queued: whatever came to own content meanwhile keeps it.
      const kept = typeof owned === 'function' ? owned() : owned
      const now = this.now()
      const expired: Held[] = []
      for (const held of this.held.values()) {
        if (kept.has(held.digest)) { held.unownedSince = null; continue }
        held.unownedSince ??= now
        if (releaseNow.has(held.digest) || now - held.unownedSince >= graceMs) expired.push(held)
      }
      if (!expired.length) return
      for (const held of expired) this.held.delete(held.digest)
      if (expired.some(held => !held.memory)) await this.writeIndex()
      for (const held of expired) if (!held.memory) {
        await unlink(this.file(held)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
      }
    })
  }
  /** Waits for every stage and sweep already asked for. */
  idle(): Promise<void> { return this.enqueue(async () => undefined) }
}
