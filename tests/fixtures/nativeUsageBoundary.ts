import assert from 'node:assert/strict'
import type { ThreadUsage } from '../../src/shared/threadUsage'

/** Assert the boundary's model identity before comparing its complete usage state. */
export function nativeUsageBoundary(view: ThreadUsage | undefined, expectedModelId: string) {
  assert.ok(view, 'Expected usage at the archive or renderer boundary')
  assert.equal(view.modelId, expectedModelId, 'Usage must carry the model identity for this boundary')
  // The archive owns a native model ID and the provider switch qualifies it for the bridge.
  // Check that identity above, then compare every other field, including timestamps and errors.
  // JSON omits undefined optional properties; no numbers, false values or arrays are coerced.
  return Object.fromEntries(Object.entries(view).filter(([key, value]) => key !== 'modelId' && value !== undefined)
    .map(([key, value]) => [key, (key === 'latest' || key === 'total')
      ? Object.fromEntries(Object.entries(view[key]!).filter(([, counter]) => counter !== undefined)) : value]))
}
