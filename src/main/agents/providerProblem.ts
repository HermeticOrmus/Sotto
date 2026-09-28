import type { ProviderProblem } from '../../shared/agents'

/**
 * A provider that could not connect for a reason its adapter can name (ADR-0037): not installed, older than Sotto
 * supports, not signed in, or not startable. The message is the sentence the user reads; `problem` is what the Hosts
 * page's tiles decide on, so rewording the sentence changes no tile. `version` is the client's own, when it said.
 */
export class ProviderUnavailable extends Error {
  constructor(readonly problem: ProviderProblem, message: string, readonly version?: string) { super(message) }
}

/** The problem a failed connect carried, when it named one. */
export function providerProblemOf(error: unknown): { problem: ProviderProblem; version?: string } | undefined {
  if (!(error instanceof ProviderUnavailable)) return undefined
  return { problem: error.problem, ...(error.version ? { version: error.version } : {}) }
}
