# A test iPhone that threads can drive

Zach asked for an iPhone that agents can use to test the apps they build, inside Sotto on Windows, starting from his Virtual iPhone widget (`millZach/virtual-iphone`, read at `44c9364`). Planned on `origin/main` at `e5686a97`.

## What Virtual iPhone is

It has two modes, and neither can be driven by an agent as it stands.

- **Mirror my iPhone** is an AirPlay receiver (AirPlayServer/MirrorSimAdapter). It shows the real phone's screen and sends nothing back: no taps, no typing. AirPlay has no input channel, so this stays view-only whatever Sotto does with it.
- **App preview** loads a web build (Expo web, Vite, Next) into a phone-sized Chromium view inside an iPhone 15 Pro frame. It is not iOS and does not run `.ipa` files.

Windows cannot run Apple's iOS Simulator. A native app needs a Mac, a real phone with a signed helper, or a cloud device service.

## What Zach chose (October 3, 2026)

- Web and Expo-web builds first, then native apps on a **cloud device service**, the cheapest one that is good for agents.
- A new **iPhone** surface in the Tools panel, and a phone that floats over the thread while an agent works in it.
- The same default as the browser: a thread uses it without asking (ADR-0029).
- Prototype variant **C, Floating phone, control tab** (`docs/prototypes/iphone-tool-prototype.html`): the phone is Virtual iPhone's framed widget brought into Sotto, and Tools > iPhone is its control page, not a second view of the screen.
- Bring Virtual iPhone's look, not its AirPlay receiver.

## Phase 1: the test iPhone

**The test iPhone is a page in Sotto's browser, in a phone's shape** (ADR-0045). It is not a second browser. It reuses `BrowserService`'s pages, tasks, sharing, evidence and the browser grant, so ADR-0029's grant covers it without a second standing grant (ADR-0029 forbids extending it to anything that is not Sotto's browser).

What makes a page a phone, checked in Electron 43 before planning (`.claude/tmp/iphone-spike`):

- **Size by page zoom, not device emulation.** The native view sits in the phone's screen at whatever size the player draws, and its zoom factor is `width / 393`, so the page lays out at 393 CSS pixels wide however large the phone is drawn. `enableDeviceEmulation` with a `scale` was tried and rejected: CDP input then lands at `1 / scale` of the requested point.
- **CDP input lands where the agent aims.** With page zoom, `Input.dispatchTouchEvent` at (110, 200) reached the page at (110, 200), fired `pointerdown`, `touchstart`, `touchend` and `click`, and a ten-step touch move scrolled the page. `Input.insertText` typed into the tapped field.
- **Its own session.** Chromium keeps zoom per origin in a session, so phone pages get their own partition per workspace (`sotto-phone-…`). A phone also keeps its own storage, as Virtual iPhone's preview did.
- **An iOS Safari user agent**, touch emulation while the debugger is attached, and scrollbars hidden with `insertCSS` (no preload, ADR-0020).
- **Rounded corners** with `WebContentsView.setBorderRadius`.

One test iPhone per thread. `iphone_open` loads the thread's phone, or opens it the first time.

### Agent tools

On the existing `sotto_browser` endpoint, so no provider wiring changes:

- `iphone_open {url, description}` opens a URL on the thread's test iPhone and starts a browser task on it.
- `browser_action` gains `tap {x, y}`, `swipe {x, y, toX, toY}` and `key {key}` (Enter, Backspace, Tab, Escape and the arrows). They work on any page. On the phone they are CSS pixels of a 393 by 852 screen.
- The browser grant covers `tap` and `key` as it covers `click` and `type`; `swipe` asks for nothing, like `scroll`. A `viewport` action on the phone is refused: the phone keeps its size.

### Main

- `BrowserService` can show two pages at once: one in the Tools pane and one in the phone. Which slot a page takes follows from the page (`device`), so the mount request does not change.
- The phone page is excluded from Tools > Browser and from the Browser player.

### Renderer

- **Phone player** (`PhonePlayer.tsx`): the framed iPhone 15 Pro over the thread, with Virtual iPhone's label pill above (drag, size, hide) and a status pill below (what the agent is doing, Pause, a request's Allow once / Allow this thread / Deny). It opens on its own when the focused thread starts a task on its phone, under the same setting as the Browser player. The user can tap and type in it too.
- **Tools > iPhone** (`IPhoneSurface.tsx`): the address to load a web build, Reload, Close, Share with the thread, the grant line, and the task's steps. Show phone or Hide phone.
- A live dot on the rail while a phone task works or waits.

### Docs

ADR-0045; `CONTEXT.md` (Test iPhone, Phone player, the Tools panel's seven surfaces, the browser grant reaching the phone); `README.md` and `docs/guide.md`; `docs/agent-control.md` for the tools; a verification note with screenshots.

## Phase 2: a cloud iPhone

Native apps on a cloud device service. It adds a host and a key, so ADR-0046 and the README's Privacy and cost line come before any code. The provider is chosen in `docs/research/2026-10-03-cloud-ios-devices.md`. Not started in this branch.
