# Spec 13: a builder's tools that feel good in the hand

Status: **frozen 2026-10-30; launch-ready after main commits the handoff.** The shared facade, optional
default-component consumer and core reference exist. Main creates the lane branch/worktree.
Vision: `chatdom/ChatDom.md` principles 5, 11, 15, 17–18; `chatdom/Moments.md` §14;
`chatdom/Tech.md` §§8.2, 9.1, 9.6–9.7; `chatdom/Quality.md` rules 4–6, 14–16;
`chatdom/Artstyle-Soul-Feel.md` §§8, 11 and Decided.

## What and why

A citizen should want to put down one more block. Their own home stays in view while a small wooden tool rack,
warm material swatches and a clear ghost make shaping it feel immediate. Changing a tool, choosing a finer brush,
undoing a stroke and finishing a wall should be equally comfortable with a mouse, keyboard or thumbs. The rack
belongs to the kingdom: brass marks, pressed wood and quiet parchment, with no glass dashboard around the house.
Main is building the voxel editor, picking, edit history and first real scene consumer. This lane gives that core
its finished controls and feedback; it never creates a second editor, private draft store or publication authority.

## Current state

- `packages/shared/src/voxel.ts` defines the 0.125 m build lattice and registered-material voxel blueprints.
  `packages/content/src/materials.ts` provides the kingdom material palettes. Those are read-only dependencies.
- `apps/web/src/kingdom/index.tsx` and `scene.ts` host the current kingdom. Their input, camera, scene and route
  integration belong to main. This lane may not patch them to make its controls appear.
- `packages/shared/src/build.ts`, exported by the shared package entry, now defines `BuildToolsController`,
  `BuildToolsState`, `BuildTool`, `BuildMirror`, `BUILD_BRUSH_CELLS`, build policy and validated edit/snapshot
  types. The controller is the lane's complete engine boundary; use the actual methods documented below.
- `apps/web/src/build/session.ts:createBuildSession` provides the real controller, canvas editing, history,
  browser-local simulation saves and publication status. `apps/web/src/build/Surface.tsx:BuildTools` optionally
  mounts this lane's default component with `{ controller }`, retaining functional fallback controls until it
  exists. `apps/web/src/kingdom/build-scene.ts` supplies the actual scene consumer. None is lane-owned.
  Use `/?tier=hamlet&hour=19.5&build=1&source=simulated`.
- `work/references/build-shaping.md` exists and documents the implemented draft, shaping and consumer bridge.
  Do not import an old editor wholesale or treat a local browser draft as a durable connected service.
- No DraftRoom, publish judge or durable published-home service is implied by a browser editor. A local preview
  must say what it stores. Live publication stays unavailable until real authority exists; SIMULATED local
  publication is an actual separate, labelled preview capability.

## Rules

1. **R1 — One real consumer.** Render the tools from the core's current state and call only the frozen bridge.
   Main owns canvas pointer handling, orbit camera, preview/ghost geometry, stroke collection, draft validation,
   bounds, budgets, collision, persistence and history. UI state may hold open drawers, focus and help visibility;
   tool/material/brush/mirror/history/status truth comes from the bridge. No optimistic success invented by
   a button. Controls must work in the actual main-owned build scene from the first task.
2. **R2 — Four useful tools.** Expose Place, Erase, Paint and Fill with names, matching engraved marks, a visible
   selected state and a short contextual hint. Paint changes existing cells without adding volume. Fill repaints
   the bounded connected occupied region supplied by the core; it never floods empty space. Let the core explain
   an invalid target, missing support, permission failure or budget limit in plain words near the work. Do not
   turn internal error codes, material IDs or coordinates into product copy.
3. **R3 — Scale and symmetry stay obvious.** Brushes are 0.5 m, 0.25 m and 0.125 m, respectively 4, 2 and 1 build
   cells. All three are available from the first use; 0.5 m is the normal starting brush. Mirror offers Off, X, Z
   and X + Z against the core's plot-local symmetry plane. Name axes in the expanded help without making the
   citizen learn an engine coordinate system. Keep brush and mirror selection legible while a palette drawer is
   open. The ghost and budget calculation come from main, including mirrored work and rejection.
4. **R4 — A kingdom palette.** Show the supplied allowed material list, its real colour and a human material
   name. Group enough to make stone, timber, plaster, roof and accents easy to find without manufacturing
   unavailable materials or entitlements. Selection must be clear by shape/mark and text as well as colour.
   A phone palette opens as a compact thumb-reachable drawer with a deliberate close action, not a full-screen
   inventory that hides the building. Keep the current swatch visible when the drawer closes.
5. **R5 — History follows gestures.** Undo and redo operate on the core's complete gesture history, including
   mirror and fill. Enable them only when the bridge says they are available. Show the result of a rejected action
   without clearing the selected tool or pretending the action entered history. Never implement per-cell undo,
   a separate command stack, a second localStorage store, or a UI revision counter.
