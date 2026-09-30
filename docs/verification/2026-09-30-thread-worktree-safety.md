# Thread worktree removal, restore and setup recovery

Package pkg-03: #485 (S-003), #506 (S-026), #507 (S-027). Windows verification uses real Git, synthetic projects, a fixture provider and the built Electron app. No personal profile or live provider was used. Actual macOS execution remains unverified.

## Accepted removal question

The owner chose variant B, **List and tick**, in the removal-question prototype. The implemented layout keeps that decision. The implemented question was visually compared with B.

The Electron journeys check:

- A clean question says the branch stays and sending restores the folder. Escape keeps it.
- Ignored items appear as relative paths; installed dependencies do not. Each ignored folder has one size/file-count row. The single-item label uses **Delete this 1 ignored item with the folder**.
- The callout says **These files are ignored by Git and are deleted with the folder:**. The button says **Remove with these files** and requires the separate tick.
- Adding another ignored path, or adding a file inside an already listed folder, refuses removal. The pane and Settle questions show main's folder-change message and ask for Remove worktree again to see the new list.
- Nested work is flagged with a plain count of uncommitted changes, without raw Git status. Repositories also show commits not on any remote. The tick names repositories or worktrees and uses the plural for several. The checked tick uses the danger theme role. Escape preserves the nested files; later acknowledged removal deletes them with the folder.
- Dirty removal keeps the branch; the next send restores the committed checkout. Settle asks the same question, and Keep folder preserves it.

Checked at 1600x1000, 1280x800 and 820x560, light and dark, with reduced motion on and off. Heading, tick and actions remain visible at the minimum. Recaptured and visually inspected:

- `artifacts/reclaim-worktrees/ignored-items-1600x1000-dark-no-preference.png`
- `artifacts/reclaim-worktrees/ignored-items-1280x800-light-no-preference.png`
- `artifacts/reclaim-worktrees/ignored-items-820x560-dark-reduce.png`
- `artifacts/reclaim-worktrees/ignored-items-820x560-light-reduce.png`
- `artifacts/reclaim-worktrees/nested-items-1600x1000-light.png`
- `artifacts/reclaim-worktrees/nested-items-820x560-dark.png`

These six captures are deliberate evidence for the changed question. Incidental captures were restored; design baselines were not regenerated.

## Main and transport regressions

Removal compares the confirmed ignored folder rows and nested-change counts with disk. Added or removed files inside an acknowledged ignored folder refuse removal. Existing cache files may be rewritten; byte sizes are not compared. New ignored or untracked paths injected during the final filesystem walk are refused by the Git re-list immediately before removal. Ignored and untracked nested repositories/worktrees require the tick. Synthesized nested rows count ignored contents too. Acknowledged nested worktrees are deleted, then their own repositories clear only those registrations; their branches and unrelated missing registrations remain. Locked nested worktrees refuse before deletion. A bare repository inside dependency content also requires acknowledgement. Outside links still block removal.

Clean initialized submodules, including recursive submodules, are classified against their containing index and can be reclaimed automatically. A dirty submodule hidden by user Git settings still produces a truthful warning and can be removed only with explicit acknowledgement. The clean-settle refusal tells the user to choose Remove worktree, without referring to an unopened question.

Coordinator and authenticated socket tests prove that the preview is returned only to the requesting command: it is not saved, broadcast or cached, and another paired client never receives it. Router tests cover older hosts returning no preview or refusing the command with a plain update message.

Restoring a missing checkout removes only that checkout’s registration; other missing worktrees keep theirs. Setup retains its five-minute add deadline and ordinary commands keep thirty seconds. The writing-grandchild regression fails with single-process termination and passes with whole-tree termination. Cleanup waits for exit and successful tree termination; a failed taskkill returns a refusal and keeps the folder.

Existing recovery regressions cover complete/partial initialization, missing and unfinished indexes, local edits, a 28,000-entry branch tree and committed internal links. The Windows internal-link test uses Git’s file representation with `core.symlinks=false`; its POSIX branch uses real symlinks.

## Review and gates

Separate read-only `gpt-6.1-sol` reviews at high reasoning checked Standards and Spec. They found remote preview reply loss/cache propagation, final-list timing, recursive submodules, stop-failure handling and inconsistent submodule visibility. All findings were fixed and rechecked. The parent inspected the integrated diff and rendered captures.

Full-suite worktree fixes: `cc52060b`.

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test -- --maxWorkers=2`: 6,416 passed, 153 skipped; 483 files passed, 39 skipped. No failures.
- `npm run notices:verify`: passed, 174 components.
- `npm run build` and `npx playwright test tests/e2e/thread-worktrees.spec.ts --workers=1`: all five passed.
- Final focused worktree/timeout regressions: all 50 passed.

`origin/main` at `ff2c8c9e` was merged without conflicts before these final checks.

The earlier full run overlapped review edits and failed four new cases: prompt refusal after failed taskkill, setup/restore registry coordination, clean recursive submodule removal and a bare repository inside dependency content. Those cases passed on corrected, committed source before the fresh final full run. The initial run also reported an after-test cleanup error for the taskkill fixture. No deadline was shortened and no assertion was skipped to pass the gates.

Subsequent `origin/main` changes were merged without conflicts: socket frames (`475e6da2`), retained-history deletion (`cb38c1bd`) and project working-copy defaults (`64e6fa65`). Affected regression runs passed 77 socket/preview tests, 214 history/IPC/removal tests and 153 settings/worktree tests. Built Electron runs passed all 22 app/thread journeys after the history merge, and all seven new-thread-settings/thread journeys after the defaults merge. Typecheck, lint and notices passed again on the latest merged source. The removal question is unchanged; incidental recaptures were restored to the six verified variant B captures.

## Second-review evidence

All five second-review items are implemented in new commits after `70e483f3`. Confirmed rows carry file counts through both questions and remote commands; comparison happens inside the registry lane and excludes bytes. Nested repository history counts all local refs not reachable from remote refs, including alternate branches, tags and bare repositories with unborn HEAD. Tick suffixes cover singular, plural and mixed nested kinds. This note no longer refers to a local prototype path.

The Electron unseen-file regression exposed generic failure text hiding main's refusal; both questions now show the specific message. Visual inspection exposed the longer history warning squeezing the nested path; nested columns now wrap within bounded widths. The minimum-window regression checks the path remains readable. All six cited captures were recaptured and inspected; incidental captures were restored and design baselines were not regenerated.

Final `npm run build` and `npx playwright test tests/e2e/thread-worktrees.spec.ts --workers=1` passed all five journeys. Typecheck, lint and notices verification passed; notices still cover 174 components. Renderer removal regressions passed all 14 cases. Separate read-only Standards and Spec reviews found no unresolved findings after the history, lock, error-message and layout fixes.

An earlier overlapping full-suite attempt hit the existing recursive-submodule test deadline. All three initialized-submodule cases passed when run alone; no deadline or assertion changed. The final `npm test -- --maxWorkers=2` run on `ca896ae3` passed 6,452 tests with 153 skipped; 483 files passed and 39 were skipped. No failures.

Main advanced to `dee39cf3` during verification and GitHub reported a merge conflict, preventing the new CI run. It was merged in `c8e487c5`; the only conflict was README copy, resolved by retaining both the staging explanation and removal warnings. All 329 affected tests across 16 worktree, timeout, renderer, host transport, IPC, Git and SSH files passed. Typecheck, lint and notices passed again. Both reviewers found no merge regression. These main changes leave the accepted removal question and its six retained captures unchanged.
