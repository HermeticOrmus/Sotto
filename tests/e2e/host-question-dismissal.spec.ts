import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { HOSTS_CHANGED, HOSTS_COMMAND, type HostsCommand, type HostsState } from '../../src/shared/hosts'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import { requireOwnedE2EProfile } from '../../scripts/e2e-profile-policy.mjs'
import { closeSotto, launchSotto, openPage, resizeWindow } from './support/sottoLaunch'

test('Escape dismisses saved host questions and only Switch it off disables the host', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'sotto-e2e-host-question-'))
  await writeFile(join(profile, 'settings.json'), JSON.stringify({ ...DEFAULT_SETTINGS, onboardingComplete: true, localHostEnabled: false, reducedMotion: 'on' }))
  const launched = await launchSotto('success', profile)
  const shots = resolve('artifacts/review-pkg-23')
  await mkdir(shots, { recursive: true })
  try {
    const { page } = launched
    await openPage(page, 'Settings')
    // Script just the host transport, retaining the real preload and app-shell dialog.
    // No SSH process, sign-in, network connection or permission answer is involved.
    await launched.app.evaluate(({ ipcMain }, channel) => {
      const audit = globalThis as unknown as { hostQuestionCommands: unknown[] }
      audit.hostQuestionCommands = []
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, (_event, command: unknown) => { audit.hostQuestionCommands.push(command); throw new Error('Synthetic host command recorded') })
    }, HOSTS_COMMAND)
    const id = '33333333-3333-4333-8333-333333333333'
    for (const kind of ['passphrase', 'host-key'] as const) {
      const state: HostsState = {
        localHostEnabled: false, localHostRunning: false, localHostId: id, activeHostId: id,
        hosts: [{ id, name: 'forge', target: 'forge', identityFile: '', installPath: '/opt/sotto', dataDirectory: '/data', enabled: true, phase: 'connecting', prompt: { id: `${kind}-question`, kind, text: 'Synthetic SSH question' } }],
      }
      const send = async (): Promise<void> => {
        await launched.app.evaluate(({ BrowserWindow }, { channel, state }) => {
          BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith('/index.html'))!.webContents.send(channel, state)
        }, { channel: HOSTS_CHANGED, state })
      }
      await send()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      for (const [width, height] of [[1600, 1000], [1280, 800], [820, 560]] as const) {
        await resizeWindow(launched, width, height)
        for (const appearance of ['dark', 'light'] as const) {
          await page.evaluate(async appearance => window.sotto!.updateSettings({ appearance }), appearance)
          await expect(page.locator('html')).toHaveAttribute('data-theme', appearance)
          expect(await dialog.evaluate(element => {
            const box = element.getBoundingClientRect()
            return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight && element.scrollWidth <= element.clientWidth
          })).toBe(true)
          await page.screenshot({ path: join(shots, `host-${kind}-${width}-${appearance}.png`), animations: 'disabled' })
        }
      }
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      expect(await launched.app.evaluate(() => (globalThis as unknown as { hostQuestionCommands: HostsCommand[] }).hostQuestionCommands)).toEqual([])
      await send()
      await expect(dialog).toHaveCount(0)
      state.hosts[0]!.prompt = { ...state.hosts[0]!.prompt!, id: `${kind}-next-question` }
      await send()
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Switch it off' }).click()
      await expect.poll(() => launched.app.evaluate(() => (globalThis as unknown as { hostQuestionCommands: HostsCommand[] }).hostQuestionCommands)).toEqual([{ type: 'set-enabled', id, enabled: false }])
      await launched.app.evaluate(() => { (globalThis as unknown as { hostQuestionCommands: unknown[] }).hostQuestionCommands = [] })
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    }
  } finally {
    await closeSotto(launched)
    await rm(requireOwnedE2EProfile(profile), { recursive: true, force: true })
  }
})
