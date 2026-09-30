import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { LAUNCH_SCRIPT_SOURCE } from '../../src/main/hosts/launchScript'

/** Runs the actual SSH control source beside a loopback host, with no SSH or grant stub. */
export async function ensureFixtureDesktopAnswers(dataDirectory: string, hostId: string, clientId: string): Promise<void> {
  // -e receives only the fixed source; pairing credentials are never arguments or output.
  const { stdout } = await promisify(execFile)(process.execPath, ['-e', LAUNCH_SCRIPT_SOURCE,
    JSON.stringify({ op: 'desktop-answers', dataDirectory, installPath: dataDirectory, hostId, clientId })],
  { timeout: 15_000, maxBuffer: 4096, windowsHide: true })
  const result = JSON.parse(stdout.trim()) as { type?: string; hostId?: string }
  if (result.type !== 'desktop-answers' || result.hostId !== hostId) throw new Error('The fixture host could not establish desktop permissions.')
}
