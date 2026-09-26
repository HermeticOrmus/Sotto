// @vitest-environment node
/**
 * What the read before a Codex send costs as a thread grows (#324). Before `turn/start`, the adapter's send
 * path calls `refreshThread`, which reads the whole transcript with `thread/read` and `includeTurns: true`,
 * applies it, and saves the thread record, so that input typed in native Codex is caught before Sotto replies.
 * Since #324 a send first asks for the newest turn alone with `thread/turns/list` and reads the whole transcript
 * only when that turn is not the one Sotto already holds. This seeds a thread with 50, 500 and 2,000 completed
 * turns in the fake Codex app-server under `tests/fixtures/`, opens it, and times several sends against it, each
 * after the last one's turn has finished: the whole send to `accepted`, `refreshThread` inside it, and within that
 * the `thread/read` and `thread/turns/list` round trips and the applying and saving done inside them. It counts
 * both requests per send and weighs the replies the fake sent, and, for comparison, the newest turn and its user
 * message alone: the only part of the transcript the `expectedLastUserMessageId` check compares. Counters, sizes
 * and timers only; every seeded text is filler. It asserts no time, so it runs only under `SOTTO_PERF_BENCH=1`
 * (`tests/fixtures/perfBench.ts`):
 *
 *   SOTTO_PERF_BENCH=1 npx vitest run tests/perf/codexSendRead.perf.test.ts --maxWorkers=1 --disable-console-intercept
 */
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CodexAppServerHost } from '../../src/main/agents/codex'
import { codexFixture } from '../fixtures/codexFixture'
import { median, PERF_BENCH, round } from '../fixtures/perfBench'

const SENDS = 5
const SIZES = [50, 500, 2000] as const
type Fixture = Awaited<ReturnType<typeof codexFixture>>
type Stage = 'refreshThread' | 'read' | 'newestTurn' | 'applyThread' | 'persist'
const STAGES = ['refreshThread', 'read', 'newestTurn', 'applyThread', 'persist'] as const
type FakeThread = { turns: { id: string; items: { type: string }[] }[] }

/** One completed turn of the shape a coding turn has: a prompt, a reasoning summary, a command and a reply. */
function turn(index: number, cwd: string): Record<string, unknown> {
  const at = 1_790_000_000 + index * 60
  return { id: randomUUID(), status: 'completed', startedAt: at, completedAt: at + 30, itemsView: 'full', items: [
    { type: 'userMessage', id: randomUUID(), content: [{ type: 'text', text: 'u'.repeat(200) }] },
    { type: 'reasoning', id: randomUUID(), summary: ['r'.repeat(300)] },
    { type: 'commandExecution', id: randomUUID(), status: 'completed', command: 'c'.repeat(40), cwd, aggregatedOutput: 'o'.repeat(2000), exitCode: 0, durationMs: 120 },
    { type: 'agentMessage', id: randomUUID(), text: 'a'.repeat(1200) },
  ] }
}

/**
 * Time the adapter's own steps while the benchmark runs. `read` and `newestTurn` are `rpc` for `thread/read` and
 * `thread/turns/list`: the request, the fake's reply, parsing it and the adapter's callback. `applyThread` and
 * `persist` count only inside those callbacks, so the send's other saves (its outbox origin, the turn it started)
 * stay out of them.
 */
const spent = new Map<Stage, number>()
const originals = new Map<string, unknown>()
let reading = 0
function instrument(): void {
  const prototype = CodexAppServerHost.prototype as unknown as Record<string, (...args: unknown[]) => unknown>
  const timed = (name: string, stage: Stage, when: (args: unknown[]) => boolean, around?: { enter(): void; leave(): void }): void => {
    const original = prototype[name]!
    originals.set(name, original)
    prototype[name] = function (this: unknown, ...args: unknown[]) {
      if (!when(args)) return original.apply(this, args)
      const startedAt = performance.now()
      const stop = (): void => { spent.set(stage, (spent.get(stage) ?? 0) + performance.now() - startedAt); around?.leave() }
      around?.enter()
      let result: unknown
      try { result = original.apply(this, args) } catch (error) { stop(); throw error }
      if (result instanceof Promise) return result.finally(stop)
      stop(); return result
    }
  }
  timed('refreshThread', 'refreshThread', () => true)
  const inside = { enter: () => { reading++ }, leave: () => { reading-- } }
  timed('rpc', 'read', args => args[0] === 'thread/read', inside)
  timed('rpc', 'newestTurn', args => args[0] === 'thread/turns/list', inside)
  timed('applyThread', 'applyThread', () => reading > 0)
  timed('persist', 'persist', () => reading > 0)
}
function restore(): void {
  const prototype = CodexAppServerHost.prototype as unknown as Record<string, unknown>
  for (const [name, original] of originals) prototype[name] = original
  originals.clear()
}

