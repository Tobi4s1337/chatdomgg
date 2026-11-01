# DK10 checkpoint verification

2026-11-01. Scope: API boundary, new dock app, rehearsal tooling. DK10 is **not done**.

Passed:

- `pnpm typecheck` (whole workspace).
- `pnpm exec eslint apps/dock apps/api/src/dock apps/api/src/main.ts`.
- `pnpm exec vitest run apps/api/src/dock apps/api/src/realm-auth/return-path.test.ts apps/api/src/realm-auth/oidc.test.ts`
  — 13 tests. Covers authenticated session lookup, origin/CSRF, broadcaster-only actions,
  capability/revision/target refusals, unknown delivery, required receipt, and reused OIDC
  identity/return-path defenses.
- `pnpm --filter @chatdom/api --filter @chatdom/dock build`.
- After final sign-in recovery edits: dock build and scoped ESLint again.
- `node --check work/evidence/dock/capture.mjs` and loading the real dock handler through
  Vite's module runner. Browser assertions inside the capture script have **not run**.
- `git diff --check`.

The worktree initially lacked dependencies. Installed using
`pnpm install --ignore-scripts --lockfile=false` to avoid editing the main-owned root lockfile.
Main must add the dock importer before a frozen workspace install; see `needs.md`.

No screenshot or clip was captured or looked at. The shared lane-priority capture queue
never admitted Chrome; its final bounded attempt timed out before opening any socket or
browser. Other occupied TCP ports were not touched. The harness now uses a private Unix
socket, owns only its own processes/socket, and always requires the shared capture lock.
Exact remaining image and clip scenarios are in `work/evidence/dock/README.md`.

The default app cannot exercise royal ceremonies: the main-owned realm command/status
bridge and stream presentation seam do not exist yet. The API reports unavailable rather
than converting a browser action into a fictitious Twitch observation. HTTP fixture receipts
are explicitly SIMULATED and cannot demonstrate stream delivery. Existing OIDC is reused,
but no real Twitch sign-in or real stream session was exercised in this turn.

Resume with the first unchecked task DK10. Sync main, check `needs.md` against newly adopted
seams, then capture and inspect the UI and each real stream act. Do not tick the task or write
`LANE COMPLETE` until that behavior has been demonstrated. No new Backlog tasks were built.
