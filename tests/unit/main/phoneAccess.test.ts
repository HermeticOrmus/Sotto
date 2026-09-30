// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { HostService } from '../../../src/main/agents/hostService'
import { PhoneAccess, type PhoneAccessOptions, type PhoneAccessTailscale } from '../../../src/main/phones/phoneAccess'
import { AtomicJsonStore } from '../../../src/main/storage/atomicJsonStore'
import { serveTarget, type ServeConfig, type ServeResult, type TailscaleStatus } from '../../../src/main/phones/tailscale'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'sotto-phone-access-')) })
afterEach(async () => { if (dirname(root) === tmpdir() && root.includes('sotto-phone-access-')) await rm(root, { recursive: true, force: true }) })

const DNS = 'laptop-russh2j5.tail5728ca.ts.net'
/** A stand-in Tailscale: its Serve setting is one proxy on 8443, or someone else's. */
function fakeTailscale(options: { status?: TailscaleStatus; other?: string; serve?: ServeResult } = {}) {
  let status: TailscaleStatus = options.status ?? { state: 'running', dnsName: DNS, hostName: 'laptop-russh2j5' }
  let proxy: string | undefined = options.other
  const calls: string[] = []
  const tailscale: PhoneAccessTailscale = {
    status: vi.fn(async () => { calls.push('status'); return status }),
    serveStatus: vi.fn(async (): Promise<ServeConfig> => { calls.push('serve-status'); return proxy ? { TCP: { 8443: { HTTPS: true } }, Web: { [`${DNS}:8443`]: { Handlers: { '/': { Proxy: proxy } } } } } : {} }),
    serve: vi.fn(async (_port: number, loopback: number): Promise<ServeResult> => { calls.push(`serve ${loopback}`); const result = options.serve ?? { ok: true }; if (result.ok) proxy = serveTarget(loopback); return result }),
    unserve: vi.fn(async () => { calls.push('unserve'); proxy = undefined; return true }),
  }
  return { tailscale, calls, proxy: () => proxy, setStatus: (next: TailscaleStatus) => { status = next }, setOther: (target: string) => { proxy = target } }
}
/** A stand-in listener: its port, the clients connected to it, and whether it was closed. */
function fakeServer(options: { refusePort?: number } = {}) {
  const started: { port: number; closed: boolean; name: () => string | undefined; admin: unknown; onPaired?: (id: string) => void }[] = []
  let next = 41000
  const startServer = vi.fn(async (input: { port?: number; name?: () => string | undefined; admin?: boolean; onPaired?: (id: string) => void }) => {
    if (input.port !== undefined && input.port !== 0 && input.port === options.refusePort) throw Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' })
    const port = input.port || next++
    const entry = { port, closed: false, name: input.name!, admin: input.admin, ...(input.onPaired ? { onPaired: input.onPaired } : {}) }
    started.push(entry)
    return { descriptor: { port }, connectedClients: () => [], dropRevoked: vi.fn(), close: async () => { entry.closed = true } }
  })
  return { startServer: startServer as unknown as NonNullable<PhoneAccessOptions['startServer']>, started }
}
function create(options: Partial<PhoneAccessOptions> & { tailscale: PhoneAccessTailscale }, settings = { phoneAccess: true, phoneAccessName: '' }) {
  const current = { ...settings }
  const access = new PhoneAccess({ directory: root, service: {} as HostService, settings: () => current, openExternal: vi.fn(async () => undefined), hostname: () => 'LAPTOP', retryMs: 60_000, ...options })
  return { access, settings: current }
}
const record = async () => JSON.parse(await readFile(join(root, 'phone-access.json'), 'utf8')) as { port: number | null; mapped: boolean }

it('turns on: checks Tailscale, opens a loopback listener with no admin routes, then asks Serve for 8443', async () => {
  const fake = fakeTailscale(), server = fakeServer()
  const { access } = create({ tailscale: fake.tailscale, startServer: server.startServer })
  await access.start()
  expect(fake.calls).toEqual(['status', 'serve-status', 'serve 41000'])
  expect(server.started).toMatchObject([{ port: 41000, closed: false, admin: false }])
  expect(access.get()).toMatchObject({ enabled: true, phase: 'on', tailscale: { status: 'ok', dnsName: DNS }, serve: { status: 'ok' }, address: `https://${DNS}:8443`, computerName: 'laptop-russh2j5' })
  expect(await record()).toEqual({ port: 41000, mapped: true })
  await access.close()
})

