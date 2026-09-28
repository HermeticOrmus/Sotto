import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useRevisionDraft } from '../../../src/renderer/src/features/settings/useRevisionDraft'

function draft(initial = '') {
  return renderHook(({ authoritative }) => useRevisionDraft(authoritative, authoritative), { initialProps: { authoritative: initial } })
}

describe('revision-aware settings drafts', () => {
  it('preserves the newest edit through ordered acknowledgements of several blur saves', () => {
    const { result, rerender } = draft()
    act(() => { result.current.edit('A'); result.current.begin('A', true) })
    act(() => { result.current.edit('B'); result.current.begin('B', true) })
    act(() => { result.current.edit('C') })
    rerender({ authoritative: 'A' })
    expect(result.current.value).toBe('C')
    rerender({ authoritative: 'B' })
    expect(result.current.value).toBe('C')
    act(() => { result.current.begin('C', true) })
    rerender({ authoritative: 'C' })
    expect(result.current.value).toBe('C')
  })

  it('keeps external authority when an older receipt or failure arrives later', () => {
    const { result, rerender } = draft()
    act(() => { result.current.edit('A') })
    const submission = result.current.begin('A')!
    rerender({ authoritative: 'External' })
    expect(result.current.isLatest(submission)).toBe(false)
    rerender({ authoritative: 'A' })
    expect(result.current.value).toBe('External')
    act(() => { result.current.fail(submission, true) })
    expect(result.current.value).toBe('External')
  })

  it('retains failed dictionary text for retry and suppresses duplicate or unchanged commits', () => {
    const { result } = draft()
    expect(result.current.begin('', true)).toBeNull()
    act(() => { result.current.edit('Sotto') })
    const submission = result.current.begin('Sotto', true)!
    expect(result.current.begin('Sotto', true)).toBeNull()
    act(() => { result.current.fail(submission, false) })
    expect(result.current.read()).toBe('Sotto')
    expect(result.current.begin('Sotto', true)).not.toBeNull()
  })

  it('restores a failed numeric edit only while it still owns the draft', () => {
    const { result } = renderHook(() => useRevisionDraft(200, '200'))
    act(() => { result.current.edit('300') })
    const first = result.current.begin(300)!
    act(() => { result.current.edit('400') })
    const second = result.current.begin(400)!
    act(() => { result.current.fail(first, true) })
    expect(result.current.value).toBe('400')
    act(() => { result.current.fail(second, true) })
    expect(result.current.value).toBe('200')
  })

  it('saves a return to the current authoritative value while a different save is queued', () => {
    const { result, rerender } = draft()
    act(() => { result.current.edit('A'); result.current.begin('A', true) })
    act(() => { result.current.edit('') })
    expect(result.current.begin('', true)).not.toBeNull()
    rerender({ authoritative: 'A' })
    expect(result.current.value).toBe('')
    rerender({ authoritative: '' })
    expect(result.current.value).toBe('')
  })

  it('matches canonical shortcut receipts while leaving its display formatting to the caller', () => {
    const accept = vi.fn()
    const { result, rerender } = renderHook(({ authoritative, display }) => useRevisionDraft(authoritative, display, accept),
      { initialProps: { authoritative: 'CommandOrControl+M', display: 'Ctrl+M' } })
    act(() => { result.current.edit('Ctrl+N') })
    result.current.begin('CommandOrControl+N')
    rerender({ authoritative: 'CommandOrControl+N', display: 'Ctrl+N' })
    expect(result.current.value).toBe('Ctrl+N')
    expect(accept).toHaveBeenCalledTimes(2)
  })

  it('renders once per edit and adds no render when a submission is recorded or a retained draft fails', () => {
    let renders = 0
    const { result } = renderHook(() => { renders += 1; return useRevisionDraft('', '') })
    const initial = renders
    act(() => { result.current.edit('Sotto') })
    expect(renders - initial).toBe(1)
    const submission = result.current.begin('Sotto', true)!
    expect(renders - initial).toBe(1)
    act(() => { result.current.fail(submission, false) })
    expect(renders - initial).toBe(1)
  })
})