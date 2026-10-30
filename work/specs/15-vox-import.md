# Spec 15: Bring a MagicaVoxel object into your home

Status: **frozen 2026-10-30; launch-ready after main commits the handoff and package scaffold.** The actual
build bridge exists; main supplies package/dependency metadata, and the lane creates its implementation entry.

Vision: `chatdom/ChatDom.md` principles 11, 15–18; `chatdom/Moments.md` §14;
`chatdom/Artstyle-Soul-Feel.md` §§6.3, 11; `chatdom/Safety.md` §3.1 and Decided.

## What and why

A dedicated builder can bring an actual MagicaVoxel object into their own private home draft. They choose a
file, see its real geometry in the kingdom's materials, resize it and move it onto their plot. The preview
makes the result and any replacement of existing blocks plain. One press adds it, one undo removes it, and
every imported block remains editable with ordinary build tools. Import grants neither publication nor a
judgment pass. A published home continues through exactly the same returning-citizen, support, escape and
composed-result checks as hand building. A malformed file leaves the current home untouched and says what
the builder can do next.

## Current state

- `packages/shared/src/voxel.ts` defines integer cells, +Y up, the 0.125 m build lattice, material zero as air,
  `VoxelBlueprintSchema`, a 20,000-box source cap, 1..256 dimensions and the padded allocation budget.
- `packages/content/src/materials.ts` supplies the actual material registry and style kits. Its complete
  registry also contains avatar colours; those are not automatically valid home materials.
- `packages/shared/src/build.ts` and `packages/world/src/build/index.ts` provide the actual policy/draft APIs.
  `apps/web/src/build/session.ts:BuildImportBridge` provides the actual preview/change callbacks;
  `apps/web/src/build/Surface.tsx` optionally mounts the lane's default component with those props.
  The real consumer URL is `/?tier=hamlet&hour=19.5&build=1&source=simulated`. Do not invent draft persistence,
  authority, a second editor or a parallel publish path.
- There is no `.vox` parser in this repository. The older prototypes are design context, not code to copy.

## Rules

1. **R1 — Actual bytes.** Read the selected browser `File` as bytes after checking its size; extension and MIME
   are hints only. Parse `VOX ` and supported versions 150/200 using explicit little-endian reads. Require one
   well-bounded `MAIN` root and matched `SIZE`/`XYZI` records. Honour declared content and child lengths at every
   boundary, including unknown chunks; no read or typed-array view may escape its chunk/file. Reject missing,
   duplicate or misordered required records, truncated headers/payloads, invalid dimensions, invalid palette
   indices, out-of-bounds coordinates and contradictory `PACK` counts. Empty objects are a useful error.
   Duplicate cell records are rejected rather than making file order a hidden paint operation.
2. **R2 — Bounded work before allocation.** Export lane-local `VOX_IMPORT_LIMITS`: 8 MiB file bytes, 8,192 chunks,
   16 nesting levels, 256 model records, and 1,048,576 total source voxel records. Each source dimension is
   1..256. Check counts and `4 + count * 4` against payload bytes before iterating or allocating. The same
   parser checks apply outside the browser. Preview construction must check destination dimensions, padded
   allocation, occupied-cell count and source-box count before large expansion. Draft policy and the existing
   shared caps can only tighten these limits. Exceeding a cap reports the cap and a useful remedy, without
   clipping, partial insertion, silent dropping or a success toast.
3. **R3 — Honest object selection.** A file may contain several `SIZE`/`XYZI` objects. Present every object in
   stored model order with its dimensions and cell count; the builder explicitly chooses one. A single-object
   file chooses that object automatically. This tool imports an object's local geometry. If scene graph or
   animation chunks (including legacy `PACK`) exist, say so before confirmation: scene placement, instances and animation are not being
   imported. Never silently call the first object a whole scene. Known rendering/material/camera chunks may
   be skipped within bounds; unsupported `IMAP` palette remapping fails with a clear request to export with a
   standard palette. Unknown chunks are skipped safely, with the bounded parser remaining authoritative.
4. **R4 — Palette and orientation are real.** Decode `RGBA` bytes correctly: source index 1 uses the first
   supplied colour; source index 0 is not an occupied colour. Consume all 256 RGBA records without mapping the
   last entry onto air. When `RGBA` is absent use MagicaVoxel's documented default palette, with attribution;
   that table already contains index 0 and must not be shifted again. Apply one file-wide palette to all models. Preserve black occupied
   voxels. Convert source Z-up cell `(x,y,z)` to `(x,z,sizeY-1-y)`, then subtract occupied minimum bounds. Show
   source and resulting dimensions. An asymmetric reference object must visibly stand upright and retain its
   handedness. Snap RGB colours deterministically to the draft policy's allowed non-air registry materials;
   use squared OKLab distance with material-ID tie breaking. No raw source RGB or source palette ordinal may
   become a kingdom material ID. Unknown/empty allowed palettes fail. Imported alpha, emit, glass and other
   physical material properties do not create rendering powers: imported cells use the chosen kingdom
   material. When present, explain that source material effects are replaced by kingdom materials.
