# Resolve the onboarding microphone step (#386)

This implements approved prototype A from `prototype/code-base-review-workflows` (`58917d59`): keep the four-step layout, disable Continue on the microphone step until a successful test or explicit Skip for now, and state that choice in the existing explanation. Back, retry, optional key entry and the final completion guard remain available.

Five desired-behavior regressions failed on the unchanged baseline: idle, requesting, denied, missing and error could all leave the microphone step. With the prerequisite in place, 60 tests passed across onboarding, App and microphone lifecycle suites. Existing navigation cleanup tests now choose Skip explicitly before leaving a pending test; their resource-ownership assertions remain intact. Existing macOS recovery guidance tests also make that explicit choice.

Typecheck, full lint, notices verification and production build passed. The real Electron `onboarding-microphone-step.spec.ts` passed both journeys (16.5 seconds, one worker and exclusive desktop access): successful test and blocked permission followed by explicit Skip. Both cover 1600 by 1000, 1280 by 800 and 820 by 560, light/dark appearance, reduced motion, keyboard activation, heading focus, Back navigation, completion settings and reload. Audio/permission responses use the existing synthetic first-run fixture; no microphone hardware, provider account or paid request was used.

The [untested minimum light view](../../artifacts/review-386/untested-820-light.png) and [denied dark view](../../artifacts/review-386/denied-1280-dark.png) were visually inspected. Copy and actions remain readable, Continue is visibly unavailable, and recovery guidance remains visible. The narrow window retains the existing vertical scroll. No design baseline changed; generated runtime files were restored.

The full two-worker suite and independent final Standards/Spec reviews remain pending. macOS was covered by renderer copy tests only, not a native app journey.
