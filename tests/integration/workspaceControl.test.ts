// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { workspaceFixture } from '../fixtures/workspaceFixture'
import { AgentControl } from '../../src/main/agents/control'
import { AgentCredentials } from '../../src/main/agents/credentials'
import type { AgentState } from '../../src/shared/agents'
import { immediatePublishScheduler } from '../fixtures/publishScheduler'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture(root?: string) {
  const f = await workspaceFixture(root)
  const credentials = new AgentCredentials(join(f.root, 'vault'), { isEncryptionAvailable: () => false, encryptString: value => Buffer.from(value), decryptString: value => value.toString() })
  await credentials.load()
  const opened: string[] = []
  const control = new AgentControl({ schedule: immediatePublishScheduler, directory: f.root, host: f.host, credentials,
    openThreadFolder: async path => { opened.push(path) },
    reasoner: { intent: async () => ({ type: 'clarify', text: 'Choose a thread' }), decide: async () => ({ decision: 'human', text: 'Review' }) },
    membership: { status: async () => ({ status: 'beta', label: 'Test', expiresAt: null }), action: async () => ({ status: 'beta', label: 'Test', expiresAt: null }) } })
  let closing: Promise<void> | undefined
  const close = () => closing ??= (async () => { control.dispose(); await control.privacyChanged(); await f.stop() })()
  cleanup.push(async () => { await close(); await f.remove() })
  await control.start(); await control.command({ type: 'connect' })
  return { ...f, control, opened, close }
}
function thread(state: AgentState) { return state.host.threads.find(thread => thread.id === state.activeThreadId)! }

