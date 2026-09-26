import type { AgentBridge, AgentClientHost, AgentModel, AgentState } from '../../../shared/agents'

const PRIMARY_CATALOG_KEY = '__primary__'

interface CachedCatalog {
  revision: number
  models: AgentModel[]
}

/** What this window holds of each catalog, keyed as main keys it (`AgentStateBroadcaster`). */
type CatalogCache = Map<string, CachedCatalog>

function hostCatalogKey(hostId: string | undefined): string {
  return `host:${hostId ?? PRIMARY_CATALOG_KEY}`
}

function clientCatalogKey(hostId: string): string {
  return `client:${hostId}`
}

const wrapped = new WeakMap<AgentBridge, AgentBridge>()

/**
 * Puts a model catalog main left out back before any consumer reads the state: one the `AGENT_STATE`
 * broadcast omitted because this window was already sent it (issue #286, ADR-0028), and every one a command
 * receipt names by catalog revision (issue #323). Reassembly lives here, in the page, not in the preload:
 * `contextBridge` copies every argument a main-world listener is called with back across the isolated-world
 * boundary, so putting the catalog back together on the preload side would clone the whole thing again on
 * the way out — exactly the cost omitting it was for. Only the small `{ revision, omitted: true }` marker
 * needs to make that crossing; this wrapper turns it back into the array every consumer already expects.
 *
 * Broadcasts and receipts share one cache, because their revisions come from the same counter in main: a
 * catalog the broadcast sent in full is what a receipt resolves from, and a catalog recovered for a receipt
 * serves the next broadcast that names it. The cache lives as long as the page does — a reload runs the
 * page fresh, so it empties exactly when the window's own memory of what it was sent does.
 *
 * `bridge` is `window.sotto.agents` or `window.sottoWidget.agents`, whichever a window has. Wrapping is
 * memoized by the underlying bridge's own identity, so calling this again on the same bridge — as a
 * component that re-renders would — returns the same wrapped bridge rather than a new one, which keeps
 * the object stable for callers that key their own effects on it.
 */
export function wrapAgentBridge(bridge: AgentBridge): AgentBridge {
  const existing = wrapped.get(bridge)
  if (existing) return existing
  const catalogs: CatalogCache = new Map()
  const completeReceipt = createReceiptCompleter(bridge, catalogs)
  const result: AgentBridge = {
    ...bridge,
    onState: listener => bridge.onState(createReassembler(bridge, catalogs, listener)),
    command: async request => completeReceipt(await bridge.command(request)),
  }
  wrapped.set(bridge, result)
  return result
}

function isStateLike(raw: unknown): raw is AgentState {
  return typeof raw === 'object' && raw !== null && 'host' in raw
}

/**
 * One catalog as it crossed: a bare array is complete already (a whole `AgentState` read another way, or a
 * test fixture standing in for main); a full catalog is cached under its revision; a revision alone is read
 * back from the cache when the window holds that revision, and is otherwise unresolved.
 */
function resolveCatalog(catalogs: CatalogCache, key: string, catalog: unknown): AgentModel[] | undefined {
  if (Array.isArray(catalog)) return catalog as AgentModel[]
  if (catalog && typeof catalog === 'object') {
    const record = catalog as { revision?: unknown; models?: unknown; omitted?: unknown }
    if (typeof record.revision === 'number' && Array.isArray(record.models)) {
      const models = record.models as AgentModel[]
      catalogs.set(key, { revision: record.revision, models })
      return models
    }
    if (typeof record.revision === 'number' && record.omitted === true) {
      const cached = catalogs.get(key)
      return cached && cached.revision === record.revision ? cached.models : undefined
    }
  }
  return undefined
}

function revisionOf(catalog: unknown): number | undefined {
  return catalog && typeof catalog === 'object' && typeof (catalog as { revision?: unknown }).revision === 'number'
    ? (catalog as { revision: number }).revision : undefined
}

/**
 * `state` with every catalog put back, or undefined when one names a revision this window does not hold.
 * `fallback` answers for such a catalog instead, when a recovery could not.
 */
function assembleState(catalogs: CatalogCache, state: AgentState, fallback?: (key: string) => AgentModel[] | undefined): AgentState | undefined {
  const find = (key: string, catalog: unknown): AgentModel[] | undefined => resolveCatalog(catalogs, key, catalog) ?? fallback?.(key)
  // Reused as the actual array on both fields when they name the same catalog, so this window holds one
  // copy of it, the way the wire itself does (DesktopHostRouter.shell()).
  // Every catalog is looked at before any is found missing, so one carried in full is cached either way.
  const primary = find(hostCatalogKey(state.host.hostId), state.host.models)
  const clientHosts = state.host.clientHosts?.map(client => ({ client, models: find(clientCatalogKey(client.hostId), client.models) }))
  if (primary === undefined || clientHosts?.some(entry => entry.models === undefined)) return undefined
  return { ...state, host: { ...state.host, models: primary, clientHosts: clientHosts?.map(({ client, models }): AgentClientHost => ({ ...client, models: models! })) } }
}

/**
 * Remembers what a recovery's `get()` answered under the revisions `named` sent the window looking for, so
 * an immediate repeat of them is read from the cache instead of asked for again. Main answers `get()` after
 * it sent `named`, so the answer is never older than those revisions.
 */
