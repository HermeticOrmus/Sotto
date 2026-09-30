// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FilesService } from '../../../src/main/files/service'
import { CheckpointService } from '../../../src/main/tools/checkpoints'
import type { CheckpointDependencies, CheckpointThread } from '../../../src/main/tools/checkpointTypes'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => { if (!result.ok) throw new Error(JSON.stringify(result)); return result.value }
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, windowsHide: true, encoding: 'utf8' })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sotto-checkpoint-unit-'))
  cleanup.push(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const repo = join(root, 'repo'); await mkdir(repo)
  git(repo, 'init', '-q'); git(repo, 'config', 'core.autocrlf', 'false'); git(repo, 'config', 'user.name', 'Sotto checkpoint fixture'); git(repo, 'config', 'user.email', 'fixture@example.invalid')
  await writeFile(join(repo, 'app.txt'), 'before\n'); await writeFile(join(repo, 'notes.txt'), 'original notes\n')
  git(repo, 'add', '.'); git(repo, '-c', 'commit.gpgSign=false', 'commit', '-qm', 'Fixture')
  const state: CheckpointThread = { threadId: 'thread-a', providerId: 'codex', bindingId: 'native-a', userMessageIds: [], busy: false, running: false, rollbackSupported: true }
  const second: CheckpointThread = { ...state, threadId: 'thread-b', bindingId: 'native-b', userMessageIds: [] }
  const files = new FilesService({ resolveBinding: threadId => ({ threadId, projectId: 'project', workingDirectory: repo }), copyPath: vi.fn(), reveal: vi.fn() })
  const rollback = vi.fn<CheckpointDependencies['rollback']>(async (_id, count, expected) => { state.userMessageIds = expected.slice(0, -count); return { accepted: true } })
  const refresh = vi.fn(async () => undefined)
  const dependencies: CheckpointDependencies = { files, directory: join(root, 'checkpoints'), resolveThread: async id => id === state.threadId ? { ...state } : id === second.threadId ? { ...second } : null, rollback, refresh }
  const service = new CheckpointService(dependencies); cleanup.push(async () => service.dispose())
  const owner = unwrap(await files.resolveWorkspace(state.threadId))
  const target = { threadId: state.threadId, workspaceId: owner.workspaceId }
  const complete = async () => {
    await service.beforeTurn(state.threadId)
    await writeFile(join(repo, 'app.txt'), 'after\n')
    await writeFile(join(repo, 'new.txt'), 'new file\n')
    state.userMessageIds = ['user-1']
    await service.afterTurn(state.threadId)
    const checkpoint = unwrap(await service.checkpoints(target)).checkpoints[0]!
    return { ...target, checkpointId: checkpoint.id }
  }
  return { root, repo, state, second, dependencies, service, target, complete, rollback, refresh }
}

