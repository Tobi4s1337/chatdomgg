# Spec 47: Picture trees

Status: frozen 2026-10-31  
Vision: `chatdom/ChatDom.md` §5; `chatdom/Artstyle-Soul-Feel.md` world and light; `chatdom/Quality.md` §§2–4.

## What and why

Give the accepted stream picture the character of a handmade kingdom set among living trees. Oak, pine, birch and willow each read at a glance, with a few individual old, gnarled elders. Trees frame the town and water without taking the picture from the homes and their lights. A quiet breeze moves the foliage, while each tree stays rooted in its place.

## Current state

`packages/content/src/core/index.ts` exports `createTree`; `packages/content/src/props/dressing/index.ts` contains tree forms and roles. `apps/web/src/kingdom/ground-dressing/plan.ts` owns `GroundPiece`, existing planting, clearance and collision; `mount.ts` owns the existing dressing mount and wind. `packages/content/README.md` defines the blueprint lattice, palette and rendering process. `work/references/living-ground.md` already studies seeded tree structure and anchored motion. These are integration seams, not an invitation to add another forest.

## Rules

1. Make recognisable, crafted voxel silhouettes: broad branched oak, tiered pine, light slender birch, drooping willow at water, and a few gnarled elders. Give crowns layered, connected clumps and deliberate gaps; avoid round lollipops, voxel noise and identical repeated silhouettes. Use existing registered palette and `StyleFamily`; seeded variation must be deterministic.
2. Respect the existing ground-dressing zones and actual planting sites. Willow belongs by water, elders are rare. Root integration chooses and validates sites against actual land, water, occupied space and keep-outs. Do not invent a parallel layout or duplicate forest. No homes, streets, adopted collision, lantern street, pools, beacon, framing or camera move.
3. Roots and trunks are fixed. Animate canopy gently and coherently, preserving attachments and the silhouette. No detached clumps, whole-tree rocking, synchronized mechanical motion or crawling shadow. Animation and shadow depth must agree. Preserve existing shadow-caster ownership and LOD behaviour; root integrates the existing shader and shadow hooks.
4. Blueprints use existing strict `VoxelBlueprint`, build lattice, materials and style kits; no shared schema changes. Keep structure grounded and connected, and assets within existing schema limits. No generated painted art or external model assets.
5. Render the assets from three angles at dusk and inspect a contact sheet. Inspect the integrated 1920×1080 stream still, in the accepted camera and lighting, with `view_image`. Fix weak silhouettes or composition; record remaining weaknesses honestly. Simulated data is labelled where visible.

## Contracts

Private producer in `packages/content/src/trees/`: export deterministic tree blueprints and a typed species selection function taking `StyleFamily`, a species and seed. Stable asset IDs distinguish species, style and variant; same inputs reproduce the same blueprint. Keep sway metadata outside the strict blueprint.

Private adapter in `apps/web/src/kingdom/trees/`: consume caller-supplied, already-approved existing planting sites, each with stable site ID, zone, `position: Vec3`, and `yaw` (radians, same origin and transform convention as `GroundPiece`), plus style and seed. Return stable-ID records containing `blueprint`, `position`, `yaw` and canopy motion metadata; they must be convertible to `GroundPiece` without shifting origins. The same site retains its identity and transform across rebuilds. The caller supplies water/zone classification and decides suitability; this API creates no sites and does no terrain query. Root owns mapping existing site records to this input, replacing the corresponding existing tree production once, collision integration, shader/depth hookup, shadow registration and final live integration. Coordinate the precise exported function signatures with root before integration; no shared package edits.

## Scope

Lane writes only `packages/content/src/trees/**` and `apps/web/src/kingdom/trees/**`, including local tests and capture helpers. Existing files and the content catalogue are read-only. Root owns all edits outside those folders, including the existing tree call, render harness registration and stream integration. If a seam is missing, report `needs:`; do not patch around it by spawning a second forest.

## Acceptance

Run scoped tree tests with `pnpm exec vitest run <tree test paths>`, `pnpm typecheck` and `pnpm --filter @chatdom/web build`. Validate the produced blueprints against the existing schema and palette, determinism, stable IDs, grounding, and adapter transforms with focused tests. Produce and inspect a dusk three-angle contact sheet for all species and variants with the production voxel material; root may register the existing content renderer if required. Capture and inspect one integrated 1920×1080 stream still with the existing accepted view once root connects the seam. Record commands, image paths, visual weaknesses and any integration `needs:` in the lane progress. No full-suite, screenshot matrix or performance-budget proof is required for this lane; SwiftShader is not real-GPU evidence.

## Quality bar

A crafted diorama at dusk: chunky, warm, purposeful branches and foliage with restrained palette breaks, not flat cubes or generic procedural blobs. The grove must reinforce the accepted lit street and preserve the view of homes and beacon. At stream scale each species still has its own outline; in closer views the canopy joins the tree instead of floating.

## References

- `work/references/living-ground.md`: ez-tree's seeded branch identity and anchored motion, adapted to connected voxel clumps; no assets or leaf-card look copied.
- `work/references/voxel-meshing-light.md`: existing voxel meshing and LOD context; preserve the live system's ownership.

## Not now

New terrain, street or settlement layout, new forest placement, shared contracts, new collision authority, generated paintings, visual redesign of the accepted picture, or unrelated performance work.

## Decisions

- 2026-10-31: The lane produces assets and a private site adapter; root owns actual planting and all existing renderer and shadow integration. This prevents two independently planted forests and competing wind owners.
