import { spawn } from 'node:child_process'
import type { SpawnSsh } from '../hosts/sshProcess'

/**
 * A development end-to-end run reaches no real SSH host: every ssh the launcher starts, `ssh -V` and `-G`
 * included, is the stand-in script run by the given Node, with the launcher's own arguments and environment.
 */
export function e2eSshStandIn(executable: string, script: string): SpawnSsh {
  return (_file, args, options) => spawn(executable, [script, ...args], { env: options.env, stdio: [options.stdin, 'pipe', 'pipe'], shell: false, windowsHide: true })
}
