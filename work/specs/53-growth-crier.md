# Spec 53: The growth crier

Status: frozen consumer scope 2026-11-01  
Vision: `chatdom/ChatDom.md`; `chatdom/World-Tree.md` §§8–9; `chatdom/Artstyle-Soul-Feel.md`; `chatdom/Quality.md`.

## What and why

When growth happens the kingdom can say a short, warm line: a home grows, a civic place levels, a streak is kept. A quiet interval gathers several events into one line rather than flooding chat.

## Current state

`packages/shared/src/growth.ts` defines `GrowthSceneFrame`, `GrowthSceneBeat`, `GrowthHomeView` and `GrowthSceneFeed`, a public read projection with `live` or `simulated` origin. The frame is a current room snapshot with a bounded recent beat window, no person identity or history authority. `packages/world/src/growth` exports the tested deterministic v1 policy and reducer; main owns authority and integration. Existing home ceremony lane owns `apps/web/src/growth/**`; it is read-only here. Spec 08 is people/wardrobe, not a growth-depth spec.

## Rules

1. Format only witnessed GrowthSceneBeat facts. The public beat contains no person name; a plot ID is not a name. With no independently trusted disclosure/name mapping, use truthful anonymous wording or omit a personal line. Never infer identity, count unseen activity, or invent a milestone. Preserve sequence and timestamp evidence.
2. Supply a deterministic bounded batcher with explicit clock and configured quiet window, maximum message length and backpressure. Deduplicate repeated delivery by kingdom and source sequence plus beat identity, order deterministically, batch quiet events into a single truthful short line, and safely handle overflow without claiming more than witnessed. Reset only deliberately for a different stream/session. No magic clock, fake send success, or replaying historical milestones as live.
3. Export pure formatting/batching and a read-only feed adapter for main; no Twitch calls, credentials, send API, message permissions or live transport. SIMULATED input can only produce labelled simulated preview output; never send it to Twitch. Production sending and identity enrichment require main-owned authoritative adapters and delivery/acknowledgement semantics.

4. Growth is forward, measured in days and never accelerated or purchased with money. A fixture is visibly labelled SIMULATED wherever displayed. Unavailable data is not silently shown as an empty or successful live result.

## Contracts

Consume the frozen shared growth schemas and inferred types as read-only; validate external frames with `GrowthSceneFrameSchema`. `GrowthSceneFeed` has `label`, `subscribe(receive, unavailable)` and unsubscribe. It carries no authority, commands, inventory, names or durable history. Any production read endpoint, identity enrichment, persistence or command requires a main-owned contract and adapter; record the precise missing seam as `needs:` in progress. No contract changes in this lane.

## Scope

Write only `packages/twitch/src/growth-crier/**` and this lane’s PRD/progress. Everything else is read-only, including `packages/shared` and existing host routes. Main supplies integration and any package export/dependency wiring. Do not start a production service or create an endpoint.

## Acceptance

Run `pnpm typecheck`, scoped ESLint, focused Vitest tests for what changed, and the relevant package build. Record exact commands and results. Focused tests cover all beat kinds, missing names, duplicate sequence with multiple distinct beats, window boundary, overflow, ordering, simulated input and reconnect. Provide a human-readable simulated transcript; no live chat writes. Use `$look` for visual changes and reserve capture ports using the repo helper. No proof matrix or full `pnpm verify` per task.

## Quality bar

The result must feel like part of the lived-in kingdom, with readable craft, honest provenance and no placeholder success. Keep interaction accessible and preserve existing live evening behaviour. Judge visual work against `chatdom/Artstyle-Soul-Feel.md` and `chatdom/Quality.md`.

## References

- chatdom/World-Tree.md §9 — every spoken fact witnessed; packages/shared/src/growth.ts — exact public beats.

## Not now

No owned world scene edits, paid unlocks, production deployment, fake live data, new authority, unrelated home ceremony or changes outside scope.

## Decisions

- **2026-11-01 — Read seam first.** Main owns production authority and binding; this lane may build and demonstrate its complete consumer against an explicitly simulated adapter while the required integration contract is absent.

- **2026-11-01 — Integration checkpoint.** Produce a small green checkpoint early. Main merges it before the whole part is finished. Validate feed origin against its LIVE/SIMULATED label; never replay a recent tail as fresh live credit. One focused test for the changed behaviour; capture only the view being judged.
