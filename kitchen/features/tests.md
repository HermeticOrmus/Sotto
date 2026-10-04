# Feature: unit + integration

- Reach: `npm test` (Vitest). CI's worker cap matches the runner (`docs/ci.md`).
- Where: Windows x64 or Apple-silicon macOS. On Linux about 25 tests fail on plain `main` (2026-10-03), so a Linux run is not proof.
- Evidence: the summary line and the head SHA.
