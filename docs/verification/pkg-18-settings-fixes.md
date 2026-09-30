# Settings fixes, pkg-18

Verified on Windows on September 30, 2026. S-044 was already fixed in the starting revision: Settings passes the selected input and the shared microphone constraints request its exact ID. Existing selected-input tests cover missing inputs and default onboarding. Issue #517 records why this package skipped a duplicate patch.

The owner chose microphone prototype variant B in #518. The prototype was read at its specified absolute path, without copying or changing it. The browser refused its local-file URL, so its source supplied the interaction and copy reference. The implementation uses Sotto's real Button and VoiceWave.

Regression tests reproduced the missing Stop control and missing cancellation when Settings is hidden or its category is left. The real Electron journey then caught a further failure: native hide left the page listening despite the DOM visibility handler. A typed preload notification from the native hide/minimize events now closes the test too. Electron documents that capture can keep a hidden window's page visible in its [BrowserWindow reference](https://www.electronjs.org/docs/latest/api/browser-window). Both DOM and native cancellation invalidate pending permission results.

The dictionary regressions failed before the limit and unmount flush were added. The cleanup regression showed the second rule undoing the first; individual rule patches now merge with the latest saved settings inside main's existing transaction queue. The unchanged-blur regression failed before the shortcut and numeric fields used the existing revision guard. Existing draft acknowledgement and rollback tests still pass.

Running-app checks:

- `npm run build` completed.
- `tests/e2e/onboarding-microphone-step.spec.ts`: both successful-test and explicit-skip cases passed.
- `tests/e2e/settings-index.spec.ts`: passed; checks real persistence, dictionary limit copy, keyboard paths and dark/light layout at 1600x1000, 1280x800 and 820x560.
- `tests/e2e/selected-microphone.spec.ts`: passed after the native-hide fix; checks exact selected/default requests, missing/denied recovery, keyboard Stop test, native hide, late permission cancellation and page-exit track closure. Uses real MediaStreams and AudioContext with synthetic device discovery/permission. Reduced motion is on; the microphone view fits the three required sizes in both themes.
- All 84 Settings renderer tests and all 259 tests in the window-manager/IPC run passed. These are targeted results; the PR records the full gate results separately.

Inspected captures, retained under `artifacts/pkg-18-e2e/`:

- `review-383/microphone-1600-dark.png`: listening status and Stop test in the dark room.
- `review-383/microphone-820-light.png`: listening controls at the minimum window size in light mode.
- `review-383/microphone-closed.png`: exact closed status, Test again and keyboard focus ring.
- `dictionary-limit.png`: the limit description associated with a 4,000-character draft.

The standards and spec review retained the existing theme tokens, gates, keyboard order, privacy boundaries and selected-input behavior. No design baselines were regenerated. Physical microphone hardware, an OS indicator check and macOS remain unverified; synthetic-stream track closure is verified in Windows Electron.
