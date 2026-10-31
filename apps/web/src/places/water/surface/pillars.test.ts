import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@chatdom/shared';
import type { WaterBody } from '@chatdom/world';
import { groundAt, waterAt, type WaterGround } from './coverage';
import { PILLAR_CAP, reflectionPoint, selectPillars, type PillarView, type WaterLightSource } from './pillars';

/** An 81 × 81 m grid around a bowl lake: bed −2 m at the centre, rising through the waterline at r ≈ 16.3 m. */
const lake: WaterBody = { id: 'lake', x: 0, z: 0, radiusX: 20, radiusZ: 20, level: 0, depth: 2 };
function bowlGround(): WaterGround {
  const width = 81, height = 81, origin: [number, number] = [-40, -40], step = 1;
  const data = new Float32Array(width * height);
  for (let k = 0; k < height; k++) for (let i = 0; i < width; i++) {
    const r = Math.hypot(origin[0] + i * step, origin[1] + k * step);
    data[i + width * k] = Math.min(3, -2 + 3 * (r / 20) ** 2);
  }
  return { data, width, height, origin, step };
}
const ground = bowlGround();
const water = (x: number, z: number) => waterAt([lake], [], ground, x, z);

/** The eye on the near shore, looking down over the lake at the far shore's houses. */
function lakeView(eye: THREE.Vector3Tuple = [0, 5, 30], target: THREE.Vector3Tuple = [0, 0, 0]): PillarView {
  const camera = new THREE.PerspectiveCamera(50, 1.6, 0.1, 500);
  camera.position.set(...eye); camera.lookAt(...target); camera.updateMatrixWorld();
  const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  return { eye, viewProjection: viewProjection.elements };
}

/** A lit pane on the far shore, facing the lake (+z). */
const pane = (x: number, y: number, strength = 0.8, normal: Vec3 = [0, 0, 1]): WaterLightSource =>
  ({ position: [x, y, -14], strength, kind: 'window', normal });

