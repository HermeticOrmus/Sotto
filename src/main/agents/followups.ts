import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { agentAttachmentHandleSchema, agentAttachmentSchema, agentFollowupSchema, agentDeliveryReceiptsSchema, MAX_DELIVERED_DRAFTS,
  type AgentAttachmentHandle, type AgentFollowup } from '../../shared/agents'
import { AtomicJsonStore } from '../storage/atomicJsonStore'
import type { StageInline } from './attachmentStore'

/** Why a follow-up came back from a restart without an image it had, whatever the reason the image was not kept. */
export const LOST_IMAGES = 'An image in this follow-up was no longer kept when Sotto started, so the follow-up was paused rather than sent without it. Attach the image again or remove the follow-up.'
export function followupDigest(input: Pick<AgentFollowup, 'text' | 'attachments' | 'skills' | 'files'>): string {
  const base = input.skills?.length ? [input.text.trim(), input.attachments, input.skills] : [input.text.trim(), input.attachments]
  // Mentioned files join the digest only when there are any, so revisions without them keep their existing identity.
  return createHash('sha256').update(JSON.stringify(input.files?.length ? [...base, input.files] : base)).digest('hex')
}
const receiptsSchema = z.array(agentDeliveryReceiptsSchema.element.extend({ digest: z.string().optional() })).max(MAX_DELIVERED_DRAFTS)
type State = { items: AgentFollowup[]; receipts: z.infer<typeof receiptsSchema> }
/**
 * What the file may hold: a follow-up written before ADR-0031 kept its images inline. Each is read as it stands and
 * staged when the store loads, so an upgrade never discards the queue as unreadable.
 */
const storedSchema = z.object({ items: z.array(agentFollowupSchema.extend({ attachments: z.array(z.union([agentAttachmentHandleSchema, agentAttachmentSchema])) })), receipts: receiptsSchema })
type Stored = z.infer<typeof storedSchema>
/** The durable queue as it stands, for reading only. */
export interface FollowupView {
  readonly items: readonly Readonly<State['items'][number]>[]
  readonly receipts: readonly Readonly<State['receipts'][number]>[]
}

