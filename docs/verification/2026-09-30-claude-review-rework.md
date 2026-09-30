# Claude review rework

PR #623, review follow-up on Windows. All six review findings were confirmed and addressed.

- Changed personal context stays pending while background work runs. A send reaches the same process with its previous context; the first send after the work ends restarts with the latest context.
- Configuration cleanup retries temporary Windows locks and logs only `claude-mcp-config-cleanup-failed` if removal still fails. Cleanup cannot replace a launch error or fail reconnect. Connect removes leftover configuration files before starting a client.
- Overlapping transcript callers share a queued read. A caller sees text appended during the previous read and finishes without waiting for later poll arrivals.
- A failed answer remains available. The existing **Check again** action reopens a Claude request for a new explicit answer, through both personal chats and project threads. Checking sends nothing. Earlier uncertain decisions remain evidence; a restored request cannot replay an old answer without checking it first.

The answer-recovery flow was prototyped with the existing controls. The throwaway HTML is retained on the local `prototype/claude-answer-retry` branch at `3b07bf5c414a317f41c9ad1fb1043feb844da11b`; it is outside this PR's production tree. The chosen flow follows the review's explicit-retry option and adds no new control or layout.

## Checks

- Regression tests were observed failing for sends with changed context, transcript appends during a joined read, uncertain-answer retries, continuous poll arrivals, leftover files, failed reconnect cleanup, and a cleanup failure replacing a configuration-write error.
- The five focused files covering Claude safety, restored-request replay protection, personal-chat rendering, request drafts and request-draft delivery passed: 99 tests. The application-level cases exercise both the personal chat service and the coordinator; the renderer case checks that **Check again** sends no answer before enabling a new choice.
- The first complete suite found a restored-request replay regression: 6,403 passed, 153 skipped, one failed. It was fixed without changing that replay-protection test. Final gate results are recorded in the PR.
- Local rework gates before the base sync passed: `npm run typecheck`, `npm run lint`, `npm test -- --maxWorkers=2` (6,408 passed, 153 skipped), and `npm run notices:verify` (174 components).
- `npm run build` and `npx playwright test tests/e2e/thread-activity.spec.ts tests/e2e/phase-three-personal-requests.spec.ts` passed: five cases. The complete-app personal request case also passed in a separate capture run.
- Independent Standards and Spec reviews used gpt-6.1-sol at high reasoning. The first Spec review caught application-level retry blockers; those were fixed and both final reviews reported no material findings. The CLI's Windows read-only sandbox initially failed before file access; reviewers were retried with working process access and explicit read-only instructions.
- After Windows CI passed on the rework, `origin/main` at `475e6da2` was merged without conflicts. Its four-file delta concerns socket frames and Devin RPC behavior. Typecheck, lint and notices passed again; the affected socket/Devin files and Claude regressions passed together (160 tests, eight skipped). The app rebuilt and all 16 `tests/e2e/app.spec.ts` cases passed. The PR records Windows CI for the synchronized revision.
- A final recovery assertion reproduced a stale personal-chat uncertainty notice after a confirmed retry. The service now clears that specific notice on confirmation. The three focused safety/service/renderer files passed (81 tests), typecheck/lint/notices passed again, and the rebuilt complete-app personal request case passed. The earlier uncertain decision remains recorded.
- `main` then moved to `64e6fa65`, causing a README conflict that prevented GitHub from starting CI for the latest push. The merge keeps both the incoming project-defaults paragraph and the corrected Claude context/retry paragraphs. Typecheck, lint and notices passed on the combined branch; seven affected files passed (343 tests). After rebuilding, `app.spec.ts`, `new-thread-settings.spec.ts` and `phase-three-personal-requests.spec.ts` passed all 20 cases.

## Rendered check

[The complete app retains the selected answer after a refusal](../../artifacts/thread-activity/personal-requests-retained-choice.png). The synthetic personal chat's question form, selected choice, separate composer and sidebar are readable in the running Electron app. The screenshot establishes the retained choice; the test separately asserts the refusal notice and successful explicit retry.

Activity captures were inspected in light and dark at the minimum width, including reduced motion. Their transcript is readable, but the isolated activity fixture lacks the full sidebar styling and does not establish whole-window design quality. Existing activity captures were restored; no baseline was regenerated.

## Limits

