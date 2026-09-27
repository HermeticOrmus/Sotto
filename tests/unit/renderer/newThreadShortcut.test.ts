import { afterEach, describe, expect, it } from 'vitest'
import { newThreadChord, newThreadChordLabel, newThreadChordPressed } from '../../../src/renderer/src/agents/newThreadShortcut'

const chordEvent = (patch: Partial<{ key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean; defaultPrevented: boolean; repeat: boolean; target: EventTarget | null }> = {}) =>
  ({ key: 'n', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, defaultPrevented: false, repeat: false, target: document.body, ...patch })

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

describe('whether a keydown presses the chord (issue #347)', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('matches the chord on its own platform', () => {
    expect(newThreadChordPressed(chordEvent(), 'mod+shift+n', 'win32')).toBe(true)
    expect(newThreadChordPressed(chordEvent({ ctrlKey: false, metaKey: true }), 'mod+shift+n', 'darwin')).toBe(true)
  })
  it('ignores a different key or an already-handled or repeating keydown', () => {
    expect(newThreadChordPressed(chordEvent({ key: 'm' }), 'mod+shift+n', 'win32')).toBe(false)
    expect(newThreadChordPressed(chordEvent({ defaultPrevented: true }), 'mod+shift+n', 'win32')).toBe(false)
    expect(newThreadChordPressed(chordEvent({ repeat: true }), 'mod+shift+n', 'win32')).toBe(false)
  })
  it('ignores the chord typed into a terminal', () => {
    const terminal = document.createElement('div')
    terminal.className = 'xterm'
    document.body.appendChild(terminal)
    expect(newThreadChordPressed(chordEvent({ target: terminal }), 'mod+shift+n', 'win32')).toBe(false)
  })
  it('ignores the chord while a dialog is already open, which answers Escape instead', () => {
    const openDialog = document.createElement('dialog')
    openDialog.setAttribute('open', '')
    document.body.appendChild(openDialog)
    expect(newThreadChordPressed(chordEvent(), 'mod+shift+n', 'win32')).toBe(false)
  })
})
