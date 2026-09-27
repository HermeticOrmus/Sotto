// Throwaway: three variants on each existing surface, selected with ?surface=&variant=.
// All prototype actions are local simulations. No audio, provider calls, clipboard writes or saved changes.
import React, { useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/settings'
import type { DictationState } from '../../shared/dictation'
import { AppShell } from './components/AppShell'
import { Button } from './components/Button'
import { SidebarTop, SidebarFoot } from './agents/SidebarFrame'
import { DictateRoom } from './features/dictate/DictateRoom'
import { Onboarding } from './features/onboarding/Onboarding'
import { SettingsView } from './features/settings/SettingsView'
import { useApp } from './state/AppContext'
import { applyAppearance } from './state/appearance'
import type { MicrophoneTestState } from './features/onboarding/microphoneTest'
import './workflowPrototype.css'

type Variant = 'A' | 'B' | 'C'
type Surface = 'dictation' | 'onboarding' | 'settings'
const names = {
  dictation: { A: 'Transcript below the wave', B: 'Recovery in the main action', C: 'Recovery drawer' },
  onboarding: { A: 'Choose at the microphone step', B: 'Recover directly at Finish', C: 'Test or skip and continue' },
  settings: { A: 'Fit the existing row', B: 'Stack the three modes', C: 'Give the sidebar more room' },
}
const sample = 'Update the motor starter drawing to show the new overload setting. Keep the existing interlock and add a note for commissioning.'
const no = (): void => undefined

function PrototypeSidebar(): ReactNode {
  return <aside className="thread-nav prototype-sidebar" aria-label="Thread sidebar">
    <SidebarTop />
    <div className="prototype-project"><strong>Threads</strong><p>Control panel drawings</p><button type="button">Update motor starter</button><button type="button">Review interlocks</button></div>
    <SidebarFoot />
  </aside>
}
function DictationExample({ variant, settings }: { variant: Variant; settings: AppSettings }): ReactNode {
  const [state, setState] = useState<DictationState>({ status: 'idle' })
  const [held, setHeld] = useState(false)
  const [copied, setCopied] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [fails, setFails] = useState(true)
  const [notice, setNotice] = useState('')
  const recover = (): void => { if (fails) setNotice('The clipboard is still unavailable. Your text is here.'); else { setCopied(true); setNotice('Copied. Paste into the app you were using.'); } }
  const complete = (): void => { setHeld(true); setCopied(false); setNotice(''); setState({ status: 'idle' }); setDrawer(variant === 'C') }
  const transcript = <><p className="prototype-transcript" tabIndex={0}>{sample}</p><p className="prototype-small">History is off. This text stays here until you dismiss it or close Sotto.</p></>
  const actions = <div className="prototype-actions"><Button onClick={recover}>{copied ? 'Copy again' : 'Copy text'}</Button><Button variant="ghost" onClick={() => { setHeld(false); setDrawer(false); setNotice('Text dismissed.') }}>Dismiss</Button></div>
  return <AppShell navigation="home" layout="sidebar" platform="win32" sidebar={<PrototypeSidebar />} statusText="History is off." onMinimize={no} onMaximize={no} onClose={no}>
    <div className={'prototype-dictation prototype-dictation--' + variant}>
      {variant === 'B' && held ? <section className="prototype-focus-recovery"><p className="prototype-small">Dictation complete</p><h1>Your text is ready.</h1><p>Sotto could not copy it. You can select the text or try copying again.</p>{transcript}{actions}</section> :
      <DictateRoom settings={settings} platform="win32" dictation={state} entries={[]} historyStatus="ready" onStart={async () => setState({ status: 'listening', sessionId: 'prototype', startedAt: Date.now(), level: .45 })} onStop={async () => complete()} onOpenSettings={no} onCopy={async () => true} />}
      {held && variant === 'A' ? <section className="prototype-inline-recovery" aria-label="Recover dictation"><div><h2>Your words are still here.</h2><p>Sotto could not copy the text. Select it below or try copying again.</p></div>{transcript}{actions}</section> : null}
      {held && variant === 'C' ? <button className="prototype-recovery-strip" type="button" onClick={() => setDrawer(true)}>Text could not be copied. <strong>Recover dictation →</strong></button> : null}
      {drawer && held && variant === 'C' ? <aside className="prototype-drawer" aria-label="Recover dictation"><Button variant="ghost" onClick={() => setDrawer(false)}>Close recovery</Button><h2>Your words are still here.</h2><p>Sotto could not copy the text.</p>{transcript}{actions}</aside> : null}
      {notice ? <p className="prototype-result" role="status">{notice}</p> : null}
    </div>
    <div className="prototype-scenario"><span>Example:</span><button onClick={complete}>Complete dictation · clipboard blocked</button><label><input type="checkbox" checked={fails} onChange={e => setFails(e.target.checked)} />Clipboard unavailable</label><span>State: {held ? copied ? 'text copied; recovery retained' : 'text retained in memory' : state.status}</span></div>
  </AppShell>
}
function OnboardingExample({ variant, settings }: { variant: Variant; settings: AppSettings }): ReactNode {
  const [microphone, setMicrophone] = useState<MicrophoneTestState>('idle')
  const [outcome, setOutcome] = useState<MicrophoneTestState>('ready')
  const [finished, setFinished] = useState<null | boolean>(null)
  const [local, setLocal] = useState(settings)
  return <AppShell navigation={null} platform="win32" onMinimize={no} onMaximize={no} onClose={no}>
    {finished === null ? <Onboarding prototypeVariant={variant} settings={local} platform="win32" microphoneState={microphone} microphoneLevel={microphone === 'ready' ? .42 : 0} shortcut={local.hotkey}
      onRequestMicrophone={async () => { setMicrophone('requesting'); setTimeout(() => setMicrophone(outcome), 400) }} onStopMicrophone={no}
      onUpdateSettings={async patch => { setLocal(s => ({ ...s, ...patch })); return true }}
      onCheckTranscriptionKey={async () => ({ ok: true })}
      onComplete={async ({ microphoneSkipped }) => { setFinished(microphoneSkipped); return true }} /> :
      <section className="prototype-finished"><h1>Setup complete.</h1><p>{finished ? 'Microphone skipped. Threads are ready; test your microphone in Settings before dictating.' : 'Microphone ready. You can dictate with the shortcut.'}</p><Button onClick={() => { setFinished(null); setMicrophone('idle') }}>Run the example again</Button></section>}
    <div className="prototype-scenario"><span>Example microphone result:</span><select aria-label="Example microphone result" value={outcome} onChange={e => setOutcome(e.target.value as MicrophoneTestState)}><option value="ready">Ready</option><option value="denied">Permission denied</option><option value="missing">Missing device</option></select><span>State: {microphone}{finished === null ? '' : finished ? ' · finished with explicit skip' : ' · finished ready'}</span></div>
  </AppShell>
}
function SettingsExample({ variant, settings }: { variant: Variant; settings: AppSettings }): ReactNode {
  const [local, setLocal] = useState(settings)
  return <div className={'prototype-settings prototype-settings--' + variant}>
    <SettingsView settings={local} platform="win32" updateStatus={null} statusText="Prototype changes stay in this window."
      mediaDevices={{ enumerateDevices: async () => [], addEventListener: no, removeEventListener: no }}
      onUpdateSettings={async patch => { setLocal(s => ({ ...s, ...patch })); return true }}
      onReplaceHotkey={async accelerator => ({ ok: true, hotkey: accelerator })}
      onSetStartup={async () => null} onResetSettings={async () => true} onClearHistory={async () => true}
      onCheckTranscriptionKey={async () => ({ ok: true })} onCheckForUpdates={async () => null} onDownloadUpdate={async () => true} onInstallUpdate={async () => true} />
    <div className="prototype-scenario"><span>Example: voice beta enabled · all three modes remain available</span><span>Inspect at 820 × 560</span></div>
  </div>
}
export function WorkflowPrototype(): ReactNode {
  const app = useApp()
  const query = new URLSearchParams(location.search)
  const [surface, setSurface] = useState<Surface>((query.get('surface') as Surface) || 'dictation')
  const [variant, setVariant] = useState<Variant>((query.get('variant') as Variant) || 'A')
  const [light, setLight] = useState(false)
  const settings = { ...(app.settings ?? DEFAULT_SETTINGS), llmApiKey: 'prototype-only', onboardingComplete: true, microphoneSkipped: false, historyEnabled: false } as AppSettings
  useEffect(() => { applyAppearance({ ...settings, appearance: light ? 'light' : 'dark' }); document.documentElement.dataset.reducedMotion = 'on' }, [light, app.settings])
  useEffect(() => { const url = new URL(location.href); url.searchParams.set('surface', surface); url.searchParams.set('variant', variant); history.replaceState(null, '', url) }, [surface, variant])
  const cycle = (amount: number): void => setVariant(current => (['A', 'B', 'C'] as Variant[])[(['A','B','C'].indexOf(current) + amount + 3) % 3]!)
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable], [role=tablist]')) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cycle(event.key === 'ArrowLeft' ? -1 : 1) }
      if (event.key === 'Escape') document.querySelector<HTMLButtonElement>('.prototype-drawer button')?.click()
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [])
  return <div className="prototype-root" key={surface + variant}>
    {surface === 'dictation' ? <DictationExample variant={variant} settings={settings} /> : surface === 'onboarding' ? <OnboardingExample variant={variant} settings={settings} /> : <SettingsExample variant={variant} settings={settings} />}
    <nav className="prototype-switcher" aria-label="Prototype variants">
      <span className="prototype-label">PROTOTYPE</span>
      <select aria-label="Prototype surface" value={surface} onChange={e => setSurface(e.target.value as Surface)}><option value="dictation">Dictation recovery</option><option value="onboarding">Onboarding</option><option value="settings">Settings fit</option></select>
      <button aria-label="Previous variant" onClick={() => cycle(-1)}>←</button>
      <strong>{variant} · {names[surface][variant]}</strong>
      <button aria-label="Next variant" onClick={() => cycle(1)}>→</button>
      <button onClick={() => setLight(!light)}>{light ? 'Dark' : 'Light'}</button>
    </nav>
  </div>
}

