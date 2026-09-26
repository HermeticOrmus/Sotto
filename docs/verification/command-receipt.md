# Command receipts in the running app

Issue #323. The pull request's three hand tests, run in the built app on the `phase3-workspace` fixture by
`tests/e2e/command-receipt.spec.ts`, with the screenshots in `artifacts/command-receipt/`. The size figures
for a large catalog are in `docs/perf/2026-09-26-command-receipt.md`; this note is about behaviour.

The fixture lists three models, so the reply is barely smaller here (12,027 bytes against 12,515 for the whole
state). What the run shows is that the reply crosses without its catalog and nothing a user does notices.

## How the reads were counted

The spec wraps main's `sotto:agents:get` handler, through Electron's private `ipcMain._invokeHandlers` map,
to count every read of the whole state. The page recovers a catalog only through that read, so the count
says whether a receipt was resolved from the page's cache or recovered. The spec's own `get()` calls, which
it uses to check what main saved, are kept outside the counted spans.

## What was seen

- **The wire.** A command sent through the preload's own bridge answers with `host.models` as
  `{ revision, omitted: true }` and no model list.
- **A draft saves as it is typed.** Typing "Draft kept by a command receipt" into the composer of Grok voice
  previews saved it (the saved thread draft matched), with no read of the whole state while typing. After a
  reload the composer showed the draft again, with no alert. See `draft-saved.png`.
- **A setting stays.** On Settings, Agents, changing Reasoning account to Claude saved it in the effective
  settings, and half a second later the control still showed it rather than snapping back. See
  `setting-kept.png`.
- **A model can be picked after the provider reconnects.** The catalog revision went from 2 to 3 when the
  provider disconnected and to 4 when it reconnected, so the catalog changed each time. The reconnect was the
  pane's own Reconnect action, so it went through the page's wrapped bridge. Its receipt named revision 4
  before the broadcast carrying it landed, and the page read the whole state once to recover it: the path
  that until now only the unit tests had run. The New thread dialog then listed Grok 4.6 as available
  (`model-picker-after-reconnect.png`), picking it made no further read, and the new thread was created on
  that model (`thread-on-picked-model.png`).
- No page errors were raised.

## Not covered

- The widget was not driven. It shares the page-side code (`wrapAgentBridge`) and the unit tests cover it.
- A reply whose recovery fails twice was not provoked in the app; `tests/unit/renderer/agentStateCatalogs.test.ts`
  covers it.
- The owner's real 608-model catalog was not loaded; the perf note uses a synthetic one of that size.

## Re-run

```sh
npm run build
npx playwright test tests/e2e/command-receipt.spec.ts
```

It prints the receipt's size, the catalog revisions across the reconnect and the read counts.
