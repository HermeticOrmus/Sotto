# Branch input repairs

Package pkg-25 fixes #520, #541 and #542. The controls, copy and theme roles are unchanged. No setting, permission, host or provider behavior was added; these repairs follow ADR-0014, ADR-0018, ADR-0027 and ADR-0033. The guide now names the copy actions and the keyboard behavior.

## Regression evidence

Four copy regressions failed before the fix with browser clipboard writes denied. They now pass through main's copy-only output bridge for branch names, pull request links, phone addresses and terminal selections.

Ten composition cases failed before the fix: both `isComposing` and keyCode 229 in the branch picker (loaded and pending searches), project chooser, thread rename and new-folder field. They now leave the action for a separate Enter. The existing composer uses the same extracted guard.

Four search regressions failed before the fix: clearing a search, editing after a pending Enter, changing the current thread's state before Enter, and a late search response. A fifth test checks that a pending Enter cannot act after switching threads and that a fresh Enter still works in the new thread.

## Built Windows app

The `thread-worktrees.spec.ts` shared-checkout journey passed with added assertions for the main-owned clipboard, restoring all refs after clearing and both composition signals. The existing journey also checks switching and creating branches, Git refusal, workspace choices and keyboard focus. The other four worktree journeys, the phone-settings journey and the host-folder-browser journey passed in the initial selected-spec run.

The branch picker was captured at 1600×1000, 1280×800 and 820×560 CSS pixels in dark and light with reduced motion enabled. The search and restored main ref stay in the viewport, with no document overflow. These retained captures were inspected:

- [Minimum size, dark](../../artifacts/new-thread-setup/pkg25-branch-820x560-dark.png)
- [Minimum size, light](../../artifacts/new-thread-setup/pkg25-branch-820x560-light.png)
- [1280×800, dark](../../artifacts/new-thread-setup/pkg25-branch-1280x800-dark.png)

IME verification uses browser keyboard events, rather than a hands-on Japanese or Chinese operating-system input session. No design baseline was regenerated.

The selected Electron run initially had 6 passes and 3 failures. The branch test's clipboard assertion was corrected to read the existing private main-process E2E clipboard; its complete journey then passed. The remaining failures reproduce both alone on this branch and in an archived source build of starting commit `64e6fa658347e05463dada00e2e01236b1819f2c`, inside this worktree: `pull-request-surface.spec.ts` still waits for the removed Create thread button, and `terminal-display.spec.ts` looks up the unqualified workshop ID after host qualification. Both fail during setup, before reaching the changed controls. They are left intact rather than changing thread-creation fixtures in this package.

The focused renderer run passed 124 tests in 9 files. Typecheck, lint, build and notices verification passed. The full two-worker run had a host-update timeout in `sshLauncher.test.ts`; its isolated rerun passed all 40 tests without changing the test or its deadline.

## Review

The standards pass checked privacy, main-owned clipboard delivery, existing permission gates, keyboard paths, theme roles, test placement and UTF-8 encoding. It removed an unused test-mock parameter found by lint. The spec pass checked all four copy callers, all four composition fields, empty-query reload, pending-Enter cancellation and current callback dependencies. It also added late-response and thread-change coverage.
