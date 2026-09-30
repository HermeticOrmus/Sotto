// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('keeps every tracked file free of a UTF-8 byte order mark', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
  const bom = Buffer.from([0xef, 0xbb, 0xbf])
  const offenders = files.filter(file => readFileSync(file).subarray(0, 3).equals(bom))
  expect(offenders).toEqual([])
})
