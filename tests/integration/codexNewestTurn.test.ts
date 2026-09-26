// @vitest-environment node
/**
 * The check before a Codex send (#324). A send asks Codex for its newest turn alone, with `thread/turns/list`,
 * and reads the whole transcript only when that turn is not the finished one Sotto already holds. These cases
 * run against the fake app-server in `tests/fixtures/`, whose `native-turn` and `native-rewind` actions stand in
 * for a second Codex process on the same session: what it does reaches the shared history and never this
 * connection's stream. The takeover and stale-reply contract itself is `adapterContract.ts`'s, unchanged.
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { codexFixture, type RecordedRpc } from '../fixtures/codexFixture'

type Fixture = Awaited<ReturnType<typeof codexFixture>>
const fixtures: Fixture[] = []
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.cleanup() })

/** A thread that has sent `own-1` and whose turn has finished, so its newest turn is one Sotto holds. */
async function answeredThread(script: Record<string, unknown> = {}): Promise<{ f: Fixture; id: string }> {
  const f = await codexFixture(); fixtures.push(f)
  await f.script(script)
  await f.host.connect()
  await f.host.execute({ type: 'create-project', commandId: randomUUID(), projectId: f.projectId, title: 'Project', path: f.root })
  const id = randomUUID()
  await f.host.execute({ type: 'create-thread', commandId: randomUUID(), threadId: id, projectId: f.projectId, modelId: f.modelId, title: 'Newest turn' })
  f.host.observeThreads?.([id])
  await turn(f, id, 'own-1')
  return { f, id }
}
async function turn(f: Fixture, id: string, messageId: string, expectedLastUserMessageId?: string): Promise<void> {
  await expect(send(f, id, messageId, expectedLastUserMessageId)).resolves.toEqual({ accepted: true })
  await f.driver.completeTurn(id, `Reply to ${messageId}`)
  await expect.poll(async () => (await f.host.snapshot()).threads.find(thread => thread.id === id)?.status).toBe('idle')
}
const send = (f: Fixture, id: string, messageId: string, expectedLastUserMessageId?: string) =>
  f.host.execute({ type: 'send', threadId: id, commandId: randomUUID(), messageId, text: `Prompt ${messageId}`, ...(expectedLastUserMessageId ? { expectedLastUserMessageId } : {}) })
/** Act as a second Codex process, and wait until the fake's shared history holds what it did. */
async function elsewhere(f: Fixture, id: string, action: Record<string, unknown>): Promise<void> {
  const codexThreadId = await f.realId(id)
  const turns = async () => (JSON.parse(await readFile(join(f.root, 'state.json'), 'utf8')) as { threads: Record<string, { turns: unknown[] }> }).threads[codexThreadId]!.turns.length
  const before = await turns()
  await f.action(id, action)
  await expect.poll(turns).not.toBe(before)
}
/** The history requests made since `from`, as `turns` (the newest-turn check) and `read` (the whole transcript). */
async function historyRequests(f: Fixture, from: number): Promise<('turns' | 'read')[]> {
  return (await f.driver.requests()).slice(from).flatMap((request: RecordedRpc) => request.method === 'thread/turns/list' ? ['turns' as const]
    : request.method === 'thread/read' && request.params?.includeTurns === true ? ['read' as const] : [])
}

describe('Codex send checks the newest turn before reading the whole transcript', () => {
  it('sends after a finished turn on the newest turn alone', async () => {
    const { f, id } = await answeredThread()
    const from = (await f.driver.requests()).length
    await turn(f, id, 'own-2', 'own-1')
    expect(await historyRequests(f, from)).toEqual(['turns'])
    const check = (await f.driver.requests()).slice(from).find(request => request.method === 'thread/turns/list')
    expect(check?.params).toEqual({ threadId: await f.realId(id), limit: 1, sortDirection: 'desc', itemsView: 'full' })
    const messages = (await f.host.snapshot()).threads.find(thread => thread.id === id)!.messages
    expect(messages.filter(message => message.role === 'user').map(message => message.id)).toEqual(['own-1', 'own-2'])
  })

  it('sends on the newest turn alone when Codex names history items differently from its stream', async () => {
    const { f, id } = await answeredThread({ historyItemIds: true })
    const from = (await f.driver.requests()).length
    await turn(f, id, 'own-2', 'own-1')
    await turn(f, id, 'own-3', 'own-2')
    expect(await historyRequests(f, from)).toEqual(['turns', 'turns'])
    const messages = (await f.host.snapshot()).threads.find(thread => thread.id === id)!.messages
    expect(messages.map(message => [message.role, message.text])).toEqual(['own-1', 'own-2', 'own-3']
      .flatMap(own => [['user', `Prompt ${own}`], ['assistant', `Reply to ${own}`]]))
  })

  it('reads the whole transcript and refuses a stale reply when another Codex process added a turn', async () => {
    const { f, id } = await answeredThread()
    await elsewhere(f, id, { type: 'native-turn', text: 'Typed in another Codex' })
    const from = (await f.driver.requests()).length
    await expect(send(f, id, 'stale', 'own-1')).rejects.toThrow('changed')
    expect(await historyRequests(f, from)).toEqual(['turns', 'read'])
    const thread = (await f.host.snapshot()).threads.find(candidate => candidate.id === id)!
    expect(thread.messages.some(message => message.role === 'user' && message.text === 'Typed in another Codex' && message.commandId === undefined)).toBe(true)
    expect((await f.driver.requests()).slice(from).some(request => request.method === 'turn/start')).toBe(false)
  })

  it('reads the whole transcript when another Codex process is still running a turn', async () => {
    const { f, id } = await answeredThread()
    await elsewhere(f, id, { type: 'native-turn', text: 'Still being answered', status: 'inProgress' })
    const from = (await f.driver.requests()).length
    await expect(send(f, id, 'stale', 'own-1')).rejects.toThrow('changed')
    expect(await historyRequests(f, from)).toEqual(['turns', 'read'])
  })

  it('reads the whole transcript when another Codex process took the newest turn back', async () => {
    const { f, id } = await answeredThread()
    await turn(f, id, 'own-2', 'own-1')
    await elsewhere(f, id, { type: 'native-rewind' })
    const from = (await f.driver.requests()).length
    await send(f, id, 'after-rewind', 'own-2').catch(() => undefined)
    expect(await historyRequests(f, from)).toEqual(['turns', 'read'])
  })

  it('reads the whole transcript on a Codex without thread/turns/list, and stops asking on that connection', async () => {
    const { f, id } = await answeredThread()
    // How Codex 0.157.1 answers a request it does not have.
    await f.script({ reject: 'thread/turns/list', rejection: { code: -32600, message: 'Invalid request: unknown variant `thread/turns/list`, expected one of `initialize`' } })
    const from = (await f.driver.requests()).length
    await turn(f, id, 'own-2', 'own-1')
    await turn(f, id, 'own-3', 'own-2')
    expect(await historyRequests(f, from)).toEqual(['turns', 'read', 'read'])
  })
})
