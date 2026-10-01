import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentCommand } from '../../../src/shared/agents'
import { ThreadSidebar } from '../../../src/renderer/src/agents/ThreadSidebar'
import { describeThreads, organizeWorkspace } from '../../../src/renderer/src/agents/threadFacts'
import { threadsStateFixture } from './liveAgentState'

afterEach(cleanup)

it.each(['Keep folder', 'Escape', 'Remove worktree'])('keeps the settle question after its sidebar row disappears, then handles %s', async answer => {
  const initial = threadsStateFixture()
  const target = { ...initial.host.threads.find(thread => thread.id === 'grok-previews')!,
    worktree: { mode: 'independent' as const, status: 'ready' as const, path: 'C:/owned/worktree', branch: 'sotto/test', dirty: false },
    nativeSessionStarted: true }
  initial.host.threads = [target]
  const command = vi.fn<(request: AgentCommand) => Promise<typeof initial>>()
  function Sidebar() {
    const [state, setState] = useState(initial)
    command.mockImplementation(async request => {
      if (request.type === 'settle-thread') setState({ ...state, host: { ...state.host, threads: [{ ...target, workspaceSettledAt: new Date().toISOString() }] } })
      return { ...state, worktreeReclaimPreview: { path: target.worktree.path, branch: target.worktree.branch, dirty: false, ignored: [], items: [], repositories: [], untracked: [] } }
    })
    return <ThreadSidebar state={state} command={command} organization={organizeWorkspace(state, describeThreads(state, Date.now()), '', state.activeProjectId)}
      query="" onQuery={vi.fn()} onOpen={vi.fn()} onNewThread={vi.fn()} currentThreadId={target.id} openThreadIds={[target.id]} onOpenBeside={vi.fn()} onDragThread={vi.fn()} />
  }
  render(<Sidebar />)
  const settle = screen.getByRole('button', { name: `Settle ${target.title}` })
  settle.focus()
  fireEvent.click(settle)
  const dialog = await screen.findByRole('dialog', { name: 'Remove its worktree too?' })
  expect(settle).not.toBeInTheDocument()
  expect(dialog).toBeVisible()
  expect(screen.getByRole('button', { name: 'Keep folder' })).toHaveFocus()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Remove worktree' })).toBeEnabled())
  if (answer === 'Escape') fireEvent.keyDown(document, { key: 'Escape' })
  else fireEvent.click(screen.getByRole('button', { name: answer }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.getByRole('button', { name: 'Settled 1 thread' })).toHaveFocus())
  expect(command.mock.calls.filter(([request]) => request.type === 'reclaim-thread-worktree')).toHaveLength(answer === 'Remove worktree' ? 1 : 0)
})
