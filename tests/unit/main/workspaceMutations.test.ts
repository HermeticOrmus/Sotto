// @vitest-environment node
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { workspaceFixture } from '../../fixtures/workspaceFixture'
import { runWorktreeGit as git } from '../../../src/main/agents/threadWorktrees'
import { GitActions } from '../../../src/main/agents/gitActions'
import { WorktreeCleanup } from '../../../src/main/agents/worktreeCleanup'
import { DEFAULT_WORKTREE_CLEANUP } from '../../../src/shared/settings'
import { GitStatusReader } from '../../../src/main/agents/gitStatus'
import { CheckoutMutations } from '../../../src/main/agents/checkoutMutations'

async function fixture() {
  const f = await workspaceFixture()
  const snapshot = await f.host.connect()
  const project = snapshot.projects.find(item => item.providerId === 'codex')!
  const model = snapshot.models.find(item => item.providerId === 'codex')!
  await git(project.path, ['init', '-b', 'main'])
  await writeFile(join(project.path, 'file.txt'), 'baseline')
  await git(project.path, ['add', '.'])
  await git(project.path, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Baseline'])
  for (const id of ['a', 'b']) await f.host.execute({ type: 'create-thread', commandId: id, threadId: id, projectId: project.id, modelId: model.id, title: id })
  return { ...f, project }
}
function barrier() {
  let release!: () => void, enter!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const entered = new Promise<void>(resolve => { enter = resolve })
  return { held, entered, release, enter }
}
const send = (id: string) => ({ type: 'send' as const, threadId: id, commandId: `send-${id}`, messageId: `message-${id}`, text: 'Work' })

it('holds a checkout throughout a Git action and refuses a sibling send and branch restore without desktop checkpoint wiring', async () => {
  const f = await fixture(), pause = barrier()
  let action: Promise<unknown> | undefined
  try {
    f.host.setGitActions({ runStackedAction: async () => { pause.enter(); await pause.held; throw new Error('Draft failed') } } as unknown as GitActions)
    action = f.host.runGitAction({ threadId: 'a', actionId: 'commit', action: 'commit' })
    await pause.entered
    await expect(f.host.execute(send('b'))).rejects.toThrow('A Git action is running in this folder. Your message was not sent. Send it again when the action finishes.')
    await expect(f.host.restoreThreadBranch('b', true)).rejects.toThrow(/Wait for/)
    expect(f.adapters.codex.commands.some(command => command.type === 'send')).toBe(false)
    pause.release(); await action
    await expect(f.host.execute(send('b'))).resolves.toMatchObject({ accepted: true })
  } finally { pause.release(); await action; await f.stop(); await f.remove() }
})

it('refuses branch restore while a sibling turn is working', async () => {
  const f = await fixture()
  try {
    await f.host.execute(send('b'))
    f.adapters.codex.state.threads.at(-1)!.status = 'idle'; f.adapters.codex.emit()
    await f.host.execute(send('a'))
    await git(f.project.path, ['switch', '-c', 'feature'])
    await expect(f.host.restoreThreadBranch('b', true)).rejects.toThrow(/Wait for/)
    expect((await git(f.project.path, ['branch', '--show-current'])).trim()).toBe('feature')
  } finally { await f.stop(); await f.remove() }
})

it('reserves a checkout before a sibling send can pass an asynchronous guard', async () => {
  const f = await fixture(), pause = barrier()
  let action: Promise<unknown> | undefined
  try {
    f.host.setMutationGuard(async () => { pause.enter(); await pause.held; return true })
    f.host.setGitActions({ pull: vi.fn(async () => ({ status: 'already_up_to_date' })) } as unknown as GitActions)
    action = f.host.pullThreadBranch('a')
    await pause.entered
    await expect(f.host.execute(send('b'))).rejects.toThrow(/Wait for/)
    pause.release(); await action
  } finally { pause.release(); await action; await f.stop(); await f.remove() }
})

it('uses the checkout root for subdirectories and releases reservations on refusal', async () => {
  const f = await fixture(), mutations = new CheckoutMutations()
  try {
    const nested = join(f.project.path, 'nested'); await mkdir(nested)
    const release = await mutations.acquire(nested, 'mutation')
    await expect(mutations.acquire(f.project.path, 'send')).rejects.toThrow('Wait for')
    const other = await mutations.acquire(join(f.root, 'claude'), 'mutation'); other()
    release()
    const sendRelease = await mutations.acquire(f.project.path, 'send'); sendRelease()
    f.host.setPendingThreadWork(id => id === 'b')
    await expect(f.host.pullThreadBranch('a')).rejects.toThrow('Wait for')
    expect(await f.host.isCheckoutMutating('a')).toBe(false)
  } finally { await f.stop(); await f.remove() }
})

it('refuses Git while a sibling first send is pending in a previous worktree', async () => {
  const f = await fixture()
  try {
    const model = f.host.workspaceSnapshot().models.find(item => item.providerId === 'codex')!
    await f.host.execute({ type: 'create-thread', commandId: 'c', threadId: 'c', projectId: f.project.id, modelId: model.id, title: 'c', workingCopy: 'independent' })
    await f.host.execute(send('c'))
    for (const thread of f.adapters.codex.state.threads) thread.status = 'idle'
    f.adapters.codex.emit()
    await vi.waitFor(() => expect(f.host.workspaceSnapshot().threads.find(thread => thread.id === 'c')?.status).toBe('idle'))
    const copy = f.host.workspaceSnapshot().threads.find(thread => thread.id === 'c')!.worktree!
    await f.host.execute({ type: 'create-thread', commandId: 'd', threadId: 'd', projectId: f.project.id, modelId: model.id, title: 'd', workingCopy: 'independent', existingWorktreePath: copy.path! })
    const pull = vi.fn(async () => ({ status: 'already_up_to_date' }))
    f.host.setGitActions({ pull } as unknown as GitActions)
    f.host.setPendingThreadWork(id => id === 'd')
    await expect(f.host.pullThreadBranch('c')).rejects.toThrow('Wait for')
    expect(pull).not.toHaveBeenCalled()
    expect(await f.host.isCheckoutMutating('c')).toBe(false)
    f.host.setPendingThreadWork(() => false)
    const release = await f.host.acquireCheckoutMutation('c')
    try {
      await expect(f.host.execute(send('d'))).rejects.toThrow('Wait for')
      expect(f.host.workspaceSnapshot().threads.find(thread => thread.id === 'd')?.worktree?.path).toBeUndefined()
    } finally { release() }
  } finally { await f.stop(); await f.remove() }
})

it('refuses Git while a sibling send is still awaiting provider acknowledgement', async () => {
  const f = await fixture(), pause = barrier()
  let sending: Promise<unknown> | undefined
  try {
    const original = f.adapters.codex.execute.bind(f.adapters.codex)
    vi.spyOn(f.adapters.codex, 'execute').mockImplementation(async command => {
      if (command.type === 'send') { pause.enter(); await pause.held }
      return original(command)
    })
    sending = f.host.execute(send('b'))
    await pause.entered
    await expect(f.host.pullThreadBranch('a')).rejects.toThrow('Wait for')
    pause.release(); await sending
  } finally { pause.release(); await sending; await f.stop(); await f.remove() }
})

it('restores a deleted owned worktree for a project subdirectory and holds its root during send', async () => {
  const f = await fixture(), pause = barrier()
  let sending: Promise<unknown> | undefined
  try {
    const nested = join(f.project.path, 'nested'); await mkdir(nested)
    await writeFile(join(nested, 'app.txt'), 'committed project')
    await git(f.project.path, ['add', '.'])
    await git(f.project.path, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Nested project'])
    await f.host.execute({ type: 'create-project', provider: 'codex', commandId: 'subproject', projectId: 'subproject', title: 'Nested', path: nested })
    const snapshot = f.host.workspaceSnapshot()
    const model = snapshot.models.find(item => item.providerId === 'codex')!
    const project = snapshot.projects.find(item => item.path === nested)!
    await f.host.execute({ type: 'create-thread', commandId: 'c', threadId: 'c', projectId: project.id, modelId: model.id, title: 'c', workingCopy: 'independent' })
    await f.host.execute(send('c'))
    for (const thread of f.adapters.codex.state.threads) thread.status = 'idle'
    f.adapters.codex.emit()
    const copy = f.host.workspaceSnapshot().threads.find(thread => thread.id === 'c')!.worktree!
    await f.host.execute({ type: 'create-thread', commandId: 'd', threadId: 'd', projectId: f.project.id, modelId: model.id, title: 'd', workingCopy: 'independent', existingWorktreePath: copy.path! })
    await f.host.execute(send('d'))
    for (const thread of f.adapters.codex.state.threads) thread.status = 'idle'
    f.adapters.codex.emit()
    await vi.waitFor(() => expect(f.host.workspaceSnapshot().threads.filter(thread => ['c', 'd'].includes(thread.id)).every(thread => thread.status === 'idle')).toBe(true))
    if (!copy.path?.startsWith(f.root)) throw new Error('Unexpected owned fixture path')
    await rm(copy.path, { recursive: true })
    const original = f.adapters.codex.execute.bind(f.adapters.codex)
    vi.spyOn(f.adapters.codex, 'execute').mockImplementation(async command => {
      if (command.type === 'send') { pause.enter(); await pause.held }
      return original(command)
    })
    sending = f.host.execute({ ...send('c'), commandId: 'send-c-again', messageId: 'message-c-again' })
    await pause.entered
    await expect(f.host.pullThreadBranch('d')).rejects.toThrow('Wait for')
    pause.release(); await sending
    expect((await git(copy.path, ['branch', '--show-current'])).trim()).toBe(copy.branch)
  } finally { pause.release(); await sending; await f.stop(); await f.remove() }
})


it.each(['reclaim', 'settle'] as const)('rechecks a merged commit inside the lane before %s after a queued commit action', async kind => {
  const f = await fixture(), pause = barrier(), queued = barrier()
  let action: Promise<unknown> | undefined, sweep: Promise<void> | undefined
  try {
    const model = f.host.workspaceSnapshot().models.find(item => item.providerId === 'codex')!
    await f.host.execute({ type: 'create-thread', commandId: 'c', threadId: 'c', projectId: f.project.id, modelId: model.id, title: 'c', workingCopy: 'independent' })
    await f.host.execute(send('c'))
    for (const thread of f.adapters.codex.state.threads) thread.status = 'idle'
    f.adapters.codex.emit()
    await vi.waitFor(() => expect(f.host.workspaceSnapshot().threads.find(thread => thread.id === 'c')?.status).toBe('idle'))
    const copy = f.host.workspaceSnapshot().threads.find(thread => thread.id === 'c')!.worktree!
    const tip = (await git(copy.path!, ['rev-parse', 'HEAD'])).trim()
    await git(f.project.path, ['config', 'user.name', 'Fixture'])
    await git(f.project.path, ['config', 'user.email', 'fixture@example.invalid'])
    await git(f.project.path, ['config', 'commit.gpgSign', 'false'])
    await writeFile(join(copy.path!, 'file.txt'), 'new unmerged work')
    f.host.setGitActions(new GitActions({ status: new GitStatusReader({ fetchIntervalMs: () => 0 }),
      writeCommitMessage: async () => { pause.enter(); await pause.held; return 'Keep new unmerged work' }, writePullRequestText: async () => null }))
    action = f.host.runGitAction({ threadId: 'c', actionId: 'commit', action: 'commit' })
    await pause.entered
    const host = { workspaceSnapshot: () => f.host.workspaceSnapshot(), subscribe: f.host.subscribe.bind(f.host),
      reclaimThreadWorktree: (...args: Parameters<typeof f.host.reclaimThreadWorktree>) => { queued.enter(); return f.host.reclaimThreadWorktree(...args) },
      setWorkspaceSettled: (...args: Parameters<typeof f.host.setWorkspaceSettled>) => { queued.enter(); return f.host.setWorkspaceSettled(...args) } }
    sweep = new WorktreeCleanup({ host, rules: () => ({ ...DEFAULT_WORKTREE_CLEANUP, merged: kind === 'reclaim' }),
      autoSettleMerged: () => kind === 'settle', pullRequestMerged: async () => true }).sweep()
    await queued.entered
    pause.release(); await action; await sweep
    expect(f.host.workspaceSnapshot().threads.find(thread => thread.id === 'c')?.gitAction?.status).toBe('done')
    expect((await git(f.project.path, ['rev-parse', `refs/heads/${copy.branch}`])).trim()).not.toBe(tip)
    expect(f.host.workspaceSnapshot().threads.find(thread => thread.id === 'c')?.worktree?.reclaimedAt).toBeUndefined()
    expect(f.host.workspaceSnapshot().threads.find(thread => thread.id === 'c')?.workspaceSettledAt ?? null).toBeNull()
    expect((await stat(copy.path!)).isDirectory()).toBe(true)
  } finally { pause.release(); await action; await sweep; await f.stop(); await f.remove() }
}, 60_000)
