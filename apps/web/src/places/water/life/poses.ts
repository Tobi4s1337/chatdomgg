import type { Vec3 } from '@chatdom/shared';
import { alongCourse, type WaterReach } from '../../../../../../packages/world/src/places/water/reaches';
import { inStill, onWalk, openWater, type Habitat } from './habitat';
import { FLIGHT_MAX, FLIGHT_MIN, loopAt, type DragonflyHome, type DuckPair, type HeronPerch, type LifePlan } from './plan';
import { between, STREAM, unit } from './random';

/**
 * Where every creature is at the caller's time. Pure: the same plan, time and hour always give the same pose,
 * forward or backward. Angles follow the voxel parts' axes: +Z forward, so `yaw = atan2(dx, dz)`; positive `pitch`
 * tips the nose down; positive `roll` lowers the left (+X) side.
 */
export interface Pose {
  x: number; y: number; z: number;
  yaw: number; pitch: number; roll: number;
  headYaw: number; headPitch: number;
  /** Wing lift for fliers, radians: both wings mirror it. */
  wing: number;
  visible: boolean;
}
export const restingPose = (): Pose => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, headYaw: 0, headPitch: 0, wing: 0, visible: false });

const smoothstep = (a: number, b: number, t: number) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
const TAU = Math.PI * 2;

// ── Ducks ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** How far the follower trails its leader along the loop, metres. */
const DUCK_LAG = 0.85;
/** A duck tips up to feed in at most one window of each slot. */
export const DABBLE_SLOT = 12;
const DABBLE_LENGTH = 2.8;

/** Arc length the pair's leader has travelled by `time`: mean speed plus two bounded surges, never backwards. */
export function duckTravel(pair: DuckPair, time: number): number {
  const [[a, wa, pa], [b, wb, pb]] = pair.surge;
  return pair.phase + pair.direction * (pair.speed * time + (a / wa) * (Math.sin(wa * time + pa) - Math.sin(pa)) + (b / wb) * (Math.sin(wb * time + pb) - Math.sin(pb)));
}

/** The feeding window a duck holds in a slot, or null. */
export function dabbleWindow(seed: number, pair: number, member: number, slot: number): readonly [number, number] | null {
  if (unit(seed, STREAM.duckDabble, pair, member, slot, 1) >= 0.38) return null;
  const start = slot * DABBLE_SLOT + between(1.5, DABBLE_SLOT - DABBLE_LENGTH - 0.6, seed, STREAM.duckDabble, pair, member, slot, 2);
  return [start, start + DABBLE_LENGTH];
}
function dabble(seed: number, pair: number, member: number, time: number): number {
  const window = dabbleWindow(seed, pair, member, Math.floor(time / DABBLE_SLOT));
  if (!window) return 0;
  return smoothstep(window[0], window[0] + 0.45, time) * (1 - smoothstep(window[1] - 0.5, window[1], time));
}

/** Pose of one bird of a pair: member 0 leads. */
export function duckPose(plan: LifePlan, pair: DuckPair, member: 0 | 1, time: number, out: Pose): Pose {
  const s = duckTravel(pair, time) - (member ? pair.direction * DUCK_LAG : 0);
  const at = loopAt(pair.loop, s);
  const phase = pair.index * 1.7 + member * 2.3;
  // The follower drifts a little to either side of its leader's line.
  const side = member ? 0.22 * Math.sin(0.11 * time + phase) : 0;
  const tx = at.tx * pair.direction, tz = at.tz * pair.direction;
  const feed = dabble(plan.seed, pair.index, member, time);
  out.x = at.x - tz * side; out.z = at.z + tx * side;
  out.y = pair.loop.level + 0.012 * Math.sin(1.9 * time + phase) - 0.02 * feed;
  out.yaw = Math.atan2(tx, tz) + 0.08 * Math.sin(0.37 * time + phase);
  out.pitch = 0.62 * feed + 0.02 * Math.sin(1.9 * time + phase + 1);
  out.roll = 0.035 * Math.sin(1.3 * time + phase);
  // Looking about between feeds; head right down while tipping up.
  out.headYaw = (1 - feed) * 0.55 * Math.sin(0.23 * time + phase) * smoothstep(0.2, 0.8, Math.abs(Math.sin(0.071 * time + phase)));
  out.headPitch = 1.15 * feed + (1 - feed) * 0.08 * Math.sin(0.9 * time + phase);
  out.wing = 0; out.visible = true;
  return out;
}

