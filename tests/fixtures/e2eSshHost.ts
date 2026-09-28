// Stands in for an installed host/index.js in the Add host journey (tests/e2e/host-setup.spec.ts): the real
// headless host and its administration flags, with scripted providers in place of real ones. The spec builds
// it into a fake host installation, where the real launch script, run by the fake ssh, starts it.
import { existsSync } from 'node:fs'
import { parseHostArguments, runHeadlessCommandLine, startHeadlessHost } from '../../src/host'
import { E2EAgentHost, e2eAgentReasoner } from '../../src/main/e2e/agentEffects'
import type { AgentHostSnapshot } from '../../src/shared/agents'

/** A provider installed on the host but not signed in there: its connect fails, as Claude Code's did on forge (#459). */
class SignedOut extends E2EAgentHost {
  override async connect(): Promise<AgentHostSnapshot> { throw new Error('Sign in to this provider on the host machine, then connect it again.') }
}

const ADMIN = new Set(['--pairing-code', '--allow-answers', '--deny-answers', '--revoke-client'])
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.some(argument => ADMIN.has(argument))) { await runHeadlessCommandLine(); return }
  const options = parseHostArguments(args)
  delete process.env.SOTTO_HOST_STARTED_BY
  // While the file SOTTO_E2E_HOST_SIGNED_OUT names exists, this host starts with every provider signed out.
  const signedOut = Boolean(process.env.SOTTO_E2E_HOST_SIGNED_OUT && existsSync(process.env.SOTTO_E2E_HOST_SIGNED_OUT))
  const provider = (): E2EAgentHost => signedOut ? new SignedOut() : new E2EAgentHost()
  const host = await startHeadlessHost({ ...options, providers: { codex: provider(), claude: provider(), grok: provider(), devin: provider() }, reasoner: e2eAgentReasoner })
  const keepAlive = setInterval(() => undefined, 60_000)
  const stop = (): void => { clearInterval(keepAlive); void host.close().finally(() => process.exit(0)) }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}
void main().catch(() => { process.exitCode = 1 })
