import React, { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Circle, Clock, Copy, LoaderCircle, X } from 'lucide-react'
import { HOST_SETUP_STEPS, type HostSetupStep, type HostStatus } from '../../../../shared/hosts'
import { Button } from '../../components/Button'
import './hostSetup.css'

/** Where "Why Tailscale asks" leads: the guide's section on a tailnet policy's `check` and `accept`. */
export const TAILSCALE_GUIDE_URL = 'https://github.com/millZach/Sotto/blob/main/docs/guide.md#hosts-over-tailscale-ssh'

/** Where Add host stands once pressed: still connecting, stopped at a failed step, or connected and saved. */
export type HostSetupOutcome = 'connecting' | 'failed' | 'connected'
type StepState = 'done' | 'active' | 'waiting' | 'failed' | 'todo'

/** The dialog's title while the checklist shows: where the add stands, in one line. */
export function hostSetupTitle(name: string, outcome: HostSetupOutcome): string {
  return outcome === 'connected' ? `${name} is connected` : outcome === 'failed' ? `${name} could not be added` : `Connecting to ${name}`
}

/** "forge · user and port from your SSH configuration": what Add host was asked to connect to. */
export function hostSetupSummary(user: string, port: number | undefined): string {
  if (user && port) return `as ${user}, port ${port}`
  if (user) return `as ${user}, port from your SSH configuration`
  if (port) return `port ${port}, user from your SSH configuration`
  return 'user and port from your SSH configuration'
}

/** Each step's name: still to come, under way, done, and failed. */
function stepTitle(step: HostSetupStep, state: StepState, name: string): string {
  const titles: Record<HostSetupStep, readonly [todo: string, active: string, done: string, failed: string]> = {
    reach: [`Reach ${name}`, `Reaching ${name}…`, `Reached ${name}`, `Could not reach ${name}`],
    tailscale: ['Approve in Tailscale', 'Waiting for your approval in Tailscale', 'Approved in Tailscale', 'Not approved in Tailscale'],
    'sign-in': ['Sign in', 'Signing in…', 'Signed in', 'Could not sign in'],
    install: ['Check the host installation', 'Checking the host installation…', 'Host installed', `The host cannot run on ${name} yet`],
    start: ['Start the host', 'Starting the host…', 'Host started', 'The host did not start'],
    pair: ['Pair this computer', 'Pairing this computer…', 'Paired', 'Could not pair this computer'],
  }
  const [todo, active, done, failed] = titles[step]
  return state === 'done' ? done : state === 'failed' ? failed : state === 'todo' ? todo : active
}

const MARK_LABEL: Record<StepState, string> = { done: 'Done', active: 'In progress', waiting: 'Waiting for you', failed: 'Failed', todo: 'Not started' }
function StepMark({ state }: { readonly state: StepState }): ReactNode {
  return <span className="host-setup__mark" data-state={state} role="img" aria-label={MARK_LABEL[state]}>
    {state === 'done' ? <Check size={16} strokeWidth={2.2} aria-hidden="true" />
      : state === 'failed' ? <X size={16} strokeWidth={2.2} aria-hidden="true" />
        : state === 'waiting' ? <Clock size={16} strokeWidth={1.9} aria-hidden="true" />
          : state === 'active' ? <LoaderCircle size={16} strokeWidth={2} aria-hidden="true" className="hosts-spin" />
            : <Circle size={12} strokeWidth={1.7} aria-hidden="true" />}
  </span>
}

/** A command the user runs to fix a failure, with Copy. Sotto never runs it. */
function FixCommand({ fix }: { readonly fix: NonNullable<HostStatus['fix']> }): ReactNode {
  const [copied, setCopied] = useState<'copied' | 'failed' | null>(null)
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(null), 1500); return () => clearTimeout(timer) }, [copied])
  const copy = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(fix.command); setCopied('copied') } catch { setCopied('failed') }
  }
  return <>
    <p>{fix.text}</p>
    <div className="host-setup__command">
      <code>{fix.command}</code>
      <Button variant="secondary" aria-label="Copy the command" onClick={() => void copy()}>
        {copied === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied === 'copied' ? 'Copied' : 'Copy'}
      </Button>
    </div>
    {copied === 'failed' ? <p className="host-setup__quiet">The command could not be copied. Select it and copy it yourself.</p> : null}
  </>
}

