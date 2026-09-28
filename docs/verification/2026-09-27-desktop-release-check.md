# Manual Windows desktop release check (#393)

`npm run test:desktop-smoke` is now an explicit Windows prerequisite in the release procedure. It runs the compact recovery tests, builds once, drives the recovery/receipt/queued-steering journeys, then drives daily workspace, restart and Settings against that same build. Normal CI keeps its documented scope. No new hosted schedule, account, secret or release action is required.

The wrapper refuses non-Windows execution, removes live-provider and timing-benchmark flags and any alternate Electron entry point, and supplies an absent owned performance-data path. One Electron worker runs at a time. The selected specs honor `SOTTO_E2E_ARTIFACT_ROOT`, so all emitted screenshots and proof files go to named subdirectories under ignored `artifacts/review-393/desktop-run/`. Ordinary standalone runs retain their existing output paths. The runner never restores files or invokes Git cleanup.

## Actual run

The shipped command ran from clean commit `bfadb348`, based on the approved #395/#380, #408, #391 and #388 dependencies combined in one checkout. It passed:

- 201 focused recovery tests across seven files with two workers.
- One production build.
- Three recovery Electron journeys in 21.3 seconds: real command receipts, completed dictation recovery, and queued steering.
- Three further Electron journeys in about 1.4 minutes: daily mixed-provider workspace (49.8 seconds), restart with drafts and queues (9.3 seconds), and Settings saves/failures/themes/persistence (25.9 seconds).

Both captured `git status --porcelain` outputs, immediately before and after the command, were empty (zero bytes). No tracked verification capture or runtime file changed. No cleanup was needed. The selected evidence images below were copied afterward for this note.

The daily journey typed a real command through the Windows terminal, verified its file contents, inspected the diff, committed, and pushed to an owned local bare repository before exercising a scripted GitHub client. It made no real GitHub write. The retained screenshots, the fixture PR view and the minimum Settings layout were inspected. Recovery and Settings exercised their defined light/dark sizes; keyboard assertions remained intact. No production profile, microphone audio or paid provider turn was used.

Typecheck, lint and notices passed. A narrow post-review observation intercepted both child launches and verified that inherited `SOTTO_PERF_BENCH`, `SOTTO_PERF_ASSERT`, a live-provider flag and an alternate Electron entry were absent, while the owned data and artifact paths reached both stages. The observed commands remained recovery followed by single-worker desktop tests; no child or provider was launched for this probe. Full two-worker gate and independent reviews are queued. This is Windows evidence; the command intentionally refuses other platforms instead of reporting Windows-only tests as skipped success. Packaging and publication remain separate manual release steps.

- [Restored queue and newer draft at minimum size](../../artifacts/review-393/restart-minimum-light.png)
- [Settings at minimum size](../../artifacts/review-393/settings-minimum-dark.png)
