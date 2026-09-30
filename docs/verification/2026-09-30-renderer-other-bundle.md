# Renderer fixes for host questions, subscriptions, browser tasks and theme imports

Verified on Windows on September 30, 2026, for #538, #545, #560 and #561.

## Regression evidence

The initial four-file Vitest run reproduced all four defects: five failed assertions and 84 passing tests. Escape left the host question visible and sent a disable command, the second settings listener replaced the first, a task summary event sent native mount calls with null then visible bounds, and JSONC local import threw the strict JSON error. The corresponding focused tests pass after the changes. A review regression also reproduced the first dismissed host blocking a second host's question; retaining dismissal per question fixes it, with the saved-host and setup suites passing together (37 tests).

The preload test exercises simultaneous AppContext-like and VoiceSettings-like subscriptions through the real preload bridge, independent unsubscribe, duplicate callbacks and bounded replay. The browser regression drives real browser-store events and checks both uninterrupted mounting and page replacement. Existing JSONC parser tests still check escaped strings, comments, trailing commas and malformed input after its move into shared themes.

## Local gates

`npm run typecheck`, `npm run lint` and `npm run notices:verify` passed (174 notice components). The initial full `npm test -- --maxWorkers=2` run passed 6,456 tests and skipped 153. A fresh full run on the final review correction passed 6,461, skipped 153 and failed one unchanged host-update integration test: `launchScriptUpdate.test.ts` expected rollback to report `restarted: true`, but got `false`. Rerunning that file alone with `--maxWorkers=2` passed 12 tests and skipped one in 6.67 seconds. The test and launch script have no diff against the base commit; neither deadlines nor assertions were changed.

## Electron and visual checks

`npm run build` passed. With `SOTTO_THEMES_E2E=1`, the final selected run passed six journeys from `host-question-dismissal.spec.ts`, `hosts.spec.ts`, `agent-browser.spec.ts` and `phase-three-themes.spec.ts`. The selection was `Escape dismisses|client-only desktop|agents and users|without asking by default|imports JSON|halves, system`.

- The app-shell host dialog receives scripted host transport events through the real preload bridge. Escape sends no host command, the same question stays dismissed, a new question appears, and the explicit Switch it off button sends only the disable command. Both passphrase and host-key dialogs fit at 1600x1000, 1280x800 and 820x560 in light and dark with reduced motion on. The captured minimum-size views were inspected: [passphrase in dark](../../artifacts/review-pkg-23/host-passphrase-820-dark.png), [host key in light](../../artifacts/review-pkg-23/host-host-key-820-light.png).
- File and pasted VS Code JSON containing line comments, block comments and trailing commas both save to the real theme library. [Imported themes](../../artifacts/review-pkg-23/jsonc-imports.png) shows both entries.
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
