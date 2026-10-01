# Renderer thread recovery and previews

Windows verification for package 19, from `origin/main` at `2f1d74f240cbcd2b3ab6a1b0e5a212111ccc5221`.

- S-028: the sidebar regression moves a thread to the closed Settled shelf before its settle command resolves. The question remains, Keep folder and Escape keep the worktree, removal invokes reclaim, and closing returns keyboard focus to Settled. The real Electron reclaim journey also checks removal, branch retention and restoration on send. Its settle step now presses the sidebar row, covering the original failure.
- S-070: renderer journeys retain submitted prompts, unsent text, staged handles and newer typing after creation refusal. Recovery survives leaving Threads for Settings, merges with an existing draft in a reused empty thread, and follows screenshots still staging before or after reopening. A store regression recovers a lost acknowledgement into the original thread without a self-redirect or duplicate text. Nothing is sent automatically. Unowned screenshot bytes retain ADR-0031's one-hour grace period.
- S-087: large-preview regressions fail on the old count-only caches and pass with an eight-MiB byte bound on each cache. Both validation keys and resolved fetch results are bounded; an individually oversized image renders without being retained.
- Spec review found and fixed a lost-reply race: main can publish a new thread and release its sends before the creation reply is lost. Published creation now prevents recovery into another thread. The regression failed before the guard; all 96 related renderer tests passed afterward.
- S-066 needs no patch: ADR-0042's September 28 amendment already keeps working threads running during updates and ignores the legacy `force` field. The existing client-card and Providers regressions passed (29 tests); issue #539 has the skip explanation.

The existing List and tick removal question was inspected at 1600×1000, 1280×800 and 820×560, with light, dark and reduced motion. No restyle or design-baseline regeneration was intended. Retained captures:

- [Sidebar settle question](../../artifacts/bh-pkg-19/settle-asks.png): the row has moved to Settled and the separate question is still visible.
- [Minimum window, light and reduced motion](../../artifacts/bh-pkg-19/ignored-items-820x560-light-reduce.png): the ignored item, separate acknowledgement and actions fit.
- [Large window, dark](../../artifacts/bh-pkg-19/ignored-items-1600x1000-dark.png): the same List and tick question in the dark theme.

The owner prototype named by ADR-0041 is absent from this checkout; the accepted ADR and existing real components supplied its behavior and copy. A throwaway state walkthrough is retained on the local `prototype/bh-19-recovery` branch, commit `cddaa7f881886ea4932fa6c54f7d1dd946a6d136`, outside the implementation branch.

Local limitations: the submitted `screen.png` preview assertion in `thread-creation.spec.ts` failed twice on the patched build and also on a build using the starting main sources, all in this worktree. Three initialized-submodule removal cases timed out on an early targeted rerun; the subsequent complete-file isolated rerun passed all 67 tests. Those main/shared/test sources are byte-identical to the starting main commit. No deadline or assertion was weakened. Full gate results and latest CI status are recorded in the pull request.
