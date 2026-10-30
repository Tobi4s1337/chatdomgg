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
- **Later stages** (pour onward) are not presented yet; they hold the locked blueprint so nothing implies a
  seal, a strike or an arrival.

## Ownership

- The clone is posed, never reparented. Its transform and visibility are saved at construction and restored
  on `update(null)` and `dispose()`. Its geometry and materials are read, never changed or disposed. While
  words and blueprint play it is hidden, since the metal has not been poured.
- The adapter mounts three objects under `root` (identity world transform) and disposes only those.
- An untrustworthy frame (non-finite progress or time, unknown phase or source, empty id) is ignored and the
  last valid pose holds; `null` clears every effect.
- `prefers-reduced-motion: reduce` is followed live (the listener is detached on dispose): runes surface in
  place without circling, the blueprint dissolves in evenly without snap motes, pulse or breathing. Timing
  and stages are unchanged.

## Budget (per adapter; main may run one per active anvil)

| | Desktop / stream | Phone (`max-width: 640px` or coarse pointer) |
|---|---|---|
| Additional draws | 4 (runes, blueprint body, blueprint ink, motes) | 4 |
| Transient particles (square motes) | ≤ 56 | ≤ 24 |
| Lights | 0 | 0 |

The blueprint copies the traced part surface once (two owned geometries); rune stroke quads and the mote
buffer are fixed-size and rewritten in place. Nothing allocates, builds text canvases or recompiles shaders
per frame. Scene exposure, fog and bloom are untouched.

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

- Bench: `/-/forge-ritual?part=chimney|lantern|weathervane&family=hearth|tide|grove&hour=19.5&t=4.2&gate=3.6&motion=reduce`
  (`apps/web/src/forge-ritual-bench`). It forges a real part with main's grammar, assembly, checks and worker
  mesher, stands it on main's anvil beside a native home, and labels everything SIMULATED.
- Test: `pnpm exec vitest run apps/web/src/forge/presentation`.
- Capture (holds the shared host capture lock; after `pnpm build`): `node apps/web/src/forge-ritual-bench/capture.mjs`.
