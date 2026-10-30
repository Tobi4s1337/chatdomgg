# Spec 17: words become a house part

Status: **frozen 2026-10-30.** Main approved the lane-local adapters below. Ready for the team to branch only
once main commits the shared Forge contracts, their tests and the baseline consumer. Main creates the worktree.
Vision: `chatdom/ChatDom.md` principles 10–11 and 15–18; `chatdom/Moments.md` §§3, 10;
`chatdom/Safety.md` §§2, 4.2, 5.3 and Decided; `chatdom/Artstyle-Soul-Feel.md` §§6, 9, 17;
`chatdom/Quality.md` rules 1–2, 5, 8–11, 17.

## What and why

A small house part deserves a moment people remember: runes gather around the anvil, the blueprint finds its
shape, molten cells pour into it, a seal lands, and a single hammer strike gives way to the kingdom's own colours.
The part then flies home and settles onto its actual socket. The sound has the same physical story: quiet brass
and breath, hot grit and small resonances, a weighty strike, cooling ticks, then a satisfying wooden or stone
arrival. This is the rich temporal presentation and audio mix around main's real local Forge, rather than a
second Forge implementation. It must read both on a phone and at stream distance, stay gentle under speech,
and remain honest when a future observed run waits at a gate.

## Current state

- **2026-10-30 provider amendment:** words/plan/result now use isolated authenticated Codex CLI runs, per
  founder instruction, without local API keys. Judges remain separate from drafting; pending authentication,
  model work and independent image checks hold the observed stage. Status configuration never advances the
  ritual. Preserve cold/hold beats rather than success timers. See `apps/codex/src/providers/README.md`.

- `packages/shared/src/forge.ts` defines `ForgePhase`, `ForgeRitualFrame`, `ForgePublicBeat`, the strict finite
  house-part plan and style-kit/placement types. These are public observations, not permission to mint a part.
- `packages/forge/src/ritual.ts` defines `FORGE_RITUAL_SECONDS = 21`, `forgeRitualFrame()` and the core refusal
  gate. Its local frame function always returns `source: 'simulated'`. It starts after local assembly/check/mesh
  succeeds; it is never a stand-in for a pending live model, judge, human pass or durable placement.
- Main is building `packages/forge/**` and `apps/web/src/forge/{scene.ts,ritual-view.ts,sound.ts,index.tsx,forge.css}`:
  finite plan selection, authored assembly, host/socket validation, local checks, baseline ritual and procedural
  audio, the real scene and truthful SIMULATED UI. Read the committed baseline before starting. This lane replaces
  the baseline visual/audio layer at integration; it does not claim baseline work as its own missing foundation.
- `apps/web/src/forge/emitters/index.ts` supplies bounded seekable sparks and landed smoke/glow. Its `update()`
  accepts time, anvil, activity, strike and landed positions; its owner remains main. Reuse through the host or
  existing interface where suitable, without another permanent chimney-emitter system or changes to that folder.
- Spec 09 and `packages/content/src/forge/**` own the authored construction vocabulary. This lane neither creates
  new forged geometry nor parses prompts. The separate sound lane (spec 11) owns general kingdom cues/audio files.

## Rules

1. **R1 — The observation drives the show.** Render exactly the supplied phase/progress. No local timeout may
   advance a live frame, stamp a seal, strike, cool, fly or attach while main still reports an earlier phase.
   Repeated frames may hold indefinitely with a calm, non-escalating pose. Null clears transient effects. Reject
   non-finite presentation values safely. Seeking changes appearance directly; it never produces world facts.
