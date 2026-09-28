/**
 * `tailscale status --json` as Tailscale 1.102 prints it on Windows, recorded on the development laptop on
 * September 27, 2026 and cut to the fields Sotto reads plus a few it ignores. Keys, node IDs and addresses
 * are replaced with stand-ins. Tests read these instead of running the real CLI.
 */

const USER_ID = 7620632313449851
const user = { [USER_ID]: { ID: USER_ID, LoginName: 'millZach@github', DisplayName: 'millZach', ProfilePicURL: '' } }
const self = {
  ID: 'nSelf1CNTRL', PublicKey: 'nodekey:0001', HostName: 'LAPTOP-RUSSH2J5', DNSName: 'laptop-russh2j5.tail5728ca.ts.net.', OS: 'windows', UserID: USER_ID,
  TailscaleIPs: ['100.64.0.1', 'fd7a:115c:a1e0::1'], Online: true, LastSeen: '0001-01-01T00:00:00Z', Active: false, ExitNode: false,
}
const sshKeys = ['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIStandIn', 'ecdsa-sha2-nistp256 AAAAE2VjZHNhStandIn', 'ssh-rsa AAAAB3NzaC1yc2EStandIn']
const node = (id: number, fields: Record<string, unknown>): Record<string, unknown> => ({
  ID: `n${id}CNTRL`, PublicKey: `nodekey:${String(id).padStart(4, '0')}`, UserID: USER_ID, TailscaleIPs: [`100.64.0.${id}`, `fd7a:115c:a1e0::${id}`],
  Online: false, LastSeen: '0001-01-01T00:00:00Z', Active: false, ExitNode: false, ExitNodeOption: false, KeyExpiry: '2027-03-01T00:00:00Z', ...fields,
})
const peers = {
  'nodekey:0002': node(2, { HostName: 'omarchy', DNSName: 'omarchy.tail5728ca.ts.net.', OS: 'linux', LastSeen: '2026-09-19T04:52:53.1Z', sshHostKeys: sshKeys }),
  'nodekey:0003': node(3, { HostName: 'DESKTOP-8NPFSBM', DNSName: 'desktop-8npfsbm.tail5728ca.ts.net.', OS: 'windows', LastSeen: '2026-09-14T01:21:05.1Z' }),
  'nodekey:0004': node(4, { HostName: 'forge', DNSName: 'forge.tail5728ca.ts.net.', OS: 'linux', Online: true, Active: true, sshHostKeys: sshKeys }),
  'nodekey:0005': node(5, { HostName: 'pihole', DNSName: 'pihole.tail5728ca.ts.net.', OS: 'linux', Online: true }),
  // An iPhone reports its own name as localhost; its MagicDNS name is the one people know.
  'nodekey:0006': node(6, { HostName: 'localhost', DNSName: 'iphone-15-pro.tail5728ca.ts.net.', OS: 'iOS', Online: true, LastSeen: '2026-09-27T22:00:00.1Z' }),
  // A Mullvad exit node is on the tailnet but is nobody's machine.
  'nodekey:0007': node(7, { HostName: 'us-nyc-wg-301', DNSName: 'us-nyc-wg-301.mullvad.ts.net.', OS: 'linux', Online: true, ExitNodeOption: true, Location: { Country: 'USA', City: 'New York' } }),
}
const status = (fields: Record<string, unknown>): string => JSON.stringify({
  Version: '1.102.2-t6cac91817-g6ff0ddc72', TUN: true, HaveNodeKey: true, AuthURL: '', TailscaleIPs: self.TailscaleIPs, Health: [],
  MagicDNSSuffix: 'tail5728ca.ts.net', CurrentTailnet: { Name: 'millzach.github', MagicDNSSuffix: 'tail5728ca.ts.net', MagicDNSEnabled: true },
  CertDomains: ['laptop-russh2j5.tail5728ca.ts.net'], ...fields,
}, null, 2)

export const TAILSCALE_RUNNING = status({ BackendState: 'Running', Self: self, Peer: peers, User: user })
/** Connected, with no other device on the tailnet yet. */
export const TAILSCALE_NO_PEERS = status({ BackendState: 'Running', Self: self, User: user })
/** Disconnected from the tray: still signed in, prints its status with exit 1. */
export const TAILSCALE_STOPPED = status({ BackendState: 'Stopped', Self: { ...self, Online: false }, Peer: null, User: user, Health: ['Tailscale is stopped.'] })
/** Signed out. */
export const TAILSCALE_NEEDS_LOGIN = status({
  BackendState: 'NeedsLogin', HaveNodeKey: false, TailscaleIPs: null, Self: { ...self, ID: '', DNSName: '', UserID: 0, TailscaleIPs: null, Online: false },
  Peer: null, User: null, CurrentTailnet: null, MagicDNSSuffix: '', CertDomains: null, Health: ['You are logged out.'],
})
/** What the CLI prints when the Tailscale service is not answering. */
export const TAILSCALE_NOT_ANSWERING = 'failed to connect to local tailscaled; it doesn\'t appear to be running (sudo systemctl start tailscaled ?)\n'
