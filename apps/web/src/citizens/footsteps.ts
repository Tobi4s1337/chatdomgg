import * as THREE from 'three';

/**
 * Optional drawn ground under a point, in the sample's own metres, or null where it does not know. Given only while
 * the body itself is drawn on that ground (see `walk/ground`), so a floor above terrain is never read through.
 */
export type FootstepGround = (x: number, z: number) => number | null;
/**
 * The stepped solid surface under a point (a floor, a stair tread, a deck, a foundation): the highest solid top at
 * (x, z) that is not above `below`, or null where no solid is. Drawn placements are their collision voxels, so this
 * is the drawn surface there too.
 */
export type FootstepFloor = (x: number, z: number, below: number) => number | null;

/** Local gait. Contacts are world positions; no terrain or identity is invented here. */
export interface FootstepSample {
  readonly position: readonly [number, number, number];
  readonly heading: number;
  readonly distance: number;
  readonly moving: number;
  readonly speed: number;
  readonly timeMs: number;
  /** The drawn ground's slope under this walker. Without it the slope is read from the body's own travel. */
  readonly ground?: FootstepGround | undefined;
  /** Solid floors and stairs near the feet: no sole is set below them, whatever height the body datum is at. */
  readonly floor?: FootstepFloor | undefined;
}
type Leg = { contact: THREE.Vector3; swingFrom: THREE.Vector3; current: THREE.Vector3; stance: boolean; forcedSwingAt: number | null };
export interface FootstepState {
  position: THREE.Vector3; distance: number; timeMs: number; phase: number; blend: number;
  direction: THREE.Vector3; legs: [Leg, Leg]; wasMoving: boolean; stopAt: number; stopFirst: number; stopFrom: [THREE.Vector3, THREE.Vector3];
  /** Ground rise per metre along +X and +Z under the body datum: the plane every sole is kept above. */
  gradient: THREE.Vector2;
  /** Upward bend of the sampled ground (rise per square metre); soles away from the datum clear it too. */
  bend: number;
}
export interface FootstepResult {
  readonly feet: readonly [THREE.Vector3, THREE.Vector3];
  readonly blend: number;
  readonly stance: readonly [boolean, boolean];
  readonly footfalls: readonly { side: 'left' | 'right'; sole: THREE.Vector3 }[];
  /**
   * How far a level standing pose must rise above the body datum so neither neutral sole cuts the ground plane.
   * Zero on flat ground. The rig's standing branch (no foot targets) adds it to the root.
   */
  readonly lift: number;
}
const CYCLE_WALK = .80, CYCLE_RUN = 1.70;
const STANCE_DISTANCE = .36;
const HIP_SIDE = .125, ANKLE_HEIGHT = .0625;
/** The drawn foot's sole about its ankle, metres: heel and toe along the heading, half its width across. */
export const FOOT_SOLE = { heel: .0625, toe: .125, half: .0625 } as const;
/** Steepest ground the gait follows (rise per metre); anything steeper is a step, not a slope. */
const MAX_GRADIENT = .75;
/** Ground samples farther than this from the body datum are not the surface under these feet. */
const GROUND_REACH = .35;
/** Half the spacing of the drawn-ground slope probe, metres: about one stride's contact spread. */
const PROBE = .25;
/** Sharper bends than this are not ground a sole rests across (a kerb, a step edge): leave them to the datum. */
const MAX_BEND = 2;
/** Solid tops this far above the body datum are still treads a sole can land on (one step and a little); higher are walls. */
const FLOOR_REACH = .55;
const smooth = (x: number) => x * x * (3 - 2 * x);

/** Rise of the level sole's lowest corner above the plane, so a sole with its ankle there just touches. */
function soleRise(gradient: THREE.Vector2, heading: number): number {
  const fx = Math.sin(heading), fz = Math.cos(heading), lx = Math.cos(heading), lz = -Math.sin(heading);
  const along = gradient.x * fx + gradient.y * fz, across = gradient.x * lx + gradient.y * lz;
  return Math.max(along * FOOT_SOLE.toe, -along * FOOT_SOLE.heel) + Math.abs(across) * FOOT_SOLE.half;
}
/** Farthest a sole corner reaches from its ankle, metres. */
const SOLE_REACH = Math.hypot(FOOT_SOLE.toe, FOOT_SOLE.half);
/**
 * Ankle height that rests a level sole on the ground at (x, z): the plane through the body datum, raised where the
 * sampled ground bends upward between the datum and the farthest corner of the sole.
 */
