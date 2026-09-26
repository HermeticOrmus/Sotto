// @vitest-environment node
/**
 * What one draft save's reply costs to carry when the host lists 608 models (issue #323). The catalog is
 * synthetic (`tests/fixtures/modelCatalog.ts`) and the timers read nothing but durations and byte counts,
 * so no model or draft content is reported. It asserts no time, so it runs only under `SOTTO_PERF_BENCH=1`
 * (`tests/fixtures/perfBench.ts`):
 *
 *   SOTTO_PERF_BENCH=1 npx vitest run tests/perf/commandReceipt.perf.test.ts --maxWorkers=1 --disable-console-intercept
 *
 * The draft save goes the way the desktop window sends it: the page's wrapped bridge, the preload's
 * bridge and its schema, the `AGENT_COMMAND` handler, the desktop host router and the local host service,
 * joined as `index.ts` joins them, with the window already sent the catalog once by the broadcast. Each
 * stage is timed alone. `node:v8`'s `serialize` stands in for Electron's structured clone, as it did for
 * ADR-0028: its length is the reply's size on the wire and a serialize and deserialize is the copy.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deserialize, serialize } from 'node:v8'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { AgentControl, type PublishScheduler } from '../../src/main/agents/control'
import { AgentCredentials } from '../../src/main/agents/credentials'
import { LocalHostService } from '../../src/main/agents/hostService'
import { AgentStateBroadcaster } from '../../src/main/agents/agentStateBroadcast'
import { E2EAgentHost, e2eAgentReasoner } from '../../src/main/e2e/agentEffects'
import { DesktopHostRouter } from '../../src/main/hosts/desktopHostRouter'
import { emptyDesktopState } from '../../src/main/hosts/inactiveLocalHost'
import type { IpcInvocationEvent, IpcMainAdapter, TrustedIpcSender } from '../../src/main/ipc/registerIpc'
import { wrapAgentBridge } from '../../src/renderer/src/agents/agentStateCatalogs'
import { AGENT_COMMAND, AGENT_STATE, type AgentBridge, type AgentCommand, type AgentHostSnapshot, type AgentState } from '../../src/shared/agents'
import { median, PERF_BENCH, round } from '../fixtures/perfBench'
import { syntheticModelCatalog } from '../fixtures/modelCatalog'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => 'D:/fixture' },
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
}))
import { registerAgentIpc } from '../../src/main/agents/ipc'
import { createSottoWidgetBridge } from '../../src/preload'

const WARMUP = 5
const ITERATIONS = 40
const HOST_ID = '11111111-1111-4111-8111-111111111111'

/** The broadcast is sent by hand below; holding the coordinator's own publish closed keeps it out of the timing. */
const neverPublish: PublishScheduler = () => () => undefined

/** The fixture host, listing the synthetic catalog after its own model so its threads still resolve theirs. */
class LargeCatalogHost extends E2EAgentHost {
  private readonly catalog = syntheticModelCatalog()
  override async snapshot(): Promise<AgentHostSnapshot> {
    const snapshot = await super.snapshot()
    return { ...snapshot, models: [...snapshot.models, ...structuredClone(this.catalog)] }
  }
}

async function time(work: () => unknown): Promise<number> {
  for (let index = 0; index < WARMUP; index++) await work()
  const samples: number[] = []
  for (let index = 0; index < ITERATIONS; index++) {
    const started = performance.now()
    await work()
    samples.push(performance.now() - started)
  }
  return round(median(samples), 3)
}

