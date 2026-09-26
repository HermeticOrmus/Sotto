// @vitest-environment node
/**
 * A command's reply as a receipt (issue #323), end to end: the `AGENT_COMMAND` handler with the
 * broadcaster's receipt encoder, the desktop host router and the local host service joined as `index.ts`
 * joins them, an IPC stand-in that copies every message the way a structured clone would, the main
 * window's preload bridge, and the page's wrapped bridge that `AgentContext` reads. The broadcast is sent
 * by hand through the same broadcaster, so the window holds exactly what main recorded as sent.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { deserialize, serialize } from 'node:v8'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IpcInvocationEvent, IpcMainAdapter, TrustedIpcSender } from '../../../src/main/ipc/registerIpc'
import { AGENT_COMMAND, AGENT_GET, AGENT_STATE, agentCommandReceiptSchema, type AgentBridge, type AgentHostSnapshot, type AgentModel, type AgentState } from '../../../src/shared/agents'
import { AgentControl } from '../../../src/main/agents/control'
import { AgentCredentials } from '../../../src/main/agents/credentials'
import { LocalHostService } from '../../../src/main/agents/hostService'
import { AgentStateBroadcaster } from '../../../src/main/agents/agentStateBroadcast'
import { E2EAgentHost, e2eAgentReasoner } from '../../../src/main/e2e/agentEffects'
import { DesktopHostRouter } from '../../../src/main/hosts/desktopHostRouter'
import { emptyDesktopState } from '../../../src/main/hosts/inactiveLocalHost'
import { wrapAgentBridge } from '../../../src/renderer/src/agents/agentStateCatalogs'
import { ThreadDraftStore } from '../../../src/renderer/src/agents/threadDraftStore'
import { immediatePublishScheduler } from '../../fixtures/publishScheduler'
import { syntheticModelCatalog } from '../../fixtures/modelCatalog'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => 'D:/fixture' },
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
}))
import { registerAgentIpc } from '../../../src/main/agents/ipc'
import { createSottoBridge } from '../../../src/preload'

const HOST_ID = '11111111-1111-4111-8111-111111111111'
/** The fixture coordinator has no host ID of its own, so the router passes its thread IDs through unkeyed. */
const WORKSHOP = 'workshop'
const roots: string[] = []
const disposables: Array<() => void> = []
afterEach(async () => {
  for (const dispose of disposables.splice(0)) dispose()
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.includes('sotto-command-receipt-')) throw new Error('Unexpected fixture directory')
    await rm(root, { recursive: true, force: true })
  }
})

/** The fixture host with a large catalog after its own model, which a test can change as a provider would. */
class CatalogHost extends E2EAgentHost {
  catalog: AgentModel[] = syntheticModelCatalog()
  override async snapshot(): Promise<AgentHostSnapshot> {
    const snapshot = await super.snapshot()
    return { ...snapshot, models: [...snapshot.models, ...structuredClone(this.catalog)] }
  }
}

const clone = <T>(value: T): T => deserialize(serialize(value)) as T

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sotto-command-receipt-')); roots.push(root)
  const host = new CatalogHost()
  const credentials = new AgentCredentials(root, { isEncryptionAvailable: () => false, encryptString: text => Buffer.from(text), decryptString: bytes => bytes.toString() })
  await credentials.load()
  const control = new AgentControl({ schedule: immediatePublishScheduler, directory: root, host, credentials, reasoner: e2eAgentReasoner,
    membership: { status: async () => ({ status: 'beta', label: 'Fixture', expiresAt: null }), action: async () => ({ status: 'beta', label: 'Fixture', expiresAt: null }) } })
  disposables.push(() => control.dispose())
  await control.start(); await control.command({ type: 'connect' })

  const router = new DesktopHostRouter(() => emptyDesktopState(HOST_ID))
  disposables.push(() => router.dispose())
  router.add({ hostId: HOST_ID, name: 'This computer', kind: 'local', service: new LocalHostService({ control }),
    detail: threadId => control.threadDetail(threadId), preview: () => null })

  const handlers = new Map<string, (event: IpcInvocationEvent, ...args: unknown[]) => unknown>()
  const ipc: IpcMainAdapter = { handle: (channel, handler) => { handlers.set(channel, handler) }, removeHandler: channel => { handlers.delete(channel) } }
  const url = 'file:///main.html'
  const main: TrustedIpcSender = { role: 'main', url, webContents: { mainFrame: { parent: null, url }, isDestroyed: () => false, getURL: () => url } }
  const broadcaster = new AgentStateBroadcaster()
  disposables.push(registerAgentIpc(ipc, router, router, () => [main], 'win32', { status: vi.fn(), download: vi.fn() },
    { synthesize: vi.fn(), voices: vi.fn(), cancel: vi.fn() }, { synthesize: vi.fn(), cancel: vi.fn() }, undefined, broadcaster))

  // What crossed from main to the window, as it arrived there.
  const wire: Array<{ channel: string; payload: unknown }> = []
  let listener: ((event: unknown, payload: unknown) => void) | null = null
  const renderer = {
    invoke: async (channel: string, ...args: unknown[]) => {
      const payload = clone(await handlers.get(channel)!({ sender: main.webContents, senderFrame: main.webContents.mainFrame }, ...args))
      wire.push({ channel, payload })
      return payload
    },
    on: (channel: string, next: (event: unknown, payload: unknown) => void) => { if (channel === AGENT_STATE) listener = next },
    removeListener: () => undefined,
  }
  const page = wrapAgentBridge(createSottoBridge(renderer, 'win32').agents as AgentBridge)
  const seen: AgentState[] = []
  disposables.push(page.onState(state => seen.push(state)))
  const broadcast = (): void => { broadcaster.send(router.shell(), 'main', payload => { listener!({}, clone(payload)); return true }) }
  const gets = (): number => wire.filter(entry => entry.channel === AGENT_GET).length
  const replies = (): unknown[] => wire.filter(entry => entry.channel === AGENT_COMMAND).map(entry => entry.payload)
  return { control, host, router, page, seen, broadcast, gets, replies }
}