/**
 * Add host once pressed: the host setup checklist. The form shrinks to a line saying what is being added,
 * and each step says whether it is done, under way, waiting for the user, failed or still to come. A failure
 * shows on its own step with main's sentence (what happened, that nothing was saved, what to do) and a
 * command to copy where there is one. SSH's own questions sit on the step that asked them.
 */
export function HostSetupChecklist({ name, summary, host, outcome, error, question, onChange, onOpenApproval, onOpenGuide }: {
  /** The host part of the target, which names the host until it is renamed. */
  readonly name: string
  /** What was asked for besides the host: `hostSetupSummary()`. */
  readonly summary: string
  /** The connect as main reports it: Add host's attempt, or the saved host once it is added. */
  readonly host: HostStatus | undefined
  readonly outcome: HostSetupOutcome
  /** Main's failure sentence, or one from the dialog itself. */
  readonly error: string | null
  /** SSH's question (a host key, a password or a passphrase), shown on the step that is asking. */
  readonly question?: ReactNode
  /** Back to the form; the attempt is dropped first. Absent once the host is added. */
  readonly onChange?: (() => void) | undefined
  readonly onOpenApproval: () => void
  readonly onOpenGuide: () => void
}): ReactNode {
  const approval = useRef<HTMLButtonElement>(null)
  const approvalUrl = host?.tailscale?.waiting ? host.tailscale.url : undefined
  // Tailscale's approval is the one thing to do while it waits, so focus goes to it when it arrives.
  useEffect(() => { if (approvalUrl) approval.current?.focus() }, [approvalUrl])
  const current: HostSetupStep | undefined = outcome === 'connected' ? undefined : host?.step ?? 'reach'
  const steps = HOST_SETUP_STEPS.filter(step => step !== 'tailscale' || host?.tailscale !== undefined || current === 'tailscale')
  const at = current === undefined ? steps.length : steps.indexOf(current)
  const stateOf = (index: number, step: HostSetupStep): StepState => {
    if (index < at) return 'done'
    if (index > at) return 'todo'
    if (outcome === 'failed') return 'failed'
    return step === 'tailscale' && host?.tailscale?.waiting ? 'waiting' : 'active'
  }
  return <div className="host-setup">
    <div className="host-setup__summary">
      <p><b>{name}</b> <span>· {summary}</span></p>
      {onChange ? <Button variant="ghost" onClick={onChange} aria-label={outcome === 'connecting' ? 'Change the host to add, and stop connecting' : 'Change the host to add'}>Change</Button> : null}
    </div>
    <ol className="host-setup__steps" aria-label="Connection steps">
      {steps.map((step, index) => {
        const state = stateOf(index, step)
        return <li key={step} data-state={state} aria-current={state === 'active' || state === 'waiting' ? 'step' : undefined}>
          <StepMark state={state} />
          <span className="host-setup__title">{stepTitle(step, state, name)}</span>
          {state === 'waiting' ? <div className="host-setup__detail"><div className="hosts-notice host-setup__card" role="status">
            <p>{name} uses Tailscale SSH, which asks you to approve new connections in your browser. Sotto waits up to 5 minutes and carries on when you approve.</p>
            <div className="host-setup__actions">
              {approvalUrl ? <Button ref={approval} onClick={onOpenApproval}>Open approval page</Button> : null}
              <button type="button" className="host-setup__link tt-focusable" onClick={onOpenGuide}>Why Tailscale asks</button>
            </div>
          </div></div> : null}
          {state === 'active' && question ? <div className="host-setup__detail">{question}</div> : null}
          {state === 'failed' && error ? <div className="host-setup__detail"><div className="hosts-notice hosts-notice--error host-setup__card" role="alert">
            <p>{error}</p>
            {host?.fix ? <FixCommand fix={host.fix} /> : null}
          </div></div> : null}
        </li>
      })}
    </ol>
    {outcome === 'connecting' && error ? <div className="hosts-notice hosts-notice--error host-setup__card" role="alert"><p>{error}</p></div> : null}
    {outcome === 'connected' ? <div className="hosts-notice host-setup__card host-setup__card--done" role="status">
      <p>{host?.name ?? name} is added and connected. Its projects and threads show in the Threads sidebar with a {host?.name ?? name} badge.</p>
    </div> : null}
  </div>
}
