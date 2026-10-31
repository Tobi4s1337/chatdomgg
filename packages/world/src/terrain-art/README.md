# Picture land: candidate producer (spec 46)

A bounded, deterministic height and material query over an accepted `SettlementPlan`. It is a **candidate**.
It renders in the fixture (`apps/web/src/kingdom/terrain-art`), and that does not make it authority. Main
alone adopts it. When main does, rendered terrain, horizon, light-field occupancy and collision/contact
switch to it together as one validated revision.

## The seam

```ts
import { createTerrainArtCandidate, TERRAIN_ART_LIMITS, type TerrainArtCandidate } from './terrain-art';

const candidate: TerrainArtCandidate = createTerrainArtCandidate({
  plan,                                           // immutable; read only, never copied into a ledger
  bounds: { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 },  // explicit; ≤ 1100 m from the origin
  ground: (x, z) => settlementTerrainHeight(plan, x, z),          // caller's authority, read at integer corners
  publicGround: (x, z) => samplePublicGround(plan, x, z),         // caller's public-ground query
});

candidate.height(x, z);      // 00→11 triangle interpolation of Float32 corners: the contact surface
candidate.corner(ix, iz);    // the exact Float32 corner a renderer uploads and a contact query reads
candidate.material(x, z);    // 'grass' | 'heath' | 'trail' | 'paving' | 'scree' | 'rock' | 'ledge' | 'waterbed'
candidate.protection(x, z);  // { distance, guard }: the preservation rule, observable
candidate.candidateRevision; // `${plan.revision}+picture-land:1`, the name to pin when adopting
candidate.backdrop;          // 'north' | 'east' | 'south' | 'west': the side the ridges stand behind
```

The fixture imports this by path because `@chatdom/world` exports are main's. The proposed subpath is
`"./terrain-art": "./src/terrain-art/index.ts"`.

## Guarantees (all tested in `producer.test.ts`)

- **Preservation.** A corner within `TERRAIN_ART_LIMITS.clearance` (1.5 m) of any guard returns the caller's
  ground bit for bit. Guards come from the plan and the caller:
  - public ground (`reservedDistance`);
  - **every** planned street, including routes not yet opened;
  - market, castle court and every court;
  - home lots and every reservation lot;
  - castle bounds plus a 2 m apron, and each module footprint;
  - water. This covers the v1 lake, v2 waters and streams, and Genesis coast and inland water. The dry bank
    is 6 m, and conservative ellipse and channel estimates reach past each sampler's own envelope.

  Beyond the clearance, the land eases back from sculpted to authoritative over 9 m.
- **Bounded.** Bounds must be finite and nonempty, and lie within ±1100 m. Out-of-bounds or non-finite queries
  throw `RangeError`. Every corner lies within `[ground − 3, ground + 360]`. A non-finite caller ground
  throws instead of propagating. The caches hold one Float32 and one Float64 per metre over the town plus
  48 m (≈3 MB for the founded town).
- **Deterministic.** Values depend only on the plan seed, the plan's footprints and the caller's ground. They
  never depend on query order, cache state or bounds (any bounds containing a point return the same value).
  Hashing is integer; heights are `Math.fround`.
- **Consistent.** `material` reads only the patch's own corners, its neighbours' corners, the caller's public
  ground and the plan's water. It names the whole metre patch. Rock appears only where the patch's
  triangles rise at least 0.5 m; grass, heath and ledge only where they rise less.
- **Immutable.** The input plan is untouched and may be deep-frozen. The candidate and its bounds are frozen.

## Shape

The ridges are written in a canonical frame. Its north is the town's back: the bounds edge nearest the castle,
and never a Genesis ocean side. Its x = 0 is the keep's line. The founded town maps onto it as the identity.
Three asymmetric cuesta ridges (the scarp faces the town, the back slope is long) dip behind the keep, and
flanking highland closes the valley. Ledges outcrop in bands on slopes. Between guarded footprints inside the
town, 1.2–2.2 m terraces step the in-between ground. Relief fades in over 60 m beyond water banks.

## What adoption needs (main)

`needs:` main to decide the export and the revision mechanism. Main must then wire `corner` into the terrain
worker, horizon, light-field occupancy and collision/contact in one revision. Founded `43cffdb6` stays pinned
until then. A fixture capture proves appearance only.
