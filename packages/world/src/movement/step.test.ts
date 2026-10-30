import { describe, expect, it } from 'vitest';
import { PLAYER_FIELDS, WALK_BODY, WALK_BUTTON, WALK_HZ, sanitizeWalkInput, type CollisionWorld, type PlayerState, type SolidBox, type WalkInput } from '@chatdom/shared/realm';
import { REFERENCE_WORLD } from '../realm/reference';
import { bodyStuck, embeddedSolids, stepPlayer, SPRINT_SPEED, STEP_HEIGHT, WALK_SPEED } from './step';

const DT = 1 / WALK_HZ;
const R = WALK_BODY.radius;
type V = [number, number, number];
const box = (min: V, max: V): SolidBox => ({ min, max });

/** A world built from boxes; `reversed` returns the same solids in the opposite stable order. */
function world(boxes: readonly SolidBox[], revision = 1, reversed = false): CollisionWorld {
  const ordered = reversed ? [...boxes].reverse() : boxes;
  return { revision, query: q => ordered.filter(b => b.min.every((n, i) => n <= q.max[i]! && b.max[i]! >= q.min[i]!)) };
}
/** Floor of 1 m tiles, so every walk crosses seams between solids. */
function tiles(x0: number, x1: number, z0: number, z1: number): SolidBox[] {
  const out: SolidBox[] = [];
  for (let x = x0; x < x1; x++) for (let z = z0; z < z1; z++) out.push(box([x, -1, z], [x + 1, 0, z + 1]));
  return out;
}
const at = (x: number, y: number, z: number, revision = 1): PlayerState =>
  ({ x, y, z, vx: 0, vy: 0, vz: 0, grounded: true, yaw: 0, distance: 0, collisionRevision: revision });
const input = (moveX: number, moveZ: number, buttons = 0, collisionRevision = 1): WalkInput =>
  ({ moveX, moveZ, buttons, yaw: 0, collisionRevision });
function run(s: PlayerState, w: CollisionWorld, i: WalkInput, ticks: number, dt = DT): PlayerState {
  for (let n = 0; n < ticks; n++) stepPlayer(s, i, dt, w);
  return s;
}
const insideAny = (s: PlayerState, w: CollisionWorld) => embeddedSolids(s, w).length > 0;

/** Sealed test lane: tile floor, a thin fence, a pillar, an inside corner, a low beam and a half-metre ledge. */
const TOWN: SolidBox[] = [
  ...tiles(-12, 12, -12, 12),
  box([-12, 0, -12], [12, 4, -11]), box([-12, 0, 11], [12, 4, 12]), box([-12, 0, -12], [-11, 4, 12]), box([11, 0, -12], [12, 4, 12]),
  box([4, 0, -11], [4.03, 1.2, 3]),
  box([-3, 0, -3], [-2.6, 3, -2.6]),
  box([-11, 0, 6], [-6, 2.5, 6.2]), box([-6.2, 0, 6.2], [-6, 2.5, 11]),
  box([6, 2.1, -4], [9, 2.4, 4]),
  box([7, 0, 6], [10, .5, 9]),
];

