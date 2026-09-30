# Dictation history, delivery and spellcheck privacy

Package pkg-21 fixes #512, #515, #516 and #546 on Windows. It changes main-process behavior and keeps the existing controls and layout. The owner's spellcheck decision is to keep spellcheck enabled while blocking dictionary downloads, with no new host and no README exception.

## Reproductions and fixes

- **History (#512).** Seeded `history.json.tmp-123-crashed` files survived Clear history with and without an active history file. Startup now removes temporary history siblings, and Clear history removes temporary and corrupt siblings. Saved history and startup recovery backups remain intact; another store's temporary file remains untouched.
- **Delivery order (#515).** Holding widget hide or paste completion let a history copy overwrite the clipboard. Three concurrent dictations all pasted the third transcript. Every nonempty delivery now holds its place from clipboard write through paste completion and widget restoration. Clipboard errors release the queue for the next delivery.
- **Unconfirmed paste (#516).** Scripted helper exit, error and timeout invoked a second paste through the fallback. Dispatched commands now return false when their outcome is unknown. Late acknowledgements cannot change the settled result. Backpressure still waits for acknowledgement, and a helper unavailable before dispatch can use the one-shot fallback.
- **Spellcheck (#546).** Session mocks confirmed that neither the default policy nor browser sessions configured dictionary downloads. Both now use the hostless `data:,` dictionary base without disabling spellcheck. The real Electron journey forces a missing Afrikaans dictionary on Sotto's actual default and BrowserService sessions, observes begin/failure events, confirms spellcheck remains enabled, and checks the network log for remote dictionary URLs.

The unit regressions failed before their corresponding fixes. The spellcheck network assertion was also checked with a temporary built-only diagnostic using a refused loopback dictionary base: dictionary download still failed, but HTTP dictionary requests made the assertion fail. Restoring the hostless base made the journey pass. This distinguishes the protection from ordinary network failure without contacting the public dictionary CDN.

Electron 43.1.0's [dictionary URL patch](https://github.com/electron/electron/blob/v43.1.0/patches/chromium/feat_add_support_for_overriding_the_base_spellchecker_download_url.patch) appends the dictionary filename to a process-wide base URL. `data:,` has no host and cannot return a valid Hunspell dictionary. Electron's [spellchecker documentation](https://www.electronjs.org/docs/latest/tutorial/spellchecker/) describes OS spellchecking on macOS. OS spelling suggestions were not manually tested on macOS; a language needing a downloaded dictionary may offer none.

## Running app

`npm run build` succeeded. `npx playwright test tests/e2e/dictation-recovery.spec.ts tests/e2e/agent-browser.spec.ts tests/e2e/spellcheck-privacy.spec.ts --workers=1` passed all four journeys. The spellcheck journey was rerun against the actual production browser session after review and passed.

A repeated batch later hit the first browser journey's 240-second timeout and a 30-second worker teardown timeout. The other three journeys passed. Running `npx playwright test tests/e2e/agent-browser.spec.ts --workers=1` alone on the same revision then passed both cases in about 30 seconds. No assertion or deadline was changed. The timeout's precise cause was not established on this shared desktop.

The dictation journey covers clipboard-failure recovery, keyboard Copy text, navigation, later dictation, and history off. It checks dark and light at 1600x1000, 1280x800 and 820x560 with reduced motion enabled. The browser journeys cover real local-page actions, user decisions, default grants, Stop, keyboard actions, themes, sizes and the focused-thread player. These are fixture-driven journeys; they do not establish live provider or native target-app behavior.

Inspected captures:

- [Completed text at 820x560, dark](../../artifacts/review-380/pkg21-recovery-820-dark.png): the retained transcript, Copy text and Dismiss text fit and remain readable.
- [Browser in Tools at 1280x800, dark](../../artifacts/agent-browser/pkg21-tools-1280x800-dark.png): a native window capture includes the actual local page beside the thread. Renderer-only screenshots omit the separate native browser view, so this retained image uses the native capture.

No design baseline was regenerated. Existing tracked captures overwritten by the journeys were restored; only the two images cited here are retained.

## Review

The standards and spec reviews used independent gpt-6.1-sol reviewers at high reasoning. Windows read-only sandbox execution failed initially; retries reviewed supplied diffs and numbered source without executing tools. The standards cleanup extracted shared delivery options and removed an unused helper-outcome parameter. The spec review prompted the spellcheck journey to use the actual application sessions. The parent also reviewed the integrated diff against AGENTS.md and all four entries.

Full gate results and final revision are recorded in the pull request. No UI design, shortcut, setting, provider protocol, authority policy, production dependency or allowed host changed.
