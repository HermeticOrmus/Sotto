// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { newThreadChord, newThreadChordLabel } from '../../../src/renderer/src/agents/newThreadShortcut'

describe('the new-thread shortcut (issue #347)', () => {
  it('claims Ctrl+Shift+N on Windows and Linux when the dictation hotkey does not already mean it', () => {
    expect(newThreadChord(undefined, 'win32')).toBe('mod+shift+n')
    expect(newThreadChord('CommandOrControl+Shift+Space', 'win32')).toBe('mod+shift+n')
  })
  it('claims Cmd+Shift+N on a Mac the same way', () => {
    expect(newThreadChord(undefined, 'darwin')).toBe('mod+shift+n')
    expect(newThreadChord('CommandOrControl+Shift+Space', 'darwin')).toBe('mod+shift+n')
  })
  it('yields the chord when the dictation hotkey already means it, on the platform it runs on', () => {
    expect(newThreadChord('Control+Shift+N', 'win32')).toBeNull()
    expect(newThreadChord('Command+Shift+N', 'darwin')).toBeNull()
    // The same accelerator spelled for the other platform's modifier does not collide.
    expect(newThreadChord('Command+Shift+N', 'win32')).toBe('mod+shift+n')
  })
  it('labels the chord in each platform’s own words', () => {
    expect(newThreadChordLabel('win32')).toEqual({ suffix: '(Ctrl+Shift+N)', keys: 'Control+Shift+N' })
    expect(newThreadChordLabel('darwin')).toEqual({ suffix: '(Cmd+Shift+N)', keys: 'Meta+Shift+N' })
  })
})
