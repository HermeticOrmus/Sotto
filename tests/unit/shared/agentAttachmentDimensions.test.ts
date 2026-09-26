// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { agentAttachmentSchema, agentAttachmentsSchema, agentCommandSchema, type AgentAttachment } from '../../../src/shared/agents'

const image: AgentAttachment = { id: 'shot-1', name: 'Screenshot.png', mimeType: 'image/png',
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZ0AAAAASUVORK5CYII=' }
const dimensions = { original: { width: 3840, height: 2160 }, sent: { width: 2576, height: 1449 } }

describe('an attachment\'s recorded sizes', () => {
  it('are optional, so an attachment saved before they existed still reads', () => {
    expect(agentAttachmentSchema.safeParse(image).success).toBe(true)
  })
  it('carry the original and sent sizes through a saved draft', () => {
    const parsed = agentCommandSchema.parse({ type: 'save-thread-draft', composer: 'manual', threadId: 'thread-1', draftId: crypto.randomUUID(), text: '',
      attachments: [{ ...image, dimensions }], requestId: null })
    expect(parsed).toMatchObject({ attachments: [{ dimensions }] })
  })
  it('hold sizes only, as whole pixels', () => {
    for (const bad of [
      { original: { width: 0, height: 10 }, sent: { width: 1, height: 1 } },
      { original: { width: 1.5, height: 10 }, sent: { width: 1, height: 1 } },
      { original: { width: 10, height: 10 }, sent: { width: 10, height: 10 }, preview: 'data:image/png;base64,AAAA' },
      { original: { width: 10, height: 10, dataUrl: 'data:image/png;base64,AAAA' }, sent: { width: 10, height: 10 } },
    ]) expect(agentAttachmentsSchema.safeParse([{ ...image, dimensions: bad }]).success).toBe(false)
  })
})
