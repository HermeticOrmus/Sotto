import { z } from 'zod'
import type { HostDeviceList, TailscaleConnectOutcome, TailscaleSummary } from './hostDevices'

export const HOSTS_GET = 'hosts:get'
export const HOSTS_COMMAND = 'hosts:command'
export const HOSTS_CHANGED = 'hosts:changed'

/** Where a new host's installation and data folders default to on the SSH host. */
export const DEFAULT_HOST_INSTALL_PATH = '~/.local/share/sotto-host'
export const DEFAULT_HOST_DATA_DIRECTORY = '~/.sotto'

export const remoteHostSchema = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(80),
  target: z.string().trim().min(1).max(256), identityFile: z.string().max(4096).default(''),
  installPath: z.string().min(1).max(4096), dataDirectory: z.string().min(1).max(4096),
  /** The SSH port when it is not the one the SSH configuration gives; passed to ssh as `-p`. */
  sshPort: z.number().int().min(1).max(65535).optional(),
  /**
   * Whether the host is switched on: kept connected now and at every launch. Absent on hosts saved before
   * the switch existed, which count as on.
   */
  enabled: z.boolean().optional(),
}).strict()
export type RemoteHost = z.infer<typeof remoteHostSchema>
/**
 * The host setup checklist: the steps a connect goes through, in the order it meets them. Add host shows
 * them once pressed. `tailscale` appears only when Tailscale SSH holds the connection for the user's approval.
 */
export const HOST_SETUP_STEPS = ['reach', 'tailscale', 'sign-in', 'install', 'start', 'pair'] as const
export type HostSetupStep = typeof HOST_SETUP_STEPS[number]
/** How long Sotto waits for the user to approve a connection Tailscale SSH holds in its `check` mode. */
export const TAILSCALE_APPROVAL_MS = 5 * 60_000
export interface HostStatus extends Omit<RemoteHost, 'enabled'> {
  enabled: boolean
  phase: 'disconnected' | 'connecting' | 'connected' | 'error'
  reconnecting?: boolean | undefined
  hostId?: string
  clientId?: string
  /**
   * True while connected to a host this Sotto started, or while the SSH session to one running another
   * Sotto version stays open for Stop host; only such a host answers Stop host.
   */
  owned?: boolean | undefined
  error?: string | undefined
  prompt?: { id: string; kind: 'host-key' | 'password' | 'passphrase'; text: string }
  /** Where the current connect stands: the step it is on while connecting, or the step that failed. */
  step?: HostSetupStep | undefined
  /**
   * Set once Tailscale SSH asked this connect for approval: `waiting` until the approval arrives, and `url`,
   * Tailscale's own approval page, while it waits. Shown, and opened only on the user's press; never logged.
   */
  tailscale?: { waiting: boolean; url?: string | undefined } | undefined
  /** A command that fixes the failure, for the user to run, and the sentence that introduces it. Sotto never runs it. */
  fix?: { text: string; command: string } | undefined
  /** Why the connect failed, as a stable code (`SshFailureCode`) the setup brief and the host setup tools name. Never shown. */
  reason?: string | undefined
  /** Set once a host setup check reached the host and it answered. A check pairs nothing and saves nothing. */
  checked?: boolean | undefined
}
/** A model the host setup thread can run on: one of this computer's ready models. */
export interface HostSetupModel { readonly id: string; readonly name: string; readonly provider: string }
/** What Have my agent set this up can offer: whether it can run at all, and the models to pick from. */
export interface HostSetupChoice {
  /** Why no setup can start, such as the local host being off. Absent when one can. */
  readonly unavailable?: string
  readonly models: readonly HostSetupModel[]
  /** The model the picker starts on: the one with the most threads on this computer, else the new-thread default. */
  readonly modelId?: string
}
/**
 * An agent setting up a host from Add host (ADR-0035): the device, the host setup thread working on it, and the
 * check or add that thread's tool ran last, which the dialog's checklist follows.
 */