describe('stepPlayer', () => {
  it('replays a recording identically, whatever order solids arrive in and after field transfer', () => {
    // Seeded recording: walking, sprinting, turning, jumping into the fence, pillar, corner and ledge.
    let seed = 0x2545f491;
    const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    const recording: WalkInput[] = [];
    for (let segment = 0; segment < 60; segment++) {
      const sample = input(Math.round(rand() * 254 - 127), Math.round(rand() * 254 - 127), rand() < .4 ? WALK_BUTTON.sprint : 0);
      sanitizeWalkInput(sample);
      for (let n = 0, length = 10 + Math.floor(rand() * 30); n < length; n++) recording.push({ ...sample, buttons: sample.buttons | (n === 0 && rand() < .5 ? WALK_BUTTON.jump : 0) });
    }
    const server = world(TOWN), client = world(TOWN, 1, true);
    const a = at(0, 0, 0), b = at(0, 0, 0);
    let travelled = 0;
    for (const sample of recording) {
      const bx = a.x, bz = a.z;
      stepPlayer(a, sample, DT, server);
      // The client receives authority as schema fields every tick and predicts from that copy.
      const copied = Object.fromEntries(PLAYER_FIELDS.map(f => [f, b[f]])) as unknown as PlayerState;
      stepPlayer(copied, sample, DT, client);
      Object.assign(b, copied);
      expect(b).toEqual(a);
      expect(insideAny(a, server)).toBe(false);
      const moved = Math.hypot(a.x - bx, a.z - bz);
      expect(moved).toBeLessThanOrEqual(SPRINT_SPEED * DT + 1e-9);
      travelled += moved;
    }
    expect(a.distance).toBeCloseTo(travelled, 9);
    expect(a.distance).toBeGreaterThan(40);
  });

  it('normalizes diagonals and keeps walk and sprint speed exact across tile seams once up to speed', () => {
    const w = world(tiles(-20, 20, -20, 20));
    const cruise = (s: PlayerState, i: WalkInput) => { run(s, w, i, 6); const x = s.x, z = s.z, d = s.distance; run(s, w, i, WALK_HZ); return { s, dx: s.x - x, dz: s.z - z, d: s.distance - d }; };
    const walk = cruise(at(0, 0, 0), input(127, 127));
    expect(walk.d).toBeCloseTo(WALK_SPEED, 9);
    expect(walk.dx).toBeCloseTo(WALK_SPEED / Math.SQRT2, 9);
    expect([walk.s.y, walk.s.grounded]).toEqual([0, true]);
    const sprint = cruise(at(0, 0, 0), input(-127, 0, WALK_BUTTON.sprint));
    expect(sprint.d).toBeCloseTo(SPRINT_SPEED, 9);
    expect(sprint.dx).toBeCloseTo(-SPRINT_SPEED, 9);
    const partial = cruise(at(0, 0, 0), input(0, 64));
    expect(partial.dz).toBeCloseTo(WALK_SPEED * 64 / 127, 9);
  });

  it('starts promptly, stops quickly and turns without ever exceeding the target speed', () => {
    const w = world(tiles(-30, 30, -30, 30));
    const speed = (s: PlayerState) => Math.hypot(s.vx, s.vz);
    // A walk is at full speed within three ticks and stops within two; a sprint stops in .1 s within .24 m.
    const s = at(0, 0, 0);
    run(s, w, input(127, 0), 3);
    expect(speed(s)).toBe(WALK_SPEED);
    run(s, w, input(0, 0), 2);
    expect(speed(s)).toBe(0);
    run(s, w, input(0, 127, WALK_BUTTON.sprint), 30);
    const z = s.z;
    run(s, w, input(0, 0), 3);
    expect([s.vx, s.vz]).toEqual([0, 0]);
    expect(s.z - z).toBeLessThan(.24);
    // Reversing and circling with sprint and walk mixed never gains speed, and every tick's travel matches it.
    for (let n = 0; n < 240; n++) {
      const angle = n * .21;
      const before = { x: s.x, z: s.z };
      stepPlayer(s, input(Math.round(Math.cos(angle) * 127), Math.round(Math.sin(angle) * 127), n % 50 < 25 ? WALK_BUTTON.sprint : 0), DT, w);
      expect(speed(s)).toBeLessThanOrEqual(SPRINT_SPEED + 1e-12);
      expect(Math.hypot(s.x - before.x, s.z - before.z)).toBeCloseTo(speed(s) * DT, 12);
    }
    stepPlayer(s, input(-127, 0), DT, w);
    expect(speed(s)).toBeLessThanOrEqual(SPRINT_SPEED);
  });

  it('never tunnels through a thin or zero-thickness wall at sprint, even on the largest catch-up tick', () => {
    for (const thickness of [.03, .001, 0]) for (const dt of [DT, .1]) {
      const w = world([box([-50, -1, -50], [50, 0, 50]), box([1, 0, -50], [1 + thickness, 3, 50])]);
      const s = run(at(0, 0, 0), w, input(127, 40, WALK_BUTTON.sprint), 40, dt);
      expect(s.x).toBe(1 - R);
      expect(s.vx).toBe(0);
    }
  });

  it('slides diagonally along a seamed wall without snagging or gaining speed', () => {
    const wall = Array.from({ length: 10 }, (_, n) => box([-5 + n, 0, 1], [-4 + n, 3, 1.2]));
    const w = world([...tiles(-5, 5, -5, 5), ...wall]);
    const s = { ...at(-4, 0, 0), vx: WALK_SPEED / Math.SQRT2, vz: WALK_SPEED / Math.SQRT2 };
    const steps: number[] = [];
    for (let n = 0; n < 45; n++) { const x = s.x; stepPlayer(s, input(127, 127), DT, w); steps.push(s.x - x); }
    expect(s.z).toBe(1 - R);
    // Once against the wall every tick slides the same X travel: no seam catches, no speed gain.
    const along = WALK_SPEED / Math.SQRT2 * DT;
    for (const step of steps) expect(step).toBeCloseTo(along, 12);
    expect(s.distance).toBeLessThanOrEqual(WALK_SPEED * 45 * DT + 1e-9);
  });

  it('terminates in an inside corner, including zero-time hits from a resting contact', () => {
    const w = world([...tiles(-5, 5, -5, 5), box([1, 0, -5], [2, 3, 5]), box([-5, 0, 1], [5, 3, 2])]);
    const s = run(at(0, 0, 0), w, input(127, 127, WALK_BUTTON.sprint), 30);
    expect([s.x, s.z]).toEqual([1 - R, 1 - R]);
    const resting = { ...s };
    run(s, w, input(127, 127, WALK_BUTTON.sprint), 30);
    expect(s).toEqual({ ...resting, distance: resting.distance });
    expect([s.vx, s.vz]).toEqual([0, 0]);
  });

  it('resolves a convex corner by the earliest contact, mirror-symmetric in X and Z', () => {
    const w = world([...tiles(-5, 5, -5, 5), box([1, 0, .3], [2, 3, 2])]);
    const mirrored = world([...tiles(-5, 5, -5, 5), box([.3, 0, 1], [2, 3, 2])]);
    // Both faces are reached within one tick: Z after .02 m, X after .05 m of diagonal travel.
    const a = run(at(1 - R - .05, 0, 0), w, input(127, 127), 6);
    const b = run(at(0, 0, 1 - R - .05), mirrored, input(127, 127), 6);
    expect([b.z, b.x, b.distance]).toEqual([a.x, a.z, a.distance]);
    // The face entered last blocks: X stops at the pillar, Z keeps sliding past it.
    expect(a.x).toBe(1 - R);
    expect(a.z).toBeGreaterThan(.3);
  });

  it('lands exactly, jumps once from support, ignores an airborne press and stops under a beam', () => {
    const w = world([...tiles(-5, 5, -5, 5), box([2, 2.1, -5], [5, 2.4, 5])]);
    const s = at(0, 0, 0);
    stepPlayer(s, input(0, 0, WALK_BUTTON.jump), DT, w);
    expect(s.grounded).toBe(false);
    let apex = 0;
    for (let n = 0; n < 40; n++) {
      const vy = s.vy;
      stepPlayer(s, input(0, 0, WALK_BUTTON.jump * (n === 5 ? 1 : 0)), DT, w);
      if (n === 5) expect(s.vy).toBeLessThan(vy);
      apex = Math.max(apex, s.y);
    }
    // Clears a one-metre crate, never a 1.5 m fence; the tick samples lie on the exact parabola.
    expect(apex).toBeGreaterThan(1.24);
    expect(apex).toBeLessThanOrEqual(1.25);
    expect([s.y, s.vy, s.grounded]).toEqual([0, 0, true]);
    const under = at(3, 0, 0);
    stepPlayer(under, input(0, 0, WALK_BUTTON.jump), DT, w);
    run(under, w, input(0, 0), 4);
    expect(under.y + WALK_BODY.height).toBeLessThanOrEqual(2.1);
    expect(under.vy).toBeLessThanOrEqual(0);
  });

  it('reports support at the end of the tick, so walking off a ledge is airborne at once', () => {
    const w = world([box([-5, -1, -5], [1, 0, 5]), box([-5, -5, -5], [5, -4, 5])]);
    const s = { ...at(1.2, 0, 0), vx: WALK_SPEED };
    stepPlayer(s, input(127, 0), DT, w);
    expect(s.x - R).toBeGreaterThan(1);
    expect(s.grounded).toBe(false);
    stepPlayer(s, input(0, 0, WALK_BUTTON.jump), DT, w);
    expect(s.vy).toBeLessThan(0);
  });

  it('pushes an embedded body out by the shortest path that crosses no other solid', () => {
    // A half-metre block placed where someone stands lifts them on top; it is not counted as walking.
    const placed = world([...tiles(-5, 5, -5, 5), box([-1, 0, -1], [1, .5, 1])]);
    const lifted = run(at(0, 0, 0), placed, input(0, 0), 1);
    expect([lifted.x, lifted.y, lifted.z, lifted.distance, lifted.grounded]).toEqual([0, .5, 0, 0, true]);
    // A door closing on a walker pushes them back out of the near side.
    const door = world([...tiles(-5, 5, -5, 5), box([.1, 0, -1], [.3, 2.4, 1])]);
    const back = run(at(0, 0, 0), door, input(0, 0), 1);
    expect(back.x).toBe(.1 - R);
    // With the shorter side backed by another wall, recovery takes the longer clear way instead of crossing it.
    const backed = world([...tiles(-5, 5, -5, 5), box([-.1, 0, -2], [.15, 3, 2]), box([.15, 0, -2], [3, 3, -.3]), box([.15, 0, .3], [3, 3, 2]), box([.15, 0, -.3], [.6, 3, .3])]);
    const out = run(at(.14, 0, 0), backed, input(0, 0), 1);
    expect(insideAny(out, backed)).toBe(false);
    expect(out.x).toBe(-.1 - R);
  });

  it('holds a body that cannot be freed without crossing a wall, and the adapter can see it', () => {
    const w = world([...tiles(-5, 5, -5, 5), box([-1.5, 0, -1.5], [1.5, 3, 1.5])]);
    const s = { ...at(0, 0, 0), vx: 3, vy: 2, vz: -3 };
    expect(bodyStuck(s, w)).toBe(true);
    run(s, w, input(127, 0, WALK_BUTTON.sprint | WALK_BUTTON.jump), 30);
    expect([s.x, s.y, s.z, s.vx, s.vy, s.vz, s.distance]).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(bodyStuck(at(4, 0, 4), w)).toBe(false);
  });

  it('never moves on a mismatched collision revision', () => {
    const w = world(tiles(-5, 5, -5, 5), 2);
    const stale = { ...at(0, 0, 0), vx: 4, vy: -3 };
    const before = { ...stale };
    run(stale, w, input(127, 0, 0, 2), 10);
    expect(stale).toEqual(before);
    const ahead = at(0, 0, 0, 2);
    run(ahead, w, input(127, 0, 0, 1), 10);
    expect(ahead).toEqual(at(0, 0, 0, 2));
  });

  it('stops at the supplied court walls and its blocks at sprint', () => {
    const s = run(at(0, 0, 5), REFERENCE_WORLD, input(127, 0, WALK_BUTTON.sprint), 120);
    expect([s.x, s.y, s.grounded]).toEqual([18 - R, 0, true]);
    const corner = run(at(10, 0, 10), REFERENCE_WORLD, input(127, 127, WALK_BUTTON.sprint), 120);
    expect([corner.x, corner.z]).toEqual([18 - R, 18 - R]);
    // The 1.5 m block (x -3..-1, z -2..0) stops a walker approaching from +X; pressing on, they slide off its end.
    const block = run(at(1, 0, -1), REFERENCE_WORLD, input(-127, 0), 30);
    expect(block.x).toBe(-1 + R);
    run(block, REFERENCE_WORLD, input(-127, 40), 60);
    expect(block.z).toBeGreaterThan(R);
    expect(block.x).toBeLessThan(-1);
    expect(insideAny(block, REFERENCE_WORLD)).toBe(false);
  });
});

