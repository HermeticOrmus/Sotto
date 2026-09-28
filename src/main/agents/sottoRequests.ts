import type { AgentHostSnapshot, AgentRequest } from '../../shared/agents'

/** Every request Sotto owns starts with this, so it can never be taken for a provider's. */
export const SOTTO_REQUEST_PREFIX = 'sotto:'

/**
 * Requests Sotto itself puts in a thread, answered there like a provider's (ADR-0035). The only one today is the
 * host setup thread's "Add forge as a host?". The coordinator merges them into their thread's requests and hands
 * the user's answer back here instead of to the provider; nothing else answers them.
 */
export interface SottoThreadRequests {
  /** The pending requests, by the Sotto thread they belong to. */
  requests(): ReadonlyMap<string, readonly AgentRequest[]>
  /** The user's answer. Throws when the request is no longer waiting. */
  answer(threadId: string, requestId: string, approved: boolean): void
  subscribe(listener: () => void): () => void
}

export const isSottoRequest = (requestId: string): boolean => requestId.startsWith(SOTTO_REQUEST_PREFIX)

/**
 * The snapshot with each thread's requests from Sotto in place of the ones it carried before: a provider's own are
 * kept as they are, and Sotto's follow them. Threads with nothing to change keep their own object.
 */
export function withSottoRequests(snapshot: AgentHostSnapshot, pending: ReadonlyMap<string, readonly AgentRequest[]>): AgentHostSnapshot {
  let changed = false
  const threads = snapshot.threads.map(thread => {
    const own = pending.get(thread.id) ?? []
    const carried = thread.requests.some(request => isSottoRequest(request.id))
    if (!own.length && !carried) return thread
    changed = true
    return { ...thread, requests: [...thread.requests.filter(request => !isSottoRequest(request.id)), ...structuredClone(own)] }
  })
  return changed ? { ...snapshot, threads } : snapshot
}
