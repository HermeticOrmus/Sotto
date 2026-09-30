// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { globSync } from 'tinyglobby'
import { configDefaults } from 'vitest/config'
import { expect, it } from 'vitest'
import config from '../../../vitest.config'

it('collects only repository tests and leaves backups and nested e2e specs out', () => {
  const root = mkdtempSync(join(tmpdir(), 'sotto-discovery-'))
  try {
    for (const file of ['tests/unit/example.test.ts', 'tests/integration/example.test.mjs', '.cache/backup/example.test.ts', 'src/example.test.ts', 'tests/e2e/example.test.ts', 'tests/backup/e2e/example.test.ts']) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), '')
    }
    const files = globSync(config.test?.include ?? configDefaults.include, {
      cwd: root, ignore: config.test?.exclude ?? configDefaults.exclude, dot: true,
    })
    expect(files.sort()).toEqual(['tests/integration/example.test.mjs', 'tests/unit/example.test.ts'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
