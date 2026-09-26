// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { attachmentSizeBytes } from '../../src/shared/agents'
import { closeSotto, launchSotto, openThreads, type LaunchedSotto } from '../e2e/support/sottoLaunch'
import { pasteDrawnScreenshot, type DrawnScreenshot } from '../fixtures/drawnScreenshot'
import { median, PERF_BENCH, round } from '../fixtures/perfBench'

const RUNS = 5
const MB = 1024 * 1024

interface Run { readonly ms: number, readonly fileBytes: number, readonly sentBytes: number, readonly sent: { width: number, height: number } }

/** Pastes `screenshot` into the Workshop thread's composer, reads back what its draft holds, and removes it again. */
async function pasteOnce({ page }: LaunchedSotto, screenshot: DrawnScreenshot): Promise<Run> {
  const prompt = page.getByRole('textbox', { name: 'Prompt', exact: true })
  const { ms, fileBytes } = await pasteDrawnScreenshot(prompt, screenshot)
  let dataUrl: string | undefined
  await expect.poll(async () => {
    const state = await page.evaluate(async () => window.sotto!.agents!.get())
    dataUrl = state.threadDrafts?.flatMap(draft => draft.attachments).find(attachment => attachment.name === screenshot.name)?.dataUrl
    return dataUrl !== undefined
  }, { timeout: 30_000 }).toBe(true)
  // Sizes only: the pixel size the window decodes from the data URL, and its decoded byte count.
  const sent = await page.evaluate(async source => {
    const image = new Image()
    image.src = source
    await image.decode()
    return { width: image.naturalWidth, height: image.naturalHeight }
  }, dataUrl!)
  await page.getByRole('button', { name: `Remove ${screenshot.name}`, exact: true }).click()
  await expect.poll(async () => page.getByAltText(screenshot.name, { exact: true }).count()).toBe(0)
  return { ms, fileBytes, sentBytes: attachmentSizeBytes(dataUrl!), sent }
}

async function measure(launched: LaunchedSotto, label: string, screenshot: Omit<DrawnScreenshot, 'name'>) {
  const extension = screenshot.type === 'image/png' ? 'png' : 'jpg'
  await pasteOnce(launched, { ...screenshot, name: `warm.${extension}` })
  const runs: Run[] = []
  for (let index = 0; index < RUNS; index += 1) runs.push(await pasteOnce(launched, { ...screenshot, name: `run-${index}.${extension}` }))
  const report = {
    label,
    fileMB: round(runs[0]!.fileBytes / MB, 2),
    sentMB: round(runs[0]!.sentBytes / MB, 2),
    sent: `${runs[0]!.sent.width}x${runs[0]!.sent.height}`,
    medianMs: round(median(runs.map(run => run.ms))),
  }
  console.log(`screenshot resize: ${JSON.stringify(report)}`)
  return report
}

// Launches the built app and pastes drawn screenshots into a thread's composer. It asserts no time, so it runs only
// under `SOTTO_PERF_BENCH=1` (`tests/fixtures/perfBench.ts`), after `npm run build`:
//   SOTTO_PERF_BENCH=1 npx vitest run tests/perf/screenshotResize.perf.test.ts --maxWorkers=1 --disable-console-intercept
// `SOTTO_E2E_MAIN_ENTRY` points it at another build's `out/main/index.js`, for the before column.
describe.skipIf(!PERF_BENCH)('scaling pasted screenshots down to the bound', () => {
  it('pastes each capture into the composer and reports what its draft carries', async () => {
    const launched = await launchSotto()
    try {
      const { page } = launched
      await page.evaluate(async () => {
        await window.sotto!.updateSettings({ onboardingComplete: true })
        await window.sotto!.agents!.command({ type: 'configure', patch: { enabled: true, speak: false } })
        await window.sotto!.agents!.command({ type: 'connect' })
      })
      await page.reload(); await openThreads(page)
      await page.getByRole('button', { name: 'Workshop', exact: true }).click()
      await measure(launched, 'floor: 1920x1080 PNG, a quarter photograph', { type: 'image/png', width: 1920, height: 1080, photo: 0.25 })
      await measure(launched, '3840x2160 PNG, a quarter photograph', { type: 'image/png', width: 3840, height: 2160, photo: 0.25 })
      await measure(launched, '5120x2880 PNG, a quarter photograph', { type: 'image/png', width: 5120, height: 2880, photo: 0.25 })
      await measure(launched, '3840x2160 PNG, text and flat panels only', { type: 'image/png', width: 3840, height: 2160, photo: 0 })
      await measure(launched, '3840x2160 JPEG, half photograph', { type: 'image/jpeg', width: 3840, height: 2160, photo: 0.5 })
    } finally { await closeSotto(launched) }
  }, 300_000)
})
