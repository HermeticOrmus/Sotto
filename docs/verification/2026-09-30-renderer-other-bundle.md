# Renderer fixes for host questions, subscriptions, browser tasks and theme imports

Verified on Windows on September 30, 2026, for #538, #545, #560 and #561.

## Regression evidence

The initial four-file Vitest run reproduced all four defects: five failed assertions and 84 passing tests. Escape left the host question visible and sent a disable command, the second settings listener replaced the first, a task summary event sent native mount calls with null then visible bounds, and JSONC local import threw the strict JSON error. The corresponding focused tests pass after the changes. A review regression also reproduced the first dismissed host blocking a second host's question; retaining dismissal per question fixes it, with the saved-host and setup suites passing together (37 tests).

The preload test exercises simultaneous AppContext-like and VoiceSettings-like subscriptions through the real preload bridge, independent unsubscribe, duplicate callbacks and bounded replay. The browser regression drives real browser-store events and checks both uninterrupted mounting and page replacement. Existing JSONC parser tests still check escaped strings, comments, trailing commas and malformed input after its move into shared themes.

## Local gates

`npm run typecheck`, `npm run lint` and `npm run notices:verify` passed (174 notice components). The initial full `npm test -- --maxWorkers=2` run passed 6,456 tests and skipped 153. A fresh full run on the final review correction passed 6,461, skipped 153 and failed one unchanged host-update integration test: `launchScriptUpdate.test.ts` expected rollback to report `restarted: true`, but got `false`. Rerunning that file alone with `--maxWorkers=2` passed 12 tests and skipped one in 6.67 seconds. The test and launch script have no diff against the base commit; neither deadlines nor assertions were changed.

## Electron and visual checks

`npm run build` passed. With `SOTTO_THEMES_E2E=1`, the final selected run passed six journeys from `host-question-dismissal.spec.ts`, `hosts.spec.ts`, `agent-browser.spec.ts` and `phase-three-themes.spec.ts`. The selection was `Escape dismisses|client-only desktop|agents and users|without asking by default|imports JSON|halves, system`.

- The app-shell host dialog receives scripted host transport events through the real preload bridge. Escape sends no host command, the same question stays dismissed, a new question appears, and the explicit Switch it off button sends only the disable command. Both passphrase and host-key dialogs fit at 1600x1000, 1280x800 and 820x560 in light and dark with reduced motion on. The captured minimum-size views were inspected: [passphrase in dark](../../artifacts/renderer-other-bundle/host-passphrase-820-dark.png), [host key in light](../../artifacts/renderer-other-bundle/host-host-key-820-light.png).
- File and pasted VS Code JSON containing line comments, block comments and trailing commas both save to the real theme library. [Imported themes](../../artifacts/renderer-other-bundle/jsonc-imports.png) shows both entries.
- Existing journeys exercise host settings and dictation, shared browser pages and permissions, player focus and settings, theme halves, system appearance, editor, inspector, invalid imports, Open VSX, removal and restart.

No live SSH passphrase, provider prompt or key was used in these checks. The three retained captures were visually inspected. The dialog layout and copy are unchanged. No design baselines were regenerated; existing captures overwritten by the specs were restored. The throwaway host-dismissal behavior prototype is retained locally on `prototype/bh-23-host-question`, outside the implementation branch.

## Existing Electron failures

The broad nine-test run had five passes, three failures and one serially blocked test. The browser viewport test passed when rerun and in the final selection. Three other failures reproduce on the original base commit `cfc4f62d2cdcb762821b1db3d5ea4b0231030405`, built from an archive entirely inside this worktree:

- `agent-browser-player-controls.spec.ts`: the player x coordinate remains 920 after the pointer drag (line 78).
- `phase-three-themes.spec.ts`, spotlight: the idle assertion sees 18 root style updates and 3 spotlights instead of zero (line 444 in this branch).
- `phase-three-themes.spec.ts`, minimized editor, run separately after the serial skip: the bar overlaps Send at 820x560 (line 497 in this branch).

Those tests and assertions were not weakened. They remain outside these four issues.

## Review

The author reviewed the diff for repository standards and the four issue requirements. Optional cleanup of the scratch baseline archive was blocked by automatic approval review; it remains under this worktree's ignored `.cache/.worktrees/` folder. Independent standards and spec reviews used gpt-6.1-sol at high reasoning. The Windows read-only tool sandbox failed to apply its ACLs; retrying with the diff and referenced files supplied directly completed both reviews. Their findings were resolved: the temporary fixup commit was folded into S-065, the ambiguous dismissal state name was replaced, and the multi-host dismissal regression was fixed. The four issue commits remain separate; the final merge records integration with main. The standards reviewer did not receive domain/CI and browser ADR texts on the tool-free retry; the author checked those locally.

## Verification after merging main

The first PR revision passed Gates (Windows) and the Linux host archive/socket check. The requested fetch and merge then brought in current coordinator recovery, desktop key migration and documentation changes without conflicts. Typecheck, lint, notices and the rebuilt app pass on that merged revision. A two-worker Vitest run over every changed unit/integration test file from main plus the seven package regression files passed 614 tests and skipped one (26 files, 97.26 seconds). The same six selected Electron journeys passed again after rebuilding. The minimum-size light host-key capture was inspected again; unrelated design baselines were restored.

## Review rework

