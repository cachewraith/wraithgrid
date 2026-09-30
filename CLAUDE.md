# AI Working Agreement

## Session start (always, in order)

1. Read `docs/CONTEXT.md` (project map + current state). Do NOT scan the repo.
2. Read the top 30 lines of `CHANGELOG.md` (recent changes).
3. Read `docs/TODO.md` only if the task is about planning or next steps.
4. Read other files ONLY when the task needs them. Open by path from the file map; do not glob/grep the whole repo unless the map has no answer.

## Do not re-read

- Skip any file listed under "Stable / don't reopen" in `docs/CONTEXT.md` unless the task touches it.
- Trust `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`. Don't re-derive decisions already logged there. If one looks wrong, say so and propose a change; don't silently override.

## Context files (create if missing)

- `docs/CONTEXT.md`: one-page brief. Sections: Purpose, Stack, Run/build/test commands, Directory map (path: one-line role), Conventions, Stable/don't reopen, Known gotchas, Current focus.
- `docs/ARCHITECTURE.md`: modules, data flow, external services, env vars (names only, no secrets).
- `docs/DECISIONS.md`: append-only ADR log. Format: `YYYY-MM-DD | Decision | Why | Alternatives rejected`.
- `docs/TODO.md`: Now / Next / Later / Blocked.
- `CHANGELOG.md`: newest first. Format: `## YYYY-MM-DD` then bullets `- [area] what changed (files: a.ts, b.ts)`. Keep entries to 1 line each.

## After every task (mandatory)

1. Add a CHANGELOG entry: what changed, files touched.
2. Update `docs/CONTEXT.md` if: files/dirs added/removed, commands changed, a new gotcha was found, or "Current focus" changed.
3. Append to `docs/DECISIONS.md` if a non-obvious choice was made.
4. Update `docs/TODO.md` (move/close/add items).
5. Keep these files short. Compress old entries; never let CONTEXT.md exceed ~150 lines.

## Working rules

- Terse output. Commands/code first, minimal prose.
- Before editing: state the plan in ≤5 bullets. Then do it.
- Smallest diff that solves the problem. No unrelated refactors.
- Match existing conventions in `docs/CONTEXT.md`.
- Never invent files, APIs, or env vars. If unsure, ask or check the map.
- Run tests/lint/build commands from CONTEXT.md before declaring done; report result.
- Never commit secrets. Reference env var names only.
- If context files are stale or contradict the code, fix them and note it in CHANGELOG.

## When context is missing

If `docs/CONTEXT.md` doesn't exist: explore once, generate all context files above, then proceed. Never repeat this exploration in later sessions.

## End-of-session handoff

Finish with:

- Done: (1–3 bullets)
- Changed files: (list)
- Next: (1–3 bullets)
- Open questions/blockers: (if any)
