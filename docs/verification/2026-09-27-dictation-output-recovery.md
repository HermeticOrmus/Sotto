# Completed dictation recovery (#380)

Zach selected prototype A in the issue: selectable completed text and Copy below the wave, with normal Dictate controls available. The production app now retains each failed delivery in app-level memory, so navigation and later successful or failed dictations do not silently replace it. Copy retries use the existing output bridge with automatic paste disabled. Only explicit Dismiss removes an entry; closing the app releases this memory. History remains independently gated, and completed text is saved when enabled even if delivery fails. A history failure cannot erase the retained text or mask its output error. Ordinary paste-helper refusal still returns the existing copied result.

Five desired controller assertions failed on unchanged production. After the change, 202 focused tests across controller, DictateRoom, app integration, output service and theme tokens passed. They assert actual recovered words, two distinct failed transcripts, navigation, a later successful dictation, repeated Copy failure/success, no retranscription during Copy, no automatic paste on retries and no history write with history off. Typecheck, lint, notices and the Electron build passed.

The real Windows Electron output path used an isolated scripted clipboard that throws on its first three writes. Two dictations retained two entries; a Copy retry failed without losing either, the next Copy put the exact completed text in the clipboard without pasting, and later normal dictation pasted successfully. History stayed empty. The existing ordinary paste-fallback journey also passed. No live provider call, microphone audio or production profile was used.

The first six size/theme captures exposed a partly clipped recovery action row at 820x560. Recovery-only spacing at short heights was tightened and the journey now requires Start dictation, Copy text and Dismiss text to be fully within the viewport. The rebuilt recovery journey passed again. Captures at 1600x1000, 1280x800 and 820x560 in dark and light, with reduced motion enabled, were generated; the minimum light/dark and larger dark views were inspected. Copy is keyboard activated in the journey, and the readonly transcript remains selectable. No design baseline was regenerated. Generated runtime files were restored.

- [Minimum light recovery](../../artifacts/review-380/recovery-820-light.png)
- [Minimum dark recovery](../../artifacts/review-380/recovery-820-dark.png)
- [Recovery after output failure](../../artifacts/review-380/recovery-1280-dark.png)

Full two-worker gate and independent review are pending. Every test invocation used a verified-absent owned `SOTTO_PERF_DATA` path. macOS was not exercised locally.
