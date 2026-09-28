import { z } from 'zod'
import { HOSTS_GET, HOSTS_COMMAND, hostsCommandSchema, type HostsState } from '../../shared/hosts'
import { HOSTS_DEVICES, HOSTS_TAILSCALE, HOSTS_TAILSCALE_CONNECT, HOSTS_TAILSCALE_DOWNLOAD } from '../../shared/hostDevices'
import { isAuthorizedIpcSender, type IpcMainAdapter, type TrustedIpcSender } from '../ipc/registerIpc'
import type { DesktopHosts } from './desktopHosts'
import type { HostTailscale } from './tailscale'

export function registerHostsIpc(ipc: IpcMainAdapter, hosts: DesktopHosts, senders: () => readonly TrustedIpcSender[], publish: (state: HostsState) => void,
  tailscale: Pick<HostTailscale, 'devices' | 'status' | 'connect' | 'openDownload' | 'dispose'>): () => void {
  const answer = <T>(channel: string, run: () => T): void => {
    ipc.handle(channel, (event, ...args) => {
      if (!isAuthorizedIpcSender(event, senders(), ['main'])) throw new Error('Open Hosts in the main Sotto window.')
      z.tuple([]).parse(args)
      return run()
    })
  }
  answer(HOSTS_GET, () => hosts.get())
  ipc.handle(HOSTS_COMMAND, (event, ...args) => {
    if (!isAuthorizedIpcSender(event, senders(), ['main'])) throw new Error('Open Hosts in the main Sotto window.')
    const [command] = z.tuple([hostsCommandSchema]).parse(args)
    return hosts.command(command)
  })
  // Tailscale and the SSH setup are read on each request, so a device that just came online, or an alias
  // added a moment ago, is listed.
  answer(HOSTS_DEVICES, () => tailscale.devices())
  answer(HOSTS_TAILSCALE, () => tailscale.status())
  answer(HOSTS_TAILSCALE_CONNECT, () => tailscale.connect())
  answer(HOSTS_TAILSCALE_DOWNLOAD, () => tailscale.openDownload())
  const off = hosts.subscribe(publish)
  const channels = [HOSTS_GET, HOSTS_COMMAND, HOSTS_DEVICES, HOSTS_TAILSCALE, HOSTS_TAILSCALE_CONNECT, HOSTS_TAILSCALE_DOWNLOAD]
  // Sotto is closing: a `tailscale up` still waiting for a sign-in is stopped rather than left running.
  return () => { off(); for (const channel of channels) ipc.removeHandler(channel); tailscale.dispose() }
}
