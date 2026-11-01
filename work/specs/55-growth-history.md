# Spec 55: A simulated kingdom history

Status: frozen consumer scope 2026-11-01  
Vision: `chatdom/ChatDom.md`; `chatdom/World-Tree.md` §§8–9; `chatdom/Artstyle-Soul-Feel.md`; `chatdom/Quality.md`.

## What and why

Give the Chronicle a coherent several-week simulated kingdom history, generated from the same growth rules and witnessed observations as the world. It lets the team watch the town change before a real community has lived those weeks.

## Current state

`packages/shared/src/growth.ts` defines `GrowthSceneFrame`, `GrowthSceneBeat`, `GrowthHomeView` and `GrowthSceneFeed`, a public read projection with `live` or `simulated` origin. The frame is a current room snapshot with a bounded recent beat window, no person identity or history authority. `packages/world/src/growth` exports the tested deterministic v1 policy and reducer; main owns authority and integration. Existing home ceremony lane owns `apps/web/src/growth/**`; it is read-only here. Spec 08 is people/wardrobe, not a growth-depth spec.

## Rules

1. Use the current public exports of packages/world/src/growth to construct deterministic, ordered synthetic stream, home binding and qualifying presence observations over at least six weeks, with multiple distinct simulated people and plots. Run the actual reducer; retain source observations and emitted milestones as facts, with stable source sequence and timestamps. Do not hand-author achievements or alter policy to hit a picture. Qualifying presence is synthetic evidence, never live credit.
2. Export an isolated SIMULATED fixture and read-only projection helpers for a consuming bench. Validate generated GrowthSceneFrame snapshots against the frozen schema and maintain plot references, sequence and as-of integrity. Include quiet days and repeated presence so the streak, home and civic changes are meaningful. No real person names, live kingdom IDs, Twitch traffic, persistence, API endpoint or shared contract edits.
3. The current core does not establish a durable historical world record, streets/castle growth, earned inventory or channel-point observations. Do not fabricate these as authoritative events. Report `needs:` for main to define a durable replay format and a safe simulation ingestion/host seam; Chronicle may use this fixture only through an explicit adapter after integration.

4. Growth is forward, measured in days and never accelerated or purchased with money. A fixture is visibly labelled SIMULATED wherever displayed. Unavailable data is not silently shown as an empty or successful live result.

## Contracts

Consume the frozen shared growth schemas and inferred types as read-only; validate external frames with `GrowthSceneFrameSchema`. `GrowthSceneFeed` has `label`, `subscribe(receive, unavailable)` and unsubscribe. It carries no authority, commands, inventory, names or durable history. Any production read endpoint, identity enrichment, persistence or command requires a main-owned contract and adapter; record the precise missing seam as `needs:` in progress. No contract changes in this lane.

## Scope

Write only `packages/world/src/growth-history/**` and this lane’s PRD/progress. Everything else is read-only, including `packages/shared` and existing host routes. Main supplies integration and any package export/dependency wiring. Do not start a production service or create an endpoint.

## Acceptance

Run `pnpm typecheck`, scoped ESLint, focused Vitest tests for what changed, and the relevant package build. Record exact commands and results. Focused tests replay the same seed twice and compare ordered outcomes, validate every exported frame, show at least one home and civic transition across several weeks, ensure no paid-source credit and verify simulation provenance. Supply a concise generated fact timeline and evidence of the actual reducer used. Use `$look` for visual changes and reserve capture ports using the repo helper. No proof matrix or full `pnpm verify` per task.

## Quality bar

The result must feel like part of the lived-in kingdom, with readable craft, honest provenance and no placeholder success. Keep interaction accessible and preserve existing live evening behaviour. Judge visual work against `chatdom/Artstyle-Soul-Feel.md` and `chatdom/Quality.md`.

## References

- packages/world/src/growth — reducer and versioned policy, v1 deterministic reducer and policy; packages/shared/src/growth.ts — public scene schema.

## Not now

No owned world scene edits, paid unlocks, production deployment, fake live data, new authority, unrelated home ceremony or changes outside scope.

## Decisions

- **2026-11-01 — Read seam first.** Main owns production authority and binding; this lane may build and demonstrate its complete consumer against an explicitly simulated adapter while the required integration contract is absent.

- **2026-11-01 — Integration checkpoint.** Produce a small green checkpoint early. Main merges it before the whole part is finished. Validate feed origin against its LIVE/SIMULATED label; never replay a recent tail as fresh live credit. One focused test for the changed behaviour; capture only the view being judged.
