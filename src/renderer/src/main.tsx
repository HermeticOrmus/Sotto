import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { WorkflowPrototype } from './WorkflowPrototype'
import { DEFAULT_SETTINGS } from '../../shared/settings'
import type { SottoBridge } from '../../shared/contracts'
import { AppProvider } from './state/AppContext'
import { createE2EControllerFactory, createE2EMicrophoneTest, createE2ESettingsBridge } from './e2e/deterministicAdapters'
import './styles/global.css'
import './agents/threads.css'
import './agents/threadSidebar.css'
import './agents/threadsChrome.css'
import './agents/room.css'
import './features/history/history.css'
import './styles/crossing-settings.css'
import { applyAppearance, readCachedAppearance } from './state/appearance'

// Paint the last chosen look before settings arrive so a light room never
// opens black for a frame; App re-applies from settings once they load.
applyAppearance(readCachedAppearance())

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Renderer root element is missing')
}

const e2e = window.sottoE2E
const prototype = import.meta.env.DEV && (e2e !== undefined || new URLSearchParams(location.search).has('surface'))
const settingsBridge = window.sotto === undefined ? undefined : createE2ESettingsBridge(window.sotto, e2e !== undefined)
// Deliberately partial throwaway bridge: this demo uses read-only bootstrap and local UI state only.
// Unimplemented product commands fail instead of reaching Electron or a provider.
const prototypeBridge = new Proxy({
  platform: 'win32',
  getSettings: async () => ({ ...DEFAULT_SETTINGS, onboardingComplete: true, voiceCoordinatorEnabled: true, historyEnabled: false }),
  listHistory: async () => [],
  listRecoveryNotices: async () => [],
  getUpdateStatus: async () => ({ ok: false as const, reason: 'unavailable' as const }),
  getWindowMaximized: async () => false,
  onSettingsChanged: () => () => undefined,
  onDictationCommand: () => () => undefined,
  onRecoveryNotice: () => () => undefined,
  onUpdateStatus: () => () => undefined,
  onUpdateCheckRequested: () => () => undefined,
  onWindowMaximized: () => () => undefined,
}, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => Promise.reject(new Error('Prototype operation is not connected')) }) as unknown as SottoBridge
const controllerFactory = prototype ? () => ({ getState: () => ({ status: 'idle' as const }), start: async () => undefined, stop: async () => undefined, toggle: async () => undefined, cancel: async () => undefined, dispose: () => undefined }) : e2e === undefined ? undefined : createE2EControllerFactory(e2e.scenario)

createRoot(rootElement).render(
  <StrictMode>
    <AppProvider {...(prototype ? { bridge: prototypeBridge } : settingsBridge === undefined ? {} : { bridge: settingsBridge })} {...(controllerFactory === undefined ? {} : { createController: controllerFactory })}>
      {prototype ? <WorkflowPrototype /> : <App {...(e2e === undefined ? {} : { createMicrophoneTest: () => createE2EMicrophoneTest(e2e.scenario) })} />}
    </AppProvider>
  </StrictMode>,
)