describe('completed native turn checkpoints', () => {
  it('deletes forgotten checkpoints and shared blobs only after their last reference goes', async () => {
    const f = await fixture()
    await f.complete(); await f.service.beforeTurn('thread-b')
    await f.service.forgetThread('thread-a')
    expect(unwrap(await f.service.checkpoints(f.target)).checkpoints).toEqual([])
    expect((await readdir(join(f.dependencies.directory, 'blobs'))).length).toBeGreaterThan(0)
    await f.service.forgetThread('thread-b')
    expect(await readdir(join(f.dependencies.directory, 'blobs'))).toEqual([])
  })
  it('evicts the oldest checkpoint first when newer snapshots exceed the byte budget', async () => {
    const f = await fixture(); let now = Date.now(); f.dependencies.now = () => now
    const first = await f.complete(); now++
    await f.service.beforeTurn('thread-a')
    await writeFile(join(f.repo, 'app.txt'), 'newer snapshot contents\n')
    f.state.userMessageIds.push('user-2'); await f.service.afterTurn('thread-a')
    const directory = join(f.dependencies.directory, 'blobs')
    const bytes = (await Promise.all((await readdir(directory)).map(name => readFile(join(directory, name))))).reduce((total, data) => total + data.length, 0)
    f.dependencies.maxBytes = bytes + (await readFile(join(f.dependencies.directory, 'checkpoints.json'))).length - 1
    await f.service.privacyChanged()
    const records = unwrap(await f.service.checkpoints(f.target)).checkpoints
    expect(records).toHaveLength(1)
    expect(records[0]!.id).not.toBe(first.checkpointId)
    expect(unwrap(await f.service.inspectCheckpoint({ ...f.target, checkpointId: records[0]!.id })).patches[0]!.after).toBe('newer snapshot contents\n')
  })
  it('erases checkpoints when history is off and writes no new file snapshots', async () => {
    const f = await fixture(); let enabled = true
    f.dependencies.historyEnabled = () => enabled
    await f.complete(); enabled = false; await f.service.privacyChanged()
    await f.service.beforeTurn('thread-a')
    expect(unwrap(await f.service.checkpoints(f.target)).checkpoints).toEqual([])
    expect(await readdir(join(f.dependencies.directory, 'blobs'))).toEqual([])
    const restarted = new CheckpointService(f.dependencies); await restarted.initialize(); restarted.dispose()
    expect(await readdir(join(f.dependencies.directory, 'blobs'))).toEqual([])
  })
  it('prunes expired records and evicts oldest records to fit the shared blob budget', async () => {
    const f = await fixture(); let now = Date.now()
    f.dependencies.now = () => now
    await f.complete()
    now += 31 * 24 * 60 * 60 * 1000
    await f.service.privacyChanged()
    expect(unwrap(await f.service.checkpoints(f.target)).checkpoints).toEqual([])
    expect(await readdir(join(f.dependencies.directory, 'blobs'))).toEqual([])
    await f.service.beforeTurn('thread-a')
    f.dependencies.maxBytes = 0
    await f.service.privacyChanged()
    expect(await readdir(join(f.dependencies.directory, 'blobs'))).toEqual([])
  })

  it('never attributes edits made while Sotto was closed to a turn whose completion snapshot was interrupted', async () => {
    const f = await fixture()
    await f.service.beforeTurn('thread-a')
    await writeFile(join(f.repo, 'app.txt'), 'native turn edit\n')
    f.state.userMessageIds = ['user-1']
    f.service.dispose()
    await writeFile(join(f.repo, 'notes.txt'), 'unrelated offline edit\n')
    const restarted = new CheckpointService(f.dependencies); cleanup.push(async () => restarted.dispose())
    await restarted.initialize()
    const checkpoint = unwrap(await restarted.checkpoints(f.target)).checkpoints[0]!
    expect(checkpoint).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('interrupted') })
    expect(await restarted.revertCheckpoint({ ...f.target, checkpointId: checkpoint.id, confirmed: true })).toMatchObject({ ok: false })
    expect(f.rollback).not.toHaveBeenCalled()
    expect(await readFile(join(f.repo, 'notes.txt'), 'utf8')).toBe('unrelated offline edit\n')
  }, 20000)
  it('retries a failed load once access to the named storage file is restored', async () => {
    const f = await fixture(), path = join(f.dependencies.directory, 'checkpoints.json')
    await mkdir(path, { recursive: true })
    const restarted = new CheckpointService(f.dependencies); cleanup.push(async () => restarted.dispose())
    await expect(restarted.initialize()).rejects.toThrow(path)
    await rm(path, { recursive: true }); await writeFile(path, '[]')
    await restarted.initialize(); await restarted.beforeTurn('thread-a')
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ version: 1 })
  })
  it('refuses an expired checkpoint before calling native rollback between hourly sweeps', async () => {
    const f = await fixture(); let now = Date.now(); f.dependencies.now = () => now
    const request = await f.complete()
    now += 31 * 24 * 60 * 60 * 1000
    expect(await f.service.revertCheckpoint({ ...request, confirmed: true })).toMatchObject({ ok: false })
    expect(f.rollback).not.toHaveBeenCalled()
    expect(await readFile(join(f.repo, 'app.txt'), 'utf8')).toBe('after\n')
  })
  it('never rolls back native history if retention expires while checking a revert', async () => {
    const f = await fixture(), now = Date.now(); f.dependencies.now = () => now
    const request = await f.complete(); let saves = 0
    f.dependencies.now = () => ++saves === 1 ? now : now + 31 * 24 * 60 * 60 * 1000
    expect(await f.service.revertCheckpoint({ ...request, confirmed: true })).toMatchObject({ ok: false, error: { message: expect.stringContaining('No rollback was sent') } })
    expect(f.rollback).not.toHaveBeenCalled()
    expect(await readFile(join(f.repo, 'app.txt'), 'utf8')).toBe('after\n')
  })
  it('expires idle checkpoints on the hourly sweep without another turn or restart', async () => {
    const f = await fixture(); let now = Date.now(); f.dependencies.now = () => now
    await f.complete()
    vi.useFakeTimers()
    const restarted = new CheckpointService(f.dependencies)
    try {
      await restarted.initialize()
      const sweep = vi.spyOn(restarted, 'privacyChanged')
      now += 31 * 24 * 60 * 60 * 1000
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
      expect(sweep).toHaveBeenCalledOnce()
      await sweep.mock.results[0]!.value
      expect(unwrap(await restarted.checkpoints(f.target)).checkpoints).toEqual([])
      expect(await readdir(join(f.dependencies.directory, 'blobs'))).toEqual([])
    } finally { restarted.dispose(); vi.useRealTimers() }
  })
  it('backs up damaged JSON and keeps readable recovery journals without blocking unrelated sends', async () => {
    const f = await fixture(), request = await f.complete()
    f.rollback.mockResolvedValue({ accepted: false, uncertain: true })
    unwrap(await f.service.revertCheckpoint({ ...request, confirmed: true }))
    const path = join(f.dependencies.directory, 'checkpoints.json')
    const saved = JSON.parse(await readFile(path, 'utf8')) as { version: number; records: unknown[] }
    const damaged = JSON.stringify({ version: 1, records: [...saved.records, { bad: 'record' }] })
    await writeFile(path, damaged)
    const report = vi.fn(); f.dependencies.report = report
    const restarted = new CheckpointService(f.dependencies); cleanup.push(async () => restarted.dispose())
    await restarted.initialize()
    expect(restarted.isBlocked('thread-a')).toBe(true)
    const backup = (await readdir(f.dependencies.directory)).find(name => name.startsWith('checkpoints.json.corrupt-'))!
    expect(await readFile(join(f.dependencies.directory, backup), 'utf8')).toBe(damaged)
    expect(report).toHaveBeenCalledWith(expect.stringContaining(join(f.dependencies.directory, backup)))
    expect(unwrap(await restarted.checkpoints(f.target)).reason).toContain(backup)
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ version: 1, records: saved.records })
    expect(f.rollback).toHaveBeenCalledTimes(1)
    f.dependencies.historyEnabled = () => false
    await restarted.privacyChanged()
    expect(await readdir(f.dependencies.directory)).not.toContain(backup)
  })
  it('erases a recovery backup that contains a forgotten thread without discarding other checkpoints', async () => {
    const f = await fixture(); await f.complete(); await f.service.beforeTurn('thread-b')
    const directory = f.dependencies.directory, backup = join(directory, 'checkpoints.json.corrupt-fixture')
    await writeFile(backup, (await readFile(join(directory, 'checkpoints.json'), 'utf8')) + ' damaged tail')
    await f.service.forgetThread('thread-a')
    await expect(readFile(backup)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((JSON.parse(await readFile(join(directory, 'checkpoints.json'), 'utf8')) as { records: { threadId: string }[] }).records.map(record => record.threadId)).toEqual(['thread-b'])
  })
  it.each(['truncated tail', 'unclosed earlier record'])('salvages complete legacy records after a %s and upgrades the format', async damage => {
    const f = await fixture(); await f.complete()
    const path = join(f.dependencies.directory, 'checkpoints.json')
    const saved = JSON.parse(await readFile(path, 'utf8')) as { records: unknown[] }
    await writeFile(path, damage === 'truncated tail' ? `[${JSON.stringify(saved.records[0])},{"truncated":` : `[{"broken":,${JSON.stringify(saved.records[0])}`)
    const restarted = new CheckpointService(f.dependencies); cleanup.push(async () => restarted.dispose())
    await restarted.initialize()
    expect(unwrap(await restarted.checkpoints(f.target)).checkpoints).toHaveLength(1)
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ version: 1, records: saved.records })
  })
  it('recovers an unreadable file once and accepts fresh checkpoints without restarting', async () => {
    const f = await fixture()
    await mkdir(f.dependencies.directory, { recursive: true })
    await writeFile(join(f.dependencies.directory, 'checkpoints.json'), '{"truncated":')
    const restarted = new CheckpointService(f.dependencies); cleanup.push(async () => restarted.dispose())
    await restarted.initialize(); await restarted.beforeTurn('thread-a')
    expect(restarted.isBlocked('thread-a')).toBe(false)
    expect((await readdir(f.dependencies.directory)).filter(name => name.startsWith('checkpoints.json.corrupt-'))).toHaveLength(1)
  })
  it('refuses checkpoint attribution when two threads overlap in the same working copy', async () => {
    const f = await fixture()
    await f.service.beforeTurn('thread-a'); f.state.running = true
    await writeFile(join(f.repo, 'app.txt'), 'thread a\n')
    await f.service.beforeTurn('thread-b'); f.second.running = true
    await writeFile(join(f.repo, 'notes.txt'), 'thread b\n')
    f.state.running = false; f.state.userMessageIds = ['user-a']; await f.service.afterTurn('thread-a')
    f.second.running = false; f.second.userMessageIds = ['user-b']; await f.service.afterTurn('thread-b')
    const checkpoint = unwrap(await f.service.checkpoints(f.target)).checkpoints[0]!
    expect(checkpoint).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('overlapped') })
    expect(await f.service.revertCheckpoint({ ...f.target, checkpointId: checkpoint.id, confirmed: true })).toMatchObject({ ok: false, error: { code: 'blocked' } })
    expect(f.rollback).not.toHaveBeenCalled()
    expect(await readFile(join(f.repo, 'notes.txt'), 'utf8')).toBe('thread b\n')
  }, 20000)
  it('keeps file inspection available for Grok while refusing a file-only conversation rewind', async () => {
    const f = await fixture()
    f.state.providerId = 'grok'; f.state.rollbackSupported = false; f.state.unsupportedReason = 'Grok ACP does not support native conversation rollback.'
    const request = await f.complete()
    const review = unwrap(await f.service.inspectCheckpoint(request))
    expect(review.checkpoint).toMatchObject({ supported: false, reason: expect.stringContaining('Grok ACP') })
    expect(review.patches).toHaveLength(2)
    expect(await f.service.revertCheckpoint({ ...request, confirmed: true })).toMatchObject({ ok: false, error: { code: 'blocked' } })
    expect(f.rollback).not.toHaveBeenCalled()
    expect(await readFile(join(f.repo, 'app.txt'), 'utf8')).toBe('after\n')
  }, 20000)
  it('guards pending work, later file edits, staging and changed native history before any rollback', async () => {
    const f = await fixture(), request = await f.complete()
    f.state.busy = true
    expect(await f.service.revertCheckpoint({ ...request, confirmed: true })).toMatchObject({ ok: false, error: { code: 'blocked' } })
    f.state.busy = false
    const retainedBlobs = (await readdir(join(f.dependencies.directory, 'blobs'))).sort()
    await writeFile(join(f.repo, 'app.txt'), 'later independent edit\n')
    expect(await f.service.revertCheckpoint({ ...request, confirmed: true })).toMatchObject({ ok: false, error: { message: expect.stringContaining('Later edits') } })
    expect((await readdir(join(f.dependencies.directory, 'blobs'))).sort()).toEqual(retainedBlobs)
    await writeFile(join(f.repo, 'app.txt'), 'after\n'); git(f.repo, 'add', 'app.txt')
    expect(await f.service.revertCheckpoint({ ...request, confirmed: true })).toMatchObject({ ok: false, error: { message: expect.stringContaining('staging changed') } })
    git(f.repo, 'reset', '-q', 'HEAD', '--', 'app.txt')
    f.state.userMessageIds.push('external-user-message')
    expect(await f.service.revertCheckpoint({ ...request, confirmed: true })).toMatchObject({ ok: false, error: { message: expect.stringContaining('unchanged native history') } })
    expect(f.rollback).not.toHaveBeenCalled()
    expect(await readFile(join(f.repo, 'app.txt'), 'utf8')).toBe('after\n')
  }, 20000)
  it('holds an uncertain native outcome, blocks new work, and never retries the native mutation during recovery', async () => {
    const f = await fixture(), request = await f.complete()
    f.rollback.mockResolvedValue({ accepted: false, uncertain: true })
    expect(unwrap(await f.service.revertCheckpoint({ ...request, confirmed: true })).status).toBe('uncertain')
    expect(await f.service.isWorkspaceBlocked('thread-b')).toBe(true)
    await expect(f.service.beforeTurn('thread-a')).rejects.toThrow('interrupted checkpoint')
    expect(await f.service.recoverCheckpoint(request)).toMatchObject({ ok: false, error: { code: 'blocked' } })
    expect(f.rollback).toHaveBeenCalledTimes(1)
    expect(await readFile(join(f.repo, 'app.txt'), 'utf8')).toBe('after\n')
    f.state.userMessageIds = []
    expect(unwrap(await f.service.recoverCheckpoint(request)).status).toBe('reverted')
    expect(f.rollback).toHaveBeenCalledTimes(1)
  }, 20000)
  it('recovers a restart after native rollback without sending rollback twice', async () => {
    const f = await fixture(), request = await f.complete()
    f.refresh.mockRejectedValueOnce(new Error('process interrupted after native acceptance'))
    expect(await f.service.revertCheckpoint({ ...request, confirmed: true })).toMatchObject({ ok: false })
    expect(await readFile(join(f.repo, 'app.txt'), 'utf8')).toBe('after\n')
    expect(f.state.userMessageIds).toEqual([])
    f.service.dispose()
    const restarted = new CheckpointService(f.dependencies); cleanup.push(async () => restarted.dispose())
    await restarted.initialize()
    expect(restarted.isBlocked('thread-a')).toBe(true)
    expect(unwrap(await restarted.checkpoints(f.target)).checkpoints[0]?.status).toBe('uncertain')
    expect(unwrap(await restarted.recoverCheckpoint(request)).status).toBe('reverted')
    expect(f.rollback).toHaveBeenCalledTimes(1)
    expect(await readFile(join(f.repo, 'app.txt'), 'utf8')).toBe('before\n')
    expect(restarted.isBlocked('thread-a')).toBe(false)
  }, 20000)
  it('reviews exact before/after files and rewinds native history while preserving unrelated later edits', async () => {
    const f = await fixture(), request = await f.complete()
    const inspection = unwrap(await f.service.inspectCheckpoint(request))
    expect(inspection.checkpoint).toMatchObject({ threadId: 'thread-a', status: 'ready', supported: true, files: [{ path: 'app.txt', change: 'modified' }, { path: 'new.txt', change: 'added' }] })
    expect(inspection.patches[0]).toEqual({ path: 'app.txt', before: 'before\n', after: 'after\n', binary: false })
    await writeFile(join(f.repo, 'notes.txt'), 'my unrelated edit\n')
    expect(unwrap(await f.service.revertCheckpoint({ ...request, confirmed: true })).status).toBe('reverted')
    expect(f.rollback).toHaveBeenCalledExactlyOnceWith('thread-a', 1, ['user-1'])
    expect(await readFile(join(f.repo, 'app.txt'), 'utf8')).toBe('before\n')
    expect(await readFile(join(f.repo, 'notes.txt'), 'utf8')).toBe('my unrelated edit\n')
    await expect(readFile(join(f.repo, 'new.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(f.state.userMessageIds).toEqual([])
  }, 20000)
})
