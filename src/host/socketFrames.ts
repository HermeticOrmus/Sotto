import { randomBytes } from 'node:crypto'
import type { Duplex } from 'node:stream'
import { HOST_MAX_FRAME_BYTES } from '../shared/hostProtocol'

/** The RFC 6455 framing boundary, shared by the Node client and listener. No protocol bodies are logged. */
export class SocketFrames {
  private chunks: Buffer[] = []
  private bufferedBytes = 0
  private fragments: Buffer[] = []
  private fragmentedBytes = 0
  private ended = false
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private awaitingPong: Buffer | undefined
  private lastReceived = Date.now()
  get isClosed(): boolean { return this.ended }
  private readonly closedListeners = new Set<() => void>()
  constructor(private readonly stream: Duplex, private readonly client: boolean, private readonly message: (text: string) => void) {
    stream.on('data', (data: Buffer) => this.receive(data))
    stream.on('error', () => this.close())
    stream.on('close', () => this.closed())
    stream.on('end', () => this.close())
  }
  startHeartbeat(): void {
    if (this.heartbeat || this.ended) return
    this.heartbeat = setInterval(() => {
      if (this.stream.writableLength > 0) return
      if (!this.client) {
        if (Date.now() - this.lastReceived >= 75_000) this.close()
        return
      }
      if (this.awaitingPong) { this.close(); return }
      this.awaitingPong = randomBytes(8)
      this.write(9, this.awaitingPong)
    }, 25_000)
    this.heartbeat.unref()
  }
  feed(data: Buffer): void { if (data.length) this.receive(data) }
  onClose(listener: () => void): () => void { this.closedListeners.add(listener); return () => this.closedListeners.delete(listener) }
  /** Waits for buffered output to drain before the next detail in a batch is materialised. */
  drained(): Promise<void> {
    if (this.ended || !this.stream.writableNeedDrain) return Promise.resolve()
    return new Promise(resolve => {
      const done = (): void => { this.stream.removeListener('drain', done); this.closedListeners.delete(done); resolve() }
      this.stream.once('drain', done); this.closedListeners.add(done)
    })
  }
  send(value: unknown): boolean { return this.sendText(JSON.stringify(value)) }
  sendText(text: string): boolean { return this.write(1, Buffer.from(text)) }
  close(): void { if (!this.ended) { this.stream.destroy(); this.closed() } }
  private closed(): void {
    if (this.ended) return
    this.ended = true
    clearInterval(this.heartbeat); this.heartbeat = undefined; this.awaitingPong = undefined
    this.chunks = []; this.bufferedBytes = 0; this.fragments = []
    for (const listener of this.closedListeners) listener()
    this.closedListeners.clear()
  }
  private write(opcode: number, data: Buffer): boolean {
    if (this.ended) return false
    if (data.length > HOST_MAX_FRAME_BYTES || this.stream.writableLength + data.length > HOST_MAX_FRAME_BYTES * 2) { this.close(); return false }
    const extended = data.length < 126 ? 0 : data.length <= 65535 ? 2 : 8
    const header = Buffer.alloc(2 + extended + (this.client ? 4 : 0))
    header[0] = 0x80 | opcode
    header[1] = (this.client ? 0x80 : 0) | (extended === 0 ? data.length : extended === 2 ? 126 : 127)
    if (extended === 2) header.writeUInt16BE(data.length, 2)
    if (extended === 8) header.writeBigUInt64BE(BigInt(data.length), 2)
    if (this.client) {
      const mask = randomBytes(4); mask.copy(header, 2 + extended)
      data = Buffer.from(data)
      for (let index = 0; index < data.length; index++) data[index] = data[index]! ^ mask[index % 4]!
    }
    this.stream.write(Buffer.concat([header, data]))
    return true
  }
  private receive(data: Buffer): void {
    if (this.ended) return
    if (data.length) { this.lastReceived = Date.now(); this.awaitingPong = undefined; this.chunks.push(data); this.bufferedBytes += data.length }
    while (this.bufferedBytes >= 2 && !this.ended) {
      const header = this.header()
      const first = header[0]!, second = header[1]!, opcode = first & 15
      const final = (first & 128) !== 0, masked = (second & 128) !== 0
      if ((first & 112) !== 0 || masked === this.client || ![0, 1, 8, 9, 10].includes(opcode)) { this.close(); return }
      let size = second & 127, offset = 2
      if (size === 126) { if (this.bufferedBytes < 4) return; size = header.readUInt16BE(2); offset = 4 }
      else if (size === 127) {
        if (this.bufferedBytes < 10) return
        const big = header.readBigUInt64BE(2)
        if (big > BigInt(HOST_MAX_FRAME_BYTES)) { this.close(); return }
        size = Number(big); offset = 10
      }
      if (size > HOST_MAX_FRAME_BYTES || (opcode >= 8 && (!final || size > 125))) { this.close(); return }
      const maskOffset = offset
      if (masked) offset += 4
      if (this.bufferedBytes < offset + size) return
      const frame = this.take(offset + size)
      const payload = Buffer.from(frame.subarray(offset))
      if (masked) for (let index = 0; index < size; index++) payload[index] = payload[index]! ^ header[maskOffset + index % 4]!
      if (opcode === 8) { if (this.write(8, payload)) { this.stream.end(); this.closed() } return }
      if (opcode === 9) { this.write(10, payload); continue }
      if (opcode === 10) { if (this.awaitingPong?.equals(payload)) this.awaitingPong = undefined; continue }
      if ((opcode === 0 && this.fragments.length === 0) || (opcode === 1 && this.fragments.length > 0)) { this.close(); return }
      this.fragmentedBytes += payload.length
      if (this.fragmentedBytes > HOST_MAX_FRAME_BYTES) { this.close(); return }
      this.fragments.push(payload)
      if (final) {
        let text: string
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(this.fragments)) } catch { this.close(); return }
        this.fragments = []; this.fragmentedBytes = 0
        this.message(text)
      }
    }
  }
  /** Inspect at most the fourteen header bytes without copying an incomplete frame's body. */
  private header(): Buffer {
    const size = Math.min(this.bufferedBytes, 14)
    if (this.chunks[0]!.length >= size) return this.chunks[0]!.subarray(0, size)
    const header = Buffer.alloc(size)
    let copied = 0
    for (const chunk of this.chunks) {
      copied += chunk.copy(header, copied, 0, Math.min(chunk.length, size - copied))
      if (copied === size) break
    }
    return header
  }
  /** Remove one complete frame, joining its chunks once and leaving the next frame queued. */
  private take(size: number): Buffer {
    const parts: Buffer[] = []
    let remaining = size, consumed = 0
    while (remaining > 0) {
      const chunk = this.chunks[consumed]!, count = Math.min(chunk.length, remaining)
      parts.push(chunk.subarray(0, count))
      remaining -= count
      if (count === chunk.length) consumed++
      else this.chunks[consumed] = chunk.subarray(count)
    }
    this.chunks.splice(0, consumed)
    this.bufferedBytes -= size
    return parts.length === 1 ? parts[0]! : Buffer.concat(parts, size)
  }
}
