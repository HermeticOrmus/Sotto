import { z } from 'zod'

export const PHONES_GET = 'phones:get'
export const PHONES_COMMAND = 'phones:command'
export const PHONES_CHANGED = 'phones:changed'

/** The Tailscale Serve port phone access uses. 443 is left to other apps (ADR-0033). */
export const PHONE_ACCESS_SERVE_PORT = 8443

/** The first row of the Phones checklist: whether Tailscale is up on this computer. */
export type TailscaleCheck =
  | { readonly status: 'waiting' }
  | { readonly status: 'ok'; readonly hostName: string; readonly dnsName: string }
  | { readonly status: 'failed'; readonly reason: 'missing' | 'not-running' }

/** The second row: whether Sotto's Tailscale Serve setting on port 8443 is in place. */
export type ServeCheck =
  | { readonly status: 'waiting' }
  | { readonly status: 'ok' }
  | {
      readonly status: 'failed'
      /**
       * `port-taken`: port 8443 already carries another Serve setting, which Sotto leaves alone.
       * `not-enabled`: the tailnet has not turned Serve on; `canOpenSetup` says whether Sotto has the page that turns it on.
       * `listener`: Sotto could not open its own loopback listener. `failed`: the serve command failed some other way.
       */
      readonly reason: 'port-taken' | 'not-enabled' | 'listener' | 'failed' | 'cleanup' | 'record'
      readonly canOpenSetup?: boolean
    }

export interface PairedPhone {
  readonly clientId: string
  /** As the phone sent it when it paired. */
  readonly name: string
  readonly pairedAt: string
  /** Holds an open socket now. */
  readonly connected: boolean
  /** A policy record lets this phone's answers count (ADR-0004). */
  readonly canAnswer: boolean
}

export interface PhonesState {
  /** The `phoneAccess` setting. */
  readonly enabled: boolean
  /** Phone access serves the local host's threads, so it needs the local host running. */
  readonly localHostRunning: boolean
  /** `starting` while Sotto checks Tailscale and sets up Serve; `on` once phones can connect. */
  readonly phase: 'off' | 'starting' | 'on' | 'failed' | 'cleanup-failed'
  readonly tailscale: TailscaleCheck
  readonly serve: ServeCheck
  /** `https://<name>.<tailnet>.ts.net:8443`, once Serve is in place. */
  readonly address: string | null
  /** The name phones show for this computer: the setting, or `defaultName` when it is empty. */
  readonly computerName: string
  readonly defaultName: string
  /** The one live pairing code, if any. It lives in memory only and is never logged. */
  readonly code: { readonly code: string; readonly expiresAt: string } | null
  readonly phones: readonly PairedPhone[]
  /** False when this computer's permission policies cannot be read, so Can answer cannot be turned on. */
  readonly answersAvailable: boolean
}

export const phonesCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('retry') }).strict(),
  z.object({ type: z.literal('show-code') }).strict(),
  z.object({ type: z.literal('cancel-code') }).strict(),
  z.object({ type: z.literal('set-can-answer'), clientId: z.string().min(1).max(512), allowed: z.boolean() }).strict(),
  z.object({ type: z.literal('remove'), clientId: z.string().min(1).max(512) }).strict(),
  z.object({ type: z.literal('open-serve-setup') }).strict(),
])
export type PhonesCommand = z.infer<typeof phonesCommandSchema>

export interface PhonesBridge {
  get(): Promise<PhonesState>
  command(command: PhonesCommand): Promise<PhonesState>
  onChanged(listener: (state: PhonesState) => void): () => void
}
