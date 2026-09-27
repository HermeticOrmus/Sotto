# Native usage archive writes (#389)

Baseline: `7b5fdb843c46ca9fbd21d0ea6acc6656d7f72def`. Current `origin/main` was fetched before implementation and matched that revision. Related usage changes (`35041004`, `364c087b`) and #301 were checked. #302 still owns the decision about a visible persistence-error surface; this change adds none.

The audit's structural reproduction sent 100 identical historical Claude frames against 100 recorded entries. The old path requested 100 whole-archive saves carrying 10,000 entries even though no counters changed. This was a count, not a disk timing.

## Implementation and invariants

`NativeUsage` records whether an entry changed and compares only the small current view and context metadata. Unchanged observations skip summarization and persistence. A timestamp-less replay does not refresh the context's age. Changed historical entries still affect totals without replacing a newer context, and metadata-only changes still save. Codex cumulative deltas, ambiguous resets, Claude cache TTL pricing and Grok reported costs keep their existing accounting rules and replay identities.

Totals update synchronously. A microtask takes one immutable archive snapshot, and there is at most one write in flight. Observations arriving during that write share a set of dirty thread IDs; when the write finishes, the next snapshot takes their latest totals. There is no per-frame archive clone or queued snapshot. The existing atomic JSON file format, synced replacement and Windows rename retries stay intact.

Each adapter's existing `closed()` calls `NativeUsage.flushed()`. The drain includes changes arriving during an in-flight write. A failed write marks every affected thread's existing `persistenceError`; success clears a flag only after that thread's latest pending totals have been saved. A later observation, including an unchanged replay, or an explicit drain retries a failed archive. A permanent failure does not cause an automatic retry loop. Reconnect keeps newer unsaved data in memory if its retry fails. Repricing on load uses the same error path instead of silently swallowing a failed migration. Failure flags are runtime state and are omitted from successful snapshots.

## Structural checks

`tests/unit/main/nativeUsagePersistence.test.ts` checks these independently of elapsed time:

- Seeding 100 requests in one synchronous batch makes one archive write. Repeating an unchanged historical frame 100 times makes zero writes and retains the existing total object.
- Latest frames without timestamps, repeated stream output, elapsed results, compacted-context snapshots and unidentified Grok observations produce no redundant saves.
- With one write deliberately held, 100 changed observations across two threads produce exactly one further archive snapshot. The original snapshot cannot mutate, and the drain waits for the latest one.
- All three providers retain their accounting through failure, unchanged-observation retry, successful persistence and restart.
- Errors remain observable across threads, older successes cannot clear a newer failed state, permanent failures have bounded retries, reconnect retains unsaved observations, and repricing failures use the same drain.

Run with the existing accounting regressions:

```powershell
npx vitest run tests/unit/main/nativeUsage.test.ts tests/unit/main/nativeUsagePersistence.test.ts --maxWorkers=1
```

## Isolated before/after benchmark

The opt-in benchmark builds the baseline's actual `src/` sources from Git and the candidate's sources into separate bundles. Every sample runs in a fresh Node child process with a private synthetic archive and real `AtomicJsonStore` writes, file sync and atomic replacement. It never reads an installed Sotto profile or contacts a provider. Baseline and candidate run sequentially in alternating order; one warm-up pair is discarded and three pairs supply medians.

The archive sizes are 1 thread × 100 entries, 4 × 250, and 20 × 250. Each receives 100 observations: unchanged historical replay, growing streamed output for one request, or new requests spread across threads. Frames arrive in batches of ten separated by event-loop turns. Setup, bundle creation, seeding, reload verification and cleanup are outside the measurement. Every sample verifies totals after restart; paired samples must produce the same counters, prices and context. Baseline requests exactly 100 writes; the candidate permits zero for replay and at most ten for changing batches.

The report includes write requests, entries carried across the persistence boundary, observation-loop and full-drain wall time, process CPU time, archive bytes, and heap samples before observations, after observations and after drain. Heap samples are neither peak memory nor post-GC retained memory. The measurements describe this ledger workload, not Electron latency or native-provider latency. No stopwatch assertion enters CI.

Run only on an otherwise idle machine, with no gates or other benchmarks running:

```powershell
$env:SOTTO_PERF_BENCH = '1'
npx vitest run tests/perf/nativeUsageWrites.perf.test.ts --maxWorkers=1 --disable-console-intercept
Remove-Item Env:SOTTO_PERF_BENCH
```

## Delivery checklist

- [x] Implement unchanged-observation detection and coalesced writes.
- [x] Preserve synchronous totals, replay identities, errors and explicit shutdown drain.
- [x] Add structural regressions and an isolated comparison harness.
- [ ] Run the isolated benchmark under the orchestrator's load coordination and record results here.
- [ ] Run the documented broad gates, independent reviews and relevant Electron workflow.

Initial focused verification:

- `npx vitest run tests/unit/main/nativeUsage.test.ts tests/unit/main/nativeUsagePersistence.test.ts tests/perf/nativeUsageWrites.perf.test.ts --maxWorkers=1`: 23 passed, 9 opt-in benchmark cases skipped.
- `npx vitest run tests/integration/nativeCompaction.test.ts tests/integration/claudeTranscriptCatchUp.test.ts --maxWorkers=1`: 17 passed against scripted native clients.
- Targeted ESLint on the implementation and three new TypeScript files: clean. The benchmark child bundle compiled with esbuild without being executed.

Timing measurements, broad gates, independent reviews and Electron verification are pending, not claimed.

The existing Electron specs have no native usage totals assertion after #301 removed composer figures. `phase-four-personal-providers.spec.ts` is the nearby Claude/Grok saved-chat, send, disconnect/reconnect and keyboard journey, but uses the app's fake host and does not itself exercise the native ledger. For a totals check, use a temporary profile and scripted native clients, inspect the existing thread usage in the bridge before/after replay and after graceful close/restart, and verify that the composer remains visually unchanged. Do not add a new visible error surface to perform this check. The existing native-usage unit tests exercise the actual archive and provider accounting; a fake-host UI pass alone must not be reported as native-ledger coverage.
