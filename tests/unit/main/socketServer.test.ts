// @vitest-environment node
import { Duplex } from 'node:stream'
import type { Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PairedClients } from '../../../src/main/agents/pairing'
import type { HostService } from '../../../src/main/agents/hostService'

const captured = vi.hoisted(() => ({ server: undefined as Server | undefined }))
vi.mock('node:http', async importOriginal => {
  const original = await importOriginal<typeof import('node:http')>()
  return { ...original, createServer: (...args: Parameters<typeof original.createServer>) => {
    captured.server = original.createServer(...args)
    return captured.server
  } }
})
import { startSocketServer } from '../../../src/host/socketServer'

let directory: string | undefined
let listener: Awaited<ReturnType<typeof startSocketServer>> | undefined
afterEach(async () => { await listener?.close(); if (directory) await rm(directory, { recursive: true, force: true }) })
it('closes refused streams cleanly and handles listener errors after startup', async () => {
  directory = await mkdtemp(join(tmpdir(), 'sotto-listener-'))
  const pairing = new PairedClients(directory); await pairing.load()
  const service = { shell: () => ({ hostId: 'host' }), subscribe: () => () => {} } as unknown as HostService
  listener = await startSocketServer({ service, pairing })
  const stream = new Duplex({ read() {}, write(_chunk, _encoding, done) { done() } })
  captured.server!.emit('upgrade', { headers: {}, url: '/v1/socket' }, stream, Buffer.alloc(0))
  expect(() => stream.emit('error', new Error('Connection closed'))).not.toThrow()
  expect(stream.destroyed).toBe(true)
  expect(() => captured.server!.emit('error', new Error('Listener error'))).not.toThrow()
})
