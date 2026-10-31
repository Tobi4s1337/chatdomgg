# Water life

`createWaterLife` (in `life.ts`, exported from `index.ts`) brings the water places to life: wild mallard pairs, a
grey heron in the reed shallows, a trout jumping, the kingfisher's flash along the stream, noon dragonflies, dusk
fireflies, the wheel's turn and spray, moored boats' sway, weir spray, flour dust at the mill door, rings, low night
mist, the place lamps' glows and the caller's named floaters. Nothing in it invents a person, a keeper, a name or a
presence.

## Contract

```ts
const life = createWaterLife({
  seed,                         // kingdom seed, whole number
  habitat: { waterAt, bodies, reaches, obstacles, walks },
  reeds,                        // reed-bed footing centres (Vec3) of the placed shore pieces
  critters: { material, pool, registry },  // caller-owned avatar-lattice voxel material, VoxelWorkerPool, MaterialRegistry
  wheels,                       // [{ object, pivot, axis, radius, width, level }]: the placed wheel mesh and its axle mount
  boats,                        // [{ object, tether }]: placed boats (PW01) and where their painters are tied
  weirs,                        // [{ a, b, downstream, drop }]: crest ends at the crest top, downstream x/z, drop in metres
  doors,                        // [{ position, normal }]: mill door threshold and outward normal
  lamps,                        // PlacedEmitter[] of the bridge and pier lanterns (placePieceAnchors(...).emitters)
});
scene.add(life.root);
await life.ready;               // every creature meshed through the caller's pool
```

- `habitat.waterAt` is the water surface's own query (`createWaterSurface(...).waterAt`); `bodies` and `reaches` are
  the same `WaterBody` records and `deriveWaterReaches` output the surface draws; `obstacles` are the surface's
  `WaterContact`s (piles, stones, arch springings, weir crest); `walks` are every placed piece's `PlacedWalk`.
- `pivot`, `axis` and `tether` are in the moved object's parent space (the scene for a static placement). The layer
  records each object's placed matrix, sets `matrixAutoUpdate = false`, and restores both on `dispose()`.

Each frame, in this order:

```ts
for (const [id, light] of lampLights) strengths.set(id, light.update(time, people) * hourCurve);
life.update({ time, hour, environment, camera, lamps: strengths, floaters });
water.update({ time, environment, camera, sources: [...windowSources, ...life.sources()] });
water.reflect({ renderer, scene, camera, frame, exclusions: [...atmosphereObjects, ...life.exclusions] });
renderer.render(scene, camera);
host.audio.play(life.sounds(previousTime, time, hour, floaters));
```

- **Lamps.** The host owns one shared people-light helper per lamp: `createPeopleLight(placeLampLight(emitter))`
  (pilot 0.12, capacity 2, the common rise/fade). It feeds that helper the accepted public people and its activity
  history, applies the kingdom's hour curve and passes the strength by emitter id. A lamp it leaves out is dark;
  strengths outside 0..1 throw. `life.sources()` returns the lit lamps (and burning floaters) for the water's
  reflection and the light field's emitter list. No scene light is added.
- **Floaters.** `FloaterAction { id, label, launched, from }` are the caller's finite actions; the label is public-safe
  caller text and is returned untouched by `life.floaterLabels()` (position above the lantern, opacity) for the
  host's approved text treatment. The newest 12 alive are drawn, each for 180 s; the rest are counted as dropped.
- **Sounds.** `life.sounds(from, to, hour, floaters)` lists one-shots in (from, to]: `fish-leap`, `fish-splash`,
  `duck`, `heron`, `kingfisher`, `floater`, each with a position. A backward step or one longer than 2 s returns
  none, so a seek never replays splashes. Continuous loops (wheel, weir, trough, arch, reeds) remain the pieces'
  `SoundAnchor`s. The host plays them through its own audio mix; this layer never plays sound.
- **Disposal.** `life.dispose()` removes the root, restores wheels and boats, and frees only its own geometries,
  shader and sprite materials and glow texture. The caller's material, pool, registry and scene survive.

## Determinism and bounds

Everything is a pure function of `seed`, the habitat and the caller's `time` and `hour`: there is no local clock
and no accumulating particle state. Seeking either way lands on the same frame; the bench capture proves it by
hashing the frame at t, t + 70 s and t again.

| Life | Rule | Bound |
|---|---|---|
| Ducks | A pair per still water ≥ 25 m² (two on ≥ 600 m²), on the largest clear seeded loop, ≥ 0.22 m deep, 0.65 m from solids, never under a deck | 4 pairs |
| Heron | Feet on the real bed 4–30 cm deep beside a reed bed, facing deeper water | 1 |
| Fish | One jump per 30 s slot at a seeded moment (20–40 s apart), from ≥ 0.45 m deep open water | 1 in the air |
| Kingfisher | A 10–22 m dash 0.55 m above a natural stream in 70% of 45 s slots, 06:30–20:30, never over or under a walk | 1 |
| Dragonflies | Hover and dart beside reed beds, 09:30–17:30 | 3 |
| Fireflies | Beside reed beds, from 19:12 to before dawn; 2.5–5.5 px, peak 0.75 | 48 |
| Rings | Fish leaps and landings, ducks' dabbling, floater launches; strongest first | 8 |
| Mist | One sheet per water from hour 21, 0.3 m above it, each ≤ 0.35 opacity, nearest drawn first with depth | one per water |
| Spray | Wheel (72 drops off the descending side, faint noon rainbow), weir (48), splash (24) | fixed |
| Floaters | Drift on the real flow (still water: a seeded veering breeze), slide along stones, rest at banks | 12 |

The wheel turns at 5 rpm about its own axle mount; spray leaves the side moving down (`axis × up`).

## Creatures

Creature geometry is `packages/content/src/places/water/critters`: avatar-lattice `VoxelAsset`s meshed by the
production mesher through the caller's pool and drawn with the caller's avatar voxel material. Parts are rigged at
their own pivots: the ducks' and heron's heads, the kingfisher's wings.
