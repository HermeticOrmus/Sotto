# Phone connection checks

The phone reconnect validates ready host health against the saved computer identity. The listener treats an omitted hello cursor as snapshot-only and advances delivered event pages without changing its cursor for thread-filtered or older history reads. Connection waits and rate limits have their own messages; thread-command uncertainty retains its existing wording.

## Local Windows checks

- `npm run typecheck`, `npm run lint`, `npm run notices:verify`: passed; 174 notice components.
- `tests/integration/socketHost.test.ts` and `tests/unit/main/socketServer.test.ts`: 63 passed. New cursor regressions failed before their fixes and passed afterward.
- `npm run build` and `npx playwright test tests/e2e/phones.spec.ts --workers=1`: passed, one journey. It covers listener setup, pairing, the named phone row, answer authority and revocation. Its fixture supplies the phone name; this does not establish what iOS exposes.
- Inspected the paired-phone captures at minimum width in dark and light: [dark](../../artifacts/pkg-17-hostconnection/phones-paired-820-dark.png), [light](../../artifacts/pkg-17-hostconnection/phones-paired-820-light.png). The desktop layout is unchanged. The journey also captures 1280 and 1600 widths. No baselines were regenerated.
- The first full two-worker suite hit the recursive initialized-submodule test's 15-second deadline. The isolated `threadWorktrees.test.ts` rerun passed all 68 tests. Full-suite totals are recorded in the PR.

## Native scope and remaining work

Windows has no Swift or Xcode toolchain. The real connection tests, native build and Focus simulator journeys must be checked by the macOS CI job. No physical-device connection or hands-on VoiceOver check was performed. A throwaway browser preview checked the new connection messages; it is not native UI evidence.

Issue #556 is already addressed on main: `IncomingFrame` decodes pushes directly from `Data` outside the main actor in receive order, and asynchronous `Wire.readValue` handles replies. The existing streaming tests cover that path.

Issue #585 remains outside this patch. [Apple documents](https://developer.apple.com/documentation/uikit/uidevice/name) that iOS 16 and later returns a generic device name unless the app has the approved user-assigned-device-name entitlement. Sotto supports iOS 17 and later, and this project has no entitlement configuration. Substituting that API alone would not distinguish phones. Approval or a separately agreed naming approach is still needed; the issue has the finding.
