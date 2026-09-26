import type { SottoPlatform } from '../../../shared/platform'
import { chordClaimed, chordMatches } from './branchToolbar.logic'
import { chordBelongsElsewhere } from '../tools/changesShortcut'

/** T3's chord for a new thread (issue #347): the focused thread's project, or the chooser when none is focused. */
export const NEW_THREAD_SHORTCUT = 'mod+shift+n'

/** The chord in the words a title, `aria-keyshortcuts` or a keydown listener reads it in, for one platform. */
export interface NewThreadChordLabel {
  /** Appended to whatever a button's own label says the press opens: "New thread (Ctrl+Shift+N)". */
  readonly suffix: string
  /** The Electron-accelerator spelling `aria-keyshortcuts` and a global hotkey both use, e.g. "Meta+Shift+N". */
  readonly keys: string
}

/** The chord New thread answers to under this dictation hotkey, or null when the hotkey already means it. */
export function newThreadChord(hotkey: string | undefined, platform: SottoPlatform): string | null {
  return chordClaimed(NEW_THREAD_SHORTCUT, hotkey, platform) ? NEW_THREAD_SHORTCUT : null
}

/**
 * The chord in the words a title or `aria-keyshortcuts` shows it in, for the platform it runs on, derived from
 * `NEW_THREAD_SHORTCUT` so the two can never drift apart. `suffix` is appended to whatever a button's own label
 * says the press opens ("New thread", "New thread here"), so every button that answers to the chord says so in
 * its own words rather than repeating one fixed title.
 */
export function newThreadChordLabel(platform: SottoPlatform): NewThreadChordLabel {
  const [, ...modifiersThenKey] = NEW_THREAD_SHORTCUT.split('+')
  const key = modifiersThenKey.at(-1)!.toUpperCase()
  const modifiers = modifiersThenKey.slice(0, -1).map(word => word[0]!.toUpperCase() + word.slice(1)).join('+')
  const mod = platform === 'darwin' ? 'Cmd' : 'Ctrl'
  return { suffix: `(${mod}+${modifiers}+${key})`, keys: `${platform === 'darwin' ? 'Meta' : 'Control'}+${modifiers}+${key}` }
}

/**
 * Whether a keydown opens New thread under `chord`: not already handled or repeating, actually the chord on
 * this platform, not typed into a terminal, and no dialog already open to answer Escape instead of this.
 */
export function newThreadChordPressed(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey' | 'defaultPrevented' | 'repeat' | 'target'>, chord: string, platform: SottoPlatform): boolean {
  if (event.defaultPrevented || event.repeat || !chordMatches(event, chord, platform) || chordBelongsElsewhere(event.target)) return false
  return document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') === null
}
