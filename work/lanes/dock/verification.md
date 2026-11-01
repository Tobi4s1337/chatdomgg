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

## Continuation checkpoint — 2026-11-01 16:26

`c2b6427` replaces target dropdowns with named actions (at most three target entries per
group), keyed by realm ID to retain their DOM identity during polling. Pending feedback
changes only the pressed action. The API now accepts shared realm token syntax and requires
accepted witnesses to match the submitted action, kingdom and origin. The rehearsal harness
uses the new buttons and explicitly simulated witnesses.

Passed on the current sources:

- The focused Vitest command above, now **15 tests**, including colon-bearing realm IDs and
  delivery witnesses for the wrong action, kingdom or origin.
- `pnpm exec eslint apps/dock apps/api/src/dock`.
- `pnpm --filter @chatdom/api --filter @chatdom/dock build`; the generated dock bundle is
  newer than the final focus fix.
- A bounded TypeScript check extending the root config and including dock UI and dock API
  source/tests: `timeout 90s pnpm exec tsc --noEmit --project /tmp/chatdom-dock-boundary-tsconfig.json --pretty false`
  exited 0 with no diagnostics. This is a focused check, not a new whole-workspace result.
- `node --check work/evidence/dock/capture.mjs` and `git diff --check`.

The separate whole-workspace TypeScript process was interrupted after repeated silent polls;
it exited 130, so that attempt is **not** a passed check. No verification process remains live.

Two current-turn captures and the previous turn's final bounded capture all terminated on
the shared-lock timeout before any socket or Chrome started. The third failure is recorded
as `blocked:` in progress. No screenshots, clips or browser assertion results exist. No
further capture retry was made in this iteration. This does not justify a visual completion
claim or replacing the required live stream demonstration with HTTP fixture receipts.

`main` has no new commits to sync, and a source search still finds no dock authority or
presentation seam in the realm/shared/kingdom/stream modules. This is the **second consecutive
goal-turn audit** of the same main-owned dependency. Independent UI/API defects were fixed;
the final-state requirements remain unchanged. There is no later lane task to move to.

## Third blocking-condition audit — 2026-11-01 16:27

The previous turn was progress: it committed direct named actions and real-ID/witness fixes.
This turn revalidated the same external dependency before making a blocked-status claim:

- The worktree is clean on `lane/dock`; `git rev-list --count HEAD..main` returns `0`.
- Searching `apps/realm`, `packages/shared`, `apps/web/src/kingdom` and
  `apps/web/src/stream` finds no `/internal/dock/*`, `RealmDock` or dock action/status seam.
- The adapter still calls the absent `/internal/dock/status` and `/internal/dock/action`.
  Its no-backend path explicitly returns unavailable.
- A secret-safe environment check reports `dockRealmBridgeConfigured:false`; the worktree
  has no `.env` file. No credential or URL values were printed.
- `pnpm-lock.yaml` still has no `apps/dock` importer.
- Evidence contains the harness and its README only: no screenshots or clips. The prior
  three capture processes already terminated before Chrome; no capture process is waiting.

Completion remains unproven for every real gate wake/goodnight, fire gathering, raid welcome,
crown/knight ceremony and chosen moment on stream. Actual Twitch sign-in, verified moderator
access, gentle/undo semantics at the realm, dock-beside-stream stills and watched clips are
also not demonstrated. Fixture receipts, API tests and successful builds do not prove them.

Implementing the missing authoritative state, command lifecycle and stream rendering would
cross the explicitly excluded realm/shared/kingdom/stream scope. There is no later task and
no remaining independent implementation identified that resolves this dependency. `needs.md`
holds the exact contract and proposed shared request patch for main. The goal is therefore
blocked after three consecutive goal turns, rather than marked complete or left in a retry
loop. Resume DK10 after main supplies the seam and workspace importer; then verify real
sign-in/authority, capture and inspect the UI, and demonstrate each real stream act.
