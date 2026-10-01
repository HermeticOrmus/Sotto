import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentCommand, AgentState } from '../../../src/shared/agents'
import { E2E_THREADS_NOW } from '../../../src/shared/e2e'
import { ThreadComposer } from '../../../src/renderer/src/agents/ThreadComposer'
import { ThreadDraftStore } from '../../../src/renderer/src/agents/threadDraftStore'
import { describeThreads } from '../../../src/renderer/src/agents/threadFacts'
import { threadsStateFixture } from './liveAgentState'

afterEach(cleanup)

function fixture() {
  const state = threadsStateFixture()
  state.assignments = []
  state.host.threads.forEach(thread => { thread.requests = [] })
  state.queue = []
  const command = vi.fn<(request: AgentCommand) => Promise<AgentState | null>>(async () => state)
  const store = new ThreadDraftStore(command)
  const composer = (threadId = 'grok-previews') => <ThreadComposer
    row={describeThreads(state, E2E_THREADS_NOW).find(row => row.thread.id === threadId)!}
    state={state} command={command} store={store} onSend={vi.fn()} />
  return { state, command, store, composer }
}

describe('thread composer recovery', () => {
  it('keeps focus and text when a permission arrives, blocks edits and sends, then resumes editing', () => {
    const f = fixture()
    const view = render(f.composer())
    const prompt = screen.getByRole('textbox', { name: 'Prompt' })
    fireEvent.change(prompt, { target: { value: 'Keep this draft' } })
    prompt.focus()
    const thread = f.state.host.threads.find(thread => thread.id === 'grok-previews')!
    thread.requests = [{ id: 'permission', kind: 'permission', text: 'Allow this command?', options: [] }]
    view.rerender(f.composer())
    expect(prompt).not.toBeDisabled()
    expect(prompt).toHaveAttribute('readonly')
    expect(prompt).toHaveFocus()
    expect(prompt).toHaveValue('Keep this draft')
    fireEvent.change(prompt, { target: { value: 'Blocked edit' } })
    fireEvent.keyDown(prompt, { key: 'Enter' })
    expect(f.store.draft(thread.id).text).toBe('Keep this draft')
    expect(screen.getByRole('button', { name: 'Send prompt' })).toBeDisabled()
    expect(f.command.mock.calls.some(([request]) => request.type === 'manual-send' || request.type === 'answer')).toBe(false)
    thread.requests = []
    view.rerender(f.composer())
    expect(prompt).not.toHaveAttribute('readonly')
    expect(prompt).toHaveFocus()
    fireEvent.change(prompt, { target: { value: 'Continue typing' } })
    expect(f.store.draft(thread.id).text).toBe('Continue typing')
    f.store.flushAll()
  })
})