const saveDraft = (text: string) => ({ type: 'save-thread-draft' as const, threadId: WORKSHOP, draftId: randomUUID(), text })

describe('a command receipt', () => {
  it('carries no model entries for a draft save on an unchanged catalog', async () => {
    const f = await fixture()
    f.broadcast()
    expect(f.seen[0]!.host.models).toHaveLength(609)

    const reply = await f.page.command(saveDraft('Keep this draft'))
    const [wire] = f.replies() as [Record<string, unknown>]
    const onWire = agentCommandReceiptSchema.parse(wire)
    expect(onWire.host.models).toEqual({ revision: 1, omitted: true })
    expect(onWire.host.clientHosts?.map(client => client.models)).toEqual([{ revision: 1, omitted: true }])
    expect(JSON.stringify(wire)).not.toContain('synthetic-model')
    expect(serialize(wire).length).toBeLessThan(10_000)
    // The page puts back the catalog the broadcast sent, without asking main for it.
    expect(f.gets()).toBe(0)
    expect(reply.host.models).toBe(f.seen[0]!.host.models)
    expect(reply.host.clientHosts![0]!.models).toBe(f.seen[0]!.host.clientHosts![0]!.models)
  })

  it('recovers a stale catalog once, then resolves revision-only replies from it', async () => {
    const f = await fixture()
    f.broadcast()
    // A provider changes its catalog; this window still holds revision 1 when the next replies land.
    f.host.catalog = f.host.catalog.map(model => ({ ...model, ready: !model.ready }))
    await f.control.command({ type: 'refresh' })

    const [first, second] = await Promise.all([f.page.command(saveDraft('One')), f.page.command(saveDraft('Two'))])
    expect(f.gets()).toBe(1)
    const changed = f.router.shell().host.models
    expect(first.host.models).toEqual(changed)
    expect(second.host.models).toEqual(changed)

    const third = await f.page.command(saveDraft('Three'))
    expect(f.gets()).toBe(1)
    expect(third.host.models).toEqual(changed)
    expect((f.replies() as AgentState[]).map(reply => reply.host.models)).toEqual(Array(3).fill({ revision: 2, omitted: true }))
    // The broadcast that follows still carries revision 2 in full, since main never sent it, and the
    // window resolves it without a second recovery either way.
    f.broadcast()
    expect(f.seen.at(-1)!.host.models).toEqual(changed)
    expect(f.gets()).toBe(1)
  })

  it('still gives the draft store the exact revision it acknowledged', async () => {
    const f = await fixture()
    f.broadcast()
    const acknowledged: AgentState[] = []
    const drafts = new ThreadDraftStore(async command => { const reply = await f.page.command(command); acknowledged.push(reply); return reply }, 0)
    drafts.edit(WORKSHOP, { text: 'Measure the reply' })
    const draftId = drafts.draft(WORKSHOP).draftId
    drafts.flush(WORKSHOP)
    await vi.waitFor(() => expect(drafts.snapshot(WORKSHOP).save).toBe('saved'))
    expect(drafts.snapshot(WORKSHOP).saveError).toBeNull()
    expect(acknowledged.at(-1)!.threadDraftPersistence).toContainEqual({ threadId: WORKSHOP, draftId, status: 'saved' })
    expect(acknowledged.at(-1)!.host.models).toHaveLength(609)
  })

  it('still gives a settings card the effective settings', async () => {
    const f = await fixture()
    f.broadcast()
    const reply = await f.page.command({ type: 'configure', patch: { speak: false, followupLimit: 3 } })
    expect(reply.error).toBeNull()
    expect(reply.configuration).toEqual(f.control.get().configuration)
    expect(reply.configuration).toMatchObject({ speak: false, followupLimit: 3 })
    expect((f.replies()[0] as AgentState).configuration).toEqual(reply.configuration)
    expect(f.gets()).toBe(0)
  })
})
