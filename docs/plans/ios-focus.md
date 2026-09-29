# iPhone Focus threads

## Approved scope

Zach selected A, Focus, then approved the revision with a permanent search pill beneath the heading and computer selector and Settings replacing Needs you. The approved HTML prototype is `apps/ios/prototypes/threads-redesign/` at `0d3e5835` on `prototype/ios-threads-redesign`; approval is recorded at `54607463`. “Go ahead and implement” authorizes its native SwiftUI implementation. [ADR-0039](../adr/0039-the-iphone-opens-on-focus-threads.md) records the navigation and local-preferences decision.

Threads is the default tab. Questions and permissions lead, followed by working cards and quieter recent rows. Threads, Computers and Settings are the only tabs. Questions and permissions still open the existing request flow in thread detail; pairing, answer authority and command delivery rules stay in force. Settings keeps Dark or Light appearance and Larger text locally across launches, with Dark the default.

## Deliverables and acceptance

- [x] Record the chosen prototype and revised scope; update the glossary, overview and guide.
- [x] Implement the Focus hierarchy, persistent search pill, computer menu and Threads badge in SwiftUI.
- [x] Keep reachable requests and active work visible even when settled; keep at-rest settled work collapsed and expose matching settled results during search.
- [x] Count foreground work, confirmed background agents, background commands and running compaction correctly; unreachable snapshots do not claim live activity.
- [x] Replace the Needs you tab with Settings; preserve question, permission, reply, interrupt and recovery paths through thread detail. Every pending request is reachable through the request menu.
- [x] Persist phone-only appearance and Larger text; preserve system accessibility text sizes. Runtime verification remains below.
- [ ] Run relevant native tests and simulator compilation, root CI gates and the required standards/spec review; record actual results separately.
- [ ] Inspect native Threads, Settings, computer selection, search, Settled and request detail in light/dark, smaller/larger phone layouts, larger/accessibility text, reduced motion and with the keyboard visible.
- [ ] Verify a live paired-phone journey and report delivery state separately from source and simulator completion.

## Current state and unresolved checks

The native implementation is in [PR #474](https://github.com/millZach/Sotto/pull/474). Local typecheck, lint and notices checks passed. The full local suite, current native CI and simulator inspection remain in progress. The initial Mac run compiled the app and passed the Swift package tests before it was superseded by review fixes. Both GPT standards/spec passes identified the same two request-access findings, fixed in `26860622` and confirmed resolved by follow-up review; the Grok cross-check is pending. No live-device or release result is claimed here.

The highest-risk regressions are a waiting request hidden under Settled, a working background agent shown as Done, a cached offline snapshot shown as live work, a search that omits settled matches, or Settings shrinking system accessibility text. The actual connected journey must still establish correct authority handling and no automatic resend after an ambiguous delivery.
