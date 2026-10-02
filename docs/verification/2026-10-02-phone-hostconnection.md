# Phone connection checks

The phone reconnect and Remove validate ready host health against the saved computer identity. Local removal still completes when the computer cannot confirm remote removal. The listener treats an omitted hello cursor as snapshot-only and advances delivered event pages without changing its cursor for thread-filtered or older history reads, apart from a snapshot-only peer explicitly switching to unfiltered history. A stopped computer returning 502 or 503 keeps its existing saved-reconnect feedback while discovery retains port fallback. Connection waits, read timeouts and rate limits have their own messages; thread-command uncertainty retains its existing wording.

## Local Windows checks

- `npm run typecheck`, `npm run lint`, `npm run notices:verify`: passed; 174 notice components.
- `tests/integration/socketHost.test.ts` and `tests/unit/main/socketServer.test.ts`: 64 passed. New cursor regressions failed before their fixes and passed afterward.
- `npm run build` and `npx playwright test tests/e2e/phones.spec.ts --workers=1`: passed, one journey. It covers listener setup, pairing, the named phone row, answer authority and revocation. Its fixture supplies the phone name; this does not establish what iOS exposes.
- Inspected the paired-phone captures at minimum width in dark and light: [dark](../../artifacts/pkg-17-hostconnection/phones-paired-820-dark.png), [light](../../artifacts/pkg-17-hostconnection/phones-paired-820-light.png). The desktop layout is unchanged. The journey also captures 1280 and 1600 widths. No baselines were regenerated.
- The first full two-worker suite hit the recursive initialized-submodule test's 15-second deadline. The isolated `threadWorktrees.test.ts` rerun passed all 68 tests. Full-suite totals are recorded in the PR.

## CI follow-up

The first Windows CI run exposed a shell arriving before hello: its snapshot-only cursor prevented a history-reading client from catching up. A cursor-only local trace reproduced that ordering. The listener now waits for a successful hello response before shell publication. A deterministic regression exercises the publisher before hello and fails before the fix, then checks hello and subsequent shell cursors. The shared adapter contract and its deadlines are unchanged. The final two-worker socket transport, socket contract and server-unit run passed all 100 tests.

## Native scope and remaining work

Windows has no Swift or Xcode toolchain. The macOS job on revision `be4bfa57` passed the real connection tests, unsigned simulator build and all six Focus journeys on both small and large iPhones. CI retains the native screenshots; inspected the small-phone recovery view with larger text in light appearance. No physical-device connection or hands-on VoiceOver check was performed. A throwaway browser preview checked the connection messages; it is not native UI evidence. The rework also previews read-timeout copy in the existing folder picker at 375 pixels with larger text in both appearances and reduced motion. Its local source is retained on `prototype/bh-17-read-timeout` at `e0a1587c`. The supplied retry wording fits without changing the layout. A native folder-timeout journey now covers both appearances; its current CI result is recorded in the PR.

Reply metadata is read without building a result tree. The original frame bytes are then decoded into the caller's expected result on the generic executor. Hello, both detail reads, command shells, shell reads, receipts and folder listings use typed results. Unused observe and command acknowledgements still decode once as `JSONValue`, without re-encoding. The detail regression counts one typed decode, verifies exact integer preservation and checks that decoding leaves the main thread; null detail and typed hello are covered too. Receive sequence numbers and the existing liveness rules are unchanged.

Issue #585 remains outside this patch. [Apple documents](https://developer.apple.com/documentation/uikit/uidevice/name) that iOS 16 and later returns a generic device name unless the app has the approved user-assigned-device-name entitlement. Sotto supports iOS 17 and later, and this project has no entitlement configuration. Substituting that API alone would not distinguish phones. Approval or a separately agreed naming approach is still needed; the issue has the finding.