describe('selectPillars', () => {
  const view = lakeView();

  it('reflects lit sources and names why each other source does not', () => {
    const sources: WaterLightSource[] = [
      pane(-3, 2), // 0: lit, facing the water, mirrored on the lake: reflects
      { position: [4, 2.5, -15], strength: 0.6, kind: 'lamp' }, // 1: an omnidirectional lamp: reflects
      pane(2, 2, 0), // 2: unlit
      pane(1, 2, Number.NaN), // 3: no resolved strength
      { position: [0, -0.5, -6], strength: 1, kind: 'lamp' }, // 4: under the water
      pane(2, 2, 0.8, [0, 0, -1]), // 5: a pane facing away from the lake
      { position: [30, 2, -14], strength: 1, kind: 'lamp' }, // 6: its reflection point lies on the dry shore
      { position: [0, 2, 70], strength: 1, kind: 'lamp' }, // 7: behind the eye, mirror image out of view
      { position: [400, 2, -14], strength: 1, kind: 'lamp' }, // 8: far off to the side of the view
    ];
    // The fixture really puts each case where it claims: lit reflection points on water, the shore one on land.
    const at = (i: number) => reflectionPoint(view.eye, sources[i]!.position, 0)!;
    expect(water(at(0)[0], at(0)[2])).not.toBeNull();
    expect(water(at(5)[0], at(5)[2])).not.toBeNull();
    expect(water(at(6)[0], at(6)[2])).toBeNull();
    expect(groundAt(ground, at(6)[0], at(6)[2])).toBeGreaterThan(0);

    const result = selectPillars(sources, view, 0, water);
    expect(result.pillars.map(p => p.source).sort()).toEqual([0, 1]);
    expect(result.rejected).toEqual({ dark: 2, below: 1, offView: 2, dry: 1, facing: 1 });
    expect(result.considered).toBe(sources.length);
    expect(result.dropped).toBe(0);
    for (const pillar of result.pillars) {
      expect(pillar.level).toBe(0);
      expect(water(pillar.at[0], pillar.at[2])?.id).toBe('lake');
      expect(pillar.halfAngle).toBeGreaterThan(0);
    }
    // The same pane turned toward the water does reflect: facing alone decided the rejection.
    expect(selectPillars([pane(2, 2, 0.8, [0, 0, 1])], view, 0, water).pillars).toHaveLength(1);
  });

  it('keeps the beacon over the cap, drops the weakest contributions, and counts them', () => {
    // 40 panes of mixed strength along two rows of the far shore, then the beacon: farthest, dimmest, last.
    const panes = Array.from({ length: 40 }, (_, i) =>
      pane(-6 + (i % 20) * 0.6, i < 20 ? 1.6 : 2.6, 0.2 + ((i * 7) % 40) / 50));
    // Two exact twins so the order between equal scores is visible.
    panes[31] = panes[30]!;
    const beacon: WaterLightSource = { position: [0, 8, -40], strength: 0.05, kind: 'beacon' };
    const sources = [...panes, beacon];
    const eyeDistance = (p: Vec3) => Math.hypot(p[0] - view.eye[0], p[1] - view.eye[1], p[2] - view.eye[2]);
    const naive = sources.map(s => s.strength / (1 + eyeDistance(reflectionPoint(view.eye, s.position, 0)!) / 25));
    expect(Math.min(...naive)).toBe(naive[40]);

    const result = selectPillars(sources, view, 0, water, PILLAR_CAP);
    expect(result.rejected).toEqual({ dark: 0, below: 0, offView: 0, dry: 0, facing: 0 });
    expect(result.pillars).toHaveLength(PILLAR_CAP);
    expect(result.dropped).toBe(41 - PILLAR_CAP);
    expect(result.pillars[0]).toMatchObject({ source: 40, kind: 'beacon' });

    // The kept panes are exactly the strongest by strength over distance; every dropped one scores no higher.
    const kept = new Set(result.pillars.map(p => p.source));
    const keptScores = panes.map((_, i) => i).filter(i => kept.has(i)).map(i => naive[i]!);
    const droppedScores = panes.map((_, i) => i).filter(i => !kept.has(i)).map(i => naive[i]!);
    expect(droppedScores).toHaveLength(41 - PILLAR_CAP);
    expect(Math.max(...droppedScores)).toBeLessThanOrEqual(Math.min(...keptScores));
    const ranked = panes.map((_, i) => i).sort((a, b) => (naive[b]! - naive[a]!) || (a - b)).slice(0, PILLAR_CAP - 1);
    expect(result.pillars.slice(1).map(p => p.source)).toEqual(ranked);
    // Strictly ordered by score after the beacon.
    for (let i = 2; i < result.pillars.length; i++) expect(result.pillars[i - 1]!.score).toBeGreaterThanOrEqual(result.pillars[i]!.score);

    // Deterministic: the same input gives the same selection, twins in source order.
    expect(selectPillars(sources, view, 0, water, PILLAR_CAP)).toEqual(result);
    const twins = selectPillars([panes[30]!, panes[30]!, panes[30]!], view, 0, water, 2);
    expect(twins.pillars.map(p => p.source)).toEqual([0, 1]);
    expect(twins.dropped).toBe(1);
  });

  it('drops a beacon nowhere near the water like any other source', () => {
    const result = selectPillars([{ position: [0, 8, 90], strength: 1, kind: 'beacon' }], view, 0, water);
    expect(result.pillars).toHaveLength(0);
    expect(result.rejected.offView).toBe(1);
  });

  it('rejects a cap that is not a non-negative integer', () => {
    expect(() => selectPillars([], view, 0, water, -1)).toThrow(RangeError);
    expect(() => selectPillars([], view, 0, water, 2.5)).toThrow(RangeError);
    expect(selectPillars([pane(0, 2)], view, 0, water, 0)).toMatchObject({ pillars: [], dropped: 1 });
  });
});

describe('reflectionPoint', () => {
  it('lies on the water plane, on the line from the eye to the mirror image, between them', () => {
    const eye: Vec3 = [3, 4.5, 18], source: Vec3 = [-5, 2.2, -9], level = 0.4;
    const at = reflectionPoint(eye, source, level)!;
    const mirror: Vec3 = [source[0], 2 * level - source[1], source[2]];
    expect(at[1]).toBe(level);
    const toAt = new THREE.Vector3(...at).sub(new THREE.Vector3(...eye));
    const toMirror = new THREE.Vector3(...mirror).sub(new THREE.Vector3(...eye));
    expect(toAt.clone().cross(toMirror).length()).toBeLessThan(1e-9);
    expect(toAt.dot(toMirror)).toBeGreaterThan(0);
    expect(toAt.length()).toBeLessThan(toMirror.length());
    // Equal angles: the eye ray and the ray to the real source rise from the plane at the same slope.
    const rise = (p: Vec3) => (p[1] - level) / Math.hypot(p[0] - at[0], p[2] - at[2]);
    expect(rise(eye)).toBeCloseTo(rise(source), 12);
  });

  it('has no reflection for an eye or a source at or below the water', () => {
    expect(reflectionPoint([0, 0.4, 10], [0, 2, 0], 0.4)).toBeNull();
    expect(reflectionPoint([0, 3, 10], [0, 0.1, 0], 0.4)).toBeNull();
  });
});
