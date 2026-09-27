// @vitest-environment node
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, it } from 'vitest'
import { NativeUsage } from '../../../src/main/agents/nativeUsage'
import type { ThreadUsage } from '../../../src/shared/threadUsage'
import { nativeUsageBenchTotals as totals } from '../../fixtures/nativeUsageBenchTotals'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it.each(['stream', 'turns'])('compares %s counters with their real JSON archive after restart', async scenario => {
  const root = await mkdtemp(join(tmpdir(), 'sotto-usage-comparison-test-')); roots.push(root)
  const usage = new NativeUsage(root, 'claude'); await usage.load()
  const message = { id: 'synthetic-request', model: 'claude-sonnet-4-6', usage: {
    input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0,
  } }
  if (scenario === 'stream') {
    usage.claude('thread', { type: 'stream_event', event: { type: 'message_start', message } })
    usage.claude('thread', { type: 'stream_event', event: { type: 'message_delta', usage: { output_tokens: 200 } } })
  } else usage.claude('thread', { type: 'assistant', message })
  await usage.flushed()
  const reopened = new NativeUsage(root, 'claude'); await reopened.load(); await reopened.flushed()
  // Node strict equality is also what the isolated benchmark child uses, unlike Vitest's toEqual.
  assert.deepEqual(totals(reopened.get('thread')), totals(usage.get('thread')))
  assert.equal(totals(reopened.get('thread')).total?.output, scenario === 'stream' ? 200 : 100)
  assert.equal(totals(reopened.get('thread')).estimatedUsd, scenario === 'stream' ? 0.0066 : 0.0051)
})

const view = (): ThreadUsage => ({ updatedAt: '2026-09-01T00:00:00Z', partial: false, rateVersions: ['fixture-rate'], estimatedUsd: 0.5,
  contextUsed: 3000, contextWindow: 200_000,
  latest: { input: 3000, output: 100, cached: 2000, cacheWrite: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
  total: { input: 6000, output: 200, cached: 4000, cacheWrite: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
})

for (const part of ['latest', 'total'] as const) {
  it.each(['input', 'output', 'cached', 'cacheWrite', 'cacheWrite5m', 'cacheWrite1h'] as const)(`rejects a missing or changed ${part}.%s counter, including zero`, field => {
    const expected = view(), changed = view(), missing = view()
    changed[part]![field]! += 1
    delete missing[part]![field]
    assert.throws(() => assert.deepEqual(totals(changed), totals(expected)))
    assert.throws(() => assert.deepEqual(totals(missing), totals(expected)))
  })
}

it('rejects lost usage and changed price, pricing completeness, context and rate versions', () => {
  assert.throws(() => totals(undefined), /must retain its usage/u)
  const expected = view()
  for (const changed of [
    { ...expected, estimatedUsd: 0.6 }, { ...expected, partial: true }, { ...expected, contextUsed: 3001 },
    { ...expected, contextWindow: 100_000 }, { ...expected, rateVersions: ['different-rate'] },
  ]) assert.throws(() => assert.deepEqual(totals(changed), totals(expected)))
})

it('treats absent optional counters as undefined, without equating absent counters with zero', () => {
  const expected = view()
  const explicitUndefined = { ...expected, latest: { ...expected.latest, cacheWrite5m: undefined } }
  const absent = { ...expected, latest: { ...expected.latest } }
  delete absent.latest.cacheWrite5m
  assert.deepEqual(totals(explicitUndefined), totals(absent))
  assert.throws(() => assert.deepEqual(totals(explicitUndefined), totals(expected)))
})
