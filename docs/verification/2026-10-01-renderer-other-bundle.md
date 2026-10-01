# Renderer recovery and accessibility fixes

Package pkg-37 covers #564, #596, #597 and #600 on Windows.

The regression tests were run against the old behavior before each fix. Dictate
checks both daylight-saving transitions in America/Los_Angeles only after
verifying the dates have different UTC offsets. A worker that ignores the
runtime timezone skips with an explicit reason. Phones and Hosts
check rejected saves, retained values and successful retries. Files holds the
first root listing, retries a failed listing for a nested file and closes a
preview while its root is pending. Accessibility tests check hidden readable text for the pairing code and
questionnaire progress, with their visual forms hidden from screen readers.
Neither label uses an image role or live region.

`renderer-save-feedback.spec.ts` ran the built Electron app. It replaced only its
owned profile's settings file with a directory to force real save failures, then
restored the file and saved again through the keyboard. All three controls passed
at 1600x1000, 1280x800 and 820x560, in light and dark with reduced motion on.
The local-host view checks horizontal overflow. The retained screenshots were
inspected: the errors wrap beside their controls without clipping.

- [Local host, 820x560 dark](../../artifacts/renderer-save-feedback/local-host-820-dark.png)
- [Phone access, 820x560 light](../../artifacts/renderer-save-feedback/phone-access-820-light.png)

The existing hosts, memory and dictation recovery journeys passed. The first
phones journey stopped on its hard-coded September pairing expectation on
October 1; the assertion now derives the date from the actual pairing timestamp.
The first Tools rail journey stopped before the Changes file list appeared;
its separate Changes scope journey passed. A standalone rail rerun stopped when
switching back to Working changes. The identical assertion failed against a
built archive of baseline `2f1d74f240cbcd2b3ab6a1b0e5a212111ccc5221`, kept
inside this worktree with no dependency links or changes to the main checkout.
The phones rerun passed after correcting the dated assertion. The final focused
unit run passed all 84 tests. Full-suite results are recorded in the pull request.
No design baselines were regenerated.

The prototype comparison lives on `prototype/pkg-37-save-feedback`. Variant A
places feedback beside the control, following #596's requested placement. This
was the reversible assumption used after asking for clarification; no alternative
layout was selected by the user. The implementation uses the app's real controls
and theme tokens. No domain term or architectural decision changed.

## Review correction

The PR review reproduced a busy preview when opening a file four or five folders
deep: ancestor reads consumed the service's four request slots before the preview
started. Files now queues its reads and path actions within that same limit,
shared with main as a constant. A controlled bridge holds each read and rejects a
fifth concurrent request. Both deep-path regressions failed before this correction
and pass after it, with every expanded folder and the preview ready without Retry.

## Rework checks

The stalled-queue regression failed before the deadline was added and passed
afterward. It holds all four slots, advances fake timers through the ten-second
wait for a root listing, preview and Retry, then releases the reads and checks
that expired waiters do not obstruct recovery. The deep-path tests still pass.
The accessibility regressions also failed before their labels were changed.

The normal DST regression executed and passed. Starting the threads pool in UTC
produced 19 passed and one explicitly skipped test, confirming that the offset
guard prevents a vacuous DST pass. Field errors again use their existing input
description without making unrelated fields live regions.

The throwaway semantics demo is retained on
`prototype/readable-progress-pairing-text`. It preserves the visual count and
code and shows the readable text separately, without a live region. The wording
was a reversible assumption after clarification was requested; no user choice
was recorded.
