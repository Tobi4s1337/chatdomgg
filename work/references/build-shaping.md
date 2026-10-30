# Reference: a citizen's editable house

For the build core in `packages/world/src/build/` and its first browser consumer in
`apps/web/src/build/`. Studied 2026-10-30. Local prototype files were read, never copied.

## What we studied

- **b-townscaper**, local Chatdom prototype, read-only at
  `/root/chatdomgg/prototyping/kingdoms/b-townscaper/src/mesher.ts:76`. Its neighborhood state
  combines occupied, above and below corner masks. Procedurally authored roof, fascia and
  vaulted-underside pieces appear because adjacent blocks make their situation meaningful.
  `mesher.ts:105` derives a vault from nearby support; `mesher.ts:124` adds roof and eave details.
  The lesson is the separation of authored occupancy from derived craft, not its deformed quad geometry.
- **d-voxel-diorama**, local Chatdom prototype. Luna/low independently inspected
  `src/editor/editor.ts:158` (place beside the hit face, erase/paint at the hit), `:183`
  (a fixed drag plane), `:231` (mirror and stroke deduplication), and `:286` (stroke history).
  `src/editor/pick.ts:25` traverses cells rather than picking rendered triangles. Its
  `src/moderation/review.ts:44` retains an approved snapshot, but the heuristic/timed review
  and delayed overwrite are explicitly unsuitable authority. Its fill at `editor.ts:253`
  silently stops at 6,000 cells; our fill either commits the complete component or fails.
