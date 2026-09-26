/**
 * Which catalog model a thread, a default or a setting is on. A thread keeps the model ID it was given, but a
 * provider's catalog need not list it: Claude Code lists `opus` and no longer `opus[1m]`, its long-context
 * variant, though it still runs `--model opus[1m]` (#344). An ID whose native part ends in a bracketed context
 * size (`[1m]`, `[200k]`) is that base model with more context, so it answers from the base model's entry.
 * Everything that asks what a model is called, whether it is ready, which efforts, modes and images it takes
 * reads it through here rather than matching IDs itself, so a variant is never mistaken for an unknown model.
 */

/** A native model ID's bracketed context size, and nothing looser: `opus[1m]`, not `opus[beta]` or `[1m]` alone. */
const CONTEXT_VARIANT = /^(.+)\[(\d+[km])\]$/iu
/** A public model ID (`publicProviderEntityId`): the native ID URI-encoded after the provider's prefix. */
const PUBLIC_MODEL_ID = /^(native:[a-z]+:model:)(.+)$/u

function decode(value: string): string | undefined {
  try { return decodeURIComponent(value) } catch { return undefined }
}

/** The base model's ID a long-context variant's ID names, in the same form, public or native; undefined for any other ID. */
export function baseModelId(modelId: string): string | undefined {
  const publicId = PUBLIC_MODEL_ID.exec(modelId)
  const native = publicId ? decode(publicId[2]!) : modelId
  const base = native === undefined ? null : CONTEXT_VARIANT.exec(native)?.[1]
  if (!base) return undefined
  return publicId ? publicId[1]! + encodeURIComponent(base) : base
}

/**
 * The catalog's own entry for a model ID: the exact entry when the catalog lists it, otherwise its base model's
 * when the ID is a long-context variant of one. Use it to mark the entry a picker shows as current.
 */
export function catalogModel<T extends { readonly id: string }>(models: readonly T[], modelId: string | null | undefined): T | undefined {
  if (!modelId) return undefined
  const exact = models.find(model => model.id === modelId)
  if (exact) return exact
  const base = baseModelId(modelId)
  return base === undefined ? undefined : models.find(model => model.id === base)
}

/**
 * The model a thread, default or setting is on: its catalog entry, carrying the ID asked about so selection and
 * equality still hold, and the base model's name, readiness, efforts and modes for a variant the catalog does not
 * list. Undefined when neither the ID nor its base is in the catalog.
 */
export function findModel<T extends { readonly id: string }>(models: readonly T[], modelId: string | null | undefined): T | undefined {
  const entry = catalogModel(models, modelId)
  return entry && modelId && entry.id !== modelId ? { ...entry, id: modelId } : entry
}

/**
 * The ID a press on a catalog entry leaves the owner on. Pressing the entry that `current` is already shown on
 * keeps `current`, so choosing "Opus" again never drops a thread from `opus[1m]` to `opus`; any other entry is
 * its own ID.
 */
export function chosenModelId<T extends { readonly id: string }>(models: readonly T[], pressedId: string, current: string | null | undefined): string {
  return current && catalogModel(models, current)?.id === pressedId ? current : pressedId
}
