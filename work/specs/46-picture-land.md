# Spec 46: Picture land

Status: **frozen 2026-10-31** · Branch: `lane/picture-land` · Vision: `chatdom/ChatDom.md`, `Artstyle-Soul-Feel.md` §§1–3, `Quality.md`; `work/PLAN.md` §10.

## What and why

Give the existing inhabited kingdom the legible, crafted terrain of a toy-world picture: layered ridgelines, exposed rock, small cliffs and ledges, ragged earth trails, and terraces that let the town visibly climb. Townscaper, Trove and Cube World are genre cues for composed silhouette and terrain character, not sources of assets or code. The street-level scene must retain its sense of home, and its landscape must read at stream size rather than as smooth, interchangeable blob hills.

## Current state and authority

`SettlementPlan` (`packages/world/src/settlement/types.ts`) already contains `LandformPlan` v1 or v2, homes, reservations, streets, grading and optional `genesisSurface`. `settlement/terrain.ts` supplies authoritative ground and grading; `apps/web/src/kingdom/terrain-worker.ts` and `horizon.ts` consume that terrain. Founded scene `43cffdb6` is pinned to its v1 plan and 240 homes; v2 exists but is not permission to regenerate it. Spec 27 and `kingdom-land` retain planning, routes and landform ownership. Main owns scene wiring, founded authority, serialization, adoption and revisions.

## Rules

1. Produce deliberate, asymmetric long ridge profiles and stepped, locally broken rock faces; show distinct foreground, town slope and skyline. Vary scale and silhouette, with quiet areas between details. Keep palette and surfaces handmade, coherent and dusk-readable.
2. Integrate ledges and earth trails into the actual land, using existing streets and their grades; the town climbs through recognisable terraces. Do not invent new streets or displace existing routes, reservations, homes or water. Keep accepted low street-led camera, pools of light, house models, beacon and gold frame/crest.
3. The producer consumes immutable existing `SettlementPlan` (including its `LandformPlan` and optional Genesis surface) and explicit bounds; it supplies a deterministic candidate height query and a material classification derived from the same candidate. It must preserve accepted public ground, foundations, clearances and water boundaries. A candidate is not authority merely because it renders.
4. Rendering and collision/contact must sample the same adopted height authority, including terrain triangle interpolation at contact. No render-only height displacement or unregistered revision for inhabited terrain. Existing pinned founded scenes remain byte- and geometry-stable until main explicitly adopts a new validated revision; never silently migrate them. A material-only treatment on their existing height is permissible when it preserves these constraints.
5. First demonstrate a self-contained, visibly rendered fixture inside the owned web scope, using an explicit stand-in consumer of the candidate query. Mark it as a fixture. It must run without edits to main's scene or waiting for adoption; the fixture proves appearance, not integrated authority. Main later wires the real worker, collision/contact and founded adoption together as one revision and checks the actual scene.
6. No lighting, exposure, fog, trees, plants, water, camera, house or frame rewrite. Do not change existing shared schemas, planning ownership or Genesis grants. The lane may report a needed seam to main, not modify unowned files.

## Contract and integration

A proposed internal producer lives in `packages/world/src/terrain-art/**`; the consuming fixture and draw adapter live in `apps/web/src/kingdom/terrain-art/**`. Freeze exact names with main before wiring. The producer takes `SettlementPlan`, `BoundsXZ`, and the caller's existing authoritative height and public-ground queries; it returns a candidate `height(x,z)` and a deterministic `material(x,z)` classification plus its bounds. Use existing plan and ground types, local types for any classification, and no new `packages/shared` schema. No plan mutation, implicit adoption or second placement ledger. Candidate sampling must be bounded, finite, deterministic and preserve protected ground; implementation must make all constraints observable to tests.

Main decides whether the chosen API and serialization/revision mechanism are sufficient, exports it if necessary, and alone wires the same adopted query into rendered terrain, horizon and collision/contact. If existing founded encoding cannot represent the candidate, main must establish and validate a new revision before adoption. The lane must not pretend a fixture or material overlay proves this integration.

## Scope

Source writes only `packages/world/src/terrain-art/**` and `apps/web/src/kingdom/terrain-art/**`; lane PRD/progress and capture artifacts are permitted. All other source is read-only. This request supersedes spec 27's art seam only; kingdom-land retains land planning. No generated paintings or proprietary assets/code.

## Acceptance

- Fixture is visible in task 1, captured and inspected at 1920×1080; improve it against the direction above. Capture paths and shortcomings go in progress. Use the capture lock and permitted ports per repository capture rules.
- Run `pnpm typecheck`, `pnpm exec vitest run packages/world/src/terrain-art apps/web/src/kingdom/terrain-art`, `pnpm exec eslint packages/world/src/terrain-art apps/web/src/kingdom/terrain-art`, and `pnpm --filter @chatdom/web build`. Tests cover deterministic finite samples, preservation of protected homes/roads/water, unchanged input and material/height consistency. Record actual results.
- Final acceptance requires **one actual integrated 1920×1080 stream still**, captured after main's authority/adoption wiring and visually inspected, plus the scoped checks above. Show the accepted camera, town, frame and terrain together. A fixture capture alone is not the integrated still; if main has not wired it, report that acceptance remains open instead of faking it. No full verification matrix or performance proof is required for this lane.

## Quality bar

Readable layered silhouettes, rocky faces and climbing terraces in the actual picture; no noisy checkerboard, random scattered cubes, smooth anonymous mounds or generic terrain. Preserve warmth and visual hierarchy. Inspect the still, name weak areas, and improve until the stated bar reads in the image.

## References

- `work/references/voxel-meshing-light.md`: consistent height/triangle contact, chunk boundaries and voxel surface technique; keep the existing mesher.
- `work/references/settlement-streets.md`: immutable accepted geography, grades and routes; do not regenerate settled streets.
- `work/references/magic-lighting.md`: established dusk and lighting constraints; preserve the existing lighting rather than changing it.

## Decisions

- **2026-10-31:** A self-contained visual producer and fixture are lane-owned; main alone chooses and implements the common authority and adoption revision. Existing founded v1 stays pinned. The genre cues inform composition only; no proprietary code or assets are copied.
