# Dictionary save acknowledgements (#382)

Base: `2a3bcbb6`. Settings now matches each dictionary acknowledgement to the submitted edit revision. Newer typing survives earlier acknowledgements, including several queued blur/refocus cycles. A failed save retains the current text for the next blur. External dictionary updates remain authoritative, and returning to the previous value still queues a save when a different value is already pending. No field layout, copy, parsing, validation limit or keyboard behavior changed.

The desired-behavior renderer regression first failed four cases on the unchanged baseline. Nine final cases exercise both acknowledgement/result orders, queued saves, queued reverts, rejected and failed saves, external settings publications, normal multiline keyboard blur and unchanged-value suppression. The existing settings and neighboring suites passed 97 tests across four files (34.05 seconds). These are operation and state assertions, not timing benchmarks. Typing only updates local state and its edit revision; writes occur on blur, and another blur without an edit does not duplicate the pending save.

The real built Electron journey `tests/e2e/settings-index.spec.ts` passed (one test, 30.6 seconds). It exercises all Settings categories, dictionary persistence after reload, save failure feedback, focus and keyboard navigation, light/dark appearance at 1600 by 1000, 1280 by 800 and 820 by 560, and reduced motion. Runtime preparation and build passed. The unrelated generated runtime files and existing design captures were restored afterward; no design baselines changed.

The Cleanup captures below were visually inspected: dictionary label, description and textarea remain readable and reachable at the typical and minimum sizes. The retained screenshots contain synthetic settings only.

![Cleanup in dark appearance](../../artifacts/review-382/cleanup-dark.png)

![Cleanup at the minimum size in light appearance](../../artifacts/review-382/cleanup-minimum-light.png)

Typecheck and full lint passed. Full two-worker suite, notices and independent reviews remain pending. Delayed acknowledgements and storage rejection are controlled renderer tests; the Electron journey exercises normal persistence and existing failure surfaces. No paid transcription or provider calls were made, and macOS was not exercised.
