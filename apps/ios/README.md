# Sotto for iPhone

Native iOS 17+ client for a Sotto host on a private Tailscale connection. It finds the host by its machine name on the tailnet and pairs with a code the host prints. Three tabs: **Needs you** (every waiting question and permission, answerable on its card, then the working threads), **Threads** (by project, with All, Working and Done) and **Host** (connection, whether this iPhone may answer, its client ID, Forget). A thread shows its messages as a conversation or its activity, takes replies and stops a working turn; a waiting question or permission opens as a sheet. Pairing does not grant permission authority. New threads, terminal, file management, speech, push and Android are outside this first client. The design was chosen from `docs/prototypes/iphone-client-prototype.html` (variant B).

This directory is independent of the Electron/npm package. SwiftUI, Foundation and Security are system frameworks; SottoCore has no external dependencies. The wire models mirror `src/shared/hostProtocol.ts` version 1. One host is saved per installation; cached state is scoped to its persisted host ID. No signing team is embedded and no build has been uploaded.

## Build and test

Use a Mac with Xcode 15 or newer (iOS 17 SDK or newer) and its command-line tools selected. From the repository root:

```sh
swift test --package-path apps/ios
sh apps/ios/Scripts/verify.sh
```

The second command also compiles an unsigned simulator app. This is independent of root npm tests. It must run before calling the native client verified. The shared Xcode scheme is `Sotto`; the package tests cover protocol rejection, host/session identity, native permission IDs, stale requests, structured questions and ambiguous delivery. They do not substitute for a live app journey.

To run the built app on a booted simulator:

```sh
xcrun simctl install booted apps/ios/.build-native/Build/Products/Debug-iphonesimulator/Sotto.app
xcrun simctl launch booted com.millzach.sotto.ios
```

Choose an installed iPhone simulator using Xcode or `xcrun simctl list devices available` first. The app deliberately accepts only certificate-validated `https://*.ts.net` host origins; it has no localhost/cleartext production bypass. Native simulator and device verification therefore require a reachable private host route. The design prototype is `docs/prototypes/iphone-client-prototype.html` (serve the repository root, for example with `node docs/prototypes/composer-selectors-serve.mjs`); it is not the iOS app.

## Sign and install on an iPhone

With a Mac, open `apps/ios/Sotto.xcodeproj`, choose the Sotto target, set your own development team in Signing & Capabilities, and confirm that `com.millzach.sotto.ios` is available for that team (change the identifier if needed). Connect the iPhone, enable Developer Mode when Xcode requests it, select it as the run destination and build. Do not commit team-specific provisioning material or account credentials.

Install/sign in to Tailscale on the iPhone and grant the intended tailnet access, with MagicDNS on for the tailnet. Configure Tailscale Serve on the host machine to forward its private HTTPS origin to the host's loopback listener. On the iPhone, type the machine's name (`forge`): the app resolves it through the system resolver, which Tailscale answers with MagicDNS, takes the full `forge.<tailnet>.ts.net` name from the canonical or reverse-lookup answer, and reads `/v1/health` there before asking for a code. The full `.ts.net` address can be typed instead. Then enter the fresh code printed by the host's pairing command; the pairing is refused if a different host answers than the one found. Allowing this client's answers is a separate explicit host policy operation; use the host CLI's documented `--allow-answers` operation with this client ID. No credential or pairing secret belongs in a URL or log.

## TestFlight from GitHub Actions

No Mac is needed to put the app on an iPhone. `.github/workflows/ios-testflight.yml` archives, signs and uploads it to TestFlight on a macOS runner whenever a tag named `ios-testflight-*` is pushed (ADR-0032):

```sh
git tag ios-testflight-$(date +%Y%m%d-%H%M) && git push origin --tags
```

About half an hour later the build appears in the TestFlight app on the phones of the internal testing group. The build number is the workflow's run number; the marketing version is `MARKETING_VERSION` in the Xcode project.

One-time setup, all in a browser plus `gh`. `bash apps/ios/Scripts/testflight-setup.sh` walks through steps 1 to 4, opening each page and storing the secrets without showing them:

