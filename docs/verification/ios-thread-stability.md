# iPhone thread stability

September 28, 2026. Branch `fix/ios-thread-stability`, based on `ef5ee727`.

## Reproductions and changes

- `ThreadPerformanceTests.testBusyThreadListStaysWithinAnInteraction` runs the actual list sorting path on 500 synthetic threads. Before: 0.545 seconds, failing the opt-in 0.15-second interaction budget. After: 0.018–0.023 seconds. Timestamps are parsed once per row instead of twice per sort comparison.
- The original `AppModel.swift`, compiled against scripted storage and transport, fails both connection regressions: a successful hello followed by a refused observed-thread read disconnects the computer; opening a thread also requests a second full detail and an unnecessary shell. The changed source passes. A third test confirms several missing delta bases share one read and closing a thread invalidates that read.
- The phone's hello now skips event history it does not consume. Frames decode into display models outside the UI actor. The v1 detail-delta extension sends changed text and activity rather than the full conversation; tests cover append, replace, new message, activity completion/removal, gaps, wrong thread, stale revision and atomic failure.
- Settlement follows desktop workspace/project settlement, provider overrides and archives. It does not hide waiting requests from Needs you. Finished turns alone are not settled.

## Local verification

- Swift 6.0.3 on WSL: 50 core/model tests passed before the final gap-race test; that added test passes with the other two model tests. The harness copies the actual sources and supplies only Darwin DNS and SwiftUI observation/scene stand-ins in its temporary package. It does not simulate SwiftUI rendering, URLSession networking, Keychain or iOS lifecycle behavior.
- Actual `HostConnection.swift` typechecked with Swift 5 language mode and Linux FoundationNetworking.
- Typecheck, lint and 174 third-party notice components passed. Full npm suite is pending at this checkpoint.
- HTML prototype inspected in Sotto's browser in dark and light, collapsed and expanded. Local prototype captures are under `artifacts/review-ios-stability/`. They demonstrate the chosen disclosure, not a native iOS result. The original prototype is retained on `prototype/ios-thread-list`.

## Remaining native checks

- [ ] `sh apps/ios/Scripts/verify.sh` on macOS (actual SwiftUI model tests and unsigned iOS build).
- [ ] iPhone: launch, open a thread without reconnecting, stream a long reply, scroll history, background/foreground and switch networks.
- [ ] Native dark/light, Dynamic Type, VoiceOver, reduced motion, keyboard and settled disclosure.
- [ ] Confirm the original laptop/iPhone scenario after installing the new build. No TestFlight build has been published by this work.

Windows and HTML evidence cannot establish those results. No raw user transcript, credential or production protocol body was captured.
