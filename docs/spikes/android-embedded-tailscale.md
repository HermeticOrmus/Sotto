---
assumption: The Sotto Android app can embed Tailscale (Go tsnet through gomobile) so that, after a browser login, it lists the tailnet's peers and reaches a Sotto host over HTTPS through its own embedded node.
verdict: VERIFIED ON PROXY
proof_level: 4
observed_on: Android emulator API 35 x86_64 on Sun (proxy); the target, Ormus's phone, not yet run
scope: gomobile build of tsnet (tailscale.com v1.104.0, Go 1.27, NDK 27) for arm64 and x86_64; browser login enrolling a user-owned node; peer list from the node; HTTPS through the node with platform TLS, confirmed from outside by Serve's X-Forwarded-For and tailscale whois. Not covered: a physical phone, the phone's own Tailscale VPN app running beside the embedded node, battery, background, and APK size in release form
reproduce: build tsprobe (gomobile bind in apps/android/tsprobe/go, then ./gradlew :tsprobe:assembleDebug), install, tap 2 Start, 4 Open login URL and approve, 3 Status, 5 GET; read logcat -s TSPROBE and the echo log on the computer serving https://<name>.ts.net/
probe: spike/android-embedded-tailscale
reopen_if: a Tailscale release changes tsnet's Android requirements (netmon interface getter, logpolicy state directory), or the phone run fails
action: EXTEND to the target surface (gate row 4): one attempt left, the phone run, which needs Ormus to install and log in
---

## Card

```
Assumption:      The Android app can embed Go tsnet (gomobile AAR) so that, after a browser login, it lists
                 the tailnet's peers and reaches https://<host>.ts.net through its own embedded node.
Question:        mechanism
Prediction:      gomobile bind of a small Go package around tsnet.Server (state in the app's files dir,
                 userspace networking) builds on Sun (Go 1.27, NDK 27) into an AAR for arm64 and x86_64;
                 the debug APK grows from about 20 MB to 40-60 MB. First start yields a login URL; after the
                 owner logs in, the node's status lists at least 10 peers including fera and mars-1. OkHttp
                 through the node's loopback SOCKS5 proxy fetches https://sun.tailb43a3a.ts.net/ with
                 platform TLS.
Control:         Before the probe, the same HTTPS GET without the embedded node, from the emulator and from
                 the phone (through its Tailscale app). Record the echoed X-Forwarded-For or the error. The
                 probe's echoed address must differ from both.
Pass predicate:  On Ormus's phone, from a fresh state directory and with no auth key, one run of the probe
                 app shows on screen (a) a login URL, then after Ormus logs in (b) its own tailnet IP and a
                 peer count >= 10 naming fera and mars-1, and (c) the body of an HTTPS GET to
                 https://sun.tailb43a3a.ts.net/ served by a Tailscale Serve echo on Sun, where the echoed
                 X-Forwarded-For equals the IP in (b). Confirmed from outside the probe: the echo server's
                 own log on Sun shows that request from that IP, and `tailscale whois <that IP>` on Sun names
                 the probe's hostname.
Wrong if:        gomobile produces an AAR that loads, but after login the node never reaches Running, or
                 lists no peers, or the HTTPS GET through the node fails TLS or connection, or the echoed
                 X-Forwarded-For matches a control address (the request bypassed the node).
Must not worsen: the phone's Tailscale app stays Connected and still reaches Sun during and after the probe.
                 Nothing in the shipped app changes; the probe is a separate debug build. Record APK size.
Target surface:  Ormus's Android phone (arm64), with its Tailscale VPN app installed and connected.
Proxy surfaces:  The Android emulator on Sun (API 35, x86_64), a rehearsal only; it caps the verdict at
                 VERIFIED ON PROXY.
One-way door:    no. Fork-only code; every probe node is removed from the tailnet afterwards.
Attempt budget:  4
Selection rule:  n/a (one mechanism)
```

## Attempts