6. **R6 — Free cursor and comfortable thumbs.** Mouse users keep a free cursor; the rack must not capture canvas
   drags, scroll or keys when it is not the intended target. Keep the active tool, history and material selection
   in comfortable thumb reach, with at least 44 CSS px hit areas. Canvas touch gestures, target confirmation,
   cancellation and camera behavior belong to main; this facade exposes no target commands and the lane must
   not register its own gesture path. Respect bottom safe areas. The palette may compact the rack but must not
   cover the main-owned target, placement reason or scene controls. Tech §9.7's deliberate touch-confirm flow
   is a core requirement, not an implemented capability to claim from this control facade.
7. **R7 — Keyboard use is complete.** All buttons and palette items are reachable and named; selection has a
   designed visible focus state. Main owns global tool/brush/mirror/history shortcuts and canvas confirmation,
   cancellation and exit. Advertise only the actual shortcuts main has implemented; do not register competing
   global handlers. The lane handles Escape only while focus is inside its open drawer, closing that drawer and
   restoring focus to its opener; stop that event before it reaches core. Inputs, text selection, browser
   shortcuts and modified keys retain their expected behavior. Re-entering build mode must not accumulate
   subscriptions or listeners.
8. **R8 — Honest work and publication.** Display the core's human `status` text and `dirty` state, with saving,
   saved or publication claims only when the core actually reports them. Local-only drafts say so; simulated people, ownership or
   adapters remain labelled SIMULATED in the visible scene. If the publish service is absent, explain that
   live publication is unavailable and show no live success state or Housewarming. The SIMULATED consumer
   actually supports a browser-local street replacement and six-second housewarming; preserve its explicit
   SIMULATED/local copy and allow the real action. Pending, held and refused versions cannot replace the last
   approved street version. The lane displays only states the real bridge supplies; it
   does not manufacture moderation, permissions, a queue, a review timer or publication acknowledgements. Call
   the actual asynchronous `publish()` action and use `publishing` to prevent duplicate presses; fulfillment of
   that promise alone is not a publication receipt. Do not infer remote persistence from `dirty === false`.
9. **R9 — Tactile, restrained feedback.** A selected tool seats into the wood, a pressed fitting gives a short
   material-appropriate response, and an invalid action has a readable reason. Keep the core's immediate ghost
   and settling edit visible. Use main's supplied sound hook where present; do not add an AudioContext or route
   around the sound lane. Animation may not block fast repeated actions or override reduced-motion settings.
   The controls must be readable at 390 px without a permanent keyboard legend covering the home.

## Contracts

Import `BuildToolsController`, `BuildToolsState`, `BuildTool`, `BuildMirror` and `BUILD_BRUSH_CELLS` from
`@chatdom/shared`. The UI entry is the default Solid component exported by
`apps/web/src/build-tools/index.tsx`, with props `{ controller: BuildToolsController }`. Main dynamically loads
that optional entry inside its build UI; without it main's fallback still exposes real core operations.

The existing controller in `packages/shared/src/build.ts` is:

```ts
interface BuildToolsController {
  snapshot(): BuildToolsState;
  subscribe(listener: (state: BuildToolsState) => void): () => void;
  tool(value: BuildTool): void;
  material(value: number): void;
  brush(value: 1 | 2 | 4): void;
  mirror(value: BuildMirror | null): void;
  undo(): void;
  redo(): void;
  publish(): Promise<void>;
  leave(): void;
}
```

`snapshot()` initializes the view. Subscribe once for updates and dispose with the returned function on Solid
cleanup. Read `tool: 'place' | 'erase' | 'paint' | 'fill'`, `material`, `brush`, `mirror: 'x' | 'z' | 'xz' | null`,
`occupied`, `budget`, `canUndo`, `canRedo`, `dirty`, `status`, `publishing`, `mode: 'SIMULATED' | 'LIVE'` and
`materials: readonly { id: number; name: string; colour: string }[]`. Render these facts; do not mutate returned
objects. Human palette names/colours come directly from `materials`. `brush` is build cells: 4 = 0.5 m,
2 = 0.25 m, 1 = 0.125 m. Mirror `null` is Off; X spans the plot width and Z its depth (front is +Z).

Main alone maps tool selections and canvas gestures into `BuildOperation`, invokes draft history, persists local
changes, updates status and owns keyboard shortcuts. Actual shortcuts in `session.ts:keyDown` are 1–4 for tools,
Ctrl/Cmd+Z for undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y for redo, and Escape to leave. Brush and mirror have no global
shortcut. Material/tool/brush/mirror/history actions already trigger main's sound cue; no new sound hook is
needed to make those actions audible. The facade has no geometry/pointer/target method, network
publish receipt, permissions claim, sound callback or persistence transport. Use no imaginary methods. If main
does not supply a sound hook, retain core's actual edit sounds and report UI sound hookup as `needs:` rather
than creating another browser audio engine. A lane must never infer ownership from a client-supplied name.

Main supplies `[data-chatdom-build]` on the real editor panel and `window.__chatdomReady === true` after its first
meaningful rendered frame. Capture only after both are present. No route, application or scene files are lane
owned. New shared state fields or core actions require a `needs:` entry; take an unblocked UI task meanwhile.

