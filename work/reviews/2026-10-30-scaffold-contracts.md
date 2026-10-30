# Scaffold and first consumer freeze — 2026-10-30

Main integrated the workspace on Node 22.23.4 / pnpm 10.17.0. No Node 24 requirement. The founder's window and
sound decisions are recorded in the vision and build map. Other contract groups remain unfrozen; world/voxel
and the dusk kingdom are next in main.

## Architecture review

Astra high performed an independent read-only architecture review before freeze and independently ran the shared
suite. Verdict: approved narrow identity/event and Atlas interchange v1, no blocking findings after fixes.

Applied findings: explicit occurrence/receipt/commit clocks and origin, no false SSE replay cursor, no offline-only
spectacle constraint, immutable byte snapshots/hashes and exact order alignment, reject partial snapshots instead
of turning missing observations offline, and bind raid freshness to its original observation time. Tests include
independent endian golden bytes, rehashed hostile bytes, equal-size reordered index, offsets/concurrent mutation,
sidecar mismatch, timestamp bounds, collisions and strict public fields. 22 tests pass.

The freeze certifies interchange, not a finished exporter or safety filter. Atlas A01 must implement canonical
visibility gates, consistent read-only export, holding tombstones, atomic publication and real producer/consumer
integration. Later card/auth/travel/pulse/season seams freeze with their consumers, not all up front.

## Verification

- `pnpm install --frozen-lockfile`: passed.
- `pnpm verify`: passed (typecheck, lint, 22 Vitest tests, workspace build, Chrome screenshots).
- `pnpm check:services`: Postgres 18 SELECT, Valkey PING, Surveyor status all passed; read-only, no secret output.
- Occupied screenshot port test: failed promptly as intended and left the existing test listener untouched.
  Screenshot server uses Vite's in-process preview API and closes only its own HTTP server.
- Terra medium reviewed scaffold and screenshots. Cleanup weakness fixed; added 1280×720 stream check.
- Main opened all five screenshots via view_image; no clipping/overflow. Evidence copied to
  `work/evidence/foundation/`: web@1440x900, web@390x844, stream@1920x1080, stream@1280x720, panel@318x496.
  These are explicitly labelled development benches, not finished kingdom, stream or Extension surfaces.
- Local preview remains running on 5190 (exec session 32502); temporary screenshot preview uses 5189 and closes.
  No existing service, production configuration or source Surveyor database changed. Atlas service reserves 5193.

## Handoff and doubts

`work/specs/01-atlas.md` and the six-task `work/lanes/atlas/PRD.md` are ready. Main creates lane/atlas and the
worktree after this green commit; the team starts the worker. Its environment must be supplied locally, not copied
into git. Surveyor currently offers status, raid SSE and pair aggregates; missing inventories require the explicitly
configured read-only DB/snapshot adapter. Real observations can populate a labelled survey preview; official
edition founding still requires observation duration and founder/taxonomy gates.

Luna scouts identified candidates; Terra high studied voxel AO/light, sky/fog/time, Ultra-Water and crowd animation.
Main reviewed the notes and representative source. Reference demo visuals remain incompletely assessed; no
external code was executed or copied into product code. Crowdbake is ideas only without a verified license.
WebGLRenderer compatibility, actual GPU/device costs, light-field behavior, warm window reflections on water,
real feed publication and full Atlas integration are still unproved. No performance or finished-world claim.

## Goal completion audit

The preceding goal turn made progress: implementation, independent reviews, green verification and push of
15d49ce. This audit inspected the current checkout and remote rather than relying on that report alone.

| Goal requirement | Current authoritative evidence |
|---|---|
| Workspace and full verification | package.json pipeline inspected; fresh `pnpm verify` passed on Node 22.23.4, all 22 meaningful contract tests, build and five Chrome captures |
| Standard screenshots looked at | Fresh 1440×900 and 390×844 plus 1920×1080, 1280×720, 318×496 opened with view_image; development-bench scope unchanged |
| Representative and hostile frozen boundary | Current schemas/codecs/tests/fixtures and frozen README inspected; prior independent Astra high review approved; no additional groups frozen |
| Ready real-data Atlas handoff | Spec names actual exports, local Surveyor/read-only adapter, initial and later consumer seams; PRD decomposed into 15 bounded tasks, preserving full scope and visible A02 |
| Lane can start | lane/atlas worktree exists, dependencies installed, zero-byte progress log and clean branch before audit update; main fast-forwards it to the completed handoff commit |
| Four reference studies | All four tracked notes contain sources, revision/license evidence or explicit ideas-only restriction, techniques, device adaptations and limitations |
| No voxel core | No packages/voxel or packages/world implementation exists; next main brief remains the dusk kingdom |

The completion audit found the original six PRD tasks too broad and split them into fifteen outcomes. This changes
work granularity only, not the frozen contract or Atlas scope. PLAN §10 now records the existing worktree and actual
ready state instead of a future setup instruction. Preview 5190 answered HTTP 200 during this audit.
