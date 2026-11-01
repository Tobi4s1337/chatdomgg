# Spec 52: Growth on the citizen card

Status: frozen consumer scope 2026-11-01  
Vision: `chatdom/ChatDom.md`; `chatdom/World-Tree.md` §§8–9; `chatdom/Artstyle-Soul-Feel.md`; `chatdom/Quality.md`.

## What and why

A citizen can see their home’s next goal and streak alongside a shelf of things the kingdom actually remembers they earned. Reuse the panel card, citizen card and passport visual language, rather than create a separate profile.

## Current state

`packages/shared/src/growth.ts` defines `GrowthSceneFrame`, `GrowthSceneBeat`, `GrowthHomeView` and `GrowthSceneFeed`, a public read projection with `live` or `simulated` origin. The frame is a current room snapshot with a bounded recent beat window, no person identity or history authority. `packages/world/src/growth` exports the tested deterministic v1 policy and reducer; main owns authority and integration. Existing home ceremony lane owns `apps/web/src/growth/**`; it is read-only here. Spec 08 is people/wardrobe, not a growth-depth spec.

## Rules

1. Render the supplied GrowthHomeView: stage, qualified days, current and best streak, and next goal including remaining days. Qualified minutes are only the proven ten-minute daily minimum, never claimed total watch time. Maximum stage has no next goal.
2. Reuse existing card/passport keepsake representations and disclosure gates; accept only explicitly supplied, disclosed earned records. GrowthSceneFrame supplies no identity, earned shelf, entitlement, tenure, ember balance, or mapping to a citizen; do not infer them from plot IDs, fixtures, worn items or paid activity. Missing shelf data is unavailable, distinct from a valid empty shelf.
3. Export composable card/panel adapters, with a labelled SIMULATED bench, for main to mount after a trusted subject mapping and earned-record read contract exist. No edits to existing host card, passport, API or panel files. Clear old subject data on subject or disclosure change; distinguish invalid, unavailable, loading and empty states.

4. Growth is forward, measured in days and never accelerated or purchased with money. A fixture is visibly labelled SIMULATED wherever displayed. Unavailable data is not silently shown as an empty or successful live result.

## Contracts

Consume the frozen shared growth schemas and inferred types as read-only; validate external frames with `GrowthSceneFrameSchema`. `GrowthSceneFeed` has `label`, `subscribe(receive, unavailable)` and unsubscribe. It carries no authority, commands, inventory, names or durable history. Any production read endpoint, identity enrichment, persistence or command requires a main-owned contract and adapter; record the precise missing seam as `needs:` in progress. No contract changes in this lane.

## Scope

Write only `packages/ui/src/growth-card/**, apps/panel/src/growth-card/**, apps/web/src/growth-card/**` and this lane’s PRD/progress. Everything else is read-only, including `packages/shared` and existing host routes. Main supplies integration and any package export/dependency wiring. Do not start a production service or create an endpoint.

## Acceptance

Run `pnpm typecheck`, scoped ESLint, focused Vitest tests for what changed, and the relevant package build. Record exact commands and results. Test displayed goals/streaks, absent next goal, malformed/unavailable versus empty, and subject/disclosure replacement. Capture and look at the panel 318×496 and web card 1440×900 when each changes; use one composition per change where possible. Use `$look` for visual changes and reserve capture ports using the repo helper. No proof matrix or full `pnpm verify` per task.

## Quality bar

The result must feel like part of the lived-in kingdom, with readable craft, honest provenance and no placeholder success. Keep interaction accessible and preserve existing live evening behaviour. Judge visual work against `chatdom/Artstyle-Soul-Feel.md` and `chatdom/Quality.md`.

## References

- work/specs/19-citizen-card.md and work/specs/45-raid-passport.md — card privacy and existing keepsakes; packages/ui/src/passport and apps/panel/src/card — reuse.

## Not now

No owned world scene edits, paid unlocks, production deployment, fake live data, new authority, unrelated home ceremony or changes outside scope.

## Decisions

- **2026-11-01 — Read seam first.** Main owns production authority and binding; this lane may build and demonstrate its complete consumer against an explicitly simulated adapter while the required integration contract is absent.

- **2026-11-01 — Integration checkpoint.** Produce a small green checkpoint early. Main merges it before the whole part is finished. Validate feed origin against its LIVE/SIMULATED label; never replay a recent tail as fresh live credit. One focused test for the changed behaviour; capture only the view being judged.
