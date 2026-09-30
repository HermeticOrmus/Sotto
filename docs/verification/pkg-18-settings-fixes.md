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

## PR #630 review rework

All seven findings were confirmed and addressed in separate commits. Category changes and window hiding preserve denied, missing and error results. An ended input track now releases the audio graph, tracks, frame and event listeners before Settings reports the missing microphone. When other inputs exist, a missing chosen microphone asks the user to plug it in or choose another; an empty input list keeps the no-microphone message.

The test keeps the peak on VoiceWave's 0..1 scale. A peak greater than the named 0.02 threshold retains variant B's heard-and-closed result; a quiet input asks the user to check for mute. Every new test and input change resets the peak. Stop, category navigation, hide and unmount still release the input, and Test again remains available after either stopped result.

A failed closing dictionary save, including a blur save that finishes after navigation, reaches the app's notice region and tells the user to re-enter the edits in Cleanup. The notice persists until dismissed or a successful dictionary save. An older failed submission cannot override a newer closing submission. A native paste cut at 4,000 characters announces the cut beside the field; replacement selections and normalized line endings count correctly. The guide places the shortcut under Dictation and describes the new feedback.

The throwaway state/feedback prototype was inspected and captured on the local branch `prototype/pkg-18-review-feedback`, at `src/renderer/src/features/settings/microphone-review.prototype.html`. It tests the requested state transitions with the existing variant B controls; it introduces no new layout choice and is absent from the implementation branch.

Regression loops failed before their fixes. The final affected unit run passed 151 tests across Settings, the app and the browser microphone controller. The final build and the three Electron specs listed above passed all four tests (31.7 seconds). The heard case feeds a real synthetic oscillator through the browser audio graph and observes a level above the threshold; the silent case supplies a quiet stream. The ended event is scripted on a real MediaStream track. The paste case uses Electron's clipboard and the normal paste shortcut. The failed-save case holds a main IPC response until Settings has been left, then rejects it and verifies the dismissible app alert. These remain synthetic-device checks, not physical microphone verification.

New inspected captures retained under `artifacts/pkg-18-e2e/`:

- `review-383/microphone-silent.png`: quiet test result and Test again at minimum window size.
- `review-383/microphone-unplugged.png`: disconnected-input message and retry at minimum window size.
- `settings-index/dictionary-paste-cut.png`: real truncated paste with the status message beside the dictionary.
- `settings-index/dictionary-save-failure.png`: app-level failure after navigation, including Dismiss.

Independent gpt-6.1-sol reviewers at high reasoning reviewed Standards and Spec separately. Standards found the initially persistent notice could remain after recovery; the follow-up added dismissal, successful-save clearing and an obsolete-submission guard. Both final axes report no remaining findings. Typecheck, lint and notices verification passed after that fix. No design baselines were regenerated; physical hardware and macOS hands-on checks remain unverified.

The full two-worker gate run passed 6,431 tests with 153 skipped across 521 files (880.00 seconds). The final notice follow-up was also covered by the separate 151-test affected run. No deadlines, skips or assertions were weakened.

Main was integrated at `268fa07d`; both artifact-exclusion lists were retained when resolving the conflicts that blocked GitHub from starting pull-request CI. Typecheck, lint and notices passed on the integration. All 425 affected tests passed across six files, and the rebuilt Electron run passed all six tests across the three specs above plus `new-thread-settings.spec.ts` (47.7 seconds). The refreshed minimum-size microphone captures were inspected.
