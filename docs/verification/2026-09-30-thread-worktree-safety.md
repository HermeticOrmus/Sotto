# Thread worktree removal, restore and setup recovery

Package pkg-03: #485 (S-003), #506 (S-026), #507 (S-027). Verified on Windows with real Git and the built Electron app using synthetic projects and the fixture provider. No personal profile or live provider was used.

## Removal question

The owner's decision is prototype variant B: list ignored items other than installed dependencies and require **Delete these N ignored items with the folder** before enabling removal. The named `docs/prototypes/reclaim-and-mic-test-prototype.html` is absent from this checkout, its Git history and GitHub main (the contents API returns 404). The issue's explicit behavior and copy supplied the reference; this note does not claim a visual comparison with the missing file.

The Electron worktree specification passed all five journeys. The affected removal journey was repeated after the review fixes. It checks:

- A clean removal question keeps the branch, and Escape keeps the folder.
- An ignored `.env` appears, installed dependencies do not, and the red Remove button is disabled until the checkbox is checked. Space operates the checkbox.
- Adding another ignored file while the question is open refuses removal and keeps both files. Closing and reopening reads the new list.
- A nested repository is flagged with `?? unsaved.txt`; acknowledgement still leaves removal disabled, and Escape keeps its work.
- The user's confirmation can remove ordinary ignored files and uncommitted changes. The branch stays; the next send restores the committed checkout.
- Settle uses the same question, and Keep folder preserves the checkout.

Checked at 1600x1000, 1280x800 and 820x560, in light and dark and with reduced motion on and off. The minimum-size question keeps its heading and actions visible while its description scrolls. New colors use the existing theme tokens; the checkbox accent follows the selected theme.

Retained captures in `artifacts/reclaim-worktrees/`:

- `ignored-items-1600x1000-dark-no-preference.png`
- `ignored-items-1280x800-light-no-preference.png`
- `ignored-items-820x560-dark-reduce.png`
- `ignored-items-820x560-light-reduce.png`
- `nested-items-1600x1000-light.png`
- `nested-items-820x560-dark.png`

These are deliberate evidence for the changed question. Incidental changes to existing captures were restored; design baselines were not regenerated.

## Main-process regressions

- Removal requires the exact displayed ignored set, including an initially empty list. Automatic cleanup refuses nondependency ignored files. Ignored and untracked nested repositories and worktrees are discovered and cannot be reclaimed even with confirmation.
- Restoring a missing thread checkout removes only its own Git registration. Another missing personal checkout keeps its registration and branch protection.
- Worktree add has a five-minute deadline; ordinary Git commands keep their existing deadline. Timeout cleanup acts only on the reserved path in the original repository still locked as initializing, under the registry lane.
- Complete and partial initialization can recover and retry on the same branch. A missing index and an unfinished index lock are covered. Added files and edits to tracked files are preserved rather than forced away.
- A real 28,000-entry branch tree exercises recovery beyond the Git output limit. Only files actually present are queried, in literal batches; the fixture constructs the tree with `mktree` rather than checking out thousands of files.
- Committed links inside the checkout can recover. The Windows regression uses Git's normal file representation with `core.symlinks=false`; the same test uses a real symlink on other platforms. Actual macOS execution remains unverified.

The stronger partial-index and local-edit regressions failed against the resumed timeout draft and passed after correction. The large-tree regression passes after changing the tree read to bounded batches. The regression subset also fails against main's original implementation for all three entries.

## Review and gates

The standards and spec reviews were separate, read-only `gpt-6.1-sol` reviews at high reasoning. They found the unthemed checkbox, nonignored nested repositories, full-tree output overflow and internal committed links. Each finding was fixed and checked again. The parent also reviewed the integrated diff against AGENTS.md and the three entries.

Final gates before opening the pull request:

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test -- --maxWorkers=2`: 483 files passed, 39 skipped; 6,400 tests passed, 153 skipped, no failures.
- `npm run notices:verify`: passed, 174 components verified.
- `npm run build`: passed. `npx playwright test tests/e2e/thread-worktrees.spec.ts --workers=1`: all five passed. The removal journey passed again after the final layout change.

The first full run had two failures: the existing branch-naming poll in `workspace.test.ts` passed alone and then with its full file; the new nonignored nested-repository renderer case ran while its implementation was being updated. Both files passed on the final source, and the fresh complete run above passed without changing any deadline or skipping an assertion.

Reviewer fixture cleanup was rejected by automatic approval review with only **rejected: blocked by policy**. Two review-only folders remain outside the checkout: `%TEMP%/sotto-spec-review-Ejsgn0` and `%TEMP%/sotto-spec-review-tjOzwF`. No bypass or further deletion was attempted.
