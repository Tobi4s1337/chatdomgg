import * as THREE from 'three';

/** Local flat-ground gait. Contacts are world positions; no terrain or identity is invented here. */
export interface FootstepSample {
  readonly position: readonly [number, number, number];
  readonly heading: number;
  readonly distance: number;
  readonly moving: number;
  readonly speed: number;
  readonly timeMs: number;
}
type Leg = { contact: THREE.Vector3; swingFrom: THREE.Vector3; current: THREE.Vector3; stance: boolean; forcedSwingAt: number | null };
export interface FootstepState {
  position: THREE.Vector3; distance: number; timeMs: number; phase: number; blend: number;
  direction: THREE.Vector3; legs: [Leg, Leg]; wasMoving: boolean; stopAt: number; stopFirst: number; stopFrom: [THREE.Vector3, THREE.Vector3];
}
const CYCLE_WALK = .80, CYCLE_RUN = 1.70;
const STANCE_DISTANCE = .36;
const HIP_SIDE = .125, ANKLE_HEIGHT = .0625;
const smooth = (x: number) => x * x * (3 - 2 * x);
function neutral(sample: FootstepSample, side: number): THREE.Vector3 {
  return new THREE.Vector3(sample.position[0] + Math.cos(sample.heading) * side * HIP_SIDE, sample.position[1] + ANKLE_HEIGHT, sample.position[2] - Math.sin(sample.heading) * side * HIP_SIDE);
}
export function createFootstepState(sample: FootstepSample): FootstepState {
  const left = neutral(sample, -1), right = neutral(sample, 1);
  return { position: new THREE.Vector3(...sample.position), distance: sample.distance, timeMs: sample.timeMs, phase: 0, blend: 0,
    direction: new THREE.Vector3(Math.sin(sample.heading), 0, Math.cos(sample.heading)), wasMoving: false, stopAt: sample.timeMs, stopFirst: 0, stopFrom: [left.clone(), right.clone()],
    legs: [{ contact: left, swingFrom: left.clone(), current: left.clone(), stance: true, forcedSwingAt: null }, { contact: right, swingFrom: right.clone(), current: right.clone(), stance: false, forcedSwingAt: null }] };
}
/** Step from coherent samples. A discontinuity immediately rebases rather than stretching a leg. */
export function stepFootsteps(state: FootstepState, sample: FootstepSample): { feet: readonly [THREE.Vector3, THREE.Vector3]; blend: number; stance: readonly [boolean, boolean]; footfalls: readonly { side: 'left' | 'right'; sole: THREE.Vector3 }[] } {
  const position = new THREE.Vector3(...sample.position);
  const delta = position.clone().sub(state.position), travelled = sample.distance - state.distance;
  const realElapsed = Math.max(0, (sample.timeMs - state.timeMs) / 1000);
  const elapsed = Math.min(.1, realElapsed);
  const horizontal = Math.hypot(delta.x, delta.z);
  const measuredSpeed = realElapsed > 0 ? horizontal / realElapsed : 0;
  const maxAdvance = Math.max(.24, Math.min(7.5, Math.max(0, sample.speed, measuredSpeed)) * realElapsed * 1.7 + .1);
  const discontinuity = travelled < -1e-5 || travelled > maxAdvance || travelled > 1.2 || realElapsed > .25 || horizontal > travelled + .12 || Math.abs(delta.y) > .015;
  if (discontinuity) {
    const fresh = createFootstepState(sample);
    Object.assign(state, fresh);
    return { feet: [fresh.legs[0].contact.clone(), fresh.legs[1].contact.clone()], blend: 0, stance: [true, true], footfalls: [] };
  }
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
    const centre = neutral(sample, side);
    if (!active) {
      // Finish a swing and then step the other foot home; the supporting sole stays fixed.
      const order = i === state.stopFirst ? 0 : 1;
      const t = THREE.MathUtils.clamp((stopElapsed - order * .16) / .16, 0, 1);
      leg.current.copy(state.stopFrom[i]!).lerp(centre, smooth(t));
      leg.current.y += Math.sin(Math.PI * t) * .04;
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
      leg.contact.set(touchdown.x + sideX, sample.position[1] + ANKLE_HEIGHT, touchdown.z + sideZ)
        .addScaledVector(state.direction, STANCE_DISTANCE / 2);
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
      if (!leg.stance && !crossedTouchdown) leg.contact.copy(centre).addScaledVector(state.direction, STANCE_DISTANCE / 2);
      leg.current.copy(leg.contact); outputs.push(leg.current.clone());
    } else {
      if (leg.stance && !crossedTouchdown) leg.swingFrom.copy(leg.contact);
      const start = leg.forcedSwingAt ?? stanceShare;
      const t = Math.max(0, (phase - start) / (1 - start));
      const destination = centre.clone().addScaledVector(state.direction, (1 - phase) * cycle + STANCE_DISTANCE / 2);
      const foot = leg.swingFrom.clone().lerp(destination, smooth(t));
      foot.y += Math.sin(Math.PI * t) * .065;
      leg.current.copy(foot); outputs.push(foot);
    }
    leg.stance = stance; stances.push(stance);
  }
  state.position.copy(position); state.distance = sample.distance; state.timeMs = sample.timeMs; state.wasMoving = active;
  return { feet: outputs as [THREE.Vector3, THREE.Vector3], blend: state.blend, stance: stances as [boolean, boolean], footfalls };
}
