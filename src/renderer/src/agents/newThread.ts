import { hostEntityKey, parseHostEntityKey } from '../../../shared/clientIdentity'
import { defaultNewThreadModelId, hostForThread, type AgentProject, type AgentState, type AgentThread } from '../../../shared/agents'
import { resolveModel } from '../../../shared/modelCatalog'
import { nearestReasoningEffort, resolveNewThreadPermission } from '../../../shared/newThreadDefaults'
import type { AgentConnection } from './AgentContext'
import { draftThread, UNCONFIRMED_CREATION } from './draftThreads'

/** A creation on its way, handed over the moment it is issued so the thread can be shown without waiting. */
export interface ThreadCreationStart {
  /** The local record for the ID this window minted, to show until main's state carries the thread. */
  readonly thread: AgentThread
  /** Resolves null once main has the thread, or with the reason main refused it. Never rejects. */
  readonly created: Promise<string | null>
}

/** The host a project's own entities belong to, and a new thread in it with them. */
function projectHostId(state: AgentState, project: AgentProject): string | undefined {
  return project.hostId ?? parseHostEntityKey(project.id)?.hostId ?? state.hostId
}

/** What creation says when Settings would not say which working copy a thread starts in. */
export const WORKING_COPY_READ_ERROR = 'Could not read your working-copy default from Settings → Agents. Check your connection and try again.'

/**
 * A project's saved working-copy default, read fresh for each creation; rejects when Settings cannot say,
 * so a thread is never opened in a working copy the user did not choose.
 */
export async function projectWorkingCopy(state: AgentState, project: AgentProject): Promise<'independent' | 'shared'> {
  if (!window.sotto?.getSettings) return 'shared'
  const localHostId = state.connections ? state.connections.find(host => host.kind === 'local')?.hostId : state.hostId
  const defaultKey = (id: string): string => { const key = parseHostEntityKey(id); return key && key.hostId === localHostId ? key.id : id }
  const settings = await window.sotto.getSettings()
  return settings.projectThreadWorkingCopyDefaults[defaultKey(project.id)] || settings.threadWorkingCopyDefault
}

/**
 * Open a new thread in `project` at once, on the defaults from Settings → Agents: the pen on a project row,
 * the empty Threads page's button and the project chooser all create the thread this way (issue #347). It
 * mints the thread's ID here so the caller can show it before main answers, exactly as the New thread dialog
 * did; a refusal resolves `created` with the reason and takes no local record with it. The effort and permission
 * shown on the draft are resolved with the same shared helpers main uses for the create-thread it dispatches
 * (`newThreadDefaults.ts`), so the chips read the Settings defaults from the first frame instead of the
 * provider's own defaults until main's snapshot arrives.
 */
/**
 * A thread the project already has that was opened and never used: still on its default title, nothing sent, at rest
 * and not settled. New thread returns to it instead of leaving another empty thread behind (#347), so a press made by
 * accident, or twice, costs nothing.
 */
export function unusedNewThread(state: AgentState, project: AgentProject): AgentThread | undefined {
  return state.host.threads.find(thread => thread.projectId === project.id && thread.titleSource === 'default' && thread.status === 'idle'
    && !thread.settledAt && !thread.archivedAt && (thread.summary?.messageCount ?? thread.messages.length) === 0)
}

export async function beginNewThread(state: AgentState, command: AgentConnection['command'], project: AgentProject, managed = false): Promise<ThreadCreationStart | { readonly error: string }> {
  const projectHost = hostForThread(state.host, { hostId: projectHostId(state, project) })
  const modelId = defaultNewThreadModelId(state.configuration, projectHost.models, state.reasoningAccounts)
  if (!modelId) return { error: 'No model is ready to start this thread. Connect a provider or choose one in Settings → Agents.' }
  let workingCopy: 'independent' | 'shared'
  try { workingCopy = await projectWorkingCopy(state, project) }
  catch { return { error: WORKING_COPY_READ_ERROR } }
  const worktreeChoices = workingCopy === 'independent' ? { startFromOrigin: true } : {}
  const threadId = hostEntityKey(projectHostId(state, project), crypto.randomUUID())
  const title = 'New thread'
  // A long-context variant the catalog does not list (`opus[1m]`) answers from its base model's entry.
  const selectedModel = resolveModel(projectHost.models, modelId)
  const configuration = state.configuration
  let reasoningEffort: string | undefined
  if (configuration.newThreadReasoningEffort) {
    const reference = resolveModel(projectHost.models, configuration.newThreadModelId)?.reasoningEfforts ?? selectedModel?.reasoningEfforts ?? []
    reasoningEffort = nearestReasoningEffort(configuration.newThreadReasoningEffort, reference, selectedModel?.reasoningEfforts ?? [])
  }
  const permission = resolveNewThreadPermission(selectedModel, configuration.newThreadRuntimeMode)
  const thread = draftThread({ id: threadId, projectId: project.id, title, modelId, workingCopy, ...worktreeChoices,
    ...(selectedModel?.providerId ? { providerId: selectedModel.providerId } : {}),
    reasoningEffort: reasoningEffort ?? selectedModel?.defaultReasoningEffort, runtimeMode: permission.runtimeMode, providerMode: permission.providerMode })
  const created = command({ type: 'create-thread', threadId, projectId: project.id, title, modelId, titleSource: 'default', managed, workingCopy, ...worktreeChoices })
    .then(result => result === null ? UNCONFIRMED_CREATION : result.error, () => UNCONFIRMED_CREATION)
  return { thread, created }
}