async function replies(root: string): Promise<{ method: string; bytes: number }[]> {
  return (await readFile(join(root, 'replies.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as { method: string; bytes: number })
}

/** A thread with `turns` completed turns, opened the way the Threads page opens it. */
async function seeded(turns: number): Promise<{ f: Fixture; id: string; openMs: number }> {
  const first = await codexFixture(undefined, false, 60_000)
  await first.host.connect()
  await first.host.execute({ type: 'create-project', commandId: randomUUID(), projectId: first.projectId, title: 'Bench', path: first.root })
  const id = randomUUID()
  await first.host.execute({ type: 'create-thread', commandId: randomUUID(), threadId: id, projectId: first.projectId, modelId: first.modelId, title: 'Bench' })
  const codexThreadId = await first.realId(id)
  first.host.disconnect(); await first.adapter.closed()
  const statePath = join(first.root, 'state.json')
  const state = JSON.parse(await readFile(statePath, 'utf8')) as { threads: Record<string, FakeThread> }
  state.threads[codexThreadId]!.turns = Array.from({ length: turns }, (_, index) => turn(index, first.root)) as FakeThread['turns']
  await writeFile(statePath, JSON.stringify(state))
  const f = await first.driver.restart() as Fixture
  await f.script({ recordReplyBytes: true })
  await f.host.connect()
  const startedAt = performance.now()
  f.host.observeThreads?.([id])
  await (f.adapter as unknown as { open(id: string): Promise<void> }).open(id)
  return { f, id, openMs: performance.now() - startedAt }
}

const lastUser = (f: Fixture, id: string): string | null =>
  (f.adapter as unknown as { log: { lastUserMessageId(id: string): string | undefined } }).log.lastUserMessageId(id) ?? null

describe.skipIf(!PERF_BENCH)('Codex send-time read on a long thread', () => {
  beforeAll(instrument)
  afterAll(restore)

  for (const turns of SIZES) {
    it(`at ${turns} turns`, async () => {
      const { f, id, openMs } = await seeded(turns)
      try {
        const samples: Record<Stage | 'send', number[]> = { send: [], refreshThread: [], read: [], newestTurn: [], applyThread: [], persist: [] }
        const sent: { method: string; bytes: number }[] = []
        for (let index = 0; index < SENDS; index++) {
          const before = (await replies(f.root)).length
          spent.clear()
          const messageId = randomUUID()
          const startedAt = performance.now()
          const result = await f.host.execute({ type: 'send', threadId: id, commandId: randomUUID(), messageId, text: 'Synthetic prompt', expectedLastUserMessageId: lastUser(f, id) })
          samples.send.push(performance.now() - startedAt)
          expect(result).toEqual({ accepted: true })
          for (const stage of STAGES) samples[stage].push(spent.get(stage) ?? 0)
          sent.push(...(await replies(f.root)).slice(before))
          await f.driver.completeTurn(id, 'Synthetic reply')
          await expect.poll(async () => (await f.host.snapshot()).threads.find(thread => thread.id === id)?.status, { timeout: 60_000, interval: 20 }).toBe('idle')
        }
        const state = JSON.parse(await readFile(join(f.root, 'state.json'), 'utf8')) as { threads: Record<string, FakeThread> }
        const native = state.threads[await f.realId(id)]!
        const last = native.turns.at(-1)!
        // What `thread/turns/list` with `limit: 1` carries: one turn in a page, and the user message in it.
        const lastTurnBytes = Buffer.byteLength(JSON.stringify({ id: 1, result: { data: [last], nextCursor: 'cursor', backwardsCursor: 'cursor' } })) + 1
        const lastUserBytes = Buffer.byteLength(JSON.stringify(last.items.findLast(item => item.type === 'userMessage')))
        const weighed = (method: string) => {
          const bytes = sent.filter(reply => reply.method === method).map(reply => reply.bytes)
          return { perSend: bytes.length / SENDS, maxBytes: bytes.length ? Math.max(...bytes) : 0 }
        }
        console.info(`codex send read: ${JSON.stringify({ turns, sends: SENDS, openMs: round(openMs), sendMedianMs: round(median(samples.send)),
          ...Object.fromEntries(STAGES.map(stage => [`${stage}MedianMs`, round(median(samples[stage]))])),
          threadRead: weighed('thread/read'), turnsList: weighed('thread/turns/list'), newestTurnBytes: lastTurnBytes, newestUserMessageBytes: lastUserBytes })}`)
      } finally { await f.cleanup() }
    }, 600_000)
  }
})
