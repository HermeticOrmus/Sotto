# Kitchen law: Sotto (ormus fork)

Draft. This is the group law that SHIP.md step 4 asks for. It becomes binding only after Diego's Yes.

- **Repo:** `HermeticOrmus/Sotto`. Goal issues, Goal PRs and restock PRs all live here.
- **Base branch:** `ormus` (`MENU_BRANCH=ormus`). The fork's `main` is untouched.
- **Upstream:** `millZach/Sotto` is Zach's. The kitchen never pushes, comments, or opens PRs there. An upstream PR is a separate, explicit ask from Diego. Its branch is cut from `upstream/main` and carries only app changes, never `pantry/` or `kitchen/`.
- **Upstream sync:** the existing "Keep Sotto ormus merged with Zach's main" routine stays the only merger, one run at a time. Docs-only conflicts keep both sides and show Diego before push. Anything else needs his OK. The same blocker twice parks the run.
- **Seats:** Sotto Desk (ship) and Sotto Stack Kitchen (plate, verify, proof, garden). No seat sits in two kitchens.
- **Checks:** `npm run typecheck && npm run lint` on any machine. `npm test` and desktop journeys only on Windows x64 or Apple-silicon macOS. Linux runs `test:host` / `test:socket`.
- **Verify skill:** `verify-sotto` (to be made with `create-verification-skill`). It launches the built app, proves the served build is the head under review, drives one mapped feature and keeps the evidence. It stays a draft until one end-to-end run.
- **Classes:** `repo` = provable on the repo alone (typecheck, lint, Vitest on Win/Mac CI). `host` = proven on a named kitchen machine running the app. `eval` = measured (for example dictation latency, against the method in `docs/perf/2026-07-20-dictation-latency.md`).
- **Gates:** Diego is the only Yes for plate, Cloud Agent launch, merge and park. No message outside the kitchen group and Diego's own chats.
