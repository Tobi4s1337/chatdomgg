// @vitest-environment node
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@chatdom/shared';
import { trailStops } from '../map/route';
import { createLanternTrail, KINDLE_STEP_MS, LANTERN_TRAIL_GROUP, type LanternTrail } from './trail';

/** A straight street east along z = 0, 60 m long, with the door at its end. */
const points: Vec3[] = [[0, 0, 0], [30, 0, 0], [60, 0, 0]];
const stops = trailStops({ points, length: 60 });
const door = { position: [60, 0, 0] as Vec3, outward: [-1, 0] as const };

function make(reduced = false) {
  const scene = new THREE.Scene();
  const trail = createLanternTrail({ scene, reducedMotion: () => reduced, groundAt: () => 0.25 });
  return { scene, trail };
}

const group = (scene: THREE.Scene) => scene.getObjectByName(LANTERN_TRAIL_GROUP);
/** Each lantern's flame, in stop order (the first trail fills slots in order). */
function flames(scene: THREE.Scene, count: number): number[] {
  const glass = scene.getObjectByName('play:lantern-glass') as THREE.InstancedMesh;
  const state = glass.geometry.getAttribute('aGlass') as THREE.InstancedBufferAttribute;
  return Array.from({ length: count }, (_, i) => state.getY(i));
}
const run = (trail: LanternTrail, from: number, to: number, feet: Vec3 | null, hour = 20, step = 16) => {
  for (let now = from; now <= to; now += step) trail.frame(now, feet, hour);
};

