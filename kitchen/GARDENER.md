# Gardener

Weed soft comments, upstream leaks and agent-playbook coupling before the next agent copies them.

| Gardener | Role | Scope |
|----------|------|-------|
| Auric Lead | Chief of Staff | Ormus kitchens |
| Sotto Keeper (proposed) | This product kitchen | `HermeticOrmus/Sotto` branch `ormus` |

## Paved path

1. Read `kitchen/FEATURE_MAP.md` and the matching `kitchen/features/*` file.
2. Change the smallest surface that owns the behavior. Read the ADRs that touch it first.
3. Run the named verify plus the station the Done-when names before claiming done.
4. Leave a dirty tree for review. Commit, push or PR only when Diego asks.

## Weeds to pull

- `pantry/` or `kitchen/` files in a branch meant for `millZach/Sotto`
- Claiming green from a Linux `npm test` run (it is red on plain `main`)
- Vendoring ormus-stack / pstack / poteto-mode skills into this tree
- A new host contacted without an ADR and a README "Privacy and cost" line
- A new production dependency beyond `zod` and `node-pty`
- Soft "temporary: skip …" comments that agents copy as justification

## Hierarchy of correction

1. **Refactor**: remove the bad pattern in the change that introduced it.
2. **Lint / CI**: fail the build.
3. **Rules**: `AGENTS.md`, this file, `kitchen/FEATURE_MAP.md`.
4. **Skills**: a reusable agent skill when the same miss happens across repos.
5. **Style**: review habit, only after the mechanical gates exist.
