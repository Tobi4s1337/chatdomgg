# Spec 32: First look polish

Status: **frozen 2026-10-30.** Main freezes the UI exports and precise presentation-file
grants. The team integrator alone composes scene/terrain changes. Ownership: `work/lanes/kingdom-look-owners.md`.
Vision: `chatdom/ChatDom.md` principles 2, 11, 16–18; `chatdom/Quality.md` rules 8–15 and the slop list;
`chatdom/Artstyle-Soul-Feel.md` §§7, 11, 13, 16.1 and Decided; `chatdom/Moments.md` §14.

## What and why

The first view should feel cared for: a small human in a handmade kingdom, a quiet truthful label, legible words
and controls made of the same wood, brass, parchment and wax as the world. The current Forge uses a native select
and dark glass; small build labels fade into their plates; some skin and hair combinations lose the face at dusk.
The cameras need intentional subject placement, depth and foreground that belongs to the real world. This lane
brings those surfaces to the quality of the genre's best crafted games. Existing screenshots establish what must
keep working; they are not the artistic target. No polish may imply live people, connected Codex, passed judges,
owned rewards or durable publication where those facts are absent.

## Current state

- Main has created the real `@chatdom/ui` package with root and `./kit.css` exports, Solid dependency and initial
  source/CSS. The lane builds on those files and owns source/components/CSS after handoff. TypeScript uses
  Solid JSX (`tsconfig.json`), not Vue or React. `apps/web/src/build-tools/build-tools.css` is the existing authored
  wood/brass/parchment vocabulary and loads OFL fonts from `apps/web/src/atlas/assets/fonts/`.
- `apps/web/src/kingdom/index.tsx:55` shows `.source-ribbon` from scene source strings, and `:66` repeats
  SIMULATED under a housewarming. `kingdom/scene.ts:114` maps the presence frame's origin/connection; these are
  actual feed facts. A real Herald connection must never become simulated or live through presentation inference.
- `apps/web/src/forge/index.tsx` contains the native realm `<select>`, textarea, a SIMULATED heading and footnotes
  distinguishing an authored fixture from the request path. `ForgeStatus.runtime` in `forge/scene.ts:15` selects
  `fixture|codex`; it does not establish that a provider is connected or that an authority ledger exists. Current
  requests/local placement are development behavior; the real authority binding remains main-owned (PLAN §10).
- `apps/web/src/forge/ritual-view.ts` owns the current in-world SIMULATED stamp. Specs 17/18 own ritual/refusal
  behavior; spec 25 owns the physical anvil/sleeping dragon and unchanged official engraving. This lane owns none
  of those assets, emitters, approval gates, sounds or flight/landing choreography.
- `apps/web/src/build/{Tools.tsx,build.css}` and `build-tools/{index.tsx,build-tools.css}` include 9–11 px labels
  and faint disabled controls. `build/session.ts` describes local housewarming. Their persistence, ownership,
  tools, input and import behavior remain with their current owners.
- `packages/content/src/avatars/body.ts:paintFace` in main paints hairBlack eyes, cream catchlights and petal cheeks
  and mouth; the deepest skin is close to the eye material. Main has WB01's `balanced`/`sidePart` only. The existing
  `../worktrees/wardrobe-body` has WB01C logged and WB02 edits for four bodies/eight hair treatments in progress;
  `../worktrees/wardrobe-body-w2` is another existing worktree. None of those edits are permission to replace them.
  WB02 is not accepted in the reviewed main checkout. Its narrow transfer is pre-approved by main upon actual integrator acceptance and a recorded producer commit; no overlapping edits before then. Spec 08 and its PRD remain authoritative until an explicit
  transfer after integrator acceptance.
- Main-owned cameras are inline `focusHome`/`setHero` and render branches in `kingdom/scene.ts`, Forge stage framing
  in `forge/scene.ts`, and the complete occupied-corner fit in `build/composition.ts`. They already participate in
  movement, resize, Forge/build takeover and shadows; preserve all of those. `settlement-content.ts` exports the
  real `Dressing` shape and factories for readable existing foreground pieces.