// ── Heron ────────────────────────────────────────────────────────────────────────────────────────────────────────
const HERON_TURN_SLOT = 55;
const HERON_PEER_SLOT = 17;
function heronYaw(plan: LifePlan, perch: HeronPerch, slot: number): number {
  return perch.facing + between(-0.55, 0.55, plan.seed, STREAM.heron, slot, 1);
}
export function heronPose(plan: LifePlan, perch: HeronPerch, time: number, out: Pose): Pose {
  // The heron shifts its stance once in a while, turning over a second and a half.
  const slot = Math.floor(time / HERON_TURN_SLOT), into = time - slot * HERON_TURN_SLOT;
  const turn = smoothstep(0, 1.5, into);
  out.yaw = heronYaw(plan, perch, slot - 1) + (heronYaw(plan, perch, slot) - heronYaw(plan, perch, slot - 1)) * turn;
  const peerSlot = Math.floor(time / HERON_PEER_SLOT), peerStart = peerSlot * HERON_PEER_SLOT + between(2, 11, plan.seed, STREAM.heron, peerSlot, 2);
  const peering = unit(plan.seed, STREAM.heron, peerSlot, 3) < 0.4 ? smoothstep(peerStart, peerStart + 0.8, time) * (1 - smoothstep(peerStart + 3, peerStart + 3.8, time)) : 0;
  [out.x, out.y, out.z] = perch.position;
  out.pitch = 0.12 * peering; out.roll = 0;
  out.headYaw = (1 - peering) * 0.38 * Math.sin(0.17 * time + 0.6) * smoothstep(0.3, 0.9, Math.abs(Math.sin(0.043 * time)));
  out.headPitch = 0.45 * peering + 0.03 * Math.sin(0.6 * time);
  out.wing = 0; out.visible = true;
  return out;
}

// ── Fish ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A fish jumps once per slot at a seeded moment, so consecutive jumps lie 20–40 s apart. */
export const FISH_SLOT = 30;
export const FISH_JITTER = 5;
export const FISH_AIRTIME = 0.85;
const FISH_HEIGHT = 0.42;
const FISH_TRAVEL = 0.65;

export interface FishJump { readonly slot: number; readonly start: number; readonly x: number; readonly z: number; readonly level: number; readonly heading: number }

/** The jump of slot `slot`, or null when the seeded water has no clear deep spot this time. */
export function fishJump(plan: LifePlan, habitat: Habitat, slot: number): FishJump | null {
  if (!plan.fishWaters.length) return null;
  const total = plan.fishWaters.reduce((sum, w) => sum + w.weight, 0);
  let pick = unit(plan.seed, STREAM.fish, slot, 1) * total, water = plan.fishWaters[0]!.water;
  for (const w of plan.fishWaters) { if ((pick -= w.weight) < 0) { water = w.water; break; } }
  for (let attempt = 0; attempt < 10; attempt++) {
    const r = 0.8 * Math.sqrt(unit(plan.seed, STREAM.fishSite, slot, attempt, 1)), a = unit(plan.seed, STREAM.fishSite, slot, attempt, 2) * TAU;
    const [x, z] = inStill(water, r * Math.cos(a), r * Math.sin(a));
    const level = openWater(habitat, x, z, 0.45, 1);
    if (level !== null) return { slot, start: slot * FISH_SLOT + between(-FISH_JITTER, FISH_JITTER, plan.seed, STREAM.fish, slot, 2), x, z, level, heading: unit(plan.seed, STREAM.fish, slot, 3) * TAU };
  }
  return null;
}

/** The jump in the air at `time`, if any: a jump's window never reaches past a neighbouring slot. */
export function fishInAir(plan: LifePlan, habitat: Habitat, time: number): FishJump | null {
  const k = Math.round(time / FISH_SLOT);
  for (const slot of [k - 1, k, k + 1]) {
    const jump = fishJump(plan, habitat, slot);
    if (jump && time >= jump.start && time < jump.start + FISH_AIRTIME) return jump;
  }
  return null;
}

