import { describe, expect, it } from 'vitest';
import { PLAYER_FIELDS, WALK_BODY, WALK_BUTTON, WALK_HZ, sanitizeWalkInput, type CollisionWorld, type PlayerState, type SolidBox, type WalkInput } from '@chatdom/shared/realm';
import { REFERENCE_WORLD } from '../realm/reference';
import { bodyStuck, embeddedSolids, stepPlayer, SPRINT_SPEED, WALK_SPEED } from './step';

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

  it('normalizes diagonals and keeps walk and sprint speed exact across tile seams', () => {
    const w = world(tiles(-20, 20, -20, 20));
    const walk = run(at(0, 0, 0), w, input(127, 127), WALK_HZ);
    expect(walk.distance).toBeCloseTo(WALK_SPEED, 9);
    expect(walk.x).toBeCloseTo(WALK_SPEED / Math.SQRT2, 9);
    expect(walk.y).toBe(0);
    expect(walk.grounded).toBe(true);
    const sprint = run(at(0, 0, 0), w, input(-127, 0, WALK_BUTTON.sprint), WALK_HZ);
    expect(sprint.distance).toBeCloseTo(SPRINT_SPEED, 9);
    expect(sprint.x).toBeCloseTo(-SPRINT_SPEED, 9);
    const partial = run(at(0, 0, 0), w, input(0, 64), WALK_HZ);
    expect(partial.z).toBeCloseTo(WALK_SPEED * 64 / 127, 9);
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
    const s = at(-4, 0, 0);
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
    expect(apex).toBeGreaterThan(1);
    expect(apex).toBeLessThan(1.2);
    expect([s.y, s.vy, s.grounded]).toEqual([0, 0, true]);
    const under = at(3, 0, 0);
    stepPlayer(under, input(0, 0, WALK_BUTTON.jump), DT, w);
    run(under, w, input(0, 0), 4);
    expect(under.y + WALK_BODY.height).toBeLessThanOrEqual(2.1);
    expect(under.vy).toBeLessThanOrEqual(0);
  });

  it('reports support at the end of the tick, so walking off a ledge is airborne at once', () => {
    const w = world([box([-5, -1, -5], [1, 0, 5]), box([-5, -5, -5], [5, -4, 5])]);
    const s = at(1.2, 0, 0);
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
