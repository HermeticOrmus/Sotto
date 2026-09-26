import { agentRuntimeModeSchema, type AgentModel } from '../../src/shared/agents'

/** How many models the owner's installed catalog held when ADR-0028 measured it. */
export const OWNER_CATALOG_SIZE = 608

/**
 * A synthetic model catalog shaped like a real one: provider-scoped ids, the reasoning levels, runtime
 * modes and provider permission modes a real model lists, and a description on each mode. Every entry is
 * invented, so a benchmark can report its size without reading anything the user has.
 */
export function syntheticModelCatalog(count = OWNER_CATALOG_SIZE): AgentModel[] {
  const providers = ['codex', 'claude', 'grok', 'devin'] as const
  return Array.from({ length: count }, (_, index): AgentModel => {
    const providerId = providers[index % providers.length]!
    return {
      id: `${providerId}:synthetic-model-${index}`, provider: providerId, providerId, name: `Synthetic model ${index}`, ready: index % 7 !== 0,
      reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'], defaultReasoningEffort: 'medium',
      runtimeModes: [...agentRuntimeModeSchema.options], supportsImages: index % 3 !== 0,
      providerModes: ['ask', 'edit', 'plan'].map(mode => ({
        id: `${providerId}-${mode}`, name: `Mode ${mode}`,
        description: `A synthetic ${mode} mode that stands in for the sentence a provider writes about it.`,
        asks: 'Before each command and edit.', allows: mode === 'edit' ? 'edits' as const : 'nothing' as const,
      })),
      ...(index === 0 ? { recommended: true } : {}),
    }
  })
}
