# Shared Settings draft acknowledgements (#394)

This branch depends on #382. Dictionary, global shortcut, paste delay and success message duration now use one revision-aware draft hook. The hook owns draft text, edit revisions, pending submissions and acknowledgement ordering. Parsing, canonical/display formatting, field copy, commit events and save commands stay in Settings. Failed dictionary writes retain text; the numeric and shortcut callers retain their existing restore policy. Newer edits and external settings updates cannot be replaced by an older acknowledgement or failure.

The interface exposes the current text, synchronous edit/read/reset operations, and submission ownership/failure handling. Its implementation does not issue requests. Removing it would return the revision counters, receipt queues and stale-result checks to four callers. Ordered pending acknowledgements now apply consistently to all four fields. Repeated commits retain the existing caller policy; unchanged dictionary blur and duplicate pending dictionary saves remain suppressed.

The OpenRouter key field is deliberately unchanged. Its stored-credential placeholder, exact pending-save promise reuse and Verify sequencing form a different protocol; no secret is put into the generic acknowledgement matcher. No layout, copy, theme, networking or production dependency changes.

## Verification

- Settings and shared-hook regressions plus appearance/theme neighbors: 131 passed across four files (38.78 seconds), two workers. Existing dictionary queue/failure tests and shortcut/numeric delayed-result tests remain intact.
- Seven hook tests exercise the same interface the callers use: queued acknowledgements, external authority, retry, restore ownership, queued reverts, canonical display and render behavior.
- A real Settings Profiler comparison ran the same two tests against the pre-extraction source `9a10b9a5` and the extracted source: both passed. Five dictionary edits cause five commits; blur adds none, successful save feedback adds one, and publishing the matching setting adds one. Three numeric edits cause three commits; its existing validation reset on blur adds one, save feedback adds one, and publishing the setting adds one. Both fields make zero requests while typing and exactly one on blur. These are deterministic operation counts, not stopwatch assertions.
- Typecheck, lint and notices passed.
- Production build, real Electron Settings journey, full two-worker suite and independent reviews remain pending.

All tests use synthetic data. `SOTTO_PERF_DATA` pointed to a verified-absent owned path; no paid provider or personal profile was used.