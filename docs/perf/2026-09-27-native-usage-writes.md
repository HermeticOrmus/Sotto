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

### Harness correction after the first isolated run

The runner's first nine-case run (`artifacts/review-389/native-usage-benchmark.log`) passed the three unchanged-replay cases. All six changing stream/turn cases failed in the baseline child at its restart assertion: JSON had omitted optional `cacheWrite5m` and `cacheWrite1h` properties whose in-memory values were `undefined`. The reported numeric counters, price and context matched. Node's strict deep comparison correctly distinguished the object shapes; the harness had not accounted for JSON's optional-property representation.

`nativeUsageBenchTotals.ts` now removes only undefined properties from the token objects before strict comparison. It preserves zero and every reported counter without rounding, tolerance or JSON coercion. All existing accounting comparisons and actual archive reloads remain, missing thread usage fails explicitly, and the comparison additionally includes context-window size and rate versions.

The regression first reproduced both failures against a small real archive write/reload, without running a timing workload. After the fix, `npx vitest run tests/unit/main/nativeUsageBenchTotals.test.ts tests/unit/main/nativeUsage.test.ts tests/unit/main/nativeUsagePersistence.test.ts --maxWorkers=1` passed 39 tests. Negative cases reject missing or changed values in every latest/total token field, including reported zeros, and reject changes to price, completeness, context and rate versions. Targeted lint passed. The full nine-case benchmark rerun remains the runner's next step; this harness fix is not a claim that it has passed.

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

## Isolated Electron journey

`tests/e2e/native-usage-persistence.spec.ts` closes the missing native-ledger test seam with production Electron main, its actual `ClaudeStreamJsonHost`, `NativeUsage`, workspace and renderer bridge. It does not enable `SOTTO_E2E`, replace the provider host, inject totals or invoke a test-only ledger flush. The spec checks that `window.sottoE2E` is absent.

`nativeUsageElectronMain.cjs` follows the existing native launcher pattern, with a fresh owned `sotto-e2e-usage-*` temporary root. It sets the application profile and every provider home inside that root before loading production main. The only discoverable Claude executable is a placeholder; the launch seam routes it to `fakeClaudeThread.mjs` using Node. Other spawned programs are refused. Inherited provider credentials, homes, Sotto switches and Node injection flags are removed; Node fetch and Electron HTTP/WebSocket traffic are blocked. The fake client's optional `SOTTO_FAKE_CLAUDE_HOME` points its synthetic transcript at the real adapter's normal discovery directory. Existing adapter fixtures keep their original default directory.

The journey sends a synthetic prompt through the normal composer, then sends two billed assistant frames through the fake client's stdout. It expects 6,000 input tokens, 300 output tokens, 4,000 cached tokens and $0.0117 from the normal renderer bridge. Replaying the old frame 100 times must keep those totals. A final result frame changes only elapsed time, serving as an observable receipt for the replay; that batch must perform exactly one archive replacement for the changed metadata.

The next observation changes output to 350 total. The launcher holds only the usage archive's atomic rename, after its temporary file has been synced. The bridge must already show 350 while disk still shows 300. The test calls the real Electron close, observes `before-quit`, verifies the process is still alive with the old archive, then releases the rename. Close must finish with the latest totals on disk. A new Electron process must restore the same usage through the bridge and deduplicate another 100 historical frames. Composer editing and the Send control remain usable, and screenshots are captured after replay and after restart.

Build and run in the orchestrator's allocated Electron window:

```powershell
npm run build
npx playwright test tests/e2e/native-usage-persistence.spec.ts --workers=1 --retries=0
```

`npm run runtime:prepare` is a prerequisite on a fresh checkout; the orchestrator already completed it for this worktree. No live-provider switches or accounts are needed. The test always releases its disk gate, gracefully closes the app, then deletes only the canonical temporary root after `requireOwnedE2EProfile` validates it. A close failure deliberately prevents profile deletion while a process might still own it. Synthetic screenshots and a numeric evidence summary remain in ignored `artifacts/review-389/electron/`:

- `native-usage-after-replay.png`
- `native-usage-after-restart.png`
- `native-usage-evidence.json`

Inspect both images after a successful run; capture alone is not visual QA. The journey has been collected (`playwright --list`), linted and typechecked in isolation with the browser declarations. The two affected existing Claude adapter/replay suites passed 35 tests with one worker. Its native coverage is Claude, the source of the reported redundant replay writes. Codex/Grok accounting remains covered by the native-usage regressions; this does not claim installed-client compatibility or Electron coverage of those two providers.

### Archive and bridge comparison correction

The runner built the app and completed the first Electron run through valid replay totals, the held-write shutdown and archive replacement. It then failed the harness comparison between the archive view and the renderer bridge view (`artifacts/review-389/native-electron.log`). The archive correctly held native model ID `claude-sonnet-4-6`; `ConfiguredProviderHost` correctly exposed `native:claude:model:claude-sonnet-4-6` on the bridge. JSON also omitted undefined optional token fields. No numerical mismatch was shown. The runner visually inspected the after-replay screenshot and reported that it was correctly laid out. Restart was not reached.

`nativeUsageBoundary.ts` now asserts each side's exact expected model ID before comparing every remaining usage field. It removes only undefined optional properties at the view/token levels, retaining exact numbers, reported zeros, timestamps, context, elapsed time, pricing, rate versions and persistence-error state. The same comparison covers bridge restart, and the replay checks now compare the full view with only their deliberately changed elapsed time. Evidence records the actual archive and bridge observations separately.

Two small regressions first reproduced the archive/bridge and pre/post-restart mismatches. After the harness fix, `npx vitest run tests/unit/main/nativeUsageBoundary.test.ts tests/unit/main/nativeUsageBenchTotals.test.ts --maxWorkers=1` passed 34 tests. Negative cases reject absent or wrong model identities and changed accounting, timestamps, elapsed kind or persistence errors. Targeted lint, focused typechecking with browser declarations and Playwright collection passed. **The corrected Electron journey has not been rerun; neither restart nor a complete Electron pass is claimed.** The runner owns the rerun and final screenshot inspection.
