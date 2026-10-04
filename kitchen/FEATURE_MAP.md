# Sotto (ormus fork): Feature map

Agent-facing map. Prefer these surfaces and proof stations. Do not invent soft "try the app" steps without a named verify path. Paths are from `AGENTS.md` and `CONTEXT.md` on `ormus` @ `77bab97a` (upstream 0.1.30). Code, `CONTEXT.md` and the ADRs win over this file.

## Surfaces

| Surface | Path | Notes |
|---------|------|-------|
| Coordinator + providers | `src/main/agents/` | `control.ts` coordinator. Adapters `claude.ts`, `codex.ts` (Codex App Server, ADR-0005), `grok.ts`, Devin. Every adapter passes `tests/integration/adapterContract.ts`. |
| IPC | `src/main/ipc/registerIpc.ts` | Every channel. A new setting also goes on the patch allow-list here (`tests/integration/ipc.test.ts`). |
| Threads page | `src/renderer/src/agents/` | Panes, composer, sidebar, pickers. `features/` other pages, `state/` app context, `widget/` floating widget. |
| Shared | `src/shared/` | Types, zod schemas, `settings.ts`, `channels.ts`, `themes/`. Renderer reaches main only via `src/preload/` (`window.sotto`). |
| Headless host | `src/host/` | Plain Node, never imports Electron, built by `scripts/build-host.mjs`. |
| Remote hosts | `src/main/hosts/` | Saved hosts, SSH launcher, launch script, router. Fork-only Add host rules: `250bb4fe`, `b1f8aee3`. |
| iPhone client | `apps/ios/` | SwiftUI + SottoCore. Compiled only by the macOS CI job. Host protocol v1. |
| Dictation | main + widget | OpenRouter MAI-Transcribe-2 (ADR-0006). Voice coordinator and memory gated for beta (ADR-0012, ADR-0013). |
| Docs | `README.md`, `docs/guide.md`, `docs/agent-control.md`, `docs/adr/`, `docs/verification/` | A user-visible change updates README or the guide in the same change. |
| Kitchen | `pantry/`, `kitchen/` | Fork-only. Never in an upstream PR. |

## Kitchen features (proof stations)

| Feature | File | Reach path |
|---------|------|------------|
| Static gates | `kitchen/features/gates.md` | `npm run typecheck` + `npm run lint` (the standing gate on Linux) |
| Unit + integration | `kitchen/features/tests.md` | `npm test` on Windows or macOS. About 25 tests fail on Linux on plain `main` (noted 2026-10-03), so Linux runs are not proof. |
| Host | `kitchen/features/host.md` | `npm run test:host`, `npm run test:socket`, `npm run package:host` (the socket job runs on Linux) |
| Desktop journey | `kitchen/features/desktop.md` | `npm run build` + Playwright spec, or `npm run test:desktop-smoke` on an interactive Windows desktop |
| Design | `kitchen/features/design.md` | `npm run design:verify` (Windows captures) |

If a feature file is missing, create it before claiming that surface green. Map rows must match files under `kitchen/features/`.

## Hard contracts (agents)

1. Named verify (draft): `npm ci && npm run runtime:prepare && npm run typecheck && npm run lint`, plus the station the atom's Done-when names. Exit non-zero on fail.
2. Do **not** vendor ormus-stack into this repo. Install it beside the checkout as a plugin.
3. Follow `AGENTS.md`: privacy (no new hosts without an ADR + README change), the user answers every permission, production deps are exactly `zod` and `node-pty`, UTF-8 without a BOM, worktrees under `.worktrees/`.
4. Do not push, open a PR, or touch `millZach/Sotto` unless Diego explicitly asks.
