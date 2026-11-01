# Spec 51: Civic growth you can see

Status: frozen consumer scope 2026-11-01  
Vision: `chatdom/ChatDom.md`; `chatdom/World-Tree.md` §§8–9; `chatdom/Artstyle-Soul-Feel.md`; `chatdom/Quality.md`.

## What and why

Create recognisable successive physical forms for all five civic places, in Hearth and Tide. The market gains stalls and awnings; the tavern gains a storey and lit windows; the forge a larger hearth; the court banners and fountain; the bridge lamps. Build on existing civic craft and the founded scene instead of replacing the world.

## Current state

`packages/shared/src/growth.ts` defines `GrowthSceneFrame`, `GrowthSceneBeat`, `GrowthHomeView` and `GrowthSceneFeed`, a public read projection with `live` or `simulated` origin. The frame is a current room snapshot with a bounded recent beat window, no person identity or history authority. `packages/world/src/growth` exports the tested deterministic v1 policy and reducer; main owns authority and integration. Existing home ceremony lane owns `apps/web/src/growth/**`; it is read-only here. Spec 08 is people/wardrobe, not a growth-depth spec.

## Rules

1. Consume civic levels from validated GrowthSceneFrame; render the supplied level without inventing progression or mutating the owned world. Support levels 1–4 as distinct forward visual states for each place and style; higher values must have a deliberate stable rendering, never silently imply a lower authoritative level.
2. Provide a read-only scene attachment adapter for main to mount against actual place anchors; it owns only its additions and disposes them. Never edit plots, existing world scene or home ceremony. Repeated frames and reattachment must not duplicate geometry, regress an accepted level or leak resources; replacement kingdom/replay seeks must deliberately reset the adapter.
3. A local SIMULATED fixture demonstrates all places, levels and both styles. Do not claim this proves integration in the kingdom.

4. Growth is forward, measured in days and never accelerated or purchased with money. A fixture is visibly labelled SIMULATED wherever displayed. Unavailable data is not silently shown as an empty or successful live result.

## Contracts

Consume the frozen shared growth schemas and inferred types as read-only; validate external frames with `GrowthSceneFrameSchema`. `GrowthSceneFeed` has `label`, `subscribe(receive, unavailable)` and unsubscribe. It carries no authority, commands, inventory, names or durable history. Any production read endpoint, identity enrichment, persistence or command requires a main-owned contract and adapter; record the precise missing seam as `needs:` in progress. No contract changes in this lane.

## Scope

Write only `packages/content/src/growth-civic/**, apps/web/src/growth-civic/**` and this lane’s PRD/progress. Everything else is read-only, including `packages/shared` and existing host routes. Main supplies integration and any package export/dependency wiring. Do not start a production service or create an endpoint.

## Acceptance

Run `pnpm typecheck`, scoped ESLint, focused Vitest tests for what changed, and the relevant package build. Record exact commands and results. Test mapping and reset/disposal with representative frames and all five places. Capture and look at one meaningful comparison of levels in the engine at 1440×900; note screenshot path and actual scene versus fixture. Main will capture the mounted kingdom. Use `$look` for visual changes and reserve capture ports using the repo helper. No proof matrix or full `pnpm verify` per task.

## Quality bar

The result must feel like part of the lived-in kingdom, with readable craft, honest provenance and no placeholder success. Keep interaction accessible and preserve existing live evening behaviour. Judge visual work against `chatdom/Artstyle-Soul-Feel.md` and `chatdom/Quality.md`.

## References

- work/references/voxel-meshing-light.md — efficient solid forms and lighting; packages/content/src/civic — existing forms and materials.

## Not now

No owned world scene edits, paid unlocks, production deployment, fake live data, new authority, unrelated home ceremony or changes outside scope.

## Decisions

- **2026-11-01 — Read seam first.** Main owns production authority and binding; this lane may build and demonstrate its complete consumer against an explicitly simulated adapter while the required integration contract is absent.

- **2026-11-01 — Integration checkpoint.** Produce a small green checkpoint early. Main merges it before the whole part is finished. Validate feed origin against its LIVE/SIMULATED label; never replay a recent tail as fresh live credit. One focused test for the changed behaviour; capture only the view being judged.
