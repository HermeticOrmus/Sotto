import React, { useId, type ReactNode } from 'react'
import type { HostSetupChoice, HostSetupState } from '../../../../shared/hosts'
import { Button } from '../../components/Button'
import { HostSetupChecklist, hostSetupSummary, type HostSetupOutcome } from './HostSetupChecklist'

/** How Add host adds the host: an agent sets the machine up first, or Sotto connects to a host already there. */
export type HostAddChoice = 'agent' | 'self'

/** The setup thread's model: this computer's ready models, by provider, starting on the one used most. */
export function SetupModelSelect({ choice, value, onChange, label = 'Model', disabled }: {
  readonly choice: HostSetupChoice; readonly value: string; readonly onChange: (id: string) => void
  readonly label?: string; readonly disabled?: boolean
}): ReactNode {
  const id = useId()
  const providers = [...new Set(choice.models.map(model => model.provider))]
  return <span className="host-setup__model">
    <label htmlFor={id}>{label}</label>
    <select id={id} className="tt-select tt-focusable" value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
      {providers.length > 1
        ? providers.map(provider => <optgroup key={provider} label={provider}>{choice.models.filter(model => model.provider === provider).map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</optgroup>)
        : choice.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
    </select>
  </span>
}

/**
 * The two ways Add host adds a machine (ADR-0035, placement A2). Native radios, so the arrow keys move between
 * them and Tab leaves the group; the model picker sits inside the agent's choice while it is chosen.
 */
export function HostAddChoices({ value, onChange, choice, modelId, onModel, disabled }: {
  readonly value: HostAddChoice; readonly onChange: (value: HostAddChoice) => void
  readonly choice: HostSetupChoice | undefined; readonly modelId: string; readonly onModel: (id: string) => void
  readonly disabled: boolean
}): ReactNode {
  const name = useId()
  const agentAvailable = choice !== undefined && !choice.unavailable && choice.models.length > 0
  const agentHint = useId(), selfHint = useId(), agentName = useId(), selfName = useId()
  return <div className="host-setup__choices" role="radiogroup" aria-label="How to add the host">
    <label className="host-setup__choice" data-checked={value === 'agent' || undefined} data-disabled={!agentAvailable || undefined}>
      <input type="radio" name={name} value="agent" checked={value === 'agent'} disabled={disabled || !agentAvailable} aria-labelledby={agentName} aria-describedby={agentHint}
        className="tt-focusable" onChange={() => onChange('agent')} />
      <span className="host-setup__choice-name" id={agentName}>Have my agent set this up</span>
      <span className="host-setup__choice-text" id={agentHint}>{agentAvailable
        ? 'For a machine without the host yet. The agent installs it, fixes what is missing and adds the host. It works in a new thread, and you answer each command it wants to run.'
        : choice?.unavailable ?? 'An agent cannot set up a host from this window.'}</span>
    </label>
    {value === 'agent' && agentAvailable ? <div className="host-setup__choice-row"><SetupModelSelect choice={choice} value={modelId} onChange={onModel} disabled={disabled} label="Model" /></div> : null}
    <label className="host-setup__choice" data-checked={value === 'self' || undefined}>
      <input type="radio" name={name} value="self" checked={value === 'self'} disabled={disabled} aria-labelledby={selfName} aria-describedby={selfHint}
        className="tt-focusable" onChange={() => onChange('self')} />
      <span className="host-setup__choice-name" id={selfName}>Add it</span>
      <span className="host-setup__choice-text" id={selfHint}>For a machine that already has the host. Sotto connects now and says what to fix if a step fails.</span>
    </label>
  </div>
}

/** The setup view's title: where the setup stands, in one line. */
export function hostSetupViewTitle(setup: HostSetupState): string {
  if (setup.phase === 'connected') return `${setup.name} is connected`
  if (setup.phase === 'stopped') return `Setup of ${setup.name} stopped`
  if (setup.phase === 'failed') return `${setup.name} could not be set up`
  return `Setting up ${setup.name}`
}
const ended = (setup: HostSetupState): boolean => setup.phase === 'connected' || setup.phase === 'stopped' || setup.phase === 'failed'

/**
 * Add host while an agent sets the machine up (ADR-0035, round 3 moments 6 and 7): who is working in which thread,
 * the checklist following the thread's checks and add, a card on the step when the thread waits for an answer, and
 * what happened once it ends. SSH's questions and Tailscale's approval sit on their steps, as in Add host.
 */
export function HostSetupProgress({ setup, question, approvalError, onOpenThread, onOpenApproval, onOpenGuide }: {
  readonly setup: HostSetupState
  readonly question: ReactNode
  readonly approvalError: string | null
  readonly onOpenThread: () => void
  readonly onOpenApproval: () => void
  readonly onOpenGuide: () => void
}): ReactNode {
  const attempt = setup.attempt
  const target = setup.target.includes('@') ? setup.target.slice(0, setup.target.lastIndexOf('@')) : ''
  const outcome: HostSetupOutcome = setup.phase === 'connected' ? 'connected' : 'connecting'
  const openThread = <Button variant="secondary" disabled={!setup.threadId} onClick={onOpenThread}>Open thread</Button>
  const waiting = setup.waiting && !ended(setup) ? <div className="hosts-notice host-setup__card" role="status">
    <p>{setup.waiting === 'add' ? `Sotto is asking in the thread whether to add ${setup.name} as a host. Answer it there to carry on.`
      : `The agent wants to run a command on ${setup.name}. Answer it in the thread to carry on.`}</p>
    <div className="host-setup__actions">{openThread}</div>
  </div> : undefined
  const line = !ended(setup) ? <div className="host-setup__agent">
    <p>{setup.phase === 'starting'
      ? <>Starting the thread <b>{setup.threadTitle}</b> on <b>{setup.modelName}</b>.</>
      : <><b>{setup.modelName}</b> is setting up {setup.name} in the thread <b>{setup.threadTitle}</b>. You answer each command it wants to run.</>}</p>
    {openThread}
  </div> : undefined
  return <>
    <HostSetupChecklist name={setup.name} summary={hostSetupSummary(target, setup.sshPort)} host={attempt} outcome={outcome}
      error={attempt?.phase === 'error' ? attempt.error ?? null : null} approvalError={approvalError} question={question}
      onOpenApproval={onOpenApproval} onOpenGuide={onOpenGuide}
      agent={{ byAgent: setup.byAgent, waiting, line, idle: attempt === undefined && setup.phase !== 'connected' }} />
    {setup.phase === 'connected' ? <div className="hosts-notice host-setup__card host-setup__card--done" role="status">
      <p>{setup.name} is added and connected. {setup.modelName} set it up in <button type="button" className="host-setup__link tt-focusable" onClick={onOpenThread}>{setup.threadTitle}</button>; the thread stays in your Threads list until you archive it.</p>
    </div> : null}
    {setup.phase === 'stopped' ? <div className="hosts-notice host-setup__card" role="status">
      <p>Setup stopped. Nothing was saved as a host. Anything the agent installed on {setup.name} stays there, and the thread {setup.threadTitle} stays in your Threads list.</p>
      {setup.threadId ? <div className="host-setup__actions">{openThread}</div> : null}
    </div> : null}
    {setup.phase === 'failed' ? <div className="hosts-notice hosts-notice--error host-setup__card" role="alert">
      <p>{setup.error ?? 'The setup could not carry on. Nothing was saved as a host.'}</p>
      {setup.threadId ? <div className="host-setup__actions">{openThread}</div> : null}
    </div> : null}
  </>
}

/** Whether the setup is over, so its dialog offers Done rather than Close and Stop setup. */
export const hostSetupEnded = ended
