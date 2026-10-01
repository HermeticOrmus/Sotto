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
  const shots = resolve('artifacts/renderer-other-bundle-run')
  await mkdir(shots, { recursive: true })
  try {
    const { page } = launched
    await openPage(page, 'Settings')
    await page.getByRole('tab', { name: 'Hosts', exact: true }).click()
    // Script just the host transport, retaining the real preload and app-shell dialog.
    // No SSH process, sign-in, network connection or permission answer is involved.
    await launched.app.evaluate(({ ipcMain }, { channel, changedChannel }) => {
      const audit = globalThis as unknown as { hostQuestionCommands: HostsCommand[]; hostQuestionState: HostsState }
      audit.hostQuestionCommands = []
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, (event, command: HostsCommand) => {
        audit.hostQuestionCommands.push(command)
        if (command.type === 'ssh-answer') {
          const state = { ...audit.hostQuestionState, hosts: audit.hostQuestionState.hosts.map(host => {
            const next = { ...host }
            delete next.prompt
            return next
          }) }
          event.sender.send(changedChannel, state)
          return state
        }
        throw new Error('Synthetic host command recorded')
      })
    }, { channel: HOSTS_COMMAND, changedChannel: HOSTS_CHANGED })
    const id = '33333333-3333-4333-8333-333333333333'
    for (const kind of ['passphrase', 'host-key'] as const) {
      const state: HostsState = {
        localHostEnabled: false, localHostRunning: false, localHostId: id, activeHostId: id,
        hosts: [{ id, name: 'forge', target: 'forge', identityFile: '', installPath: '/opt/sotto', dataDirectory: '/data', enabled: true, phase: 'connecting', prompt: { id: `${kind}-question`, kind, text: 'Synthetic SSH question' } }],
      }
      const send = async (): Promise<void> => {
        await launched.app.evaluate(({ BrowserWindow }, { channel, state }) => {
          (globalThis as unknown as { hostQuestionState: HostsState }).hostQuestionState = state
          BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith('/index.html'))!.webContents.send(channel, state)
        }, { channel: HOSTS_CHANGED, state })
      }
      await send()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(kind === 'host-key' ? dialog.getByRole('button', { name: 'Trust host' }) : dialog.getByLabel('Key passphrase')).toBeFocused()
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
          await page.keyboard.press('Escape')
          const row = page.getByRole('region', { name: 'forge', exact: true })
          await expect(row.getByText('Waiting for your answer', { exact: true })).toBeVisible()
          await expect(row.getByRole('button', { name: 'Answer forge' })).toBeFocused()
          expect(await row.evaluate(element => {
            const box = element.getBoundingClientRect()
            return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight && element.scrollWidth <= element.clientWidth
          })).toBe(true)
          await page.screenshot({ path: join(shots, `host-answer-${width}-${appearance}.png`), animations: 'disabled' })
          await row.getByRole('button', { name: 'Answer forge' }).click()
          await expect(dialog).toBeVisible()
          await expect(kind === 'host-key' ? dialog.getByRole('button', { name: 'Trust host' }) : dialog.getByLabel('Key passphrase')).toBeFocused()
        }
      }
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      expect(await launched.app.evaluate(() => (globalThis as unknown as { hostQuestionCommands: HostsCommand[] }).hostQuestionCommands)).toEqual([])
      await send()
      await expect(dialog).toHaveCount(0)
      const row = page.getByRole('region', { name: 'forge', exact: true })
      await row.getByRole('button', { name: 'Answer forge' }).click()
      if (kind === 'passphrase') await dialog.getByLabel('Key passphrase').fill('synthetic')
      await dialog.getByRole('button', { name: kind === 'host-key' ? 'Trust host' : 'Continue', exact: true }).click()
      expect(await launched.app.evaluate(() => (globalThis as unknown as { hostQuestionCommands: HostsCommand[] }).hostQuestionCommands)).toEqual([{ type: 'ssh-answer', id, promptId: `${kind}-question`, answer: kind === 'host-key' ? 'yes' : 'synthetic' }])
      await expect(dialog).toHaveCount(0)
      await expect(row.getByRole('button', { name: 'Answer forge' })).toHaveCount(0)
      await expect(row.getByText('Waiting for your answer', { exact: true })).toHaveCount(0)
      await launched.app.evaluate(() => { (globalThis as unknown as { hostQuestionCommands: unknown[] }).hostQuestionCommands = [] })
      state.hosts[0]!.prompt = { ...state.hosts[0]!.prompt!, id: `${kind}-next-question` }
      await send()
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Switch it off' }).click()
      await expect.poll(() => launched.app.evaluate(() => (globalThis as unknown as { hostQuestionCommands: HostsCommand[] }).hostQuestionCommands)).toEqual([{ type: 'set-enabled', id, enabled: false }])
      await launched.app.evaluate(() => { (globalThis as unknown as { hostQuestionCommands: unknown[] }).hostQuestionCommands = [] })
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    }
    // Off the Hosts page, queued questions restore the page's control without adding a notice.
    const previous = page.getByRole('tab', { name: 'Dictation', exact: true })
    await previous.click()
    await previous.focus()
    const queued: HostsState = {
      localHostEnabled: false, localHostRunning: false, localHostId: id, activeHostId: id,
      hosts: ['forge', 'spark'].map((name, index) => ({
        id: index === 0 ? id : '44444444-4444-4444-8444-444444444444', name, target: name,
        identityFile: '', installPath: '/opt/sotto', dataDirectory: '/data', enabled: true, phase: 'connecting',
        prompt: { id: `${name}-queued`, kind: index === 0 ? 'password' : 'host-key', text: 'Synthetic queued question' },
      })),
    }
    await launched.app.evaluate(({ BrowserWindow }, { channel, state }) => {
      BrowserWindow.getAllWindows().find(item => item.webContents.getURL().endsWith('/index.html'))!.webContents.send(channel, state)
    }, { channel: HOSTS_CHANGED, state: queued })
    await expect(page.getByRole('dialog', { name: 'Unlock the SSH connection to forge' }).getByLabel('SSH password')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Trust the SSH host spark?' }).getByRole('button', { name: 'Trust host' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(previous).toBeFocused()
    for (const status of await page.getByText('Waiting for your answer', { exact: true }).all()) await expect(status).toBeHidden()
    await expect(page.getByRole('button', { name: /^Answer (forge|spark)$/ })).toHaveCount(0)
    expect(await launched.app.evaluate(() => (globalThis as unknown as { hostQuestionCommands: HostsCommand[] }).hostQuestionCommands)).toEqual([])
  } finally {
    await closeSotto(launched)
    await rm(requireOwnedE2EProfile(profile), { recursive: true, force: true })
  }
})