2. **R2 — One complete local ceremony.** The existing simulated sequence is words 0–3 s, blueprint 3–5, pour
   5–11, seal 11–12.2, strike 12.2–12.7, cool 12.7–15.5, flight 15.5–19, landed 19–21. Use `phaseProgress` within
   these stages rather than recomputing phase from total elapsed. Runes are authored unreadable glyphs, never prompt
   letters, raw plan JSON or a person's name. The plan's silhouette becomes the blueprint and actual clone, rather
   than a generic cube. The seal may say “Fit for the realm” only for an externally judged live `seal` or later phase; the local simulation says “Fit for this home · SIMULATED”.
   Give the hammer anticipation, one clean impact and settle; use a short local highlight rather than a fullscreen
   flash. Cooling reveals the retained material palette. Flight begins/ends at supplied world anchors, has a clear
   arc and finishes flush with the actual socket. Main alone commits attachment and enables permanent emitters.
3. **R3 — A presentation clone only.** `piece` is a disposable presentation clone supplied by main; never accept
   the authoritative placed piece. Do not mutate retained home geometry, slot metadata, source materials, approval,
   palette registry, collision, provenance or placement state. Clone any shared material before changing colour,
   clipping or opacity. Never dispose caller-owned geometry/materials. Restore borrowed clone transforms/visibility
   on clear/dispose; dispose only resources created by this adapter. No renderer, camera or animation-loop ownership.
4. **R4 — Sound follows the same facts.** Finish rune gather, blueprint lock, molten pour, seal stamp, hammer
   strike, cooling ticks, flight and landing, plus the nameless cough/sulk sound invoked by the refusal adapter's
   host. No cue for approval, placement or a refusal is inferred from a request. At most one current stage attack
   per ritual/phase; duplicate updates do not strike again. A seek/large clock jump skips expired attacks instead
   of playing a backlog. A phase held pending may sustain a soft bounded texture, never repeated success stings.
5. **R5 — One stream-friendly graph.** Use the host's context and destination; never create/resume/close a context
   or connect directly to `context.destination`. Defaults are muted false, volume 0.65; mute/zero volume immediately
   ramp to silence and stop active owned sources. Suspended/closed audio does not queue cues. Unlock, unmute or tab
   return cannot replay missed events. Dispose stops/disconnects only owned nodes. Use short gain ramps to avoid
   clicks. Cap the entire Forge layer at 12 simultaneously sounding voices and 32 scheduled source nodes; coalesce
   duplicates, retain the current strike/landing over tiny incidental ticks, and bound all tails. At volume 1 the
   isolated Forge demo peaks below 0.95; main balances it with the general kingdom mix during integration.
6. **R6 — Authored sound, with provenance.** Original procedural audio is sufficient if it sounds physical and
   cared for. Optional samples must be CC0 or explicitly permissive with the exact selected-file license retained
   under the owned audio folder. No external runtime fetch, generated speech, soundtrack or generic loot fanfare.
   Record original synthesis and any source URL/license/bytes in the owned README/credits and provide a root-ready
   THIRD_PARTY block for main. Never edit the general sound lane's files, package manifest or root credits.
7. **R7 — A small bounded layer.** Reuse geometry/buffers; no allocations, text canvases or shader recompiles per
   frame. Cap transient particles at 192 total on desktop/stream and 80 on phone, additional draws at 12 and 8,
   and additional lights at one and zero. Do not change scene exposure, fog, bloom or presence-window brightness.
   Make the toy shapes and warm/cool separation carry the moment without a screen of glitter. Main may instantiate
   one adapter per active anvil, so caps are per adapter and must be documented as shared scene costs.
8. **R8 — Truthful bench, accessible motion.** Any fixture, seeded citizen context or ready-made run is visibly
   SIMULATED on every view and capture. Provide a reduced-motion presentation with anvil-to-home dissolve/settle,
   no flight streak/flash and the same truthful stages. It does not change world timing or create another success
   path. No fabricated audience reactions, identity, chat or history. Do not mark numeric waveform checks as proof
   that sound was heard; record actual listening or the listening limitation.

## Contracts

Consume the existing exports from `@chatdom/shared`; do not copy these into a new protocol:

```ts
// ForgePhase: words | blueprint | pour | seal | strike | cool | flight | landed
// ForgeRitualFrame: ritualId, phase, elapsed (seconds), phaseProgress [0,1], duration (seconds),
//                   source: 'simulated' | 'live'
type RefusalBeat = Extract<ForgePublicBeat, { kind: 'refusal' }>;
```

Approved local exports from `apps/web/src/forge/presentation/index.ts`:

```ts
export function createForgePresentation(options: {
  root: THREE.Group;
  anvil: readonly [number, number, number];
  landing: readonly [number, number, number];
  piece: THREE.Object3D; // presentation clone only; supplied/owned by host
}): { update(frame: ForgeRitualFrame | null): void; dispose(): void };
```

Coordinates are world metres, root has identity world transform, and host establishes the clone's final socket
orientation/scale before construction. `anvil` is the work-surface anchor; `landing` is the clone origin at its
validated final transform. The adapter mounts owned effects under `root`, temporarily poses the clone without
reparenting it, and restores its original transform/visibility on clear/dispose. The host samples this alongside
main's existing renderer. Main adapts its internal baseline seam at merge; the lane never edits the baseline.
Use `matchMedia('(prefers-reduced-motion: reduce)')` locally, detach listeners at disposal, and expose the same
choice only in the simulation bench for deterministic review. No extra shared contract is required.

Approved local exports from `packages/audio/src/forge/index.ts`:

```ts
export function createForgeAudio(options: { context: AudioContext; destination: AudioNode }): {
  update(frame: ForgeRitualFrame | null): void;
  refusal(beat: Extract<ForgePublicBeat, { kind: 'refusal' }>): void;
  setMix(settings: { muted: boolean; volume: number }): void;
  dispose(): void;
};
```

Volume is clamped to [0,1]; non-finite values fail safely to silence. Neither adapter receives a prompt, maker,
reason, judge result or persistence handle. Main invokes `refusal()` only for the same admitted public beat given
to the refusal visual adapter. The refusal lane has no audio implementation dependency on this lane; it emits no
private data, and main joins both after review. Main owns audio-context unlock, general sound integration, settings
UI, top-level exports and web/package dependencies. Bench imports the Forge module by relative source path.

## Scope

May write only `apps/web/src/forge/presentation/**`, `packages/audio/src/forge/**`, optional
`apps/web/src/forge-ritual-bench/**`, this spec and `work/lanes/forge-ritual/{PRD.md,progress.txt}`.
The named subtrees include focused tests, capture/demo scripts, concise README and selected-file sound credits.
Ignored generated evidence may land in `shots/forge-ritual/` and `/tmp/chatdom-forge-ritual/`.
Everything else is read-only, particularly `packages/shared`, `packages/forge`, content, root/package manifests,
audio barrel/general sound files, render/world, main's Forge files, `emitters/**`, refusal lane, root shot scripts
and THIRD_PARTY. You are not alone: preserve other edits. Report `needs:` rather than widening scope. Main owns
route hooks, final integration and branch/worktree creation. A standalone Vite HTML bench inside the owned tree
can run at `/src/forge-ritual-bench/index.html` before route integration.

## Acceptance

