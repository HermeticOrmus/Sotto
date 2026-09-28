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
    act(() => { result.current.settle(submission, false, true) })
    expect(result.current.value).toBe('External')
  })

  it('retains failed dictionary text for retry and suppresses duplicate or unchanged commits', () => {
    const { result } = draft()
    expect(result.current.begin('', true)).toBeNull()
    act(() => { result.current.edit('Sotto') })
    const submission = result.current.begin('Sotto', true)!
    expect(result.current.begin('Sotto', true)).toBeNull()
    act(() => { result.current.settle(submission, false, false) })
    expect(result.current.read()).toBe('Sotto')
    expect(result.current.begin('Sotto', true)).not.toBeNull()
  })

  it('restores a failed numeric edit only while it still owns the draft', () => {
    const { result } = renderHook(() => useRevisionDraft(200, '200'))
    act(() => { result.current.edit('300') })
    const first = result.current.begin(300)!
    act(() => { result.current.edit('400') })
    const second = result.current.begin(400)!
    act(() => { result.current.settle(first, false, true) })
    expect(result.current.value).toBe('400')
    act(() => { result.current.settle(second, false, true) })
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
    act(() => { result.current.settle(submission, false, false) })
    expect(renders - initial).toBe(1)
  })
})
it('does not resurrect an ignored acknowledgement when a later edit fails', () => {
  const { result, rerender } = draft()
  act(() => { result.current.edit('A'); result.current.begin('A') })
  rerender({ authoritative: 'External' })
  rerender({ authoritative: 'A' })
  expect(result.current.value).toBe('External')
  act(() => { result.current.edit('B') })
  const next = result.current.begin('B')!
  act(() => { result.current.settle(next, false, true) })
  expect(result.current.value).toBe('External')
})

it('uses an accepted receipt as the rollback target while a newer edit is still unsaved', () => {
  const { result, rerender } = draft()
  act(() => { result.current.edit('A'); result.current.begin('A') })
  act(() => { result.current.edit('B') })
  rerender({ authoritative: 'A' })
  expect(result.current.value).toBe('B')
  const next = result.current.begin('B')!
  act(() => { result.current.settle(next, false, true) })
  expect(result.current.value).toBe('A')
})

it('commits an explicit return to a value whose old receipt was superseded', () => {
  const { result, rerender } = draft()
  act(() => { result.current.edit('A'); result.current.begin('A', true) })
  rerender({ authoritative: 'External' })
  rerender({ authoritative: 'A' })
  act(() => { result.current.edit('A') })
  expect(result.current.begin('A', true)).not.toBeNull()
})

it('accepts successful same-value commits without waiting for a prop change', () => {
  const { result, rerender } = draft()
  act(() => { result.current.edit('A'); result.current.begin('A') })
  rerender({ authoritative: 'External' })
  rerender({ authoritative: 'A' })
  act(() => { result.current.edit('A') })
  const returned = result.current.begin('A')!
  act(() => { result.current.settle(returned, true, true) })
  act(() => { result.current.edit('B') })
  const failed = result.current.begin('B')!
  act(() => { result.current.settle(failed, false, true) })
  expect(result.current.value).toBe('A')
})

it('does not accept a successful result from a superseded authority generation', () => {
  const { result, rerender } = draft()
  act(() => { result.current.edit('A') })
  const old = result.current.begin('A')!
  rerender({ authoritative: 'External' })
  rerender({ authoritative: 'A' })
  act(() => { result.current.settle(old, true, true); result.current.edit('B') })
  const failed = result.current.begin('B')!
  act(() => { result.current.settle(failed, false, true) })
  expect(result.current.value).toBe('External')
})
