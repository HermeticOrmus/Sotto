# Scaling screenshots down to the largest edge a model reads - September 26, 2026

Issue #321. The composer read a pasted, dropped or chosen screenshot straight into a base64 data URL at whatever size it came in. A high-DPI capture is megabytes, and that data URL is what every draft save, shell broadcast and persisted state carries until #320 changes how attachments are staged, and what the provider is finally sent. Both providers that take screenshots from Sotto scale an image down to a fixed long edge before the model sees it, so the pixels past that edge cost all of that and change nothing the model reads.

Zach chose option 1 on the issue: scale down to the largest long edge any supported provider reads, keep the format, never scale up.

## The bound

What each provider reads from a screenshot Sotto sends, checked on September 26, 2026:

| Provider | What it reads | Source |
| --- | --- | --- |
| Claude Code | Claude 4.7 and later models: a long edge of 2576 px and at most 4784 visual tokens (28 px patches); a larger image is downscaled before processing. Other models: 1568 px. The API's hard limit is 8000x8000 px. | [Vision, "Resolution and token cost"](https://platform.claude.com/docs/en/build-with-claude/vision) |
| Codex | Codex resizes a data-URL image itself before the request leaves the computer. An image with no detail setting, which is how Sotto sends one (`{ type: 'image', url }`), gets `high` detail: at most 2048 px on either side and 2,500 patches of 32 px. `original` detail would allow 6000 px and 10,000 patches, but Sotto does not ask for it and Codex's `unified_image_budget` feature, which would apply it to every image, is under development and off by default. | Codex `rust-v0.157.1`: [`utils/image/src/lib.rs`](https://github.com/openai/codex/blob/rust-v0.157.1/codex-rs/utils/image/src/lib.rs) (`HIGH_DETAIL`, `ORIGINAL_DETAIL`), [`core/src/image_preparation.rs`](https://github.com/openai/codex/blob/rust-v0.157.1/codex-rs/core/src/image_preparation.rs) (`resize_image`), [`features/src/lib.rs`](https://github.com/openai/codex/blob/rust-v0.157.1/codex-rs/features/src/lib.rs) (`unified_image_budget`); the API side in [Images and vision](https://developers.openai.com/api/docs/guides/images-vision) (for gpt-5.5 and gpt-5.4, `high` is 2,500 patches and a 2048-pixel maximum dimension) |
| Grok Build | Nothing: Grok's client reports no image input, so Sotto never sends Grok a screenshot. xAI's own page gives a 20 MiB file limit and JPEG or PNG, and no pixel bound. | [Image understanding](https://docs.x.ai/developers/model-capabilities/images/understanding); `docs/agent-control.md` |

The largest of these is Claude's 2576 px, so `SCREENSHOT_MAX_LONG_EDGE` in `src/renderer/src/agents/screenshotResize.ts` is 2576. For a 16:9 capture that is 2576x1449, the size Claude's own table gives for a 3840x2160 image, and exactly Claude's 4784-token budget. A squarer image at 2576 px can still be over Claude's token budget, and Codex still scales anything down to its 2048 px itself; the bound is a long edge only, as chosen, so it never takes away a pixel any model reads.

If Sotto starts sending Codex images with `original` detail, or Codex turns its unified budget on, Codex would read up to 6000 px and the bound should be raised to match.

## What changed

`ScreenshotInput` now hands each file to `prepareScreenshot` before it reads it. That decodes the image with Chromium's own decoder (`createImageBitmap`), and when its longer edge is past the bound, draws it at the bound on an `OffscreenCanvas` and writes it back in the same format: PNG as PNG, JPEG and WebP as themselves at quality 0.92. A GIF is left as it is, because a canvas cannot write one. The scaled copy is used only when it is smaller than the file: a capture of flat panels and text compresses so well as a PNG that the smoothing of a scaled-down copy can make it larger, and then the original goes as it came. An image the renderer cannot decode goes as it came too, with no sizes recorded, which is what happens in jsdom.

Each attachment now records `dimensions: { original, sent }` in pixels, sizes and nothing else. The chip under a scaled-down screenshot says "Resized", with "Resized from 3840 by 2160 to 2576 by 1449 pixels" as its tooltip and as the text a screen reader reads. The adapters build their attachment references field by field and ignore the new one.

The per-image 10 MB and 20 MB total refusals still check the files as the user attached them, before anything is read, so they refuse exactly what they refused before.

## Measurements

`tests/perf/screenshotResize.perf.test.ts` launches the built app, pastes a drawn screenshot into the Workshop thread's composer, times the paste event to the thumbnail appearing, waits for the saved draft to carry it, and reads back the size of its data URL and the pixel size it decodes to. It then removes the screenshot and pastes the next. Each case is one warm paste and then the median of five. The drawing is seeded lines of text on a dark panel with a noisy colour gradient down the right-hand side standing in for a photograph, wallpaper or video frame, which is what makes a real capture megabytes; one case leaves the gradient out. Three runs on each side on the development machine (Windows 11, Electron's Chromium), the before column against a build of `origin/main` (e093bd6c) run through `SOTTO_E2E_MAIN_ENTRY`, with other agents' work running on it.