| # | hypothesis | change | observed | result |
|---|---|---|---|---|
| 1 | Plain tsnet starts under gomobile on Android 15 (API 35 emulator) | tsprobe Go package (tsnet.Server, fresh Dir, no AuthKey), gomobile bind arm64+x86_64, plain-views probe app | Build OK (AAR 31 MB, debug APK 64 MB). Start fails: `tsnet: route ip+net: netlinkrib: permission denied` | fail (mechanism reached) |
| 2 | Tailscale's documented opt-in `_ "tailscale.com/feature/androidbin"` (netmon fallback for Android app UIDs) fixes it | blank import, rebuilt AAR and APK (verified same libgojni.so md5 in AAR and APK; androiddns symbols present) | Same error, unchanged | fail (mechanism reached) |
| 3 | Diagnose which interface lookup fails (tests the premise) | Diag() calls each lookup separately | Harness broke: edge-to-edge layout hid the top buttons under the title bar, taps never reached them (also why the first control taps were silent) | spent, never reached the mechanism |
| 4 | Same diagnostic, harness fixed (top padding) | layout padding only, same AAR | net.Interfaces and InterfaceAddrs refused (expected); netmon.GetInterfaceList refused, so the androidbin fallback did not apply; DefaultRouteInterface ok; netmon.New refused. Control GET from the emulator without the node: 200, xff 100.92.213.61 (Sun), echo log on Sun agrees | premise falsified, budget spent |
| - | EXTEND once by Ormus: budget 4 -> 7 | | | |
| 5 | Register a netmon interface getter ourselves (androidbin's synthetic outbound-address interface) | iface.go: netmon.RegisterInterfaceGetter in init | Diag: GetInterfaceList (1) ok, netmon.New ok. Node start then panicked: `no safe place found to store log state` (logpolicy, no home folder) | interface blocker cleared; new failure |
| 6 | Keep Tailscale's log state local and its upload off | Start sets TS_NO_LOGS_NO_SUPPORT=true and TS_LOGS_DIR to the app dir | NeedsLogin with login URL in 3 s; Ormus approved in his browser; Running, own IP 100.78.98.32, 48 peers incl. fera and mars; GET through node 200 with xff 100.78.98.32 (control 100.92.213.61); echo log on Sun and `tailscale whois 100.78.98.32` name sotto-probe-sdk-gphone64-x86-64, user hermeticormus@gmail.com | predicate holds on proxy |

## Evidence

## Skeptic

Card check (fresh-context subagent, card only): probe can fail = yes; pass proves assumption = no, as first written. Objections: phone never tested (emulator could satisfy it, x86_64 vs arm64, phone VPN conflict); bypass signature assumed not measured; probe IP self-reported; login step skippable; fera/mars-1 mismatch. Resolved before attempt 0 by: target run on the phone required, emulator caps at proxy; control run added; outside confirmation by echo-server log and `tailscale whois`; fresh state and no auth key required; mars-1 in the predicate.

## Premise

Attempts 1 and 2 share the premise that tsnet's start path reads network interfaces only through netmon's
replaceable getter, so the androidbin fallback would cover it. An unchanged error after enabling the fallback
says some call on the start path goes to Go's net.Interfaces/InterfaceAddrs directly. Attempt 3 tests this
premise by calling each lookup separately and reporting which one Android refuses.

Finding (attempt 4 plus reading feature/androidbin/register.go): the premise is wrong in a specific way. The
androidbin fallback is compiled out of exactly this build: `//go:build (linux && !android) || (android && !cgo)`.
gomobile builds are GOOS=android with cgo, and Tailscale's own Android app registers a Java-backed getter with
netmon.RegisterInterfaceGetter instead. The next step is to register a getter ourselves (androidbin's synthetic
outbound-address interface, or Android's ConnectivityManager link addresses).

## Constraints for /mplan

- Register a netmon interface getter before tsnet starts (`netmon.RegisterInterfaceGetter`). Tailscale's `feature/androidbin`
  fallback is compiled out of cgo Android builds, which gomobile always produces. The synthetic outbound-address
  interface was enough on the emulator; the Android ConnectivityManager's link addresses are the fuller source.
- Set `TS_NO_LOGS_NO_SUPPORT=true` and `TS_LOGS_DIR` inside the app before start: Android apps have no home folder for
  Tailscale's log state, and Sotto uploads no logs (AGENTS.md, Private).
- The embedded node contacts Tailscale's control plane and DERP relays: a new host for Sotto's privacy list, so an ADR and
  a README change come before a branch.
- OkHttp reaches a tailnet address through a loopback forwarder that dials with the node (`srv.Dial`); TLS still
  verifies the `*.ts.net` name. Android's SOCKS client was not relied on.
- The phone appears as a second, user-owned device in the tailnet. Removing the app does not remove it; the app needs a
  Sign out that logs the node out.
- Through the embedded node, Tailscale Serve adds `Tailscale-User-Login` to each request, the identity upstream PR #357
  proposes to admit a phone by. Sun's own request carried none.
- Debug APK with both ABIs: 64 MB, arm64 only: 32 MB (the Go library is about 30 MB per ABI before compression).
