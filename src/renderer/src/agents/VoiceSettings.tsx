import React, { useEffect, useState, type ReactNode } from 'react'
import { NATURAL_VOICES, type AgentConfiguration, type AgentVoiceModelStatus } from '../../../shared/agents'
import type { AgentConnection } from './AgentContext'
import { Button } from '../components/Button'
import { Toggle } from '../components/Toggle'
import voiceLicense from '../../../../docs/notices/supertonic-LICENSE.txt?raw'

function speechError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/u, '') : 'The voice could not be prepared. Try again.'
}

type VoiceField = 'speechProvider' | 'speechVoice' | 'grokSpeechVoice'
type VoicePick = Partial<Pick<AgentConfiguration, VoiceField>>

/** Drops a field's pick if it still holds this value; a later pick of the same field is left alone. */
function withoutPick(current: VoicePick, field: VoiceField, value: string): VoicePick {
  if (current[field] !== value) return current
  const next = { ...current }
  delete next[field]
  return next
}

export function VoiceSettings({ configuration: saved, command, change, grokKeySaved = false, voiceError }: {
  readonly configuration: AgentConfiguration
  readonly command: AgentConnection['command']
  /** Saves one setting. A promise says whether main took it; without one the configuration passed back is the answer. */
  readonly change: <K extends keyof AgentConfiguration>(key: K, value: AgentConfiguration[K]) => void | Promise<boolean>
  readonly grokKeySaved?: boolean
  readonly voiceError?: string | null
}): ReactNode {
  // A voice the user picks shows, and is what Use and preview voice saves, from the moment it is picked. The
  // configuration passed in can still name the voice before the pick when the press follows at once, and saving
  // that would put the old voice back. The pick gives way once the configuration names it, or once its save is
  // refused, when the select goes back to the voice that is saved.
  const [picked, setPicked] = useState<VoicePick>({})
  useEffect(() => {
    setPicked(current => (Object.keys(current) as VoiceField[]).reduce((next, field) => withoutPick(next, field, saved[field]), current))
  }, [saved])
  const configuration = { ...saved, ...picked }
  const pick = <K extends VoiceField>(field: K, value: AgentConfiguration[K]): void => {
    setPicked(current => ({ ...current, [field]: value }))
    const saving = change(field, value)
    if (saving) void saving.catch(() => false).then(taken => { if (!taken) setPicked(current => withoutPick(current, field, value)) })
  }
  const [model, setModel] = useState<AgentVoiceModelStatus | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [key, setKey] = useState('')
  const [keySaved, setKeySaved] = useState(grokKeySaved)
  const [savingKey, setSavingKey] = useState(false)
  const [voices, setVoices] = useState<Array<{ id: string; name: string }>>([])
  const [loadingVoices, setLoadingVoices] = useState(false)
  const [voiceListError, setVoiceListError] = useState('')
  const [voiceListRevision, setVoiceListRevision] = useState(0)
  const [openRouterKeySaved, setOpenRouterKeySaved] = useState<boolean | null>(null)
  const natural = configuration.speechProvider === 'natural'
  const grok = configuration.speechProvider === 'grok'
  const kokoro = configuration.speechProvider === 'kokoro'
  useEffect(() => {
    if (!kokoro) return
    let active = true
    let changed = false
    setOpenRouterKeySaved(null)
    const bridge = window.sotto
    if (!bridge?.getSettings) { setError('Voice account settings are unavailable. Reopen the updated app.'); return }
    const unsubscribe = bridge.onSettingsChanged?.(settings => {
      changed = true
      if (active) setOpenRouterKeySaved(Boolean(settings.llmApiKey))
    })
    // Main returns only a saved-key placeholder, never the decrypted key.
    void bridge.getSettings().then(settings => {
      if (active && !changed) setOpenRouterKeySaved(Boolean(settings.llmApiKey))
    }).catch(() => { if (active) setError('Could not check the OpenRouter key. Reopen voice settings and try again.') })
    return () => { active = false; unsubscribe?.() }
  }, [kokoro])
  useEffect(() => { setKeySaved(grokKeySaved) }, [grokKeySaved])
  useEffect(() => {
    if (!natural) return
    let active = true
    const update = (): void => { void window.sotto?.agents?.voiceModel?.('status').then(status => { if (active) setModel(status) }).catch(error => { if (active) setError(speechError(error)) }) }
    update()
    const timer = downloading ? setInterval(update, 750) : undefined
    return () => { active = false; clearInterval(timer) }
  }, [natural, downloading])
  useEffect(() => {
    if (!grok || !keySaved) { setLoadingVoices(false); setVoices([]); setVoiceListError(''); return }
    let active = true
    setLoadingVoices(true); setVoiceListError('')
    const operation = window.sotto?.agents?.grokVoices
    if (!operation) { setLoadingVoices(false); setVoiceListError('Grok voice discovery is unavailable. Reopen the updated app.'); return }
    void operation().then(result => {
      if (!active) return
      setVoices(result)
      if (!result.length) setVoiceListError('xAI returned no voices. Refresh the list or check your API account.')
    }).catch(error => { if (active) setVoiceListError(speechError(error)) }).finally(() => { if (active) setLoadingVoices(false) })
    return () => { active = false }
  }, [grok, keySaved, voiceListRevision])
  const download = async (): Promise<void> => {
    const operation = window.sotto?.agents?.voiceModel
    if (!operation) { setError('Voice setup is unavailable. Reopen the updated app.'); return }
    setDownloading(true); setError(''); setNotice('')
    try { setModel(await operation('download')); setNotice('Natural voices are ready. Choose one and preview it.') }
    catch (error) { setError(speechError(error)) }
    finally { setDownloading(false) }
  }
  const saveKey = async (value: string): Promise<void> => {
    setSavingKey(true); setError(''); setNotice('')
    try {
      const result = await command({ type: 'credential', slot: 'grokSpeech', value })
      if (!result || result.error) { setError(result?.error ?? 'The Grok API key could not be saved.'); return }
      setKey(''); setKeySaved(Boolean(value)); setVoices([])
      setVoiceListRevision(current => current + 1)
      setNotice(value ? 'Grok API key saved securely. Choose a voice and preview it.' : 'Grok API key removed.')
    } catch (error) { setError(speechError(error)) }
    finally { setSavingKey(false) }
  }
  const preview = async (): Promise<void> => {
    setPreviewing(true); setError(''); setNotice('')
    try {
      const patch = { speechProvider: configuration.speechProvider, ...(grok ? { grokSpeechVoice: configuration.grokSpeechVoice } : natural ? { speechVoice: configuration.speechVoice } : {}), speak: true }
      const stored = await command({ type: 'configure', patch })
      if (!stored || stored.error) { setError(stored?.error ?? 'The voice settings could not be saved.'); return }
      change('speak', true)
      const started = await command({ type: 'preview-voice' })
      if (!started || started.error) setError(started?.error ?? 'The voice preview could not start.')
      else setNotice('Voice saved. Your preview will play through the selected output device.')
    } catch (error) { setError(speechError(error)) }
    finally { setPreviewing(false) }
  }
  const displayedError = error || voiceError
  const savedVoiceOutsideCatalog = configuration.grokSpeechVoice && !voices.some(voice => voice.id === configuration.grokSpeechVoice)
  return <div className="agent-field-wide agent-voice-settings">
    <Toggle label="Spoken replies" checked={configuration.speak} onCheckedChange={checked => change('speak', checked)} />
    <div className="agent-fields">
      <label>Speech voice<select aria-label="Speech voice" value={configuration.speechProvider} onChange={event => { pick('speechProvider', event.target.value as AgentConfiguration['speechProvider']); setError(''); setNotice('') }}>
        <option value="grok">Grok voice · default</option>
        <option value="kokoro">Kokoro Heart · lower cost</option>
        <option value="natural">Natural voice · on this computer</option>
        {configuration.speechProvider === 'system' ? <option value="system">System voice · previously selected</option> : null}
      </select></label>
      {natural ? <label>Voice<select aria-label="Voice" value={configuration.speechVoice} onChange={event => { pick('speechVoice', event.target.value as AgentConfiguration['speechVoice']); setNotice('') }}>
        {NATURAL_VOICES.map(voice => <option key={voice} value={voice}>{voice.startsWith('F') ? 'Female' : 'Male'} {voice.slice(1)}</option>)}
      </select></label> : null}
      {grok ? <label>Grok voice<select aria-label="Grok voice" value={configuration.grokSpeechVoice} onChange={event => { pick('grokSpeechVoice', event.target.value); setNotice('') }}>
        {!configuration.grokSpeechVoice ? <option value="">Choose a voice</option> : null}
        {savedVoiceOutsideCatalog ? <option value={configuration.grokSpeechVoice}>{configuration.grokSpeechVoice}{voices.length ? ' · saved voice' : ''}</option> : null}
        {voices.map(voice => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
      </select></label> : null}
    </div>
    <p className="agent-hint">{natural ? 'AI-generated voices by Supertonic. Replies stay on this computer. One 263 MB download, with no usage charges.' : grok ? 'Reply text is sent to xAI for speech. $15 per million characters, including previews. Billed separately from your Grok subscription. Your reasoning model stays the same.' : kokoro ? 'Heart by Kokoro. Reply text is sent to OpenRouter using your saved OpenRouter key. $0.62–$4 per million characters, depending on provider, including previews.' : 'Uses the voice installed with your operating system.'}</p>
    {kokoro ? <p className="agent-hint">{openRouterKeySaved === null ? 'Checking your OpenRouter key…' : openRouterKeySaved ? 'Uses the same saved key as transcription and AI cleanup.' : 'Add your OpenRouter API key in Settings → Transcription to enable Kokoro.'}</p> : null}
    {natural ? <details className="agent-voice-license"><summary>Voice model terms · OpenRAIL-M</summary><p>Downloading and using these voices is subject to these model terms, including the use restrictions in Attachment A.</p><pre>{voiceLicense}</pre></details> : null}
    {grok ? <>
      <div className="agent-fields"><label className="agent-field-wide">Grok speech API key<input aria-label="Grok speech API key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={event => { setKey(event.target.value); setNotice('') }} placeholder={keySaved ? 'Saved securely · enter to replace' : 'API key from console.x.ai'} /></label></div>
      <div className="agent-voice-actions">
        <Button variant="secondary" disabled={savingKey || !key.trim()} onClick={() => void saveKey(key.trim())}>{savingKey ? 'Saving…' : keySaved ? 'Replace API key' : 'Save API key'}</Button>
        {keySaved ? <Button variant="ghost" disabled={savingKey} onClick={() => void saveKey('')}>Remove API key</Button> : null}
        <Button variant="ghost" disabled={!keySaved || savingKey || loadingVoices || Boolean(key.trim())} onClick={() => setVoiceListRevision(current => current + 1)}>{loadingVoices ? 'Loading voices…' : 'Refresh voices'}</Button>
      </div>
      {key.trim() ? <p className="agent-hint">Save this API key before previewing. It is saved separately from connection settings.</p> : !keySaved ? <p className="agent-hint">Save an xAI API key to load the available voices and enable previews.</p> : null}
      {voiceListError ? <p className="agent-error" role="alert">{voiceListError}</p> : null}
    </> : null}
    <div className="agent-voice-actions">
      {natural && !model?.ready ? <Button variant="secondary" disabled={downloading} onClick={() => void download()}>{downloading ? `Downloading voices · ${Math.floor((model?.completedBytes ?? 0) / 1_000_000)} MB` : 'Download natural voices'}</Button> : null}
      <Button variant="secondary" disabled={previewing || downloading || savingKey || (natural && !model?.ready) || (kokoro && openRouterKeySaved !== true) || (grok && (!keySaved || !configuration.grokSpeechVoice.trim() || Boolean(key.trim())))} onClick={() => void preview()}>Use and preview voice</Button>
      <Button variant="ghost" onClick={() => { setNotice(''); void command({ type: 'voice', action: 'stop-speaking' }) }}>Stop speech</Button>
    </div>
    {downloading ? <progress aria-label="Natural voice download" max={model?.totalBytes || 263_304_827} value={model?.completedBytes ?? 0} /> : null}
    {notice && !displayedError ? <p className="agent-hint" role="status">{notice}</p> : null}
    {displayedError ? <p className="agent-error" role="alert">{displayedError}</p> : null}
  </div>
}
