# Startup and privacy fixes

Verified on Windows in `fix/bh-15-index`, after all five package fixes.

## Regression checks

- History-off cleanup reaches both the coordinator and personal chats when either fails, then delivers the saved settings notification.
- A failed thread-store redaction rejects to the coordinator. Its next maintenance retry removes the retained words from the real SQLite file without restarting.
- Host and personal-chat startup failures drain every acquired handle. Phone access closes before the host it serves.
- A failed title request logs only `thread-title-failed` and `failed`, even when the provider error contains private text and a path.
- Only the single-instance lock owner prepares legacy user data, before runtime initialization reads it.
- Agent activity still reveals the widget with the idle setting off, as the owner's docs-only decision requires. No reveal rule changed.

The focused regression tests were observed failing before the corresponding fixes and passing afterward. Independent standards and spec reviews found no findings. The read-only review CLI could not apply its Windows sandbox ACLs; read-only reviewer agents completed both reviews instead.

## Running application

`npm run build` passed. `npx playwright test tests/e2e/app.spec.ts tests/e2e/settings-index.spec.ts tests/e2e/phones.spec.ts` passed all 19 checks with one worker. These cover onboarding, dictation and history off, settings persistence and failure feedback, widget hide/reveal, single-instance activation, quit/drain/relaunch, and phone setup/pairing/disable.

The Settings journey exercised light, dark and reduced motion at 1600×1000, 1280×800 and 820×560. I inspected the refreshed Application captures below; the page uses its existing scroll area at the minimum size, and controls remain legible. These are verification captures, not replacement design baselines. The journey's other regenerated tracked captures were restored.

- [Application at the minimum size, dark](../../artifacts/settings-index/pkg-15-application-820-dark.png)
- [Application at 1280×800, light](../../artifacts/settings-index/pkg-15-application-1280-light.png)

The provider and phone effects are scripted. This proves application behavior through the built Electron boundaries, not a live provider, SSH host or Tailscale account. S-115 required no patch: the obsolete memory-probe launch branch and raw-error log were already removed on `main`, as ADR-0003 and `CONTEXT.md` record; issue #587 has the skip explanation.