- Specs 26–31 run beside this lane. Ground owns vegetation; land owns sites, trails, water queries and landscape
  view anchors; light owns the shared shader/grade/lamp placement; high places own banners; water places own water.
  The camera is composed from their real geometry and anchors, without changing those owners' systems.

## Rules

1. **R1 — Quiet honesty remains visible.** Replace repeated presentation labels with one crafted provenance
   component per visible surface, with the literal **SIMULATED** plainly readable whenever anything presented as
   people/chat/practice publication is simulated. Use a small parchment slip and pressed seal; never hide the word
   in a tooltip, aria label, icon or screenshot crop. The label survives Forge/build overlays, all review stills,
   phone layout and stream crops. Target at most 3% of the desktop canvas when idle, while preserving legibility.
   Live connection, offline/resting, connecting and lost are independent facts; simulation never hides a connection
   failure. The one component may contain more than one short line when provenance is mixed. It has
   `data-provenance`, `role="status"`, restrained polite announcements and no flashing. Existing audio unlock/mute
   rules remain intact; a source update cannot force sound before a user gesture.
2. **R2 — Remove clutter, preserve facts.** Product words replace debug phrasing, never the underlying data or
   gates. Example: “SIMULATED · practice night”; a fixture Forge also states “Authored wishes · checks simulated”.
   A development request path states “Practice Forge · your coals are untouched” without promising Codex is
   connected or judges will pass. A local build states “Saved on this device” only when the current owner actually
   confirms that save; pending/failed persistence says so plainly. “Fit for this home” may replace a doubled stamp
   only while the provenance component remains visible. Never rewrite a refused/held/private error into success.
   No blanket regex removes every SIMULATED string. Internal art benches retain their truthful technical review
   labels/stats; this is a product polish lane, not a scrub of evidence.
3. **R3 — A crafted, accessible realm choice replaces the native select.** Three crest seals sit on a wood rail,
   with visible realm names and selected/disabled states. Use a labelled `radiogroup`, `radio` items,
   `aria-checked`, roving tabindex, arrow/Home/End navigation and Space/Enter choice. Preserve selection and normal
   Tab escape. Targets are at least 44×44 px; chosen and focused states differ without relying on colour. The focus
   ring is deliberately drawn in brass and remains visible in forced-colour/high-contrast mode. Hook the existing
   wood cue through a callback that obeys audio policy. On a phone the group wraps without horizontal scrolling.
   The wish field is a labelled parchment textarea with visible character allowance and designed focus/invalid/
   disabled states. Keep a real textarea and its native editing/IME behavior; do not fake an editor in a div.
4. **R4 — A readable kit, not CSS decoration on generic glass.** Reuse authored rack materials and existing
   fonts; frames/fittings/seals are modelled or code-native, with no image-generated UI. Headings are storybook;
   body text is readable. The minimum product text on these changed surfaces is 12 CSS px at both standard sizes,
   with small-cap tracking ≤0.1em. Normal text contrasts at least 4.5:1 on its own plate; 18 px bold/24 px regular
   large text at least 3:1. Disabled labels stay legible at 3:1 and give a reason in words, not opacity alone.
   A selected build material has its readable name beside the swatch. Key hints, draft state, error and close/back
   actions stay reachable at 390×844 with the software keyboard and browser zoom. Respect reduced motion; shutters
   and press feedback cannot obscure focus or block input.
