# Worktree registry coordination (#441)

Concurrent worktree creation can expose a peer checkout's partially written `commondir`. Sotto now coordinates registry commands across its thread and terminal services by the canonical common Git directory. Linked project roots share a queue; unrelated repositories and ordinary status/ref reads continue independently. Registry reads, add, prune and removal, plus branch rename and switch, wait for the preceding command to finish.

The queue preserves each command's result or rejection, removes completed entries, and does not retry. Existing path ownership, exact registration, branch collision, reuse, user-edit and permission checks are unchanged. Coordination is within one host process; unrelated Git processes are still governed by Git's own behavior, and corrupt metadata remains an error.

## Causal evidence

PR #427's hosted Windows run failed while concurrent `ensure` calls added different reserved worktrees: `fatal: failed to read .git/worktrees/<peer>/commondir: No error`. The run reported 5,889 passing tests, 140 skipped and one failure. It did not capture the metadata contents.

A bounded synthetic witness through real `ThreadWorktrees.ensure` and real Git 2.53.0.windows.2 held a peer registration at an empty `commondir`, with `locked: initializing` and the linking files that Git writes first. Concurrent creation reproduced the exact fatal message; serializing the identical setup succeeded. Source user edits survived both runs. The two-test witness completed in 3.49 seconds. [Concurrent receipt](../../artifacts/review-441/commondir-concurrent.json), [serialized control](../../artifacts/review-441/commondir-serialized.json).

This establishes a causal way to produce the hosted symptom, not forensic certainty about that run's uncaptured file contents. Git's [creation sequence](https://github.com/git/git/blob/master/builtin/worktree.c) and [common-directory reader](https://github.com/git/git/blob/master/setup.c) support the selected partial-registration boundary.

A second real-Git probe confirmed branch rename, branch switch and worktree listing also fail on that partial file. Status, reading the current branch and discovering the common directory succeed, so those reads remain outside the queue. [Command receipts](../../artifacts/review-441/mutator-receipts.json).

## Verification

The new regression uses two service instances and different linked project roots, with an unrelated repository completing while the first registration is held. Before the fix, one setup was rejected; the rejected-add queue-release control passed. The baseline/probe run took 7.98 seconds. Every fixture is synthetic and owned; diagnostic test copies were removed from discovery.

Corrected focused verification passed all 53 tests across `threadWorktrees.test.ts`, `terminalWorkspace.test.ts` and `threadWorktreesNative.test.ts` (three files, 60.85 seconds, two workers). This includes the formerly red linked-root regression, ordinary concurrent dirty-source setup, real native provider working-copy isolation, restore/reuse and rejection handling. Three-project typecheck, lint and notices verification (174 components) passed sequentially. Independent Standards/Spec reviews and composed full/desktop verification are pending. No visual surface or design baseline changed.
