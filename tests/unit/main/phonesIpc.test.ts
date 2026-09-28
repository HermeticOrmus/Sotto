// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { registerPhonesIpc } from '../../../src/main/phones/ipc'
import type { IpcMainAdapter, TrustedIpcSender } from '../../../src/main/ipc/registerIpc'
import { PHONES_COMMAND, PHONES_GET, type PhonesState } from '../../../src/shared/phones'

type Handler = (event: unknown, ...args: unknown[]) => unknown
function harness() {
  const handlers = new Map<string, Handler>()
  const ipc: IpcMainAdapter = { handle: (channel, listener) => { handlers.set(channel, listener as Handler) }, removeHandler: channel => { handlers.delete(channel) } }
  const sender = (url: string) => {
    const frame = { parent: null, url }
    return { sender: { isDestroyed: () => false, mainFrame: frame, getURL: () => url }, senderFrame: frame }
  }
  const main = sender('app://sotto/index.html'), widget = sender('app://sotto/widget.html')
  const trusted: TrustedIpcSender[] = [
    { role: 'main', webContents: main.sender as never, url: 'app://sotto/index.html' },
    { role: 'widget', webContents: widget.sender as never, url: 'app://sotto/widget.html' },
  ]
  return { ipc, handlers, main, widget, trusted }
}

it('answers the Phones page in the main window only, and parses every command', async () => {
  const { ipc, handlers, main, widget, trusted } = harness()
  const state = { phase: 'on', code: { code: 'K7MX3QPD', expiresAt: '2026-09-26T12:05:00.000Z' } } as unknown as PhonesState
  const phones = { get: vi.fn(() => state), command: vi.fn(async () => state), subscribe: vi.fn(() => () => undefined) }
  const cleanup = registerPhonesIpc(ipc, phones, () => trusted, () => undefined)
  expect(handlers.get(PHONES_GET)!(main)).toBe(state)
  expect(() => handlers.get(PHONES_GET)!(widget)).toThrow('Open Phones in the main Sotto window.')
  expect(() => handlers.get(PHONES_COMMAND)!(widget, { type: 'show-code' })).toThrow('Open Phones in the main Sotto window.')
  await handlers.get(PHONES_COMMAND)!(main, { type: 'show-code' })
  expect(phones.command).toHaveBeenCalledWith({ type: 'show-code' })
  expect(() => handlers.get(PHONES_COMMAND)!(main, { type: 'set-can-answer', clientId: 'phone' })).toThrow()
  expect(() => handlers.get(PHONES_COMMAND)!(main, { type: 'open-url', url: 'https://example.com' })).toThrow()
  cleanup()
  expect(handlers.size).toBe(0)
})