1. In the Apple Developer account, under Certificates, Identifiers & Profiles, register the App ID `com.millzach.sotto.ios` (explicit, no capabilities), and note the Team ID under Membership.
2. In App Store Connect, create the app under Apps with that bundle ID. The App Store name must be unique across the store; the name on the home screen stays Sotto.
3. In App Store Connect under Users and Access, Integrations, App Store Connect API, generate a team key with the **Admin** role (cloud-managed signing needs it). Download the `.p8` once and note its Key ID and the Issuer ID.
4. Store them as secrets of the `testflight` environment: `APP_STORE_CONNECT_KEY` (the `.p8` file's text), `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID` and `APPLE_TEAM_ID`.
5. After the first upload, add yourself to an internal testing group under TestFlight in App Store Connect, and install the TestFlight app on the iPhone.

No certificate or profile is stored anywhere: Xcode's automatic signing uses Apple's cloud-managed certificates, authorised by the key. Revoke the key in App Store Connect if the repository's secrets are ever in doubt. The app declares standard encryption only (`ITSAppUsesNonExemptEncryption` is false), because it uses the platform's TLS and Keychain and no cryptography of its own; review that if the implementation changes. External testing and the App Store need Apple's review and are not set up.

On a Mac, the same archive can be made locally: open the project, set your team under Signing & Capabilities, and use Product > Archive, or run `apps/ios/Scripts/testflight.sh` with the environment it documents.

## Lifecycle and privacy

The host does the work while iOS suspends the app. Foreground activation gets a fresh signed session, shell and selected-thread snapshot; socket frames never replay commands. Lost acknowledgements retain an ID-only Keychain marker. A receipt that vanished after host restart stays unconfirmed; the user can check the thread and explicitly dismiss the marker without resending it. A completed transport receipt alone does not establish prompt delivery: provider delivery evidence must agree.

The per-device host token uses `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, with synchronization disabled. Provider keys never enter this client. HTTP and socket credentials are headers/body fields, never URL parameters, and redirects are refused. URLSession is ephemeral with no cookies or disk response cache. Transcript and unsent draft text remain in memory; backgrounding preserves drafts, termination loses them. The app obscures content while inactive. No transcript, token or protocol-body logging is implemented. Looking up a machine name is a DNS query from the iPhone: with Tailscale connected MagicDNS answers it inside the tailnet; with Tailscale off, the query for that one name goes to the iPhone's usual DNS server. Only an answer that points into Tailscale's own address ranges is used, so another network cannot hand the phone a different host.

Forget first revokes this pairing on the host, then clears Keychain and memory. Offline Forget keeps credentials for retry; an already-revoked token can be removed locally. Keychain reinstall behavior is not a substitute for host revocation. The app asks for no microphone, camera, photo, location or notification access.

## Verification required before delivery

- Native package tests and simulator compile; inspect both themes at small/large text sizes, VoiceOver, reduced motion, portrait and landscape, and the software keyboard.
- On the real iPhone and desktop, read the same thread on the host, reply and receive streaming updates, interrupt, answer structured questions and each supported permission form explicitly.
- Revoke authority while a request is visible; another client answers first; disconnect after send but before acknowledgement; restart host; switch networks; lock/unlock; terminate/relaunch. No automatic resend or stale request answer.
- Find by name with Tailscale connected (MagicDNS short-name lookup has not been observed on a device yet), with Tailscale off, with a name that is not a Sotto host, and by full address.
- Expired/invalid pairing, Keychain locked/unavailable, wrong host identity, offline host, revoked token, and revocation followed by local deletion failure.
- Verify host work continues while the app is suspended. Record device/iOS/app versions and native captures. HTML, static source checks and simulator builds cannot establish this result.

## Bundled assets

Figtree is distributed under the included `Sotto/Resources/Figtree-OFL.txt` (SIL OFL 1.1). `Figtree.ttf`, `Figtree-SemiBold.ttf` and `Figtree-Bold.ttf` are regular (400), semibold (600) and bold (700) instances of the upstream variable font at [Google Fonts revision a60a77e](https://github.com/google/fonts/tree/a60a77e14f28abd4ef243a1b5dfc48df0cec5205/ofl/figtree), instanced with fontTools as a development operation; fontTools is not an app dependency. Static faces, because iOS does not synthesize weights for a custom font. The app icon renders this repository's existing `build/icon.svg` on Sotto's canvas. Native named colors are the default Sotto palette's light and dark roles in `src/shared/themes/palettes.ts`, converted from OKLCH to sRGB (every text pair at 4.5:1 or better); no theme/provider text is interpreted as a native color.

Current evidence and limitations: [implementation plan](../../docs/plans/ios-client.md). Native compilation, signing and device execution must be reported separately from source completion.
