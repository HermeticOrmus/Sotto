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

export type CheckoutHolder = { kind: 'git-action' | 'automatic-pull' | 'checkpoint-revert' | 'settle' | 'remove-folder' }
  | { kind: 'send' | 'turn' | 'pending-work'; threadId: string; title: string }

function holdingMessage(holder: CheckoutHolder): string {
  switch (holder.kind) {
    case 'automatic-pull': return 'Sotto is pulling this folder.'
    case 'checkpoint-revert': return 'Sotto is reverting a checkpoint in this folder.'
    case 'remove-folder': return 'Sotto is removing this folder.'
    case 'settle': return 'Sotto is settling a thread in this folder.'
    case 'send': return `A message is being sent in thread "${holder.title}" in this folder.`
    case 'turn': return `Thread "${holder.title}" is working in this folder.`
    case 'pending-work': return `Thread "${holder.title}" has work waiting in this folder.`
    case 'git-action': return 'A Git action is running in this folder.'
  }
}
export function checkoutMutationRefusal(holder: CheckoutHolder): GitActionRefusal {
  return new GitActionRefusal(`${holdingMessage(holder)} ${holder.kind === 'automatic-pull' || holder.kind === 'settle'
    ? 'Try again in a moment.' : 'Wait for it to finish before changing this folder.'}`)
}

/** A definitive refusal before the provider receives a prompt. Queue delivery supplies its own recovery copy. */
export class CheckoutSendRefusal extends Error {
  constructor(private readonly holder: CheckoutHolder = { kind: 'git-action' }) {
    super(`${holdingMessage(holder)} Your message was not sent. Send it again when the action finishes.`)
  }
  queuedMessage(): string { return `${holdingMessage(this.holder)} Your follow-up was not sent. It is kept in the queue. Resume the queue when the action finishes.` }
}

/** Sends may share a checkout, but a mutation excludes sends and other mutations from its first check to completion. */
export class CheckoutMutations {
  private readonly active = new Map<string, { reads: Set<CheckoutHolder>; mutation: CheckoutHolder | null }>()
  async isMutating(folder: string): Promise<boolean> {
    if (![...this.active.values()].some(state => state.mutation)) return false
    return Boolean(this.active.get(await checkoutIdentity(folder))?.mutation)
  }
  async acquire(folder: string, kind: 'send' | 'mutation', holder?: CheckoutHolder): Promise<() => void> {
    return this.acquireIdentity(await checkoutIdentity(folder), kind, holder)
  }
  acquireIdentity(key: string, kind: 'send' | 'mutation', holder: CheckoutHolder = { kind: 'git-action' }): () => void {
    const state = this.active.get(key) ?? { reads: new Set<CheckoutHolder>(), mutation: null }
    const held = state.mutation ?? (kind === 'mutation' ? state.reads.values().next().value : undefined)
    if (held) throw kind === 'send' ? new CheckoutSendRefusal(held) : checkoutMutationRefusal(held)
    if (kind === 'mutation') state.mutation = holder
    else state.reads.add(holder)
    this.active.set(key, state)
    return () => {
      if (kind === 'mutation') state.mutation = null
      else state.reads.delete(holder)
      if (!state.mutation && state.reads.size === 0) this.active.delete(key)
    }
  }
}
