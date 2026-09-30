# Project working-copy defaults (#497)

Verified on Windows in the built Electron app with synthetic providers.

`npx vitest run tests/unit/main/settingsRepository.test.ts tests/unit/renderer/settingsView.test.tsx tests/unit/renderer/newThreadProjectCreation.test.tsx --maxWorkers=2`: 114 passed. Before the fix, the Settings-to-creation regression sent `workingCopy: 'shared'` after choosing New worktree. It now sends `independent` with Start from origin. Restoring inheritance sends `shared` again. Remote projects retain their host-qualified keys. Migration persists local overrides, preserves existing bare-ID choices and remote entries, and does not create an empty settings file.

`npm run build` and `npx playwright test tests/e2e/new-thread-settings.spec.ts --workers=1`: 2 passed. The first journey chooses New worktree in Application settings and opens a thread whose actual working-copy mode is independent. The second saves the former host-keyed local entry, restarts the app, checks the migrated setting and displayed choice, then opens an independent thread from the project pen.

The Settings journey checks dark and light at 1600×1000, 1280×800 and 820×560, with no horizontal overflow and the choice in view. Escape returns focus to Project defaults with reduced motion enabled. Inspected the minimum-size dark and light captures: the labels and controls remain readable, and the row shows New worktree. There is no layout or copy change and no design baseline regeneration.

- Dark: `artifacts/new-thread-setup/project-defaults-820-dark.png`
- Light: `artifacts/new-thread-setup/project-defaults-820-light.png`

The initial expanded-row check incorrectly assumed Settings stayed mounted when visiting Threads; reopening Project defaults corrected the test. Both journeys then passed. Native provider worktree allocation on first send and macOS were not exercised by these synthetic Windows journeys.
