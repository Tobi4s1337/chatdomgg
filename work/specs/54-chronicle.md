# Spec 54: The living Chronicle

Status: frozen consumer scope 2026-11-01  
Vision: `chatdom/ChatDom.md`; `chatdom/World-Tree.md` §§8–9; `chatdom/Artstyle-Soul-Feel.md`; `chatdom/Quality.md`.

## What and why

Open the kingdom’s Chronicle and scrub through its history in the live engine: homes and civic places take shape on their actual plots and anchors, and a chosen night explains the facts witnessed then. Pause, seek and play weeks in seconds; this is never a video or a fabricated retelling.

## Current state

`packages/shared/src/growth.ts` defines `GrowthSceneFrame`, `GrowthSceneBeat`, `GrowthHomeView` and `GrowthSceneFeed`, a public read projection with `live` or `simulated` origin. The frame is a current room snapshot with a bounded recent beat window, no person identity or history authority. `packages/world/src/growth` exports the tested deterministic v1 policy and reducer; main owns authority and integration. Existing home ceremony lane owns `apps/web/src/growth/**`; it is read-only here. Spec 08 is people/wardrobe, not a growth-depth spec.

## Rules

1. Build an accessible timeline with play/pause, keyboard and pointer seeking, a legible selected-night fact reading, deterministic ordering and reduced-motion operation. Use the existing engine and host-provided scene bindings; do not render a video, edit the live world or interfere with live movement/chat. On close restore live presentation cleanly.
2. GrowthSceneFrame is a bounded current snapshot and at most 128 recent beats; it is not the durable fact log. Do not extrapolate an earlier scene from the current tail. Until main freezes a durable replay/read contract and historical world adapter, demonstrate with an explicitly local SIMULATED sequence of complete read-only scene snapshots and factual captions, not a pretend production endpoint. Each seek must replace replay state from the selected historical snapshot, including backwards seeks; never mint credit or play historical events as live ceremonies.
3. Provide an adapter seam for main to supply trusted ordered historical snapshots and engine application. Name exact needs: durable versioned history with ordering, timestamps, provenance/redaction and complete world snapshots or deterministic reconstruction; authoritative home/civic/castle/streets bindings; live/replay isolation. Do not modify shared contracts, world authority or growth home ceremony.

4. Growth is forward, measured in days and never accelerated or purchased with money. A fixture is visibly labelled SIMULATED wherever displayed. Unavailable data is not silently shown as an empty or successful live result.

## Contracts

Consume the frozen shared growth schemas and inferred types as read-only; validate external frames with `GrowthSceneFrameSchema`. `GrowthSceneFeed` has `label`, `subscribe(receive, unavailable)` and unsubscribe. It carries no authority, commands, inventory, names or durable history. Any production read endpoint, identity enrichment, persistence or command requires a main-owned contract and adapter; record the precise missing seam as `needs:` in progress. No contract changes in this lane.

## Scope

Write only `apps/web/src/chronicle/**` and this lane’s PRD/progress. Everything else is read-only, including `packages/shared` and existing host routes. Main supplies integration and any package export/dependency wiring. Do not start a production service or create an endpoint.

## Acceptance

Run `pnpm typecheck`, scoped ESLint, focused Vitest tests for what changed, and the relevant package build. Record exact commands and results. Test deterministic seek forward/backward, pause, empty/unavailable history, replacement/disposal, fact captions and simulation label. Capture and look at 1440×900 and 390×844 for changed UI. Record a 30-second SIMULATED engine run and watch the entire recording; report path, what actually animates, and any unavailable castle/street history. Main must repeat on integrated seeded history. Use `$look` for visual changes and reserve capture ports using the repo helper. No proof matrix or full `pnpm verify` per task.

## Quality bar

The result must feel like part of the lived-in kingdom, with readable craft, honest provenance and no placeholder success. Keep interaction accessible and preserve existing live evening behaviour. Judge visual work against `chatdom/Artstyle-Soul-Feel.md` and `chatdom/Quality.md`.

## References

- work/references/settlement-streets.md — established scene character; chatdom/World-Tree.md §9 — record and privacy. No existing study note establishes replay architecture; seek adapter stays local pending main’s contract.

## Not now

No owned world scene edits, paid unlocks, production deployment, fake live data, new authority, unrelated home ceremony or changes outside scope.

## Decisions

- **2026-11-01 — Read seam first.** Main owns production authority and binding; this lane may build and demonstrate its complete consumer against an explicitly simulated adapter while the required integration contract is absent.

- **2026-11-01 — Integration checkpoint.** Produce a small green checkpoint early. Main merges it before the whole part is finished. Validate feed origin against its LIVE/SIMULATED label; never replay a recent tail as fresh live credit. One focused test for the changed behaviour; capture only the view being judged.
