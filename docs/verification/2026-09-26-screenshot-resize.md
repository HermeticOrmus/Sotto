# Screenshot resize verification

September 26, 2026. Issue #321, on `perf/screenshot-resize` from `main` at e093bd6c. The bound, the sources behind it and the byte and timing measurements are in [the performance note](../perf/2026-09-26-screenshot-resize.md).

## In the built app

`tests/e2e/screenshot-resize.spec.ts` launches the built app with the e2e success scenario, opens the Workshop thread and pastes four images drawn in the window's own canvas into its composer. For each it waits for the saved draft to carry the attachment, then checks the recorded sizes and decodes the data URL the draft holds in the window to read its real pixel size.

- A 3840x2160 PNG with a photograph-like strip is saved as a PNG (the data URL starts with the PNG signature), records `{ original: 3840x2160, sent: 2576x1449 }` and decodes at 2576x1449. Its chip says **Resized to 2576 x 1449**, and the text a screen reader reads is "Resized from 3840 by 2160 to 2576 by 1449 pixels".
- A 1200x800 PNG records the same size both ways, decodes at 1200x800 and has no note.
- A 4032x3024 JPEG is saved as a JPEG (the data URL starts with the JPEG signature) and decodes at 2576x1932.
- A 3840x2160 PNG of text and flat panels only, whose scaled-down copy comes out larger in bytes, is saved as it was attached: 3840x2160 both ways, and no note.

Exactly two chips carry the note. The spec then sets reduced motion and, at 1600x1000, 1280x800 and the 820x560 minimum in dark and light, checks that Send and the first noted chip are in the viewport and that the note sits inside its chip without overflowing it. The first run failed that last check at 820x560: the compact composer lays a chip out as a three-column grid of thumbnail, name and remove, and the note had fallen into the remove button's column. `threads.css` now puts the note under the name in that layout, with the thumbnail and the remove button spanning both lines, only for a chip that has the note.

## Captures

- `artifacts/screenshot-resize/composer-1600-dark.png`: the full composer at 1600x1000 in dark, four chips in the wide layout, two of them saying "Resized to" and their new size under the name.
- `artifacts/screenshot-resize/chips-1600-light.png`: the same chips alone in light.
- `artifacts/screenshot-resize/composer-820-dark.png` and `composer-820-light.png`: the minimum window, the compact one-row chips, with "Resized to" and the new size under the name of the two scaled-down ones and the remove button still at each chip's right.

The note uses `--tt-text-muted`, the colour the name above it already uses, at the name's size in the Threads view (12 px) and 10 px elsewhere. No new colour, no motion.

`tests/e2e/agent-browser.spec.ts` adds browser feedback to a draft through the same path, now through `prepareScreenshotDataUrl`, and still finds the one attachment on the saved draft. Its capture is under the bound, so it is handed on untouched; `tests/unit/renderer/tools/browserReview.test.tsx` covers one past it.

After the review, the sizes a file names in its first bytes are read before anything is decoded (`tests/unit/renderer/screenshotResize.test.ts` pins PNG, animated PNG, JPEG with and without an EXIF quarter turn, the three WebP kinds and GIF), several files are read one at a time (`screenshotInput.test.tsx`), and a screenshot still being read when the user moves to another thread lands in the draft it was pasted into (`threadsView.test.tsx`). The second review found the sizes only in a tooltip, which a keyboard user never sees, so the chip now shows the sent size itself ("Resized to 2576 x 1449") and the captures above were taken again.

## Not checked

The note was checked in a thread's composer (`ThreadComposer`). The coordinator's composer (`AgentView`) renders the same `ScreenshotInput` but was not captured, and it still drops a screenshot that finishes reading after its thread changes, because its draft follows the coordinator's current target rather than the thread the screenshot was pasted into. No animated PNG or WebP, and no Display P3 capture, went through the built app. No live provider received a resized image in this pass: the adapters send the data URL as before, only smaller, and `tests/unit/main/claudeImages.test.ts` and `codexImages.test.ts` cover the send path unchanged.

## Re-run

```sh
npm run build
npx playwright test tests/e2e/screenshot-resize.spec.ts
```

Captures go to `artifacts/screenshot-resize-run/`, which is ignored; the four cited above were copied from there.