| Case | File | Before: sent, paste to thumbnail | After: sent, paste to thumbnail |
| --- | ---: | ---: | ---: |
| 3840x2160 PNG, a quarter photograph | 4.68 MB | 4.68 MB at 3840x2160, 44-46 ms | 2.44 MB at 2576x1449, 152-171 ms |
| 5120x2880 PNG, a quarter photograph | 8.51 MB | 8.51 MB at 5120x2880, 75-86 ms | 2.39 MB at 2576x1449, 204-213 ms |
| 3840x2160 JPEG, half photograph | 1.77 MB | 1.77 MB at 3840x2160, 20-30 ms | 0.72 MB at 2576x1449, 89-93 ms |
| 3840x2160 PNG, text and flat panels only | 0.60 MB | 0.60 MB at 3840x2160, 7-12 ms | 0.60 MB at 3840x2160, 81-132 ms |
| Floor: 1920x1080 PNG, a quarter photograph | 1.29 MB | 1.29 MB at 1920x1080, 15-20 ms | 1.29 MB at 1920x1080, 28-30 ms |

The data URL is base64, a third larger than these byte counts, and until #320 lands it is carried by every draft save and broadcast while the screenshot sits in the composer, then sent to the provider. A 4K capture with a photograph in it now carries about half as many bytes and a 5K one just over a quarter. The JPEG case carries about 40 percent.

The price is paid once, at paste: decoding the image, and for a large one drawing and encoding the copy, costs 60 to 130 ms more than reading the file did. The flat 4K PNG pays for the copy and then throws it away because it came out larger (0.68 MB against 0.60 MB in a probe of the same drawing). The floor case is decoded only to record its size, about 12 ms. "Adding screenshots..." shows while this happens and Send waits for it, as it already did for the read.

## What the numbers are not

The drawing is not a real screenshot. A capture of an editor or a web page with no photographs in it is closer to the flat case, where nothing changes but the extra time at paste; a capture of a video, a design file or a photo library is closer to the photograph cases. The timings are wall time from the paste to the thumbnail and include the draft save's React work; they do not separate what ran on the renderer's main thread from what Chromium did off it. The byte counts do not depend on the machine, given the same Chromium encoder, and are the part to compare between commits.

## Re-run

Build first; the benchmark launches `out/main/index.js`. It is skipped unless `SOTTO_PERF_BENCH=1` is set:

```sh
npm run build
SOTTO_PERF_BENCH=1 npx vitest run tests/perf/screenshotResize.perf.test.ts --maxWorkers=1 --disable-console-intercept
```

For the before column, build this change's parent commit, copy its `out/` folder somewhere under the checkout, and point the benchmark at it with `SOTTO_E2E_MAIN_ENTRY=<copy>/out/main/index.js`. `tests/unit/renderer/screenshotResize.test.ts` and `tests/unit/renderer/screenshotInput.test.tsx` pin the behaviour: a 3840x2160 PNG comes out at 2576x1449 as a PNG, a 1200x800 PNG goes byte for byte, a JPEG stays a JPEG, a GIF and a copy that would be larger go as attached. `tests/e2e/screenshot-resize.spec.ts` checks the same in the built app with Chromium's real decoder and encoder.
