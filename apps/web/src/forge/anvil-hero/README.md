# The anvil and the sleeping dragon

The Forge's two physical heroes (spec 25): an iron anvil on a worn stone block, and the sleeping dragon chimney.
This folder owns the anvil, its bench and its capture. The dragon lives in `packages/content/src/anvil-hero`
(its own README covers the pose and kits). Everything is metres, +Y up, horn toward +X, the mark's cheek toward +Z.

## Imports

```ts
import { createAnvilHero, type AnvilHero } from './anvil-hero';               // from apps/web/src/forge
import { createCodexEngraving } from './engraving';                           // unchanged, caller-owned
import { ANVIL_HERO_DRAGON_SURFACE, createAnvilHeroDragon } from '@chatdom/content/anvil-hero';
```

`@chatdom/content/anvil-hero` is already in the package's `exports`. Nothing here is re-exported from the
package root, and nothing in `packages/shared` changed.

## The anvil: `createAnvilHero(parent)`

Adds an identity-transform `root` (`forge-anvil-hero`) to `parent`, holding one mesh (`forge-anvil-hero:stage`).
It is cast once by the production voxel mesher on the character lattice (h = 0.0625 m) and drawn with the kingdom's
voxel shader, extended for the iron, the worn arrises and the cut runes.

| Point (local to `hero.root`) | Value |
|---|---|
| Working face | y 1.43 m; x −0.875 … 0.5 m, z −0.25 … 0.25 m; centre (−0.19, 1.43, 0) is the strike point |
| Horn | x 0.75 … 1.375 m; flat top at y 1.37 m (one h under the face), drooping to 1.30 m over the last 3 h |
| Hardy hole | x −0.75 … −0.625 m, z ±0.0625 m, open through the plate |
| Stone block | x −0.9375 … 0.5625 m, z ±0.5625 m; its bottom course is sunk to y −0.07 m |
| Whole stage | box (−0.9375, −0.07, −0.5625) … (1.375, 1.43, 0.5625); inside the 1.5 m radius; nothing above 1.43 m |

Mount and rune origin, in `hero.root` coordinates (a test reads these two lines and compares them with the code):

- `engravingMount.position = (-0.1875, 0.93, 0.18544)`, `rotation = Euler(0, 0, 0, 'YXZ')`, `scale = 0.9`
- `runeOrigin = (-0.1875, 0.93, 0.2075)`

The engraving's plate face sits 0.5 mm behind the cheek (z 0.1875 m), inside a window cut for it, so the cheek's own
edge frames the mark and hides the plate's bevelled rim. The cloud is about 0.24 m across. `runeOrigin` is 2 cm
outside the centre of the mark's cut.

### The caller's side (exactly what `ritual-view.ts` does)

```ts
const hero = createAnvilHero(root);
const engraving = createCodexEngraving(hero.root);
engraving.root.position.copy(hero.engravingMount.position);
engraving.root.rotation.copy(hero.engravingMount.rotation);   // copies the 'YXZ' order too
engraving.root.scale.setScalar(hero.engravingMount.scale);
// World space: hero.root.localToWorld(hero.runeOrigin.clone()). Because hero.root is identity, the
// point is also local to `root`; copying it into engraving.origin replaces the stale old value.
engraving.update(input); hero.update(input);                  // the same {time, heat, shaping}
hero.setEnvironment(getEnvironment(hour));                    // optional; defaults to 19:00
engraving.dispose(); hero.dispose();                          // engraving first
```

### `update({time, heat, shaping})`

Sets three uniforms and nothing else: no clocks, no accumulated state, no allocation. Any time may be given in any
order (seeking backwards is the same as seeking forwards); `heat` is clamped to 0–1, and non-finite inputs read
as 0. What the heat does, all inside the cuts:

