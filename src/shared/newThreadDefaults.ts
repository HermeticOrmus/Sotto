import { agentRuntimeModeSchema, type AgentModel, type AgentRuntimeMode } from './agents'

/** Sotto's four runtime modes, least to most permissive (issue #347's nearest fit reads positions in this order). */
export const RUNTIME_MODE_ORDER: readonly AgentRuntimeMode[] = agentRuntimeModeSchema.options

/**
 * The offered mode nearest a desired one a provider does not have: the closest one at or below it (safer), or,
 * when nothing safer is offered, the least risky one the provider does offer. `offered` empty means the model
 * has no runtime modes at all, so there is nothing to start on.
 */
export function nearestRuntimeMode(desired: AgentRuntimeMode, offered: readonly AgentRuntimeMode[]): AgentRuntimeMode | undefined {
  if (offered.length === 0) return undefined
  if (offered.includes(desired)) return desired
  const desiredIndex = RUNTIME_MODE_ORDER.indexOf(desired)
  let safest: AgentRuntimeMode | undefined
  for (const mode of offered) {
    const index = RUNTIME_MODE_ORDER.indexOf(mode)
    if (index <= desiredIndex && (safest === undefined || index > RUNTIME_MODE_ORDER.indexOf(safest))) safest = mode
  }
  if (safest !== undefined) return safest
  return offered.reduce((least, mode) => RUNTIME_MODE_ORDER.indexOf(mode) < RUNTIME_MODE_ORDER.indexOf(least) ? mode : least)
}

export interface ResolvedNewThreadPermission {
  readonly runtimeMode?: AgentRuntimeMode
  readonly providerMode?: string
  /** True when the model's provider does not offer the chosen default mode and this is the nearest fit instead. */
  readonly nearestFit: boolean
}

/**
 * The permission a new thread starts on for `model`, given the default mode chosen in Settings (one of Sotto's
 * four, or unset). A provider with its own permission profiles (Devin) always starts on its first, never the
 * chosen default: its profiles are not Sotto's four and have no ordering to compare against them, matching what
 * the New thread dialog always sent for such a model (`startingProviderMode`).
 */
export function resolveNewThreadPermission(model: AgentModel | undefined, defaultMode: AgentRuntimeMode | undefined): ResolvedNewThreadPermission {
  if (model?.providerModes?.length) return { providerMode: model.providerModes[0]!.id, nearestFit: false }
  if (!defaultMode) return { nearestFit: false }
  const offered = model?.runtimeModes ?? []
  if (offered.length === 0) return { nearestFit: false }
  // `offered` is non-empty here, so `nearestRuntimeMode` always returns one of its modes.
  const nearest = nearestRuntimeMode(defaultMode, offered) ?? defaultMode
  return { runtimeMode: nearest, nearestFit: nearest !== defaultMode }
}

/**
 * The reasoning effort nearest a desired one a model does not offer: the position `desired` holds in
 * `reference`'s own ordered levels (least to most thorough), mapped onto `offered`'s. Effort levels are each
 * model's own words; only their order is comparable across two different models. Undefined when `offered` is
 * empty, meaning the model reports no reasoning efforts at all.
 */
export function nearestReasoningEffort(desired: string, reference: readonly string[], offered: readonly string[]): string | undefined {
  if (offered.length === 0) return undefined
  if (offered.includes(desired)) return desired
  const at = reference.indexOf(desired)
  if (at === -1 || reference.length < 2) return offered.at(-1)
  const ratio = at / (reference.length - 1)
  return offered[Math.round(ratio * (offered.length - 1))]
}