describe.skipIf(!PERF_BENCH)('command receipt size', () => {
  let root = ''
  let dispose: (() => void) | undefined
  afterAll(async () => {
    dispose?.()
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('reports what one draft save reply carries and costs with a 608-model catalog', async () => {
    root = await mkdtemp(join(tmpdir(), 'sotto-perf-command-receipt-'))
    const credentials = new AgentCredentials(root, { isEncryptionAvailable: () => false, encryptString: text => Buffer.from(text), decryptString: bytes => bytes.toString() })
    await credentials.load()
    const control = new AgentControl({ schedule: neverPublish, directory: root, host: new LargeCatalogHost(), credentials, reasoner: e2eAgentReasoner,
      membership: { status: async () => ({ status: 'beta', label: 'Fixture', expiresAt: null }), action: async () => ({ status: 'beta', label: 'Fixture', expiresAt: null }) } })
    await control.start(); await control.command({ type: 'connect' })

    const router = new DesktopHostRouter(() => emptyDesktopState(HOST_ID))
    router.add({ hostId: HOST_ID, name: 'This computer', kind: 'local', service: new LocalHostService({ control }),
      detail: threadId => control.threadDetail(threadId), preview: () => null })
    const handlers = new Map<string, (event: IpcInvocationEvent, ...args: unknown[]) => unknown>()
    const ipc: IpcMainAdapter = { handle: (channel, handler) => { handlers.set(channel, handler) }, removeHandler: channel => { handlers.delete(channel) } }
    const url = 'file:///main.html'
    const main: TrustedIpcSender = { role: 'main', url, webContents: { mainFrame: { parent: null, url }, isDestroyed: () => false, getURL: () => url } }
    const event = { sender: main.webContents, senderFrame: main.webContents.mainFrame }
    const broadcaster = new AgentStateBroadcaster()
    // Before this change `registerAgentIpc` took no receipt encoder and ignores the extra argument.
    const register = registerAgentIpc as unknown as (...args: unknown[]) => () => void
    const unregister = register(ipc, router, router, () => [main], 'win32', { status: vi.fn(), download: vi.fn() },
      { synthesize: vi.fn(), voices: vi.fn(), cancel: vi.fn() }, { synthesize: vi.fn(), cancel: vi.fn() }, undefined, broadcaster)
    dispose = () => { unregister(); router.dispose(); control.dispose() }
    expect(router.shell().host.models.length).toBe(609)

    let typed = 0
    const draft = (): AgentCommand => ({ type: 'save-thread-draft', threadId: 'workshop', draftId: randomUUID(), text: `Draft ${typed++}` })
    const handle = (channel: string, ...args: unknown[]): Promise<unknown> => Promise.resolve(handlers.get(channel)!(event, ...args))

    // The window: the preload's own bridge over an IPC stand-in that copies each answer the way a clone
    // would, wrapped by the page the way `AgentContext` wraps it, and sent the catalog once by the broadcast.
    let listener: ((event: unknown, payload: unknown) => void) | null = null
    let replyStage: 'main' | 'held' = 'main'
    let heldReply: unknown = null
    const renderer = {
      invoke: async (channel: string, ...args: unknown[]) => {
        if (channel === AGENT_COMMAND && replyStage === 'held') return heldReply
        return deserialize(serialize(await handle(channel, ...args)))
      },
      on: (channel: string, next: (event: unknown, payload: unknown) => void) => { if (channel === AGENT_STATE) listener = next },
      removeListener: () => undefined,
    }
    const preload = createSottoWidgetBridge(renderer, 'win32').agents as AgentBridge
    const page = wrapAgentBridge(preload)
    const seen: AgentState[] = []
    page.onState(state => seen.push(state))
    broadcaster.send(router.shell(), 'main', payload => { listener!({}, deserialize(serialize(payload))); return true })
    expect(seen).toHaveLength(1)

    const reply = await handle(AGENT_COMMAND, draft()) as AgentState
    const catalogOnWire = Array.isArray(reply.host.models)
    const answered = await page.command(draft())
    expect(answered.host.models).toHaveLength(609)
    expect(answered.threadDraftPersistence?.some(entry => entry.threadId.endsWith('workshop'))).toBe(true)

    heldReply = deserialize(serialize(reply))
    const report = {
      models: router.shell().host.models.length,
      catalogOnWire,
      catalogBytes: serialize(router.shell().host.models).length,
      replyBytes: serialize(reply).length,
      ms: {
        handler: await time(() => handle(AGENT_COMMAND, draft())),
        // The receipt's own encoding: a content comparison per catalog in main. Absent before this change.
        receiptEncode: typeof (broadcaster as Partial<AgentStateBroadcaster>).receipt === 'function'
          ? await (async () => {
            // A fresh shell each time, built ahead, as each command's own reply is.
            const shells = Array.from({ length: WARMUP + ITERATIONS }, () => router.shell())
            return time(() => broadcaster.receipt(shells.pop()!))
          })() : null,
        clone: await time(() => deserialize(serialize(reply))),
        preload: await (async () => { replyStage = 'held'; try { return await time(() => preload.command(draft())) } finally { replyStage = 'main' } })(),
        windowRoundTrip: await time(() => page.command(draft())),
      },
    }
    console.info(`command receipt: ${JSON.stringify(report)}`)
  }, 120_000)
})
