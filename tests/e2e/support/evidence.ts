import { basename, resolve } from 'node:path'

/** Keep named journeys separate when a runner requests disposable captures instead of their usual evidence. */
export function evidenceDirectory(defaultDirectory: string): string {
  const root = process.env.SOTTO_E2E_ARTIFACT_ROOT
  return root ? resolve(root, basename(defaultDirectory)) : resolve(defaultDirectory)
}
