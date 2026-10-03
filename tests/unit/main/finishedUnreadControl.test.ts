// @vitest-environment node
/**
 * The coordinator keeps the finished-unread mark (ADR-0046): earned out of sight, cleared by any client showing the
 * thread, published on the shell every client reads, and saved so a restart keeps it.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentControl } from '../../../src/main/agents/control'
import { AgentCredentials } from '../../../src/main/agents/credentials'
import { LocalHostService, desktopWindowClient } from '../../../src/main/agents/hostService'
import { E2EAgentHost, e2eAgentReasoner } from '../../../src/main/e2e/agentEffects'
import type { AgentState } from '../../../src/shared/agents'
import { immediatePublishScheduler } from '../../fixtures/publishScheduler'

const roots: string[] = []
const controls = new Set<AgentControl>()
afterEach(async () => {
  for (const control of controls) control.dispose()
  controls.clear()
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.includes('sotto-finished-unread-')) throw new Error('Unexpected fixture directory')
    await rm(root, { recursive: true, force: true })
  }
})

async function start(root?: string) {
  const directory = root ?? await mkdtemp(join(tmpdir(), 'sotto-finished-unread-'))
  if (root === undefined) roots.push(directory)
  const host = new E2EAgentHost()
  const credentials = new AgentCredentials(directory, { isEncryptionAvailable: () => false, encryptString: text => Buffer.from(text), decryptString: bytes => bytes.toString() })
  await credentials.load()
  const control = new AgentControl({ schedule: immediatePublishScheduler, directory, host, credentials, reasoner: e2eAgentReasoner })
  controls.add(control)
  await control.start()
  if (!control.get().host.connected) await control.command({ type: 'connect' })
  return { root: directory, host, control }
}
const marked = (state: AgentState, id: string): boolean | undefined => state.host.threads.find(thread => thread.id === id)?.finishedUnread
/** A turn on the fixture thread: the prompt starts it running, the reply leaves it idle. */
function runTurn(host: E2EAgentHost, threadId: string): void {
  host.event({ type: 'manual', threadId, text: 'Synthetic prompt' })
  host.event({ type: 'ready', threadId, text: 'Synthetic reply' })
}

describe('the coordinator\'s finished-unread mark', () => {
  it('marks a thread that finishes while no client shows it, on the shell and the whole state', async () => {
    const { host, control } = await start()
    host.event({ type: 'manual', threadId: 'workshop', text: 'Synthetic prompt' })
    expect(marked(control.shell(), 'workshop')).toBeUndefined()
    host.event({ type: 'ready', threadId: 'workshop', text: 'Synthetic reply' })
    expect(marked(control.shell(), 'workshop')).toBe(true)
    expect(marked(control.get(), 'workshop')).toBe(true)
    expect(marked(control.shell(), 'docs')).toBeUndefined()
  })

  it('never marks a thread a client shows while it finishes', async () => {
    const { host, control } = await start()
    await control.commandShell({ type: 'observe-threads', threadIds: ['workshop'] })
    runTurn(host, 'workshop')
    expect(marked(control.shell(), 'workshop')).toBeUndefined()
  })

  it('clears the mark for every client when one shows the thread', async () => {
    const { host, control } = await start()
    runTurn(host, 'workshop')
    const published: AgentState[] = []
    control.subscribe(state => published.push(state))
    const reply = await control.commandShell({ type: 'observe-threads', threadIds: ['workshop'] })
    expect(marked(reply, 'workshop')).toBeUndefined()
    // The other clients hear of it without waiting for the thread to change.
    expect(published.length).toBeGreaterThan(0)
    expect(marked(published.at(-1)!, 'workshop')).toBeUndefined()
  })

  it('takes what any of the host\'s clients shows: the desktop window\'s panes and a phone\'s open thread together', async () => {
    const { host, control } = await start()
    const service = new LocalHostService({ control })
    runTurn(host, 'workshop'); runTurn(host, 'docs')
    await service.command({ type: 'observe-threads', threadIds: ['docs'] }, desktopWindowClient())
    expect(marked(control.shell(), 'docs')).toBeUndefined()
    expect(marked(control.shell(), 'workshop')).toBe(true)
    // The socket server speaks for every paired phone under one client of its own.
    await service.command({ type: 'observe-threads', threadIds: ['workshop'] }, { clientId: 'socket-observations', user: '', transport: 'socket' })
    expect(marked(control.shell(), 'workshop')).toBeUndefined()
  })

  it('earns nothing when the host disconnects with the turn running', async () => {
    const { host, control } = await start()
    host.event({ type: 'manual', threadId: 'workshop', text: 'Synthetic prompt' })
    host.event({ type: 'disconnect', threadId: 'workshop', text: '' })
    host.event({ type: 'ready', threadId: 'workshop', text: 'Synthetic reply' })
    await control.command({ type: 'connect' })
    expect(control.shell().host.connected).toBe(true)
    expect(marked(control.shell(), 'workshop')).toBeUndefined()
  })

  it('keeps the mark across a restart, and keeps a cleared mark cleared', async () => {
    const first = await start()
    runTurn(first.host, 'workshop'); runTurn(first.host, 'docs')
    await first.control.commandShell({ type: 'observe-threads', threadIds: ['docs'] })
    await first.control.closed()
    first.control.dispose(); controls.delete(first.control)
    // Thread IDs only: nothing the thread said is saved with the mark.
    const saved = JSON.parse(await readFile(join(first.root, 'agents.json'), 'utf8')) as { finishedUnread: unknown }
    expect(saved.finishedUnread).toEqual(['workshop'])
    const second = await start(first.root)
    expect(marked(second.control.shell(), 'workshop')).toBe(true)
    expect(marked(second.control.shell(), 'docs')).toBeUndefined()
  })
})
