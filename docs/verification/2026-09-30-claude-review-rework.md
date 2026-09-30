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

## Rendered check

[The complete app retains the selected answer after a refusal](../../artifacts/thread-activity/personal-requests-retained-choice.png). The synthetic personal chat's question form, selected choice, separate composer and sidebar are readable in the running Electron app. The screenshot establishes the retained choice; the test separately asserts the refusal notice and successful explicit retry.

Activity captures were inspected in light and dark at the minimum width, including reduced motion. Their transcript is readable, but the isolated activity fixture lacks the full sidebar styling and does not establish whole-window design quality. Existing activity captures were restored; no baseline was regenerated.

## Limits

These are scripted-provider checks on Windows. Live Claude background-task ordering and macOS file modes were not checked in this follow-up. The existing permission policy and provider boundaries remain in force; no answer is sent by checking or refreshing.
