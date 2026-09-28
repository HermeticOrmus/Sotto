import assert from 'node:assert/strict'
import type { ThreadUsage, UsageTokens } from '../../src/shared/threadUsage'

// JSON omits undefined optional counters. Normalize only that representational difference:
// zero, every reported counter and any other value remain subject to strict comparison.
const persistedTokens = (tokens: UsageTokens | undefined): UsageTokens | undefined => tokens === undefined ? undefined
  : Object.fromEntries(Object.entries(tokens).filter(([, value]) => value !== undefined))

/** The accounting fields compared before/after a workload and across archive reload. */
export function nativeUsageBenchTotals(view: ThreadUsage | undefined) {
  assert.ok(view, 'A seeded benchmark thread must retain its usage after reload')
  return { total: persistedTokens(view.total), latest: persistedTokens(view.latest),
    estimatedUsd: view.estimatedUsd, partial: view.partial, contextUsed: view.contextUsed,
    contextWindow: view.contextWindow, rateVersions: view.rateVersions }
}