The owner selected variant A, the row's **Answer** button, from the read-only `D:/Talk to Text Application/docs/prototypes/host-question-return-prototype.html`. The prototype remains outside this branch. A dismissed saved-host prompt now reads **Waiting for your answer**, with a primary **Answer** before its switch. Answer reopens that exact question; the field takes focus, or **Trust host** for a host-key question. Escape sends no command and brings the row into view with focus on Answer when Hosts is visible. Queued questions retain the current page's focus as a fallback. Hidden Settings panels never scroll or take focus; no notice or strip chip is added.

The first rework regression run failed six checks and passed 33. The final focused run passes 63 tests across the saved-host, setup, app-shell confirmation and buffered-subscription suites. A subscriber throwing during live delivery or replay cannot starve another subscriber, and no exception body or payload is logged.

Typecheck, lint, build and notices pass (174 notice components). `npm test -- --maxWorkers=2` passed 6,511 tests and skipped 153, across 487 passing and 39 skipped files (526 total), with no failures. The fresh final run took 1,133.85 seconds.

The same six selected Electron journeys pass after rebuilding. The host journey now checks Escape ? Answer ? `ssh-answer` for passphrase and host-key questions; password focus and a two-host dismissal sequence over Dictation; no off-page notice or chip; and the waiting row's complete bounds in light/dark at 1600x1000, 1280x800 and 820x560 with reduced motion on. [Waiting row in dark](../../artifacts/renderer-other-bundle/host-answer-820-dark.png) and [in light](../../artifacts/renderer-other-bundle/host-answer-820-light.png) show the focus ring and the switch still on. The two question captures linked above were refreshed to show their answer focus. All five retained captures were inspected. Existing unrelated captures were restored; no baselines changed. Generated runs use ignored `artifacts/renderer-other-bundle-run/`; cited captures live in unignored `artifacts/renderer-other-bundle/`.

Independent Standards and Spec reviews used gpt-6.1-sol at high reasoning. Their read-only Windows sandbox could not initialize its deny-read ACLs, so each completed a tool-free retry with the diff, full changed files, and its full standards or spec documents supplied. Spec reported no findings. Standards reported no documented violations and two low-priority heuristics: duplicated question keys and dialog-to-row DOM coupling. Both were resolved by sharing the key helper and registering the row's focus action with its Answer button. The author checked the resulting diff against both axes and verified the hidden-panel behavior in the running app.

All PR issue comments, reviews and inline comments were read through the three GitHub API endpoints. At this check the only feedback was an automated Cursor usage-limit notice and a Greptile credit-limit notice; there was no additional actionable feedback. Rework commits preserve the PR's pushed history, with the new captures, their relocation and this note in a separate evidence commit.

## CI fixture corrections and current main

The first rework CI run, [36798455710](https://github.com/millZach/Sotto/actions/runs/36798455710), failed two integration checks. The fake Codex server released a held reply before appending its action marker, allowing the parent to receive the reply and retire the server before the assertion could read the marker. Scheduling only the reply in a microtask records the marker and completes synchronous lock cleanup first. A temporary 100 ms pause before the append reproduced the original assertion failure; with the reply queued, the same pause passed. The pause was removed. The immediate assertion remains unchanged.

The ordinary SSH password-reuse fixture expired its shortened 10-second authentication deadline in CI. Ordinary connection tests now inherit the production budgets. Tests specifically exercising deadlines retain explicit short budgets, including the helper-readiness and host-start cases; the suite's global 15-second test deadline remains unchanged. Both CI-failing files passed alone before the correction (46 tests), and all 46 passed after it. Independent Standards and Spec reviews of these fixture corrections found no violations or defects; both used supplied sources without tools and did not claim runtime verification.

Main was integrated at `73b35387`. Typecheck, lint, notices (174 components), build and the same six Electron journeys passed again. The fresh full two-worker suite passed 6,576 tests and skipped 153, with two failures in unchanged `workspace.test.ts` branch-naming checks (490 passing files, one failed and 39 skipped; 1,294.57 seconds). The failure included a cleanup hook timeout after the pending naming callback was not reached. Rerunning that file alone passed all 41 tests in 28.35 seconds. Neither its assertions nor its deadlines were changed. The corrected Codex and SSH checks passed in the full run.

Main then advanced to `6e2afca2`; it was merged without conflicts. Typecheck, lint, notices and build passed on that revision. Its nine changed unit/integration files passed 181 tests, and its file-browser and spellcheck-privacy Electron journeys both passed. The same six selected host, browser and theme journeys also passed again (1.4 minutes). The four regenerated host captures after the first integration match their retained assets byte for byte. Unrelated captures overwritten by the specs were restored; no design baselines were changed.

The next Windows run, [36802571905](https://github.com/millZach/Sotto/actions/runs/36802571905), passed 6,611 tests and skipped 150, but failed the unchanged host-update restart assertion at `launchScriptUpdate.test.ts:138`. The corrected Codex and SSH checks, and both workspace checks that failed locally, passed in CI. The host-update file then passed all 12 tests with one Windows platform skip alone in 9.42 seconds. This launcher and fixture have no diff against main; the same transient restart failures are recorded in the existing coordinator-recovery verification note. The CI output omitted the returned error's reason, so its cause remains unverified. No readiness assertion or deadline was changed.

Main advanced to `a43ce556` while CI ran. Its thread/diagram changes were merged; the guide conflict was resolved by preserving both JSONC import and diagram guidance. The five changed test files plus the host-update file passed 69 tests with one platform skip in 11.05 seconds. Typecheck, lint, notices and build passed again, as did the six selected Electron journeys (1.3 minutes). All four freshly generated host captures still match the retained evidence byte for byte. Unrelated generated captures were restored.
