# Spec 25: the anvil and the sleeping dragon

Status: **frozen by main, 2026-10-30.** The handoff commit freezes the lane-local factory and mount APIs below.
Vision: `chatdom/ChatDom.md` principles 10–11, 16–18; `chatdom/Moments.md` §§3, 10;
`chatdom/Artstyle-Soul-Feel.md` §§6, 9; `chatdom/Quality.md` rules 5, 8–11, 17.

## What and why

Make the Forge a place a smith would recognise and a citizen would remember. Its hero is a heavy iron anvil on a
worn stone block: a long tapered horn, a real hardy hole, bruised edges and runes cut into the metal. The official
Codex mark is engraved into the facing, its exact silhouette held quietly in iron and heat. Across the square it
still reads as an anvil; close up its tool marks reward looking. The dragon chimney is equally specific: a sleeping
dragon curled around a stack, chin resting on paws, wings folded, with smoke escaping its nose. This lane owns that
physical craft. Main is finishing real chat → real Codex → judges → the right home, then stops Forge work; the team
owns the remaining look. A beautiful fixture is art evidence, never evidence that a real forge succeeded.

## Current state

- `apps/web/src/forge/ritual-view.ts:createForgeRitualView` draws the current pedestal and box/cone anvil. Its
  piece starts at local y=1.6; words currently lift from `engraving.origin`. Main replaces only the physical stage
  with this lane's factory, keeping ritual authority, piece reveal, hammer timing and flight in their existing owners.
- `apps/web/src/forge/engraving/index.ts:createCodexEngraving(parent)` returns `root`, `origin`,
  `update({time,heat,shaping})` and `dispose()`. It already cuts the unmodified SVG, including the cloud counter and
  terminal paths. Its initial transform and returned origin assume the old octagonal hearth. Main remounts it using
  the contract below; do not edit or replace its source SVG.
- `packages/content/src/forge-motifs/index.ts` exports `MotifGeometry = {size, boxes, mount, emitter}` and the
  sleeping dragon's existing build-cell envelope `[24,16,18]`, mount `[12,0,9]`, emitter `[0,2,9]`. Main chooses
  this lane's replacement for that one motif. Existing moon/owl and motif-lane folders stay read-only.
- `apps/web/src/forge/emitters` already renders seekable anvil sparks and landed smoke/glow from supplied world
  anchors. Spec 17 owns transient ritual presentation/audio; spec 18 owns refusal presentation. Neither is this lane.
- Specs 09, 17 and 18, `packages/content/README.md` and the reference notes below are inputs. No new shared
  protocol, authorisation path, material registry or Forge grammar is needed.

## Rules

1. **R1 — A real anvil first.** Sculpt a continuous iron body with a broad flat working face, pronounced waist,
   supported feet, tapering horn and square hardy hole visibly open through the heel. Model the hole as negative
   space with inner walls, not a black decal. The horn joins the body without a cone seam. A heavy stone block
   beneath carries its weight; bevels, a few struck edges and deliberate worn corners carry craft without noise.
   Keep the complete physical stage inside the old 1.5 m horizontal radius, on y=0, with work surface y=1.43 m
   and no solid above y=1.50 m. This preserves the caller's y=1.6 casting clearance. If beauty needs another
   envelope, report `needs:` with a drawing/shot before changing it; do not silently move the casting or camera.
2. **R2 — Cut light, not stuck-on decoration.** Authored runes have recessed walls and a restrained warm cut bed;
   cold iron remains readable when heat is zero. Wear catches cooler edge light, stone stays matte, and hot cuts
   keep colour rather than turning white. Use existing kingdom material ramps. The current scene uses a custom
   voxel light shader, so verify hero shading with the actual renderer; default lit Three materials in an unlit
   scene are not a solution. No global exposure, fog, bloom or presence-light changes to rescue the asset.
3. **R3 — The official mark stays exact.** Read only `apps/web/src/forge/engraving/codex.svg`. Preserve its paths,
   counters, proportions, orientation and spacing, including `>_`. Only uniform scale and whole-mark placement
   are allowed; no redrawing, simplification, voxel tracing, added strokes, replacement terminal or distorted
   projection. Existing metal/cut materials may be used unchanged; request a main integration change if their
   treatment needs adjustment. The mark sits on a genuine facing of the iron body, without floating, covering
   the hardy hole or becoming the silhouette of the entire Forge. Only iron and restrained glow treatments.
