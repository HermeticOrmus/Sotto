import { parsePublicProviderEntityId, publicProviderEntityId } from './agents'

/**
 * Which catalog model a thread, a default or a setting is on. A thread keeps the model ID it was given, but a
 * provider's catalog need not list it: Claude Code lists `opus` and no longer `opus[1m]`, its 1M-context variant,
 * though it still runs `--model opus[1m]` (#344). A Claude model ID ending in `[1m]` is that base model with more
 * context, so it answers from the base model's entry. Everything that asks what a model is called, whether it is
 * ready, which efforts, modes and images it takes reads it through here rather than matching IDs itself, so a
 * variant is never mistaken for an unknown model.
 */

/**
 * The one context suffix Claude Code documents: `[1m]`, which its settings reference names beside a model's dated,
 * Bedrock and Vertex spellings. Nothing looser, so `opus[beta]` or `[1m]` alone is no variant.
 */
const LONG_CONTEXT = /^(.+)\[1m\]$/iu

/**
 * The base model's ID a 1M-context variant's ID names, in the same form: a Claude public ID, or a native ID as the
 * Claude adapter and client hold them. Undefined for any other ID, and for another provider's public ID.
 */
export function baseModelId(modelId: string): string | undefined {
  const parsed = parsePublicProviderEntityId(modelId)
  if (parsed && (parsed.provider !== 'claude' || parsed.kind !== 'model')) return undefined
  if (!parsed && modelId.startsWith('native:')) return undefined
  const base = LONG_CONTEXT.exec(parsed ? parsed.value : modelId)?.[1]
  if (!base) return undefined
  return parsed ? publicProviderEntityId('claude', 'model', base) : base
}

/**
 * The catalog's own entry for a model ID, under the entry's own ID: the exact entry when the catalog lists it,
 * otherwise its base model's when the ID is a 1M-context variant of one. Use it to find which entry a picker
 * marks as current, or to compare entries; use `resolveModel` for what the thread is on.
 */
export function catalogEntry<T extends { readonly id: string }>(models: readonly T[], modelId: string | null | undefined): T | undefined {
  if (!modelId) return undefined
  const exact = models.find(model => model.id === modelId)
  if (exact) return exact
  const base = baseModelId(modelId)
  return base === undefined ? undefined : models.find(model => model.id === base)
}

/**
 * The model a thread, default or setting is on, resolved against the catalog and carrying the ID it was asked
 * about, so selection and equality still hold: the catalog entry itself for an ID it lists, and for a variant it
 * does not, a copy of the base model's entry (its name, readiness, efforts and modes) under the variant's ID.
 * Undefined when neither the ID nor its base is in the catalog.
 */
export function resolveModel<T extends { readonly id: string }>(models: readonly T[], modelId: string | null | undefined): T | undefined {
  const entry = catalogEntry(models, modelId)
  return entry && modelId && entry.id !== modelId ? { ...entry, id: modelId } : entry
}

/**
 * The ID a press on a catalog entry leaves its owner on. When the pressed entry is the one an ID the owner holds is
 * shown on (the model in force, the one pressed before it, a default), the press keeps that ID, so choosing "Opus"
 * again never drops a thread from `opus[1m]` to `opus`; the first such ID wins. Any other entry is its own ID.
 */
export function chosenModelId<T extends { readonly id: string }>(models: readonly T[], pressedId: string, ...held: readonly (string | null | undefined)[]): string {
  return held.find(id => id && catalogEntry(models, id)?.id === pressedId) ?? pressedId
}
