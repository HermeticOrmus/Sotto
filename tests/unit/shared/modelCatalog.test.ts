import { describe, expect, it } from 'vitest'
import { publicProviderEntityId, type AgentModel } from '../../../src/shared/agents'
import { baseModelId, catalogModel, chosenModelId, findModel } from '../../../src/shared/modelCatalog'

const opus: AgentModel = { id: publicProviderEntityId('claude', 'model', 'opus'), name: 'Opus 5.5', provider: 'Claude Code', providerId: 'claude', ready: true,
  reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultReasoningEffort: 'xhigh', supportsImages: true, runtimeModes: ['approval-required', 'auto'] }
const sonnet: AgentModel = { id: publicProviderEntityId('claude', 'model', 'sonnet'), name: 'Sonnet 4.6', provider: 'Claude Code', providerId: 'claude', ready: false }
const catalog = [opus, sonnet]
const variant = publicProviderEntityId('claude', 'model', 'opus[1m]')

describe('which catalog model an ID is on', () => {
  it('answers an ID the catalog lists with that entry as it is', () => {
    expect(findModel(catalog, opus.id)).toBe(opus)
    expect(catalogModel(catalog, sonnet.id)).toBe(sonnet)
  })

  it('answers a long-context variant from its base model, keeping the ID it was asked about', () => {
    expect(variant).toBe('native:claude:model:opus%5B1m%5D')
    expect(findModel(catalog, variant)).toEqual({ ...opus, id: variant })
    expect(catalogModel(catalog, variant)).toBe(opus)
    // The native form an adapter holds resolves the same way against a native catalog.
    const native = [{ id: 'opus', name: 'Opus 5.5', reasoningEfforts: ['high'] }]
    expect(findModel(native, 'opus[1m]')).toEqual({ id: 'opus[1m]', name: 'Opus 5.5', reasoningEfforts: ['high'] })
    expect(findModel(native, 'opus[200k]')?.name).toBe('Opus 5.5')
  })

  it('prefers an exact entry when a catalog still lists the variant itself', () => {
    const listed: AgentModel = { ...opus, id: variant, name: 'Opus 5.5 (1M context)' }
    expect(findModel([opus, listed], variant)).toBe(listed)
  })

  it('reads the size without regard to case, in either the native or the public form', () => {
    expect(findModel(catalog, publicProviderEntityId('claude', 'model', 'opus[1M]'))?.name).toBe('Opus 5.5')
    expect(findModel(catalog, 'native:claude:model:opus%5b1m%5d')?.name).toBe('Opus 5.5')
    expect(findModel([{ id: 'opus' }], 'opus[1M]')).toEqual({ id: 'opus[1M]' })
  })

  it('leaves a variant of a model the catalog does not have unknown, as any unknown ID is', () => {
    expect(findModel(catalog, publicProviderEntityId('claude', 'model', 'claude-fable-5-1[1m]'))).toBeUndefined()
    expect(findModel(catalog, publicProviderEntityId('claude', 'model', 'haiku'))).toBeUndefined()
    expect(findModel(catalog, '')).toBeUndefined()
    expect(findModel(catalog, undefined)).toBeUndefined()
  })

  it('takes only a bracketed context size as a variant, not any brackets', () => {
    for (const native of ['opus[beta]', 'opus[1]', 'opus[m]', 'opus[1m', 'opus[1m]x', 'opus[1g]', '[1m]', 'opus [1m] ', 'opus[1m][1m]']) {
      expect(findModel(catalog, publicProviderEntityId('claude', 'model', native)), native).toBeUndefined()
    }
    expect(baseModelId('native:claude:model:opus%5B1m%5D')).toBe('native:claude:model:opus')
    expect(baseModelId('opus[1m]')).toBe('opus')
    expect(baseModelId('native:claude:model:%E0%A4%A')).toBeUndefined()
  })

  it('keeps the variant when its own entry is pressed, and moves for any other entry', () => {
    expect(chosenModelId(catalog, opus.id, variant)).toBe(variant)
    expect(chosenModelId(catalog, sonnet.id, variant)).toBe(sonnet.id)
    expect(chosenModelId(catalog, opus.id, sonnet.id)).toBe(opus.id)
    expect(chosenModelId(catalog, opus.id, undefined)).toBe(opus.id)
  })
})