From repository root, require all four checks green:

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run apps/web/src/forge/presentation packages/audio/src/forge
pnpm build
```

Write one meaningful temporal regression using real adapter state and a minimal real scene clone: repeated/pending
phase cannot seal/strike/land; null and disposal clear owned resources without touching caller assets; different
sample intervals/seek produce the same visual state. Audio browser regression uses the actual graph, checks no
backlog after mute/suspend/seek, duplicate strike suppression and voice/source bounds. Do not snapshot every pose
or duplicate main's parser/assembly/placement tests. The bench uses actual prepared/validated main Forge geometry,
not a separately modelled test cube, and exposes play, seek, hold, clear, reduced motion, mute and volume.

Provide these owned scripts and run them (the capture script can start its own server or accept `--base-url`):

```sh
node apps/web/src/forge-ritual-bench/capture.mjs
node apps/web/src/forge-ritual-bench/audio-demo.mjs
```

Both acquire `acquireCaptureLock` from `packages/testing/capture-lock.mjs` **before** starting any owned preview
or browser. Capture serially with the existing repo Playwright/Chrome/SwiftShader conventions; reuse the repo's
preview helper where applicable. Choose a free port in 5170–5199, leave 5190 for main and 5193/5194 reserved,
record the port, close only owned processes/browser, then release in `finally`. Never remove the host lock or
launch an independent parallel browser. `--base-url` must still acquire the lock. Set `window.__chatdomReady`
only after actual geometry/materials and first meaningful frame are ready; fail on console/page/worker errors.

At dusk capture 1440×900 and 390×844, plus 1920×1080 stream composition and 1280×720 legibility. Take a timed
contact sheet through all eight stages, close views of pour/strike/socket arrival, and pending blueprint hold at
0 s and 30 s with no fake seal. Include one midday and one reduced-motion pass. Write under
`shots/forge-ritual/<stage>@<width>x<height>.png`, open every sheet and representative full frames with
`view_image`, fix clipping, floating, flash washout and generic geometry. Capture a real-graph 21 s ceremony,
short refusal cue, mute segment and two-anvil overlap to `shots/forge-ritual/sequence.wav`, plus `waveform.png`
and numeric duration/peak/node-bound results. Listen through the real browser graph and record timbre findings.
Main runs `pnpm verify`, reviews complete in-app/stream captures and appends credits after integration.
SwiftShader establishes appearance, never real-GPU timing; ask for a hardware check with path/action if needed.

## Quality bar

A handmade toy forge at dusk, with shaped brass, wax and a readable house part; warm sparks against cool air,
not neon wireframes or a loading spinner dressed as magic. There is anticipation and stillness around the strike.
The final millimetre of landing has weight and no wobble through its host roof. Audio is tactile and quiet enough
under the streamer's words, with an unmistakable impact followed by space. Nine viewers get the same authored
care as a capital. Inspect Artstyle §§6/9 and Quality's slop list at phone and stream sizes before calling it done.

## References

- `work/references/prototypes.md`, Lanternmere: take tool-call-aligned choreography and director framing as ideas;
  reimplement here, leave old approval heuristics, rarity, creature grammar and copied source behind.
- `work/references/crowd-animation.md`: stable common time and bounded local state; no random people/reactions,
  no copied unlicensed source, no implied performance from SwiftShader.
- `work/references/sky-fog-time.md`: keep warm subject/cool depth coherent with main's existing sky/light grade;
  no new atmosphere implementation or scene-wide exposure changes.
- `work/specs/09-forge-pieces.md` and `11-sound.md`: use authored real parts and a compatible physical sound
  vocabulary. These are ownership/contract references, not authority to edit those lanes.

## Not now

No parser, model call, grammar, assembler, moderation, minting, publishing, durable provenance, host/socket
validation, economy, coals/anvils, permanent emitters, director policy, live Twitch operation or generic audio
engine. These have existing owners; this handoff grants presentation and Forge-only sound work.

## Decisions

- **2026-10-30 — Main approved both local APIs above.** Shared Forge frames are the only observed run input;
  no shared extension is needed. Main adapts the baseline internally when merging.
- **2026-10-30 — Clone boundary.** The supplied piece must be a presentation clone. Main's authoritative placed
  part remains untouched. Local 21 s timing is explicitly simulated; pending observed gates never advance here.
- **2026-10-30 — Disjoint audio ownership.** This lane owns only `packages/audio/src/forge/**`; spec 11 retains
  its other files. Main connects both to one master and owns package exports/credits/integration.

- **2026-10-30 — Optional production bench hook.** Main registers `apps/web/src/forge-ritual-bench/index.tsx` at `/-/forge-ritual`. It must default-export a Solid component when supplied. No placeholder mounts while the lane is absent.
