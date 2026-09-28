# Shared Settings draft acknowledgements (#394)

This branch depends on #382. Dictionary, global shortcut, paste delay and success message duration now use one revision-aware draft hook. The hook owns draft text, edit revisions, pending submissions and acknowledgement ordering. Parsing, canonical/display formatting, field copy, commit events and save commands stay in Settings. Failed dictionary writes retain text; the numeric and shortcut callers retain their existing restore policy. Newer edits and external settings updates cannot be replaced by an older acknowledgement or failure.

The interface exposes the current text, synchronous edit/read/reset operations, and submission ownership/failure handling. Its implementation does not issue requests. Removing it would return the revision counters, receipt queues and stale-result checks to four callers. Ordered pending acknowledgements now apply consistently to all four fields. Repeated commits retain the existing caller policy; unchanged dictionary blur and duplicate pending dictionary saves remain suppressed.

The OpenRouter key field is deliberately unchanged. Its stored-credential placeholder, exact pending-save promise reuse and Verify sequencing form a different protocol; no secret is put into the generic acknowledgement matcher. No layout, copy, theme, networking or production dependency changes.

## Verification

- Settings and shared-hook regressions plus appearance/theme neighbors: 134 passed across four files (42.40 seconds), two workers. Existing dictionary queue/failure tests and shortcut/numeric delayed-result tests remain intact.
- Nine hook tests exercise the same interface the callers use: queued acknowledgements, external authority, retry, restore ownership, queued reverts, canonical display and render behavior.
- A real Settings Profiler comparison ran the same two tests against the pre-extraction source `9a10b9a5` and the extracted source: both passed. Five dictionary edits cause five commits; blur adds none, successful save feedback adds one, and publishing the matching setting adds one. Three numeric edits cause three commits; its existing validation reset on blur adds one, save feedback adds one, and publishing the setting adds one. Both fields make zero requests while typing and exactly one on blur. These are deterministic operation counts, not stopwatch assertions.
- Typecheck, lint and notices passed.
- Runtime preparation and final integrated production build passed. The real Electron `settings-index.spec.ts` journey passed one test (27.7 seconds), with exclusive desktop access and one worker: three sizes, both themes, reduced motion, keyboard/focus, normal save/reload and failure feedback. This journey preceded the rollback review correction below; it documents unchanged layout and the original save journeys. The correction is separately exercised through the actual Settings field.
- Independent Standards review initially found zero findings. Spec review found the stale rollback sequence below; final delta review and the full two-worker suite remain pending.

All tests use synthetic data. `SOTTO_PERF_DATA` pointed to a verified-absent owned path; no paid provider or personal profile was used.

## Review correction

Spec review identified an ignored receipt resurfacing through a later failure: submit A, accept an external value, ignore the old A receipt, then submit B and fail B. Two new desired-behavior regressions failed before correction, one through the hook and one through the actual Paste delay field (625 was incorrectly replaced by 300). A neighboring accepted-receipt rollback case passed. The hook now keeps the last accepted display for rollback; a current receipt can advance it while newer typing remains visible, but a receipt superseded by external authority cannot. All 134 focused tests, including the unchanged render/request comparisons, then passed.

The [Cleanup dark view](../../artifacts/review-394/cleanup-dark.png) and [minimum light Output view](../../artifacts/review-394/output-minimum-light.png) were visually inspected. The dictionary and both numeric fields remain readable and fit the existing layout. The pre-existing sidebar mode-row overflow belongs to #388. Generated runtime and unrelated Settings captures were restored; no design baseline changed.