5. **R5 — Exact transform preview.** Supply scale choices ¼, ½, 1, 2 and 4, plus integer XYZ placement controls
   and a ground-placement action. One source cell at scale 1 is one 0.125 m build cell. Enlargement replicates
   occupied cells; reduction groups by floor-divided normalized coordinates and chooses the most frequent
   snapped material among occupied contributors, with lowest material ID breaking ties. Report reduced detail
   when shrinking. Do not mutate the parsed source between transforms. Preview and insertion use the same
   transformed `VoxelBlueprint`, with deterministically coalesced boxes, `lattice: 'build'`, the draft's
   `styleId`, and no imported windows. Readable swatches show the actual resulting kingdom materials. Preview
   the bounding volume on the real plot using the existing mesh/material path, with an obvious invalid state
   when it leaves the plot or exceeds a budget. Show resulting cells, dimensions, remaining plot budget, and
   the area that insertion replaces; occupied source cells alone must not disguise the cleared empty space.
   Bounds include the policy's half-open `editableFrom`/`editableTo`, not just the reserved `size`.
6. **R6 — One private edit.** Confirmation calls `BuildDraft.insertBlueprint(blueprint, origin)` once. Its
   bounding-box replacement, palette/bounds/voxel checks and history transaction remain core-owned. Re-read
   current draft policy and revision at confirmation; a stale or invalid preview cannot commit cached
   permission. A failed insert leaves the draft and its history intact. Cancellation, another file, a closed
   tool or disposal removes preview resources. File and transform changes invalidate older asynchronous
   parse/mesh responses. Confirm only reports success after the controller accepts the edit. The ordinary
   tools can paint/erase/fill the imported cells; undo and redo treat the complete import as one edit.
7. **R7 — Publication stays composed and private.** The preview has no public-world, stream or network upload
   side effect. Raw filenames and file metadata are displayed as escaped local text only, never trusted
   content names, ownership or provenance claims. No client moderation pass, fake authority or "safe" badge.
   Imported builds go through the same core publication candidate and checks as every free-voxel draft; a
   held/unavailable review keeps the last approved home live. A disconnected reviewer is visibly unavailable.

## Contracts

**Landed main-owned APIs:**

- `BuildDraftPolicy` and `BuildDraftSnapshot` come from `@chatdom/shared`. Policy fields are `plotId`,
  `ownerId`, `styleId`, `size`, `editableFrom`, `editableTo`, `maxVoxels`, `palette` and `shaping`.
- `BuildDraft` and `BuildError` come from `@chatdom/world`. The real draft has readonly `policy`, `revision`,
  `voxelCount`, `canUndo`, `canRedo`; `insertBlueprint(blueprint: VoxelBlueprint, origin: Vec3): BuildChange`;
  `apply(operationOrBatch)`, `undo()`, `redo()`, `get(cell)`, `serialize()` and `cloneVoxels()`. `BuildChange`
  contains `revision`, `changed` and `voxelCount`. A zero `changed` result means no new edit/history entry.
  Insertion replaces its whole region, including air, and rejects before source mutation. No source anchors
  are retained; ordinary glass components derive windows during `compile()`. Imports author no windows.
- Import `BuildImportBridge` as a **type** from `../build/session` in the lane's browser entry. The actual
  interface is `{ draft: BuildDraft; onPreview(blueprint: VoxelBlueprint | null, origin: Vec3): void;
  onChanged(): void }`. Export a **default Solid component** accepting those exact props from
  `apps/web/src/vox-import/index.tsx`; `build/Surface.tsx` mounts it automatically in SIMULATED mode.
- `onPreview(blueprint, origin)` validates/meshes the exact replacement in a cloned draft through the real
  worker and shows its bounds. It returns no validation receipt; the lane computes a summary using a fresh
  `BuildDraft(draft.policy, draft.serialize())` and its real insertion for its own UI. Preview rejection/status
  stays main-owned. Never commit merely because a preview callback returned.
- At explicit confirmation re-read `draft.revision`/`draft.policy`, end an outstanding gesture with
  `draft.endGesture()`, call `draft.insertBlueprint(...)` once and, only for `changed > 0`, call `onChanged()`
  once to save/remesh/update core controls. Report no-op selection truthfully. On cancel/unmount clear the
  main-owned preview with `onPreview(null, [0, 0, 0])`; guard stale browser file-read completions. Do not dispose
  main's pool, scene or draft. The core discards stale preview jobs after revision/preview changes.
- Existing `VoxelBlueprint`, `VoxelBlueprintSchema`, `VOXEL_METRES`, `MAX_ASSET_PADDED_CELLS`, `Vec3` and the
  registered materials remain geometry/colour authority. Resolve registry entries through the current
  policy's allowed IDs, never through avatar colours merely present in the registry.

Lane-owned exports in `packages/vox-import/src/index.ts`:

- `parseVox(bytes: Uint8Array)` returns a discriminated result containing bounded model records and the
  file-wide palette, or a useful structured error. It never creates a renderer or reads a browser `File`.
