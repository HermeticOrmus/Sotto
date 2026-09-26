import React, { useEffect, useState, type ReactNode } from 'react'
import { defaultNewThreadModelId, isSubscriptionReasoning, PROVIDER_LABELS, type AgentConfiguration, type AgentCommand, type AgentRuntimeMode, type AgentState } from '../../../shared/agents'
import { resolveNewThreadPermission, RUNTIME_MODE_ORDER } from '../../../shared/newThreadDefaults'
import { Button } from '../components/Button'
import { useVoiceCoordinatorEnabled } from '../state/voiceCoordinator'
import { useOptionalAgents, type AgentConnection } from './AgentContext'
import { ChoiceChip, effortChoices, RUNTIME_LABELS } from './ThreadOptions'
import { EffortPicker } from './EffortPicker'
import { ModelPicker } from './ModelPicker'
import { VoiceSettings } from './VoiceSettings'
import { ProviderUpgradeNotice } from './ProviderUpgradeNotice'

/**
 * Settings → Agents' "New threads start with" row: the composer's own model, reasoning and permission chips,
 * saving on change (issue #347). The permissions chip always lists Sotto's four modes, whatever the chosen
 * model offers, because the default is a Sotto-wide preference; the note under the row says when the chosen
 * model's provider starts a thread on a different mode instead (the nearest safer one it offers, or, for a
 * provider with its own permission profiles such as Devin, its first).
 */
function NewThreadDefaultsRow({ state, command }: { readonly state: AgentState; readonly command: AgentConnection['command'] }): ReactNode {
  const configuration = state.configuration
  const models = state.host.models
  const modelId = defaultNewThreadModelId(configuration, models, state.reasoningAccounts)
  const model = models.find(item => item.id === modelId)
  const reasoning = configuration.newThreadReasoningEffort || model?.defaultReasoningEffort || ''
  const efforts = effortChoices(model, reasoning)
  const chosenMode = configuration.newThreadRuntimeMode
  const providerLabel = model?.providerId ? PROVIDER_LABELS[model.providerId] : model?.provider
  const permissionOptions = RUNTIME_MODE_ORDER.map(mode => ({ id: mode, label: RUNTIME_LABELS[mode] }))
  let fitNote: string | null = null
  if (model?.providerModes?.length) fitNote = `${providerLabel ?? 'This provider'} uses its own permission profiles; a new thread starts on its first.`
  else if (chosenMode) {
    const resolved = resolveNewThreadPermission(model, chosenMode)
    if (resolved.nearestFit && resolved.runtimeMode) fitNote = `${providerLabel ?? 'This provider'} has no "${RUNTIME_LABELS[chosenMode]}", so its threads start on "${RUNTIME_LABELS[resolved.runtimeMode]}".`
  }
  const save = (patch: Partial<AgentConfiguration>): void => { void command({ type: 'configure', patch }) }
  return <div className="account-row account-row--chips">
    <span className="account-row__heading"><strong>New threads start with</strong><span>Model, reasoning effort and permissions, as the composer shows them.</span></span>
    <fieldset className="account-row__control">
      <legend className="tt-visually-hidden">New threads start with</legend>
      <ModelPicker models={models} modelId={modelId} disabled={false} onChange={id => save({ newThreadModelId: id })} />
      {efforts.length > 0 && <EffortPicker value={reasoning} options={efforts} disabled={false}
        onChange={effort => save({ newThreadReasoningEffort: effort })} defaultValue={model?.defaultReasoningEffort} modelName={model?.name} />}
      <ChoiceChip label="Default permissions for new threads" placeholder="Provider default" value={chosenMode ?? ''} options={permissionOptions} disabled={false} pending={false}
        onChange={mode => save({ newThreadRuntimeMode: mode as AgentRuntimeMode })} />
    </fieldset>
    {fitNote ? <p className="account-row__note">{fitNote}</p> : null}
  </div>
}

