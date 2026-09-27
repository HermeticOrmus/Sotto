# Native usage persistence and replay (#389)

The synthetic native Claude journey passed against the built production app with the final test content committed as `f3a80bb12fa1f29e89c15cdb5e65eeeda47815c2`. It verifies accounting through the real adapter and ledger, graceful shutdown with a pending write, restart replay deduplication, restored messages and an editable composer. The original saved screenshots show the complete transcript in default dark appearance at 1280 × 800. No UI changed and no design baselines were regenerated.

## Journey and observed results

`tests/e2e/native-usage-persistence.spec.ts` launches production Electron main through `nativeUsageElectronMain.cjs`. The scripted Claude client supplies stdout frames to `ClaudeStreamJsonHost` and persists its synthetic native transcript. No fake host totals, ledger flush endpoint or `SOTTO_E2E` product bridge is used; the test asserts `window.sottoE2E` is absent.

1. Send a synthetic prompt through the normal composer. Wait for admitted read-only IPC, a valid persisted native alias and the client's matching prompt receipt, rather than treating optimistic transcript text as session readiness.
2. Supply two assistant usage frames. The renderer bridge reports 6,000 input tokens, 300 output tokens, 4,000 cached tokens and estimated cost $0.0117. Current context is 3,000 of 200,000 tokens.
3. Replay the older frame 100 times. Accounting remains unchanged. A result frame changes elapsed time from 111 to 222 ms as a batch receipt; exactly one archive replacement persists that metadata.
4. Change the latest request's output from 200 to 250. The bridge reports 350 total output and $0.01245. Hold the archive's atomic rename after its temporary data is synced: disk must still contain 300 output.
5. Request real graceful quit. Observe `before-quit`, confirm the process remains alive with the old archive, then release the write. Close completes with the latest usage on disk.
6. Start a new Electron process. Assert full usage equivalence and require the original prompt and final reply visible inside the viewport, with history no longer busy, **before any new replay**.
7. Replay the older frame another 100 times. Totals remain 6,000 input, 350 output and 4,000 cached; estimated cost remains $0.01245. Elapsed time becomes 333 ms and exactly one metadata write occurs. Assert restored messages again, edit an unsent draft and confirm Send remains enabled.

Full comparisons retain counters, reported zeros, pricing, rate versions, context, timestamps, elapsed kind and persistence-error state. They first assert native archive model `claude-sonnet-4-6` and bridge model `native:claude:model:claude-sonnet-4-6`, then account for JSON omitting undefined optional fields. Bounded readiness checks do not replay mutating commands. Held-write and post-close durability assertions remain immediate checks.

[Numeric Electron evidence](../../artifacts/review-389/electron/native-usage-summary.json) retains the observed boundary values and verified journey flags, excluding synthetic transcript text and diagnostic DOM. Provider-reported elapsed values above are scripted accounting metadata, not measured execution latency.

## Visual evidence

The runner inspected the original saved PNGs and verified their pixels. Both contain the prompt card, Worked disclosure and final reply, with clear layout and an editable composer. The stronger DOM assertions independently establish restored text before replay.

![After historical replay](../../artifacts/review-389/electron/native-usage-after-replay.png)

![After graceful restart and replay](../../artifacts/review-389/electron/native-usage-after-restart.png)

An image preview misleadingly omitted transcript content during earlier inspection. The previous conclusion that the captures or compositor were defective was incorrect. Read-only `System.Drawing` comparison of the original files found **zero differing pixels** in the transcript rectangle x=420..1179, y=55..309: all 193,800 pixels are opaque in both images. SHA-256 hashes match the runner's originals. The runner additionally reported 5,812 non-dark pixels in each transcript rectangle and 1,381 in each reply rectangle (x=420..1179, y=235..283). See the independently reproduced [pixel/hash record](../../artifacts/review-389/electron/native-usage-pixels.json). The limitation belongs to preview-based evidence interpretation; no missing saved pixels, lost history, or Chromium/Windows capture defect was demonstrated. The two PNGs were retained unchanged, without rerunning the journey or editing images for this documentation update.

## Isolation, commands and scope

Each run owns a fresh `sotto-e2e-usage-*` temporary root containing profile, project, provider home and fake client. Inherited provider credentials and injection settings are removed. Only the placeholder Claude executable routes to the fake Node client; other programs are refused, and Node fetch plus Electron HTTP/WebSocket requests are blocked. No real profiles, accounts or paid provider calls are used. Cleanup releases the write gate, awaits graceful process close, validates the canonical root with `requireOwnedE2EProfile`, then removes it. A close failure prevents deleting a potentially live profile.

```powershell
npm run runtime:prepare
npm run build
npx playwright test tests/e2e/native-usage-persistence.spec.ts --workers=1 --retries=0
```

Runtime preparation/build had already passed; the final test used that build and passed one journey. Focused ESLint and TypeScript checking passed. The runner's broad gates passed: typecheck, full lint, notices (174 components), and Vitest with two workers (440 files and 5,775 tests passed; 35 files and 135 tests skipped). Broad-gate inputs remained unchanged while the excluded E2E spec was strengthened. These Electron runs overlapped the full suite and make no performance claim; the separately coordinated [ledger benchmark](../perf/2026-09-27-native-usage-writes.md) passed all nine cases.

Native Electron coverage is Claude. Codex/Grok accounting is covered by unit/integration verification, not live installed clients. Visual inspection covers default dark at 1280 × 800, not a new light/theme/minimum-size design matrix. Selected artifacts contain only synthetic images and numeric evidence; logs, prompt archives and scratch diagnostics are excluded.

- [x] Actual native accounting, replay, graceful drain and restart.
- [x] Original prompt/final reply restored before new replay; composer usable.
- [x] Original screenshots inspected and hashes/pixel equality verified.
- [ ] Independent native Astra Standards review, arranged by root.
- [ ] Independent native Astra Spec review, arranged by root.

Cross-model review was not performed. Automatic approval review rejected external review destinations; the user retained an Astra-only boundary. All implementation used GPT-6 Astra at high reasoning.