/** Where a jump re-enters the water. */
export const fishLanding = (jump: FishJump): readonly [number, number] =>
  [jump.x + Math.sin(jump.heading) * FISH_TRAVEL / 2, jump.z + Math.cos(jump.heading) * FISH_TRAVEL / 2];

export function fishPose(jump: FishJump | null, time: number, out: Pose): Pose {
  if (!jump) { out.visible = false; return out; }
  const t = (time - jump.start) / FISH_AIRTIME, dx = Math.sin(jump.heading), dz = Math.cos(jump.heading);
  out.x = jump.x + dx * (t - 0.5) * FISH_TRAVEL; out.z = jump.z + dz * (t - 0.5) * FISH_TRAVEL;
  out.y = jump.level - 0.12 + (4 * FISH_HEIGHT + 0.24) * t * (1 - t) + 0.12 * t;
  out.yaw = jump.heading; out.pitch = -1.15 * (1 - 2 * t); out.roll = 0.25 * Math.sin(t * Math.PI);
  out.headYaw = out.headPitch = out.wing = 0; out.visible = true;
  return out;
}

// ── Kingfisher ───────────────────────────────────────────────────────────────────────────────────────────────────
export const FLIGHT_SLOT = 45;
const FLIGHT_SPEED = 6.5;
const FLIGHT_HEIGHT = 0.55;
/** Daylight hours a kingfisher keeps. */
export const KINGFISHER_HOURS: readonly [number, number] = [6.5, 20.5];

export interface Flight { readonly slot: number; readonly reach: WaterReach; readonly start: number; readonly duration: number; readonly from: number; readonly length: number; readonly direction: 1 | -1 }

/** The point and level of a reach at arc length `s`. */
const courses = new WeakMap<WaterReach, { xs: number[]; zs: number[]; levels: number[] }>();
function onReach(reach: WaterReach, s: number): { x: number; z: number; level: number } {
  const p = reach.points;
  let c = courses.get(reach);
  if (!c) courses.set(reach, c = { xs: p.map(q => q.position[0]), zs: p.map(q => q.position[1]), levels: p.map(q => q.level) });
  return { x: alongCourse(p, c.xs, s), z: alongCourse(p, c.zs, s), level: alongCourse(p, c.levels, s) };
}

/** The dash of slot `slot`, or null: it may skip a slot, and it never passes over or under a walk too closely. */
export function flight(plan: LifePlan, habitat: Habitat, slot: number): Flight | null {
  if (!plan.flights.length || unit(plan.seed, STREAM.kingfisher, slot, 1) >= 0.7) return null;
  const reach = plan.flights[Math.floor(unit(plan.seed, STREAM.kingfisher, slot, 2) * plan.flights.length)]!;
  const length = between(FLIGHT_MIN, Math.min(FLIGHT_MAX, reach.length - 2), plan.seed, STREAM.kingfisher, slot, 3);
  const from = between(1, reach.length - 1 - length, plan.seed, STREAM.kingfisher, slot, 4);
  for (let i = 0; i <= 8; i++) {
    const at = onReach(reach, from + (length * i) / 8);
    if (onWalk(habitat.walks, [at.x, at.level + FLIGHT_HEIGHT, at.z])) return null;
  }
  return {
    slot, reach, from, length, duration: length / FLIGHT_SPEED,
    start: slot * FLIGHT_SLOT + between(2, FLIGHT_SLOT - 6, plan.seed, STREAM.kingfisher, slot, 5),
    direction: unit(plan.seed, STREAM.kingfisher, slot, 6) < 0.5 ? 1 : -1,
  };
}

export const daylight = (hour: number) => hour >= KINGFISHER_HOURS[0] && hour < KINGFISHER_HOURS[1];

