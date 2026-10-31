import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MATERIALS } from '@chatdom/content';
import { getEnvironment } from '@chatdom/render';
import { executeVoxelJob, type VoxelWorkerPool } from '@chatdom/voxel';
import { createPeopleLight } from '../../../kingdom/lights/people-light';
import { WHEEL } from '../../../../../../packages/content/src/places/water/millrace/index';
import { millHabitat } from './fixture.test-helpers';
import { FLOATER_CAP, type FloaterAction } from './floaters';
import { placeLampLight } from './lamps';
import { createWaterLife, fireflyAmount, mistAmount } from './life';
import { MIST_OPACITY } from './layers';

const CELL = 0.125;
const { mill, habitat, reeds, anchors } = millHabitat();

/** The real mesher behind the caller's pool seam, synchronously: no worker in the test runtime. */
function meshingPool() {
  let jobs = 0;
  const pool = { submit: (job: Parameters<VoxelWorkerPool['submit']>[0]) => { jobs++; return Promise.resolve(executeVoxelJob({ id: jobs, ...job } as never)); } } as unknown as VoxelWorkerPool;
  return { pool, jobs: () => jobs };
}

async function mount() {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 16 / 10, 0.1, 500);
  camera.position.set(-4, 1.5, 29); camera.lookAt(-4, 2, 12); camera.updateMatrixWorld();
  const material = new THREE.MeshBasicMaterial();
  let materialDisposed = false;
  material.addEventListener('dispose', () => { materialDisposed = true; });
  const wheelPlacement = mill.placements.find(p => p.id === 'wheel')!;
  const wheel = new THREE.Object3D(); wheel.position.set(...wheelPlacement.origin); scene.add(wheel);
  const axle = anchors.get('wheel')!.mounts.find(m => m.id === 'axle')!;
  const { pool, jobs } = meshingPool();
  const lamps = anchors.get('bridge')!.emitters;
  const life = createWaterLife({
    seed: 7, habitat, reeds, lamps,
    critters: { material, pool, registry: MATERIALS },
    wheels: [{ object: wheel, pivot: axle.pivot, axis: axle.axis, radius: WHEEL.radius * CELL, width: 1, level: 0 }],
    boats: [],
  });
  scene.add(life.root);
  await life.ready;
  return { scene, camera, life, wheel, material, materialDisposed: () => materialDisposed, jobs, lamps, axle };
}

/** Every transform and visibility under the life root, the wheel's matrix and the ring rows: one frame's state. */
function snapshot(root: THREE.Object3D, wheel: THREE.Object3D) {
  const rows: (number | boolean | string)[] = [];
  root.traverse(o => {
    rows.push(o.name, o.visible, ...o.position.toArray(), o.rotation.x, o.rotation.y, o.rotation.z, ...o.scale.toArray());
    if (o instanceof THREE.Mesh && o.geometry instanceof THREE.InstancedBufferGeometry) {
      rows.push(o.geometry.instanceCount, ...(o.geometry.getAttribute('aWhere').array as Float32Array), ...(o.geometry.getAttribute('aLife').array as Float32Array));
    }
    const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
    if (m?.uniforms) for (const [key, u] of Object.entries(m.uniforms)) if (typeof u.value === 'number') rows.push(key, u.value);
  });
  rows.push(...wheel.matrix.elements);
  return rows;
}

const frame = (camera: THREE.Camera, time: number, hour: number, lamps: ReadonlyMap<string, number> = new Map(), floaters: readonly FloaterAction[] = []) =>
  ({ time, hour, environment: getEnvironment(hour), camera, lamps, floaters });