it('turns off: removes only its own Serve setting and closes the listener, so phones lose their sockets', async () => {
  const fake = fakeTailscale(), server = fakeServer()
  const { access, settings } = create({ tailscale: fake.tailscale, startServer: server.startServer })
  await access.start()
  settings.phoneAccess = false
  access.settingsChanged()
  await vi.waitFor(() => expect(access.get().phase).toBe('off'))
  expect(fake.calls.slice(3)).toEqual(['serve-status', 'unserve'])
  expect(server.started[0]!.closed).toBe(true)
  expect(await record()).toEqual({ port: 41000, mapped: false })
  expect(access.get()).toMatchObject({ address: null, tailscale: { status: 'waiting' }, serve: { status: 'waiting' } })
})

it('leaves another app’s setting on 8443 alone, and says the port is taken', async () => {
  const fake = fakeTailscale({ other: 'http://127.0.0.1:3773' }), server = fakeServer()
  const { access, settings } = create({ tailscale: fake.tailscale, startServer: server.startServer })
  await access.start()
  expect(access.get()).toMatchObject({ phase: 'failed', tailscale: { status: 'ok' }, serve: { status: 'failed', reason: 'port-taken' }, address: null })
  expect(fake.tailscale.serve).not.toHaveBeenCalled()
  expect(server.started).toEqual([])
  settings.phoneAccess = false
  access.settingsChanged()
  await vi.waitFor(() => expect(access.get().phase).toBe('off'))
  expect(fake.tailscale.unserve).not.toHaveBeenCalled()
  expect(fake.proxy()).toBe('http://127.0.0.1:3773')
})

it('does not remove a setting someone else put on 8443 after Sotto’s, when phone access turns off', async () => {
  const fake = fakeTailscale(), server = fakeServer()
  const { access, settings } = create({ tailscale: fake.tailscale, startServer: server.startServer })
  await access.start()
  fake.setOther('http://127.0.0.1:3773')
  settings.phoneAccess = false
  access.settingsChanged()
  await vi.waitFor(() => expect(access.get().phase).toBe('off'))
  expect(fake.tailscale.unserve).not.toHaveBeenCalled()
  expect(server.started[0]!.closed).toBe(true)
})

it('says Tailscale is not running, changes nothing, and looks again later', async () => {
  vi.useFakeTimers()
  try {
    const fake = fakeTailscale({ status: { state: 'not-running' } }), server = fakeServer()
    const { access } = create({ tailscale: fake.tailscale, startServer: server.startServer })
    await access.start()
    expect(access.get()).toMatchObject({ phase: 'failed', tailscale: { status: 'failed', reason: 'not-running' }, serve: { status: 'waiting' } })
    expect(fake.tailscale.serveStatus).not.toHaveBeenCalled()
    expect(server.started).toEqual([])
    fake.setStatus({ state: 'running', dnsName: DNS, hostName: 'laptop-russh2j5' })
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => expect(access.get().phase).toBe('on'))
    await access.close()
  } finally { vi.useRealTimers() }
})

it('shows the consent page when the tailnet has not turned Serve on, closes the listener, and opens the page only when asked', async () => {
  const enableUrl = 'https://login.tailscale.com/f/serve?node=abc'
  const fake = fakeTailscale({ serve: { ok: false, reason: 'not-enabled', enableUrl } }), server = fakeServer()
  const openExternal = vi.fn(async () => undefined)
  const { access } = create({ tailscale: fake.tailscale, startServer: server.startServer, openExternal })
  await access.start()
  expect(access.get()).toMatchObject({ phase: 'failed', serve: { status: 'failed', reason: 'not-enabled', canOpenSetup: true } })
  expect(JSON.stringify(access.get())).not.toContain('login.tailscale.com')
  expect(server.started[0]!.closed).toBe(true)
  expect(await record()).toMatchObject({ mapped: false })
  expect(openExternal).not.toHaveBeenCalled()
  await access.command({ type: 'open-serve-setup' })
  expect(openExternal).toHaveBeenCalledWith(enableUrl)
})