describe('stepPlayer half-metre steps', () => {
  const floor = (): SolidBox[] => tiles(-6, 12, -6, 6);
  /** Walks +X from rest for `ticks` and checks every tick: never inside a solid, distance is horizontal travel. */
  function walkInto(w: CollisionWorld, from: PlayerState, i: WalkInput, ticks: number): PlayerState {
    let travelled = from.distance;
    for (let n = 0; n < ticks; n++) {
      const x = from.x, z = from.z;
      stepPlayer(from, i, DT, w);
      expect(insideAny(from, w)).toBe(false);
      travelled += Math.hypot(from.x - x, from.z - z);
    }
    expect(from.distance).toBeCloseTo(travelled, 9);
    return from;
  }

  it('climbs exactly half a metre onto support, solid or built from small voxels, and keeps walking', () => {
    const block = world([...floor(), box([2, 0, -6], [6, STEP_HEIGHT, 6])]);
    const s = walkInto(block, at(0, 0, 0), input(127, 0), 30);
    expect([s.y, s.grounded]).toEqual([STEP_HEIGHT, true]);
    expect(s.x).toBeGreaterThan(3.5);
    // The same step stacked from four .125 m build voxels, and a second step after the first: a stair.
    const stacked = [0, 1, 2, 3].map(n => box([2, n * .125, -6], [12, (n + 1) * .125, 6]));
    const stair = world([...floor(), ...stacked, box([3, .5, -6], [12, 1, 6])]);
    const up = walkInto(stair, at(0, 0, 0), input(127, 0, WALK_BUTTON.sprint), 30);
    expect([up.y, up.grounded]).toEqual([1, true]);
    // Velocity survives the climb: the stair costs no more than the ticks spent touching its faces.
    expect(up.x).toBeGreaterThan(5);
  });

  it('refuses a step higher than half a metre and keeps the slide along it', () => {
    const w = world([...floor(), box([2, 0, -6], [6, STEP_HEIGHT + .01, 6])]);
    const s = walkInto(w, at(0, 0, 0), input(127, 0), 30);
    expect([s.x, s.y, s.vx]).toEqual([2 - R, 0, 0]);
    const slid = walkInto(w, s, input(127, 127), 15);
    expect([slid.x, slid.y]).toEqual([2 - R, 0]);
    expect(slid.z).toBeGreaterThan(1);
  });

  it('needs headroom over the step, and fits under a doorway lintel exactly when the body does', () => {
    // A .3 m doorstep under a lintel: 0.3 + 1.75 = 2.05 m fits under 2.1, but not under 2.0.
    const door = (lintel: number) => world([...floor(), box([2, 0, -6], [12, .3, 6]), box([2, lintel, -6], [2.4, 3, 6])]);
    const through = walkInto(door(2.1), at(0, 0, 0), input(127, 0), 30);
    expect([through.y, through.grounded]).toEqual([.3, true]);
    expect(through.x).toBeGreaterThan(2.5);
    const low = walkInto(door(2), at(0, 0, 0), input(127, 0), 30);
    expect([low.x, low.y]).toEqual([2 - R, 0]);
    // A beam right above the walker leaves no room to rise at all.
    const beam = world([...floor(), box([2, 0, -6], [6, .2, 6]), box([1, 1.85, -6], [2, 2.2, 6])]);
    expect(walkInto(beam, at(0, 0, 0), input(127, 0), 30).x).toBe(2 - R);
  });

  it('slides past a ledge it only grazes, and climbs it when walking into it', () => {
    const ledge = world([...floor(), box([-6, 0, 1], [12, STEP_HEIGHT, 6])]);
    const graze = walkInto(ledge, at(-4, 0, 1 - R), input(127, 25), 40);
    expect([graze.y, graze.z]).toEqual([0, 1 - R]);
    expect(graze.x).toBeGreaterThan(0);
    const climb = walkInto(ledge, at(-4, 0, 1 - R), input(127, 45), 10);
    expect([climb.y, climb.grounded]).toEqual([STEP_HEIGHT, true]);
  });

  it('refuses narrow or unsupported landings: a rail over a drop, a kerb against a wall', () => {
    // A 5 cm parapet at the edge of a two-metre drop is a barrier, not a step.
    const parapet = world([...tiles(-6, 2, -6, 6), box([2, -2, -6], [12, -1, 6]), box([2, -1, -6], [2.05, .5, 6])]);
    const held = walkInto(parapet, at(0, 0, 0), input(127, 0, WALK_BUTTON.sprint), 30);
    expect([held.x, held.y]).toEqual([2 - R, 0]);
    // A 10 cm kerb in front of a tall wall leaves nowhere to put the body's centre.
    const kerb = world([...floor(), box([2, 0, -6], [2.1, STEP_HEIGHT, 6]), box([2.1, 0, -6], [3, 3, 6])]);
    expect(walkInto(kerb, at(0, 0, 0), input(127, 0), 30).x).toBe(2 - R);
    // A 10 cm sill with the same floor behind it is stepped over.
    const sill = world([...floor(), box([2, 0, -6], [2.1, .2, 6])]);
    const over = walkInto(sill, at(0, 0, 0), input(127, 0), 30);
    expect([over.y, over.grounded]).toEqual([0, true]);
    expect(over.x).toBeGreaterThan(3);
    // On the largest catch-up tick a sprint clears the sill within one tick and lands on the floor beyond.
    const far = { ...at(2 - R, 0, 0), vx: SPRINT_SPEED };
    stepPlayer(far, input(127, 0, WALK_BUTTON.sprint), .1, sill);
    expect([far.x, far.y, far.grounded]).toEqual([2 - R + SPRINT_SPEED * .1, 0, true]);
  });

  it('keeps the longer slide when a climb would only wedge the walker under an overhang', () => {
    // A .3 m step to the side and a beam at 1.9 m ahead: raised onto the step the body (2.05 m) meets the beam,
    // so climbing would trade the free slide along the street for a sliver of travel. The slide wins.
    const w = world([...floor(), box([2, 0, -6], [12, .3, 6]), box([-6, 1.9, .6], [12, 3, 6])]);
    const s = { ...at(2 - R, 0, .3), vx: 2, vz: 3.5 };
    walkInto(w, s, input(64, 110), 12);
    expect([s.x, s.y]).toEqual([2 - R, 0]);
    expect(s.z).toBeGreaterThan(1.5);
  });

  it('never climbs from the air: a falling or jumping walker meets the face of a step', () => {
    const w = world([...floor(), box([2, 0, -6], [6, STEP_HEIGHT, 6])]);
    const falling = { ...at(2 - R - .01, .2, 0), grounded: false, vx: WALK_SPEED };
    stepPlayer(falling, input(127, 0), DT, w);
    expect(falling.x).toBe(2 - R);
    expect(falling.y).toBeLessThan(.2);
    // A jump started against the step rises past its top under air control and lands on it.
    const jumper = at(2 - R, 0, 0);
    stepPlayer(jumper, input(127, 0, WALK_BUTTON.jump), DT, w);
    expect(jumper.x).toBe(2 - R);
    expect(jumper.y).toBeGreaterThan(0);
    run(jumper, w, input(127, 0), 30);
    expect([jumper.y, jumper.grounded]).toEqual([STEP_HEIGHT, true]);
  });

  it('stays on its feet down a half-metre step and falls off anything deeper', () => {
    const down = world([...tiles(-6, 2, -6, 6), box([-6, 0, -6], [2, STEP_HEIGHT, 6]), box([2, -1, -6], [8, 0, 6])]);
    const s = { ...at(0, STEP_HEIGHT, 0), vx: WALK_SPEED };
    for (let n = 0; n < 20; n++) { stepPlayer(s, input(127, 0), DT, down); expect(s.grounded).toBe(true); }
    expect([s.y, s.vy]).toEqual([0, 0]);
    expect(s.x).toBeGreaterThan(2.5);
    const deep = world([box([-6, -1, -6], [2, 0, 6]), box([2, -1.6, -6], [8, -.6, 6])]);
    const f = { ...at(2, 0, 0), vx: WALK_SPEED };
    run(f, deep, input(127, 0), 3);
    expect(f.grounded).toBe(false);
    run(f, deep, input(127, 0), 15);
    expect([f.y, f.grounded]).toEqual([-.6, true]);
  });

  it('climbs the supplied court half-metre block', () => {
    // The court's block spans x 3..5, z -3..0 and is .5 m high.
    const s = run(at(0, 0, -1.5), REFERENCE_WORLD, input(127, 0), 30);
    expect([s.y, s.grounded]).toEqual([.5, true]);
    expect(insideAny(s, REFERENCE_WORLD)).toBe(false);
  });
});
