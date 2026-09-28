<div align="center">

<img src="build/icon.png" alt="Sotto icon" width="96" />

# Sotto

**Your coding agents in one desktop window, with dictation built in.**

[![Latest release](https://img.shields.io/github/v/release/millZach/Sotto-releases?label=release&color=2f6f6a)](https://github.com/millZach/Sotto-releases/releases/latest)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20x64%20%C2%B7%20macOS%20arm64-2f6f6a)](#install)
[![License: MIT](https://img.shields.io/badge/license-MIT-2f6f6a)](LICENSE.md)

**[Download the latest release](https://github.com/millZach/Sotto-releases/releases/latest)**

<img src="artifacts/changes-diff/changes-working-1600x1000-wide-dark.png" alt="A Claude Code thread with its changes open beside it" width="880" />

</div>

Sotto runs the Claude Code, Codex, Grok Build and Devin clients you already have, and keeps every thread in one sidebar. It is free, open source and in beta.

## What it does

- **One sidebar for every agent.** Each provider keeps its own sign-in and models. Sotto keeps the threads. Stop still reaches running work when its last prompt is unconfirmed.
- **You answer every request.** Anything a thread's permissions don't already allow waits for you. A paired device needs your permission to answer requests or create threads with permissions that allow actions without asking, even when those permissions come from the host's defaults.
- **Tools beside each thread.** A browser, a terminal, the thread's files and its changes.
- **Codex's Computer Use.** In a Codex thread set to Full access, with the Codex app open, Codex can operate the apps on your computer.
- **Git in one press.** Commit, push and open a pull request. Leave the message empty and the agent writes it.
- **Worktrees for parallel work.** Give a thread its own branch and folder, and remove the folder when you're done.
- **Dictation anywhere.** Press `Ctrl+Shift+Space` (`⌃⇧Space` on a Mac), speak, and press it again. The text is copied and can be pasted at your cursor.

Thread drafts save automatically while you type, including while other threads are working.

In Settings, **Test microphone** checks the same input selected for dictation. Changing the input clears the previous test.

## Install

You need Windows 10 or 11 (x64), or an Apple silicon Mac with macOS 12 or newer.

**Windows.** Run `Sotto Setup <version>.exe`. At least 1 GB of free space during installation is needed. The desktop shortcut is optional and unchecked by default. The installer isn't code-signed, so Windows may show a SmartScreen warning.

**macOS.** Drag Sotto into Applications. The app isn't notarized, so the first launch is blocked: open **System Settings → Privacy & Security** and press **Open Anyway**, or run:

```bash
xattr -dr com.apple.quarantine /Applications/Sotto.app
```

Then install and sign in to at least one agent client, and connect it in **Settings → Providers**. For dictation, add an [OpenRouter API key](https://openrouter.ai/keys) in Settings.

## Privacy and cost

Sotto has no account of its own and collects nothing about you: no analytics, no crash reports. Your data leaves your computer only when a feature you use needs it, and only to that feature's service:

- **Dictation** goes to OpenRouter (`openrouter.ai`) on your key, where Microsoft MAI-Transcribe-2 transcribes it. Audio is never saved to disk. OpenRouter charges about $0.10 per hour of audio.
- **Optional AI cleanup** sends the finished text to OpenRouter too. It is off until you turn it on.
- **Your threads** go to the agent's own provider, under that provider's account and data policy.
- **Screenshots** you attach to a thread, or add from Sotto's browser as feedback, are scaled down, in the same format, to 2576 pixels on their longer side before they go anywhere, because that is the most any model Sotto sends them to reads: Claude 4.7 and later read up to 2576 and Codex up to 2048. The pixels past it would cost transfer and storage and change nothing the model reads. Smaller images, animated ones, GIFs, and any the smaller copy would not make smaller in bytes, go as you attached them; nothing is scaled up.
- **Sotto's browser** is used by agents without asking, by default: they can open pages, click and type there, including on sites you are signed in to in it. Turn that off in Settings → Application, or stop it for one thread in Tools → Browser.
- **Git** talks to your own remotes, including a background fetch every 30 seconds while the window is in front (you can change or turn it off in Settings → Git), and to GitHub through `gh` on your own sign-in for pull requests.
- **Phone access**, once you turn it on in Settings → Phones, sends your threads, and the replies you send from a phone, to the iPhones you pair, over your own tailnet. Sotto runs the `tailscale` command on this computer to set up Tailscale Serve on port 8443; that command talks to the Tailscale app already running here, so no new service is contacted. If your tailnet has not turned Serve on, Settings → Phones offers to open the `login.tailscale.com` page Tailscale gives for it, in your browser, only when you press it. Only phones you pair can connect, and a phone answers questions and permissions only after you turn on Can answer for it. Turning it off, or quitting Sotto, removes the Serve setting.
- **Update checks** ask GitHub for new Sotto versions (Windows) and `registry.npmjs.org` for new agent client versions. Both can be turned off.
- **Only if you use them:** `api.openai.com` and `api.x.ai` for optional reasoning and reply voices, `open-vsx.org` (with `openvsxorg.blob.core.windows.net` and `openvsx.eclipsecontent.org`) for themes, `huggingface.co` for the natural voice download, SSH hosts you add, and pages you open in Sotto's browser.

Dictation history stays on your computer, and you can turn it off. Screenshots you attach to a thread are kept as files on the computer that runs the thread, only while an unsent draft, a queued message or a recent message's preview needs them and for an hour after; with history off, new ones stay in memory and are not written to disk. Keys are kept in your operating system's credential store.

If thread messages cannot be saved, Sotto keeps them in memory and retries while it is open. The warning stays until they are saved. Restore storage access before quitting; unsaved messages cannot survive a restart.

The iPhone app, in development, talks only to your own Sotto host, through your private Tailscale address. It looks the host's name up through Tailscale's own name service on the phone, pairs with a code the host prints, and never answers a permission unless you have allowed it on the host.

## Build from source

With Node.js 24:

```sh
npm ci
npm run runtime:verify
npm run dev
```

`npm run package:win` and `npm run package:mac` build the installers. Each packaging command automatically verifies the source runtime before packaging.

## More

- [Guide](docs/guide.md): every feature, settings, remote hosts and troubleshooting
- [Agent control](docs/agent-control.md): providers and threads in depth
- [iPhone app](apps/ios/README.md): building, pairing and installing the iPhone client (in development)
- [Contributing](AGENTS.md)

## License

[MIT](LICENSE.md). Third-party licenses are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
