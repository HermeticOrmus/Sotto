import { expect, it } from 'vitest'
import { deviceDetails, timeAgo, unavailableReason } from '../../../src/renderer/src/features/settings/DevicePicker'
import type { HostDevice } from '../../../src/shared/hostDevices'

const NOW = Date.parse('2026-09-27T20:00:00Z')
const at = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString()

it('says how long ago a device was seen in whole minutes, hours or days', () => {
  expect(timeAgo(at(0), NOW)).toBe('1 minute ago')
  expect(timeAgo(at(59), NOW)).toBe('59 minutes ago')
  expect(timeAgo(at(60), NOW)).toBe('1 hour ago')
  expect(timeAgo(at(23 * 60 + 59), NOW)).toBe('23 hours ago')
  expect(timeAgo(at(24 * 60), NOW)).toBe('1 day ago')
  expect(timeAgo('2026-09-19T04:52:53.100Z', NOW)).toBe('8 days ago')
})

it('gives the reason a device cannot be used, a saved host first', () => {
  const omarchy: HostDevice = { target: 'omarchy.tail5728ca.ts.net', name: 'omarchy', tailscale: { online: false, ssh: true, lastSeen: at(8 * 24 * 60) }, unavailable: 'offline', names: ['omarchy.tail5728ca.ts.net', 'omarchy'] }
  expect(unavailableReason(omarchy, [], NOW)).toBe('Offline, last seen 8 days ago')
  expect(unavailableReason({ ...omarchy, tailscale: { online: false, ssh: true } }, [], NOW)).toBe('Offline')
  expect(unavailableReason({ ...omarchy, unavailable: 'phone' }, [], NOW)).toBe('A phone cannot run the host')
  expect(unavailableReason(omarchy, [{ name: 'Laptop box', host: 'Omarchy' }], NOW)).toBe('Already added as Laptop box')
  expect(unavailableReason({ target: 'forge', name: 'forge', sshConfiguration: true, names: ['forge'] }, [{ name: 'Other', host: 'spark' }], NOW)).toBeUndefined()
})

it('words where a device comes from, and says Tailscale SSH is unchecked only where it could matter', () => {
  const pihole: HostDevice = { target: 'pihole', name: 'pihole', os: 'Linux', tailscale: { online: true, ssh: false }, sshConfiguration: true, knownHost: true, names: ['pihole'] }
  expect(deviceDetails(pihole, true)).toBe('Linux · Tailscale, SSH server not checked · SSH configuration · Known hosts')
  expect(deviceDetails(pihole, false)).toBe('Linux · Tailscale · SSH configuration · Known hosts')
  expect(deviceDetails({ target: 'spark', name: 'spark', detail: 'zach@spark.lan', sshConfiguration: true, names: ['spark'] }, true)).toBe('zach@spark.lan · SSH configuration')
})
