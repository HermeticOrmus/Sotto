# iPhone recovery and delivery

Package pkg-06 covers #499, #525, #526 and #584. #491 was already corrected in the
base: the handshake and selected thread read have separate failure paths, covered
by `testAThreadReadFailureDoesNotDisconnectItsOnlineComputer`. The issue has a
comment documenting that evidence; no duplicate patch was made.

## Regression coverage

The app-model tests compile the actual `AppModel.swift` against scripted storage
and transport on macOS. They cover a locked launch followed by automatic
connection after unlock, undecodable saved items, a completed answer receipt with
its request still visible, an unrelated host error, an uncertain request, late pushed
reply acceptance and failure, Stop while a reply is unconfirmed, a marker write
failure, stale authority updates and both current-host and older-host hello races.
The tests script lost acknowledgements rather than waiting for a real timeout.

Raw socket tests exercise Can answer being enabled and revoked without reconnecting
on the desktop phone listener and headless host. Two clients verify that each gets
only its own policy. Dispatch still checks host policy independently of the shell.

The delivery state study exercised Stop after a lost acknowledgement and late
reply evidence with the existing labels. It is a logic demonstration, not evidence
of native execution. Review added the distinction between an answer command's
own completed, error-free receipt with explicit outcome evidence and a request
disappearing for another reason.
The latter clears its marker with "That request is no longer waiting."

The native app-model target now compiles the production `KeychainStore.swift`.
Its test seam supplies raw bytes and storage access failures, with JSON decoding
left in the real store. Regressions distinguish a missing item from a damaged one,
preserve a damaged index, recover readable computer items, name unrecoverable host
IDs, warn about damaged action markers, and refuse an inaccessible item before any
index migration write. Settling a marker also preserves unrelated feedback.

The real coordinator/service/socket regression initially failed for both provider
refusal and uncertainty: each returned only `{ status: "completed" }`. The fix
carries command-local outcome evidence into the receipt without consulting the
published shared error. Both regressions pass, as do success with a concurrent
unrelated failure and the existing explicit-authority journey. Native regressions
also cover older ambiguous receipts and desktop resolution after a refused answer.

## Windows verification

Typecheck, lint, third-party notices and the Electron build passed. The full
two-worker suite and native CI results are recorded in the pull request.
`npx playwright test tests/e2e/phones.spec.ts --workers=1` passed its one journey:
setup failure and recovery, pairing, Can answer, removal and listener shutdown.
It uses a scripted Tailscale service and a real local socket listener.

The journey captured both appearances at 1600x1000, 1280x800 and 820x560 with
reduced motion. The dark 820 and light 1600 paired-phone captures were inspected:
the controls and text remain readable, with no horizontal overflow. This batch
does not restyle the desktop. Incidental captures stay in ignored `test-results/`;
no design baseline or committed artifact was replaced.

Independent standards and specification reviews found no remaining findings.
Review corrected an older-host hello race and ensured recovery connects newly
loaded computers even after an earlier Active callback while storage was locked.
The rework review also found disappearance pushes racing the reconnect shell and
hello. Both now retain the marker through its own receipt check, with regressions
asserting one receipt read and no command resubmission.

## Limits

Windows cannot run SwiftUI or the native package tests. The macOS CI gate runs
those tests and Focus simulator journeys, including revised feedback in both
appearances, larger text and reachable dismissal. Native results and inspected
captures are recorded in the pull request after that gate completes. Neither scripted transport
nor those journeys establishes physical-device locked Keychain behavior,
cellular-network compatibility or hands-on VoiceOver. No physical iPhone test was
performed for this batch.
