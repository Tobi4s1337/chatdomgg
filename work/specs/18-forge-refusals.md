# Spec 18: the forge has a little mood

Status: **frozen 2026-10-30.** Main approved the local adapter below. Ready for the team to branch only after
main commits the shared Forge contracts, their tests and baseline consumer. Main creates the worktree.
Vision: `chatdom/ChatDom.md` principle 15, principles 16–18; `chatdom/Moments.md` §3;
`chatdom/Safety.md` §§2, 5.2–5.3 and Decided; `chatdom/Quality.md` rules 2, 8–11, 17;
`chatdom/Artstyle-Soul-Feel.md` §§6, 9, 17.

## What and why

The forge coughs a small soot puff, loses a little of its fire, pauses in a comic sulk, and settles back into
being a forge. A short line says “The forge is in a mood tonight.” That is the whole public story. Nobody can
tell what was asked, who asked it, or why it was refused. The beat is a rare piece of place character, never a
public verdict on a citizen. Give it an authored anticipation, cough, pause and recovery that is kind rather
than mocking. Keep it small enough that it does not compete with a successful creation or reward someone for
trying to provoke it. Main schedules the rare anonymous public beat; this lane makes that already-admitted
beat worth watching and preserves its privacy boundary.

## Current state

- `packages/shared/src/forge.ts` defines `ForgePublicBeat` as work observations or `{ kind: 'refusal';
  variant: 0 | 1 | 2 }`, with no maker, prompt, reason, asset, avatar, timestamp or request identifier.
  `FORGE_REFUSAL_INTERVAL_MS` is 600,000. Import this projection rather than inventing a richer refusal event.
- `packages/forge/src/ritual.ts` supplies `createForgeRefusalGate()`. Main owns the ten-minute gate and any
  random-window selection/delay, director priority and public eligibility. The current local gate only enforces
  the interval; it does not prove live delayed selection or grant live moderation capability.
- Main is implementing the local SIMULATED Forge core/scene/UI under `packages/forge/**` and
  `apps/web/src/forge/{scene.ts,ritual-view.ts,sound.ts,index.tsx,forge.css}`. Read the committed baseline before
  starting. Main handles private outcome text and any immediate local feedback; this public adapter does neither.
- `apps/web/src/forge/emitters/**` belongs to main; it provides successful-ritual sparks and landed smoke/glow.
  Do not edit it or recolour the permanent home emitter to mark a refusal. Keep this beat local to the forge.
- Spec 17's `packages/audio/src/forge/**` owns the generic public cough/sulk sound through a host-supplied graph.
  Main invokes its `refusal(beat)` alongside this visual adapter. This lane can deliver its visual bench without
  that branch merged; absence of its audio in the bench must be stated plainly, never faked or silently claimed.

## Rules

1. **R1 — Only the minimal public beat enters.** The adapter accepts the refusal arm of `ForgePublicBeat`,
   and only that arm. No request, prompt fragment, maker/name, avatar, house, reason, verdict, limit category,
   refusal count, raw private error, source chat line or retained audit object may enter the adapter, caption,
   scene userData, DOM attributes, diagnostic export or capture. Do not accept a full request and “strip it later.”
   No telemetry or console log of private inputs. Anonymous presentation is structural, not a visibility toggle.
2. **R2 — One same shared pool for every cause.** Author exactly these three generic lines, selected only by
   the supplied variant: 0 “The forge is in a mood tonight.”; 1 “The bellows need a little breather.”;
   2 “Even the anvil has its moments.” All variants have the same choreography, bounds and duration. No harsher
   or funnier variant for harm, no hint through sound, colour, timing or text length, no generated text, no
   reason-dependent pool and no attributed quotation. Set caption text with `textContent`, never `innerHTML`.
3. **R3 — A complete short comic beat.** Target a 3.6 s authored sequence: 0–0.25 s small bellows/anvil-side
   anticipation, 0.25–0.8 s one soft soot cough, 0.8–2.3 s quiet sulk with a slight local ember dip, 2.3–3.6 s
   recovery and clean settle. The caption appears after the cough begins and fades before the end. The forge
   keeps its toy weight; no full-building squash, shaking camera, fullscreen flash, punishment bell, alarm or
   giant red refusal stamp. Nothing flies to a home. Only adapter-owned decorative details/embers move; main's
   actual forge building, scene lights and authored meshes remain unchanged. Tune within these intentions after
   looking; record final timings in the owned README, keep the published duration at most 4 s.
