# @chatdom/emotes

The channel's emotes, carved into its kingdom (Spec 24). This package turns one decoded emote into
checked voxel geometry for a purpose (plaza statue, heraldry charge, Forge motif, spectacle effect)
in the kingdom's own palette, and lays out the surfaces that carry it.

## Compiler (`compileEmote`)

`compileEmote(input, registry, allowedMaterialIds, profile)` is pure and deterministic. The same
source bytes, palette subset, palette revision, profile and `EMOTE_COMPILER_VERSION` always produce the
same `geometryHash` and `revision`. Failures are typed results (`invalid-source`, `over-budget`, `empty`,
`unsupported-aspect`, `invalid-palette`, `invalid-profile`) and are never thrown.

**Budgets before pixels.** Canvas size (512×512), frame count (120), coalesced RGBA bytes (32 MiB),
playback (30 s) and frame/canvas agreement are checked before any per-pixel work happens.

**Palette.** The kingdom passes an explicit, non-empty subset of the real material registry (at most 64
solid materials, with no air and no repeats). Each source pixel snaps to the nearest entry by integer
redmean distance; equal distances go to the lower material ID. No new material ID, emissive value or
source colour enters the world.

**Alpha and resampling.**
- One crop covers the union of every frame's pixels above alpha 16, so all frames share one origin.
- The crop is fitted to the profile's target height without stretching, and the width follows the
  aspect ratio. A source too wide for the purpose is fitted by width instead, and refused if it then
  stands too short.
- Each grid cell takes area-weighted alpha coverage, and a cell is solid at half coverage or more.
  Occupancy comes from alpha alone: opaque black is solid outline, and transparent black is air.
- The cell's material is the snapped colour with the most alpha-weighted area. An anti-aliasing
  interpolant gets only a damped vote: a pixel lying between two strongly different opposite
  neighbours on any axis. This keeps outlines and eyes crisp, and the cell never averages into an
  in-between colour.
- The sampler asks again (at most twice) when thin anti-aliased rims leave the occupied height under
  the target.

**Speckle.** A lone cell, with no 4-neighbour of its own material, is cleaned to the majority of its
eight neighbours in two cases:
- the snapped colours are within redmean distance 90 of each other;
- its material appears in at most 2 cells of the frame and lies within distance 150 of its
  surroundings.

A lone cell that strongly contrasts with its surroundings, such as a pupil, a stud or a highlight,
always stays.

**Extrusion.** The front face is +Z and Y is up, so the source reads the right way round to a viewer
in front. Depth is 2–6 build cells, depending on the purpose. From 3 cells deep, every silhouette
cell, including the rims of holes, loses its front and back layer. This one-cell bevel softens the
contour without changing the front outline. Holes stay open through the whole depth. Boxes are greedy
and deterministic, and every frame is checked against `VoxelBlueprintSchema` and the per-frame and
whole-animation box, cell and byte budgets.

**Frame timing.** Any delay that is missing, not finite or under 20 ms plays for 100 ms. Delays over
10 s are held at 10 s. The same rule applies in review and at runtime. A single-frame emote is static,
with a duration and period of 0.

| Purpose | Occupied height (cells) | Depth | Max width |
|---|---|---|---|
| statue | 32–48 (4–6 m), default 40 | 2–6, default 6 | 96 |
| heraldry | 14–24, default 20 | 2–3 | 40 |
| motif | 10–16, default 14 | 2–3 | 24 |
| effect | 12–24, default 16 | 2–4 | 40 |

## Surfaces

- `layoutEmoteStatue(frames, materials, id)` builds a stepped plinth (footing, course, body with a
  recessed plate, overhanging cap) sized to the common frame bounds, with a 1 m walking clearance.
  `composeStatueFrame(layout, frame, id)` returns one frame standing on that plinth as a single
  blueprint, so the mesher's AO darkens the joint where the sculpture meets the cap. Hosts cache one
  composite per approved revision and frame.
- `layoutEmoteBanner(mask, materials, id)` builds a plaza banner: stone foot, pole, crossbar, finial
  and a trimmed swallow-tailed cloth. The cloth hangs from 2.25 m, above head height. The heraldry
  charge is inlaid in the cloth and stands one cell proud. This is a bench and preview composition;
  the checked heraldry factory for crest and banner owners comes with the resolvers.

## Fixtures

`toadWaveFixture()` is **SIMULATED**: original art drawn for this module, not any channel's emote. It is
deliberately asymmetric: open eye on the viewer's left, wink and tilted crown on the right, and a
waving arm that leaves a gap. It is painted from signed distances using only correctly rounded
arithmetic, so its raster and hash match on every engine. Its `sourceHash` hashes the canonical
RGBA because there are no fetched bytes.

## Workspace link

`src/deps.ts` reaches `@chatdom/shared` through the sibling source until main registers this package
in the workspace lockfile. Main replaces that one line with the package specifier.
