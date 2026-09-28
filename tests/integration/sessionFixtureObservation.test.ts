// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { claudeFixture } from '../fixtures/claudeFixture'
import { grokFixture } from '../fixtures/fakeGrokThreadFixture'

it('does not call a resumed running Claude process stopped because an earlier process exited', async () => {
  const f = await claudeFixture()
  const id = randomUUID()
  try {
    await f.host.connect()
    await f.host.execute({ type: 'create-project', commandId: randomUUID(), projectId: f.projectId, title: 'Synthetic project', path: f.root })
    await f.host.execute({ type: 'create-thread', commandId: randomUUID(), threadId: id, projectId: f.projectId, modelId: f.modelId, title: 'Synthetic thread' })
    f.host.observeThreads?.([id])
    const before = await f.sessions!.starts(id)
    f.adapter.disconnect()
    await f.adapter.closed()
    await expect.poll(() => f.sessions!.stopped(id)).toBe(true)
    await f.host.connect()
    await f.host.execute({ type: 'send', commandId: randomUUID(), threadId: id, messageId: 'resumed-prompt', text: 'Synthetic running prompt' })
    await expect.poll(() => f.sessions!.starts(id)).toBeGreaterThan(before)
    await expect.poll(async () => (await f.host.snapshot()).threads.find(thread => thread.id === id)?.status).toBe('running')
    const processId = (await f.liveSettings.effective(id)).process
    expect(process.kill(processId!, 0)).toBe(true)
    expect(await f.sessions!.stopped(id)).toBe(false)
  } finally { await f.cleanup() }
})

it('observes accepted Grok closes and the current resumed session, not old or rejected closes', async () => {
  const f = await grokFixture(undefined, undefined, undefined, { reaperSweepMs: 20, sessionIdleMs: 150 })
  const id = randomUUID()
  try {
    await f.script({ rejectClose: true })
    await f.host.connect()
    await f.host.execute({ type: 'create-project', commandId: randomUUID(), projectId: f.projectId, title: 'Synthetic project', path: f.root })
    await f.host.execute({ type: 'create-thread', commandId: randomUUID(), threadId: id, projectId: f.projectId, modelId: f.modelId, title: 'Synthetic thread' })
    await expect.poll(async () => (await f.driver.requests()).some(record => record.method === '_x.ai/session/close')).toBe(true)
    expect(await f.sessions.stopped(id)).toBe(false)
    await f.script({})
    await expect.poll(() => f.sessions.stopped(id)).toBe(true)
    const before = await f.sessions.starts(id)
    await f.host.execute({ type: 'send', commandId: randomUUID(), threadId: id, messageId: 'resumed-prompt', text: 'Synthetic running prompt' })
    await expect.poll(() => f.sessions.starts(id)).toBeGreaterThan(before)
    await expect.poll(async () => (await f.host.snapshot()).threads.find(thread => thread.id === id)?.status).toBe('running')
    expect(await f.sessions.stopped(id)).toBe(false)
  } finally { await f.cleanup() }
})