These are scripted-provider checks on Windows. Live Claude background-task ordering and macOS file modes were not checked in this follow-up. The existing permission policy and provider boundaries remain in force; no answer is sent by checking or refreshing.


## Second review

The second review found four remaining defects; all were confirmed in the code.

- A stdin deadline now keeps the original write pending. Check again cannot enable another choice until that write fails outright or the client is gone. A late success removes the pending request and confirms the original personal decision or project question receipt. A native callback error or destroyed pipe ends that in-flight write and permits an explicit retry.
- A queued transcript read runs after the preceding read rejects. Its caller receives its own outcome.
- Committed memory deletions notify the personal service of every purged supersession-chain ID. A client using one of those IDs restarts on the next send, stopping background work. Ordinary retrieval changes continue to wait for background work. The adapter remembers the running context's IDs separately from the latest retrieved set, so a retrieval miss cannot hide a later deletion.
- The guide points to Sotto's Check again, activity and Stop, and explains pending writes and late confirmation. The overview, glossary and personal-chat ADR describe the memory deletion exception.

The delayed-stdin regression failed on the previous PR head: two answers reached the fake CLI instead of one. The queued-read regression also failed there, forwarding the first read's error rather than running its own pass. Additional checks cover late personal decision confirmation, an exact project question receipt, a callback failing after the deadline, destroyed stdin, committed deletion and rollback, subscription disposal, and restarting background work after deletion despite an earlier retrieval miss.

The existing recovery flow was checked in a throwaway state prototype on the local `prototype/claude-delayed-answer` branch at `3942a95b`. Its guided cases cover late success, outright failure and Stop; its rendered layout was inspected. The review itself supplies the required behavior. No production UI layout or design baseline changed.

Second-review checks:

- `npm run typecheck`, `npm run lint` and `npm run notices:verify` passed; notices verified 174 components.
- The final focused Claude safety, request-draft delivery and personal recovery run passed 81 tests. Three late project confirmation cases check the uncertainty banner after no intervening action, a draft save and a newer error.
- `npm run build` and `npx playwright test tests/e2e/thread-activity.spec.ts tests/e2e/phase-three-personal-requests.spec.ts` passed all five cases. The complete-app request journey covers exact approval, a structured answer, an outright refusal and retained input. The activity cases cover failed-turn feedback, keyboard expansion, minimum-width transcript readability, light/dark themes and reduced motion.
- [The complete-app capture](../../artifacts/thread-activity/personal-requests-second-review.png) was inspected. It uses the common request form with a scripted Codex provider and establishes retained input after an outright refusal. The delayed Claude write and its receipts are verified by the adapter/service/coordinator regression tests, not by this image. The isolated activity fixture still lacks full sidebar styling, as recorded above; these captures do not establish whole-window minimum-size design quality. Generated activity captures were restored and no design baseline was regenerated.
- Independent Standards and Spec reviews used gpt-6.1-sol at high reasoning. The Windows read-only sandbox again failed before file access, so both axes were retried with working process access and explicit read-only instructions. Standards found no documented violations; its suggestions to consolidate write state and error-setting were applied. Spec found a stale project uncertainty banner after late confirmation; that regression was observed failing, fixed and extended to preserve newer errors. The final Spec review found no remaining findings. The shared error-setting cleanup then passed the focused 81-test run and typecheck/lint.
- The first full run overlapped review corrections and was cancelled after it picked up mismatched source/test revisions. The fresh `npm test -- --maxWorkers=2` run passed 6,438 tests with 153 skipped (483 files passed, 39 skipped). Windows CI on the final synchronized pushed head is recorded in the PR.

After Windows CI passed on `f6d0fd6d`, `origin/main` at `d343d76a` was merged. The only conflict was the client-update ADR reference beside the new personal-memory deletion hook; both were preserved. The combined branch passed typecheck, lint and notices again. The changed main-branch unit/integration files and five Claude delivery/memory regression files passed together with two workers: 352 tests passed, one live-provider test skipped (22 files passed, one skipped). The app rebuilt, and the personal requests, thread activity and Git action Playwright journeys passed all six cases. The retained-input capture and the incoming Git commit dialog at minimum size were inspected; generated activity captures were restored. The final synchronized Windows CI result is recorded in the PR. Incoming iOS changes are outside the local Windows verification.