5. **R5 — Every skin remains itself and every face reads.** Preserve all ten registered skin swatches exactly,
   including the deepest human skin and both fey swatches. Never lighten skin, alter exposure for a person, infer
   skin from identity, change the rig or give different feature geometry to different skins. After the explicit
   wardrobe transfer, author a small registered face-role table by skin (pupil, eye white, catchlight, mouth,
   warm cheek) with one common geometry and cells on the flat face plate. Eyes need a readable light/dark boundary,
   not merely a numeric pass for a tiny glint. Base-colour eye separation targets ≥3:1 for the stronger whole cell,
   mouth ≥1.6:1; cheeks are restrained warmth rather than pale dots. Treat material contrast as a diagnostic,
   not WCAG certification of a rendered face. Judge the actual production shader at noon/dusk/night, close and
   street distance. Publish the material-role table and rendered crops for every swatch. Request main-owned new
   face swatches only when existing keys cannot do the job; extend the avatar palette validator for approved keys
   under the exact transferred `palette.ts` scope. No arbitrary colour literal or global skin-ramp edit.
6. **R6 — Hair carries character.** Work on the accepted WB02 library, never the stale one-form file. Each style
   must read as its intended treatment, including close crop, coils/curls, bare scalp, bob, braid and twists;
   don't impose a lifted fringe or nape locks on bare scalp/close crop. Use substantial authored masses, deliberate
   crown/fringe/nape breaks where appropriate and a restrained registered sheen on up-facing strands/masses.
   Dark hair on dark skin separates by silhouette and shared light; lighter hair retains shape without white caps.
   Preserve six freely chosen hair swatches, every legal headwear fit, rig/socket/pivot and part/look budget.
   Hair highlights may not become noise, an identity cue or emission. No cloth/secondary-motion engine edits.
7. **R7 — Compose the view from the actual subject.** Hero, window, citizen, Forge stage and initial build poses
   use anchors and occupied bounds, with real panel/rack insets. Start near a thirds intersection (within 6% of the
   free-canvas dimension) and a horizon/skyline near a third; then judge the whole composition. A horizon between
   42–58% is rejected unless a documented subject/clearance tradeoff warrants it. Priorities are: all occupied
   corners fit, controls and face/window are clear, camera clears solids, then the thirds. The build fit remains a
   hard distance floor; no clipping the tall/wide home to hit a percentage. Initial build elevation targets ≤32°;
   user orbit and edit reach remain working. Citizen height targets 12–22% of the visible canvas; portrait camera
   preserves street context and lower controls. Forge pose frames the actual anvil from spec 25 once mounted,
   without changing its scale/geometry or ritual camera. Camera changes blend and the horizon never rolls.
8. **R8 — Foreground belongs to the kingdom.** Compose using existing placed pieces first. Additional framing
   dressing is deterministic public-land scenery, visible to every walker, with real ground contact and clearance.
   Never camera-attached cardboard, a new lamp/banner/tree, a private prop on a home plot, or an unbound solid.
   Prefer a corner piece covering roughly 3–15% of the frame, darker than the subject and clear of its anchor.
   Keep calm negative space; no view may be “fixed” by filling the screen with leaves. Existing street-prop
   fences/shrubs/troughs and already placed lamp/branch silhouettes may frame; benches/signs can be reused only if
   their real seat/read interaction is bound. Paving, approaches, future lots, place footprints and sightlines win
   over decoration. Structural framing pieces use exact cardinal turns and placement origins; freely rotated foliage
   is visual-only unless its actual supported collision proxy is bound. Include additions in the same
   occupancy/light/shadow consumers as other real props.
9. **R9 — Provenance parsing fails closed.** Map the exact current source strings without changing feed selection,
   health, source generation or origin data. Unknown states are “Connection unclear”/lost, never live. A live chat
   seal certifies the feed only; it cannot certify Forge providers, authority, owned identity or persistence.
   Stream and avatar bench owners adopt the kit separately; until then their existing SIMULATED labels stay.

## Contracts

All APIs are lane-local presentation helpers, not new shared protocol messages. `packages/shared` is read-only.
Main supplies the actual `@chatdom/ui` manifest, entry/export paths and web dependency before source work starts.
The lane owns implementation under `packages/ui/src/**` and its fonts/assets, never root manifests/lockfiles.