/** Only durable snapshots become visible. No provider work runs under this store's mutation lane. */
export class FollowupStore {
  private state: State = { items: [], receipts: [] }
  private tail: Promise<unknown> = Promise.resolve()
  private readonly store: AtomicJsonStore<Stored>
  constructor(directory: string) {
    this.store = new AtomicJsonStore<Stored>(join(directory, 'followups.json'), storedSchema.parse, () => ({ items: [], receipts: [] }))
  }
  /**
   * Reads the queue, staging any image an older version kept inline. `kept` says whether a follow-up's content is
   * still there. One that lost an image, because its content is gone or an inline one was not the image it claimed,
   * is paused and says so, never sent without it.
   */
  async load(stage?: StageInline, kept: (handle: AgentAttachmentHandle) => boolean = () => true): Promise<void> {
    const stored = await this.store.read()
    const items: State['items'] = []
    const lost = new Set<string>()
    for (const item of stored.items) {
      const attachments: AgentAttachmentHandle[] = []
      for (const attachment of item.attachments) {
        if (!('dataUrl' in attachment)) { attachments.push(attachment); continue }
        if (!stage) throw new Error('This queue holds images from an earlier version and cannot be read without staging them.')
        const handle = await stage(attachment)
        if (handle) attachments.push(handle)
        else lost.add(item.id)
      }
      items.push(agentFollowupSchema.parse({ ...item, attachments }))
    }
    this.state = { items, receipts: stored.receipts }
    await this.change(state => {
      for (const item of state.items) {
        const remaining = item.attachments.filter(kept)
        if (remaining.length === item.attachments.length && !lost.has(item.id)) continue
        item.attachments = remaining
        if (['queued', 'paused', 'failed'].includes(item.status)) { item.status = 'paused'; item.error = LOST_IMAGES }
      }
      for (const item of state.items) if (item.status === 'dispatching') {
        item.status = 'uncertain'; item.error = 'Dispatch was interrupted. Refresh to reconcile; this message will not be replayed.'
      }
    })
  }
  get(): State { return structuredClone(this.state) }
  /**
   * The queue without a copy, for callers that only look: the coordinator reads thread ids and statuses
   * several times per streaming frame, and a copy carries every queued image with it. Safe to hold across
   * an await, because a change never edits this object; it builds the next one and swaps it in whole.
   */
  peek(): FollowupView { return this.state }
  private change(update: (state: State) => void): Promise<void> {
    const task = this.tail.catch(() => undefined).then(async () => {
      const next = this.get(); update(next)
      await this.store.write(next); this.state = next
    })
    this.tail = task
    return task
  }
  enqueue(input: Pick<AgentFollowup, 'threadId' | 'draftId' | 'text' | 'attachments' | 'skills' | 'files' | 'resumeAfterTurnId'>): Promise<void> {
    return this.change(state => {
      const receipt = state.receipts.find(r => r.threadId === input.threadId && r.draftId === input.draftId)
      const item = state.items.find(r => r.threadId === input.threadId && r.draftId === input.draftId)
      const digest = followupDigest(input)
      if (receipt || item) {
        if ((receipt?.digest ?? (item ? followupDigest(item) : undefined)) !== digest) throw new Error('This revision already belongs to a submitted prompt. Use a new draft revision for different content.')
        return
      }
      if (state.items.filter(item => item.threadId === input.threadId).length >= 100) throw new Error('This thread already has 100 follow-ups. Remove or send some first.')
      const now = new Date().toISOString()
      state.items.push(agentFollowupSchema.parse({ ...input, id: randomUUID(), status: 'queued', createdAt: now, updatedAt: now }))
      state.receipts = [...state.receipts, { threadId: input.threadId, draftId: input.draftId, digest }].slice(-MAX_DELIVERED_DRAFTS)
    })
  }
  edit(threadId: string, itemId: string, update?: Pick<AgentFollowup, 'text' | 'attachments' | 'skills' | 'files'>): Promise<void> {
    return this.change(state => {
      const item = state.items.find(item => item.threadId === threadId && item.id === itemId)
      if (!item) throw new Error('That follow-up is no longer queued.')
      if (item.status === 'dispatching' || item.status === 'uncertain') throw new Error('This follow-up may already be sent. Refresh to reconcile it before making changes.')
      if (update) Object.assign(item, update, { updatedAt: new Date().toISOString() })
      else state.items = state.items.filter(candidate => candidate !== item)
    })
  }
  reorder(threadId: string, ids: string[]): Promise<void> {
    return this.change(state => {
      const items = state.items.filter(item => item.threadId === threadId)
      if (items.some(item => item.status === 'dispatching' || item.status === 'uncertain')) throw new Error('Wait for this thread’s pending delivery before reordering follow-ups.')
      if (ids.length !== items.length || new Set(ids).size !== ids.length || ids.some(id => !items.some(item => item.id === id))) throw new Error('The follow-up order changed. Refresh and try again.')
      state.items = [...state.items.filter(item => item.threadId !== threadId), ...ids.map(id => items.find(item => item.id === id)!)]
    })
  }
  pause(threadId: string, error: string): Promise<void> {
    return this.change(state => {
      for (const item of state.items) if (item.threadId === threadId && item.status === 'queued') Object.assign(item, { status: 'paused', error })
    })
  }
  resume(threadId: string, turnId?: string): Promise<void> {
    return this.change(state => {
      for (const item of state.items) if (item.threadId === threadId && ['paused', 'failed'].includes(item.status)) {
        item.status = 'queued'; if (turnId) item.resumeAfterTurnId = turnId; delete item.error
      }
    })
  }
  claim(id: string, mode: 'send' | 'steer' = 'send'): Promise<void> {
    return this.change(state => {
      const item = state.items.find(item => item.id === id)
      if (!item || item.status !== 'queued' || mode === 'send' && state.items.find(candidate => candidate.threadId === item.threadId)?.id !== id) throw new Error('This follow-up is no longer ready to send.')
      Object.assign(item, { status: 'dispatching', commandId: randomUUID(), messageId: randomUUID(), updatedAt: new Date().toISOString() })
    })
  }
  settle(id: string, status: 'accepted' | 'uncertain' | 'failed', error?: string): Promise<void> {
    return this.change(state => {
      const item = state.items.find(item => item.id === id)
      if (!item) return
      if (status === 'accepted') state.items = state.items.filter(candidate => candidate !== item)
      else Object.assign(item, { status, error, updatedAt: new Date().toISOString() })
    })
  }
}
