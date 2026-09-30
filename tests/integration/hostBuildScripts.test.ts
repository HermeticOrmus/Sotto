// @vitest-environment node
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const execute = promisify(execFile)
const root = resolve(import.meta.dirname, '../..')

it('builds and packages the host from another folder with local tar archive names', async () => {
  const scratch = join(root, 'test-results')
  await mkdir(scratch, { recursive: true })
  const cwd = await mkdtemp(join(scratch, 'host-build-cwd-'))
  try {
    await execute(process.execPath, [join(root, 'scripts/build-host.mjs')], { cwd, windowsHide: true })
    const inventory = JSON.parse(await readFile(join(root, 'out/host/external-dependencies.json'), 'utf8'))
    expect(inventory.scope).toBe('host')
    const result = await execute(process.execPath, [
      '--import', pathToFileURL(join(root, 'tests/fixtures/localArchiveTar.mjs')).href,
      join(root, 'scripts/package-host.mjs'),
    ], { cwd, windowsHide: true })
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    const name = `Sotto-host-${pkg.version}-${process.platform}-${process.arch}.tar.gz`
    expect(result.stdout.trim().split('\n').at(-1)).toBe(join(root, 'release', name))
    expect(await readFile(join(root, 'release', name + '.sha256'), 'utf8')).toMatch(new RegExp(`^[a-f0-9]{64}  ${name.replaceAll('.', '\\.')}\\n$`, 'u'))
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}, 60_000)
