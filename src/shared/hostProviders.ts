import { z } from 'zod'
import { providerIdSchema, type ProviderId } from './agents'

/**
 * A host's providers from this computer (ADR-0037): the tiles under a connected host's row in Settings > Hosts, the
 * host's own connect, disconnect and refresh for one of its providers, and a provider's sign-in, run on the host by its
 * own client and finished by the user in this computer's browser.
 */

/** How long a sign-in lives on the host before its client is stopped and what it printed is dropped. */
export const PROVIDER_SIGN_IN_LIFETIME_MS = 15 * 60_000

/**
 * The two ways a provider's client signs in without a terminal. `device-code`: it prints a page and a short code, the
 * user enters the code on that page, and the client finishes by itself (Codex, Grok Build). `paste-code`: it prints a
 * page, the page shows a code once the user signs in, and the client waits for that code (Claude Code).
 */
export const providerSignInShapeSchema = z.enum(['device-code', 'paste-code'])
export type ProviderSignInShape = z.infer<typeof providerSignInShapeSchema>

/**
 * Where a sign-in stands. `starting` until the client has printed its page; `waiting` for the user; `finishing` while a
 * pasted code is with the client; then `connected`, `refused` (the client did not accept a pasted code), `failed`
 * (anything else ended it) or `ended` (cancelled, or past its fifteen minutes).
 */
export const providerSignInStageSchema = z.enum(['starting', 'waiting', 'finishing', 'connected', 'refused', 'failed', 'ended'])
export type ProviderSignInStage = z.infer<typeof providerSignInStageSchema>

/** Which providers sign in from this computer, and how. Devin's sign-in needs a terminal, so its tile shows the command. */
export const PROVIDER_SIGN_IN_SHAPES: Readonly<Record<ProviderId, ProviderSignInShape | null>> = {
  codex: 'device-code', grok: 'device-code', claude: 'paste-code', devin: null,
}
/** What Devin's tile says to run on the host: its sign-in for a machine reached over SSH, where a browser cannot come back to it. */
export const DEVIN_SIGN_IN_COMMAND = 'devin auth login --force-manual-token-flow'

/**
 * The only pages a host's sign-in may open, by provider: https, one of these names exactly, no port, no user. They are
 * the pages each client printed when its sign-in was run: Codex's `https://auth.openai.com/codex/device`, Grok Build's
 * `https://accounts.x.ai/oauth2/device`, and Claude Code's `https://claude.com/cai/oauth/authorize`, which older
 * versions printed on `claude.ai`. A page anywhere else is not opened, and the sign-in says to finish it on the host.
 */
export const PROVIDER_SIGN_IN_PAGES: Readonly<Record<ProviderId, readonly string[]>> = {
  codex: ['auth.openai.com'], grok: ['accounts.x.ai'], claude: ['claude.com', 'claude.ai'], devin: [],
}
export function isProviderSignInPage(provider: ProviderId, value: string): boolean {
  if (value.length > 4096 || /\s/u.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.port === '' && !url.username && !url.password && PROVIDER_SIGN_IN_PAGES[provider].includes(url.hostname)
  } catch { return false }
}

/**
 * One sign-in as the host tells the client that started it, and nobody else. `url` and `code` are there only while it
 * waits for the user and are never logged or written down on either side; `page` is the name of the page's host, which
 * the dialog says the user is awaited on. `message` says what happened when it did not end connected.
 */
/** The longest sentence a sign-in's `message` carries; the host shortens a longer one rather than send what fails the schema. */
export const SIGN_IN_MESSAGE_MAX = 600
export const hostSignInSchema = z.object({
  id: z.uuid(), provider: providerIdSchema, shape: providerSignInShapeSchema, stage: providerSignInStageSchema,
  url: z.string().min(1).max(4096).optional(), code: z.string().min(1).max(64).optional(), page: z.string().min(1).max(253).optional(),
  expiresInMinutes: z.number().int().min(1).max(60).optional(), message: z.string().min(1).max(SIGN_IN_MESSAGE_MAX).optional(),
}).strict()
export type HostSignIn = z.infer<typeof hostSignInSchema>
/** What the window is given: the host's view without the page's address, which only main holds, and only to open it. */
export type ProviderSignInView = Omit<HostSignIn, 'url'>

/** The longest code Sotto hands a client. Claude Code's is a code and a state joined by `#`, well under this. */
export const PASTED_CODE_MAX = 2048

/** What Settings > Hosts asks of one of a saved host's providers. `id` is the saved host's. */
export const hostProviderActionSchema = z.object({
  id: z.uuid(), provider: providerIdSchema, action: z.enum(['connect', 'disconnect', 'refresh']),
}).strict()
export type HostProviderAction = z.infer<typeof hostProviderActionSchema>
/** How a provider action went: nothing when the host took it, else the host's own sentence, naming the host. */
export interface HostProviderActionResult { readonly error?: string }

export const hostSignInRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), id: z.uuid(), provider: providerIdSchema }).strict(),
  z.object({ type: z.literal('read'), id: z.uuid(), signInId: z.uuid() }).strict(),
  z.object({ type: z.literal('code'), id: z.uuid(), signInId: z.uuid(), code: z.string().min(1).max(PASTED_CODE_MAX) }).strict(),
  z.object({ type: z.literal('cancel'), id: z.uuid(), signInId: z.uuid() }).strict(),
  /** Open sign-in page: main asks the host for the page and opens it, checked, in the default browser. */
  z.object({ type: z.literal('open'), id: z.uuid(), signInId: z.uuid() }).strict(),
])
export type HostSignInRequest = z.infer<typeof hostSignInRequestSchema>

export const HOSTS_PROVIDER_ACTION = 'hosts:provider-action'
export const HOSTS_SIGN_IN = 'hosts:sign-in'
