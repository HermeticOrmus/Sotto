import { mkdir } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { closeSotto, launchSotto, openPage, openThreads, paneMenuAction, type LaunchedSotto } from './support/sottoLaunch'

const ARTIFACTS = 'artifacts/command-receipt'

/**
 * Counts `AGENT_GET` reads in main. Electron keeps `ipcMain.handle` handlers in a private map; wrapping the
 * one for `sotto:agents:get` is the only way to see whether the page recovered a catalog, since the page
 * reaches it through `contextBridge` and cannot be observed from the window.
 */
async function countAgentReads(launched: LaunchedSotto): Promise<() => Promise<number>> {
  await launched.app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, (...args: unknown[]) => unknown> })._invokeHandlers
    const original = handlers?.get('sotto:agents:get')
    if (!handlers || !original) throw new Error('This Electron keeps its invoke handlers elsewhere; update the counter.')
    const counter = globalThis as unknown as { agentReads: number }
    counter.agentReads = 0
    handlers.set('sotto:agents:get', (...args: unknown[]) => { counter.agentReads++; return original(...args) })
  })
  return () => launched.app.evaluate(() => (globalThis as unknown as { agentReads: number }).agentReads)
}

/** A command sent through the preload's own bridge, as it crosses: the receipt before the page puts catalogs back. */
async function wireReceipt(page: Page): Promise<{ models: unknown; bytes: number; wholeBytes: number }> {
  return page.evaluate(async () => {
    const agents = window.sotto!.agents!
    const receipt = await agents.command({ type: 'observe-threads', threadIds: [] })
    const whole = await agents.get()
    return { models: receipt.host.models, bytes: JSON.stringify(receipt).length, wholeBytes: JSON.stringify(whole).length }
  })
}

test('drafts save, settings stay and a model can be picked after a reconnect, with command receipts', async () => {
  test.setTimeout(120_000)
  await mkdir(ARTIFACTS, { recursive: true })
  const launched = await launchSotto('phase3-workspace')
  const { page } = launched
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.evaluate(async () => {
      await window.sotto!.updateSettings({ onboardingComplete: true, appearance: 'dark' })
      await window.sotto!.agents!.command({ type: 'configure', patch: { enabled: true, speak: false } })
      await window.sotto!.agents!.command({ type: 'connect' })
    })
    await page.reload()
    await openThreads(page)
    const reads = await countAgentReads(launched)

    // The wire: a command's answer names the catalog by revision and lists no models.
    const wire = await wireReceipt(page)
    expect(wire.models).toEqual({ revision: expect.any(Number), omitted: true })
    console.info(`command receipt wire: ${JSON.stringify({ receiptBytes: wire.bytes, wholeStateBytes: wire.wholeBytes })}`)

    // 1. Type in a thread's composer and see the draft save.
    await page.getByRole('complementary', { name: 'Thread sidebar' }).getByRole('button', { name: 'Grok voice previews', exact: true }).click()
    const threadId = await page.evaluate(async () => (await window.sotto!.agents!.get()).host.threads.find(thread => thread.title === 'Grok voice previews')!.id)
    const input = page.locator('#thread-workspace-prompt')
    const before = await reads()
    await input.pressSequentially('Draft kept by a command receipt', { delay: 15 })
    // Draft saves are debounced; after this every save has answered, and none needed a read of the whole state.
    await page.waitForTimeout(1_500)
    const draftReads = await reads() - before
    await expect.poll(() => page.evaluate(async id => (await window.sotto!.agents!.get()).threadDrafts?.find(draft => draft.threadId === id)?.text, threadId))
      .toBe('Draft kept by a command receipt')
    await page.screenshot({ path: `${ARTIFACTS}/draft-saved.png`, animations: 'disabled' })
    await page.reload()
    await openThreads(page)
    await expect(page.locator('#thread-workspace-prompt')).toHaveValue('Draft kept by a command receipt')
    await expect(page.getByRole('alert')).toHaveCount(0)

    // 2. Change a setting and see the card keep it.
    await openPage(page, 'Settings')
    await page.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab', { name: 'Agents', exact: true }).click()
    const account = page.locator('#settings-agents').getByRole('combobox', { name: 'Reasoning account', exact: true })
    const chosen = await account.inputValue() === 'claude' ? 'codex' : 'claude'
    await account.selectOption(chosen)
    await expect.poll(async () => (await page.evaluate(async () => window.sotto!.agents!.get())).configuration.reasoning).toBe(chosen)
    await page.waitForTimeout(500)
    await expect(account).toHaveValue(chosen)
    await page.screenshot({ path: `${ARTIFACTS}/setting-kept.png`, animations: 'disabled' })

    // 3. Pick a model after the provider reconnects. The disconnect goes straight to main; the reconnect is the
    // pane's own Reconnect, so its receipt names a catalog revision the page has not been sent yet unless the
    // broadcast of it lands first.
    const revision = (): Promise<number> => page.evaluate(async () =>
      ((await window.sotto!.agents!.command({ type: 'observe-threads', threadIds: [] })).host.models as unknown as { revision: number }).revision)
    const connectedRevision = await revision()
    await page.evaluate(async () => { await window.sotto!.agents!.command({ type: 'disconnect' }) })
    const disconnectedRevision = await revision()
    await openThreads(page)
    const readsBeforeReconnect = await reads()
    await paneMenuAction(page, 'Reconnect')
    await expect(page.getByRole('button', { name: 'More actions', exact: true }).first()).toBeVisible()
    await page.waitForTimeout(1_000)
    const reconnectReads = await reads() - readsBeforeReconnect
    const reconnectedRevision = await revision()
    console.info(`catalog revisions across a reconnect: ${JSON.stringify({ connectedRevision, disconnectedRevision, reconnectedRevision, reconnectReads })}`)
    await openThreads(page)
    const readsBeforePick = await reads()
    await page.getByRole('button', { name: /^New thread in / }).first().click()
    const dialog = page.getByRole('dialog', { name: 'New thread', exact: true })
    await dialog.locator('summary').click()
    await dialog.getByRole('textbox', { name: 'Thread name' }).fill('Picked after reconnect')
    await dialog.getByRole('combobox', { name: 'Thread model' }).click()
    const picker = page.getByRole('dialog', { name: 'Choose model' })
    await expect(picker).toBeVisible()
    await picker.getByRole('tab', { name: 'Grok', exact: true }).click()
    await expect(picker.getByRole('option', { name: 'Grok 4.6', exact: true })).toBeEnabled()
    await page.screenshot({ path: `${ARTIFACTS}/model-picker-after-reconnect.png`, animations: 'disabled' })
    await picker.getByRole('option', { name: 'Grok 4.6', exact: true }).click()
    await expect(dialog.getByRole('combobox', { name: 'Thread model' })).toContainText('Grok 4.6')
    await dialog.getByRole('button', { name: 'Create thread', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const pickReads = await reads() - readsBeforePick
    await expect.poll(() => page.evaluate(async () => (await window.sotto!.agents!.get()).host.threads.find(thread => thread.title === 'Picked after reconnect')?.modelId))
      .toMatch(/grok:4$/)
    await page.screenshot({ path: `${ARTIFACTS}/thread-on-picked-model.png`, animations: 'disabled' })
    console.info(`AGENT_GET reads: ${JSON.stringify({ whileTyping: draftReads, whileReconnecting: reconnectReads, whilePicking: pickReads })}`)
    expect(draftReads).toBe(0)
    expect(reconnectedRevision).toBeGreaterThan(disconnectedRevision)
    expect(errors).toEqual([])
  } finally { await closeSotto(launched) }
})