describe('the lantern path home', () => {
  it('stands one lantern per stop', () => {
    const { scene, trail } = make();
    expect(stops.length).toBeGreaterThan(5);
    trail.light(stops, 0);
    expect(trail.lit).toBe(true);
    expect(trail.debug.lanterns).toBe(stops.length);
    // More than the first capacity still fits.
    const long = trailStops({ points: [[0, 0, 0], [500, 0, 0]], length: 500 }, 7);
    trail.light(long, 100);
    expect(trail.debug.lanterns).toBe(long.length);
    trail.dispose();
    expect(group(scene)).toBeUndefined();
  });

  it('kindles them in order, from you toward the door', () => {
    const { scene, trail } = make();
    const feet: Vec3 = [-2, 0, 0];
    trail.light(stops, 1000);
    trail.frame(1000, feet, 20);
    expect(trail.debug.litLanterns).toBe(0);
    const counts: number[] = [];
    for (let now = 1000; now <= 1000 + KINDLE_STEP_MS * stops.length + 1200; now += 50) {
      trail.frame(now, feet, 20);
      counts.push(trail.debug.litLanterns);
      const f = flames(scene, stops.length);
      // Never a later lantern brighter than an earlier one while the kindling runs (flares aside, the first leads).
      for (let i = 1; i < f.length; i++) if (f[i - 1]! < 0.05) expect(f[i]!).toBeLessThan(0.05);
    }
    for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeGreaterThanOrEqual(counts[i - 1]!);
    // Part way through, some are lit and some still dark.
    // The first catches about 0.4 s in (the post settles, then the flame); the rest follow one step apart.
    const mid = counts[Math.round((400 + KINDLE_STEP_MS * stops.length / 2) / 50)]!;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(stops.length);
    expect(counts[counts.length - 1]).toBe(stops.length);
    trail.dispose();
  });

  it('puts out the lanterns behind you, and lights them again if you turn back', () => {
    const { trail } = make();
    trail.light(stops, 0);
    run(trail, 0, 4000, [0, 0, 0]);
    expect(trail.debug.litLanterns).toBe(stops.length);
    // Walk to 30 m: every lantern more than 6 m behind goes out; the ones ahead stay.
    const behind = stops.filter(stop => 30 - stop.at > 6).length;
    expect(behind).toBeGreaterThan(0);
    run(trail, 4000, 7000, [30, 0, 0]);
    expect(trail.debug.litLanterns).toBe(stops.length - behind);
    expect(trail.lit).toBe(true);
    // Back to the start: they come back.
    run(trail, 7000, 9000, [0, 0, 0]);
    expect(trail.debug.litLanterns).toBe(stops.length);
    // Well off the trail, nothing goes out behind you.
    run(trail, 9000, 12000, [40, 0, 40]);
    expect(trail.debug.litLanterns).toBe(stops.length);
    trail.dispose();
  });

  it('douses itself at your door, and the door welcomes you', () => {
    const { trail } = make();
    trail.setDoor(door);
    trail.light(stops, 0);
    run(trail, 0, 3000, [0, 0, 0]);
    // Far from the door, its light is out.
    expect(trail.debug.doorGlow).toBeLessThan(0.01);
    // Coming close it warms: part way at 9 m, fully by 4 m.
    run(trail, 3000, 5000, [51, 0, 0]);
    const partway = trail.debug.doorGlow;
    expect(partway).toBeGreaterThan(0.2);
    expect(partway).toBeLessThan(0.9);
    run(trail, 5000, 7000, [56.5, 0, 0]);
    expect(trail.debug.doorGlow).toBeGreaterThan(0.97);
    expect(trail.debug.doorGlow).toBeLessThan(1.05);
    expect(trail.lit).toBe(true);
    // At the step: the trail goes out and the door swells warmly, then settles.
    trail.frame(7016, [58, 0, 0], 20);
    expect(trail.lit).toBe(false);
    let peak = 0;
    for (let now = 7032; now <= 8000; now += 16) { trail.frame(now, [58, 0, 0], 20); peak = Math.max(peak, trail.debug.doorGlow); }
    expect(peak).toBeGreaterThan(1.4);
    run(trail, 8000, 12000, [58, 0, 0]);
    expect(trail.debug.doorGlow).toBeGreaterThan(0.97);
    expect(trail.debug.doorGlow).toBeLessThan(1.05);
    expect(trail.debug.litLanterns).toBe(0);
    expect(trail.debug.lanterns).toBe(0);
    trail.dispose();
  });

  it('glows at the door whether or not the trail is lit, and not without you', () => {
    const { trail } = make();
    trail.setDoor(door);
    run(trail, 0, 2000, [55, 0, 0]);
    expect(trail.lit).toBe(false);
    expect(trail.debug.doorGlow).toBeGreaterThan(0.95);
    run(trail, 2000, 5000, null);
    expect(trail.debug.doorGlow).toBeLessThan(0.01);
    trail.setDoor(null);
    run(trail, 5000, 6000, [55, 0, 0]);
    expect(trail.debug.doorGlow).toBe(0);
    trail.dispose();
  });

  it('with reduced motion lights them all together, without a flicker', () => {
    const { scene, trail } = make(true);
    trail.light(stops, 0);
    trail.frame(320, [0, 0, 0], 20);
    const f = flames(scene, stops.length);
    for (const value of f) expect(value).toBeCloseTo(f[0]!, 6);
    expect(f[0]!).toBeGreaterThan(0.2);
    expect(f[0]!).toBeLessThan(0.8);
    run(trail, 320, 1500, [0, 0, 0]);
    expect(trail.debug.litLanterns).toBe(stops.length);
    const a = flames(scene, stops.length);
    trail.frame(1777, [0, 0, 0], 20);
    expect(flames(scene, stops.length)).toEqual(a);
    trail.dispose();
  });

  it('a new trail replaces the lit one, which fades out', () => {
    const { trail } = make();
    trail.light(stops, 0);
    run(trail, 0, 3000, [0, 0, 0]);
    const other = trailStops({ points: [[0, 0, 20], [40, 0, 20]], length: 40 });
    trail.light(other, 3000);
    expect(trail.debug.lanterns).toBe(other.length);
    run(trail, 3000, 7000, [0, 0, 20]);
    expect(trail.debug.litLanterns).toBe(other.length);
    // Relighting the same trail keeps its lanterns rather than doubling them.
    trail.light(other, 7000);
    run(trail, 7000, 7300, [0, 0, 20]);
    expect(trail.debug.litLanterns).toBe(other.length);
    trail.douse(7300);
    expect(trail.lit).toBe(false);
    run(trail, 7300, 10000, [0, 0, 20]);
    expect(trail.debug.litLanterns).toBe(0);
    trail.dispose();
  });

  it('is presentation only: one group, no solids, and dispose takes all of it away', () => {
    const { scene, trail } = make();
    trail.setDoor(door);
    trail.light(stops, 0);
    run(trail, 0, 2000, [50, 0, 0]);
    const root = group(scene)!;
    expect(root).toBeDefined();
    expect(scene.children.filter(child => child !== root)).toHaveLength(0);
    const disposed = new Set<unknown>();
    const watch = (thing: { addEventListener(type: 'dispose', listener: () => void): void }) => thing.addEventListener('dispose', () => disposed.add(thing));
    const owned: (THREE.BufferGeometry | THREE.Material)[] = [];
    root.traverse(object => {
      // Nothing casts or receives shadows, and there are no lights to cost a frame.
      expect(object).not.toBeInstanceOf(THREE.Light);
      if (object instanceof THREE.Mesh) {
        expect(object.castShadow).toBe(false);
        owned.push(object.geometry, object.material as THREE.Material);
      }
    });
    for (const thing of new Set(owned)) watch(thing);
    trail.dispose();
    expect(group(scene)).toBeUndefined();
    expect(scene.children).toHaveLength(0);
    for (const thing of new Set(owned)) expect(disposed.has(thing)).toBe(true);
    // Calls after dispose are harmless.
    trail.frame(3000, [0, 0, 0], 20);
    trail.light(stops, 3000);
    expect(scene.children).toHaveLength(0);
  });

  it('stands the posts on the drawn ground', () => {
    const { scene, trail } = make();
    trail.light(stops, 0);
    const posts = scene.getObjectByName('play:lantern-posts') as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
    posts.getMatrixAt(0, matrix);
    position.setFromMatrixPosition(matrix);
    expect(position.y).toBeCloseTo(0.25, 6);
    expect(position.x).toBeCloseTo(stops[0]!.position[0], 6);
    expect(position.z).toBeCloseTo(stops[0]!.position[2], 6);
    trail.dispose();
  });
});