it('does nothing while the local host is off, and says so', async () => {
  const fake = fakeTailscale(), server = fakeServer()
  const { access } = create({ tailscale: fake.tailscale, startServer: server.startServer, service: undefined })
  await access.start()
  expect(access.get()).toMatchObject({ enabled: true, localHostRunning: false, phase: 'off', phones: [] })
  expect(fake.calls).toEqual([])
  expect(server.started).toEqual([])
})

it('never runs Tailscale at start when phone access is off and left nothing behind', async () => {
  const fake = fakeTailscale(), server = fakeServer()
  const { access } = create({ tailscale: fake.tailscale, startServer: server.startServer }, { phoneAccess: false, phoneAccessName: '' })
  await access.start()
  expect(fake.calls).toEqual([])
  expect(access.get()).toMatchObject({ phase: 'off', computerName: 'LAPTOP', defaultName: 'LAPTOP' })
})

it('removes a setting a crash left behind at the next start when phone access is off', async () => {
  await writeFile(join(root, 'phone-access.json'), JSON.stringify({ port: 41000, mapped: true }))
  const fake = fakeTailscale({ other: serveTarget(41000) }), server = fakeServer()
  const { access } = create({ tailscale: fake.tailscale, startServer: server.startServer }, { phoneAccess: false, phoneAccessName: '' })
  await access.start()
  expect(fake.calls).toEqual(['serve-status', 'unserve'])
  expect(await record()).toEqual({ port: 41000, mapped: false })
})

it('reuses the remembered port, so a setting a crash left is still its own, and falls back to any free one', async () => {
  await writeFile(join(root, 'phone-access.json'), JSON.stringify({ port: 45000, mapped: true }))
  const fake = fakeTailscale({ other: serveTarget(45000) }), server = fakeServer({ refusePort: 45000 })
  const { access } = create({ tailscale: fake.tailscale, startServer: server.startServer })
  await access.start()
  expect(access.get().phase).toBe('on')
  expect(server.startServer).toHaveBeenCalledTimes(2)
  expect(fake.proxy()).toBe(serveTarget(41000))
  expect(await record()).toEqual({ port: 41000, mapped: true })
  await access.close()
})

it('removes the Serve setting and closes the listener on quit, and keeps the setting for the next start', async () => {
  const fake = fakeTailscale(), server = fakeServer()
  const { access, settings } = create({ tailscale: fake.tailscale, startServer: server.startServer })
  await access.start()
  await access.close()
  expect(fake.proxy()).toBeUndefined()
  expect(server.started[0]!.closed).toBe(true)
  expect(settings.phoneAccess).toBe(true)
  expect(await record()).toEqual({ port: 41000, mapped: false })
})

it('serves the name phones show: the setting, or the Tailscale machine name', async () => {
  const fake = fakeTailscale(), server = fakeServer()
  const { access, settings } = create({ tailscale: fake.tailscale, startServer: server.startServer })
  await access.start()
  expect(server.started[0]!.name()).toBe('laptop-russh2j5')
  settings.phoneAccessName = 'Studio'
  access.settingsChanged()
  expect(server.started[0]!.name()).toBe('Studio')
  expect(access.get()).toMatchObject({ computerName: 'Studio', defaultName: 'laptop-russh2j5' })
  await access.close()
})

it('shows one pairing code at a time, only while phones can connect, and forgets it once a phone redeems it', async () => {
  const fake = fakeTailscale(), server = fakeServer()
  const { access, settings } = create({ tailscale: fake.tailscale, startServer: server.startServer }, { phoneAccess: false, phoneAccessName: '' })
  await access.start()
  await expect(access.command({ type: 'show-code' })).rejects.toThrow('Turn on Let phones connect first')
  settings.phoneAccess = true
  access.settingsChanged()
  await vi.waitFor(() => expect(access.get().phase).toBe('on'))
  const first = (await access.command({ type: 'show-code' })).code!
  expect(first.code).toMatch(/^[2-9A-HJKMNP-TV-Z]{8}$/u)
  expect(Date.parse(first.expiresAt) - Date.now()).toBeGreaterThan(4 * 60_000)
  const second = (await access.command({ type: 'show-code' })).code!
  expect(second.code).not.toBe(first.code)
  server.started[0]!.onPaired!('client')
  expect(access.get().code).toBeNull()
  await access.command({ type: 'show-code' })
  expect((await access.command({ type: 'cancel-code' })).code).toBeNull()
  await access.close()
})

