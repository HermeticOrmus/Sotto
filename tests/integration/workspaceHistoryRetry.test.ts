// @vitest-environment node
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceHost } from '../../src/main/agents/workspace'
import { ThreadStore } from '../../src/main/agents/threadStore'
import type { ThreadHostEvent } from '../../src/main/agents/host'
import type { ThreadEvent } from '../../src/shared/threadEvents'
import { FakeProviderHost } from '../fixtures/fakeProviderHost'

class EventProvider extends FakeProviderHost {
  private readonly events = new Set<(event: ThreadHostEvent) => void>()
  subscribeEvents(listener: (event: ThreadHostEvent) => void): () => void {
    this.events.add(listener)
    return () => this.events.delete(listener)
  }
  publish(event: ThreadEvent, threadId = 'session-workshop'): void {
    for (const listener of this.events) listener({ threadId, event })
  }
}
const at = '2026-09-27T00:00:00.000Z'
const added = (id = 'reply', text = 'First chunk'): ThreadEvent => ({ kind: 'message-added', at, message: { id, role: 'assistant', text, createdAt: at } })
const appended = (appendText = ' continued'): ThreadEvent => ({ kind: 'message-text-appended', at, messageId: 'reply', appendText })
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  for (const close of cleanup.splice(0).reverse()) await close()
})
async function fixture(history: () => boolean = () => true) {
  const directory = await mkdtemp(join(tmpdir(), 'sotto-history-retry-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const adapter = new EventProvider()
  const host = new WorkspaceHost(adapter, directory, history)
  cleanup.push(async () => { await host.close().catch(() => undefined) })
  await host.initialize()
  await host.connect()
  host.observeThreads(['session-workshop'])
  return { directory, adapter, host }
}
function failWrites() {
  return vi.spyOn(ThreadStore.prototype, 'appendMany').mockImplementation(() => { throw new Error('Synthetic unavailable storage') })
}

it('retains failed events in order through incoming text, an organization save, retry and restart', async () => {
  const { directory, adapter, host } = await fixture()
  const append = failWrites()
  adapter.publish(added())
  expect(host.workspaceSnapshot().error).toContain('Thread messages could not be saved')
  adapter.publish(appended())
  await host.renameThread('session-workshop', 'Saved name')
  expect(JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8')).snapshot.threads[0].title).toBe('Saved name')
  expect(host.workspaceSnapshot().error).toContain('Thread messages could not be saved')
  append.mockRestore()
  await expect.poll(() => host.workspaceSnapshot().error).toBeUndefined()
  expect(host.threadMessages('session-workshop')).toMatchObject([{ id: 'reply', text: 'First chunk continued' }])
  expect(host.eventsAfter(0).map(row => row.event.kind)).toEqual(['message-added', 'message-text-appended'])
  await host.close()
  const reopened = new WorkspaceHost(new EventProvider(), directory)
  cleanup.push(async () => { await reopened.close() })
  await reopened.initialize()
  reopened.observeThreads(['session-workshop'])
  expect(reopened.workspaceSnapshot().threads[0]?.messages).toMatchObject([{ id: 'reply', text: 'First chunk continued' }])
})

it('retries an outstanding batch during shutdown without waiting for its retry timer', async () => {
  const { directory, adapter, host } = await fixture()
  const append = failWrites()
  adapter.publish(added())
  expect(host.workspaceSnapshot().error).toContain('Thread messages could not be saved')
  adapter.publish(appended())
  append.mockRestore()
  await host.close()
  const reopened = new ThreadStore(join(directory, 'threads.sqlite'))
  reopened.open()
  try { expect(reopened.readMessages('session-workshop').messages).toMatchObject([{ text: 'First chunk continued' }]) }
  finally { reopened.close() }
})

it('paces persistent failures and reports that shutdown could not save the remaining history', async () => {
  const { adapter, host } = await fixture()
  vi.useFakeTimers()
  const append = failWrites()
  adapter.publish(added())
  host.workspaceSnapshot()
  for (let i = 0; i < 600; i++) { adapter.publish(appended('x')); host.workspaceSnapshot() }
  expect(append).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1_000)
  expect(append).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(2_000)
  expect(append).toHaveBeenCalledTimes(3)
  expect(host.workspaceSnapshot().error).toContain('Thread messages could not be saved')
  await expect(host.close()).rejects.toThrow('Thread messages could not be saved')
  expect(vi.getTimerCount()).toBe(0)
})

it('never writes retained failures to disk after history is turned off or back on', async () => {
  let history = true
  const { directory, adapter, host } = await fixture(() => history)
  const append = failWrites()
  adapter.publish(added('reply', 'PRIVATE FAILED TEXT'))
  host.workspaceSnapshot()
  history = false
  append.mockRestore()
  await host.privacyChanged()
  expect(host.threadMessages('session-workshop')).toMatchObject([{ text: 'PRIVATE FAILED TEXT' }])
  const offFailure = failWrites()
  adapter.publish(added('off', 'PRIVATE OFF TEXT'))
  host.workspaceSnapshot()
  history = true
  await host.privacyChanged()
  offFailure.mockRestore()
  adapter.publish(added('new', 'New retained reply'))
  await host.close()
  const disk = (await Promise.all((await readdir(directory)).map(file => readFile(join(directory, file), 'latin1').catch(() => '')))).join(' ')
  expect(disk).not.toContain('PRIVATE FAILED TEXT')
  expect(disk).not.toContain('PRIVATE OFF TEXT')
  const reopened = new ThreadStore(join(directory, 'threads.sqlite'))
  reopened.open()
  try { expect(reopened.readMessages('session-workshop').messages).toMatchObject([{ id: 'new', text: 'New retained reply' }]) }
  finally { reopened.close() }
})

it('keeps normal streaming coalesced and commits each event exactly once', async () => {
  const { adapter, host } = await fixture()
  vi.useFakeTimers()
  const append = vi.spyOn(ThreadStore.prototype, 'appendMany')
  const unsubscribe = host.subscribe(() => undefined)
  adapter.publish(added())
  for (let i = 0; i < 600; i++) adapter.publish(appended('x'))
  await vi.advanceTimersByTimeAsync(16)
  expect(append.mock.calls.length).toBeLessThanOrEqual(2)
  expect(host.eventsAfter(0, undefined, 1_000)).toHaveLength(601)
  expect(host.threadMessages('session-workshop')[0]?.text).toBe('First chunk' + 'x'.repeat(600))
  unsubscribe()
})

it('keeps a failed thread warning while another thread commits, then restores reset order', async () => {
  const { adapter, host } = await fixture()
  vi.useFakeTimers()
  const original = ThreadStore.prototype.appendMany
  const append = vi.spyOn(ThreadStore.prototype, 'appendMany').mockImplementation(function (this: ThreadStore, threadId, events) {
    if (threadId === 'session-workshop') throw new Error('Synthetic failure for one thread')
    return original.call(this, threadId, events)
  })
  adapter.publish(added())
  host.workspaceSnapshot()
  adapter.publish(added('other', 'Healthy thread'), 'other-thread')
  adapter.publish({ kind: 'messages-reset', at, historyEpoch: 'reset' })
  adapter.publish(added('replacement', 'After reset'))
  expect(host.eventsAfter(0).map(row => row.threadId)).toEqual(['other-thread'])
  expect(host.workspaceSnapshot().error).toContain('Thread messages could not be saved')
  append.mockRestore()
  await vi.advanceTimersByTimeAsync(1_000)
  expect(host.workspaceSnapshot().error).toBeUndefined()
  expect(host.threadMessages('session-workshop')).toMatchObject([{ id: 'replacement', text: 'After reset' }])
  expect(host.eventsAfter(0, 'session-workshop').map(row => row.event.kind)).toEqual(['message-added', 'messages-reset', 'message-added'])
})
