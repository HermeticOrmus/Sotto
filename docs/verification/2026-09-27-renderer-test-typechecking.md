# Renderer test typechecking

Issue #392 adds the renderer's TSX tests to the existing typecheck gate. No app
source, UI, runtime dependency or production build setting changes.

## Coverage and repairs

The TypeScript program's actual source-file list loaded none of the 117 TSX test
and fixture files through either original project. The new test project loads all
117, including its new typed context fixture, nested renderer tests and opt-in
benchmarks. This checks loaded files rather than assuming an include glob worked.

The first new check reported 317 diagnostics across 46 files. Fixtures now use the
current discriminated snapshots, attachment handles, host identity and typed
bridge methods. A small complete agent-context fixture supplies the same real
draft-store contract that the components expect. Intentional overfull inputs in
privacy tests remain explicit, and their no-leak assertions remain intact.

Unsupported `exact: true` options were removed from Testing Library role queries;
string accessible names already match exactly. Playwright's supported `exact`
options were untouched. Optional fields are omitted when absent, and test mocks
retain their result discriminants. No test exclusion, blanket suppression or
production type relaxation was added.

A temporary owned TSX file assigning a number to a string passed through the
original two projects and failed the new third project with TS2322 under the
documented `npm run typecheck` command. The file was then removed.

## Verification state

- The new project's semantic check passes after the fixture repairs.
- Actual source coverage and the negative semantic witness passed.
- Changed renderer tests: 786 passed across 42 files with one worker (275.23 seconds
  under shared load). Existing assertions remain intact.
- `npm run typecheck`, `npm run lint` and `npm run notices:verify` pass
  (174 notice components).
- All six cases in the three edited opt-in benchmarks pass (16.94 seconds), using
  scripted providers and synthetic input. No absolute timing budget was enabled.
- The full two-worker suite, build, independent review and a representative
  Electron journey are pending. They must pass before merge.
- Timing benchmarks use synthetic providers and owned temporary data. Shared-load
  measurements will be reported as such; this test-only change claims no app
  performance improvement.

Raw compiler coverage, the negative-witness output and diagnostic logs are in the
ignored `artifacts/review-392/` directory. No personal profile or paid provider is
needed for these checks.
