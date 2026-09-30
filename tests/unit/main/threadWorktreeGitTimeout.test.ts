// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { exec } = vi.hoisted(() => ({ exec: vi.fn((_file: string, _args: string[], _options: { timeout: number }, callback: (error: Error | null, stdout: string, stderr: string) => void) => { if (typeof callback === 'function') callback(null, '', ''); return {} }) }))
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), execFile: exec }))
vi.mock('../../../src/main/agents/subscriptionCodex', () => ({ nativeEnvironment: () => ({ ...process.env }) }))
import { runWorktreeGit } from '../../../src/main/agents/threadWorktrees'

beforeEach(() => exec.mockClear())
describe('worktree Git process deadlines', () => {
  it('gives a large checkout five minutes while keeping ordinary Git commands bounded', async () => {
    await runWorktreeGit('.', ['worktree', 'add', '--', 'folder', 'branch'])
    expect(exec.mock.calls[0]![2].timeout).toBe(300_000)
    await runWorktreeGit('.', ['status', '--porcelain'])
    expect(exec.mock.calls[1]![2].timeout).toBe(30_000)
  })
  it('marks a deadline kill so setup can clean up its own incomplete checkout', async () => {
    exec.mockImplementationOnce((_file, _args, _options, callback) => { callback(Object.assign(new Error('Killed'), { killed: true, signal: 'SIGTERM' }), '', ''); return {} })
    await expect(runWorktreeGit('.', ['worktree', 'add', '--', 'folder', 'branch'])).rejects.toMatchObject({ timedOut: true })
  })
})
