// Throwaway interactive prototype. Every profile is isolated and contains synthetic data only.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
const profile = mkdtempSync(join(tmpdir(), 'sotto-e2e-review-prototype-'))
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ onboardingComplete: true, voiceCoordinatorEnabled: true, memoryEnabled: false, historyEnabled: false, appearance: 'dark', reducedMotion: 'on', llmApiKey: '' }))
console.log('Prototype profile: ' + profile)
const child = spawn(process.execPath, [resolve('node_modules/electron-vite/bin/electron-vite.js'), 'dev', '--', '--remote-debugging-port=9238'], {
  cwd: process.cwd(), stdio: 'inherit', windowsHide: true,
  env: { ...process.env, SOTTO_E2E: '1', SOTTO_E2E_USER_DATA: profile, SOTTO_E2E_SCENARIO: 'success' },
})
child.on('exit', code => { process.exitCode = code ?? 0 })

