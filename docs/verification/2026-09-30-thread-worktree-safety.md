# Thread worktree removal, restore and setup recovery

Package pkg-03: #485 (S-003), #506 (S-026), #507 (S-027). Windows verification uses real Git, synthetic projects, a fixture provider and the built Electron app. No personal profile or live provider was used. Actual macOS execution remains unverified.

## Accepted removal question

The owner chose variant B, **List and tick**, in `D:/Talk to Text Application/docs/prototypes/reclaim-and-mic-test-prototype.html`. The file was read and rendered directly from the main checkout, read-only; it was not copied into this branch. The implemented question was visually compared with B.

The Electron journeys check:

- A clean question says the branch stays and sending restores the folder. Escape keeps it.
- Ignored items appear as relative paths; installed dependencies do not. Each ignored folder has one size/file-count row. The single-item label uses **Delete this 1 ignored item with the folder**.
- The callout says **These files are ignored by Git and are deleted with the folder:**. The button says **Remove with these files** and requires the separate tick.
- Adding another ignored path while the question is open refuses removal. Reopening reads the new list.
- Nested work is flagged with a plain count of uncommitted changes, without raw Git status. The tick adds **, including the nested worktree’s uncommitted work**. The checked tick uses the danger theme role. Escape preserves the nested files; later acknowledged removal deletes them with the folder.
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

Removal compares the confirmed ignored folder rows and nested-change counts with disk. New cache files inside an acknowledged ignored folder are accepted. New ignored or untracked paths injected during the final filesystem walk are refused by the Git re-list immediately before removal. Ignored and untracked nested repositories/worktrees require the tick; an acknowledged nested worktree is deleted. A bare repository inside dependency content also requires acknowledgement. Outside links still block removal.

Clean initialized submodules, including recursive submodules, are classified against their containing index and can be reclaimed automatically. A dirty submodule hidden by user Git settings still produces a truthful warning and can be removed only with explicit acknowledgement. The clean-settle refusal tells the user to choose Remove worktree, without referring to an unopened question.

Coordinator and authenticated socket tests prove that the preview is returned only to the requesting command: it is not saved, broadcast or cached, and another paired client never receives it. Router tests cover older hosts returning no preview or refusing the command with a plain update message.

Restoring a missing checkout removes only that checkout’s registration; other missing worktrees keep theirs. Setup retains its five-minute add deadline and ordinary commands keep thirty seconds. The writing-grandchild regression fails with single-process termination and passes with whole-tree termination. Cleanup waits for exit and successful tree termination; a failed taskkill returns a refusal and keeps the folder.

Existing recovery regressions cover complete/partial initialization, missing and unfinished indexes, local edits, a 28,000-entry branch tree and committed internal links. The Windows internal-link test uses Git’s file representation with `core.symlinks=false`; its POSIX branch uses real symlinks.

## Review and gates

Separate read-only `gpt-6.1-sol` reviews at high reasoning checked Standards and Spec. They found remote preview reply loss/cache propagation, final-list timing, recursive submodules, stop-failure handling and inconsistent submodule visibility. All findings were fixed and rechecked. The parent inspected the integrated diff and rendered captures.

Final committed source: `cc52060b`.

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test -- --maxWorkers=2`: 6,416 passed, 153 skipped; 483 files passed, 39 skipped. No failures.
- `npm run notices:verify`: passed, 174 components.
- `npm run build` and `npx playwright test tests/e2e/thread-worktrees.spec.ts --workers=1`: all five passed.
- Final focused worktree/timeout regressions: all 50 passed.

`origin/main` at `ff2c8c9e` was merged without conflicts before these final checks.

The earlier full run overlapped review edits and failed four new cases: prompt refusal after failed taskkill, setup/restore registry coordination, clean recursive submodule removal and a bare repository inside dependency content. Those cases passed on corrected, committed source before the fresh final full run. The initial run also reported an after-test cleanup error for the taskkill fixture. No deadline was shortened and no assertion was skipped to pass the gates.