function restAnkle(sample: FootstepSample, ground: Pick<FootstepState, 'gradient' | 'bend'>, x: number, z: number): number {
  const dx = x - sample.position[0], dz = z - sample.position[2], reach = Math.hypot(dx, dz) + SOLE_REACH;
  return sample.position[1] + ground.gradient.x * dx + ground.gradient.y * dz + soleRise(ground.gradient, sample.heading)
    + .5 * ground.bend * reach * reach + ANKLE_HEIGHT;
}
/**
 * Lowest ankle height whose level sole at (x, z) clears every solid top under it: its four corners and its middle,
 * so a tread edge or a rail narrower than the sole is not stepped through. -Infinity without solids there.
 */
function floorAnkle(sample: FootstepSample, x: number, z: number): number {
  const floor = sample.floor;
  if (!floor) return -Infinity;
  const fx = Math.sin(sample.heading), fz = Math.cos(sample.heading), lx = Math.cos(sample.heading), lz = -Math.sin(sample.heading);
  const below = sample.position[1] + FLOOR_REACH, middle = (FOOT_SOLE.toe - FOOT_SOLE.heel) / 2;
  let top = -Infinity;
  for (const [a, b] of [[-FOOT_SOLE.heel, -FOOT_SOLE.half], [-FOOT_SOLE.heel, FOOT_SOLE.half], [FOOT_SOLE.toe, -FOOT_SOLE.half],
    [FOOT_SOLE.toe, FOOT_SOLE.half], [middle, 0]] as const) {
    const y = floor(x + fx * a + lx * b, z + fz * a + lz * b, below);
    if (y !== null && Number.isFinite(y) && y <= below && y > top) top = y;
  }
  return top + ANKLE_HEIGHT;
}
/** Where a level sole rests at (x, z): on the ground plane and on any solid under it, whichever is higher. */
function restOn(sample: FootstepSample, ground: Pick<FootstepState, 'gradient' | 'bend'> | undefined, x: number, z: number): number {
  return Math.max(ground ? restAnkle(sample, ground, x, z) : sample.position[1] + ANKLE_HEIGHT, floorAnkle(sample, x, z));
}
function neutral(sample: FootstepSample, side: number, ground?: Pick<FootstepState, 'gradient' | 'bend'>): THREE.Vector3 {
  const x = sample.position[0] + Math.cos(sample.heading) * side * HIP_SIDE, z = sample.position[2] - Math.sin(sample.heading) * side * HIP_SIDE;
  return new THREE.Vector3(x, restOn(sample, ground, x, z), z);
}
/**
 * The drawn ground's slope at the body by central differences, and an upper bound on its upward bend from the
 * second differences. Null if the sampler does not answer or answers for some other surface than these feet.
 */
