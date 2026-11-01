# Forge ritual presentation

`createForgePresentation({ root, anvil, landing, piece })` draws the Forge ritual around a host-owned
**presentation clone** and returns `{ update(frame | null), dispose() }` (spec 17). It renders exactly the
supplied `ForgeRitualFrame`: the phase and `phaseProgress` choose the pose, and `elapsed` only drives calm,
bounded idle motion while a phase is held. It never advances a phase, attaches the part, edits the home or
enables permanent emitters. Seeking is a pure redraw: any sampling interval gives the same picture.

## Finished stages

- **Words (0–3 s).** Seven to eleven runes from the Forge alphabet (`runes.ts`, sixteen authored staves) lift
  off the anvil's rim, circle it trailing embers and converge on evenly spread points of the real part. The
  ritual id picks the runes; the words, plan and maker never reach this layer, and no rune is a letter.
- **Blueprint (3–5 s).** The runes snap into the part's own silhouette, traced once from the clone's real
  geometry (`silhouette.ts`; it decodes the production packed voxel corners). The blueprint arrives cell by
  cell outward from where each rune landed: a cool, translucent body ruled at every build cell, then a pale
  inked contour drawn bottom to top, and a single soft lock pulse. Freshly arrived cells flash warm before they
  cool, so the warm words visibly become the cool drawing.
- **Held blueprint.** A gate that keeps reporting the finished blueprint gets a slow breathing glow (±5.5 %,
  6.5 s period) and a few motes rising around the drawing. It does not brighten, stamp, strike or move on.
- **Pour (5–11 s).** A small iron crucible with a brass rim and bail arrives above the part, tips, and pours a
  chain of molten cubes onto its centre. The metal fills the drawing layer by layer, spreading outward from the
  stream (`cells.ts`: the blueprint and the molten shell make the same per-cell decision, so no cell is ever
  both). The newest layer is white-gold, older layers deepen to orange and skin over along their seams; embers
  spit where the stream lands. The contour lets go as the last layer arrives; the crucible rights and leaves.
- **Seal (11–12.2 s).** A warm bead of wax, then the press: the medallion slams in, settles, and shows the
  Forge's mark (an anvil and a spark, drawn as a height field so it reads as pressed wax). A parchment ribbon
  unrolls beneath. It reads “Fit for this home”; only a `live` frame at `seal` or later
  reads “Fit for the realm”. Both lines are lettered once at construction. Meanwhile the hammer rises and winds
  up; a seal held by a pending gate waits with the hammer raised and never strikes.
- **Strike (12.2–12.7 s).** The hammer and crucible are sized to the part (up to 1.8× for a tall chimney), so
  the strike reads as a smith's blow rather than a tack hammer. The downswing accelerates into one impact at 34 % of the stage, then a small recoil
  and a settle. The metal squashes 5 % about its planted foot, a white bloom spreads from the impact through
  nearby cells, with a small local highlight (a warm core plus one broad, faint shock ring, never full screen) and a seeded spark burst
  under gravity.
- **Cool (12.7–15.5 s).** The real clone takes the anvil in its socket orientation. The heat lies over it on
  the same traced surface and gives way cell by cell, nearest the impact first: faces lose their glow, seams
  hold it a moment longer, and the kingdom's own colours show through. Steam rises, a few cooling ticks
  glint, the hammer lifts away and the seal fades.
- **Flight (15.5–19 s).** A crouch, straight up, one arc over (with a single turn and a slight bank), and
  straight down onto the socket. The arc accelerates into the socket so the arrival has weight: contact at
  90 % of the stage, a 6 % planted squash with no rebound, a dust ring and a warm snap at the foot. A short warm
  trail marks the path. The final pose is the clone's own saved transform, exactly.
- **Landed (19–21 s).** The clone sits flush on its socket while the dust settles. Attachment and any
  permanent emitter remain main's.

## Ownership