4. **R4 — Host decides when, where and whether.** `play()` receives an already-gated and already-delayed beat.
   Do not subscribe to private outcomes, run a second ten-minute gate, choose refusals from chat or schedule a
   future public beat yourself. No use of `Date.now()`, timers, asynchronous queue, fetch or request-driven
   clock. The host calls `update(elapsedSeconds)` with time since admitted `play`, and removes the identity UI
   and any identifiable accepted-request context before starting the detached anonymous shot. This lane can
   document that precondition and demonstrate it in the bench; it must not claim to enforce main's real director.
5. **R5 — No linking a citizen to the beat.** The view is the forge/anvil only. No nearby citizen, nameplate,
   prompt field, previous accepted maker/part title, house marker, recent-request list or chat bubble accompanies
   it. No camera pan from a citizen to the forge, line to a home, icon above a body, soot on a person, public coal
   change or persistent stain. Main owns framing and clearing existing identity UI; the adapter never searches
   the DOM/scene for private state. Its own fixtures use no identifiable surrounding people. Nothing remains in
   the world, citizen card, history or Chronicle from this beat.
6. **R6 — Seekable and safely interruptible.** `play()` resets the adapter-owned animation/caption to zero;
   if already active, ignore additional `play()` calls and do not queue them. Invalid elapsed values clear
   safely; negative time clamps to zero. The current pose is derived from supplied elapsed time, so skipped
   samples and tab return settle immediately without repeated coughs. After duration, hide/clear every owned
   effect and caption. Disposal is idempotent, removes only owned resources and clears its caption; later calls
   do nothing. Do not remove unrelated root children or dispose caller materials. Main suppresses duplicate
   delivery and prevents overlapping successful/refusal presentations; the public beat has no invented ID.
7. **R7 — Quiet, bounded and accessible.** At most 24 pooled soot particles, four extra draws, zero new lights,
   no per-frame geometry/material/text-canvas allocation. The same cap works on phones. Use a soft grey-brown
   puff visible against dusk without a flat black cloud or glitter. Reduced motion keeps the caption and a
   modest ember dip/fade, drops positional wobble and soot travel, and has the same timing. Respect the local
   `prefers-reduced-motion` setting, detach listeners on disposal, and let the bench force either choice for
   deterministic review. No urgent alert/live-region barrage or focus stealing; one polite caption update is
   enough. Audio, once main joins spec 17, shares the normal master mute/volume and the same generic cue.
8. **R8 — Demonstrate honestly.** Every local fixture/control/capture visibly says SIMULATED. A bench button
   calls this already-admitted projection directly and says it is previewing a public beat; it does not pretend
   to submit, judge or refuse a real citizen request. No live Twitch writes/services or fake successful safety
   checks. The real 10-minute gate, delayed selection, private maker explanation and stream-pass behavior remain
   main's integration responsibility, stated explicitly in evidence.

## Contracts

Import `ForgePublicBeat` from `@chatdom/shared`. Main approved this lane-local export from
`apps/web/src/forge/refusal/index.ts`:

```ts
export function createForgeRefusalPresentation(options: {
  root: THREE.Group;
  anvil: readonly [number, number, number];
  caption: HTMLElement;
}): {
  play(beat: Extract<ForgePublicBeat, { kind: 'refusal' }>): void;
  update(elapsedSeconds: number): void;
  dispose(): void;
};
```

`root` has identity world transform and contains only host-managed scene children plus this adapter's own group.
`anvil` is the work-surface anchor in world metres. `caption` is a dedicated empty host-owned node, already
positioned in the anonymous forge shot; the adapter owns only its text/visibility/accessibility presentation
while mounted. No arbitrary selectors, markup, templated strings, scene traversal or UI replacement. Export small
caption styles from the owned subtree if needed; main imports them when integrating. `play()` accepts only
variants 0/1/2 and ignores malformed runtime values. `update()` samples seconds since the last admitted play;
it never advances core time. Root is initially inert and caption empty; first output follows a supplied beat.
Main passes the same public beat to spec 17's Forge audio `refusal()` method. There is no callback containing a
reason and no audio implementation in this lane. A public beat has neither event ID nor origin; do not retrofit
identity fields. Main owns producer deduplication and SIMULATED/live source labeling at the outer surface.

## Scope

May write only `apps/web/src/forge/refusal/**`, optional `apps/web/src/forge-refusal-bench/**`, this spec and
`work/lanes/forge-refusals/{PRD.md,progress.txt}`. These subtrees may include focused tests, capture script and a
concise adapter README. Ignored generated evidence may land in `shots/forge-refusals/` or
`/tmp/chatdom-forge-refusals/`. Everything else is read-only: `packages/shared`, `packages/forge`, all audio,
content/render/world, main's Forge files, `emitters/**`, ritual presentation, root manifests/lockfile/credits,
route hooks and shared shot scripts. You are not alone: preserve others' edits and report `needs:` to main.
No root package scripts, new dependency, private moderation service or stand-in safety engine. A standalone
Vite HTML bench at `/src/forge-refusal-bench/index.html` runs before main adds an optional route hook.