function probeGround(sample: FootstepSample): Pick<FootstepState, 'gradient' | 'bend'> | null {
  const ground = sample.ground;
  if (!ground) return null;
  const [x, y, z] = sample.position;
  const centre = ground(x, z), east = ground(x + PROBE, z), west = ground(x - PROBE, z), north = ground(x, z + PROBE), south = ground(x, z - PROBE);
  for (const h of [centre, east, west, north, south]) if (h === null || !Number.isFinite(h) || Math.abs(h - y) > GROUND_REACH) return null;
  const bendX = (east! + west! - 2 * centre!) / (PROBE * PROBE), bendZ = (north! + south! - 2 * centre!) / (PROBE * PROBE);
  return { gradient: clampGradient(new THREE.Vector2((east! - west!) / (2 * PROBE), (north! - south!) / (2 * PROBE))),
    bend: Math.min(MAX_BEND, Math.max(0, bendX) + Math.max(0, bendZ)) };
}
function clampGradient(gradient: THREE.Vector2): THREE.Vector2 {
  const length = gradient.length();
  return length > MAX_GRADIENT ? gradient.multiplyScalar(MAX_GRADIENT / length) : gradient;
}
export function createFootstepState(sample: FootstepSample): FootstepState {
  // With a ground sampler the feet start rested on it; otherwise on the datum until travel teaches the slope.
  const probed = probeGround(sample), ground = probed ?? { gradient: new THREE.Vector2(), bend: 0 };
  const left = neutral(sample, -1, probed ?? undefined), right = neutral(sample, 1, probed ?? undefined);
  return { position: new THREE.Vector3(...sample.position), distance: sample.distance, timeMs: sample.timeMs, phase: 0, blend: 0,
    gradient: ground.gradient, bend: ground.bend,
    direction: new THREE.Vector3(Math.sin(sample.heading), 0, Math.cos(sample.heading)), wasMoving: false, stopAt: sample.timeMs, stopFirst: 0, stopFrom: [left.clone(), right.clone()],
    legs: [{ contact: left, swingFrom: left.clone(), current: left.clone(), stance: true, forcedSwingAt: null }, { contact: right, swingFrom: right.clone(), current: right.clone(), stance: false, forcedSwingAt: null }] };
}
/** Step from coherent samples. A discontinuity immediately rebases rather than stretching a leg. */
export function stepFootsteps(state: FootstepState, sample: FootstepSample): FootstepResult {
  const position = new THREE.Vector3(...sample.position);
  const delta = position.clone().sub(state.position), travelled = sample.distance - state.distance;
  const realElapsed = Math.max(0, (sample.timeMs - state.timeMs) / 1000);
  const elapsed = Math.min(.1, realElapsed);
  const horizontal = Math.hypot(delta.x, delta.z);
  const measuredSpeed = realElapsed > 0 ? horizontal / realElapsed : 0;
  const maxAdvance = Math.max(.24, Math.min(7.5, Math.max(0, sample.speed, measuredSpeed)) * realElapsed * 1.7 + .1);
  // A body walking a slope rises with its travel; anything faster vertically is a step, a correction or a teleport.
  const discontinuity = travelled < -1e-5 || travelled > maxAdvance || travelled > 1.2 || realElapsed > .25 || horizontal > travelled + .12
    || Math.abs(delta.y) > .015 + horizontal * MAX_GRADIENT;
  if (discontinuity) {
    const fresh = createFootstepState(sample);
    Object.assign(state, fresh);
    return { feet: [fresh.legs[0].contact.clone(), fresh.legs[1].contact.clone()], blend: 0, stance: [true, true], footfalls: [], lift: standingLift(sample, fresh) };
  }
  const probed = probeGround(sample);
  if (probed) { state.gradient.copy(probed.gradient); state.bend = probed.bend; }
  else if (horizontal > 1e-3) {
    // Without a ground sampler, learn the slope from the body's own travel: only the component along this
    // travel is observed, so the across-travel part keeps what earlier travel taught.
    const ux = delta.x / horizontal, uz = delta.z / horizontal;
    const along = THREE.MathUtils.clamp(delta.y / horizontal, -MAX_GRADIENT, MAX_GRADIENT);
    const known = state.gradient.x * ux + state.gradient.y * uz, k = 1 - Math.exp(-elapsed / .06);
    state.gradient.x += ux * (along - known) * k; state.gradient.y += uz * (along - known) * k;
    clampGradient(state.gradient);
    state.bend = 0;
  }
  const surface = state;
  if (horizontal > 1e-5) {
    // Ease the projected swing target as travel reverses or strafes. Keep the
    // vector unnormalised while reversing so it can pass smoothly through zero.
    state.direction.lerp(new THREE.Vector3(delta.x / horizontal, 0, delta.z / horizontal), 1 - Math.exp(-elapsed / .18));
  }
  const active = sample.moving > .05 && travelled >= 0;
  const cycle = THREE.MathUtils.lerp(CYCLE_WALK, CYCLE_RUN, THREE.MathUtils.clamp((sample.speed - 1.2) / 2.8, 0, 1));
  const stanceShare = STANCE_DISTANCE / cycle;
  const previousPhase = state.phase;
  const advance = Math.max(0, travelled) / cycle;
  state.phase = (state.phase + advance) % 1;
  if (!active && state.wasMoving) {
    state.stopAt = sample.timeMs;
    state.stopFirst = state.legs[0].stance ? 1 : 0;
    state.stopFrom = [state.legs[0].current.clone(), state.legs[1].current.clone()];
  }
  if (active && !state.wasMoving) {
    for (const leg of state.legs) { leg.contact.copy(leg.current); leg.swingFrom.copy(leg.current); }
  }
  const stopElapsed = Math.max(0, (sample.timeMs - state.stopAt) / 1000);
  const targetBlend = active || (state.blend > 0 && stopElapsed < .32) ? 1 : 0;
  state.blend += THREE.MathUtils.clamp(targetBlend - state.blend, -elapsed / .18, elapsed / .18);
  const outputs: THREE.Vector3[] = [], stances: boolean[] = [];
  const footfalls: { side: 'left' | 'right'; sole: THREE.Vector3 }[] = [];
  for (let i = 0; i < 2; i++) {
    const leg = state.legs[i]!, side = i === 0 ? -1 : 1;
    const phase = (state.phase + i * .5) % 1;
    const oldPhase = (previousPhase + i * .5) % 1;
    const crossedTouchdown = advance > 0 && oldPhase + advance >= 1;
    let stance = phase < stanceShare;
    const centre = neutral(sample, side, surface);
    if (!active) {
      // Finish a swing and then step the other foot home; the supporting sole stays fixed.
      const order = i === state.stopFirst ? 0 : 1;
      const t = THREE.MathUtils.clamp((stopElapsed - order * .16) / .16, 0, 1);
      leg.current.copy(state.stopFrom[i]!).lerp(centre, smooth(t));
      // Stepping home across a tread edge lifts over it rather than through it.
      leg.current.y = Math.max(leg.current.y, restOn(sample, surface, leg.current.x, leg.current.z)) + Math.sin(Math.PI * t) * .04;
      leg.contact.copy(leg.current); leg.swingFrom.copy(leg.current); leg.stance = t === 0 || t === 1; leg.forcedSwingAt = null;
      outputs.push(leg.current.clone()); stances.push(leg.stance); continue;
    }
    if (crossedTouchdown) {
      leg.forcedSwingAt = null;
      // A coarse frame may skip an entire stance: reconstruct its touchdown on
      // the travelled segment, then carry that world contact into the next swing.
      const fraction = THREE.MathUtils.clamp((1 - oldPhase) / advance, 0, 1);
      const touchdown = state.position.clone().lerp(position, fraction);
      const sideX = Math.cos(sample.heading) * side * HIP_SIDE;
      const sideZ = -Math.sin(sample.heading) * side * HIP_SIDE;
      leg.contact.set(touchdown.x + sideX, 0, touchdown.z + sideZ).addScaledVector(state.direction, STANCE_DISTANCE / 2);
      leg.contact.y = restOn(sample, surface, leg.contact.x, leg.contact.z);
      leg.swingFrom.copy(leg.contact);
      if (state.wasMoving) footfalls.push({ side: i === 0 ? 'left' : 'right', sole: leg.contact.clone().add(new THREE.Vector3(0, -ANKLE_HEIGHT, 0)) });
    }
    if (leg.forcedSwingAt !== null) stance = false;
    if (stance && Math.hypot(leg.contact.x - centre.x, leg.contact.z - centre.z) > .235) {
      // Lift early rather than teleport a planted sole when reach is exhausted.
      leg.forcedSwingAt = phase;
      leg.swingFrom.copy(leg.current);
      stance = false;
    }
    if (stance) {
      if (!leg.stance && !crossedTouchdown) {
        leg.contact.copy(centre).addScaledVector(state.direction, STANCE_DISTANCE / 2);
        leg.contact.y = restOn(sample, surface, leg.contact.x, leg.contact.z);
      }
      // A sole planted before the slope was known (or learned) rises onto it; a planted sole never sinks.
      leg.contact.y = Math.max(leg.contact.y, restOn(sample, surface, leg.contact.x, leg.contact.z));
      leg.current.copy(leg.contact); outputs.push(leg.current.clone());
    } else {
      if (leg.stance && !crossedTouchdown) leg.swingFrom.copy(leg.contact);
      const start = leg.forcedSwingAt ?? stanceShare;
      const t = Math.max(0, (phase - start) / (1 - start));
      const destination = centre.clone().addScaledVector(state.direction, (1 - phase) * cycle + STANCE_DISTANCE / 2);
      destination.y = restOn(sample, surface, destination.x, destination.z);
      const foot = leg.swingFrom.clone().lerp(destination, smooth(t));
      // The straight chord between two rested soles can still cross a bend in the ground or a tread's riser:
      // never below the plane or a solid top here.
      foot.y = Math.max(foot.y, restOn(sample, surface, foot.x, foot.z)) + Math.sin(Math.PI * t) * .065;
      leg.current.copy(foot); outputs.push(foot);
    }
    leg.stance = stance; stances.push(stance);
  }
  state.position.copy(position); state.distance = sample.distance; state.timeMs = sample.timeMs; state.wasMoving = active;
  return { feet: outputs as [THREE.Vector3, THREE.Vector3], blend: state.blend, stance: stances as [boolean, boolean], footfalls, lift: standingLift(sample, state) };
}

/** The rise a level, neutral standing pose needs so both soles clear the ground through the datum. */
function standingLift(sample: FootstepSample, ground: Pick<FootstepState, 'gradient' | 'bend'>): number {
  let lift = 0;
  for (const side of [-1, 1]) lift = Math.max(lift, neutral(sample, side, ground).y - sample.position[1] - ANKLE_HEIGHT);
  return lift;
}
