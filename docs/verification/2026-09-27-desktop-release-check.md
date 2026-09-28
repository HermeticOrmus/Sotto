# Manual Windows desktop release check (#393)

`npm run test:desktop-smoke` is an explicit Windows prerequisite in the release procedure. It runs the compact recovery tests, builds once, drives recovery, command receipts and queued steering, then drives daily workspace, restart and Settings against that same build. Normal CI keeps its documented scope. Packaging and publication remain separate manual steps.

The wrapper refuses non-Windows execution, removes live-provider/timing-benchmark flags and any alternate Electron entry, and supplies an absent owned performance-data path. Electron runs with one worker. The selected specs honor `SOTTO_E2E_ARTIFACT_ROOT`, so generated captures stay under ignored `artifacts/review-393/desktop-run/`. The runner does not restore files or invoke Git cleanup.

## Final combined desktop verification

The actual command ran on `1698b1713789f4c329d84e8fd6621de55b07e302`, including current main and the reviewed remaining fixes, with the final optimized worktree implementation. It passed 202 focused tests across seven files (11.98 seconds), built once, then passed three recovery journeys (15.6 seconds) and three daily-workspace/restart/Settings journeys (45.4 seconds). Overall command time was 97.642 seconds. Git status was empty immediately before and after; the shipped command needed no capture cleanup.

The same build then ran 17 neighboring journeys across file-reference identity, selected microphone, onboarding, the Settings mode row, terminal closure/reopen, staged images, native usage/history persistence, host identity, saved new-thread defaults, effort controls and settled folders. Sixteen passed initially. The real-main usage fixture exited before creating a window because this checkout's runtime assets had not been prepared; `npm run runtime:verify` confirmed the missing prepared set. Normal `npm run runtime:prepare` and verification supplied four runtime files and the history helper. The same-build usage journey then passed in 6.5 seconds, including graceful quit with an archive write held, restored visible history and an editable composer. No production source or deadline changed. A separate PowerShell attempt was interrupted by informational stderr handling before completion and is not counted as a test result.

Thus 23 distinct desktop journeys are verified across these runs, not claimed as one uninterrupted 23-test pass. Every Electron run used one worker. A final worktree unit file briefly overlapped the early focused recovery stage; it ended before Electron, and the independent timing probe had already completed. No physical microphone, paid provider, personal profile or native macOS desktop journey was used.

The minimum light workspace, minimum dark Settings, selected microphone, recovery, denied onboarding, reopened terminal, larger new-thread defaults and native history captures were inspected. Controls and copy remain readable, scrolling is contained, and the approved recovery/Test-or-Skip/mode-row behavior is retained. The daily journey typed through a real Windows terminal, checked file contents and the diff, committed and pushed to an owned local bare repository, then exercised a scripted GitHub client. It made no real GitHub write. Unrelated captures and generated tracked runtime files were restored after the additional journeys; selected final evidence is retained below. No design baseline was regenerated.

- [Restored queue and draft at minimum light size](../../artifacts/review-393/restart-minimum-light.png)
- [Output Settings at minimum dark size](../../artifacts/review-393/settings-minimum-dark.png)
- [Real-adapter history after graceful restart](../../artifacts/review-393/native-history-after-restart.png)
- [Compact acceptance receipt](../../artifacts/review-393/final-acceptance.json)

## Full gates and review

The first shared hosted head `5867ad97` passed static checks but failed its full suite: 5,954 passed, 140 skipped and one Codex activity-restoration failure (829.56 seconds). The test observed the inner adapter while reading the outer workspace snapshot; #390 intentionally defers message windows until that workspace is observed. The exact failure was reproduced, then corrected through the actual workspace observation boundary with all original restoration, identity, activity and no-replay assertions intact. The corrected three-file group passed 55 tests. This correction changes the fixture only; the desktop-tested production source is unchanged.

Latest exact full-gate results are recorded in [PR #447](https://github.com/millZach/Sotto/pull/447). No final local full-suite pass is claimed: earlier serial local runs encountered native allocation failures, and the host again reached 95?97% committed memory without an owned verification process. Isolated hosted gates provide the full-suite evidence; each component keeps its own issue, PR and exact-head requirement, and this workflow PR merges last.

Independent native Astra Standards and Spec reviews and the coordinating source/visual review found no remaining workflow findings. The corrected observation fixture and final worktree optimization received fresh two-axis reviews. The latter's paired timing/control evidence is in the [worktree verification note](2026-09-27-worktree-registry-coordination.md): primary Git counts are preserved, discovery drops two calls, and no remaining added latency was demonstrated in the measured workflows. This is bounded synthetic evidence, not a universal whole-application latency claim.

An earlier run at `bfadb348` also passed 201 focused tests, one build and six desktop journeys with clean before/after status. Its result is historical and is not substituted for the final combined verification above.
