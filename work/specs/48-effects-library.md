# Spec 48: Effects library · status: frozen 2026-10-31

Vision: `chatdom/ChatDom.md` and `chatdom/Artstyle-Soul-Feel.md` §§1–3, 6, 16; `chatdom/Quality.md` §§2, 4. The kingdom is a handmade toy at dusk, lit by its people. Ambient life stays quiet; a real moment can briefly become spectacular.

## What and why

Give the existing world one coherent, reusable vocabulary of small moving lights and air: fireflies, embers, sparks, short curling chimney smoke, dust visible within real shafts, and the Forge flight's magic trail. Effects reinforce real places and events; they never manufacture presence. They belong in the existing Three.js HDR scene and bloom response, with readable source-sized glow and controlled coverage.

## Current state

`packages/render/src/post-stack.ts` owns existing HDR/bloom; `packages/shared/src/voxel.ts` supplies `Vec3` in metres. `apps/web/src/forge/ritual-view.ts` and `apps/web/src/forge/refusal/layers.ts` demonstrate current event-driven presentation and emitters; scene, home-life and Forge adapters remain main-thread ownership. Existing references `work/references/magic-lighting.md` and `work/references/post-stack.md` set the lighting and source boundary. No shared contract change is required.

## Rules

1. Inputs are actual source positions and real event phases from the caller. No inferred occupancy, fake windows, floating door puffs, automatic event starts, or synthetic citizens. No source means no effect.
2. A chimney emits short, soft grey non-emissive curling smoke from its actual mouth, carried by supplied wind. Dust appears only inside a caller-supplied real light shaft volume. Neither is a glowing beam. Fireflies and embers are sparse, warm and slow; strong sparks and a flight trail are bounded and cue-driven.
3. Particles read as crafted, small pixel-like quads, not point-sprite blobs. Respect depth, voxel silhouettes, transparency and the existing HDR/bloom stack. Avoid white veils and excessive additive coverage. Ambient effects should not compete with homes, avatars or text.
4. Seed and caller-provided effect clock determine poses. Same inputs at the same time produce the same frame regardless of frame rate, seek or update order; reset and disposal are explicit. No wall clock, random global state, hidden timers, authority or persistence.
5. Bound counts, lifetime, coverage, allocations and overdraw independently at `low`, `balanced`, `high`. Tier changes must be safe at runtime. Preserve readable silhouettes and actual cue on lower tiers. Do not claim software FPS or invent a performance-proof matrix.
6. Handle source removal, cue changes, seeking and invalid/non-finite inputs without orphaned emitters or leaks. Dispose owned geometry/materials and detach owned objects idempotently; caller owns scene, camera and input data. No new cameras, post stack, night grade, network protocol or shared schema.

## Contracts

Private renderer API, implemented/exported from `packages/render/src/effects/index.ts`; main may make the types available to its first consumer. It uses the existing `Vec3` and `THREE.Camera` types. Positions, wind and shaft dimensions are world metres, time is seconds. Arrays are snapshots for the current frame; stable IDs identify sources, not people. Callers translate their real source/phase state to this API.

```ts
import type { Vec3 } from '@chatdom/shared';
import type * as THREE from 'three';
export type EffectsQuality = 'low' | 'balanced' | 'high';
export type EffectSource = { id: string; position: Vec3 };
export type EffectsFrame = {
  time: number; wind: Vec3;
  fireflies?: readonly EffectSource[];
  embers?: readonly EffectSource[];
  smoke?: readonly EffectSource[];
  dust?: readonly (EffectSource & { direction: Vec3; length: number; radius: number })[];
  sparks?: readonly (EffectSource & { burstId: string; startedAt: number })[];
  flight?: { id: string; position: Vec3; startedAt: number; active: boolean; history?: readonly { time: number; position: Vec3 }[] } | null;
};
export function createEffects(options: { scene: THREE.Scene; camera: THREE.Camera; seed: number; quality: EffectsQuality }): {
  update(frame: EffectsFrame): void;
  setQuality(quality: EffectsQuality): void;
  reset(): void;
  dispose(): void;
};
```

`burstId` identifies a discrete cue and `startedAt` its effect-clock origin; an unchanged burst cannot restart each frame. `flight.position` is the real animated piece position at this frame, not an invented trajectory. Trail reconstruction is deterministic under seeks: caller supplies bounded real position history with effect-clock timestamps; without history show only the current-position glint. Never invent the path. `reset()` clears transient history and allows replay with the same seed; ambient deterministic state is reconstructed on update. If the production Forge phase requires additional samples, write a concrete `needs:` line for main instead of inventing its path.

## Scope

Lane owns only new `packages/render/src/effects/**`, including a self-contained library bench and focused tests there. Main owns `apps/web` scene/home-life/Forge adapters, replacement of old emitters, exports outside this folder and any shared types. Do not edit these or other folders. A bench may run from this folder without changing the app: use the existing renderer dependencies and a local capture entry. Coordinate a real main-stream cue with main; if wiring is unavailable, deliver the exact adapter call and `needs:` rather than blocking remaining work.

## Acceptance

- Run focused effects tests and typecheck/build applicable to the repository; record exact commands and results. Test deterministic seek/reset, bounds per tier, removal, burst identity and disposal, including malformed numeric inputs.
- Each coherent visual change: capture one deterministic 1920×1080 still and open it with `view_image`; record its path and what remains weak. A short clip is required only when motion itself cannot be judged from the still. Use existing look workflow and SwiftShader; its speed is not performance evidence. Bench inputs are visibly labelled SIMULATED.
- Demonstrate every effect in the library bench and supply a real existing main-stream cue integration or a precise main-owned adapter `needs:` with sample inputs and evidence. Main must actually wire and judge the cue before calling the integrated feature done.

## Quality bar

Grey smoke curls briefly and dissipates above the chimney, not as a white stack. Dust is modest, visible only in actual shafts. A firefly glints; it does not become a floating lamp. Sparks and Forge flight resolve quickly and remain legible against the world. Judge the image against `chatdom/Artstyle-Soul-Feel.md` and `chatdom/Quality.md`, fix generic or off-palette work, and report remaining weaknesses.

## References

- `work/references/magic-lighting.md`: source-sized bloom, sparse particles, bounded density and independent ideas from Minecraft shader packs and Teardown.
- `work/references/post-stack.md`: HDR ordering, current scene contract and limits. Complementary, BSL and Teardown are technique/visual references only; do not copy code.

## Not now

No camera, grade, post-processing, presence authority, shared schema, persistent simulation or invented event. No blanket emitter replacement by this lane.

## Decisions

- 2026-11-01: EL11 is a Forge art pass on the existing event inputs, not a new protocol or system.
  Main has mounted flight in kingdom/stream (b2251ee), with actual posed piece history and separate real/SIM
  clocks. The point-only trail and a joined-glint experiment remain too sparse at stream distance. A bounded
  world-space ribbon is allowed for a coherent wake; retain depth occlusion, reduced-motion behavior and
  phone degradation. Landing uses the existing supplied burst contact/time. Keep other emitters unchanged;
  do not replace the accepted home smoke. Main owns runtime adoption. EL11 needs one real-scale before/after
  and scoped checks, superseding the old full screenshot matrix for this task.

- 2026-10-31: Freeze the private factory above as the narrow integration seam; main owns adapters and existing emitters. Prior reference studies suffice for this lane; implement ideas independently.
