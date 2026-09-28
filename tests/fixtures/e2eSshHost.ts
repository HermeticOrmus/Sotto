// Stands in for an installed host/index.js in the Add host journey (tests/e2e/host-setup.spec.ts): the real
// headless host and its administration flags, with scripted providers in place of real ones. The spec builds
// it into a fake host installation, where the real launch script, run by the fake ssh, starts it.
import { parseHostArguments, runHeadlessCommandLine, startHeadlessHost } from '../../src/host'
import { E2EAgentHost, e2eAgentReasoner } from '../../src/main/e2e/agentEffects'

const ADMIN = new Set(['--pairing-code', '--allow-answers', '--deny-answers', '--revoke-client'])
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.some(argument => ADMIN.has(argument))) { await runHeadlessCommandLine(); return }
  const options = parseHostArguments(args)
  delete process.env.SOTTO_HOST_STARTED_BY
  const host = await startHeadlessHost({ ...options, providers: { codex: new E2EAgentHost(), claude: new E2EAgentHost(), grok: new E2EAgentHost(), devin: new E2EAgentHost() }, reasoner: e2eAgentReasoner })
  const keepAlive = setInterval(() => undefined, 60_000)
  const stop = (): void => { clearInterval(keepAlive); void host.close().finally(() => process.exit(0)) }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}
void main().catch(() => { process.exitCode = 1 })