- `prepareVoxImport(...)` consumes a selected parsed model, allowed registry materials, draft style/size/cell
  budgets and transform, and returns the exact blueprint/origin/summary or a useful error. Define its strict
  TypeScript options/results locally; file-format records are not a new shared world protocol.
- The browser module `apps/web/src/vox-import/index.tsx` exports the default Solid tool described above;
  it owns only file/model/transform selection and its summary/errors, never global routes or editor truth.

**Handoff readiness:** main includes `packages/vox-import/package.json` exporting `./src/index.ts` as
`@chatdom/vox-import`, its web workspace dependency and installed lockfile metadata in the handoff commit.
The lane creates `packages/vox-import/src/index.ts` as its real parser/converter implementation in task 1;
main must not add a fake implementation solely to make that export resolve before the lane starts. The actual
Surface hook already exists and requires no route addition. Main commits the scaffold and this handoff before
creating the lane. The worker checks the package metadata at startup and reports `needs:` if it is absent.
Use installed dependencies and native byte reads; no new parser or colour package is required. If adapting
the default palette or third-party code, supply source/license comments and a lane-local `THIRD_PARTY.md`
for main to incorporate into the root credits at merge.

## Scope

Write `packages/vox-import/**` and `apps/web/src/vox-import/**`, plus this lane's PRD and progress log.
Everything else is read-only: `packages/shared`, world/build core, render/voxel engine, content palettes,
global web routes, aggregate exports, root credits, workspace manifests and the lockfile. Main integrates
the UI hook and root credits. A missing consumer is `needs:` in the progress log, never a parallel API.

## Acceptance

From the repo root:

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run packages/vox-import
pnpm build
```

One useful boundary test file is enough. Use a small authored asymmetric `.vox` byte fixture, not a fabricated
success object. Check actual byte parsing, source palette index 1, upright orientation, snapped materials and
the transformed blueprint, then truncate/corrupt the same bytes and verify structured failure with no insert.
Cover default palette and a hostile declared count in that boundary fixture; do not build a large parser audit
suite or snapshot generated box lists. Fixtures are original and contain an obvious door, offset chimney and
small two-colour emblem so scale/orientation mistakes are visible.

With main's build consumer available, use Playwright to select that real file, move and scale its preview,
confirm, erase/paint one imported block, undo/redo the complete insertion, then select a malformed file. Verify
rejection retains the accepted draft. Exercise the normal publish button: it must retain the same eligibility
and reviewer state as manual edits, including an unavailable-review state where applicable. No success may
be invented to make the flow pass.

Use `$look`; serve the built web app on a free recorded port 5170–5199. Take the transformed preview and the
accepted editable draft at **1440×900 and 390×844**, then open all four shots with `view_image`. Use the existing
readiness flag and actual kingdom renderer. Add the scoped `apps/web/src/vox-import/capture.mjs` using
`packages/testing/capture-lock.mjs`; run `node apps/web/src/vox-import/capture.mjs --base-url
http://127.0.0.1:<owned-port>` and wait for `window.__chatdomReady === true` plus `[data-chatdom-build]`.
Save captures under `shots/vox-import/`; record URLs,
commands, malformed-file result, screenshots and remaining doubts in progress. Final main integration runs
`pnpm verify`; this lane does not repeat town/terrain proofs or claim GPU timing from SwiftShader.

## Quality bar

The import feels like placing a carefully made part in your own home. Controls are clear with a free cursor
and touch; quarter scale and XYZ values stay readable at 390 px. Use the build surface's wood, brass and
parchment UI, with no generic upload dashboard. A filename is never the accomplishment: the real object in
the real palette is. Show colour changes and replacement bounds before committing; errors keep the file
picker usable. Geometry still receives the kingdom's normal shaping, AO, lighting and window rules.

## References

- `work/references/vox-import.md`: primary byte layout, palette indexing, object versus scene distinction,
  coordinate handedness and the reasons to keep parsing separate from three.js loading.
- `work/references/voxel-meshing-light.md`: use existing occupancy/mesh/materials for the preview and editor.

## Not now

Scene/animation playback, a general MagicaVoxel scene editor, arbitrary shaders/material physics, mesh/image
conversion, remote URLs, imported avatars, public asset uploads and a second publication service. This lane
delivers complete selected-object import into the existing private home draft.

## Decisions

- **2026-10-30 — An import is ordinary building.** The import boundary is one real byte file to one checked
  blueprint to one atomic draft transaction. Imported geometry has no privileged path to a street or stream.
- **2026-10-30 — Select objects explicitly.** Multi-object `.vox` is a container of local model records and may
  separately encode a transformed scene. The tool exposes the model records and states which representation
  it imports rather than guessing or silently losing a scene.

- **2026-10-30 — Real bridge frozen.** Default Solid props are exactly `BuildImportBridge` from the implemented
  browser session. Live review/durable service is unavailable; the real local housewarming remains explicitly
  SIMULATED. Main includes package scaffolding/dependencies in the handoff commit; the lane supplies the actual
  exported source implementation. No unresolved draft or preview API is delegated to the worker.
