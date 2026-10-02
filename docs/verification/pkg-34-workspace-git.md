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

The resumed Spec review found that a draft choosing Previous worktree skipped pending-work checks until allocation. Its regression allowed a pull before the correction; it now refuses the pull and refuses the draft's first send before allocation while a mutation holds that checkout.


## October 1 review rework

All eight requested changes have individual commits. Sends now identify the checkout holder and state that the message was not sent. The controller keeps a refused manual prompt in recovery and restores it to an empty composer; a newer composer draft remains intact. A refused follow-up remains failed in its queue until the user resumes it. Automatic pull retains its original refusal on the thread's Git action record.

Manual and automatic folder removal succeed with failed history and retained follow-ups, while retaining the existing ownership, live-work and terminal checks. Checkout identity has one implementation, with nearest-.git fallback when Git refuses discovery. Candidate filtering skips unrelated and archived threads before Git discovery and caches identities within an operation. Automatic settling takes a read reservation so sibling sends proceed.

Local PR checkout reserves its destination and checks pending work and checkpoint recovery before changing the draft binding. An independent Spec review found that a temporary binding could leak through an unrelated save during asynchronous preflight. The added barrier regression reproduced that saved-state race before the correction. It now checks both saved and live state while preflight is held. The 56 focused workspace-mutation, checkpoint and checkpoint-integration tests pass.

The standalone recovery-copy prototype is retained on the local `prototype/bh-34-checkout-refusals` branch at `5b35ac0e`, outside the product branch. The actual app regression holds a real commit in an owned Git hook, sends from a sibling, checks that the provider received nothing, and verifies one successful retry after the action finishes. Captures cover light and dark at 1600x1000, 1280x800 and 820x560; the retry also runs with reduced motion. Inspected the minimum-size dark capture and medium-size light capture below, as well as the minimum-size light and full-size dark captures during the preceding run. No layout changes or design-baseline regeneration were needed.

- [Refused send at minimum size, dark](../../artifacts/pkg-34-workspace-git/refused-send-820-dark.png)
- [Refused send at medium size, light](../../artifacts/pkg-34-workspace-git/refused-send-1280-light.png)

Separate final Standards and Spec reviews found no remaining actionable findings. All GitHub issue comments, reviews and inline comments were read; the queued-tip finding is fixed in `479223bb` and already answered. Automated usage/credit-limit notices did not provide review findings.

Known limitations: the status refresh within a held Git-action guard can defer automatic pull until the next poll. Merged cleanup still requires the exact PR head to match the local tip, so a GitHub-updated merged PR may retain its folder until the user pulls. Both remain conservative and are disclosed in the PR.

The final build and all 13 Git-action, checkpoint, workspace and worktree Playwright journeys passed together with one Electron worker. Typecheck, lint and notices passed; notices cover 174 components. Generated overwrites of earlier captures were restored. Only the two refused-send images cited above are added.


A later GitHub review found that the headless host's local PR preflight omitted the requesting unallocated draft from pending-work checks. The regression pauses PR lookup, queues the first real host send without desktop checkpoint wiring, and checks that checkout never reaches Git and the queued prompt starts in its independent folder. It reproduced the shared-folder checkout before the correction. The mutation reservation now always checks its requesting thread as well as discovered siblings. All 64 tests in workspace mutations, workspace behavior and checkpoint integration pass; both review axes found no remaining issue in this correction.
