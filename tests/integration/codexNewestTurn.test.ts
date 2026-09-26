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
import { AgentControl } from '../../src/main/agents/control'
import { AgentCredentials } from '../../src/main/agents/credentials'
import { codexFixture, type RecordedRpc } from '../fixtures/codexFixture'
import { immediatePublishScheduler } from '../fixtures/publishScheduler'

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
  const turns = async () => JSON.stringify((JSON.parse(await readFile(join(f.root, 'state.json'), 'utf8')) as { threads: Record<string, { turns: unknown[] }> }).threads[codexThreadId]!.turns)
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

  it('reads the whole transcript when another Codex process took the newest turn back, then sends as a whole read always did', async () => {
    const { f, id } = await answeredThread()
    await turn(f, id, 'own-2', 'own-1')
    await elsewhere(f, id, { type: 'native-rewind' })
    const from = (await f.driver.requests()).length
    // A read takes no words back unless Sotto asked for the rewind itself, so the last user message it holds is
    // still own-2 and the send goes, exactly as it did when every send read the whole transcript.
    await expect(send(f, id, 'after-rewind', 'own-2')).resolves.toEqual({ accepted: true })
    expect((await f.driver.requests()).slice(from).flatMap(request => ['thread/turns/list', 'thread/read', 'turn/start'].includes(request.method ?? '') ? [request.method] : []))
      .toEqual(['thread/turns/list', 'thread/read', 'turn/start'])
    const messages = (await f.host.snapshot()).threads.find(thread => thread.id === id)!.messages
    expect(messages.filter(message => message.role === 'user').map(message => message.id)).toEqual(['own-1', 'own-2', 'after-rewind'])
  })

  it('reads the whole transcript and refuses a stale reply when the newest turn holds a message Sotto cannot match', async () => {
    const { f, id } = await answeredThread()
    await elsewhere(f, id, { type: 'native-message', text: 'Added to the newest turn elsewhere' })
    const from = (await f.driver.requests()).length
    await expect(send(f, id, 'stale', 'own-1')).rejects.toThrow('changed')
    expect(await historyRequests(f, from)).toEqual(['turns', 'read'])
    expect((await f.driver.requests()).slice(from).some(request => request.method === 'turn/start')).toBe(false)
  })

  it('leaves the thread as it was when the newest turn does not match and the whole read then fails', async () => {
    const { f, id } = await answeredThread()
    await elsewhere(f, id, { type: 'native-message', text: 'Added to the newest turn elsewhere' })
    const shown = async () => (await f.host.snapshot()).threads.find(thread => thread.id === id)!.messages.map(message => [message.id, message.text])
    const before = await shown()
    await f.script({ reject: 'thread/read' })
    const from = (await f.driver.requests()).length
    await expect(send(f, id, 'unread', 'own-1')).rejects.toThrow()
    expect(await historyRequests(f, from)).toEqual(['turns', 'read'])
    expect((await f.driver.requests()).slice(from).some(request => request.method === 'turn/start')).toBe(false)
    expect(await shown()).toEqual(before)
  })

  it('refuses a stale reply on the check alone when the input was typed into the Codex session log', async () => {
    const { f, id } = await answeredThread()
    await f.driver.typeInProvider(id, 'Typed in the Codex CLI')
    await expect.poll(async () => (await f.host.snapshot()).threads.find(thread => thread.id === id)!.messages.some(message => message.text === 'Typed in the Codex CLI')).toBe(true)
    const from = (await f.driver.requests()).length
    // On a thread Sotto has read, session-log input is shown as soon as it is polled, so the newest turn still
    // matches and the stale-reply check after it is what refuses. The log holds input back only for a thread
    // with no history on this connection, and such a thread reads the whole transcript anyway.
    await expect(send(f, id, 'stale', 'own-1')).rejects.toThrow('changed')
    expect(await historyRequests(f, from)).toEqual(['turns'])
    expect((await f.driver.requests()).slice(from).some(request => request.method === 'turn/start')).toBe(false)
  })

  it('reads the whole transcript when Codex refuses the check, and asks again on the next send', async () => {
    const { f, id } = await answeredThread()
    await f.script({ reject: 'thread/turns/list' })
    const from = (await f.driver.requests()).length
    await turn(f, id, 'own-2', 'own-1')
    await turn(f, id, 'own-3', 'own-2')
    expect(await historyRequests(f, from)).toEqual(['turns', 'read', 'turns'])
  })

  it('asks again on the next send when Codex names an unknown value rather than the request', async () => {
    const { f, id } = await answeredThread()
    // How Codex 0.157.1 answers a params value it does not know, here an itemsView it has no such view for.
    await f.script({ reject: 'thread/turns/list', rejection: { code: -32600, message: 'Invalid request: unknown variant `bogus`, expected one of `notLoaded`, `summary`, `full`' } })
    const from = (await f.driver.requests()).length
    await turn(f, id, 'own-2', 'own-1')
    await turn(f, id, 'own-3', 'own-2')
    expect(await historyRequests(f, from)).toEqual(['turns', 'read', 'turns'])
  })

  it('checks the newest turn before a personal-chat send', async () => {
    const f = await codexFixture(); fixtures.push(f)
    await f.host.connect()
    const id = randomUUID()
    await f.adapter.createPersonalConversation({ commandId: randomUUID(), threadId: id, modelId: f.modelId, title: 'Personal', workingDirectory: f.root })
    const personal = (messageId: string, expectedLastUserMessageId?: string) => f.adapter.sendPersonalConversation({ type: 'send', commandId: randomUUID(), threadId: id,
      messageId, text: `Prompt ${messageId}`, ...(expectedLastUserMessageId ? { expectedLastUserMessageId } : {}) }, [])
    const answered = async (messageId: string, expectedLastUserMessageId?: string) => {
      await expect(personal(messageId, expectedLastUserMessageId)).resolves.toEqual({ accepted: true })
      await f.driver.completeTurn(id, `Reply to ${messageId}`)
      await expect.poll(() => f.adapter.personalSnapshot().find(thread => thread.id === id)?.status).toBe('idle')
    }
    await answered('own-1')
    const from = (await f.driver.requests()).length
    await answered('own-2', 'own-1')
    // One check before the chat's own instructions are resumed and one inside the send itself; neither reads whole.
    expect(await historyRequests(f, from)).toEqual(['turns', 'turns'])
    await elsewhere(f, id, { type: 'native-turn', text: 'Typed in another Codex' })
    const stale = (await f.driver.requests()).length
    // The chat's own check reads the whole transcript; the send's check then finds the newest turn it just read.
    await expect(personal('stale', 'own-2')).rejects.toThrow('changed')
    expect(await historyRequests(f, stale)).toEqual(['turns', 'read', 'turns'])
    expect((await f.driver.requests()).slice(stale).some(request => request.method === 'turn/start')).toBe(false)
  })

  it('reads the whole transcript when the newest turn does not say it carries the full items', async () => {
    // Sotto's turn schema takes a missing itemsView as full; the check does not, so a summary cannot pass as the turn.
    const { f, id } = await answeredThread({ omitTurnsListItemsView: true })
    const from = (await f.driver.requests()).length
    await turn(f, id, 'own-2', 'own-1')
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

describe('A send from the Threads page uses the newest-turn check', () => {
  /** The coordinator over the wrapped adapter, as the app composes it, with one answered thread. */
  async function coordinated(): Promise<{ f: Fixture; id: string; control: AgentControl }> {
    const f = await codexFixture(undefined, true); fixtures.push(f)
    const credentials = new AgentCredentials(join(f.root, 'vault'), { isEncryptionAvailable: () => false, encryptString: value => Buffer.from(value), decryptString: value => value.toString() })
    await credentials.load()
    const control = new AgentControl({ schedule: immediatePublishScheduler, directory: f.root, host: f.host, credentials,
      reasoner: { intent: async () => ({ type: 'clarify', text: 'Choose a thread' }), decide: async () => ({ decision: 'human', text: 'Review' }) },
      membership: { status: async () => ({ status: 'beta', label: 'Fixture', expiresAt: null }), action: async () => ({ status: 'beta', label: 'Fixture', expiresAt: null }) } })
    controls.push(control)
    await f.host.connect()
    await f.host.execute({ type: 'create-project', commandId: randomUUID(), projectId: f.projectId, title: 'Project', path: f.root })
    const id = randomUUID()
    await f.host.execute({ type: 'create-thread', commandId: randomUUID(), threadId: id, projectId: f.projectId, modelId: f.modelId, title: 'Newest turn' })
    await control.start(); await control.command({ type: 'connect' })
    await control.command({ type: 'observe-threads', threadIds: [id] })
    await manual(f, control, id, 'First prompt')
    return { f, id, control }
  }
  async function manual(f: Fixture, control: AgentControl, id: string, text: string): Promise<void> {
    await control.command({ type: 'manual-send', threadId: id, text })
    await f.driver.completeTurn(id, `Reply to ${text}`)
    await expect.poll(async () => { await control.command({ type: 'refresh' }); return control.get().host.threads.find(thread => thread.id === id)?.status }).toBe('idle')
  }
  const controls: AgentControl[] = []
  afterEach(async () => { for (const control of controls.splice(0)) { control.dispose(); await control.privacyChanged() } })

  /** The history requests made since `from` and before the send's `turn/start`. */
  async function beforeStart(f: Fixture, from: number): Promise<('turns' | 'read')[]> {
    const sent = (await f.driver.requests()).slice(from)
    const start = sent.findIndex(request => request.method === 'turn/start')
    expect(start).toBeGreaterThan(-1)
    return sent.slice(0, start).flatMap(request => request.method === 'thread/turns/list' ? ['turns' as const]
      : request.method === 'thread/read' && request.params?.includeTurns === true ? ['read' as const] : [])
  }

  it('checks the newest turn, not the whole transcript, before turn/start', async () => {
    const { f, id, control } = await coordinated()
    const from = (await f.driver.requests()).length
    await control.command({ type: 'manual-send', threadId: id, text: 'Second prompt' })
    // The coordinator's read before the send and the adapter's own, each the newest turn alone.
    expect(await beforeStart(f, from)).toEqual(['turns', 'turns'])
    expect(control.get().host.threads.find(thread => thread.id === id)!.messages.filter(message => message.role === 'user').map(message => message.text)).toEqual(['First prompt', 'Second prompt'])
  })

  it('reads the whole transcript first when another Codex process added a turn', async () => {
    const { f, id, control } = await coordinated()
    await elsewhere(f, id, { type: 'native-turn', text: 'Typed in another Codex' })
    const from = (await f.driver.requests()).length
    // A manual send is written against what the coordinator's read shows, so after reading the other turn it goes.
    await control.command({ type: 'manual-send', threadId: id, text: 'After the other turn' })
    expect(await beforeStart(f, from)).toEqual(['turns', 'read', 'turns'])
    expect(control.get().host.threads.find(thread => thread.id === id)!.messages.filter(message => message.role === 'user').map(message => message.text))
      .toEqual(['First prompt', 'Typed in another Codex', 'After the other turn'])
  })
})
