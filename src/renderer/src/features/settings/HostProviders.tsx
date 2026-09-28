import React, { useEffect, useId, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { PROVIDER_LABELS, type AgentProviderStatus, type ProviderId } from '../../../../shared/agents'
import type { HostsBridge, HostStatus } from '../../../../shared/hosts'
import { DEVIN_SIGN_IN_COMMAND, PROVIDER_SIGN_IN_SHAPES, type HostProviderAction } from '../../../../shared/hostProviders'
import { Button } from '../../components/Button'
import { ProviderMark } from '../../agents/ProviderMark'
import { HostProviderSignIn } from './HostProviderSignIn'
import './hostProviders.css'

/** The order the tiles are in: the providers the prototype drew, in its order (ADR-0037). */
export const HOST_PROVIDER_ORDER: readonly ProviderId[] = ['claude', 'codex', 'grok', 'devin']

/**
 * What one tile says. `kind` decides its dot and its one action: Disconnect when connected, Connect when turned off,
 * Sign in when not signed in, and Check again when the host cannot use it (not installed, too old, or not startable),
 * which is where #461's agent actions will go.
 */
export type HostProviderTileKind = 'connected' | 'connecting' | 'off' | 'signed-out' | 'not-installed' | 'too-old' | 'cannot-start'
export interface HostProviderTile { readonly kind: HostProviderTileKind; readonly state: string; readonly detail: string }

/** A client's own version as the tile shows it: "0.155.1" from "codex-cli 0.155.1" or "1.0.41 / ACP 1". */
export function shownVersion(version: string): string {
  return version.match(/\d+\.\d+\.\d+(?:-[\w.]+)?/u)?.[0] ?? version.trim().slice(0, 36)
}

/** The tile for one of a host's providers, from the status the host publishes. `host` is the name this computer saved it under. */
export function hostProviderTile(status: AgentProviderStatus | undefined, host: string): HostProviderTile {
  const version = status?.version ? shownVersion(status.version) : ''
  if (status?.connection === 'connected') return { kind: 'connected', state: 'Connected', detail: [status.account, version].filter(Boolean).join(' · ') }
  if (status?.connection === 'connecting') return { kind: 'connecting', state: 'Connecting…', detail: version }
  if (status?.connection !== 'error') return { kind: 'off', state: 'Turned off', detail: version || `Connect it to use it on ${host}.` }
  switch (status.problem) {
    case 'signed-out': return { kind: 'signed-out', state: 'Not signed in', detail: version || `Installed on ${host}.` }
    case 'not-installed': return { kind: 'not-installed', state: 'Not installed', detail: `Not on ${host} yet.` }
    case 'too-old': return { kind: 'too-old', state: 'Too old to use', detail: version ? `${version} on ${host} is older than Sotto supports.` : `The one on ${host} is older than Sotto supports.` }
    default: return { kind: 'cannot-start', state: "Can't be started", detail: `The host on ${host} could not start it.` }
  }
}

/** How many of a host's providers are connected, as its row says after "Connected". */
export function connectedProvidersLabel(providers: readonly AgentProviderStatus[]): string {
  const count = providers.filter(provider => provider.connection === 'connected').length
  return `${count} provider${count === 1 ? '' : 's'}`
}

type Pending = HostProviderAction['action']
const PENDING_LABEL: Readonly<Record<Pending, string>> = { connect: 'Connecting…', disconnect: 'Disconnecting…', refresh: 'Checking…' }

/** Devin signs in from a terminal on the host: its tile shows the command, with Copy, instead of Sign in. */
function SignInCommand({ host }: { readonly host: string }): ReactNode {
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null)
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(null), 1500); return () => clearTimeout(timer) }, [copied])
  const copy = async (): Promise<void> => { try { await navigator.clipboard.writeText(DEVIN_SIGN_IN_COMMAND); setCopied('copied') } catch { setCopied('failed') } }
  return <div className="host-provider__command">
    <p>Sign in on {host} with:</p>
    <code>{DEVIN_SIGN_IN_COMMAND}</code>
    <Button variant="secondary" aria-label="Copy the Devin sign-in command" onClick={() => void copy()}>
      {copied === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied === 'copied' ? 'Copied' : 'Copy'}
    </Button>
    {copied === 'failed' ? <p>The command could not be copied. Select it and copy it yourself.</p> : null}
    <span className="tt-visually-hidden" role="status">{copied === 'copied' ? 'Copied the command' : ''}</span>
  </div>
}

