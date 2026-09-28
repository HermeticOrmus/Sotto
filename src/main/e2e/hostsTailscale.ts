import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { TailscaleRun } from '../phones/tailscale'

/**
 * The Tailscale CLI as Add host and the Hosts page see it in an end-to-end run, which never touches the
 * machine's Tailscale. `e2e-tailscale-status.json` in the run's profile is what `tailscale status --json`
 * prints, read on every call so a spec can change it; without the file, Tailscale reads as not installed.
 * `tailscale up` sets the file's backend to Running, first printing a sign-in page when it says NeedsLogin.
 * (Phone access reads its own `e2e-tailscale.json`; see `./tailscale.ts`.)
 */
export function e2eHostsTailscale(profile: string): TailscaleRun {
  const path = join(profile, 'e2e-tailscale-status.json')
  const read = (): string => {
    try { return readFileSync(path, 'utf8') }
    catch { throw Object.assign(new Error('spawn tailscale ENOENT'), { code: 'ENOENT' }) }
  }
  return async (_executable, args, options) => {
    const output = read()
    if (args[0] === 'status') return { code: /"BackendState"\s*:\s*"Running"/u.test(output) ? 0 : 1, stdout: output, stderr: '' }
    if (args[0] !== 'up') return { code: 1, stdout: '', stderr: 'unknown command' }
    const status = JSON.parse(output) as { BackendState?: string }
    const stdout = status.BackendState === 'NeedsLogin' ? '\nTo authenticate, visit:\n\n\thttps://login.tailscale.com/a/e2e\n\n' : ''
    if (stdout) options.watch?.(stdout)
    writeFileSync(path, JSON.stringify({ ...status, BackendState: 'Running' }))
    return { code: 0, stdout: stdout ? `${stdout}Success.\n` : '', stderr: '' }
  }
}
