# PW11 — presence and privacy checkpoint

PW11 remains unchecked. The lane heartbeat, presence-source proof and privacy preference are implemented. A completed
subject-wide erase and rejoin cannot yet be demonstrated. No presence tombstone or partial SQL delete is called erasure.

## Decisions

- The panel observes immediately after verified eligibility, then every 60 seconds. Helper visibility, document
  visibility, playing video, shared identity and the realm's live-stream answer must all hold. Newcomers require the
  original Take your place gesture. Hiding, pausing, going offline, unsharing or disposal cancels the presence timer and
  aborts an in-flight presence request. Failures back off; generation checks reject late replies.
- An authorization change clears personal privacy, claim and light state. A reply from the previous authorization
  cannot overwrite the next viewer's reading. Tokens remain only in the Helper/request header.
- `setPersonQuiet` is the single exported realm function for the global person/origin preference. It changes no
  provider name, card or deed. `0012b_realm_panel_privacy.sql` owns its storage; the round notes reserve this suffix.
- The panel kingdom reader intersects committed public windows with the realm's current private presence projection.
  It can suppress expired windows and quiet names; it cannot add a window or a name. This fixed an observed stale light
  count after lease expiry. The painter reads this same filtered public door.
- The stream/public watch projection is outside this lane. Until that hook lands, the privacy reply says
  `projection: pending`, and the screen explicitly says that stream name hiding is not connected. Saving a preference
  is never presented as a completed stream hide.
- `forgetPerson` calls an injected `RealmForgetAuthority`. Main must supply replay-safe erasure across kingdoms,
  immutable ledgers/snapshots, derived records, active writers and public caches. None exists in this checkout. The
  composed realm therefore advertises `forgetAvailable: false`, returns 503 without modifying rows, and the UI shows
  an unavailable description. The guarded confirmation and success/rejoin transport are tested as a future protocol,
  not claimed as an executed erase. A pending authority response is not a successful erase.

## Verification

All commands are scoped; no root suite or live stack was used.

- 32 panel-adapter/API tests: heartbeat gates, renewals, disposal, backoff, authorization changes, unavailable erase,
  future erase-success/rejoin protocol, confirmed request validation and JWT-derived identity.
- 14 realm tests on random `panel_window_test_*` schemas on development Postgres port 5410: actual allocation,
  ingress inbox/writer/checkpoints, each presence source, global quiet persistence and unavailable erasure changing no
  rows. Chat and panel use authenticated ingress; walker uses the existing authenticated lifecycle/WalkerPresence.
  Every source lights within 5 seconds. Expiry checks advance only the realm reader's database-clock estimate past the
  90-second lease; they do not measure 90 seconds of wall-clock absence or prove stream-host dimming.
- Scoped TypeScript includes panel, API panel and nested realm panel sources; ESLint passes for changed source and
  capture script. Panel and realm builds pass; public API SSR build is checked separately.
- Vitest uses a fresh `--fsModuleCachePath /tmp/panel-window-pw11-vitest-cache`. The shared persistent transform cache
  had retained an old migration glob and falsely omitted the new migration. No shared cache was removed.

Reproduce the database check without printing credentials:

```sh
REALM_DATABASE_TESTS=1 node --env-file=/tmp/panel-window-realm.env node_modules/vitest/vitest.mjs run \
  --fsModuleCachePath /tmp/panel-window-pw11-vitest-cache \
  apps/realm/src/ingress/panel/service.integration.test.ts \
  apps/realm/src/ingress/panel/presence.integration.test.ts \
  apps/realm/src/ingress/panel/privacy.integration.test.ts
```

## Capture

`apps/panel/scripts/pw11-capture.mjs` captures the real approved scene and actual committed public presence through the
lane gateway, realm and signed Helper harness. It requests real provider names read-only, claims only in the isolated
lane database, and makes no Twitch write. It renews the test stream and arrived viewers while rendering. Local services
are gateway 5191, harness 5192, web 5182, panel 5183 and mux 5184, only under the GPU lease; realm is 5172. It closes only
its own browser contexts and processes. Private failure logs stay under `/tmp/pw11-capture-*`; the temporary Helper
secret is deleted.

```sh
chatdom-pc-lease --wait 3 --max 10 -- node \
  --env-file=/root/.config/chatdom/atlas.env --env-file=/tmp/panel-window-realm.env \
  apps/panel/scripts/pw11-capture.mjs
```

Capture result and looked-at screenshot paths are recorded below before the checkpoint is committed.

The RTX 5080 Chrome was connected. Three bounded lease attempts (waits 1, 3 and 1 minute) all returned exit 75:
`another lane holds the GPU lease`. Under the Ralph repeated-failure rule this iteration stops. No PW11 screenshot was
taken or looked at, and the visual changes are not approved. The capture script passed syntax/lint checks only; its
runtime path remains unverified. There was no tunnel-down fallback. PW11 stays unchecked; next iteration proceeds to
PW12 under the explicitly requested skip rule. The full-erase authority remains an independent blocker even once GPU
access returns.

`PW11-NEEDS.patch` passes `patch --dry-run -p1`; the proposed new modules received syntax/transpile checks only. It is
unapplied, not runtime evidence. The accompanying `PW11-NEEDS.md` names the remaining parser/reply composition,
publication races, uncovered stream-name surfaces and required erasure/status/consent-generation contract. Do not
change `projection` to applied or enable forget merely by applying the candidate patch.

The isolated realm on 5172 was stopped after verification. The GPU capture never started its services. The PRD's
existing round-note edit naming a video studio lane was present before this checkpoint and is left unstaged.
The progress SHA names this checkpoint's base, avoiding a misleading self-referential commit hash.
