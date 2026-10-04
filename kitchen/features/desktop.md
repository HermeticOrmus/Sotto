# Feature: desktop journey

- Reach: `npm run build` then the Playwright spec the Done-when names (`npx playwright test tests/e2e/<spec> --workers=1`), or `npm run test:desktop-smoke` on an interactive Windows desktop.
- Where: a Windows x64 or Apple-silicon Mac kitchen machine (Diego to name).
- Evidence: a screenshot of the real window at the sizes `AGENTS.md` names (1600x1000, 1280x800, 820x560) + the head SHA.