```ts
import '@chatdom/ui/kit.css';
export type Provenance = 'simulated' | 'connecting' | 'live' | 'resting' | 'lost';
export function provenanceFromSource(source: string): Provenance;
export function ProvenanceSeal(props: {
  state: Provenance;
  simulated?: boolean; // independent practice content while the real feed may be live/lost
  detail?: string;     // product fact supplied by owner; never inferred provider/save/ownership success
  class?: string;
}): JSX.Element;
export function CrestChoice<T extends string>(props: {
  label: string; value: T; disabled?: boolean;
  options: readonly { value: T; name: string; crest: 'hearth' | 'tide' | 'grove' }[];
  onChange(value: T): void; onCue?(cue: 'wood'): void;
}): JSX.Element;
export function ParchmentField(props: {
  id: string; label: string; value: string; max: number; rows?: number;
  disabled?: boolean; invalid?: string; hint?: string; placeholder?: string;
  onInput(value: string): void;
}): JSX.Element;
```

`ProvenanceSeal` is purely presentational; the surface owner passes the real facts. Existing font licenses travel
with assets; README gives exact source paths for main's THIRD_PARTY update. Do not create a circular package import
from `@chatdom/ui` back into web. Shared CSS variables can migrate without rewriting other owners' rack behavior.

`apps/web/src/framing/index.ts` exports pure composition helpers:

```ts
export type ShotKind = 'hero' | 'window' | 'citizen' | 'forge' | 'build';
export interface ShotInput {
  kind: ShotKind; viewport: { width: number; height: number };
  free?: { left: number; right: number; top: number; bottom: number }; // insets in px
  anchor: THREE.Vector3; bounds: THREE.Box3; facing: number;
  ground(x: number, z: number): number;
  sun: THREE.Vector3; // actual direction; don't hardcode a universal dusk bearing
  minimumDistance?: number; // occupied-corner fit provided by build's existing composition
}
export function composeShot(input: ShotInput): {
  eye: THREE.Vector3; target: THREE.Vector3; fov: number;
  viewOffset: { x: number; y: number };
};
export function placeFramingDressing(input: {
  layout: SettlementPlan; ground(x: number, z: number): number;
  occupied: readonly Dressing[]; keepOut: readonly (readonly XZ[])[];
}): readonly Dressing[];
export function measureShot(camera: THREE.PerspectiveCamera, anchor: THREE.Vector3,
  viewport: { width: number; height: number }): { thirdsError: number; horizon: number };
```

Consume existing `SettlementPlan`, `Vec3`, `XZ`, `CardinalTurn` and `Dressing` through their real exports/source paths; do not
redeclare a land contract. `bounds` is in world metres; `facing` is radians about +Y, +Z front. Inputs are not
mutated. `measureShot` reports geometric horizon; screenshot review separately judges the terrain skyline.
The host supplies actual land/place keep-outs and build's occupied-corner floor. Integrator owns all call sites.
No helper may move the actual subject, relight the world or bypass camera collision to satisfy a framing test.

## Scope

Write `packages/ui/src/**`, owned UI font/asset files, `apps/web/src/framing/**` (README, tests, isolated capture
bench and capture script included), this spec and `work/lanes/first-look-polish/{PRD.md,progress.txt}`. A narrow
package-local README/test configuration may be added; no dependency/root configuration edits. Outputs:
`shots/first-look/**`; copy only selected final before/after evidence into `work/evidence/first-look-polish/**`.

### Precise transfers and integration recipes

Main records grants in `work/lanes/kingdom-look-owners.md` before handoff. The table is a recipe, not permission
for a worker to annex an active owner's files. Any absent/ambiguous grant is `needs:`; continue isolated work.

