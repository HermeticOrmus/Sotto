import { isDeepStrictEqual } from 'node:util'
import type { AgentClientHost, AgentCommandReceipt, AgentModel, AgentModelCatalogBroadcast, AgentModelCatalogRevision, AgentState, AgentStateBroadcast } from '../../shared/agents'

export type AgentStateBroadcastDestination = 'main' | 'widget'

const PRIMARY_CATALOG_KEY = '__primary__'

type EncodedClientHost<Catalog> = Omit<AgentClientHost, 'models'> & { models: Catalog }
type EncodedState<Catalog> = Omit<AgentState, 'host'> & {
  host: Omit<AgentState['host'], 'models' | 'clientHosts'> & { models: Catalog; clientHosts?: EncodedClientHost<Catalog>[] }
}

interface CatalogSnapshot {
  revision: number
  models: readonly AgentModel[]
}

/**
 * Turns a shell into what actually crosses `sotto:agents:state` for one destination window, omitting a
 * model catalog that window was already sent and nothing has changed since (issue #286): `models` is
 * rebuilt into new arrays and objects on every publish even when its content is unchanged (`clientAgentState`
 * deep-clones for its ID projection), so identity cannot tell a repeat from a change — content, compared
 * with `isDeepStrictEqual`, can. A catalog's revision is a counter bumped only when its content actually
 * changes, shared by every destination; what each destination has already been sent is tracked apart, and
 * only once delivery of it is confirmed, so a window that never actually received a revision is not skipped
 * on the next attempt.
 *
 * `host.models` and the selected host's own `clientHosts[]` entry are today always the same array
 * (`DesktopHostRouter.shell()`), but they are still keyed apart, with a `host:`/`client:` prefix, rather
 * than sharing the selected host's ID: if the two ever held different content, sharing a key would flip
 * one's revision out from under the other's own comparison on every publish, so neither could ever settle
 * on `omitted` again.
 *
 * A command's reply to a window is encoded here too (`receipt`, issue #323), with the same revisions, so
 * one counter orders what the broadcast and the replies say about a catalog.
 */
export class AgentStateBroadcaster {
  private readonly catalogs = new Map<string, CatalogSnapshot>()
  private readonly sent: Record<AgentStateBroadcastDestination, Map<string, number>> = { main: new Map(), widget: new Map() }
  private lastComparison: { stored: readonly AgentModel[]; incoming: readonly AgentModel[]; equal: boolean } | null = null

  /** Encodes `state` for `destination` and hands it to `deliver`; only a delivery `deliver` reports as
   * successful (its return value) is remembered, so a window that was not actually listening is sent the
   * catalog in full again next time rather than being assumed caught up. */
  send(state: AgentState, destination: AgentStateBroadcastDestination, deliver: (payload: AgentStateBroadcast) => boolean): boolean {
    const sentRevisions = this.sent[destination]
    const confirmed: Array<[string, number]> = []
    const payload: AgentStateBroadcast = this.encode(state, (key, models): AgentModelCatalogBroadcast => {
      const revision = this.revisionFor(key, models)
      if (sentRevisions.get(key) === revision) return { revision, omitted: true }
      confirmed.push([key, revision])
      return { revision, models: models as AgentModel[] }
    })
    const delivered = deliver(payload)
    if (delivered) for (const [key, revision] of confirmed) sentRevisions.set(key, revision)
    return delivered
  }

  /**
   * A command's reply to a window (issue #323): `state` whole except that every catalog is named by its
   * catalog revision rather than listed, whatever the window was sent. The revision comes from the same
   * counter the broadcast uses, so a window resolves it from what the broadcast already gave it and
   * recovers through `AGENT_GET` when it holds another. A receipt records nothing as sent: it carries no
   * catalog, so a window's next broadcast is exactly what it would have been without it.
   */
  receipt(state: AgentState): AgentCommandReceipt {
    return this.encode(state, (key, models): AgentModelCatalogRevision => ({ revision: this.revisionFor(key, models), omitted: true }))
  }

  /** `state` with `host.models` and every `host.clientHosts[].models` replaced by what `catalog` makes of it. */
  private encode<Catalog>(state: AgentState, catalog: (key: string, models: readonly AgentModel[]) => Catalog): EncodedState<Catalog> {
    const encodeClientHost = (client: AgentClientHost): EncodedClientHost<Catalog> => ({ ...client, models: catalog(clientCatalogKey(client.hostId), client.models) })
    const { clientHosts, ...hostRest } = state.host
    return {
      ...state,
      host: {
        ...hostRest,
        models: catalog(hostCatalogKey(state), state.host.models),
        ...(clientHosts ? { clientHosts: clientHosts.map(encodeClientHost) } : {}),
      },
    }
  }

  private revisionFor(key: string, models: readonly AgentModel[]): number {
    const existing = this.catalogs.get(key)
    if (existing && this.sameContent(existing.models, models)) return existing.revision
    const revision = (existing?.revision ?? 0) + 1
    this.catalogs.set(key, { revision, models })
    return revision
  }

  /**
   * One content comparison serves every key that holds the same array and is handed the same array:
   * `host.models` and the selected host's `clientHosts[]` entry are one array in a shell, and one shell is
   * encoded for both windows. Without this, a publish compared the 608-model catalog four times and a
   * receipt twice. The last pair compared is remembered by identity; a shell is rebuilt, never edited.
   */
  private sameContent(stored: readonly AgentModel[], incoming: readonly AgentModel[]): boolean {
    const last = this.lastComparison
    if (last !== null && last.stored === stored && last.incoming === incoming) return last.equal
    const equal = stored === incoming || isDeepStrictEqual(stored, incoming)
    this.lastComparison = { stored, incoming, equal }
    return equal
  }
}

function hostCatalogKey(state: AgentState): string {
  return `host:${state.host.hostId ?? PRIMARY_CATALOG_KEY}`
}

function clientCatalogKey(hostId: string): string {
  return `client:${hostId}`
}
