import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Questionnaire, emptyQuestionnaire } from '../../../src/renderer/src/features/memory/Questionnaire'

afterEach(cleanup)

it('exposes the questionnaire step as a named status as the user advances', () => {
  const props = { draft: emptyQuestionnaire, onChange: vi.fn(), onSave: vi.fn(async () => true), onLater: vi.fn(), busy: false, error: '' }
  const { rerender } = render(<Questionnaire {...props} />)
  expect(screen.getByRole('status', { name: 'Step 1 of 9' })).toHaveTextContent('1 / 9')
  rerender(<Questionnaire {...props} draft={{ ...emptyQuestionnaire, step: 1 }} />)
  expect(screen.getByRole('status', { name: 'Step 2 of 9' })).toHaveTextContent('2 / 9')
})