4. **R4 — An asleep dragon from the street.** The curve of the body and tail encloses the chimney; a low long
   muzzle rests on two readable paws; closed lids and folded wings say sleep. Distinguish head, neck, haunches,
   wing fold and tapering tail by big planes and useful air gaps. Avoid an upright creature, a pile of lumps or
   wings that read as a second chimney. Keep the actual nose/flue opening and the existing emitter immediately
   outside it. The stack remains structurally plausible, with a visible mouth. Hearth, Tide and Grove keep
   their registered materials and native crest/wing treatment; each is lovely in greyscale as well as colour.
   This is a carved house part, never a new living creature or a fake citizen.
5. **R5 — Beauty survives the real framing.** Close views show the horn, hardy hole, cut depth and mark. Square
   views keep roofs, cobbles and dusk depth in frame; the dragon rests on a real roof and the anvil on the street.
   Use a fixed perspective street camera at least 12 m horizontally from each subject, with no telephoto crop
   disguised as distance. Shape and contrast must read at 390 px. Reuse the main dusk grade, real production
   mesher/material and current smoke emitter. Fixture heat, smoke and occupied windows are visibly SIMULATED.
6. **R6 — Own the object, not another effects engine.** A seekable local heat treatment may animate the hero's
   recessed runes from the existing input below. No clocks, timers, accumulated particles, scene-wide changes,
   permanent chimney-emitter replacement or per-frame geometry/material creation. Reuse current emitters in the
   bench. All owned GPU resources/listeners are disposed; caller-owned engraving, materials and meshes survive.
   Existing content/Forge limits still apply. Report real costs; invent no new invisible proof budgets or numeric
   beauty score. Screenshots looked at are the art acceptance.

## Contracts

These are **lane-local caller APIs**, frozen by main's handoff commit; no `packages/shared` edits.

`apps/web/src/forge/anvil-hero/index.ts` exports:

```ts
export function createAnvilHero(parent: THREE.Object3D): {
  root: THREE.Group;
  engravingMount: {
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: number;
  };
  runeOrigin: THREE.Vector3;
  update(input: {time: number; heat: number; shaping: boolean}): void;
  dispose(): void;
};
```

The factory adds its identity-transform `root` to `parent`; all dimensions are metres, +Y up, horn toward +X,
principal engraved face toward +Z. Mount position/rotation are **local to hero.root**, and scale is a positive
uniform multiplier for the existing engraving root. `runeOrigin` is a point in the same local coordinates,
immediately outside the centre of the mark's hot cut, after that transform. Main creates the existing engraving
under `hero.root`, **overwrites** its hard-coded position/rotation/scale from `engravingMount` (copy the Euler,
including its order), and uses `hero.root.localToWorld(hero.runeOrigin.clone())` when world coordinates are needed.
For ritual-local rune positions main converts that point back into its own root. The old `engraving.origin` is
stale after remounting and must not be used. Main feeds the same `{time,heat,shaping}` to both update methods.
`heat` is clamped 0–1; time is caller seconds and may seek backwards. Main disposes engraving separately before
disposing the hero. The hero does not import, mount, dispose or rewrite engraving itself.

`packages/content/src/anvil-hero/index.ts` exports:

```ts
export function createAnvilHeroDragon(style: StyleKey): MotifGeometry;
```

Import `StyleKey` from existing materials and `MotifGeometry` from existing `forge-motifs`; return the same ordered
half-open integer boxes on the 0.125 m lattice, exact size/mount/emitter listed above, deterministic in each kit.
Only registered materials; no render import in content. Preserve actual air at the nose emitter and connected
support to the mount after ordered air cuts. Main owns the package export/assembler selection; the lane bench
may import the new module directly by relative source path before integration.

Provide `apps/web/src/forge/anvil-hero/bench/index.html` and its owned entry as a standalone Vite HTML bench,
available from the existing web dev server at `/src/forge/anvil-hero/bench/index.html`. No root route edit is
required. Params: `view=anvil-close|anvil-square|dragon-close|dragon-square`,
`style=hearth|tide|grove`, `hour=0..23`, `heat=0..1`, `time=<seconds>`; defaults anvil-close/hearth/19/0/0.
Reject invalid values visibly. The bench composes the actual factories, unchanged official engraving, real
production voxel renderer and existing emitters. Label it **SIMULATED · ART BENCH**; no fake forge approval,
chat, owner or stored placement. Reuse existing authored house/street content as read-only context, no competing
home generator. Publish `window.__chatdomReady` after asset workers, shader compilation and a finished GPU frame;
captures fail on console/page/shader errors. Keep controls outside the object framing.

