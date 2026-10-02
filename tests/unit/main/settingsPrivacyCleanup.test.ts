// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { cleanSettingsHistory } from '../../../src/main/settings/privacyCleanup'

it.each(['agents', 'chats'] as const)('finishes both privacy hooks and settings notifications when %s cleanup fails', async failing => {
  const failure = new Error('Synthetic unavailable storage')
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  const agents = { privacyChanged: vi.fn(() => failing === 'agents' ? Promise.reject(failure) : pending) }
  const chats = { privacyChanged: vi.fn(() => failing === 'chats' ? Promise.reject(failure) : pending) }
  const notify = vi.fn(async () => undefined)
  const cleanup = cleanSettingsHistory(agents, chats, notify)
  const rejected = cleanup.catch(error => error)
  await vi.waitFor(() => {
    expect(agents.privacyChanged).toHaveBeenCalledOnce()
    expect(chats.privacyChanged).toHaveBeenCalledOnce()
  })
  expect(notify).not.toHaveBeenCalled()
  finish()
  expect(await rejected).toBe(failure)
  expect(notify).toHaveBeenCalledOnce()
})
