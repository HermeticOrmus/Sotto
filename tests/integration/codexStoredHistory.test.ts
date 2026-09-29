// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ThreadStore } from '../../src/main/agents/threadStore'
import { codexFixture } from '../fixtures/codexFixture'

it.each([false, true])('keeps Codex replies in the stored opening window after replaying native user receipts, existing duplicates=%s', async existingDuplicates => {
  const f = await codexFixture()
  const store = new ThreadStore(join(f.root, 'threads.sqlite')); store.open()
  f.adapter.useThreadHistory(store)
  const off = f.adapter.subscribeEvents(({ threadId, event }) => store.append(threadId, event))
  const threadId = randomUUID()
  try {
    await f.host.connect()
    await f.host.execute({ type: 'create-project', commandId: randomUUID(), projectId: f.projectId, title: 'History', path: f.root })
    await f.host.execute({ type: 'create-thread', commandId: randomUUID(), threadId, projectId: f.projectId, title: 'History', modelId: f.modelId })
    f.host.observeThreads?.([threadId])
    for (let i = 0; i < 10; i++) {
      await f.host.execute({ type: 'send', commandId: randomUUID(), messageId: randomUUID(), threadId, text: `Prompt ${i}` })
      await f.driver.completeTurn(threadId, `Reply ${i}`)
      await expect.poll(async () => (await f.host.snapshot()).threads.find(t => t.id === threadId)?.status).toBe('idle')
    }
    const before = store.readMessages(threadId, { turns: 10 }).messages
    expect(before.filter(m => m.role === 'assistant')).toHaveLength(10)
    const nativeId = await f.realId(threadId)
    const native = JSON.parse(await readFile(join(f.root, 'state.json'), 'utf8')).threads[nativeId]
    f.host.disconnect(); await f.adapter.closed()
    if (existingDuplicates) for (const turn of native.turns) store.append(threadId, { kind: 'message-added', at: new Date().toISOString(), message: {
      id: turn.items[0].id, role: 'user', text: turn.items[0].content[0].text, createdAt: new Date().toISOString(),
    } })
    if (existingDuplicates) expect(store.readMessages(threadId, { turns: 10 }).messages.filter(m => m.role === 'assistant')).toHaveLength(0)
    // Codex 0.159 persists item_completed user receipts with native IDs. Their
    // client identity is not on the event envelope the rollout watcher reads.
    const sessions = join(f.root, 'home', 'sessions'); await mkdir(sessions, { recursive: true })
    await writeFile(join(sessions, `rollout-${nativeId}.jsonl`), native.turns.map((turn: { items: { id: string; content: unknown }[] }) =>
      JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: {
        type: 'item_completed', item: { type: 'UserMessage', id: turn.items[0]!.id, content: turn.items[0]!.content },
      } })).join('\n') + '\n')
    await f.host.connect()
    expect(store.readMessages(threadId, { turns: 10 }).messages).toEqual(before)
    expect(store.readMessages(threadId, { turns: 10 }).messages.filter(m => m.role === 'assistant')).toHaveLength(10)
    store.rebuild()
    expect(store.readMessages(threadId, { turns: 10 }).messages).toEqual(before)
    // Identical words from a distinct native message are still outside input.
    await appendFile(join(sessions, `rollout-${nativeId}.jsonl`), JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', payload: {
      type: 'item_completed', item: { type: 'UserMessage', id: 'outside-input', content: [{ type: 'text', text: 'Prompt 9' }] },
    } }) + '\n')
    await f.adapter.pollSessionLogs()
    expect(store.readMessages(threadId).messages).toHaveLength(21)
    expect(store.readMessages(threadId).messages.at(-1)).toMatchObject({ role: 'user', text: 'Prompt 9' })
    expect(store.readMessages(threadId).messages.at(-1)?.commandId).toBeUndefined()
  } finally {
    off(); store.close(); await f.cleanup()
  }
})
