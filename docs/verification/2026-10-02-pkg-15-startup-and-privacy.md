# Startup and privacy fixes

Verified on Windows in `fix/bh-15-index`, after all five package fixes.

## Regression checks

- History-off cleanup reaches both the coordinator and personal chats when either fails, then delivers the saved settings notification.
- A failed thread-store redaction rejects to the coordinator. Its next maintenance retry removes the retained words from the real SQLite file without restarting.
- After the [PR privacy finding](https://github.com/millZach/Sotto/pull/675#issuecomment-5947630010), activity and legacy-message writes share the event path's guard. Regressions fail redaction once, flush new private words before retry, and inspect SQLite and the saved files. They cover both waiting for retry and turning history back on first; an unfinished redaction still completes before durable writes resume. The follow-up standards review found legacy snapshots could replay private words after retention resumed. Private message identities now stay in memory across the transition; tests keep replaying those messages, including later text updates, and verify only fresh messages and activity are retained. A successful transition is covered too.
- Host and personal-chat startup failures drain every acquired handle. Phone access closes before the host it serves.
- A failed title request logs only `thread-title-failed` and `failed`, even when the provider error contains private text and a path.
- Only the single-instance lock owner prepares legacy user data, before runtime initialization reads it.
- Agent activity still reveals the widget with the idle setting off, as the owner's docs-only decision requires. No reveal rule changed.

The focused regression tests were observed failing before the corresponding fixes and passing afterward. Initial independent standards and spec reviews found no findings; the follow-up standards finding above was reproduced and fixed. The read-only review CLI could not apply its Windows sandbox ACLs; read-only reviewer agents completed both reviews instead.

## Running application

`npm run build` passed. `npx playwright test tests/e2e/app.spec.ts tests/e2e/settings-index.spec.ts tests/e2e/phones.spec.ts` passed all 19 checks with one worker. These cover onboarding, dictation and history off, settings persistence and failure feedback, widget hide/reveal, single-instance activation, quit/drain/relaunch, and phone setup/pairing/disable.

The Settings journey exercised light, dark and reduced motion at 1600×1000, 1280×800 and 820×560. No UI changed; no evidence images or replacement design baselines are included.

The provider and phone effects are scripted. This proves application behavior through the built Electron boundaries, not a live provider, SSH host or Tailscale account. S-115 required no patch: the obsolete memory-probe launch branch and raw-error log were already removed on `main`, as ADR-0003 and `CONTEXT.md` record; issue #587 has the skip explanation.
