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

## Resumed checkpoint — 2026-11-01 17:03

The user resumed the goal while main builds the realm/stream seam and asked the lane to keep
building and let capture queue. The prior blocked status is historical. This turn made real
implementation progress and is not another blocked audit.

- `9963c96`: canonical session and CSRF-checked sign-out, sign-in callback/expiry states,
  moderator-safe view, session-and-kingdom recovery, post-command session recheck, optional
  authoritative undo receipt list with compatible local fallback, and compact town facts.
- Main was synced through `7a0830f`, including queue `1bdc9de`, importer `1bf6b26` and shared
  contract `13f1a36`. The only conflict was inside the lane's API contracts and was resolved
  using main's action/witness schemas, with an optional API undo-hint extension.
- `5bd02d6`: a thin capture queue wrapper loads the latest rehearsal after admission;
  labelled session/moderator/sign-out/pending/refused/unknown/undo/replacement fixtures;
  owned random Unix socket directories; header wrapping and designed narrow scrollbars.

Passed before shared sync: 28 focused dock/recovery/OIDC/return-path tests, scoped TypeScript
and ESLint, and API/dock builds. Passed after shared sync: 26 dock/recovery/shared-boundary
tests, scoped TypeScript and ESLint, and both builds. The final small CSS change was rebuilt.
Both rehearsal scripts pass `node --check`; `git diff --check` passes. Browser assertions
remain unrun, and no new whole-workspace verification result is claimed.

**Live capture:** tool session `41052`, owned by `/root/dock_evidence`, was confirmed live
by that agent's tool poll after reporting `queued for a lane slot`. No acquisition was
reported, so no socket/Chrome/screenshot has started. The root tool scope cannot poll that
ID (`Unknown process id`); this is an ownership boundary, not proof of termination. Resume
the same agent with `collaboration.followup_task` and ask it to poll the same handle. Do not
restart merely because output is silent or an observation wait ends. The earlier obsolete
pre-session/old-helper jobs were explicitly cancelled and confirmed terminal only when their
inputs/helper changed; the current job has no observation timeout.

`capture-queue-observation.md` records a possible PID-namespace failure in the main-owned
queue and the evidence for it; the lane did not alter shared locks, registry entries or
foreign processes. `needs.md` records current handoff compatibility and the one added
`@chatdom/shared` importer dependency main must include when adopting this checkpoint.

Main's realm/presentation implementation is still in flight; only its shared boundary is
committed here. Required next work is unchanged: sync the implementation, exercise real
session/authority and undo across that seam, inspect the UI at target sizes, and show every
required act beside the real stream in looked-at stills and watched clips. DK10 is unchecked.

## Supplied realm boundary checkpoint — 2026-11-01

Synced `96b544d` (real retained-writer service and API presentation bridge), then `d53d9eb`
(cross-sandbox capture liveness correction). The obsolete capture41052 was explicitly
cancelled and confirmed exit130 before its replacement; the new handle is agent-owned23423.

Passed: 29 focused dock API/recovery/shared tests; scoped API+dock TypeScript and ESLint;
API and dock builds; `git diff --check`. Witness responses now enforce their byte budget
while reading, with a real Unix-socket HTTP regression verifying cancellation and503.

Also passed both realm dock tests with `REALM_DATABASE_TESTS=1`, loading main's existing
ignored environment in-process without copying or printing credentials. The test owns a
random isolated schema and drops it. It demonstrates fenced storage, independently checked
presenter receipts, durable idempotency/reopening and revocation; it does not prove pixels.

The scene renderer is still main's uncommitted integration work. Current moderator source,
directed undo presentation and cross-device receipt metadata requests are in `needs.md`.
DK10 remains unchecked. No real-Twitch writes or main-branch edits were performed.

## Scene integration sync — 2026-11-01

Merged main through `767a74b`, including `821b71d` real scene act consumer. Ten focused
scene/presenter/royal-life tests pass. The actual web build passes with the dock imported
through its new same-origin route. Dock build, scoped TypeScript and ESLint also pass.

Source review found inherited web landing-page layout leaking into the `/dock` mount and
the font kit being imported only by the standalone entry. The dock now owns those layout
resets and loads its font kit through App. Small product labels are at least12px. Anonymous
sessions have a neutral sign-in masthead; controls refresh authoritatively after the realm
cadence instead of waiting for the next ten-second poll. These are functional/source-reviewed
checkpoints, not a completed visual review. Capture23423 is still live and queued under the
new helper, owned by the evidence agent. No screenshot or clip is claimed yet.

## Integration rehearsal preparation — 2026-11-01

Prepared `work/evidence/dock/integration-capture.mjs` and `integration.mjs`. They remain
explicitly opt-in and runtime UNVERIFIED. The wrapper queues without a deadline, then
supervises one owned worker with a post-admission deadline. It creates/removes only its
random schema and temporary directory, and waits for owned browser/service shutdown
before release. The actual realm uses an owned Unix socket; actual API, simulated OIDC
and integrated web `/dock` + `/stream` share one exclusive IPv4 loopback5171 listener.
It proxies genuine SSE/binary responses, sends no fabricated witness and presses no act.
Both scripts pass `node --check`; runtime, cleanup and visuals need execution and review.

Capture23423 is still live and queued in `/root/dock_evidence`'s tool scope. Resume that
agent and poll that same handle; do not replace it for silence. No image or clip exists yet.
After its ready390 capture: inspect it, capture remaining UI states one at a time, validate
the integration bench, then seed normalized simulated citizen/raid observations through
real ingress and demonstrate each dock act beside the actual stream. Moderator authority,
directed undo and attendance-label needs remain in `needs.md`. Task and goal stay active.

## Production UI evidence and native service loader — 2026-11-01

Nine production UI stills have been captured and individually looked at. The visual review
lists their exact paths and limits. Captures assert no browser errors/overflow; ready
retains keyboard focus through polling, uncertain reload sends no second POST, simulated
undo restores the original gate and removes its receipt, and sign-out returns to sign-in.
The original disabled opacity was too faint; corrected and recaptured the permission and
uncertain states. Source CSS lint/build pass. After main's frozen undo schema adoption,
29 focused tests and scoped TypeScript pass.

The real-service scaffold's first attempt21613 failed during module loading, before any
listener/browser. Import-only diagnosis reproduced Vite runner/CJS `exports is not defined`
in bootstrap/evening's zod dependency. Building the combined factory entry with the actual
realm SSR Vite config, then native-importing it, passes an import-only preflight without
DB/listener/browser; its owned temp directory was removed. New service-loader and capture
scripts pass syntax checks. Action drivers seed normalized SIMULATED observations through
the actual authenticated evening service and require the real stream witness; those paths
are not runtime-proven yet. No action receipt or stream pixel is claimed.

The corrected one-still attempt60166 remains live and queued in `/root/dock_evidence`'s
tool scope (fresh owner poll confirmed it). Its actual Node front binds exclusively to
IPv6 `[::1]:5171`; the realm uses an owned Unix socket. IPv4 capture ports were occupied;
no existing service was touched. Resume/poll the same agent-owned handle. Main has newer
unrelated lane integrations; defer sync until this capture is terminal so its build inputs
remain stable, then merge before the next rehearsal. The task stays open and active.
