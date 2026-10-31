import type { Vec3 } from '@chatdom/shared';
import type { FloaterAction } from './floaters';
import type { Habitat } from './habitat';
import type { LifePlan } from './plan';
import { DABBLE_SLOT, dabbleWindow, daylight, duckPose, FISH_AIRTIME, FISH_SLOT, fishJump, fishLanding, flight, FLIGHT_SLOT, restingPose, type FishJump } from './poses';
import { between, STREAM, unit } from './random';

/**
 * Rings on the water and the discrete sounds of the place's life, both pure functions of the plan and the caller's
 * time. The renderer draws at most `RING_CAP` rings; the host's audio mix plays the sound hooks it is given.
 */
export const RING_CAP = 8;
export const RING_LIFE = 2.8;

export interface Ring {
  readonly x: number; readonly y: number; readonly z: number;
  readonly start: number;
  /** Final radius, metres. */
  readonly radius: number;
  /** 0..1. */
  readonly strength: number;
  /** Higher keeps its place first when more rings want drawing than the cap allows. */
  readonly priority: number;
}

const scratch = restingPose();

function fishRings(jump: FishJump, out: Ring[]): void {
  const [ex, ez] = fishLanding(jump);
  out.push({ x: jump.x, y: jump.level, z: jump.z, start: jump.start + 0.06, radius: 0.55, strength: 0.55, priority: 2 });
  out.push({ x: ex, y: jump.level, z: ez, start: jump.start + FISH_AIRTIME, radius: 1.35, strength: 1, priority: 3 });
  out.push({ x: ex, y: jump.level, z: ez, start: jump.start + FISH_AIRTIME + 0.32, radius: 0.85, strength: 0.7, priority: 3 });
}

/** Every ring alive at `time`, strongest claims first, at most `RING_CAP`; `wanted` counts all that were alive. */
export function ringsAt(plan: LifePlan, habitat: Habitat, floaters: readonly FloaterAction[], time: number): { rings: Ring[]; wanted: number } {
  const all: Ring[] = [];
  const k = Math.round(time / FISH_SLOT);
  for (const slot of [k - 1, k, k + 1]) { const jump = fishJump(plan, habitat, slot); if (jump) fishRings(jump, all); }
  // A duck's bill breaks the water as it tips up to feed.
  const d = Math.floor(time / DABBLE_SLOT);
  for (const pair of plan.ducks) for (const member of [0, 1] as const) for (const slot of [d - 1, d]) {
    const window = dabbleWindow(plan.seed, pair.index, member, slot);
    if (!window) continue;
    const at = window[0] + 0.35, pose = duckPose(plan, pair, member, at, scratch);
    all.push({ x: pose.x + Math.sin(pose.yaw) * 0.3, y: pose.y, z: pose.z + Math.cos(pose.yaw) * 0.3, start: at, radius: 0.5, strength: 0.45, priority: 1 });
  }
  for (const f of floaters) {
    const water = habitat.waterAt(f.from[0], f.from[1]);
    if (water) all.push({ x: f.from[0], y: water.level, z: f.from[1], start: f.launched, radius: 0.8, strength: 0.6, priority: 2 });
  }
  const alive = all.filter(r => time >= r.start && time < r.start + RING_LIFE)
    .sort((a, b) => b.priority - a.priority || b.start - a.start || a.x - b.x || a.z - b.z);
  return { rings: alive.slice(0, RING_CAP), wanted: alive.length };
}

export type WaterLifeSoundKind = 'fish-leap' | 'fish-splash' | 'duck' | 'heron' | 'kingfisher' | 'floater';
/** A one-shot sound for the host's audio mix: what, where and the caller time it belongs to. */
export interface WaterLifeSound { readonly kind: WaterLifeSoundKind; readonly position: Vec3; readonly time: number; readonly source: string }

/** A step longer than this is a seek: nothing is played for the time skipped. */
export const SOUND_SPAN = 2;
const DUCK_CALL_SLOT = 23;
const HERON_CALL_SLOT = 80;

/**
 * Discrete sounds in (from, to], in time order. A backward or long step returns nothing: a seek never replays a
 * burst of splashes. Kingfisher calls keep its daylight hours, as its flights do.
 */
export function soundsBetween(plan: LifePlan, habitat: Habitat, floaters: readonly FloaterAction[], from: number, to: number, hour: number): WaterLifeSound[] {
  if (!(to > from) || to - from > SOUND_SPAN) return [];
  const out: WaterLifeSound[] = [];
  const keep = (sound: WaterLifeSound) => { if (sound.time > from && sound.time <= to) out.push(sound); };
  for (let slot = Math.floor(from / FISH_SLOT) - 1; slot <= Math.floor(to / FISH_SLOT) + 1; slot++) {
    const jump = fishJump(plan, habitat, slot);
    if (!jump) continue;
    const [ex, ez] = fishLanding(jump);
    keep({ kind: 'fish-leap', position: [jump.x, jump.level, jump.z], time: jump.start, source: `fish:${slot}` });
    keep({ kind: 'fish-splash', position: [ex, jump.level, ez], time: jump.start + FISH_AIRTIME, source: `fish:${slot}` });
  }
  for (const pair of plan.ducks) for (let slot = Math.floor(from / DUCK_CALL_SLOT); slot <= Math.floor(to / DUCK_CALL_SLOT); slot++) {
    if (unit(plan.seed, STREAM.duckCall, pair.index, slot, 1) >= 0.5) continue;
    const time = slot * DUCK_CALL_SLOT + between(1, DUCK_CALL_SLOT - 2, plan.seed, STREAM.duckCall, pair.index, slot, 2);
    const pose = duckPose(plan, pair, 0, time, scratch);
    keep({ kind: 'duck', position: [pose.x, pose.y, pose.z], time, source: pair.id });
  }
  if (plan.heron) for (let slot = Math.floor(from / HERON_CALL_SLOT); slot <= Math.floor(to / HERON_CALL_SLOT); slot++) {
    if (unit(plan.seed, STREAM.heronCall, slot, 1) >= 0.3) continue;
    keep({ kind: 'heron', position: plan.heron.position, time: slot * HERON_CALL_SLOT + between(3, HERON_CALL_SLOT - 3, plan.seed, STREAM.heronCall, slot, 2), source: 'heron' });
  }
  if (daylight(hour)) for (let slot = Math.floor(from / FLIGHT_SLOT); slot <= Math.floor(to / FLIGHT_SLOT); slot++) {
    const f = flight(plan, habitat, slot);
    if (!f) continue;
    const p = f.reach.points[Math.min(f.reach.points.length - 1, Math.max(0, Math.round((f.from / f.reach.length) * (f.reach.points.length - 1))))]!;
    keep({ kind: 'kingfisher', position: [p.position[0], p.level + 0.55, p.position[1]], time: f.start, source: `kingfisher:${slot}` });
  }
  for (const f of floaters) {
    const water = habitat.waterAt(f.from[0], f.from[1]);
    if (water) keep({ kind: 'floater', position: [f.from[0], water.level, f.from[1]], time: f.launched, source: f.id });
  }
  return out.sort((a, b) => a.time - b.time || (a.source < b.source ? -1 : 1));
}
