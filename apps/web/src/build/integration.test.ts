import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MATERIALS, STYLES } from '@chatdom/content';
import { createVoxelMaterial, type WindowHouse } from '@chatdom/render';
import { executeVoxelJob, type VoxelJob, type VoxelWorkerPool } from '@chatdom/voxel';
import { homeOrigin, type SettlementHome } from '@chatdom/world';
import type { VoxelBlueprint } from '@chatdom/shared';
import { createKingdomBuild } from '../kingdom/build-scene';
import { blueprintInReserve, buildBounds, composeBuildCamera } from './composition';
import { readSimulatedPublication } from './session';

afterEach(() => vi.unstubAllGlobals());

it('keeps the same frontage through private editing, a saved street replacement and a six-second housewarming', async () => {
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) });
  vi.stubGlobal('window', new EventTarget());
  const canvas = Object.assign(new EventTarget(), { clientWidth: 1440, clientHeight: 900,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1440, height: 900 }),
    hasPointerCapture: () => false, setPointerCapture() {}, releasePointerCapture() {} }) as unknown as HTMLCanvasElement;
  const home: SettlementHome = { id: 'plot:2026:0', slot: 4, tier: 'hut', allowedDepth: 8, style: 'hearth', variant: 0,
    quarterYear: 2026, ordinal: 0, street: 'Acorn Lane', streetId: 'acorn', courtId: 'court', approachId: 'approach',
    position: [20, 2, 30], rotation: 1, lot: { minX: 12, maxX: 28, minZ: 26, maxZ: 34, height: 20, depth: 16, frontage: 8 } };
  const blueprint: VoxelBlueprint = { version: 1, id: 'home:boundary-test', styleId: STYLES.hearth.id,
    kind: 'home', lattice: 'build', size: [64, 48, 64],
    boxes: [{ from: [8, 0, 40], to: [24, 12, 56], material: STYLES.hearth.wall }], windows: [] };
  const authoredHome: WindowHouse = { slot: home.slot, blueprint, position: homeOrigin(home, 8), yaw: Math.PI / 2 };
  const material = createVoxelMaterial(MATERIALS, 'build'), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 1.6, .15, 2200);
  const pool = { submit: async (job: Omit<VoxelJob, 'id'>) => {
    const request={...job,id:1} as VoxelJob;
    // Same occupied coordinates and real worker path; omit the fixture's unused air above/right/behind it.
    if(request.kind==='blueprint'){const size=[0,1,2].map(i=>Math.max(1,...request.blueprint.boxes.map(b=>b.to[i]!))) as [number,number,number];return executeVoxelJob({...request,blueprint:{...request.blueprint,size}});}
    return executeVoxelJob(request);
  } } as VoxelWorkerPool;
  const onSession = vi.fn(), onHomeVisibility = vi.fn(), onStreetHome = vi.fn(), onHousewarming = vi.fn();
  const sound = { output:()=>null, unlock() {}, cue() {}, toggle: () => false, enabled: false, dispose() {} };
  const options = { scene, camera, canvas, pool, material, home, authoredHome, ownerId: 'simulated:seed:juniper', ownerName: 'Juniper', source: 'SIMULATED' as const,
    sound, onSession, onHomeVisibility, onStreetHome, onHousewarming };
  const build = createKingdomBuild(options), target = new THREE.Vector3();
  try {
    const placed = blueprintInReserve(blueprint, build.policy);
    const oldCorner = new THREE.Vector3(...blueprint.boxes[0]!.from).multiplyScalar(.125).applyAxisAngle(new THREE.Vector3(0, 1, 0), authoredHome.yaw).add(new THREE.Vector3(...authoredHome.position));
    const newCorner = new THREE.Vector3(...placed.boxes[0]!.from).multiplyScalar(.125).applyAxisAngle(new THREE.Vector3(0, 1, 0), authoredHome.yaw).add(new THREE.Vector3(...homeOrigin(home, 16)));
    expect(newCorner.distanceTo(oldCorner)).toBeLessThan(1e-10);

    await build.prepare(); expect(build.hidden).toBe(false);
    await expect(build.enter()).resolves.toBe(true);
    expect(build.session?.draft.get([8, 0, 104])).toBe(STYLES.hearth.wall);
    expect(build.session?.mesh.geometry.getAttribute('aPacked').count).toBeGreaterThan(0);
    expect(build.hidden).toBe(true);
    build.session!.edit({ kind: 'place', from: [28, 0, 104], to: [32, 4, 108], material: STYLES.hearth.stone });
    await build.session!.settled();
    build.update(1000, 1 / 60, 19.5, target);
    await build.session!.controller.publish();
    expect(build.session).toBeNull(); expect(build.streetHome?.position).toEqual(homeOrigin(home, 16));
    expect(onStreetHome).toHaveBeenLastCalledWith(build.streetHome, expect.any(THREE.Mesh));
    expect(readSimulatedPublication(build.policy)?.boxes.some(box => box.material === STYLES.hearth.stone)).toBe(true);
    expect(build.housewarming).toMatchObject({ ownerName: 'Juniper', durationMs: 6000 });
    expect(build.update(6999, .016, 19.5, target)).toBe(true);
    expect(build.update(7000, .001, 19.5, target)).toBe(false);
    expect(onHousewarming).toHaveBeenLastCalledWith(null);
    expect(camera.view?.enabled).toBe(false);

    const published = build.streetHome!.blueprint;
    build.dispose();
    const reloaded = createKingdomBuild(options);
    try {
      await reloaded.prepare(); expect(reloaded.streetHome?.blueprint).toEqual(published);
      expect(reloaded.housewarming).toBeNull();
      await reloaded.enter(); expect(reloaded.session!.draft.get([28, 0, 104])).toBe(STYLES.hearth.stone);
      reloaded.session!.edit({ kind: 'erase', from: [28, 0, 104], to: [32, 4, 108] });
      reloaded.leave(); // A private change must leave the last published street untouched.
      expect(reloaded.streetHome!.blueprint).toEqual(published);
      await reloaded.enter(); expect(reloaded.session!.draft.get([28, 0, 104])).toBe(0);
    } finally { reloaded.dispose(); }

    const live = createKingdomBuild({ ...options, source: 'LIVE' });
    try { await live.prepare(); expect(await live.enter()).toBe(false); expect(live.streetHome).toBeNull(); }
    finally { live.dispose(); }

    // The occupied home fits the actual unobscured canvas, including the tall phone tool tray.
    const bounds = buildBounds(placed), position = homeOrigin(home, 16);
    for (const [width, height] of [[1440, 900], [390, 844]] as const) {
      const composition = composeBuildCamera(bounds, position, authoredHome.yaw, { width, height }, { azimuth: .42, elevation: .72, zoom: 1, tools: true });
      camera.aspect = width / height; camera.fov = composition.fov; camera.position.copy(composition.position); camera.lookAt(composition.target);
      camera.setViewOffset(width, height, composition.offsetX, composition.offsetY, width, height); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const projected = new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), authoredHome.yaw).add(new THREE.Vector3(...position)).project(camera);
        const px = (projected.x + 1) * width / 2, py = (1 - projected.y) * height / 2;
        expect(px).toBeGreaterThan(0); expect(px).toBeLessThan(width < 640 ? width : width - 370);
        expect(py).toBeGreaterThan(0); expect(py).toBeLessThan(width < 640 ? height - 350 : height);
      }
    }
  } finally { build.dispose(); material.dispose(); }
}, 15000);
