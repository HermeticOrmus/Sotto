# Create a thread from iPhone

September 30, 2026. Source branch `feat/iphone-new-threads`, based on `77d24f8d`.

Zach chose the guided prototype B, then asked to browse a folder not already active in Sotto. The native flow chooses a computer, a known project or an existing folder on it, then that computer?s model, effort and permissions. It opens a manual thread in the shared project folder. Work starts on the computer when the user sends the first message.

The fixture prototype is archived separately on `prototype/iphone-new-thread` (`f63aec91`). Browser inspection covered the chosen computer, another folder, options, and opening the empty conversation; the earlier variants were inspected in dark and light and at 375 points wide. This is design evidence, not native or remote execution evidence.

## Checks so far

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test -- --maxWorkers=2`: 480 files passed, 39 skipped; 6,363 tests passed, 153 skipped.
- `npm run notices:verify`: passed, 174 components.
- `git diff --check`: passed.
- Swift package tests, simulator build and native UI journeys: pending macOS CI. There is no local Swift/Xcode on this Windows machine; the configured Forge SSH host is Linux and has neither tool.

## Native journeys to inspect

- [ ] Existing project: offline computer disabled, selected computer/project preserved, open thread to its conversation.
- [ ] New project folder: browse and filter on the chosen computer, use an existing folder, select options and open the conversation.
- [ ] Both small and large simulator displays; dark and light; larger text and reduced motion.
- [ ] Model and command tests for host routing, unsupported choices, permission refusal, missing folder, unknown registration, lost acknowledgement, restart and backgrounding.

No live paired iPhone/PC execution or TestFlight delivery has been claimed. The host protocol and desktop UI are unchanged, so there is no changed Electron surface requiring a new Playwright design capture.
