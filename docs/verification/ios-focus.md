# iPhone Focus redesign

September 29, 2026. [PR #474](https://github.com/millZach/Sotto/pull/474), based on `4aeb6257`.

## Scope and reference

The native SwiftUI implementation follows the approved Focus revision at `0d3e5835` on `prototype/ios-threads-redesign`, with approval recorded at `54607463`. Threads opens first, search stays above the scrolling list, and Settings replaces the Needs you tab. Questions lead, working threads remain prominent, recent threads use quieter rows, and settled matches remain searchable. Phone-only appearance and Larger text persist across launches.

## Checks completed

- Local `npm run typecheck`, `npm run lint`, and `npm run notices:verify` passed.
- Local `npm test -- --maxWorkers=2`: 472 files passed, 39 skipped; 6,247 tests passed, 151 skipped. Windows CI at `27fabf23` also passed the full gates; the Linux host gate passed.
- The native Swift package suite executed 66 tests with one skipped and no failures. The unsigned generic simulator app compiled successfully. Focus tests cover reachable requests and background work in settled threads, offline snapshots, search, computer filtering, waiting commands, compaction and failures.
- Standards and spec each received a built-in GPT-6-astra high review and a Grok 4.7 high cross-check against `4aeb6257`. Fixes preserve access to every pending request, let read-only request sheets close, keep search pinned, select the actual bundled font weight, and align the docs with the approved heading. Follow-up review confirmed the request-access fixes.
- The device-specific UI test build initially failed because the app requested an x86_64 slice from the arm64 SottoCore object. `27fabf23` restricts that invocation to the selected simulator architecture; the next run linked and executed the native UI tests. The generic simulator build continues to exercise the broader build configuration.

## Native inspection and delivery

The first executing simulator run passed Settings persistence and computer/filter/search checks on iPhone SE (3rd generation), iOS 26.5. The Focus journey failed because full-application swipe gestures overshot its target into Recent and Settled; the retained recording demonstrates scrolling. Light Settings and light/dark Larger text captures were inspected. Its landscape capture was malformed and is not accepted as design evidence. Corrected gestures and capture behavior still need a complete small/large-phone run and inspection.

The fixture uses the real SwiftUI hierarchy with in-memory host summaries and details, bypasses Keychain, and cannot send commands. Release builds omit the fixture entry point. No desktop design baseline was regenerated; this change affects the native iPhone surface.

The fixture cannot establish live paired-phone networking, streaming, permission delivery, or hands-on VoiceOver behavior. Those remain separate physical-device checks. No TestFlight upload or merge is claimed at this checkpoint.
