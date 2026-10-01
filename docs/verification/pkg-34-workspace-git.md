# Shared-checkout Git protection and merged-work cleanup

Verified on Windows on 1 October 2026 in the pkg-34 worktree.

## Regression checks

Real Git tests hold a Git action while a sibling send and branch restore are refused, hold a send acknowledgement while Git is refused, and exercise pending work, subdirectories and separate worktrees. A deleted owned worktree restores on send and reserves its recorded root, including when the project lives in a subdirectory. These checks run through WorkspaceHost without desktop checkpoint wiring, as the headless runtime does.

Checkpoint tests reserve the checkout before file validation and keep it through rollback and recovery. An uncertain checkpoint blocks another thread in a subdirectory of that checkout. An inaccessible legacy recovery record leaves unrelated projects usable.

Merged-PR tests reject reused branch names and fork PRs with another tip, accept the exact current commit, and reject a tip that advances during the lookup or between cached cleanup decisions.

## Running app

`npm run build` and the Git actions, phase-four checkpoints and thread-workspace Playwright specs passed all six tests. The journeys cover commit, push, PR creation, pull, Git initialization, checkpoint file/conversation revert, manual sends, queued follow-ups and settled threads. Git dialogs also exercise keyboard opening, Escape, focus return, light and dark themes, reduced motion and the 1600x1000, 1280x800 and 820x560 sizes.

Inspected the minimum-size Git action capture and checkpoint captures at minimum size in light mode and full size in dark mode. The checkpoint review scrolls within its pane at minimum size. No layout or baseline changes were intended.

- [Git action at minimum size, dark](../../artifacts/pkg-34-workspace-git/git-820-dark.png)
- [Checkpoint review at minimum size, light](../../artifacts/pkg-34-workspace-git/checkpoint-820-light.png)
- [Checkpoint review at full size, dark](../../artifacts/pkg-34-workspace-git/checkpoint-1600-dark.png)

## Review

Separate Standards and Spec reviewers found and prompted fixes for early reservation, missing-worktree identity, shared checkpoint exclusions and current-tip cache invalidation. The PR review then reproduced a stale merged-tip decision queued behind a commit action. A real GitActions regression holds commit drafting, queues reclaim or auto-settle, advances the branch and verifies that the folder and unsettled thread remain. The validated tip now crosses that queue boundary and is checked under the checkout guard. Live providers were not used; fixtures and real Git repositories supplied the concurrency scenarios.
