// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { startHeadlessHost } from '../../src/host'
import { SocketHostService } from '../../src/main/agents/socketHostService'
import { E2EAgentHost, e2eAgentReasoner } from '../../src/main/e2e/agentEffects'
import { PolicyStore } from '../../src/main/memory/policies'
import { MemoryStore } from '../../src/main/memory/store'
import { PhoneAccess, type PhoneAccessTailscale } from '../../src/main/phones/phoneAccess'
import { serveTarget } from '../../src/main/phones/tailscale'

/**
 * The desktop's phone listener over a real host service and the real socket server: what a phone sees
 * at health, pairing through a code the Phones page showed, Can answer, and Remove. Tailscale is a
 * stand-in; the listener is reached on its loopback port, which is what Serve proxies to.
 */
let root: string
let host: Awaited<ReturnType<typeof startHeadlessHost>>
let memory: MemoryStore
let access: PhoneAccess
const clients: SocketHostService[] = []
const settings = { phoneAccess: true, phoneAccessName: 'Studio' }
const tailscale: PhoneAccessTailscale = {
  status: async () => ({ state: 'running', dnsName: 'studio.tail5728ca.ts.net', hostName: 'studio' }),
  serveStatus: async () => ({}),
  serve: async () => ({ ok: true }),
  unserve: async () => true,
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sotto-phone-listener-'))
  host = await startHeadlessHost({ dataDirectory: join(root, 'host'), reasoner: e2eAgentReasoner,
    providers: { codex: new E2EAgentHost(), claude: new E2EAgentHost(), grok: new E2EAgentHost(), devin: new E2EAgentHost() } })
  memory = new MemoryStore(join(root, 'memory.sqlite')); memory.open()
  settings.phoneAccess = true
  access = new PhoneAccess({ directory: join(root, 'desktop'), service: host.service, tailscale, settings: () => settings, policy: new PolicyStore(memory), openExternal: async () => undefined })
  await access.start()
  expect(access.get().phase).toBe('on')
})
afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.close()))
  await access.close(); await host.close(); memory.close()
  if (dirname(root) === tmpdir() && root.includes('sotto-phone-listener-')) await rm(root, { recursive: true, force: true })
})
const url = async () => serveTarget((JSON.parse(await readFile(join(root, 'desktop', 'phone-access.json'), 'utf8')) as { port: number }).port)
async function pairPhone(name = 'Zach’s iPhone', onConnectionChange?: (connected: boolean) => void) {
  const code = (await access.command({ type: 'show-code' })).code!.code
  const paired = await SocketHostService.pair(await url(), code, name)
  const client = new SocketHostService({ url: await url(), token: paired.token, expectedHostId: paired.hostId, ...(onConnectionChange ? { onConnectionChange } : {}) }); clients.push(client)
  return { client, paired }
}

it('answers health with the name phones show, and has no administrative routes', async () => {
  const base = await url()
  expect(await (await fetch(base + '/v1/health')).json()).toMatchObject({ v: 1, status: 'ready', hostId: host.service.shell().hostId, name: 'Studio' })
  expect((await fetch(base + '/v1/admin/pairing-code', { method: 'POST' })).status).toBe(400)
  settings.phoneAccessName = ''
  expect(await (await fetch(base + '/v1/health')).json()).toMatchObject({ name: 'studio' })
  settings.phoneAccessName = 'Studio'
})

it('pairs a phone with the code shown, closes the code, and lists the phone as connected', async () => {
  const { client, paired } = await pairPhone()
  expect(access.get().code).toBeNull()
  expect((await client.connect()).capabilities.mayAnswer).toBe(false)
  expect(access.get().phones).toEqual([expect.objectContaining({ clientId: paired.clientId, name: 'Zach’s iPhone', connected: true, canAnswer: false })])
  // A code works once.
  const spent = await fetch(await url() + '/v1/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ v: 1, code: 'AAAAAAAA', name: 'Other' }) })
  expect(spent.status).toBe(401)
})

it('refuses a code the owner cancelled or replaced', async () => {
  const cancelled = (await access.command({ type: 'show-code' })).code!.code
  await access.command({ type: 'cancel-code' })
  await expect(SocketHostService.pair(await url(), cancelled, 'Phone')).rejects.toBeDefined()
  const replaced = (await access.command({ type: 'show-code' })).code!.code
  await access.command({ type: 'show-code' })
  await expect(SocketHostService.pair(await url(), replaced, 'Phone')).rejects.toBeDefined()
  expect(access.get().phones).toEqual([])
})

it('lets a phone answer only once the owner turns on Can answer, which writes the policy record', async () => {
  const { client, paired } = await pairPhone()
  await client.connect()
  await access.command({ type: 'set-can-answer', clientId: paired.clientId, allowed: true })
  expect(access.get().phones[0]).toMatchObject({ canAnswer: true })
  expect(new PolicyStore(memory).list({ scope: `client:${paired.clientId}` })).toEqual([expect.objectContaining({ action: 'remote-answer', resource: paired.clientId, source: 'user' })])
  expect((await client.connect()).capabilities.mayAnswer).toBe(true)
  await access.command({ type: 'set-can-answer', clientId: paired.clientId, allowed: false })
  expect((await client.connect()).capabilities.mayAnswer).toBe(false)
  expect(new PolicyStore(memory).list({ scope: `client:${paired.clientId}` }).filter(record => record.action === 'remote-answer')).toEqual([])
})

it('removes a phone: its pairing ends and its connection closes at once', async () => {
  const changes: boolean[] = []
  const { client, paired } = await pairPhone('Zach’s iPhone', connected => changes.push(connected))
  await client.connect()
  await access.command({ type: 'set-can-answer', clientId: paired.clientId, allowed: true })
  await access.command({ type: 'remove', clientId: paired.clientId })
  expect(access.get().phones).toEqual([])
  await expect(client.connect()).rejects.toMatchObject({ code: 'unauthenticated' })
  expect(new PolicyStore(memory).list({ scope: `client:${paired.clientId}` }).filter(record => record.action === 'remote-answer')).toEqual([])
  expect(changes).toContain(false)
})

it('closes every phone’s socket when phone access turns off', async () => {
  const { client } = await pairPhone()
  await client.connect()
  expect(access.get().phones[0]!.connected).toBe(true)
  settings.phoneAccess = false
  access.settingsChanged()
  await expect.poll(() => access.get().phase).toBe('off')
  await expect.poll(() => access.get().phones[0]?.connected).toBe(false)
  await expect(fetch(await url() + '/v1/health')).rejects.toBeDefined()
})