## Acceptance

From the repository root, require all checks green:

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run apps/web/src/forge/refusal
pnpm build
node apps/web/src/forge-refusal-bench/capture.mjs
```

Build one focused sequence regression with actual scene/adapter and caption behavior, rather than a snapshot
per phrase: all three allowed variants select only the fixed generic pool; repeated active `play` does not
extend/queue the beat; seek past completion and disposal clear owned effects/caption; parent scene/borrowed
assets remain; no person/request fields exist on the adapter input. Browser checks use the real built bench,
verify all variants and reduced motion, and fail on DOM overflow, raw errors and console/page/worker errors.
Do not duplicate main's gate/economy/moderation tests or claim a bench button proves real refusal admission.

The owned capture script imports `acquireCaptureLock` from `packages/testing/capture-lock.mjs` before starting
an owned preview or browser; keep capture serial and release only after both close in `finally`. Follow the
repo Chrome/SwiftShader shot conventions and reuse its preview helper where suitable. Select a free port in
5170–5199, keep 5190 for main and 5193/5194 reserved, record it and stop only processes you created. An optional
`--base-url` still acquires the lock. Never delete/recreate the host lock file or launch a second parallel browser.
Wait for `window.__chatdomReady` after actual assets and the first meaningful frame, never a fixed load timeout.

Capture 1440×900 and 390×844, plus a 1920×1080 anonymous stream composition and 1280×720 legibility pass.
Use dusk and a fixed seed/time. Under `shots/forge-refusals/`, save a timed anticipation/cough/sulk/recovery/clear
contact sheet; full phone and stream cough/sulk frames; one midday puff check; and reduced-motion comparison.
Open every sheet and representative full frames with `view_image`. Verify the same movement for all three lines,
no maker context anywhere in the viewport, no clipped caption, no stale text after 3.6–4 s, and no residual soot.
Judge humour by the place's restrained pause, not amount of motion. Main reviews the integrated detached public
shot, sound, ten-minute gate and delayed selection, then runs `pnpm verify`. A real-GPU timing claim requires
hardware evidence; SwiftShader frames establish appearance only. No panel capture is required for a lane that
owns neither panel nor its route.

## Quality bar

A little place with a personality, never a public shaming animation or error toast. The puff has a soft authored
silhouette, the sulk leaves room for a smile, and the last frame is an ordinary clean forge. Words read easily
at 390 px, use the existing carved/parchment vocabulary, and do not compete with the scene. There must be no way
to distinguish “not a house part” from harm by studying this beat. Its rarity, delay and namelessness come from
main; this layer preserves that modest scale and has no hooks around which someone can rebuild attribution.

## References

- `work/references/prototypes.md`, Lanternmere: separate presentation choreography from reducer/safety facts;
  take shot clarity as an idea only, leave prototype moderation and attribution behind.
- `work/references/crowd-animation.md`: anticipation/pose/settle, common time and bounded state; no people,
  crowd reactions or copied unlicensed source are needed for this place-only beat.
- `work/references/sky-fog-time.md`: keep soot and ember colours inside main's dusk/sky/light grade; do not
  black out the forge or modify scene exposure to make the effect legible.
- Spec 17: same public beat goes to its Forge-only audio adapter after main merges the lanes; no shared writes.

## Not now

No moderation parser/policy, judge API, private maker explanation, appeal/hold UI, public rejection history,
request sampling/selection/delay, ten-minute rate gate, producer deduplication, director control, economy,
coals/anvils, real Twitch operation, new townsfolk or general audio. Those remain with their existing owners.

## Decisions

- **2026-10-30 — Main approved the minimal local adapter.** Its sole event input is the refusal union arm;
  no shared protocol changes or private request access are necessary.
- **2026-10-30 — Detached anonymous framing is a host precondition.** Main clears identity UI/accepted-request
  context before admitting the delayed public beat. This lane demonstrates an anonymous shot, never infers
  anonymity merely because its own caption omits a name.
- **2026-10-30 — Equal public shape, private explanation elsewhere.** Three fixed generic phrases share one
  same choreography and cue regardless of cause; no refusal-specific sound, punishment or persistent trace.

- **2026-10-30 — Optional production bench hook.** Main registers `apps/web/src/forge-refusal-bench/index.tsx` at `/-/forge-refusal`. It must default-export a Solid component when supplied. No placeholder mounts while the lane is absent.
