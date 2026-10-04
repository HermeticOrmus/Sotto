# Sotto runs the Tailscale app as a command, and a signed-out node is its own state

## Status

Accepted October 4, 2026. Amends [ADR-0033](0033-the-desktop-lets-paired-phones-reach-its-threads.md) and [ADR-0034](0034-add-host-lists-this-computers-tailnet.md). Numbered 0048: 0047 was taken by the cloud iPhone decision on `ormus` while this was in review.

## Context

Add host already lists this computer's tailnet (ADR-0034): `tailscale status --json` beside the SSH setup, MagicDNS names, and **Can't use now** for offline devices, phones, this computer and Git services. Connect to Tailscale and Get Tailscale are already there. Tailscale is never required.

Two things that list still got wrong.

On a Mac the Tailscale window and the `tailscale` command are the same executable, at `/Applications/Tailscale.app/Contents/MacOS/Tailscale` for both the App Store app and the standalone app. Tailscale decides which one to be from terminal variables such as `TERM`. Sotto started from the Dock has none of those, so running that path opened the Tailscale window instead of printing status. The standalone client's CLI launcher lives at `/usr/local/bin/tailscale`, and Homebrew's at `/opt/homebrew/bin/tailscale`; neither directory is on a Dock-launched app's PATH, so looking up `tailscale` missed both. Windows was already covered by `%ProgramFiles%\Tailscale\tailscale.exe`.

A signed-out node (`BackendState` `NeedsLogin`) was read as off, the same as a node that is only stopped. The row said "Off" and offered **Connect to Tailscale** for both. Signing in and reconnecting are the same `tailscale up`, but they are not the same situation, and the window should say which one it is.

## Decision

**The command is forced.** Every `tailscale` run sets `TAILSCALE_BE_CLI=1` and keeps the rest of the environment. That is what Tailscale documents for a script that must parse `tailscale status` on macOS. Windows and Linux ignore the variable. The lookup order stays an argument array through `execFile`, no shell:

1. `tailscale` on the PATH.
2. On Windows, `%ProgramFiles%\Tailscale\tailscale.exe`.
3. On a Mac, `/usr/local/bin/tailscale`, then the app bundle, then `/opt/homebrew/bin/tailscale`. The app comes before Homebrew so a leftover `brew` binary does not hide the app the user actually runs. The first executable that exists is the one remembered.

**Signed out is its own state.** `NeedsLogin`, and only that exact backend state, is `logged-out`. The window says "Signed out" and offers **Sign in to Tailscale**. Stopped, a service that is not answering, and any other backend state (`NeedsMachineAuth`, `Starting`, and the rest) stay `off`, with **Connect to Tailscale**. Both presses still run `tailscale up` with no flags. A signed-out status lists no devices, even if the JSON carries some: peers are read only while the backend says `Running`. Health sentences are not read. Not installed stays **Get Tailscale**. The SSH setup still lists in every one of these states.

## Consequences

- Sotto contacts no new host. The CLI still talks only to the local Tailscale service, and the pages that open are still opened by a press.
- Phone access uses the same runner, so its checks no longer open the Tailscale window on a Mac either. Its own checklist still treats signed out and stopped as one "not running" row; that copy already names both.
- End-to-end runs still stand a file in for the CLI and never start the machine's Tailscale.
- A node waiting for an admin to approve it (`NeedsMachineAuth`) still reads as off. Naming that wait is left for later, as are Tailscale SSH as its own transport and reading tailnet tags or ACL rules.
