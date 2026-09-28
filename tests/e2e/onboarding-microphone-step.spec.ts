import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeSotto, launchSotto, resizeWindow } from './support/sottoLaunch'

for (const skip of [false, true]) {
  test(`onboarding resolves the microphone step before continuing (${skip ? 'explicit skip' : 'successful test'})`, async () => {
    test.setTimeout(120_000)
    const launched = await launchSotto(skip ? 'microphone-denied-once' : 'success')
    const { page } = launched
    const evidence = resolve('artifacts/review-386')
    await mkdir(evidence, { recursive: true })
    try {
      await page.evaluate(async () => window.sotto!.updateSettings({ reducedMotion: 'on' }))
      await page.getByRole('button', { name: 'Continue', exact: true }).click()
      const next = page.getByRole('button', { name: 'Continue', exact: true })
      await expect(next).toBeDisabled()
      await expect(page.getByText(/Test your microphone or choose Skip for now to continue/)).toBeVisible()
      if (skip) {
        await page.getByRole('button', { name: 'Test microphone', exact: true }).click()
        await expect(page.getByText('Microphone access is blocked.', { exact: true })).toBeVisible()
        await expect(next).toBeDisabled()
        await expect(page.getByRole('button', { name: 'Try microphone again' })).toBeEnabled()
      }
      for (const [width, height] of [[1600, 1000], [1280, 800], [820, 560]] as const) {
        await resizeWindow(launched, width, height)
        for (const appearance of ['dark', 'light'] as const) {
          await page.evaluate(async appearance => window.sotto!.updateSettings({ appearance }), appearance)
          await expect(page.locator('html')).toHaveAttribute('data-theme', appearance)
          await next.scrollIntoViewIfNeeded()
          await expect(next).toBeInViewport()
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
          await page.screenshot({ path: resolve(evidence, `${skip ? 'denied' : 'untested'}-${width}-${appearance}.png`) })
        }
      }
      // Keyboard activation keeps the existing Test / Skip actions and four-step focus flow.
      const action = page.getByRole('button', { name: skip ? 'Skip for now' : 'Test microphone', exact: true })
      await action.focus()
      await page.keyboard.press('Enter')
      if (!skip) await expect(page.getByText(/Microphone ready/)).toBeVisible()
      await expect(next).toBeEnabled()
      await next.focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('heading', { name: 'Connect your OpenRouter key' })).toBeFocused()
      await page.getByRole('button', { name: 'Back', exact: true }).click()
      await expect(next).toBeEnabled()
      await next.click()
      await next.click()
      await expect(page.getByRole('button', { name: 'Finish setup' })).toBeEnabled()
      await page.getByRole('button', { name: 'Finish setup' }).click()
      await expect(page.getByRole('complementary', { name: 'Thread sidebar', exact: true })).toBeVisible()
      expect(await page.evaluate(async () => {
        const settings = await window.sotto!.getSettings()
        return { completed: settings.onboardingComplete, skipped: settings.microphoneSkipped, key: settings.llmApiKey }
      })).toEqual({ completed: true, skipped: skip, key: '' })
      await page.reload()
      await expect(page.getByRole('complementary', { name: 'Thread sidebar', exact: true })).toBeVisible()
    } finally { await closeSotto(launched) }
  })
}
