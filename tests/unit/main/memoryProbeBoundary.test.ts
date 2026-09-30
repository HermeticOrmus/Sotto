// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('memory probe admission', () => {
  it('admits the environment flag only in unpackaged builds', async () => {
    const source = await readFile('src/main/index.ts', 'utf8')
    const expression = source.match(/const memoryProbeMode = (.+)/)![1]!
    const admitted = new Function('app', 'process', `return ${expression}`)
    expect(admitted({ isPackaged: true }, { env: { SOTTO_MEMORY_PROBE: '1' } })).toBe(false)
    expect(admitted({ isPackaged: false }, { env: { SOTTO_MEMORY_PROBE: '1' } })).toBe(true)
    expect(admitted({ isPackaged: false }, { env: {} })).toBe(false)
  })
})