export function kingfisherPose(plan: LifePlan, habitat: Habitat, time: number, hour: number, out: Pose): Pose {
  out.visible = false;
  if (!daylight(hour)) return out;
  const f = flight(plan, habitat, Math.floor(time / FLIGHT_SLOT));
  if (!f || time < f.start || time >= f.start + f.duration) return out;
  const t = (time - f.start) / f.duration, s = f.from + f.length * (f.direction > 0 ? t : 1 - t);
  const here = onReach(f.reach, s), ahead = onReach(f.reach, s + 0.3 * f.direction);
  out.x = here.x; out.z = here.z;
  out.y = here.level + FLIGHT_HEIGHT + 0.12 * Math.sin(t * Math.PI * 3);
  out.yaw = Math.atan2(ahead.x - here.x, ahead.z - here.z);
  out.pitch = -0.05; out.roll = 0.15 * Math.sin(t * Math.PI * 2);
  out.headYaw = out.headPitch = 0;
  // A whirr of wingbeats: thirteen a second.
  out.wing = 0.8 * Math.sin(TAU * 13 * time);
  out.visible = true;
  return out;
}

// ── Dragonflies ──────────────────────────────────────────────────────────────────────────────────────────────────
const DART_SLOT = 2.4;
/** Share of each slot spent hovering before the dart to the next point. */
const HOVER = 0.72;

/** Noon presence: dragonflies come out late morning and leave by early evening. */
export const noonPresence = (hour: number) => smoothstep(9.5, 11, hour) * (1 - smoothstep(16, 17.5, hour));

function hoverPoint(plan: LifePlan, habitat: Habitat, home: DragonflyHome, index: number, slot: number): Vec3 {
  const r = between(0.3, 1.5, plan.seed, STREAM.dragonfly, index, slot, 1), a = between(0, TAU, plan.seed, STREAM.dragonfly, index, slot, 2);
  const p: Vec3 = [home.anchor[0] + r * Math.cos(a), home.base + between(0.35, 1, plan.seed, STREAM.dragonfly, index, slot, 3), home.anchor[2] + r * Math.sin(a)];
  return onWalk(habitat.walks, p) ? [home.anchor[0], home.base + 0.6, home.anchor[2]] : p;
}

export function dragonflyPose(plan: LifePlan, habitat: Habitat, home: DragonflyHome, index: number, time: number, hour: number, out: Pose): Pose {
  out.visible = noonPresence(hour) >= 0.5;
  if (!out.visible) return out;
  const local = time / DART_SLOT + index * 0.37, slot = Math.floor(local), into = local - slot;
  const a = hoverPoint(plan, habitat, home, index, slot), b = hoverPoint(plan, habitat, home, index, slot + 1);
  const dart = smoothstep(HOVER, 1, into);
  out.x = a[0] + (b[0] - a[0]) * dart + 0.03 * Math.sin(9.1 * time + index);
  out.y = a[1] + (b[1] - a[1]) * dart + 0.025 * Math.sin(7.3 * time + 2 * index);
  out.z = a[2] + (b[2] - a[2]) * dart + 0.03 * Math.cos(8.3 * time + index);
  const drift = 0.5 * Math.sin(0.8 * time + index);
  out.yaw = Math.atan2(b[0] - a[0], b[2] - a[2]) + (1 - smoothstep(HOVER - 0.15, HOVER, into)) * drift;
  out.pitch = 0.18 * (dart > 0 && dart < 1 ? 1 : 0); out.roll = 0;
  out.headYaw = out.headPitch = out.wing = 0;
  return out;
}

// ── Boats and the wheel ──────────────────────────────────────────────────────────────────────────────────────────
/** Five turns a minute. */
export const WHEEL_RPM = 5;
export const wheelAngle = (time: number) => ((TAU * WHEEL_RPM / 60) * time) % TAU;

export interface BoatSway { readonly yaw: number; readonly heave: number; readonly roll: number; readonly pitch: number }
/**
 * A moored boat's gentle motion: a slow swing about its tether, heave and roll on the lake's small swell. Each
 * boat draws its own periods and phases, so moored boats never move in step.
 */
export function boatSway(seed: number, boat: number, time: number): BoatSway {
  const wave = (k: number, amplitude: number, period: readonly [number, number]) => {
    const T = between(period[0], period[1], seed, STREAM.boat, boat, k, 1), phase = between(0, TAU, seed, STREAM.boat, boat, k, 2);
    return amplitude * Math.sin((TAU * time) / T + phase);
  };
  return { yaw: wave(1, 0.11, [9, 14]) + wave(5, 0.03, [4.1, 5.9]), heave: wave(2, 0.022, [2.6, 3.6]), roll: wave(3, 0.035, [3.4, 4.8]), pitch: wave(4, 0.014, [2.9, 4.1]) };
}
