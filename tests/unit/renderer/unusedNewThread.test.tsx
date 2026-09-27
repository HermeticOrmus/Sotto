import { describe, expect, it } from 'vitest'
import { unusedNewThread } from '../../../src/renderer/src/agents/newThread'
import { defaultAgentConfiguration, type AgentState, type AgentThread } from '../../../src/shared/agents'

const project = { id: 'project', title: 'Project', path: 'C:/project' }
const thread = (patch: Partial<AgentThread>): AgentThread => ({ id: 'thread', projectId: project.id, title: 'New thread', titleSource: 'default',
  modelId: 'codex:model', status: 'idle', requests: [], messages: [], ...patch })
const state = (threads: AgentThread[]): AgentState => ({
  configuration: defaultAgentConfiguration(), host: { projects: [project], threads, models: [] } } as unknown as AgentState)

/** Pressing New thread twice, or by accident, should not leave empty threads behind (#347). */
describe('an unused new thread', () => {
  it('is found when the project already has one that was never used', () => {
    expect(unusedNewThread(state([thread({})]), project)?.id).toBe('thread')
  })

  it('is not a thread that has been used, renamed, is running, settled or elsewhere', () => {
    const used = [
      thread({ messages: [{ id: 'm', role: 'user', text: 'Hello', createdAt: '2026-09-26T00:00:00.000Z' }] }),
      thread({ summary: { messageCount: 3 } as AgentThread['summary'] }),
      thread({ titleSource: 'user', title: 'Named' }),
      thread({ titleSource: 'generated', title: 'Fix the build' }),
      thread({ status: 'running' }),
      thread({ settledAt: '2026-09-26T00:00:00.000Z' }),
      thread({ projectId: 'elsewhere' }),
    ]
    for (const candidate of used) expect(unusedNewThread(state([candidate]), project)).toBeUndefined()
  })
})
