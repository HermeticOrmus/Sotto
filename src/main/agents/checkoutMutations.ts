import { realpath } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { runWorktreeGit } from './threadWorktrees'
import { GitActionRefusal } from './gitActions'

/** One checkout, even through a subdirectory or an alias; linked worktrees remain independent. */
export async function checkoutIdentity(folder: string): Promise<string> {
  const root = await runWorktreeGit(folder, ['rev-parse', '--show-toplevel']).then(value => value.trim(), () => folder)
  // A missing owned worktree is restored on send. Resolve its existing parent rather than refusing before repair.
  let candidate = root
  const suffix: string[] = []
  let canonical: string
  for (;;) {
    try { canonical = join(await realpath(candidate), ...suffix); break }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '') || dirname(candidate) === candidate) throw error
      suffix.unshift(basename(candidate)); candidate = dirname(candidate)
    }
  }
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}

/** Sends may share a checkout, but a mutation excludes sends and other mutations from its first check to completion. */
export class CheckoutMutations {
  private readonly active = new Map<string, { sends: number; mutation: boolean }>()
  async isMutating(folder: string): Promise<boolean> {
    if (![...this.active.values()].some(state => state.mutation)) return false
    return this.active.get(await checkoutIdentity(folder))?.mutation === true
  }
  async acquire(folder: string, kind: 'send' | 'mutation'): Promise<() => void> {
    return this.acquireIdentity(await checkoutIdentity(folder), kind)
  }
  acquireIdentity(key: string, kind: 'send' | 'mutation'): () => void {
    const state = this.active.get(key) ?? { sends: 0, mutation: false }
    if (state.mutation || kind === 'mutation' && state.sends > 0) throw new GitActionRefusal('Wait for active or pending thread work before changing this checkout.')
    if (kind === 'mutation') state.mutation = true
    else state.sends++
    this.active.set(key, state)
    return () => {
      if (kind === 'mutation') state.mutation = false
      else state.sends--
      if (!state.mutation && state.sends === 0) this.active.delete(key)
    }
  }
}