function SavedField({ label, value, onSave, secret = false, placeholder }: {
  readonly label: string; readonly value: string; readonly onSave: (value: string) => Promise<boolean>
  readonly secret?: boolean; readonly placeholder?: string
}): ReactNode {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState(false)
  useEffect(() => { setDraft(value) }, [value])
  return <label className="agent-saved-field">{label}<input aria-label={label} value={draft} type={secret ? 'password' : 'text'} autoComplete="off" placeholder={placeholder ?? ''} onChange={event => { setDraft(event.target.value); setError(false) }} onBlur={() => {
    if (draft === value) return
    void onSave(draft).then(ok => { setError(!ok); if (ok && secret) setDraft('') }).catch(() => setError(true))
  }} aria-invalid={error} />{error ? <span role="alert">Could not save. Check the value and try again.</span> : null}</label>
}

function AgentAccountSettings(): ReactNode {
  const agents = useOptionalAgents()
  const state = agents?.state
  const command = agents?.command
  const [checking, setChecking] = useState(false)
  if (!state || !command) return <p>Agent account settings are loading.</p>
  const configuration = state.configuration
  const account = state.reasoningAccounts.find(account => account.provider === configuration.reasoning)
  const subscription = isSubscriptionReasoning(configuration.reasoning)
  const model = account?.models.find(model => model.id === (configuration.reasoningModel || account.defaultModelId))
  const save = async (patch: Partial<AgentConfiguration>): Promise<boolean> => {
    const result = await command({ type: 'configure', patch })
    return result !== null && result.error === null
  }
  const check = async (): Promise<void> => {
    if (!isSubscriptionReasoning(configuration.reasoning)) return
    setChecking(true)
    try { await command({ type: 'check-reasoning', provider: configuration.reasoning }) } finally { setChecking(false) }
  }
  return <div className="account-settings">
    <div className="account-rows">
      <h3 className="account-rows__heading account-rows__heading--first">New threads</h3>
      <p className="account-rows__subheading">A new thread in a project opens straight away with these. Change them for one thread under its composer.</p>
      <NewThreadDefaultsRow state={state} command={command} />
      <h3 className="account-rows__heading">Personal chats and reasoning</h3>
      <label>Reasoning account<select aria-label="Reasoning account" value={configuration.reasoning} disabled={checking} onChange={event => { void save({ reasoning: event.target.value as AgentConfiguration['reasoning'], reasoningModel: '', reasoningEffort: '' }) }}><option value="none">Not configured</option><optgroup label="Your subscriptions"><option value="codex">ChatGPT · Codex</option><option value="claude">Claude · Claude Code</option><option value="grok">Grok · Grok Build</option></optgroup><optgroup label="API accounts"><option value="openrouter">OpenRouter</option><option value="openai">OpenAI</option></optgroup></select></label>
      {subscription ? <><label>Reasoning model<select aria-label="Reasoning model" value={configuration.reasoningModel} disabled={!account?.ready} onChange={event => void save({ reasoningModel: event.target.value, reasoningEffort: '' })}><option value="">Provider default</option>{configuration.reasoningModel && !account?.models.some(model => model.id === configuration.reasoningModel) ? <option value={configuration.reasoningModel}>{configuration.reasoningModel}</option> : null}{account?.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label><label>Reasoning effort<select aria-label="Reasoning effort" value={configuration.reasoningEffort} disabled={!account?.ready || !model?.reasoningEfforts?.length} onChange={event => void save({ reasoningEffort: event.target.value })}><option value="">Provider default</option>{configuration.reasoningEffort && !model?.reasoningEfforts?.includes(configuration.reasoningEffort) ? <option value={configuration.reasoningEffort}>{configuration.reasoningEffort} · unavailable</option> : null}{model?.reasoningEfforts?.map(effort => <option key={effort} value={effort}>{effort}</option>)}</select></label><div className="account-connection"><p role="status">{checking ? 'Checking your provider account…' : account?.detail ?? 'Check the account signed in through your installed provider app.'}</p><Button variant="secondary" disabled={checking || state.globalLaneBusy} onClick={() => void check()}>Check connection</Button></div></> : configuration.reasoning !== 'none' ? <><SavedField label="Reasoning model" value={configuration.reasoningModel} onSave={reasoningModel => save({ reasoningModel })} /><SavedField label="Reasoning API key" value="" secret placeholder={state.credentials.reasoning ? 'Saved securely · enter to replace' : 'Enter your API key'} onSave={async value => { const result = await command({ type: 'credential', slot: 'reasoning', value: value.trim() }); return result !== null && result.error === null }} />{state.credentials.reasoning ? <Button variant="ghost" disabled={state.globalLaneBusy} onClick={() => void command({ type: 'credential', slot: 'reasoning', value: '' })}>Remove reasoning API key</Button> : null}</> : null}
    </div>
    {state.error ? <p className="agent-error" role="alert">{state.error}</p> : null}
  </div>
}

export function AgentSetupFields(): ReactNode {
  const agents = useOptionalAgents()
  // Voice is hidden for the beta, so the wake phrase and the voices it speaks
  // with have nothing to configure; the reasoning account and projects do.
  const voiceCoordinator = useVoiceCoordinatorEnabled()
  const state = agents?.state
  const command = agents?.command
  if (!state || !command) return <p>Preparing agent configuration…</p>
  const configuration = state.configuration
  const perform = async (request: AgentCommand): Promise<boolean> => { const result = await command(request); return result !== null && result.error === null }
  const save = (patch: Partial<AgentConfiguration>): Promise<boolean> => perform({ type: 'configure', patch })
  return <div className="account-settings"><AgentAccountSettings /><div className="account-rows">
    <ProviderUpgradeNotice state={state} command={command} />
    <h3 className="account-rows__heading">Projects</h3>
    <SavedField label="Default projects directory" value={configuration.projectsDirectory} onSave={projectsDirectory => save({ projectsDirectory })} />
    <SavedField label="Automatic follow-up limit" value={String(configuration.followupLimit)} onSave={value => /^\d+$/.test(value) && Number(value) <= 100 ? save({ followupLimit: Number(value) }) : Promise.resolve(false)} />
  </div>{voiceCoordinator ? <><VoiceSettings configuration={configuration} command={command} change={(key, value) => { void save({ [key]: value }) }} grokKeySaved={state.credentials.grokSpeech} voiceError={state.voice.error} />
  <details className="agent-wake-advanced">
    <summary>Advanced wake settings</summary>
    <div className="account-rows">
      <SavedField label="Wake model directory" value={configuration.wakeModelDirectory} onSave={wakeModelDirectory => save({ wakeModelDirectory })} />
      <SavedField label="Wake runtime directory" value={configuration.wakeRuntimeDirectory} onSave={wakeRuntimeDirectory => save({ wakeRuntimeDirectory })} />
    </div>
  </details></> : null}
  <div className="agent-billing"><p><b>{state.membership.label}</b></p><p>Provider usage is separate from Sotto access. Free dictation remains available without an account.</p>{configuration.membershipEndpoint ? <div className="agent-actions"><Button variant="secondary" onClick={() => void command({ type: 'membership', action: 'signin' })}>Sign in to Sotto</Button><Button variant="secondary" onClick={() => void command({ type: 'membership', action: state.membership.status === 'active' ? 'portal' : 'checkout' })}>{state.membership.status === 'active' ? 'Manage subscription' : 'Get Sotto Pro'}</Button><Button variant="ghost" onClick={() => void command({ type: 'membership', action: 'refresh' })}>Refresh membership</Button></div> : <p>Hosted sign-in and checkout are not available in this private development beta.</p>}</div>
  </div>
}
