# File references belong to a prompt revision

Issue #381. Windows verification on September 27, 2026. Implementation `f9137650`, Electron regression `cfd2cf5d`, integrated with main `68f7974c` at `814872d2`. The main integration changes no desktop source or tests.

Manual send, steer, queued follow-ups, durable outbox receipts and both draft-clearing paths now use the same prompt digest, including selected file references. An exact retry can reconcile its original receipt; changing the selected files under the same draft ID is refused before dispatch.

## Reproduction and focused coverage

The new desired-behavior regressions failed ten times on the baseline. After the repair, 94 tests passed across followups, thread drafts, staged image delivery, prompt files and the file-mention composer. Cases cover pending coalescing, uncertain retries, restart, late confirmation, retained receipts, changed files, skills and image conflicts.

An 8 MiB synthetic-image case holds the provider and repeats a file-bearing prompt ten times while pending and three times while uncertain. It proves one dispatch, no coordinator attachment reads, and command/state/persistence payloads below 64 KiB. This is a structural work bound, not a latency benchmark or a claim that provider submission reads no image bytes.

## Desktop journey

The built Electron app passed `file-reference-identity.spec.ts` and `queued-steering.spec.ts`: two tests, 16.4 seconds. It used temporary profiles, synthetic project files and scripted providers; no paid provider or real user profile was used.

The real Files picker selects README.md from the keyboard. A test-only wrapper around the real main IPC handler captures the uncertain send, submits a conflicting file selection, then submits the exact original command. It invokes the original coordinator for every result: the conflict is refused, the exact retry reconciles to the same command/message IDs, and a reload shows exactly one user message and an empty composer. Unit coverage separately counts provider dispatches and causally holds concurrent persistence.

- [Files picker, 1280 by 800 dark](../../artifacts/review-381/electron/file-picker.png).
- [Reconciled message and composer](../../artifacts/review-381/electron/reconciled.png).

Both captures were inspected; the neighboring queue journey also covered existing 820 by 560 dark and 1600 by 1000 light surfaces. Existing design captures were restored, not regenerated.

## Gates and review

Typecheck, lint, notices (174 components), runtime preparation and build passed before the iOS-only integration; static checks and notices passed again after integration. The full two-worker suite at `8f6a7c60` finished in 1,193.15 seconds with 5,736 passed, 131 skipped and two failures. Both are the Claude idle-reaping case in `headlessHost.test.ts` and `socketHostContract.test.ts`: `adapterContract.ts:715` expected a new session start after send, but the count stayed at two. The cause is under investigation; this result is not a green full gate or a demonstrated baseline defect. `SOTTO_PERF_DATA` pointed to a verified-absent owned artifact path, excluding personal-profile benchmarks.

Independent native GPT-6 Astra/high Standards and Spec reviews of `cfd2cf5d` reported no findings, and the root review agreed. The root verified the native review configuration. External cross-model review destinations were rejected by automatic approval review and were not retried; no cross-model review is claimed.
