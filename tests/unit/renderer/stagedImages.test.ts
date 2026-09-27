import { describe, expect, it } from 'vitest'
import { stagingError } from '../../../src/renderer/src/agents/stagedImages'

describe('a failed staging, as the composer words it', () => {
  it('drops the channel Electron prefixes to whatever main threw', () => {
    expect(stagingError(new Error("Error invoking remote method 'sotto:agents:stage-attachment': Error: Each screenshot must be 10 MB or smaller.")))
      .toBe('Each screenshot must be 10 MB or smaller.')
    expect(stagingError(new Error('The image content does not match its file type.'))).toBe('The image content does not match its file type.')
  })
  it('gives a plain sentence for a refusal that has none of its own', () => {
    const plain = 'Could not add this screenshot. Nothing was attached. Try again.'
    expect(stagingError(new Error("Error invoking remote method 'sotto:agents:stage-attachment': Error: AGENT_SENDER_REJECTED"))).toBe(plain)
    expect(stagingError(new Error('[{"code":"invalid_type","path":["bytes"]}]'))).toBe(plain)
    expect(stagingError(new Error("Error invoking remote method 'sotto:agents:stage-attachment': ZodError: [{\"code\":\"too_big\"}]"))).toBe(plain)
    expect(stagingError('not an error')).toBe(plain)
  })
})
