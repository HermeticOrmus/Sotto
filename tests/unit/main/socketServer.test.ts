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
import { SocketFrames } from '../../../src/host/socketFrames'
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

it('answers a full listener with a temporary capacity refusal and releases idle peers', async () => {
  directory = await mkdtemp(join(tmpdir(), 'sotto-listener-'))
  const pairing = new PairedClients(directory); await pairing.load()
  const paired = await pairing.redeem(pairing.issuePairingCode().code, 'Phone')
  const session = pairing.signSession(paired.clientId)
  const service = { shell: () => ({ hostId: 'host' }), subscribe: () => () => {}, command: async () => ({}) } as unknown as HostService
  listener = await startSocketServer({ service, pairing })
  const headers = { authorization: 'Bearer ' + session, 'sec-websocket-version': '13', 'sec-websocket-key': 'AAAAAAAAAAAAAAAAAAAAAA==' }
  vi.useFakeTimers()
  try {
    const streams = Array.from({ length: 33 }, () => {
      const writes: string[] = []
      const stream = new Duplex({ read() {}, write(chunk, _encoding, done) { writes.push(String(chunk)); done() } })
      captured.server!.emit('upgrade', { headers, url: '/v1/socket' }, stream, Buffer.alloc(0))
      return { stream, writes }
    })
    expect(listener.peers()).toBe(32)
    expect(streams[32]!.writes[0]).toContain('503 Service Unavailable')
    vi.advanceTimersByTime(75_000)
    expect(listener.peers()).toBe(0)
    for (const { stream } of streams) stream.destroy()
  } finally { vi.useRealTimers() }
})

it.each([false, true])('negotiates client liveness from hello (opted in: %s)', async optedIn => {
  directory = await mkdtemp(join(tmpdir(), 'sotto-listener-'))
  const pairing = new PairedClients(directory); await pairing.load()
  const paired = await pairing.redeem(pairing.issuePairingCode().code, 'Phone')
  const session = pairing.signSession(paired.clientId)
  const service = { shell: () => ({ hostId: 'host' }), subscribe: () => () => {}, events: () => [] } as unknown as HostService
  listener = await startSocketServer({ service, pairing })
  const writes: Buffer[] = []
  const stream = new Duplex({ read() {}, write(chunk, _encoding, done) { writes.push(Buffer.from(chunk)); done() } })
  const headers = { authorization: 'Bearer ' + session, 'sec-websocket-version': '13', 'sec-websocket-key': 'AAAAAAAAAAAAAAAAAAAAAA==' }
  vi.useFakeTimers()
  const clientWrites: Buffer[] = []
  const clientStream = new Duplex({ read() {}, write(chunk, _encoding, done) { clientWrites.push(Buffer.from(chunk)); done() } })
  const client = new SocketFrames(clientStream, true, () => {})
  try {
    captured.server!.emit('upgrade', { headers, url: '/v1/socket' }, stream, Buffer.alloc(0))
    client.send({ v: 1, id: 'hello', session, op: 'hello', ...(optedIn ? { accepts: ['client-liveness'] } : {}) })
    stream.emit('data', clientWrites.shift()!)
    await Promise.resolve()
    for (let round = 0; round < 4; round++) {
      vi.advanceTimersByTime(25_000)
      if (!optedIn) {
        const ping = writes.at(-1)!
        expect(ping[0]).toBe(137)
        client.feed(ping)
        stream.emit('data', clientWrites.shift()!)
      }
    }
    expect(stream.destroyed).toBe(optedIn)
  } finally { client.close(); stream.destroy(); vi.useRealTimers() }
})