function ProviderTile({ host, provider, status, bridge, onSignIn }: {
  readonly host: HostStatus; readonly provider: ProviderId; readonly status: AgentProviderStatus | undefined
  readonly bridge: HostsBridge; readonly onSignIn: (provider: ProviderId) => void
}): ReactNode {
  const name = PROVIDER_LABELS[provider]
  const tile = hostProviderTile(status, host.name)
  const [pending, setPending] = useState<Pending | null>(null)
  /** What the last press found, for the state it was pressed in: a tile the press changed has already said it. */
  const [note, setNote] = useState<{ readonly text: string; readonly kind: HostProviderTileKind } | null>(null)
  const titleId = useId()
  // A new settled state from the host says more than the last press's note; passing through Connecting does not.
  useEffect(() => { if (tile.kind !== 'connecting') setNote(current => current && current.kind !== tile.kind ? null : current) }, [tile.kind])
  const act = async (action: Pending): Promise<void> => {
    const before = tile.kind
    setPending(action); setNote(null)
    try {
      const result = await bridge.providerAction({ id: host.id, provider, action })
      // Check again that finds nothing new says so; its refusal is the same sentence the tile already stands for.
      if (action === 'refresh') setNote({ text: `Checked again. Nothing changed on ${host.name}.`, kind: before })
      else if (result.error) setNote({ text: result.error, kind: before })
    } catch (failure) {
      setNote({ text: failure instanceof Error ? failure.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/u, '') : `${host.name} did not answer. Nothing was changed. Try again.`, kind: before })
    } finally { setPending(null) }
  }
  const shownNote = note && note.kind === tile.kind ? note.text : ''
  const problem = tile.kind === 'not-installed' || tile.kind === 'too-old' || tile.kind === 'cannot-start'
  const action = (): ReactNode => {
    if (tile.kind === 'connected') return <Button variant="ghost" disabled={pending !== null} aria-label={`Disconnect ${name} on ${host.name}`} onClick={() => void act('disconnect')}>{pending ? PENDING_LABEL[pending] : 'Disconnect'}</Button>
    if (tile.kind === 'off') return <Button variant="secondary" disabled={pending !== null} aria-label={`Connect ${name} on ${host.name}`} onClick={() => void act('connect')}>{pending ? PENDING_LABEL[pending] : 'Connect'}</Button>
    if (tile.kind === 'signed-out') {
      if (!PROVIDER_SIGN_IN_SHAPES[provider]) return <SignInCommand host={host.name} />
      return <Button variant="primary" aria-label={`Sign in to ${name} on ${host.name} from this computer`} onClick={() => onSignIn(provider)}>Sign in</Button>
    }
    if (problem) {
      // #461 puts "Have my agent install it" (update it, fix it) beside Check again, in this row.
      return <div className="host-provider__actions">
        <Button variant="secondary" disabled={pending !== null} aria-label={`Check ${host.name} for ${name} again`} onClick={() => void act('refresh')}>{pending ? PENDING_LABEL[pending] : 'Check again'}</Button>
      </div>
    }
    return null
  }
  return <li className="host-provider" data-kind={tile.kind} aria-labelledby={titleId}>
    <div className="host-provider__top">
      <span className="host-provider__mark" aria-hidden="true"><ProviderMark provider={provider} name={name} size={16} /></span>
      <h5 id={titleId}>{name}</h5>
    </div>
    <p className="host-provider__state"><span className="host-provider__dot" aria-hidden="true" />{tile.state}</p>
    {tile.detail ? <p className="host-provider__detail">{tile.detail}</p> : null}
    <div className="host-provider__act">{action()}</div>
    <p className="host-provider__note" role="status">{shownNote}</p>
  </li>
}

/**
 * A connected host's providers, under its row in Settings > Hosts (ADR-0037, layout B of `prototype/host-providers`):
 * Show providers opens a tile for each of the four, and each tile acts on that host alone. Sign in opens a small dialog
 * that runs the provider's own sign-in on the host and finishes it in this computer's browser.
 */
export function HostProviders({ host, providers, bridge }: {
  readonly host: HostStatus; readonly providers: readonly AgentProviderStatus[]; readonly bridge: HostsBridge
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [signingIn, setSigningIn] = useState<ProviderId | null>(null)
  const gridId = useId()
  return <div className="host-providers">
    <Button variant="ghost" className="host-providers__toggle" aria-expanded={open} aria-controls={open ? gridId : undefined}
      aria-label={`${open ? 'Hide' : 'Show'} providers on ${host.name}`} onClick={() => setOpen(value => !value)}>
      {open ? 'Hide providers' : 'Show providers'}
    </Button>
    {open ? <div id={gridId} className="host-providers__panel">
      <ul className="host-providers__grid" aria-label={`Providers on ${host.name}`}>
        {HOST_PROVIDER_ORDER.map(provider => <ProviderTile key={provider} host={host} provider={provider} bridge={bridge}
          status={providers.find(item => item.id === provider)} onSignIn={setSigningIn} />)}
      </ul>
      <p className="host-providers__foot">{host.name} connects each provider that is signed in when its host starts. A provider you disconnect stays off.</p>
    </div> : null}
    {signingIn ? <HostProviderSignIn host={host} provider={signingIn} bridge={bridge} onClose={() => setSigningIn(null)} /> : null}
  </div>
}
