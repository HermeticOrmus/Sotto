// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PersonalChatService } from '../../../src/main/agents/personalChats'
import { E2EPersonalChatHost } from '../../../src/main/e2e/personalChatHost'

const roots: string[] = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sotto-personal-update-')); roots.push(root)
  const hosts = {
    codex: new E2EPersonalChatHost(root), claude: new E2EPersonalChatHost(root, 'claude'), grok: new E2EPersonalChatHost(root, 'grok'),
  }
  const service = new PersonalChatService({ userDataPath: root, hosts,
    configuration: () => ({ reasoning: 'codex', reasoningModel: 'codex:test', reasoningEffort: '' }),
  })
  await service.start()
  await service.create()
  await service.connect()
  return { hosts, service }
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (dirname(root) !== tmpdir() || !root.includes('sotto-personal-update-')) throw new Error('Unexpected test directory')
    await rm(root, { recursive: true, force: true })
  }
})

it('tells its own client that a new one is on disk and keeps every chat connected', async () => {
  const { hosts, service } = await fixture()
  try {
    expect(service.get().connected).toBe(true)
    const clientUpdated = vi.fn(async () => undefined)
    Object.assign(hosts.codex, { clientUpdated })
    const disconnect = vi.spyOn(hosts.codex, 'disconnect')
    const connect = vi.spyOn(hosts.codex, 'connect')
    await service.clientUpdated('codex')
    expect(clientUpdated).toHaveBeenCalledOnce()
    expect(disconnect).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
    expect(service.get().connected).toBe(true)
  } finally { await service.close() }
})

it('passes on why its client could not move, and leaves the chats connected', async () => {
  const { hosts, service } = await fixture()
  try {
    Object.assign(hosts.codex, { clientUpdated: async () => { throw new Error('stuck') } })
    await expect(service.clientUpdated('codex')).rejects.toThrow('stuck')
    expect(service.get().connected).toBe(true)
  } finally { await service.close() }
})

it('tells only the client that was updated, and nothing for a provider with no personal chats', async () => {
  const { hosts, service } = await fixture()
  try {
    const codex = vi.fn(async () => undefined), grok = vi.fn(async () => undefined)
    Object.assign(hosts.codex, { clientUpdated: codex }); Object.assign(hosts.grok, { clientUpdated: grok })
    await service.clientUpdated('grok')
    expect(grok).toHaveBeenCalledOnce()
    expect(codex).not.toHaveBeenCalled()
    // Devin has no personal chats, so there is nothing to tell.
    await service.clientUpdated('devin')
    expect(codex).not.toHaveBeenCalled()
    expect(grok).toHaveBeenCalledOnce()
  } finally { await service.close() }
})