- Each of the 19 runes lights when heat passes `0.25 + 0.5 × order`, where `order` runs 0 (beside the mark) to 1
  (the horn tip). Rising heat flows outward from the mark; falling heat drains horn-first. At or above 0.75
  every rune is lit; below 0.25 none are, so the ritual's waking heat of 0.2 leaves them cold.
- Each rune walks the ramp #6b1f12 → #c2301a → #ff6a1f → #ffb347 with a deeper edge colour, flickering ±8%.
- The working face's arrises warm (#5a2a18, within 2 cm of the edge) from heat 0.6 to 0.85.
- Heat 0.93 → 1 adds the strike's extra brightness.
- `shaping: true` runs a fuse through the runes, 0.12 s apart, on the caller's `time`.

### Resources

The hero owns its geometry, its `ShaderMaterial`, the voxel material state it was built from, a 40 × 24 × 20 R8
occupancy texture (19 kB) and the rune table (one RGBA float row: four texels per rune plus one per stroke).
`dispose()` frees exactly those, removes `root` from `parent` and is safe to call twice. Anything the caller
parents under `hero.root` (the engraving) is left alive and attached. There are no listeners or timers.

Cost: one draw call, 2,110 triangles. The cut runes are ray-marched in the fragment shader only on iron
fragments near a rune. SwiftShader timings say nothing about a device; see the doubts below.

## The dragon: `createAnvilHeroDragon(style)`

A drop-in for `createForgeMotif('sleeping-dragon', style)`: the same envelope `[24,16,18]`, mount `[12,0,9]` and
emitter `[0,2,9]`, 170–183 non-overlapping boxes per kit, fresh objects on every call (the assembler recolours and
mirrors them in place). `ANVIL_HERO_DRAGON_SURFACE[style]` is the coil's back: the broad surface a composed
finish should recolour (see the checklist).

## Bench and capture

With the web dev server running (`pnpm --filter @chatdom/web dev`, port 5170):

- `/src/forge/anvil-hero/bench/index.html?view=…&style=…&hour=…&heat=…&time=…&shaping=0|1`.
  Views: `anvil-close`, `anvil-square`, `dragon-close`, `dragon-square`, `anvil-mark` (the cheek face-on).
  Styles `hearth|tide|grove`, hour 0–23, heat 0–1, time in seconds. Defaults: anvil-close, hearth, 19, 0, 0, 0.
  Unknown or repeated inputs are refused on screen. The page is labelled SIMULATED · ART BENCH and publishes
  `window.__chatdomReady` after the first finished frame, `window.__chatdomAnvilHero` (costs, framing, mark
  rect) or `window.__chatdomAnvilHeroError`.
- `/src/forge/anvil-hero/bench/sheet.html?hour=19`: the three kits' dragons from four angles, as a contact sheet.

`node apps/web/src/forge/anvil-hero/capture.mjs` takes the machine-wide capture lock, starts its own Vite server
on the first free port in 5170–5199 (or uses `--base-url`), and stops only that server. A full run writes to
`shots/anvil-hero/` (ignored):

- `<view>-hearth-h19@1440x900.png` and `@390x844.png` for the four primary views;
- `anvil-close-hearth-h19-heat0.85-t1.3@…` at both sizes (pour);
- `anvil-mark-hearth-h19[-heat0.85-t1.3]@1440x900.png`, each with `mark-compare-….png` (crop | untouched SVG | overlay);
- `dragon-sheet-h19@1440.png` and its greyscale copy;
- `capture-stats.json` (triangles, draw calls, camera distance, plate set-back).

Options: `--view a,b`, `--style`, `--size desktop|phone`, `--hour`, `--heat [--shaping] [--time]`, `--sheet`,
`--no-sheet`, `--sheet-width`, `--anvil` (only what an anvil change affects). Console, page or shader errors fail
the run.

Acceptance: `pnpm typecheck`, `pnpm lint`, `pnpm exec vitest run packages/content/src/anvil-hero
apps/web/src/forge/anvil-hero`, `pnpm build`, then the capture.

## Integration checklist

