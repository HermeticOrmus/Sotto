# Review workflow prototypes

Throwaway primary source for issues #380 (dictation recovery), #386 (onboarding) and #388 (minimum-width Settings). Nothing here is approved production implementation.

Run `npm ci`, `node node_modules/electron/install.js` if Electron's postinstall was skipped, `npm run runtime:prepare`, then `npm run prototype:review`. The launcher creates a synthetic temporary profile. It never opens the real Sotto profile. Stop the launcher when finished; temporary profiles are disposable.

The renderer is also available in a browser at http://localhost:5173/index.html?surface=dictation&variant=A while the launcher runs. Choose a surface in the bottom bar; the arrows switch A/B/C and update the URL. Light switches the theme. The prototype only mounts in development. All actions are simulated in memory, with no microphone recording, provider call, clipboard write or saved application choice.

## Dictation recovery (#380)

- A: keep the normal Dictate room and show selectable text and Copy below the wave.
- B: replace the main action with recovery until dismissed.
- C: leave a recovery strip and show the text in a drawer, closed with Escape or Close recovery.

Walk through Start dictation, Stop, Copy text while Clipboard unavailable remains checked, then uncheck it and Copy again. Or use Complete dictation to jump straight to the failure. All variants retain the text after a simulated copying failure. Dismiss clears only the simulated retained text. History is deliberately off to show the privacy-sensitive case. Production must also preserve recovery through navigation and a later dictation, and distinguish failed copy from failed paste; these are acceptance checks, not persistence implemented by this throwaway demo.

## Onboarding (#386)

- A: require successful Test or explicit Skip at the microphone step before Continue.
- B: allow existing navigation and offer Test/Skip directly at Finish when still needed.
- C: make Test and continue / Skip and continue the microphone step's actions.

Start at Welcome. Set the example microphone result to Ready, Permission denied or Missing device, then walk through to Finish. The key is synthetic and verification is simulated. A successful test is the only path that marks the microphone ready; a skip is explicit. Reload resets the example.

## Settings fit (#388)

- A: fit the existing three-mode row in the existing sidebar (minimum box: 178px, switch right161px).
- B: stack the three modes in that same column.
- C: widen the minimum sidebar to224px, keeping the normal-size mode buttons (switch right207px).

Resize the window to820x560 and compare the space used by navigation and settings. All modes stay available; the prototype shows the voice beta enabled. Settings edits affect only local simulated state. The example is not a license to weaken a feature gate.

## Verification and decision

Rendered all nine variants in the Electron dev renderer; inspected all structures and three settings alternatives at820x560. Exercised failed/successful Copy simulation. Typecheck passes. Screenshots are local ignored evidence under artifacts/review-prototypes. These are design examples, not production regression tests or a release gate.

Zach selected A for all three surfaces in the question panel on September 27, 2026. Capture the selected structure in each implementation issue, rewrite it with production state/IPC contracts and tests, and leave losing variants and the switcher on this branch.