- **three.js editor**, [History.js](https://github.com/mrdoob/three.js/blob/dev/editor/js/History.js),
  [MIT license](https://github.com/mrdoob/three.js/blob/dev/LICENSE), inspected online at the
  current `dev` source on 2026-10-30; no checkout or commit hash claimed. Its undo and redo
  command lists, redo invalidation after fresh edits and serialization at an accepted command
  boundary are good precedents. Chatdom groups explicit pointer gestures rather than merging
  gestures by elapsed time. No source was copied or adapted.

## What we take

The citizen's source is a dense `Uint16Array`, x-fastest through shared `cellIndex`, on the
0.125 m lattice. That is intentionally different from the old editor's x/z/y stride. The
permanent lot stays 64 × 160 × 128 cells and faces +Z. The externally supplied policy opens
an editable sub-box for the current tier, lists legal materials and caps occupied source cells.
Saved files carry identity, dimensions, monotonic revision and canonical non-air runs; they
cannot grant themselves a larger plot, a different owner or another palette.

One operation batch is atomic and one undo step. Placement replaces cells, paint affects only
occupied cells, erase makes air, and fill follows the six-connected component of one occupied
material. Fill never floods air. Mirrors reflect about the unlocked area's X/Z midpoint.
An explicit browser gesture groups accepted samples into one undo while allowing saves between
samples. Undo/redo advances revision; revisions never rewind. Import/template insertion clears
its bounding box then applies its ordered boxes in the same atomic batch.

`shapeBuildCells` leaves source cells alone. It derives corner timbers and stone plinths,
one-cell fascia beside the lowest exposed roof edges, shallow haunches beside supported
lintels, and stone sills/timber jambs around actual glass panes. Glass components derive window
anchors afresh; painting or erasing a pane removes its light. No fake door leaf is generated.
The output is a normal voxel asset with normal collision occupancy, not a shader pretending
solid detail exists. `compile()` is the direct mesh-worker path; greedy XYZ box compression
is used only when a `VoxelBlueprint` is actually needed.

## Publication and the whole system

Private edits may be incomplete, including unsupported work. Preparing publication checks that
every occupied source voxel connects to ground and snapshots the complete source plus shaped
blueprint. The candidate is deeply frozen: editing during review cannot change what was submitted.
The local simulation returns `mode: SIMULATED`, `status: local-preview`, and a named six-second
housewarming. It claims neither moderation nor authoritative publication.

The real adapter must authenticate plot ownership, validate against its policy, recheck the
revision, run support and full avatar-egress checks on the composed result, render the six
review views, perform visual/name judgment, and atomically replace the last approved home and
record its housewarming. `reviewAndPublish` is that boundary. Without it live publication is
unavailable. Holds leave the approved street alone. No browser-owned boolean is approval.

The browser session currently uses an explicit simulation-only localStorage namespace and
saves accepted edits synchronously. Production durable drafts need the authoritative DraftRoom,
acknowledged ordered operations and IndexedDB pending operations described in PLAN; they can
consume the same integer edits and source snapshot without treating localStorage as a server.
Templates and palette-snapped `.vox` imports both enter through `insertBlueprint`, then remain
ordinary editable source. The authored structural grid stays separate from Forge pieces and
their connectors/hinged door sidecars. Artisans can improve the small-detail rules without
changing anyone's source or undo history.

## Budgets and limits

- Input response target: ghost and control acknowledgment in the same input turn, under 100 ms.
  Cell edits touch a sparse pending set. Blueprint meshing uses the existing worker pool;
  only one job per draft runs, and the newest requested revision follows it. Stale geometry
  never installs. There is no per-frame meshing.
- Full reserved source: 2.5 MiB. A shaped copy is another 2.5 MiB; window discovery/greedy
  compression use a 1.25 MiB visited buffer. Undo retains at most 64 steps and normally at most
  1,048,576 changed cells (8 MiB of typed patch payload); one larger atomic replacement stays
  undoable. Large pending-edit maps and serialization are additional transient JS memory.
- Source occupancy ceilings: hut 32,768; cottage 49,152; house 81,920; manor 131,072; hall
  196,608. Heights are 48/64/88/120/160 cells. Shaping fits the same unlocked volume and does
  not charge earned source allowance for automatic detail. Blueprint output remains within
  20,000 boxes and 64 window anchors; excessive complexity returns a readable error.
- Local editing has zero network traffic. A source save is at most 196,608 non-air runs,
  generally far smaller for architecture. The eventual network path sends operations and
  acknowledgments, not a volume each pointer move. Compressed publication asset transport
  belongs to the server adapter, not the pointer loop.
- Frame-time and memory numbers here are design bounds/targets, not measured GPU claims.
  The entire-lot shaping pass and synchronous local simulation saves still need real-device
  input timing once the integrated tactile view is ready.

## Leave behind and doubts

Do not import prototype renderer layout, its mismatched voxel indexing, heuristic moderation,
temporary undo-to-approved behavior, or a synthetic review timer. No source copying means no
additional third-party code credit is required; the external source remains linked above.

Current derivation handles flat rectangular glass components; irregular or adjoining corner
glass needs a richer authored opening boundary. Full egress requires the actual avatar capsule
and authoritative occupants; ground connectivity alone does not prove it. Generated arch
haunches are deliberately shallow, and the same composed occupancy must feed collision before
real street publication. Builder lanes should own the richer tools surface, template family
and `.vox` parser; artisans should tune the detail grammar against real homes and the housewarming
camera. The core's one boundary test covers edit/mirror/fill/undo, rejected atomic edits,
serialization, derived windows, immutable review candidates and honest simulated publication.

## Consumer handoff

`apps/web/src/build/index.ts` exports `createPlotBuildPolicy(home, ownerId)`, which maps the
actual settlement tier/style to these limits without granting ownership. `createBuildSession`
exposes the real `controller`, `draft` and `imports` bridge. Main mounts
`BuildTools` with `{controller, ownerName, imports: session.imports}`. The composition optionally
loads the default `../build-tools/index.tsx` component with its real controller and the default
`../vox-import/index.tsx` component with `{draft, onPreview, onChanged}`. Missing modules add no
inactive controls. Import preview validates and meshes a cloned composed draft with its replacement
volume outlined; it does not mutate source. `onChanged` saves/remeshes only after an actual source
revision change. The importer lane owns parsing and confirmation, while this bridge owns scene
resources and stale-preview rejection. Main still owns scene publication and the housewarming camera.