| Files / responsibility | Owner and exact handoff |
|---|---|
| `packages/ui/package.json`, root/web dependency/export and lockfiles; font credits | Main scaffolds real package before FL01; source/components then this lane. Main owns THIRD_PARTY rows from README. |
| `kingdom/index.tsx`, `kingdom.css` | Main grants this lane provenance component replacement, redundant housewarming text and minimum readable labels only. Preserve source choice, handlers, readiness, private fields and other overlays. |
| `forge/index.tsx`, `forge.css` | Main grants this lane panel materials, realm-choice/field components and truthful words only. No service request, entitlement, approve/place/publish or fixture mode changes. |
| `build/Tools.tsx`, `build.css`, `build-tools/index.tsx`, `build-tools.css` | After the current build-tools candidate is accepted, main grants presentation/type/disabled-reason changes only; preserve tool state, hit regions, movement, save and import behavior. |
| `build/session.ts` status words | Current owner supplies truthful local/pending/save outcome copy; no lane mutation of session logic or new success claim. |
| `kingdom/scene.ts`, `forge/scene.ts`, `build/composition.ts` | Integrator alone applies supplied pure composition/import/resize/takeover recipes. Existing occupied-corner fit and flight/landing cameras stay authoritative. No line-hunk grant to this lane. |
| `forge/ritual-view.ts` duplicated stamp | Existing ritual owner/integrator changes only the text after a persistent provenance label is demonstrated; physical anvil, sleeping dragon, official engraving and effects remain their owners'. |
| `avatars/body.ts`, `palette.ts`, `hair.ts` | Wardrobe-body until integrator accepts actual WB02 and the integrator records the pre-approved scoped transfer and actual producer commit. FL04 may change face painting, face-role table and its allowed keys; FL05 may change only hair silhouette/sheens/legal-fit adaptation. No stale file copy or reset of WB02. |
| `avatar-bench/**` | Wardrobe-body retains ownership, fixture labels and fit coverage. Ask it to add/reuse face/hair matrices or use first-look's isolated read-only consumer; do not annex the bench. |
| `stream/**`, panel, capture scripts outside framing | Existing owners adopt provenance/UI exports; their truthful labels remain until that integration. Main/integrator updates capture selectors only when old ribbon removal lands. |
| `packages/content/src/materials.ts` | Main only, on measured `needs:` for registered face/sheens; preserve all skin IDs/colours and existing palette order. |

Everything else is read-only, especially renderer/shaders, shared, world/settlement, street/civic/ground content,
Forge authority/runtime/ritual/refusal/anvil assets, cape renderer, director policy, routing and main scripts.
You are not alone: preserve others' changes. Sub-agents have disjoint write sets and never run git. Team integrator
merges local lane commits one branch at a time; main judges the announced integration candidate.

