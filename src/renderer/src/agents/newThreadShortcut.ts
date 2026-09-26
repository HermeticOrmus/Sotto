import type { SottoPlatform } from '../../../shared/platform'
import { chordClaimed } from './branchToolbar.logic'

/** T3's chord for a new thread (issue #347): the focused thread's project, or the chooser when none is focused. */
export const NEW_THREAD_SHORTCUT = 'mod+shift+n'

/** The chord New thread answers to under this dictation hotkey, or null when the hotkey already means it. */
export function newThreadChord(hotkey: string | undefined, platform: SottoPlatform): string | null {
  return chordClaimed(NEW_THREAD_SHORTCUT, hotkey, platform) ? NEW_THREAD_SHORTCUT : null
}

/**
 * The chord in the words a title or `aria-keyshortcuts` shows it in, for the platform it runs on. `suffix` is
 * appended to whatever a button's own label says the press opens ("New thread", "New thread here"), so every
 * button that answers to the chord says so in its own words rather than repeating one fixed title.
 */
export function newThreadChordLabel(platform: SottoPlatform): { readonly suffix: string; readonly keys: string } {
  const mod = platform === 'darwin' ? 'Cmd' : 'Ctrl'
  return { suffix: `(${mod}+Shift+N)`, keys: platform === 'darwin' ? 'Meta+Shift+N' : 'Control+Shift+N' }
}