Main already mounts both exports. Checked against this branch on 2026-10-31:

- [x] `ritual-view.ts` builds the stage with `createAnvilHero(root)`; the old pedestal and box/cone anvil are gone.
  What remains on that root (rings at r 1.53/1.7 m, hammer, words, blueprint, stamp) is ritual presentation,
  shown only during a ritual, and stays with spec 17.
- [x] The engraving is created under `hero.root` and takes the mount; `engraving.origin` is overwritten with
  `runeOrigin`; both get the same input; the engraving is disposed first.
- [x] `setEnvironment` reaches the hero through `forge/scene.ts` from the kingdom's hour.
- [x] The casting starts at y 1.6, sparks at anvil + 1.6 and the refusal mood at anvil + 1.43, all over the face.
- [x] `packages/forge/src/assembly.ts` takes `createAnvilHeroDragon` for `sleeping-dragon` only; moon, owl and
  ornaments are untouched. The SVG and the engraving, motif and emitter folders are unchanged from `main`.

Still open, all in main's files:

- [ ] **Composed finishes miss the body.** `assembleForge` recolours `kit.family==='grove' ? moss : native.roof`
  plus brass and goldLeaf. This dragon's back is never the roof, so today a copper hearth dragon is still
  brick (only its 16 terracotta plate boxes turn copper), a copper tide dragon turns its slate plates *and its
  chimney lip* copper, and a copper grove dragon loses its goldLeaf horns. For the sleeping dragon, use
  `new Set([ANVIL_HERO_DRAGON_SURFACE[kit.family]])`. Ceramic tide/grove dragons then match their cream belly
  band, which flattens the band; a darker glaze would keep it.
- [ ] **Accent inlays land anywhere.** The accent takes the first 24 boxes in array order. This dragon's boxes
  are merged, so their order says nothing about where they are: inlays can fall on the stack or the horns.
  Filter to boxes of `ANVIL_HERO_DRAGON_SURFACE[kit.family]` first.
- [ ] **The ritual's heat curve hides the flow.** `ritual-view.ts` steps heat from 0.2 to 1 at t = 3 s (and holds 1
  whenever `shaping` is set), so all
  19 runes ignite in one frame and pour already sits at strike brightness. Ramp 0.2 → 0.85 over about 1.2 s
  from t = 3 (the runes then ignite outward from the mark), hold 0.85 through the pour, give 1.0 for 0.15 s at
  the strike (t 12.2 s), then cool. The brief asks for 5 s of cooling; the code takes 2.8 s.
- [ ] **The plate glows as a badge at pour** (from AH02). The engraving's own shader warms its whole plate
  (`uHeat*(.16+edge*.55)`), so a brown square shows round the mark. Keep that heat inside the cut.
- [ ] **Hearth dragons face the lane** (from AH03). Hearth chimney sockets sit on the rear slope, so the street
  never sees that dragon.
- [ ] **The dragon has no motion seam** (from AH03): breath on a 4.5 s cycle with a 1.5% rib swell, a tail
  twitch every ~20 s, a warm lid slit and a triple puff at the strike.
- [ ] **Decide the dragon off the chimney.** Composed plans allow `sleeping-dragon` on a lantern or weathervane.
  This dragon is a chimney with an open flue, and a weathervane mirrors it so the wing swaps flanks. Restrict
  it to chimneys, or accept that.

## Doubts

- Near-black iron, the worn sheen and the cut glow need a real GPU against lit cobbles. Please open the bench at
  `anvil-close`, `anvil-square` and `anvil-close&heat=0.85&time=1.3` at 1440×900 and 390×844 and look at the cold
  body against the paving and whether the hot runes read without a halo; measure frame time there.
- Cold runes are crisp up close but a fine dark row from the square; the 45° foot flare still shows voxel
  terraces up close; faint vertical shading seams cross the cheek at 5 m.
- The dragons are small at 24 m: tide reads as a creature, grove only as a lump. AH04 is refining both.
