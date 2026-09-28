// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { grokEnvironment } from '../../../src/main/agents/grokRpc'

describe('Grok thread environment', () => {
  it('passes the Windows machine-wide data folder so tools like OpenSSH find their system configuration', () => {
    const env = grokEnvironment({ ProgramData: 'C:\\ProgramData', ALLUSERSPROFILE: 'C:\\ProgramData', XAI_API_KEY: 'fixture-secret' })
    expect(env.ProgramData).toBe('C:\\ProgramData')
    expect(env.ALLUSERSPROFILE).toBe('C:\\ProgramData')
    expect(env.XAI_API_KEY).toBeUndefined()
  })
})