function rememberRecovered(catalogs: CatalogCache, named: AgentState, full: AgentState): void {
  // Revisions only advance, so a newer one the window already holds is never filed over.
  const remember = (key: string, revision: number | undefined, models: AgentModel[]): void => {
    if (revision !== undefined && !((catalogs.get(key)?.revision ?? 0) > revision)) catalogs.set(key, { revision, models })
  }
  remember(hostCatalogKey(named.host.hostId), revisionOf(named.host.models), full.host.models)
  for (const client of named.host.clientHosts ?? []) {
    const recovered = full.host.clientHosts?.find(candidate => candidate.hostId === client.hostId)
    if (recovered) remember(clientCatalogKey(client.hostId), revisionOf(client.models), recovered.models)
  }
}

/**
 * A command's reply as its caller reads it: the receipt main sent (issue #323) with every catalog put back.
 * Nearly always they come from the cache the broadcast filled. A receipt naming a revision this window does
 * not hold — nothing broadcast yet, or a catalog that changed with this command and whose broadcast has not
 * landed — recovers through `bridge.get()` once, and receipts naming the same revisions while that is in
 * flight wait for the same answer rather than asking again. Only an answer asked for after the receipt
 * arrived is remembered under its revisions, so older content is never filed under a newer revision.
 *
 * The receipt's own fields are what the caller gets, never the recovery's: the draft store reads the
 * draft revision it acknowledged and the settings card the settings it applied. When the recovery fails,
 * or its answer no longer lists a host the receipt named, the catalog this window last held for that host
 * stands in until the next broadcast; a failed recovery with nothing held at all fails the reply.
 */
function createReceiptCompleter(bridge: Pick<AgentBridge, 'get'>, catalogs: CatalogCache): (reply: AgentState) => Promise<AgentState> {
  const recoveries = new Map<string, Promise<AgentState>>()
  return async reply => {
    if (!isStateLike(reply)) return reply
    const assembled = assembleState(catalogs, reply)
    if (assembled !== undefined) return assembled
    const named = JSON.stringify([revisionOf(reply.host.models), ...(reply.host.clientHosts ?? []).map(client => [client.hostId, revisionOf(client.models)])])
    let recovery = recoveries.get(named)
    if (recovery === undefined) {
      recovery = bridge.get().then(full => { rememberRecovered(catalogs, reply, full); return full })
      recoveries.set(named, recovery)
      const forget = (): void => { recoveries.delete(named) }
      recovery.then(forget, forget)
    }
    let failure: unknown = null
    try { await recovery } catch (error) { failure = error }
    const held = (key: string): AgentModel[] | undefined => catalogs.get(key)?.models ?? (failure === null ? [] : undefined)
    const completed = assembleState(catalogs, reply, held)
    if (completed === undefined) throw failure instanceof Error ? failure : new Error('The model list could not be read back.')
    return completed
  }
}

/**
 * One subscription's delivery of broadcasts: a catalog delivered in full is cached under its revision, and
 * one only named by revision is read back from the cache. A broadcast this window cannot resolve on its own
 * — nothing cached yet, or a revision that does not match — asks `bridge.get()` for the whole state instead
 * of showing no models, and seeds the cache with what comes back so an immediate repeat of that same
 * omission needs no second fetch.
 *
 * A broadcast that arrives while a recovery is in flight is kept, the newest replacing any earlier one.
 * When the recovery succeeds, its answer is newer than anything kept, so the kept broadcast only lends
 * the cache any catalog it carried in full. When the recovery fails, the kept broadcast gets its own
 * attempt: from the cache, or a recovery of its own. Nothing but a broadcast ever starts a recovery, so
 * a `get()` that keeps failing is retried at most once per broadcast, never on a timer.
 */
function createReassembler(bridge: Pick<AgentBridge, 'get'>, catalogs: CatalogCache, listener: (state: AgentState) => void): (raw: unknown) => void {
  let recovering = false
  let pending: unknown = null

  /** Caches whatever catalogs a broadcast carried in full, without delivering it. */
  const seed = (raw: unknown): void => {
    if (!isStateLike(raw)) return
    resolveCatalog(catalogs, hostCatalogKey(raw.host.hostId), raw.host.models)
    for (const client of raw.host.clientHosts ?? []) resolveCatalog(catalogs, clientCatalogKey(client.hostId), client.models)
  }

  const process = (raw: unknown): void => {
    if (!isStateLike(raw)) return
    const assembled = assembleState(catalogs, raw)
    if (assembled !== undefined) { listener(assembled); return }
    // This window cannot name every catalog the broadcast referred to: a fresh window, a reload, or a
    // revision it never received. `get()` always answers in full, so recovering there restores what the
    // broadcast could not carry, tagged with the revision that sent us looking so an immediate repeat of
    // it is read from cache instead of asking again. Every catalog the broadcast carried in full is cached
    // by the attempt above.
    recovering = true
    bridge.get().then(full => {
      rememberRecovered(catalogs, raw, full)
      listener(full)
      // Main answers `get()` in order with its broadcasts, so one kept while this was in flight was sent
      // before the answer and is older than it. Delivering it now would put an older state on screen after
      // a newer one; only a catalog it carried in full is worth keeping.
      if (pending !== null) { seed(pending); pending = null }
    }).catch(() => undefined).finally(() => {
      recovering = false
      if (pending !== null) { const next = pending; pending = null; process(next) }
    })
  }

  return raw => { if (recovering) pending = raw; else process(raw) }
}
