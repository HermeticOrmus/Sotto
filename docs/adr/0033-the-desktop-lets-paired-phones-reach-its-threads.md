# The desktop lets paired phones reach its threads

## Status

Accepted September 26, 2026, by the owner's choice of variant C, "Guided setup", in `docs/prototypes/phone-access-prototype.html`. Amends [ADR-0025](0025-headless-host-and-client-identity.md), which said the desktop adds no production listener.

## Context

The iPhone app (#225) speaks host protocol v1 to a host: health, pair, session, revoke and the socket. Until now only a headless host opened that listener, so a phone could reach threads only on a machine that ran one. Most of the owner's threads run in the desktop app's own local host, on the computer in front of them. T3 Code solves the same problem by letting its desktop app serve its own threads to its phone app over the owner's tailnet.

The options considered:

1. **Headless host only, on each computer.** Keep the desktop without a listener and ask the owner to run a headless host beside it for the phone. Rejected: the headless host has its own data folder and its own threads, so the phone would see a second set of threads rather than the ones on screen, and every computer would need a second process set up by hand.
2. **The desktop's own listener, reached through Tailscale Serve.** Chosen. The desktop opens the same socket server the headless host uses, over its own host service, and asks Tailscale Serve on this computer to carry it to the tailnet.
3. **A relay.** A Sotto service both sides connect out to. Rejected: it adds a host every thread's content would pass through, an account to run it, and a party the README would have to name; Tailscale already gives a private, authenticated route between the owner's own devices.

## Decision

**Phone access** is a setting, `phoneAccess`, off by default, with a Phones page in Settings after Hosts. It applies at once, without a restart. It needs the local host, since what it serves is the local host's threads; with the local host off, the page says so and offers to go to Hosts.

While it is on, main starts the host protocol listener (`startSocketServer`) over the desktop's own `hostService`, so a phone sees exactly the threads this window's local host shows, and never a remote host's. Each computer shares only its own threads; a phone paired with several computers merges them itself. The listener binds `127.0.0.1` only, on a loopback port Sotto remembers in `phone-access.json` in the user data folder and falls back from when it is taken. Paired phones are kept in `paired-clients.json` in the same folder, through the same `PairedClients` store the headless host uses.

Sotto runs Tailscale Serve itself: `tailscale serve --bg --https=8443 http://127.0.0.1:<port>`. That is tailnet only; Sotto never runs Funnel. Port 443 is left alone, because other apps use it (T3 Code does on the development machine). The CLI is found without a shell, on the PATH, then at `%ProgramFiles%\Tailscale\tailscale.exe` on Windows or inside `/Applications/Tailscale.app` on macOS, and every call is `execFile` with an argument array and a timeout. `tailscale status --json` gives the checklist's first row and the address, and `tailscale serve status --json` says who holds 8443. Sotto changes only a setting that is its own: one HTTPS proxy at `/` to one of its loopback ports, with Funnel off. Anything else on 8443 is left as it is, and the page says another app uses the port. When the tailnet has not turned Serve on, the CLI prints a consent page on `login.tailscale.com`; Sotto stops there, says so plainly, and opens that page only when the owner presses the button for it. The CLI talks to the local Tailscale service, so Sotto contacts no new host.

Turning phone access off removes the 8443 setting if it is Sotto's, then closes the listener and with it every phone's socket. Quitting does the same, so a loopback port nothing listens on, which another app might bind later, is never left reachable from the tailnet; the next start puts it back while the setting is on. Sotto records that it asked for the setting before asking, and clears the record once the setting is gone, so a crash's leftover is removed at the next start even with phone access off. With the setting never used, Sotto never runs the CLI.

Pairing codes are issued only from the Phones page: one live code at a time, eight characters, good once for five minutes, held in memory and never logged. Showing a new code or cancelling withdraws the old one, and a phone redeeming it closes the card and lists the phone. The listener's administrative routes are off on the desktop: it administers the listener in-process through IPC to the main window, so no admin token exists on disk or reaches the tailnet. Health gains an optional `name`, the computer's name as phones show it, from the setting `phoneAccessName` or, when that is empty, the Tailscale machine name or the computer's own. The headless host sends no name.

A paired phone reads threads and replies. Its answers to questions and permissions count only after the owner turns on **Can answer** for it on the Phones page, which writes the `remote-answer` policy record scoped to that phone (ADR-0004); the switch is the only thing that writes one, and turning it off revokes it. **Remove** asks first, then revokes the pairing, revokes any such record, and closes the phone's sockets at once. The headless host's own allow and deny commands and the Phones page now share one helper, `PolicyStore.setRemoteAnswers`, so a client never holds two records that disagree.

## Paired clients may choose reasoning (September 30, 2026)

The owner decided in #609 that pairing also lets a phone change the coordinator's `reasoning` provider and `reasoningModel`, without **Can answer**. These choices can send assignment text and relevant thread context to a different reasoning host named in the README's Privacy and cost section, using credentials already saved on the computer. Pairing therefore trusts the phone to choose where coordinator reasoning runs, as well as to read threads and send replies. This records the existing remote configuration allow-list; it adds no command or destination.

This choice grants no permission to an agent and writes no policy record. Answers to questions and permissions still require the phone's `remote-answer` policy (ADR-0004). Credentials, endpoints and the voice engine stay host-local; a paired phone cannot supply a key or an arbitrary reasoning endpoint.

## Consequences

- The desktop now has a production listener, on loopback only, while phone access is on. Everything that reaches it comes through Tailscale Serve on the owner's tailnet and then through pairing and signed sessions; nothing outside the tailnet can reach it, and nothing on the tailnet can do more than a paired client may (the remote command list in ADR-0025 applies unchanged).
- Thread content, and the replies a phone sends, travel to the owner's paired phones over their tailnet. The README's "Privacy and cost" section says so.
- Tailscale often starts after Sotto at sign-in. When Tailscale is not running, the page says so and Sotto looks again every 30 seconds while phone access is on, besides the Try again button.
- The switch shows the setting, not whether the last attempt worked: a failed step is shown on its own row with what to do, and the owner does not have to turn the switch off and on again. The prototype drew the switch off in those states; keeping the setting on is what lets a reboot race with Tailscale recover by itself.
- A second desktop on the same tailnet can do the same on its own computer; each serves its own threads on its own 8443.
