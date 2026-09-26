# Screenshot resize verification

September 26, 2026. Issue #321, on `perf/screenshot-resize` from `main` at e093bd6c. The bound, the sources behind it and the byte and timing measurements are in [the performance note](../perf/2026-09-26-screenshot-resize.md).

## In the built app

`tests/e2e/screenshot-resize.spec.ts` launches the built app with the e2e success scenario, opens the Workshop thread and pastes four images drawn in the window's own canvas into its composer. For each it waits for the saved draft to carry the attachment, then checks the recorded sizes and decodes the data URL the draft holds in the window to read its real pixel size.

- A 3840x2160 PNG with a photograph-like strip is saved as a PNG (the data URL starts with the PNG signature), records `{ original: 3840x2160, sent: 2576x1449 }` and decodes at 2576x1449. Its chip says **Resized**, and the text a screen reader reads is "Resized from 3840 by 2160 to 2576 by 1449 pixels".
- A 1200x800 PNG records the same size both ways, decodes at 1200x800 and has no note.
- A 4032x3024 JPEG is saved as a JPEG (the data URL starts with the JPEG signature) and decodes at 2576x1932.
- A 3840x2160 PNG of text and flat panels only, whose scaled-down copy comes out larger in bytes, is saved as it was attached: 3840x2160 both ways, and no note.

Exactly two chips carry the note. The spec then sets reduced motion and, at 1600x1000, 1280x800 and the 820x560 minimum in dark and light, checks that Send and the first noted chip are in the viewport and that the note sits inside its chip without overflowing it. The first run failed that last check at 820x560: the compact composer lays a chip out as a three-column grid of thumbnail, name and remove, and the note had fallen into the remove button's column. `threads.css` now puts the note under the name in that layout, with the thumbnail and the remove button spanning both lines, only for a chip that has the note.

## Captures

- `artifacts/screenshot-resize/composer-1600-dark.png`: the full composer at 1600x1000 in dark, four chips in the wide layout, two of them saying Resized under the name.
- `artifacts/screenshot-resize/chips-1600-light.png`: the same chips alone in light.
- `artifacts/screenshot-resize/composer-820-dark.png` and `composer-820-light.png`: the minimum window, the compact one-row chips, with Resized under the name of the two scaled-down ones and the remove button still at each chip's right.

The note uses `--tt-text-muted`, the colour the name above it already uses, at the name's size in the Threads view (12 px) and 10 px elsewhere. No new colour, no motion.

## Not checked

The note was checked in a thread's composer (`ThreadComposer`). The coordinator's composer (`AgentView`) renders the same `ScreenshotInput` but was not captured. No live provider received a resized image in this pass: the adapters send the data URL as before, only smaller, and `tests/unit/main/claudeImages.test.ts` and `codexImages.test.ts` cover the send path unchanged.

## Re-run

```sh
npm run build
npx playwright test tests/e2e/screenshot-resize.spec.ts
```

Captures go to `artifacts/screenshot-resize-run/`, which is ignored; the four cited above were copied from there.