it('keeps the listener shut when paired phones cannot be read, and never replaces them', async () => {
  await writeFile(join(root, 'paired-clients.json'), 'not json')
  const fake = fakeTailscale(), server = fakeServer()
  const { access } = create({ tailscale: fake.tailscale, startServer: server.startServer })
  await access.start()
  expect(access.get()).toMatchObject({ phase: 'failed', serve: { status: 'failed', reason: 'listener' }, phones: [] })
  expect(server.started).toEqual([])
  expect(fake.tailscale.serve).not.toHaveBeenCalled()
  expect(await readFile(join(root, 'paired-clients.json'), 'utf8')).toBe('not json')
})

it('removes a setting of its own left by a crash when a start then fails, so 8443 never points at a dead port', async () => {
  await writeFile(join(root, 'phone-access.json'), JSON.stringify({ port: 45000, mapped: true }))
  const fake = fakeTailscale({ other: serveTarget(45000), serve: { ok: false, reason: 'failed' } }), server = fakeServer({ refusePort: 45000 })
  const { access } = create({ tailscale: fake.tailscale, startServer: server.startServer })
  await access.start()
  expect(access.get()).toMatchObject({ phase: 'failed', serve: { status: 'failed', reason: 'failed' } })
  expect(fake.proxy()).toBeUndefined()
  expect(server.started.every(entry => entry.closed)).toBe(true)
  expect(await record()).toMatchObject({ mapped: false })
})

it.each(['status', 'remove'] as const)('retries unfinished cleanup after a %s failure before closing the listener', async failure => {
  vi.useFakeTimers()
  const fake = fakeTailscale(), server = fakeServer()
  const { access, settings } = create({ tailscale: fake.tailscale, startServer: server.startServer })
  try {
    await access.start()
    if (failure === 'status') vi.mocked(fake.tailscale.serveStatus).mockRejectedValueOnce(new Error('unavailable'))
    else vi.mocked(fake.tailscale.unserve).mockResolvedValueOnce(false)
    settings.phoneAccess = false
    access.settingsChanged()
    await access.command({ type: 'cancel-code' })
    await vi.waitFor(() => expect(access.get().phase).toBe('cleanup-failed'))
    expect(server.started[0]!.closed).toBe(false)
    expect(await record()).toMatchObject({ mapped: true })
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => expect(access.get().phase).toBe('off'))
    expect(server.started[0]!.closed).toBe(true)
    expect(fake.proxy()).toBeUndefined()
  } finally { await access.close(); vi.useRealTimers() }
})

it('keeps the listener until process exit when quit cleanup is unfinished', async () => {
  const fake = fakeTailscale(), server = fakeServer()
  const { access } = create({ tailscale: fake.tailscale, startServer: server.startServer })
  await access.start()
  vi.mocked(fake.tailscale.unserve).mockResolvedValue(false)
  await access.close()
  expect(access.get().phase).toBe('cleanup-failed')
  expect(server.started[0]!.closed).toBe(false)
  expect(await record()).toMatchObject({ mapped: true })
})


it('requires a saved phone access record before setup and recovers on retry', async () => {
  const fake = fakeTailscale(), server = fakeServer()
  const { access } = create({ tailscale: fake.tailscale, startServer: server.startServer })
  const originalWrite = AtomicJsonStore.prototype.write
  let refuse = true
  const write = vi.spyOn(AtomicJsonStore.prototype, 'write').mockImplementation(function (this: AtomicJsonStore<unknown>, value: unknown) {
    if (refuse && typeof value === 'object' && value !== null && 'mapped' in value) {
      refuse = false
      return Promise.reject(new Error('unavailable'))
    }
    return originalWrite.call(this, value)
  })
  try {
    await access.start()
    expect(access.get()).toMatchObject({ phase: 'failed', serve: { status: 'failed', reason: 'record' }, address: null })
    expect(fake.tailscale.serve).not.toHaveBeenCalled()
    expect(server.started[0]!.closed).toBe(true)
    expect(fake.tailscale.unserve).not.toHaveBeenCalled()
    await access.command({ type: 'retry' })
    expect(access.get().phase).toBe('on')
    expect(await record()).toMatchObject({ mapped: true })
  } finally { write.mockRestore(); await access.close() }
})