- The clone is posed, never reparented. Its transform and visibility are saved at construction and restored
  on `update(null)` and `dispose()`. Its geometry and materials are read, never changed, swapped or disposed:
  molten metal, heat and the reduced-motion light are drawn by the adapter's own shell over the same traced
  surface, so no material needs cloning. It is hidden until it cools on the anvil; from then on it is posed
  at the anvil, along the arc, or at its saved socket transform. Construction throws if `landing` is not the
  clone's world origin (1 cm tolerance).
- The adapter mounts ten objects under `root` (identity world transform) and disposes only those, including
  the seal's lettering texture. Every owned value is rewritten on every frame, so hidden props never carry an
  earlier pose and any sampling interval or seek draws the same picture.
- An untrustworthy frame (non-finite progress or time, unknown phase or source, empty id) is ignored and the
  last valid pose holds; `null` clears every effect.
- `prefers-reduced-motion: reduce` is followed live (the listener is detached on dispose): runes surface in
  place without circling, the blueprint dissolves in evenly without snap motes, pulse or breathing. The pour
  stream stands still and spits no embers, the seal fades in without a press, the hammer appears at rest on
  the metal with no swing, bloom or sparks, and the flight becomes a dissolve: the cooled part turns to cool
  light cell by cell on the anvil and settles out of light at home. No streak, flash, squash or trail. Timing
  and stages are unchanged.

## Budget (per adapter; main may run one per active anvil)

| | Desktop / stream | Phone (`max-width: 640px` or coarse pointer) |
|---|---|---|
| Owned draws | 11 (runes, blueprint body and ink, shell, crucible, stream, hammer, seal, flash, sparks, dust) | 11 |
| Most drawn at once (tested) | ≤ 12 | ≤ 8 |
| Transient particles (square motes) | sparks ≤ 150 + dust ≤ 36 = 186 | sparks ≤ 60 + dust ≤ 18 = 78 |
| Lights | 0 | 0 |

The blueprint copies the traced part surface once (two owned geometries); the molten shell draws the same
geometry. Rune quads, the stream's 26 instanced cubes and both mote buffers are fixed-size and rewritten in
place; props are merged, vertex-coloured toy meshes with a baked warm key (the kingdom's voxel lighting does not
light ordinary meshes). Nothing allocates, letters a canvas or recompiles a shader per frame. Scene exposure,
fog and bloom are untouched. The test samples all 21 s at 30 fps on both budgets.

Main's `emitters/` stays host-driven: it mounts on the kingdom scene and owns the permanent landed smoke and
glow. The ritual's transient sparks live here so that every one is seekable from the frame alone.

## Integration call pattern

```ts
const presentation = createForgePresentation({
  root: effectsGroup,              // identity world transform, owned by the host
  anvil: [x, workSurfaceY, z],     // top centre of the anvil's iron face
  landing: clone.position.toArray(),
  piece: clone,                    // presentation clone at its final socket transform, never the placed part
});
presentation.update(frame);        // every rendered frame, or null to clear
presentation.dispose();
```

## Bench and checks

- Bench: `/-/forge-ritual?part=chimney|lantern|weathervane&family=hearth|tide|grove&hour=19.5&t=12.4&gate=12.2&motion=reduce`
  (`apps/web/src/forge-ritual-bench`). It forges a real part with main's grammar, assembly, checks and worker
  mesher, stands it on main's anvil beside a native home, runs the whole 21 s ceremony, follows the flight side on
  to the roof with a bench-only camera (a cut, not a sweep, with reduced motion); the bench previews presentation only. `gate` holds the reported stage while
  time passes, as a pending live gate would; a gate on a stage boundary holds the finished earlier stage.
- Test: `pnpm exec vitest run apps/web/src/forge/presentation`.
- Capture (holds the shared host capture lock; after `pnpm build`): `node apps/web/src/forge-ritual-bench/capture.mjs`.
  `--at 8,12.4 [--size 390x844]` shoots only those seconds into `/tmp/chatdom-forge-ritual` for quick review.