describe('workspace controller integration', () => {
  it('reopens an uncertain send through the real workspace and reconciles only its exact late receipt without replay', async () => {
    const first = await fixture()
    const threadId = first.control.get().host.threads.find(thread => thread.providerId === 'codex')!.id
    const nativeId = first.registry.byThread(threadId)!.sessionId
    const original = first.adapters.codex.execute.bind(first.adapters.codex)
    const execute = vi.spyOn(first.adapters.codex, 'execute').mockImplementation(async command => {
      if (command.type !== 'send') return original(command)
      return { accepted: false, uncertain: true }
    })
    const prompt = { type: 'manual-send' as const, threadId, draftId: randomUUID(), text: 'Keep this exact synthetic prompt' }
    const saved = async () => JSON.parse(await readFile(join(first.root, 'agents.json'), 'utf8'))
    try {
      expect((await first.control.command(prompt)).deliveries).toContainEqual(expect.objectContaining({ draftId: prompt.draftId, status: 'uncertain' }))
      const intent = (await saved()).outbox[0]
      expect(intent).toMatchObject({ threadId, draftId: prompt.draftId, messageId: expect.any(String), draftDigest: expect.any(String) })
      await first.close()

      // Replace the coordinator, workspace, registry and provider adapters. Only disk crosses this boundary.
      const reopened = await fixture(first.root)
      expect(reopened.registry.byThread(threadId)?.sessionId).toBe(nativeId)
      expect((await saved()).outbox).toEqual([intent])
      await reopened.control.command(prompt)
      expect(reopened.adapters.codex.commands.filter(command => command.type === 'send')).toEqual([])
      const native = reopened.adapters.codex.state.threads.find(thread => thread.id === nativeId)!
      native.messages.push({ id: 'unrelated-message', role: 'user', text: prompt.text, createdAt: new Date().toISOString() })
      reopened.adapters.codex.emit()
      await reopened.control.command({ type: 'refresh' })
      expect((await saved()).outbox).toEqual([intent])

      native.messages.push({ id: intent.messageId, commandId: intent.id, role: 'user', text: prompt.text, createdAt: new Date().toISOString() })
      reopened.adapters.codex.emit()
      await expect.poll(() => reopened.control.get().deliveredDrafts).toContainEqual({ threadId, draftId: prompt.draftId })
      await expect.poll(async () => (await saved()).outbox).toEqual([])
      await reopened.control.command(prompt)
      expect(reopened.adapters.codex.commands.filter(command => command.type === 'send')).toEqual([])
      expect(execute.mock.calls.filter(([command]) => command.type === 'send')).toHaveLength(1)
      await expect.poll(() => reopened.host.threadMessages(threadId).filter(message => message.id === intent.messageId)).toHaveLength(1)
    } finally { execute.mockRestore() }
  })

  it.each(['pending', 'uncertain'] as const)('stops native work while the original send is %s without replacing or replaying it', async delivery => {
    const f = await fixture()
    const threadId = f.control.get().host.threads.find(thread => thread.providerId === 'codex')!.id
    const native = f.adapters.codex.state.threads.find(thread => thread.id === f.registry.byThread(threadId)!.sessionId)!
    const original = f.adapters.codex.execute.bind(f.adapters.codex)
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const execute = vi.spyOn(f.adapters.codex, 'execute').mockImplementation(async command => {
      if (command.type !== 'send') return original(command)
      native.status = 'running'; native.lastTurn = { id: 'unconfirmed-turn', status: 'running' }
      f.adapters.codex.emit()
      if (delivery === 'pending') await held
      return { accepted: false, uncertain: true }
    })
    const prompt = { type: 'manual-send' as const, threadId, draftId: randomUUID(), text: 'Start synthetic work' }
    const sending = f.control.command(prompt)
    let stopping: Promise<AgentState> | undefined
    try {
      await expect.poll(() => f.control.get().host.threads.find(thread => thread.id === threadId)?.status).toBe('running')
      if (delivery === 'uncertain') await sending
      const saved = () => readFile(join(f.root, 'agents.json'), 'utf8').then(text => JSON.parse(text))
      const intent = (await saved()).outbox.find((item: { type: string }) => item.type === 'send')
      expect(intent).toMatchObject({ threadId, draftId: prompt.draftId, messageId: expect.any(String), draftDigest: expect.any(String) })
      stopping = f.control.command({ type: 'interrupt', threadId })
      // The provider cannot finish the pending send until released below; Stop must cross both real layers first.
      await expect.poll(() => execute.mock.calls.filter(([command]) => command.type === 'interrupt').length).toBe(1)
      expect((await stopping).error).toBeNull()
      expect((await saved()).outbox).toEqual([intent])
      expect(f.control.get().host.threads.find(thread => thread.id === threadId)?.status).toBe('idle')
      release(); await sending
      expect(f.control.get().deliveries?.find(item => item.draftId === prompt.draftId)?.status).toBe('uncertain')
      await f.control.command(prompt)
      expect(execute.mock.calls.filter(([command]) => command.type === 'send')).toHaveLength(1)
      expect((await saved()).outbox).toEqual([intent])
      // Only an exact provider echo reconciles the original prompt; Stop alone is not a delivery receipt.
      native.messages.push({ id: intent.messageId, commandId: intent.id, role: 'user', text: prompt.text, createdAt: new Date().toISOString() })
      f.adapters.codex.emit()
      await expect.poll(() => f.control.get().deliveries?.find(item => item.draftId === prompt.draftId)?.status).toBe('accepted')
      await f.control.command(prompt)
      await expect.poll(async () => (await saved()).outbox).toEqual([])
      expect(execute.mock.calls.filter(([command]) => command.type === 'send')).toHaveLength(1)
    } finally { release(); await Promise.allSettled([sending, stopping]); execute.mockRestore() }
  })

  it('releases a rejected interrupt lane before a reconnect, another Stop and a fresh send', async () => {
    const f = await fixture()
    const threadId = f.control.get().host.threads.find(thread => thread.providerId === 'codex')!.id
    const execute = vi.spyOn(f.adapters.codex, 'execute').mockRejectedValueOnce(new Error('Synthetic Stop failure'))
    try {
      expect((await f.control.command({ type: 'interrupt', threadId })).error).toBe('Synthetic Stop failure')
      expect(JSON.parse(await readFile(join(f.root, 'agents.json'), 'utf8')).outbox).toEqual([])
      await f.control.command({ type: 'disconnect', provider: 'codex' })
      expect((await f.control.command({ type: 'connect', provider: 'codex' })).error).toBeNull()
      expect((await f.control.command({ type: 'interrupt', threadId })).error).toBeNull()
      expect((await f.control.command({ type: 'manual-send', threadId, draftId: randomUUID(), text: 'Fresh work after reconnect' })).error).toBeNull()
      expect(f.adapters.codex.commands.map(command => command.type)).toEqual(['interrupt', 'send'])
    } finally { execute.mockRestore() }
  })
  it('opens only the known thread’s validated working folder and rejects arbitrary targets', async () => {
    const f = await fixture()
    const initial = f.control.get()
    const created = await f.control.command({ type: 'create-thread', projectId: initial.host.projects[0]!.id,
      modelId: initial.host.models.find(model => model.providerId === 'codex')!.id, title: 'Shared', workingCopy: 'shared', managed: false })
    const id = created.activeThreadId!
    expect((await f.control.command({ type: 'open-thread-folder', threadId: id })).error).toBeNull()
    expect(f.opened).toEqual([created.host.threads.find(thread => thread.id === id)!.workingDirectory])
    expect((await f.control.command({ type: 'open-thread-folder', threadId: '../arbitrary' })).error).toContain('not known')
    expect(f.opened).toHaveLength(1)
    expect((await f.control.command({ type: 'refresh-thread-worktree', threadId: id })).error).toBeNull()
    expect(f.adapters.codex.commands).toHaveLength(0)
  })
  it('allows an explicit retry after definitive native creation rejection without changing its binding', async () => {
    const f = await fixture()
    const initial = f.control.get()
    const model = initial.host.models.find(model => model.providerId === 'codex')!
    const created = await f.control.command({ type: 'create-thread', projectId: initial.host.projects[0]!.id, modelId: model.id, title: 'Retry', managed: false })
    const id = created.activeThreadId!
    const execute = f.adapters.codex.execute.bind(f.adapters.codex)
    const spy = vi.spyOn(f.adapters.codex, 'execute').mockImplementationOnce(async () => ({ accepted: false }))
    const prompt = { type: 'manual-send' as const, threadId: id, text: 'Try this work' }
    expect((await f.control.command(prompt)).error).toContain('rejected thread creation')
    const binding = f.registry.byThread(id)
    spy.mockImplementation(execute)
    expect((await f.control.command(prompt)).error).toBeNull()
    expect(f.registry.byThread(id)).toEqual(binding)
    expect(f.adapters.codex.commands.map(command => command.type)).toEqual(['create-thread', 'send'])
  })
  it('opens existing projects without changing scope, creates multiple manual threads, and keeps coordinator settings independent', async () => {
    const f = await fixture()
    let state = await f.control.command({ type: 'configure', patch: { reasoning: 'openrouter', reasoningModel: 'independent-coordinator' } })
    const project = state.host.projects.find(project => project.providerId === 'codex')!
    await mkdir(project.path, { recursive: true })
    state = await f.control.command({ type: 'create-project', provider: 'codex', title: 'Open folder', path: project.path, useExisting: true })
    expect(state.error).toBeNull()
    expect(state.activeProjectId).toBe(project.id)
    expect(state.host.projects).toHaveLength(3)
    expect(f.adapters.codex.commands).toHaveLength(0)
    const model = state.host.models.find(model => model.providerId === 'codex')!
    state = await f.control.command({ type: 'create-thread', projectId: project.id, modelId: model.id, title: 'First', managed: false })
    expect(state.error).toBeNull(); const first = thread(state)
    state = await f.control.command({ type: 'create-thread', projectId: project.id, modelId: model.id, title: 'Second', managed: false })
    expect(state.error).toBeNull(); const second = thread(state)
    expect(first.id).not.toBe(second.id)
    expect([first.projectId, second.projectId]).toEqual([project.id, project.id])
    expect(state.assignments).toEqual([])
    await f.control.command({ type: 'disconnect', provider: 'codex' })
    const claude = state.host.models.find(model => model.providerId === 'claude')!
    state = await f.control.command({ type: 'configure-thread', threadId: first.id, modelId: claude.id, reasoningEffort: 'high', runtimeMode: 'approval-required' })
    expect(state.error).toBeNull()
    expect(state.configuration).toMatchObject({ provider: 'codex', reasoning: 'openrouter', reasoningModel: 'independent-coordinator' })
    state = await f.control.command({ type: 'manual-send', threadId: first.id, text: 'Work on this project' })
    expect(state.error).toBeNull()
    expect(state.host.threads.find(thread => thread.id === first.id)).toMatchObject({ projectId: project.id, providerId: 'claude', nativeSessionStarted: true, status: 'running' })
    expect(state.assignments).toEqual([])
    expect(JSON.parse(await readFile(join(f.root, 'agents.json'), 'utf8')).outbox).toEqual([])
  })

  it('settles and restores offline while retaining working requests, attention, IDs and explicit management authority', async () => {
    const f = await fixture()
    const original = f.control.get().host.threads.find(thread => thread.providerId === 'codex')!
    await f.control.command({ type: 'assign', threadId: original.id, instruction: 'Keep watching' })
    const native = f.adapters.codex.state.threads.find(thread => thread.id === f.registry.byThread(original.id)!.sessionId)!
    native.status = 'running'
    native.requests.push({ id: 'permission', kind: 'permission', text: 'Run the build?', options: [] })
    f.adapters.codex.emit()
    // Provider publishes are coalesced in the workspace host, so wait for this one to arrive.
    await expect.poll(() => f.control.get().queue.some(item => item.requestId === 'permission')).toBe(true)
    const before = f.control.get()
    const callCount = f.adapters.codex.commands.length
    let state = await f.control.command({ type: 'settle-thread', threadId: original.id })
    expect(state.error).toBeNull()
    state = await f.control.command({ type: 'settle-project', projectId: original.projectId })
    expect(state.error).toBeNull()
    expect(state.assignments).toEqual(before.assignments)
    expect(state.queue).toEqual(before.queue)
    expect(state.host.threads.find(thread => thread.id === original.id)).toMatchObject({ status: 'running', requests: native.requests, workspaceSettledAt: expect.any(String) })
    expect(f.adapters.codex.commands).toHaveLength(callCount)
    await f.control.command({ type: 'disconnect' })
    state = await f.control.command({ type: 'restore-project', projectId: original.projectId })
    expect(state.error).toBeNull()
    expect(state.host.projects.find(project => project.id === original.projectId)?.workspaceSettledAt).toBeNull()
    expect(state.host.threads.find(thread => thread.id === original.id)?.workspaceSettledAt).toEqual(expect.any(String))
    state = await f.control.command({ type: 'restore-thread', threadId: original.id })
    expect(state.error).toBeNull()
    expect(state.host.threads.find(thread => thread.id === original.id)?.workspaceSettledAt).toBeNull()
    expect(state.queue).toEqual(before.queue)
    expect(f.adapters.codex.commands).toHaveLength(callCount)
  })
})
