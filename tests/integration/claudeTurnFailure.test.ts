// @vitest-environment node
// A Claude turn that ends in error: the provider says Claude Code's own reason, and takes it down once a turn finishes.
import { afterEach, describe, expect, it } from 'vitest'
import { claudeTurnFailure } from '../../src/main/agents/claude'
import { claudeFixture } from '../fixtures/claudeFixture'

const fixtures: Awaited<ReturnType<typeof claudeFixture>>[] = []
afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup() })
async function fixture() {
  const f = await claudeFixture(undefined, 15_000)
  fixtures.push(f)
  await f.host.connect()
  await f.host.execute({ type: 'create-project', commandId: 'project', projectId: f.projectId, title: 'Failures', path: f.root })
  await f.host.execute({ type: 'create-thread', commandId: 'create', threadId: 'thread', projectId: f.projectId, title: 'Failures', modelId: f.modelId })
  await f.adapter.refreshThread('thread')
  return f
}
const GENERAL = 'Claude could not complete this turn. Check its native subscription, model and usage limits.'

describe('the error a failed Claude turn leaves', () => {
  it('names Claude Code’s own reason, bounded to one line, and the general advice only without one', () => {
    expect(claudeTurnFailure({ type: 'result', subtype: 'success', is_error: true, result: 'API Error: 400 {"error":"model not found"}' }))
      .toBe('Claude could not complete this turn. Claude Code said: API Error: 400 {"error":"model not found"}.')
    expect(claudeTurnFailure({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['Tool runner\ncrashed.', 7, 'Try again.'] }))
      .toBe('Claude could not complete this turn. Claude Code said: Tool runner crashed. Try again.')
    expect(claudeTurnFailure({ type: 'result', subtype: 'error_max_turns', is_error: true, errors: [] }))
      .toBe('Claude could not complete this turn. It reached its limit of steps for one turn.')
    expect(claudeTurnFailure({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '' })).toBe(GENERAL)
    // An error result's `result`, where one appears, is not read: only a success result's is the error text.
    expect(claudeTurnFailure({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'private reply text' })).toBe(GENERAL)
    const long = claudeTurnFailure({ type: 'result', subtype: 'success', is_error: true, result: 'x'.repeat(2_000) })
    expect(long.length).toBeLessThan(400)
    expect(long.endsWith('…')).toBe(true)
  })

  it('puts the reason on the provider and clears it when a later turn finishes', async () => {
    const f = await fixture()
    await f.action('thread', { type: 'raw', frame: { type: 'result', subtype: 'success', is_error: true, result: 'Claude AI usage limit reached.' } })
    await expect.poll(async () => (await f.host.snapshot()).error).toBe('Claude could not complete this turn. Claude Code said: Claude AI usage limit reached.')
    await f.driver.completeTurn('thread', 'Finished after all.')
    await expect.poll(async () => (await f.host.snapshot()).error).toBeUndefined()
  })
})