export interface HostSetupState {
  /** Sotto's own ID for this setup; Stop setup and Done name it. */
  readonly id: string
  /** The device, named after the host part of its SSH target until the host is renamed. */
  readonly name: string
  readonly target: string
  readonly sshPort?: number | undefined
  /** The setup thread as the window addresses it, and its name. Absent until the thread exists. */
  readonly threadId?: string | undefined
  readonly threadTitle: string
  readonly modelName: string
  /** `starting` until the thread has its brief, `running` while it works, then how it ended. */
  readonly phase: 'starting' | 'running' | 'connected' | 'stopped' | 'failed'
  /** Why the setup could not start or carry on, set with `failed`; with `stopped`, a host the stop could not unsave. */
  readonly error?: string | undefined
  /** The latest check or add the thread's tool ran, as the checklist shows it. */
  readonly attempt?: (HostStatus & { readonly purpose: 'check' | 'add' }) | undefined
  /** Steps that failed in an earlier check and passed in a later one: done by the agent. */
  readonly byAgent: readonly HostSetupStep[]
  /**
   * What the thread is waiting on the user for: a command it wants to run, Sotto's "Add forge as a host?", or an
   * SSH question or Tailscale approval during the tool's check or add (`connection`), which the thread cannot show.
   */
  readonly waiting?: 'command' | 'add' | 'connection' | undefined
}
export interface HostsState {
  hosts: HostStatus[]; localHostEnabled: boolean; localHostRunning: boolean; activeHostId?: string; localHostId?: string
  /** The host the Add host dialog is connecting to. It is saved, and joins `hosts`, only once it answers and pairs. */
  adding?: HostStatus
  /** The host setup running or last ended, until Done dismisses it (ADR-0035). */
  setup?: HostSetupState
  /** What Have my agent set this up offers; absent where no setup can be offered at all. */
  setupChoice?: HostSetupChoice
}
export const hostsCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add'), host: remoteHostSchema.omit({ enabled: true }) }).strict(),
  z.object({ type: z.literal('cancel-add'), id: z.uuid() }).strict(),
  z.object({ type: z.literal('save'), host: remoteHostSchema.omit({ enabled: true }) }).strict(),
  z.object({ type: z.literal('rename'), id: z.uuid(), name: z.string().trim().min(1).max(80) }).strict(),
  z.object({ type: z.literal('set-enabled'), id: z.uuid(), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('connect'), id: z.uuid() }).strict(),
  z.object({ type: z.literal('disconnect'), id: z.uuid() }).strict(),
  z.object({ type: z.literal('stop-host'), id: z.uuid() }).strict(),
  z.object({ type: z.literal('forget'), id: z.uuid() }).strict(),
  z.object({ type: z.literal('ssh-answer'), id: z.uuid(), promptId: z.string().max(256), answer: z.string().max(4096) }).strict(),
  /** Opens the Tailscale approval page a connect is waiting on, in the default browser. Main holds the URL. */
  z.object({ type: z.literal('open-approval'), id: z.uuid() }).strict(),
  /**
   * Have my agent set this up (ADR-0035): a host setup thread on `modelId` for this one device. `after` names the
   * failed Add it attempt that Have my agent fix this was pressed on, whose step and reason the brief names.
   */
  z.object({ type: z.literal('start-setup'), id: z.uuid(), host: remoteHostSchema.omit({ enabled: true }), modelId: z.string().min(1).max(6_144), after: z.uuid().optional() }).strict(),
  /** Stop setup: stops the thread's turn and its tool, and saves nothing as a host. */
  z.object({ type: z.literal('stop-setup'), id: z.uuid() }).strict(),
  /** Done, or closing a setup that has ended: the dialog stops showing it. */
  z.object({ type: z.literal('dismiss-setup'), id: z.uuid() }).strict(),
  z.object({ type: z.literal('restart') }).strict(),
  z.object({ type: z.literal('select'), hostId: z.uuid() }).strict(),
])
export type HostsCommand = z.infer<typeof hostsCommandSchema>

/**
 * A host the user's own SSH setup already knows, which Add host lists among its devices: an alias from the
 * SSH configuration, or a name from known hosts. Read on this computer and never sent anywhere.
 */
export interface SshHostSuggestion {
  readonly alias: string
  /** Where the alias goes, such as `zach@forge.example.net`, when the configuration says. */
  readonly detail?: string
  /** The configuration's `HostName` for the alias, when it has one Sotto can read. */
  readonly hostname?: string
  /** A known host recorded on a port other than 22. */
  readonly port?: number
  readonly source: 'config' | 'known-hosts'
}
export interface HostsBridge {
  get(): Promise<HostsState>
  command(command: HostsCommand): Promise<HostsState>
  onChanged(listener: (state: HostsState) => void): () => void
  /** The devices Add host lists, from this computer's Tailscale and SSH setup, read when asked. */
  devices(): Promise<HostDeviceList>
  /** Tailscale on this computer, read when asked. */
  tailscale(): Promise<TailscaleSummary>
  /** Runs this computer's `tailscale up`, opening Tailscale's sign-in page in the default browser when it asks for one. */
  connectTailscale(): Promise<TailscaleConnectOutcome>
  /** Opens Tailscale's download page in the default browser. */
  openTailscaleDownload(): Promise<void>
}

/** Client projection only; remote wire payloads keep their original host-local IDs. */
export interface HostConnectionSummary { hostId: string; name: string; kind: 'local' | 'remote'; connected: boolean }