describe('createWaterLife on the SIMULATED millrace', () => {
  it('meshes every creature through the caller pool and reports what it owns', async () => {
    const { life, jobs } = await mount();
    const d = life.diagnostics();
    expect(d.ready).toBe(true);
    expect(d.ducks.pairs).toBeGreaterThanOrEqual(2);
    expect(d.heron).toBe(true);
    expect(d.lamps).toBe(4);
    expect(d.creatureTriangles).toBeGreaterThan(0);
    // One meshing job per distinct part, shared by every bird of a kind.
    expect(jobs()).toBeLessThan(40);
  });

  it('lands on the same frame after seeking forward and back, with no new geometry or material', async () => {
    const { life, camera, wheel } = await mount();
    const floaters: FloaterAction[] = [{ id: 'sim-a', label: 'SIMULATED a', launched: 20, from: [-4.4, 2] }];
    life.update(frame(camera, 41.7, 20.5, new Map(), floaters));
    const first = snapshot(life.root, wheel);
    const owned = new Set<unknown>();
    life.root.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Sprite) { owned.add(o.geometry); owned.add(o.material); } });
    for (let t = 41.7; t < 160; t += 3.3) life.update(frame(camera, t, 20.5, new Map(), floaters));
    life.update(frame(camera, 41.7, 20.5, new Map(), floaters));
    expect(snapshot(life.root, wheel)).toEqual(first);
    const after = new Set<unknown>();
    life.root.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Sprite) { after.add(o.geometry); after.add(o.material); } });
    expect(after).toEqual(owned);
  });

  it('turns the caller wheel about its own axle and hands back its placed matrix on disposal', async () => {
    const { life, camera, wheel, axle, scene, material, materialDisposed } = await mount();
    const placed = wheel.matrix.clone();
    life.update(frame(camera, 3, 12));
    // A quarter turn after three seconds at five turns a minute: the axle stays put.
    const pivot = new THREE.Vector3(...axle.pivot);
    const rim = pivot.clone().add(new THREE.Vector3(0, 2.5, 0)).applyMatrix4(placed.clone().invert()).applyMatrix4(wheel.matrix);
    expect(rim.x).toBeCloseTo(pivot.x, 6); expect(rim.y).toBeCloseTo(pivot.y, 6); expect(rim.z).toBeCloseTo(pivot.z + 2.5, 6);
    expect(new THREE.Vector3().copy(pivot).applyMatrix4(placed.clone().invert()).applyMatrix4(wheel.matrix).distanceTo(pivot)).toBeLessThan(1e-9);
    life.dispose();
    expect(wheel.matrix.elements).toEqual(placed.elements);
    expect(wheel.matrixAutoUpdate).toBe(true);
    expect(scene.children).not.toContain(life.root);
    expect(scene.children).toContain(wheel);
    expect(materialDisposed()).toBe(false);
    expect(material.isMaterial).toBe(true);
    life.update(frame(camera, 4, 12));
  });

  it('preserves an explicitly placed wheel matrix', async () => {
    const wheel = new THREE.Object3D();
    wheel.matrixAutoUpdate = false;
    wheel.matrix.makeTranslation(4, 5, 6);
    const placed = wheel.matrix.clone();
    const { pool } = meshingPool();
    const life = createWaterLife({ seed: 7, habitat, reeds, critters: { material: new THREE.MeshBasicMaterial(), pool, registry: MATERIALS },
      wheels: [{ object: wheel, pivot: [4, 5, 6], axis: [1, 0, 0], radius: 1, width: 1, level: 0 }] });
    await life.ready;
    life.update(frame(new THREE.PerspectiveCamera(), 0, 12));
    expect(wheel.matrix.elements).toEqual(placed.elements);
    life.dispose();
    expect(wheel.matrix.elements).toEqual(placed.elements);
    expect(wheel.matrixAutoUpdate).toBe(false);
  });

  it('shows each lamp exactly as bright as the host resolved, dark when unmentioned', async () => {
    const { life, camera, lamps } = await mount();
    const empty = new Map(lamps.map(l => [l.id, createPeopleLight(placeLampLight(l)).update(0, [])]));
    life.update(frame(camera, 10, 21, empty));
    const glows = life.root.children.filter((o): o is THREE.Sprite => o instanceof THREE.Sprite && o.name.startsWith('lamp:'));
    expect(glows).toHaveLength(4);
    for (const g of glows) { expect((g.material as THREE.SpriteMaterial).opacity).toBeLessThanOrEqual(0.15 * 1.2); expect(g.scale.x).toBeLessThan(0.5); }
    const full = new Map([[lamps[0]!.id, 1]]);
    life.update(frame(camera, 11, 21, full));
    expect(glows.filter(g => g.visible)).toHaveLength(1);
    expect(life.sources().filter(s => s.kind === 'lamp')).toEqual([{ position: lamps[0]!.position, strength: 1, kind: 'lamp' }]);
    expect(() => life.update(frame(camera, 12, 21, new Map([[lamps[0]!.id, 1.5]])))).toThrow(RangeError);
  });

  it('keeps fireflies to dusk, mist to after 21 under its cap, and the kingfisher by day', async () => {
    const { life, camera } = await mount();
    expect(fireflyAmount(12)).toBe(0); expect(fireflyAmount(21.5)).toBe(1); expect(fireflyAmount(3)).toBe(1);
    expect(mistAmount(20.5)).toBe(0); expect(mistAmount(23)).toBe(1); expect(mistAmount(9)).toBe(0);
    expect(MIST_OPACITY).toBeLessThanOrEqual(0.35);
    const mist = life.root.children.find(o => o.name.startsWith('water-life:mist')) as THREE.Mesh;
    life.update(frame(camera, 5, 20)); expect((mist.material as THREE.ShaderMaterial).uniforms.uAmount!.value).toBe(0);
    life.update(frame(camera, 5, 23)); expect((mist.material as THREE.ShaderMaterial).uniforms.uAmount!.value).toBe(1);
    expect(life.exclusions).toContain(mist);
  });

  it('draws at most twelve floaters, newest first, and carries their labels untouched', async () => {
    const { life, camera } = await mount();
    const floaters: FloaterAction[] = Array.from({ length: 15 }, (_, i) => ({ id: `sim-${i}`, label: `SIMULATED lantern ${i}`, launched: 100 + i, from: [-4.3 + 0.05 * i, 1 + 0.4 * i] }));
    life.update(frame(camera, 120, 22, new Map(), floaters));
    const d = life.diagnostics();
    expect(d.floaters.drawn).toBe(FLOATER_CAP); expect(d.floaters.dropped).toBe(3); expect(d.floaters.tracks).toBe(FLOATER_CAP);
    expect(life.floaterLabels().map(l => l.label)[0]).toBe('SIMULATED lantern 14');
    life.update(frame(camera, 500, 22, new Map(), floaters));
    expect(life.diagnostics().floaters).toMatchObject({ drawn: 0, tracks: 0 });
    expect(() => life.update(frame(camera, 501, 22, new Map(), [{ id: '', label: 'x', launched: 1, from: [0, 0] }]))).toThrow(RangeError);
  });
});
