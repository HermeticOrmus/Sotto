// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { EMPTY_AGENT_HOST, publicProviderEntityId, type AgentAttachment, type AgentHostSnapshot, type AgentModel } from '../../../src/shared/agents'
import { effortAfterChange, validatePromptAttachments, validateThreadOptions } from '../../../src/main/agents/threadOptions'
import { sideWritingEffort } from '../../../src/main/agents/sideWriting'

const image: AgentAttachment = { id: 'shot-1', name: 'Screenshot.png', mimeType: 'image/png',
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZ0AAAAASUVORK5CYII=' }
const opus: Omit<AgentModel, 'id'> = { name: 'Opus 5.5', provider: 'Claude Code', providerId: 'claude', ready: true, supportsImages: true,
  reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultReasoningEffort: 'xhigh', runtimeModes: ['approval-required', 'auto'] }
const haiku: Omit<AgentModel, 'id'> = { name: 'Haiku 4.5', provider: 'Claude Code', providerId: 'claude', ready: true, reasoningEfforts: [] }

/**
 * The same catalog as an adapter holds it (native IDs) and as the coordinator holds it (public IDs). Claude Code
 * 2.1.283 lists `opus` and no `opus[1m]`, which threads and the Settings default still carry (#344).
 */
const catalogs: [string, (native: string) => string][] = [
  ['native', native => native],
  ['public', native => publicProviderEntityId('claude', 'model', native)],
]
const snapshot = (id: (native: string) => string): AgentHostSnapshot =>
  ({ ...structuredClone(EMPTY_AGENT_HOST), connected: true, models: [{ ...opus, id: id('opus') }, { ...haiku, id: id('haiku') }] })

describe.each(catalogs)('a long-context model in a %s catalog that lists only its base', (_, id) => {
  const host = snapshot(id)
  const variant = id('opus[1m]')

  it('is ready, with the base model’s efforts, modes and image support', () => {
    expect(() => validateThreadOptions(host, { modelId: variant, reasoningEffort: 'max', runtimeMode: 'auto' })).not.toThrow()
    expect(() => validateThreadOptions(host, { reasoningEffort: 'low' }, variant)).not.toThrow()
    expect(() => validateThreadOptions(host, { reasoningEffort: 'ultra' }, variant)).toThrow('That reasoning level is not supported by this model.')
    expect(() => validateThreadOptions(host, { runtimeMode: 'full-access' }, variant)).toThrow('That permission mode is not supported by this provider.')
    expect(validatePromptAttachments(host, variant, [image])).toEqual([image])
    expect(effortAfterChange(host, { modelId: variant }, 'low')).toBe('xhigh')
    expect(sideWritingEffort(host.models, variant)).toBe('low')
  })

  it('stays refused when its base is not in the catalog, as any unknown model is', () => {
    expect(() => validateThreadOptions(host, { modelId: id('claude-fable-5-1[1m]') })).toThrow('That model or account is unavailable.')
    expect(() => validatePromptAttachments(host, id('claude-fable-5-1[1m]'), [image])).toThrow('This model does not advertise image support.')
    expect(() => validatePromptAttachments(host, id('haiku[1m]'), [image])).toThrow('This model does not advertise image support.')
  })
})
