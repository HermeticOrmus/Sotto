import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import process from 'node:process'

const folder = resolve('artifacts/review-390')
await mkdir(folder, { recursive: true })
const entry = resolve(folder, 'archive-startup.mjs')
await build({ entryPoints: ['tests/perf/archiveStartup.bench.ts'], outfile: entry, bundle: true, platform: 'node',
  target: 'node24', format: 'esm', packages: 'external' })
const samples = []
for (const size of [1, 50, 200]) {
  for (const mode of ['timing', 'timing', 'timing', 'reads']) {
    const result = spawnSync(process.execPath, ['--expose-gc', entry, String(size), mode], { encoding: 'utf8', windowsHide: true, timeout: 120_000 })
    if (result.status !== 0) throw new Error(`Synthetic archive benchmark failed: ${result.stderr || result.error?.message}`)
    samples.push(JSON.parse(result.stdout.trim()))
  }
}
await writeFile(resolve(folder, 'startup-results.json'), JSON.stringify({ node: process.version, platform: process.platform,
  scope: 'Synthetic WorkspaceHost initialization, warm filesystem cache; logical returned detail rows/bytes are measured separately from timing and retained heap. Not full app startup or physical disk I/O.', samples }, null, 2) + '\n')
process.stdout.write(JSON.stringify(samples, null, 2) + '\n')
