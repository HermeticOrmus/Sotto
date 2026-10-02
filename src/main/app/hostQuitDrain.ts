import { registerQuitDrain } from './quitDrain'

interface AsyncClose { close(): Promise<void> }
/** Startup fills these handles before starting each resource. */
export interface HostQuitHandles {
  localRuntime?: AsyncClose
  desktopHosts?: AsyncClose
  personalChats?: AsyncClose
  phoneAccess?: AsyncClose
  hostSetup?: AsyncClose
  hostSetupTools?: AsyncClose
  providerJobs?: { close(): void }
  hostUpdates?: { dispose(): void }
  hostRouter?: { dispose(): void }
  stopPublishing?: () => void
}

export function registerHostQuitDrain(app: Parameters<typeof registerQuitDrain>[0], handles: HostQuitHandles, failed: () => void, phoneFailed: () => void): void {
  registerQuitDrain(app, async () => {
    handles.stopPublishing?.()
    // Remove phone access before closing the host it serves (ADR-0033).
    await handles.phoneAccess?.close().catch(phoneFailed)
    await handles.hostSetup?.close().catch(() => undefined)
    handles.providerJobs?.close()
    handles.hostUpdates?.dispose()
    const results = await Promise.allSettled([
      handles.desktopHosts?.close(), handles.localRuntime?.close(),
      handles.personalChats?.close(), handles.hostSetupTools?.close(),
    ])
    handles.hostRouter?.dispose()
    const failure = results.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  }, failed)
}