## Scope

Write only `apps/web/src/build-tools/**`, plus task checkboxes/backlog in `work/lanes/build-tools/PRD.md` and one
progress line per task in `work/lanes/build-tools/progress.txt`. Everything else is read-only, including
`apps/web/src/build/**`, kingdom/input/render/voxel/world/content, `packages/shared`, manifests, lockfile,
shared UI/audio, capture infrastructure and other lanes. Do not rename or revert another worker's changes.
Main owns all consumer integration. Ask through `needs:` when the bridge cannot express a required behavior.

## Acceptance

Run `pnpm typecheck`, `pnpm lint` and `pnpm build` for each coherent step; expect clean exits. Use one focused
real-browser interaction tour for this lane, extending it as the tasks land rather than adding a parallel test
suite or unrelated assertions. Main runs `pnpm verify` for integration. Do not reopen terrain/light/budget proofs,
repeat town sweeps or add audit/record-keeping deliverables.

The tour must exercise the real core through the visible controls: choose a material and each brush size;
place, erase, paint, fill and mirror; undo and redo a whole gesture; use the phone rack and palette;
change tools using the real shortcut path; and observe the actual SIMULATED local street publication. Confirm
that it remains explicitly local and that the LIVE branch reports the missing draft/review authority. Check a rejected
edit leaves history/build unchanged and has a readable reason. After closing/reopening the tools, one action
still creates one gesture. Do not claim a moderation round-trip that the integration does not provide.

Use `$look`: serial headless Chrome with SwiftShader through the shared capture lock. Take only these lane shots,
with fixed seed/time, when they show a meaningful new state; open every shot with `view_image`:

- 1440×900: the edited home with a readable rack, palette, selected material/brush and mirror state.
- 390×844: phone rack/palette, then the real main-owned target with unobstructed rejection/status text.

Keep the chosen small set of generated captures under `shots/build-tools/`. The lane does not touch the stream or panel; no extra stream/panel captures are
required. Add a small lane-owned `apps/web/src/build-tools/capture.mjs` for this exact consumer, reusing
`packages/testing/capture-lock.mjs`; run `node apps/web/src/build-tools/capture.mjs --base-url
http://127.0.0.1:5190`. It must visit the URL and wait for the two readiness markers in Contracts, check for
browser errors/viewport overflow, and take the two required sizes. It may also run the single focused interaction
tour; do not build a general capture framework. Against a lane preview use its actual URL instead. Do not start
another service on a reserved port; choose a free 5170–5199 port. Main preview 5190 stays main-owned.

## Quality bar

The home is the subject and the rack feels like tools beside it. Wood has depth, brass has worn edges, parchment
holds brief inked words; shape and spacing do the work. Use the existing typography/assets and purpose-drawn
SVG/CSS marks, with no generated paintings, stock emoji tool icons or new icon dependency. Native semantic
buttons are expected underneath fully designed controls. No browser-default selects, checkbox styling, tooltips,
dialogs, scrollbars or unstyled focus outlines. Desktop feels precise; phone feels intentionally made for thumbs.
State, errors and restrictions remain legible without taking over the scene. The core's genuine building response
must still be visible while the UI is open.

## References

- `work/references/build-shaping.md`: implemented gesture-level undo/redo, bounded fill, mirrored edit semantics,
  derived windows and honest local housewarming; write controls for that actual core.
- `work/references/prototypes.md`, Building: the earlier editor's preview/settle workflow is an experience
  reference, not a network, safety or persistence contract.
- `chatdom/Tech.md` §§9.1, 9.6–9.7 and `chatdom/Artstyle-Soul-Feel.md` §11: three available brush sizes,
  deliberate touch confirmation, gold/red ghost, whole-gesture history and crafted materials.

## Not now

This lane does not build the draft reducer, picker, mesh or architectural auto-detail, camera/navigation,
network/reconnect persistence, judges/publication transport, identity/entitlements, templates, `.vox` import,
placed-piece inventories, gamepad input, a reusable UI-kit project or a second build bench. These have their own
core or future consumer boundaries; none is a reason to fake a working button here. The full build vision stays
in the vision docs. This handoff is the concrete control surface for the core being built now.

## Decisions

- **2026-10-30:** Main owns `apps/web/src/build/**` integration and the editor core; the polish lane owns only
  `apps/web/src/build-tools/**`. First task must be visibly connected to that core. No second authority, no engine
  implementation in the lane, no broad proof suite, no false publication success. The actual shared facade is
  frozen, and its consumer hook/reference are present. Main commits the handoff before creating the lane.
- **2026-10-30:** The supplied facade owns snapshots/subscriptions and scalar controls only. Keyboard and canvas
  gestures stay core-owned, with no duplicate handlers in the polish lane. Touch confirmation is not exposed by
  this facade; the lane does not fabricate it or claim Tech §9.7 implemented. Main must resolve that core behavior.
