import { hostEntityKey, parseHostEntityKey } from '../../../shared/clientIdentity'
import { defaultNewThreadModelId, hostForThread, type AgentProject, type AgentState, type AgentThread } from '../../../shared/agents'
import type { AgentConnection } from './AgentContext'
import { draftThread, UNCONFIRMED_CREATION } from './draftThreads'

/** A creation on its way, handed over the moment it is issued so the thread can be shown without waiting. */
export interface ThreadCreationStart {
  /** The local record for the ID this window minted, to show until main's state carries the thread. */
  readonly thread: AgentThread
  /** Resolves null once main has the thread, or with the reason main refused it. Never rejects. */
  readonly created: Promise<string | null>
}

/** A project's saved working-copy default, read fresh for each instant creation. */
async function projectWorkingCopy(state: AgentState, project: AgentProject): Promise<'independent' | 'shared'> {
  if (!window.sotto?.getSettings) return 'shared'
  const localHostId = state.connections ? state.connections.find(host => host.kind === 'local')?.hostId : state.hostId
  const defaultKey = (id: string): string => { const key = parseHostEntityKey(id); return key && key.hostId === localHostId ? key.id : id }
  try {
    const settings = await window.sotto.getSettings()
    return settings.projectThreadWorkingCopyDefaults[defaultKey(project.id)] || settings.threadWorkingCopyDefault
  } catch { return 'shared' }
}

/**
 * Open a new thread in `project` at once, on the defaults from Settings → Agents: the pen on a project row,
 * the empty Threads page's button and the project chooser all create the thread this way (issue #347). It
 * mints the thread's ID here so the caller can show it before main answers, exactly as the New thread dialog
 * did; a refusal resolves `created` with the reason and takes no local record with it.
 */
export async function beginNewThread(state: AgentState, command: AgentConnection['command'], project: AgentProject, managed = false): Promise<ThreadCreationStart | { readonly error: string }> {
  const projectHost = hostForThread(state.host, { hostId: project.hostId ?? parseHostEntityKey(project.id)?.hostId ?? state.hostId })
  const modelId = defaultNewThreadModelId(state.configuration, projectHost.models, state.reasoningAccounts)
  if (!modelId) return { error: 'No model is ready to start this thread. Connect a provider or choose one in Settings → Agents.' }
  const workingCopy = await projectWorkingCopy(state, project)
  const worktreeChoices = workingCopy === 'independent' ? { startFromOrigin: true } : {}
  const threadId = hostEntityKey(project.hostId ?? parseHostEntityKey(project.id)?.hostId ?? state.hostId, crypto.randomUUID())
  const title = 'New thread'
  const selectedModel = projectHost.models.find(model => model.id === modelId)
  const thread = draftThread({ id: threadId, projectId: project.id, title, modelId, workingCopy, ...worktreeChoices,
    ...(selectedModel?.providerId ? { providerId: selectedModel.providerId } : {}) })
  const created = command({ type: 'create-thread', threadId, projectId: project.id, title, modelId, titleSource: 'default', managed, workingCopy, ...worktreeChoices })
    .then(result => result === null ? UNCONFIRMED_CREATION : result.error, () => UNCONFIRMED_CREATION)
  return { thread, created }
}
