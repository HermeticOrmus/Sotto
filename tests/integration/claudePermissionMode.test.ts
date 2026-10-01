// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentRuntimeMode } from '../../src/shared/agents'
import { claudeFixture } from '../fixtures/claudeFixture'

/**
 * The CLI's system/init frame names the permission mode the process is actually in. A match lets the
 * turn reach a tool. A mismatch stops the turn before that tool runs. A mode Sotto itself changes is
 * the mode the next init is compared with.
 */
describe('Claude permission mode check', () => {
  let f: Awaited<ReturnType<typeof claudeFixture>>
  beforeEach(async () => {
    f = await claudeFixture()
    await f.host.connect()
    await f.host.execute({ type: 'create-project', commandId: randomUUID(), projectId: f.projectId, title: 'Project', path: f.root })
  })
  afterEach(async () => { await f.cleanup() })

  const thread = async (id: string) => (await f.host.snapshot()).threads.find(candidate => candidate.id === id)!
  const records = () => f.driver.requests()
  async function create(runtimeMode: AgentRuntimeMode): Promise<string> {
    const id = randomUUID()
    expect((await f.host.execute({ type: 'create-thread', commandId: randomUUID(), threadId: id, projectId: f.projectId, title: 'Mode', modelId: f.modelId, runtimeMode })).accepted).toBe(true)
    return id
  }
  async function send(id: string): Promise<void> {
    expect(await f.host.execute({ type: 'send', commandId: 'send', messageId: 'prompt', threadId: id, text: 'Run the check' })).toEqual({ accepted: true })
  }

  it('lets the turn proceed when Claude reports the mode Sotto launched', async () => {
    const id = await create('auto')
    await writeFile(join(f.root, 'script.json'), JSON.stringify({ tool: true }))
    await send(id)
    await expect.poll(async () => (await records()).some(record => record.method === 'tool-armed')).toBe(true)
    expect((await thread(id)).requests).toHaveLength(1)
    expect((await records()).some(record => record.method === 'interrupt')).toBe(false)
    expect((await f.host.snapshot()).error ?? '').not.toMatch(/wrapper script/u)
  })

  it('stops the turn before any tool runs when Claude reports a different mode', async () => {
    const id = await create('auto')
    await writeFile(join(f.root, 'script.json'), JSON.stringify({ tool: true, permissionMode: 'bypassPermissions' }))
    await send(id)
    await expect.poll(async () => {
      const seen = await records()
      return seen.some(record => record.method === 'tool-skipped' || record.method === 'tool-armed')
    }).toBe(true)
    const seen = await records()
    const notice = (await f.host.snapshot()).error ?? ''
    expect(notice).toContain('Full access')
    expect(notice).toContain('asked for Auto')
    expect(notice).toContain('wrapper script or managed settings')
    expect(notice).toContain('Nothing ran')
    expect(seen.some(record => f.protocol!.permissionDecision(record) === true)).toBe(false)
    expect(seen.some(record => record.method === 'interrupt')).toBe(true)
    if (seen.some(record => record.method === 'tool-armed')) expect(seen.some(record => f.protocol!.permissionDecision(record) === false)).toBe(true)
    expect((await thread(id)).requests).toEqual([])
    expect((await thread(id)).activities).toContainEqual(expect.objectContaining({ kind: 'turn', status: 'failed', error: expect.stringContaining('Nothing ran') }))
  })

  it('does not trip when Sotto changed the permission mode', async () => {
    const id = await create('approval-required')
    expect((await f.host.execute({ type: 'configure-thread', commandId: 'config', threadId: id, runtimeMode: 'auto-accept-edits' })).accepted).toBe(true)
    expect((await thread(id)).runtimeMode).toBe('auto-accept-edits')
    await writeFile(join(f.root, 'script.json'), JSON.stringify({ tool: true }))
    await send(id)
    await expect.poll(async () => (await records()).some(record => record.method === 'tool-armed')).toBe(true)
    expect((await thread(id)).requests).toHaveLength(1)
    expect((await records()).some(record => record.method === 'interrupt')).toBe(false)
    expect((await f.host.snapshot()).error ?? '').not.toMatch(/wrapper script/u)
  })
})
