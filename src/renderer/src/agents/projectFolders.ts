import type { AgentProject } from '../../../shared/agents'
import { hostIdOf } from './HostBadge'

/** One key per folder on disk, so a project is never added twice under different spellings. */
export function folderKey(path: string): string {
  // Native Windows paths can arrive with either separator. POSIX paths retain case.
  const windows = /^[a-z]:[\\/]|^[\\/]{2}/i.test(path)
  const normalized = (windows ? path.replace(/\\/g, '/') : path).replace(/\/+$/, '')
  return windows ? normalized.toLowerCase() : normalized
}

/** The last segment of a folder path, for naming a project after it. */
export function folderName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || 'Project'
}

/** Whether a project lives on this host. A project that names no host belongs to the only host there is. */
export function projectOnHost(project: AgentProject, hostId: string): boolean {
  const owner = hostIdOf(project)
  return owner === undefined || owner === hostId
}

/** The project a folder on a host already is, if any. */
export function projectAtFolder(projects: readonly AgentProject[], hostId: string, path: string): AgentProject | undefined {
  return projects.find(project => projectOnHost(project, hostId) && folderKey(project.path) === folderKey(path))
}
