import React, { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { DEFAULT_HOST_DATA_DIRECTORY, DEFAULT_HOST_INSTALL_PATH, type HostsBridge, type HostsState, type HostStatus, type RemoteHost } from '../../../../shared/hosts'
import type { HostDevice, HostDeviceList, TailscaleSummary } from '../../../../shared/hostDevices'
import { Button } from '../../components/Button'
import { DevicePicker } from './DevicePicker'
import { TailscalePrompt, type TailscaleControl } from './TailscaleConnect'

/** How many Hosts modals are open, so a saved host's SSH question waits rather than stacking on one. */
let openModals = 0
const modalListeners = new Set<() => void>()
const subscribeModals = (listener: () => void): (() => void) => { modalListeners.add(listener); return () => { modalListeners.delete(listener) } }
const modalsChanged = (change: number): void => { openModals += change; for (const listener of modalListeners) listener() }
/** Whether Add host, Edit connection or Rename is open. */
export const useHostsModalOpen = (): boolean => useSyncExternalStore(subscribeModals, () => openModals > 0)

/**
 * A modal for Settings > Hosts: focus starts inside it (on `data-autofocus` when a control has it), Tab stays inside it, Escape answers it (after
 * anything open inside has answered first) and focus goes back to what opened it.
 */
export function HostsModal({ title, onClose, busy = false, children, footer, className = '' }: {
  readonly title: string; readonly onClose: () => void; readonly busy?: boolean
  readonly children: ReactNode; readonly footer: ReactNode; readonly className?: string
}): ReactNode {
  const dialog = useRef<HTMLElement>(null)
  const titleId = useId()
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => { modalsChanged(1); return () => modalsChanged(-1) }, [])
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // Focus starts on the control marked for it, such as Add host's Device list below a Tailscale prompt, else on the first one.
    const start = dialog.current?.querySelector<HTMLElement>('[data-autofocus]:not(:disabled)') ?? dialog.current?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)')
    start?.focus()
    // Escape is heard on the document, so it still answers while focus sits on a control that just turned off.
    // Anything open inside the dialog (Add host's device list) answers it first and stops it there.
    const onEscape = (event: globalThis.KeyboardEvent): void => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close.current() } }
    document.addEventListener('keydown', onEscape)
    return () => { document.removeEventListener('keydown', onEscape); queueMicrotask(() => { if (opener?.isConnected) opener.focus() }) }
  }, [])
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Tab') return
    const focusable = [...dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, [tabindex]:not([tabindex="-1"])') ?? []]
    const first = focusable[0], last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  return <div className="tt-dialog-backdrop" role="presentation">
    <section ref={dialog} className={`tt-dialog hosts-dialog ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy || undefined} onKeyDown={onKeyDown}>
      <h2 id={titleId}>{title}</h2>
      {children}
      <div className="tt-dialog__actions">{footer}</div>
    </section>
  </div>
}

/** The longest name and SSH target a saved host may have (`remoteHostSchema`). */
const MAX_NAME_LENGTH = 80, MAX_TARGET_LENGTH = 256
/** The host part of an SSH target: `forge` in `zach@forge`. */
export const targetHost = (target: string): string => target.slice(target.lastIndexOf('@') + 1)
/** The user part of an SSH target, or '' when the SSH configuration decides. */
const targetUser = (target: string): string => target.includes('@') ? target.slice(0, target.lastIndexOf('@')) : ''

/** What the dialog is for: adding a new host, or changing a saved host's connection. */
export type HostDialogMode = { readonly kind: 'add' } | { readonly kind: 'edit'; readonly host: HostStatus }

/**
 * Add host and Edit connection. Add host connects from inside the dialog and saves the host only once it
 * answers and pairs: the dialog shows that it is connecting, asks SSH's questions itself, and says what
 * happened when it fails. Edit connection saves the new route; a host that is on connects again with it.
 */
export function HostDialog({ mode, bridge, state, tailscale, onClose }: {
  readonly mode: HostDialogMode; readonly bridge: HostsBridge; readonly state: HostsState | null
  /** Tailscale on this computer, shared with the Hosts page's row. */
  readonly tailscale?: TailscaleControl | undefined
  readonly onClose: () => void
}): ReactNode {
  const editing = mode.kind === 'edit' ? mode.host : undefined
  const [host, setHost] = useState(editing ? targetHost(editing.target) : '')
  const [user, setUser] = useState(editing ? targetUser(editing.target) : '')
  const [port, setPort] = useState(editing?.sshPort ? String(editing.sshPort) : '')
  const [installPath, setInstallPath] = useState(editing?.installPath ?? DEFAULT_HOST_INSTALL_PATH)
  const [dataDirectory, setDataDirectory] = useState(editing?.dataDirectory ?? DEFAULT_HOST_DATA_DIRECTORY)
  const [identityFile, setIdentityFile] = useState(editing?.identityFile ?? '')
  // Add host lists the devices Sotto can see; Another SSH host swaps the list for typing a host, and
  // Choose from your devices comes back to it (`back`, which puts focus on the list again).
  const [entry, setEntry] = useState<'device' | 'typed' | 'back'>('device')
  const [devices, setDevices] = useState<{ readonly tailscale: TailscaleSummary | null; readonly devices: HostDeviceList['devices']; readonly failed?: boolean } | null>(null)
  const [picked, setPicked] = useState<HostDevice | null>(null)
  const [attempt, setAttempt] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [answering, setAnswering] = useState(false)
  const addButton = useRef<HTMLButtonElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const hintId = useId()
  const hostId = useId(), userId = useId(), portId = useId(), installId = useId(), dataId = useId(), dataHintId = useId(), identityId = useId(), answerId = useId()
  // The add this dialog started, as main reports it; it leaves `adding` for `hosts` once the host is saved.
  const adding = attempt !== null && state?.adding?.id === attempt ? state.adding : undefined
  const added = attempt !== null && state?.hosts.some(item => item.id === attempt) === true
  const connecting = sending || adding?.phase === 'connecting'
  const prompt = adding?.prompt
  const shownError = error ?? (adding?.phase === 'error' ? adding.error ?? null : null)
  // Read when the dialog opens, and again whenever Tailscale on this computer changes while it is open: the
  // tailnet's devices fill in once it connects, leave once it stops, and a machine that has just joined appears.
  const tailscaleState = tailscale?.summary?.state
  const tailscaleShape = tailscale?.summary ? tailscale.summary.state === 'running' ? `running:${tailscale.summary.deviceCount}` : tailscale.summary.state : undefined
  const lastTailscaleShape = useRef(tailscaleShape)
  const [deviceReads, setDeviceReads] = useState(0)
  useEffect(() => {
    const before = lastTailscaleShape.current
    lastTailscaleShape.current = tailscaleShape
    if (before !== undefined && tailscaleShape !== undefined && before !== tailscaleShape) setDeviceReads(count => count + 1)
  }, [tailscaleShape])
  useEffect(() => {
    if (editing) return
    let alive = true
    // A list that cannot be read still offers Another SSH host.
    void bridge.devices().then(found => { if (alive) setDevices(found) }, () => { if (alive) setDevices({ tailscale: null, devices: [], failed: true }) })
    return () => { alive = false }
  }, [bridge, editing, deviceReads])
  // Connect to Tailscale goes with its prompt once Tailscale is up; focus moves on to the Device field rather than being dropped.
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (tailscaleState === 'running' && (document.activeElement === null || document.activeElement === document.body)) form.current?.querySelector<HTMLElement>('[role="combobox"], input')?.focus()
  }, [tailscaleState])
  useEffect(() => { if (added) closeRef.current() }, [added])
  useEffect(() => { setAnswer('') }, [prompt?.id])
  const saved = state?.hosts.map(item => ({ name: item.name, host: targetHost(item.target) })) ?? []
  const typing = editing !== undefined || entry === 'typed'
  const pick = (device: HostDevice): void => { setPicked(device); setHost(device.target); setUser(''); setPort(device.port ? String(device.port) : ''); setError(null) }
  // Back to the list, what was typed gives way to the device it shows.
  const chooseFromDevices = (): void => {
    if (picked) pick(picked)
    else { setHost(''); setUser(''); setPort('') }
    setEntry('back')
  }
  const close = (): void => {
    // A failed or unfinished add is dropped with the dialog: main keeps nothing for it.
    if (attempt !== null && !added) void bridge.command({ type: 'cancel-add', id: attempt }).catch(() => undefined)
    onClose()
  }
  const connection = (): Omit<RemoteHost, 'enabled' | 'id' | 'name'> | string => {
    const name = host.trim()
    if (!name) return typing ? 'Enter an SSH host or alias, such as forge or user@server.' : 'Choose a device, or choose Another SSH host… to type one.'
    const portText = port.trim()
    const portNumber = portText === '' ? undefined : Number(portText)
    if (portNumber !== undefined && (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535)) return 'Enter a port between 1 and 65535, or leave Port empty to use your SSH configuration.'
    // A username typed here wins over one typed in front of the host.
    const target = user.trim() ? `${user.trim()}@${targetHost(name)}` : name
    if (target.length > MAX_TARGET_LENGTH) return 'This SSH host and username are too long together. Nothing was saved. Use a shorter alias from your SSH configuration.'
    return { target, installPath: installPath.trim(), dataDirectory: dataDirectory.trim(), identityFile: identityFile.trim(), ...(portNumber !== undefined ? { sshPort: portNumber } : {}) }
  }
  const submit = async (): Promise<void> => {
    if (connecting) return
    const route = connection()
    if (typeof route === 'string') { setError(route); return }
    setError(null)
    if (editing) {
      setSending(true)
      try { await bridge.command({ type: 'save', host: { id: editing.id, name: editing.name, ...route } }); onClose() }
      catch (failure) { setError(failure instanceof Error ? failure.message : 'The connection could not be saved. Nothing was changed. Try again.') }
      finally { setSending(false) }
      return
    }
    const id = crypto.randomUUID()
    setAttempt(id); setSending(true)
    // A new host is named after the device picked, or the host part typed, until renamed, cut to the length a name may have.
    const named = picked && route.target === picked.target ? picked.name : targetHost(route.target)
    try { await bridge.command({ type: 'add', host: { id, name: named.slice(0, MAX_NAME_LENGTH), ...route } }) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The host could not be added. Nothing was saved. Try again.') }
    finally { setSending(false) }
  }
  const answerPrompt = async (): Promise<void> => {
    if (!prompt || attempt === null || answering) return
    setAnswering(true)
    try { await bridge.command({ type: 'ssh-answer', id: attempt, promptId: prompt.id, answer: prompt.kind === 'host-key' ? 'yes' : answer }) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'SSH did not take the answer. Cancel and add the host again.') }
    finally { setAnswer(''); setAnswering(false) }
  }
  const fieldsDisabled = connecting
  // Add host turns off while it connects; focus moves to Cancel rather than being dropped.
  useEffect(() => {
    const focused = document.activeElement
    if (connecting && (focused === null || focused === document.body || (focused instanceof HTMLButtonElement || focused instanceof HTMLInputElement) && focused.disabled)) cancelButton.current?.focus()
  }, [connecting])
  return <HostsModal title={editing ? `Edit connection to ${editing.name}` : 'Add host'} onClose={close} busy={connecting} className="hosts-dialog--connection"
    footer={<>
      <Button ref={cancelButton} variant="secondary" onClick={close}>Cancel</Button>
      <Button ref={addButton} disabled={connecting || prompt !== undefined} onClick={() => void submit()}>
        {editing ? (sending ? 'Saving…' : 'Save connection') : connecting ? 'Connecting…' : 'Add host'}</Button>
    </>}>
    <p className="hosts-dialog__intro">{editing ? 'The new connection is used the next time Sotto connects. A host that is on connects again now.' : 'Pick a machine Sotto can reach over SSH. Sotto connects as soon as you add it.'}</p>
    {!editing && tailscale ? <TailscalePrompt control={tailscale} /> : null}
    <form ref={form} className="hosts-dialog__fields" onSubmit={event => { event.preventDefault(); void submit() }}
      onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); void submit() } }}>
      {typing ? <div className="tt-field">
        <label className="tt-field__label" htmlFor={hostId}>SSH host</label>
        <input id={hostId} className="tt-input tt-focusable" value={host} disabled={fieldsDisabled} aria-describedby={hintId} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={MAX_TARGET_LENGTH}
          autoFocus={entry === 'typed'} placeholder="forge or user@server" onChange={event => setHost(event.target.value)} />
        <p className="tt-field__description" id={hintId}>{editing ? 'An alias from your SSH configuration, or a host name.'
          : <>A host name, an alias from your SSH configuration or user@server. <button type="button" className="hosts-devices__back tt-focusable" disabled={fieldsDisabled} onClick={chooseFromDevices}>Choose from your devices</button></>}</p>
      </div> : <DevicePicker devices={devices?.devices ?? null} failed={devices?.failed === true} tailscale={tailscale?.summary ?? devices?.tailscale ?? null} saved={saved} value={picked}
        onPick={pick} onOther={() => setEntry('typed')} disabled={fieldsDisabled} autoFocus={entry === 'back'} />}
      {typing ? <div className="hosts-dialog__pair">
        <div className="tt-field"><label className="tt-field__label" htmlFor={userId}>Username <span className="hosts-dialog__optional">(optional)</span></label>
          <input id={userId} className="tt-input tt-focusable" value={user} disabled={fieldsDisabled} autoCapitalize="none" spellCheck={false} maxLength={64} placeholder="From your SSH configuration" onChange={event => setUser(event.target.value)} /></div>
        <div className="tt-field"><label className="tt-field__label" htmlFor={portId}>Port <span className="hosts-dialog__optional">(optional)</span></label>
          <input id={portId} className="tt-input tt-focusable" value={port} disabled={fieldsDisabled} inputMode="numeric" maxLength={5} placeholder="22" onChange={event => setPort(event.target.value)} /></div>
      </div> : null}
      <details className="hosts-dialog__advanced">
        <summary className="tt-focusable">Folders on the host</summary>
        <div className="tt-field"><label className="tt-field__label" htmlFor={installId}>Host installation folder</label>
          <input id={installId} className="tt-input tt-focusable" value={installPath} disabled={fieldsDisabled} autoCapitalize="none" spellCheck={false} onChange={event => setInstallPath(event.target.value)} /></div>
        <div className="tt-field"><label className="tt-field__label" htmlFor={dataId}>Host data folder</label>
          <input id={dataId} className="tt-input tt-focusable" value={dataDirectory} disabled={fieldsDisabled} autoCapitalize="none" spellCheck={false} aria-describedby={dataHintId} onChange={event => setDataDirectory(event.target.value)} />
          <p className="tt-field__description" id={dataHintId}>Threads, pairing and settings for this host live here.</p></div>
        {/* An identity file is now read from the SSH configuration; one saved by an earlier Sotto can still be changed or cleared. */}
        {editing?.identityFile ? <div className="tt-field"><label className="tt-field__label" htmlFor={identityId}>SSH identity file</label>
          <input id={identityId} className="tt-input tt-focusable" value={identityFile} disabled={fieldsDisabled} autoCapitalize="none" spellCheck={false} placeholder="From your SSH configuration" onChange={event => setIdentityFile(event.target.value)} /></div> : null}
      </details>
      {editing?.clientId ? <p className="hosts-dialog__client">This computer's client ID on {editing.name}: <code>{editing.clientId}</code></p> : null}
    </form>
    {connecting && !prompt ? <div className="hosts-notice hosts-notice--work" role="status"><LoaderCircle size={16} aria-hidden="true" className="hosts-spin" />
      <p>{editing ? 'Saving the connection.' : `Connecting to ${targetHost(host.trim())}. Sotto signs in over SSH, starts the host if it is not running, and pairs this computer.`}</p></div> : null}
    {prompt ? <div className="hosts-notice hosts-prompt" role="group" aria-label={prompt.kind === 'host-key' ? 'Trust this SSH host?' : 'SSH needs an answer'}>
      <p className="hosts-prompt__lead">{prompt.kind === 'host-key' ? 'SSH has not seen this host before. Check its key, then trust it to continue.' : prompt.kind === 'passphrase' ? 'SSH needs your key passphrase to sign in.' : 'SSH needs your password to sign in.'}</p>
      <pre className="hosts-challenge">{prompt.text}</pre>
      {prompt.kind !== 'host-key' ? <div className="tt-field"><label className="tt-field__label" htmlFor={answerId}>{prompt.kind === 'passphrase' ? 'Key passphrase' : 'SSH password'}</label>
        <input id={answerId} className="tt-input tt-focusable" type="password" autoComplete="off" autoFocus value={answer} onChange={event => setAnswer(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void answerPrompt() } }} /></div> : null}
      <div className="hosts-prompt__actions"><Button autoFocus={prompt.kind === 'host-key'} disabled={answering} onClick={() => void answerPrompt()}>{prompt.kind === 'host-key' ? 'Trust host and continue' : 'Continue'}</Button></div>
    </div> : null}
    {shownError && !connecting ? <div className="hosts-notice hosts-notice--error" role="alert"><p>{shownError}</p></div> : null}
  </HostsModal>
}
