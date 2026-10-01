// @vitest-environment node
import { expect, it } from 'vitest'
import { installerDetail, installerOutput } from '../../../src/main/agents/installerDetail'

it.each([
  String.raw`C:\Users\John Smith\AppData\Local\npm-cache`,
  'C:/Users/John Smith/AppData/Local/npm-cache',
  String.raw`\\server\People\John Smith\tools`,
  '//server/People/John Smith/tools',
  '/home/John Smith/.cache/tools',
  '/Users/John Smith/.cache/tools',
  '/private/var/John Smith/tools',
  '/opt/tools/client',
  String.raw`C:\Users\Smith, John\AppData\Local\npm-cache`,
  String.raw`C:\Users\John O'Neil\AppData\Local\npm-cache`,
  String.raw`C:\Users\Chris' Work\AppData\Local\npm-cache`,
])('redacts the whole installer path %s in both presentations', path => {
  expect(installerDetail(`Cannot write ${path}`)).toBe('Cannot write …')
  expect(installerOutput(`First line\nCannot write "${path}"; permission denied`))
    .toBe('First line\nCannot write "…"; permission denied')
  expect(installerDetail(`Cannot write '${path}'`)).toBe("Cannot write '…'")
  expect(installerOutput(`First line\nCannot write '${path}'`))
    .toBe("First line\nCannot write '…'")
})

it('keeps the operation and separators around multiple quoted or unquoted paths', () => {
  expect(installerDetail(String.raw`rename C:\Users\John Smith\old -> C:/Users/Jane Doe/new`))
    .toBe('rename … -> …')
  expect(installerDetail(String.raw`rename 'C:\Users\John Smith\old' -> '/home/Jane Doe/new'`))
    .toBe("rename '…' -> '…'")
  expect(installerDetail(String.raw`rename 'C:\Users\John O'Neil\old' -> '/home/Smith, John/new'`))
    .toBe("rename '…' -> '…'")
})

it.each([
  [String.raw`rename 'C:\Users\John Smith\old' -> C:\Users\Chris' Work\new`, "rename '…' -> …"],
  [String.raw`Copy 'C:\Users\John Smith\old' to "C:\Users\Chris' Work\new"`, "Copy '…' to \"…\""],
  [String.raw`rename C:\Users\Chris' Work\old -> '/home/John Smith/new'`, "rename … -> '…'"],
])('keeps mixed path formats private: %s', (line, expected) => {
  expect(installerDetail(line)).toBe(expected)
  expect(installerOutput(line)).toBe(expected)
})

it('leaves URLs, package names and ordinary diagnostic text readable', () => {
  const line = 'Failed aqua:openai/codex@1.0 from https://example.com/releases: permission denied'
  expect(installerDetail(line)).toBe(line)
})

it.each([
  String.raw`C:\Users\John Smith\AppData\Local\npm-cache`,
  String.raw`\\server\People\John Smith\tools`,
  '/home/John Smith/.cache/tools',
])('redacts a path immediately after a diagnostic label: %s', path => {
  expect(installerDetail(`npm ERR! path:${path}`)).toBe('npm ERR! path:…')
  expect(installerOutput(`npm ERR! path:${path}`)).toBe('npm ERR! path:…')
})