## Scope

Write only `packages/content/src/anvil-hero/**`, `apps/web/src/forge/anvil-hero/**`, this spec and
`work/lanes/anvil-hero/{PRD.md,progress.txt}`. Owned folders include tests, bench, capture script and concise README.
Ignored outputs: `shots/anvil-hero/**`, `/tmp/chatdom-anvil-hero/**`.
Everything else is read-only, especially engraving and its SVG, `forge-motifs`, `forge-ornaments`, `emitters`,
ritual/refusal presentation, renderer, shared contracts, package exports, routing, root manifests and runtime.
You are not alone; preserve others' work. If splitting artisans, one owns the new content folder and one the new
web folder, with a single owner for the bench. Sub-agents never run git. The lane worker commits local lane tasks;
main creates the worktree, owns integration and never delegates runtime edits into this art scope.

## Acceptance

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run packages/content/src/anvil-hero apps/web/src/forge/anvil-hero
pnpm build
node apps/web/src/forge/anvil-hero/capture.mjs
```

Implement that scoped capture script in task AH01. It may own a temporary Vite server on an unused 5170–5199
port, or reuse `--base-url`; record the port and stop only the process it created. Acquire the existing machine-wide capture lock before browser/server startup; run captures serially and release
it after both close. Capture with Chrome/SwiftShader following `$look`. No root script edits. Focus tests on real risks: final dragon occupancy/bounds/palette/support
and open nose anchor across all kits; hero mount/rune origin alignment and disposal that leaves caller resources
alive. Do not mirror geometry implementation with hundreds of coordinate assertions.

At hour 19 save the four named views at **1440×900 and 390×844**, for eight primary shots. Add one heated anvil
close view and compare a crop with the untransformed official SVG. Judge all three dragon kits in three-angle
contact sheets through the existing content renderer; use these to avoid another full browser matrix. Reuse one
loaded scene for each viewpoint and size, and capture only changed views on subsequent passes. Main separately
checks source SVG unchanged during merge. Open every required shot/sheet using `view_image`; inspect the actual
pixels, fix weak silhouettes, and record what changed and what still looks weak in the owned README/progress.
Main then mounts the exports into the kingdom, checks real dusk close/street framing and runs `pnpm verify`.
Standalone shots do not certify that integrated framing or live chat works. Real-GPU light/performance doubts go
in the evidence block; SwiftShader timings do not count as device performance.

## Quality bar

An unmistakable smith's anvil, lovely in cold iron and glowing only in its cuts. The exact Codex mark reads as
something engraved by a craftsperson. The dragon's sleeping gesture is readable before any detail is explained.
Contact shadows, cool dusk depth and warm restrained heat connect both objects to the same handmade kingdom.
No generic plinth, white halo, busy surface noise, decorative hole decal or crop that conceals a failed silhouette.

## References

- `work/references/prototypes.md`: Lanternmere's cause-to-result framing, reimplemented here.
- `work/references/voxel-meshing-light.md`: real occupancy, AO and production material; detail is not random voxels.
- `work/references/sky-fog-time.md`: preserve main's warm subject/cool dusk depth, no new environment pipeline.
- Specs 09/17/18 and existing engraving/emitter READMEs: reuse authored content and local interfaces; respect owners.
  This is an original art pass on studied tools, not a new renderer research lane or imported model.

## Not now

No real-chat/Codex/judge changes, new grammar, economy, coals, publish/placement authority, director policy,
transient ritual effects, audio, refusal logic, generated images, package registry changes or deployment.

## Decisions

- **2026-10-30 — Team owns the remaining Forge look.** Main lands the real end-to-end path and stops Forge;
  this lane supplies reviewable art exports. Main's only follow-up here is mount/selection integration and review.
- **2026-10-30 — Disjoint replacement.** New folders own physical anvil craft and the sleeping-dragon replacement;
  existing motif, effects and engraving folders remain untouched. Exact publisher SVG shape is non-negotiable.
- **2026-10-30 — Local mount seam.** Main remounts the existing engraving using the returned transform and uses
  the new rune origin. No shared protocol is required; an actual missing contract is reported as `needs:`.
