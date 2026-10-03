import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CloudEvent, CloudIphoneBridge, CloudIphoneStatus, CloudSession } from '../../../../src/shared/cloudIphone'
import type { ToolsResult } from '../../../../src/shared/tools'
import { CloudIphoneStore, useCloudSession, useCloudStatus } from '../../../../src/renderer/src/tools/cloudIphoneStore'

const ok = <T,>(value: T): ToolsResult<T> => ({ ok: true, value })

const session = (patch: Partial<CloudSession> = {}): CloudSession => ({
  id: '11111111-1111-4111-8111-111111111111', threadId: 'workshop', workspaceId: 'workspace',
  status: 'asking', description: 'Checking the Needs you list', buildPath: 'apps/ios/build/Sotto.app.zip', buildBytes: 41_000_000,
  device: null, expiresAt: Date.now() + 300_000, startedAt: null, endedAt: null, endReason: null, minutes: 0,
  problem: null, steps: [], summary: null, unchecked: [], ...patch,
})

const status = (patch: Partial<CloudIphoneStatus> = {}): CloudIphoneStatus => ({
  keySaved: true, month: '2026-10', monthMinutes: 38, capMinutes: 750, recent: [], ...patch,
})

function fakeBridge(initialSessions: CloudSession[] = []) {
  const listeners = new Set<(event: CloudEvent) => void>()
  const bridge: CloudIphoneBridge = {
    status: vi.fn(async () => ok(status())),
    setKey: vi.fn(async ({ value }) => ok(value ? { saved: true, problem: null } : { saved: true, problem: null })),
    sessions: vi.fn(async () => ok(initialSessions)),
    answer: vi.fn(async ({ sessionId, allow }) => ok(session({ id: sessionId, status: allow ? 'starting' : 'denied' }))),
    end: vi.fn(async ({ sessionId }) => ok(session({ id: sessionId, status: 'ended', endReason: 'user' }))),
    mount: vi.fn(async () => ok(undefined)),
    onEvent: vi.fn(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }),
  }
  return { bridge, emit: (event: CloudEvent) => { for (const listener of [...listeners]) listener(event) } }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function Probe({ store, threadId }: { readonly store: CloudIphoneStore; readonly threadId: string }) {
  const current = useCloudSession(threadId, store)
  const s = useCloudStatus(store)
  return <p>{current ? `${current.status}:${current.minutes}` : 'none'} / {s ? `${s.monthMinutes}-${s.capMinutes}` : 'no-status'}</p>
}

describe('the cloud iPhone store', () => {
  it('lists a thread’s sessions on first watch, and the hook reads the newest one', async () => {
    const { bridge } = fakeBridge([session()])
    const store = new CloudIphoneStore()
    render(<Probe store={store} threadId="workshop" />)
    act(() => store.watch(bridge, 'workshop'))
    await screen.findByText('asking:0 / no-status')
    expect(bridge.sessions).toHaveBeenCalledWith({ threadId: 'workshop' })
  })

  it('watches a bridge once, and a session event updates the thread’s newest session', async () => {
    const { bridge, emit } = fakeBridge()
    const store = new CloudIphoneStore()
    render(<Probe store={store} threadId="workshop" />)
    act(() => store.watch(bridge, 'workshop'))
    act(() => store.watch(bridge, 'workshop'))
    expect(bridge.sessions).toHaveBeenCalledTimes(1)
    act(() => emit({ type: 'session', session: session({ status: 'starting' }) }))
    await screen.findByText('starting:0 / no-status')
  })

  it('reads the status event into useCloudStatus', async () => {
    const { bridge, emit } = fakeBridge()
    const store = new CloudIphoneStore()
    render(<Probe store={store} threadId="workshop" />)
    act(() => store.watch(bridge, 'workshop'))
    act(() => emit({ type: 'status', status: status({ monthMinutes: 12 }) }))
    await screen.findByText('none / 12-750')
  })

  it('answer sends the session’s own IDs and updates the store from the result', async () => {
    const { bridge } = fakeBridge()
    const store = new CloudIphoneStore()
    const error = await store.answer(bridge, session(), true)
    expect(error).toBeNull()
    expect(bridge.answer).toHaveBeenCalledWith({ threadId: 'workshop', workspaceId: 'workspace', sessionId: session().id, allow: true })
    expect(store.sessionsFor('workshop').at(-1)?.status).toBe('starting')
  })

  it('end reports the bridge’s error without changing the store', async () => {
    const bridge: CloudIphoneBridge = {
      ...fakeBridge().bridge,
      end: vi.fn(async () => ({ ok: false as const, error: { code: 'unavailable' as const, message: 'The session is already gone.' } })),
    }
    const store = new CloudIphoneStore()
    const error = await store.end(bridge, session())
    expect(error).toBe('The session is already gone.')
  })

  it('setKey reports run.cloud’s rejection without saving', async () => {
    const bridge: CloudIphoneBridge = {
      ...fakeBridge().bridge,
      setKey: vi.fn(async () => ok({ saved: false, problem: 'run.cloud rejected this key.' })),
    }
    const store = new CloudIphoneStore()
    const result = await store.setKey(bridge, 'bad-key')
    expect(result).toEqual({ saved: false, problem: 'run.cloud rejected this key.' })
  })

  it('mounts only one session at a time, taking the previous one off first', async () => {
    const { bridge } = fakeBridge()
    const store = new CloudIphoneStore()
    const first = session()
    const second = session({ id: '22222222-2222-4222-8222-222222222222' })
    store.mount(bridge, first, { x: 0, y: 0, width: 240, height: 520 })
    await Promise.resolve()
    store.mount(bridge, second, { x: 10, y: 10, width: 240, height: 520 })
    await Promise.resolve()
    expect(bridge.mount).toHaveBeenCalledWith(expect.objectContaining({ sessionId: first.id, bounds: null }))
    expect(bridge.mount).toHaveBeenCalledWith(expect.objectContaining({ sessionId: second.id, bounds: { x: 10, y: 10, width: 240, height: 520 } }))
  })
})
