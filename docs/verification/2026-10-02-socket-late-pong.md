# PR #651: late pongs through a tunnel

Windows worktree resumed from `5ab00c95`, branch `fix/bh-02-socketserver`. This pass changes connection liveness without changing UI or protocol v1 fields.

## Acceptance and state

- [x] Reproduce both directions with Node's output buffer already empty and a pong delayed past the first round.
- [x] Require two consecutive silent rounds for host and desktop-client pings; writes since the previous ping and any received bytes prevent silence.
- [x] Check partial incoming frames and bounded closure of genuinely silent peers.
- [x] Count URLSession byte growth as additional phone progress, retaining independent protection for pending reads.
- [ ] Integrate current main, run Windows gates and affected Electron journeys, and complete standards/spec review.
- [ ] Push and verify both required CI checks on the latest revision.
- [ ] Owner: check network changes and slow downloads on the physical iPhone.

## Reproduction

`npx vitest run tests/unit/main/socketFrames.test.ts --maxWorkers=2` failed six new cases before the fix: host download and desktop upload connections closed at 50 seconds before the held pong could arrive at 60 seconds; drained writes did not protect the next round; both silent-peer cases closed after one round. The minimal Duplex seam uses the same SocketFrames class as the authenticated listener and desktop socket client, with synchronous write callbacks proving `writableLength === 0`. There are no real sleeps.

After the fix, `npx vitest run tests/unit/main/socketFrames.test.ts tests/unit/main/socketServer.test.ts --maxWorkers=2` passed all 34 cases. Received partial frames stay alive across multiple rounds; heartbeat-owned pings do not renew activity and completely silent peers close at 75 seconds. Drained application writes prevent a silent round even when a tunnel hides the remaining transfer. Opted-in peers also count outgoing frames as progress.

## Native limits

The phone samples received-byte growth across rounds as additional progress. Pending observe/detail deadlines remain independent of byte counters. Apple documents the inherited [received-byte count](https://developer.apple.com/documentation/foundation/urlsessiontask/countofbytesreceived) but does not promise partial WebSocket-frame updates. A slow unsolicited push on an implementation that does not advance this counter remains unverified on a physical device.

Existing SottoAppModelTests compile the actual AppModel with a replacement HostConnection in Dependencies.swift; they do not compile or inject a transport/clock into the real HostConnection. A wiring test for request begin/finish and heartbeat scheduling would require a new native target and transport/clock seams. This pass adds a SottoCore regression for unrequested byte progress, followed by bounded silence, rather than claiming to test that wiring. Native compilation and XCTest execution require macOS CI on this Windows machine.
