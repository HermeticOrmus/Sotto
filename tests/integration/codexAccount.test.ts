// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { codexFixture } from '../fixtures/codexFixture'

/**
 * Codex answers a connect whether or not it is signed in. Sotto reads its account as it connects, so a signed-out Codex
 * is refused with its own problem, which a host's tile offers Sign in for, and a signed-in one names its kind of account
 * (ADR-0037). A Codex that cannot say connects as before.
 */
const fixtures: Awaited<ReturnType<typeof codexFixture>>[] = []
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.cleanup() })
async function codex(account?: { type: string } | null) {
  const fixture = await codexFixture(); fixtures.push(fixture)
  if (account !== undefined) await fixture.script({ account })
  return fixture
}

it('refuses a signed-out Codex as signed out, with its version', async () => {
  const { adapter } = await codex(null)
  await expect(adapter.connect()).rejects.toMatchObject({ problem: 'signed-out', version: 'codex/0.154.0', message: 'Sign in to Codex on this machine, then connect it again.' })
  expect((await adapter.snapshot()).connected).toBe(false)
})

it('names a ChatGPT sign-in, and connects a Codex that cannot say as before', async () => {
  const signedIn = await codex({ type: 'chatgpt' })
  expect(await signedIn.adapter.connect()).toMatchObject({ connected: true, account: 'ChatGPT' })
  const older = await codex()
  const snapshot = await older.adapter.connect()
  expect(snapshot.connected).toBe(true)
  expect(snapshot.account).toBeUndefined()
})