## Acceptance

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run packages/ui/src apps/web/src/framing
pnpm build
node apps/web/src/framing/capture.mjs --base-url http://127.0.0.1:5190
pnpm verify --area kingdom --tier town --hour dusk
```

The lane introduces `capture.mjs` with its first visible task. Acquire `packages/testing/capture-lock.mjs` before
browser/server startup, reuse `--base-url` or start only an unused 5170–5199 port, record it and stop only your
process. Use actual Chrome/SwiftShader, await `__chatdomReady` plus settled light, fail console/page/shader errors.
Typed fixtures in an isolated bench are visibly SIMULATED and do not claim real integration. Actual consumer
captures follow integrator binding; no synthetic screenshots or fabricated green statuses count as integration.

Capture at **1440×900 and 390×844**: hero at noon and dusk; window and citizen dusk; Forge with its panel open;
build with the rack open, including a tall/wide occupied home. Include one focus/keyboard state and local save
failure/private Forge error to prove readable designed states. Use compact representative sheets: all ten skin faces under noon/dusk/night (one fixed common hair); all eight
accepted hair treatments in front/side/back at dusk; all six hair swatches on the hardest dark-skin/black-hair
and pale-skin/light-hair treatments; representative extreme combinations under noon/night. This is coverage by
feature, not a ten-skin × six-swatch × eight-style × three-angle × three-hour browser cross product. Include
actual street-distance deep-skin/dark-hair crops. Reuse one loaded fixture scene and inspect sheets; capture only
changed views on iteration. No multi-hundred browser run matrix.
If touching stream presentation, its owner must also capture **1920×1080 and 1280×720**; a new panel adoption needs
**318×496**. The kit alone cannot claim those owners' integrations are done.

Open every required image/sheet with `view_image`; inspect actual pixels, not only numeric reports. Apply squint,
greyscale, 160 px thumbnail and phone checks against Artstyle §16.1. Keep selected before/after PNGs and concrete
remaining doubts in the README/progress. A still does not prove smooth takeover or input; perform a keyboard/
touch/reduced-motion flow, resize, enter/exit build and Forge, then return to citizen movement.

Meaningful tests cover: exact source-to-state parsing and unknown/lost fallback; mixed real-feed/practice content
truthfulness; `CrestChoice` selection/focus/Tab/disabled behavior; deterministic bounds-aware composition with
panel/rack insets; placement respecting occupied footprints/keep-outs; registered unchanged skin palette and
face-role contrast diagnostic after transfer. Do not write per-voxel or invented minimum-fringe tests that force
all hairstyles to look the same. Existing avatar budget/fit checks remain green. Final check runs `pnpm verify`
on the integrated candidate; don't claim a full green run from a scoped test. SwiftShader proves pixels/behavior,
not real-device GPU timing or final post-processing.

## Quality bar

The screen immediately feels like a finished place. Parchment, pressed wax and worn brass have weight; text is
clear on a phone; focus is beautiful and unmistakable; no browser dropdown or default dark app card remains.
A deep-skinned citizen has the same dignity and expression as every neighbour, and black coils look like coils.
The first pose leads the eye to a real subject, keeps a layered street and skyline and lets the world breathe.
No noise, white blobs, cardboard framing, giant heads, cropped homes or success copy unsupported by real facts.

## References

- `apps/web/src/build-tools/`: established authored material vocabulary and existing font source, not a license to
  take over the active build-tools owner. Keep fonts' SIL OFL notices; main records any new copy path.
- `work/references/prototypes.md`: the director's cause-to-subject composition; reimplement, don't copy wholesale.
- `work/references/sky-fog-time.md`: preserve shared warm subjects/cool depth; no private camera grade.
- `work/references/crowd-animation.md`: stable shared rig/attachment/fit behavior; content polish cannot fork motion.
- `work/references/living-ground.md`: coordinated real foreground hierarchy where vegetation enters a frame.

## Not now

Owned elsewhere: landscape generation, ground cover/trees, water, lamps, banners, castle/anvil/dragon sculpting,
ritual/refusal/flight, cape cloth and avatar engine, provider connectivity and independent judges, economy/ledger,
Twitch feeds, real identity, director policy, stream/panel adoption, production hosting and shared contracts.
These are scope boundaries, not a phased product plan or permission to ship a broken first view.

## Decisions

- **2026-10-30 — Main freezes; integrator composes.** No worker writes cross-owner scene/terrain hunks. The lane
  supplies deterministic helpers and exact call/resize/takeover recipes; integrator binds and main reviews them.
- **2026-10-30 — Truth is visible.** The existing SIMULATED requirement remains. One quiet component may consolidate
  duplicated labels, but it must distinguish mixed practice/real connection facts and actual failure states.
- **2026-10-30 — Wardrobe transfer is conditional, explicit and scoped.** WB02 acceptance precedes FL04/FL05; the integrator
  records the pre-approved transfer and producer commit. No assumption that a worktree's new files are integrated, and no overlapping writer.
- **2026-10-30 — Preserve the skin, improve the face.** Registered skin swatches never lighten. One face geometry,
  palette-role adaptation, production-shader sheets and real street crops establish equal readability.
- **2026-10-30 — Judge the whole composition.** Bounds, usable controls and solid-world clearance outrank a thirds
  formula. No new framing prop may become fake scenery or duplicate ground/light/high-place ownership.
- **2026-10-30 — No hero-anvil overlap.** The exact physical asset, dragon, official SVG engraving, emitters and
  art bench in spec 25 remain read-only. Compose using its returned bounds/anchors after integration.
