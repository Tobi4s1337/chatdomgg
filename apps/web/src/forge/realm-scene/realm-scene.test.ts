import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createHearthHome, MATERIALS } from '@chatdom/content';
import { assembleForge, findForgeSockets, forgeStyleKit, homeFingerprint } from '@chatdom/forge';
import { createVoxelMaterial } from '@chatdom/render';
import { KingdomIdSchema, VOXEL_METRES, type VoxelBlueprint } from '@chatdom/shared';
import type { CommittedForgeAttachment } from '@chatdom/shared/realm';
import { executeVoxelJob, type VoxelJobInput, type VoxelWorkerPool } from '@chatdom/voxel';
import { canonicalSceneJson } from '@chatdom/world/founded-codec';
import type { ForgeObservationHandlers } from '../../realm/adapters/forge';
import type { createKingdomSound } from '../../kingdom/sound';
import { buildBounds } from '../../build/composition';
import { createRealmForgeScene } from './index';

// The tested boundary is room authority -> actual assembly/meshing -> lifecycle/camera/standing emitter.
// The anvil's canvas artwork has its own visual tests and needs a browser, so replace only that view.
const stageHeat = vi.hoisted(() => vi.fn());
vi.mock('../ritual-view', () => ({ createForgeRitualView: (scene: THREE.Scene) => {
  const root = new THREE.Group(); scene.add(root);
  return { root, beginWords: vi.fn(), update: vi.fn(), updateAnvil: stageHeat, setEnvironment: vi.fn(), dispose: () => scene.remove(root) };
} }));

describe('room-fed Forge scene', () => {
  it('reconstructs mixed revision lanterns from their recorded kits in one room', async () => {
    const blueprint = createHearthHome('house', 0);
    const home = { slot: 7, blueprint, position: [31, 2, -17] as const, yaw: Math.PI / 2 };
    const plan = { version: 2, kind: 'lantern', motif: 'crescent-moon', finish: 'native', accent: 'none' } as const;
    const expected = [1, 2].map(revision => assembleForge(plan, forgeStyleKit('hearth', revision),
      findForgeSockets(blueprint, 'street-home', revision).find(s => s.kind === plan.kind)!));
    expect(expected[0]!.blueprint.boxes).not.toEqual(expected[1]!.blueprint.boxes);
    const attachments: CommittedForgeAttachment[] = expected.map((result, index) => ({
      version: 1, id: `lantern-revision-${index + 1}`, runId: `run-revision-${index + 1}`, kingdomId: KingdomIdSchema.parse('123456'),
      slot: home.slot, hostId: blueprint.id, hostFingerprint: homeFingerprint(blueprint), socketId: result.socket.id, origin: result.socket.origin,
      kitId: result.kit.id, kitRevision: result.kit.revision, family: 'hearth', draft: { plan, title: 'Moon lantern', plaque: 'SIMULATED revision replay' }, committedAt: index + 1,
      provenance: { source: 'simulated', makerName: 'Juniper', kingdomName: 'SIMULATED', designId: `moon-design-${index + 1}`, firstForgedAt: index + 1 },
    }));
    let handlers: ForgeObservationHandlers = {};
    const settled = vi.fn(), hide = vi.fn();
    const submit = vi.fn(async (job: VoxelJobInput) => executeVoxelJob({ ...job, id: 1 }));
    const scene = new THREE.Scene(), material = createVoxelMaterial(MATERIALS, 'build');
    const adapter = createRealmForgeScene({ scene, camera: new THREE.PerspectiveCamera(50, 1440 / 900, .1, 300), material,
      pool: { submit } as unknown as VoxelWorkerPool, canvas: { clientWidth: 1440, clientHeight: 900 } as HTMLCanvasElement,
      anvil: new THREE.Vector3(), home: slot => slot === home.slot ? home : undefined,
      sound: {} as ReturnType<typeof createKingdomSound>, hideAttachment: hide,
      feed: { subscribe(next) { handlers = next; return () => {}; }, settled } });
    try {
      adapter.update(0, false);
      for (const attachment of attachments) handlers.committed?.(attachment, attachment.runId);
      await vi.waitFor(() => expect(scene.getObjectByName(`realm-forge-clone:${attachments[0]!.id}`)).toBeDefined());
      expect(submit).toHaveBeenCalledTimes(1);
      expect(submit.mock.calls[0]![0]).toMatchObject({ kind: 'blueprint', blueprint: expected[0]!.blueprint });
      adapter.update(22000, false);
      await vi.waitFor(() => expect(scene.getObjectByName(`realm-forge-clone:${attachments[1]!.id}`)).toBeDefined());
      expect(submit).toHaveBeenCalledTimes(2);
      expect(submit.mock.calls[1]![0]).toMatchObject({ kind: 'blueprint', blueprint: expected[1]!.blueprint });
      adapter.update(44000, false);
      expect(settled.mock.calls).toEqual(attachments.map(attachment => [attachment.id]));
    } finally { adapter.dispose(); material.dispose(); }
  });

  it.each([{ kitRevision: 3, kitId: 'hearth-native' }, { kitRevision: 2, kitId: 'hearth-native-native' }])(
    'rejects an unregistered committed kit without meshing: $kitRevision / $kitId', ({ kitRevision, kitId }) => {
      const blueprint = createHearthHome('house', 0);
      const socket = findForgeSockets(blueprint).find(s => s.kind === 'lantern')!;
      const attachment: CommittedForgeAttachment = {
        version: 1, id: 'unregistered-lantern', runId: 'unregistered-run', kingdomId: KingdomIdSchema.parse('123456'),
        slot: 7, hostId: blueprint.id, hostFingerprint: homeFingerprint(blueprint), socketId: socket.id, origin: socket.origin,
        kitId, kitRevision, family: 'hearth', draft: { plan: { version: 2, kind: 'lantern', motif: 'crescent-moon', finish: 'native', accent: 'none' }, title: 'Moon lantern', plaque: 'SIMULATED invalid kit' }, committedAt: 1,
        provenance: { source: 'simulated', makerName: 'Juniper', kingdomName: 'SIMULATED', designId: 'invalid-design', firstForgedAt: 1 },
      };
      let handlers: ForgeObservationHandlers = {};
      const submit = vi.fn(), settled = vi.fn(), hide = vi.fn();
      const scene = new THREE.Scene(), material = createVoxelMaterial(MATERIALS, 'build');
      const adapter = createRealmForgeScene({ scene, camera: new THREE.PerspectiveCamera(), material,
        pool: { submit } as unknown as VoxelWorkerPool, canvas: { clientWidth: 1440, clientHeight: 900 } as HTMLCanvasElement,
        anvil: new THREE.Vector3(), home: () => ({ slot: 7, blueprint, position: [0, 0, 0], yaw: 0 }),
        sound: {} as ReturnType<typeof createKingdomSound>, hideAttachment: hide,
        feed: { subscribe(next) { handlers = next; return () => {}; }, settled } });
      try {
        handlers.restored?.([attachment]);
        handlers.committed?.(attachment, attachment.runId);
        expect(submit).not.toHaveBeenCalled(); expect(settled).not.toHaveBeenCalled();
        expect(adapter.activeAttachmentId).toBeNull();
        expect(scene.getObjectByName(`realm-forge-clone:${attachment.id}`)).toBeUndefined();
        expect(hide.mock.calls).toEqual([[attachment.id, true], [attachment.id, false]]);
      } finally { adapter.dispose(); material.dispose(); }
    },
  );

  it('keeps opaque stages candidate-free, uses the actual committed rotated socket, restores without celebration and settles only on landing', async () => {
    const originalBlueprint = createHearthHome('house', 0);
    // The public scene's decoder receives canonically ordered JSON, unlike the authority's factory object.
    const decodedBlueprint = JSON.parse(canonicalSceneJson(originalBlueprint)) as VoxelBlueprint;
    const home = { slot: 7, blueprint: decodedBlueprint, position: [31, 2, -17] as const, yaw: Math.PI / 2 };
    const plan = { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' } as const;
    const socket = findForgeSockets(originalBlueprint).find(s => s.kind === plan.kind)!;
    const kit = forgeStyleKit('hearth'), expected = assembleForge(plan, kit, socket);
    const attachment: CommittedForgeAttachment = { version: 1, id: 'approved-dragon', runId: 'opaque-run', kingdomId: KingdomIdSchema.parse('123456'),
      slot: home.slot, hostId: originalBlueprint.id, hostFingerprint: homeFingerprint(originalBlueprint), socketId: socket.id, origin: socket.origin,
      kitId: kit.id, kitRevision: kit.revision, family: 'hearth', draft: { plan, title: 'The sleeping chimney', plaque: 'SIMULATED test room' }, committedAt: 1,
      provenance: { source: 'simulated', makerName: 'Juniper', kingdomName: 'SIMULATED', designId: 'dragon-design', firstForgedAt: 1 } };
    let handlers: ForgeObservationHandlers = {};
    const settled = vi.fn(), unsubscribe = vi.fn(), hide = vi.fn(), phrase = vi.fn(() => true);
    const feed = { subscribe(next: ForgeObservationHandlers) { handlers = next; return unsubscribe; }, settled };
    const submit = vi.fn(async (job: VoxelJobInput) => executeVoxelJob({ ...job, id: 1 }));
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1440 / 900, .1, 300), material = createVoxelMaterial(MATERIALS, 'build');
    const canvas = { clientWidth: 1440, clientHeight: 900 };
    const adapter = createRealmForgeScene({ scene, camera, material, pool: { submit } as unknown as VoxelWorkerPool,
      canvas: canvas as HTMLCanvasElement, anvil: new THREE.Vector3(5, 0, 8), home: slot => slot === 7 ? home : undefined,
      sound: { phrase } as unknown as ReturnType<typeof createKingdomSound>, feed, hideAttachment: hide });
    try {
      handlers.restored?.([attachment]); adapter.update(0, false);
      expect(submit).not.toHaveBeenCalled(); expect(settled).not.toHaveBeenCalled(); expect(phrase).not.toHaveBeenCalled();
      expect(adapter.sources()).toEqual([]); expect(adapter.active()).toBe(false);
      let smoke: THREE.Points | undefined;
      scene.traverse(object => { const points = object as THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>; if (points.isPoints && points.material.uniforms.uMode?.value === 1) smoke = points; });
      expect(smoke).toBeDefined();
      const smokeAlpha = () => [...smoke!.geometry.getAttribute('aAlpha').array].some(value => value > 0);
      expect(smokeAlpha()).toBe(true);
      const emission = new THREE.Vector3(...expected.emitter).add(new THREE.Vector3(...socket.origin)).multiplyScalar(VOXEL_METRES.build)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), home.yaw).add(new THREE.Vector3(...home.position));
      const puff = new THREE.Vector3().fromBufferAttribute(smoke!.geometry.getAttribute('position'), 0).sub(emission);
      // Breath starts at the rotated muzzle and curls forwards/up, never at the house door.
      expect(Math.hypot(puff.x, puff.z)).toBeLessThan(1);
      expect(puff.y).toBeGreaterThanOrEqual(0); expect(puff.y).toBeLessThan(2);
      handlers.stage?.('opaque-activity', 'drafting'); adapter.update(1000, false);
      expect(adapter.active()).toBe(true);
      expect(adapter.sources()).toEqual([]); // Opaque judging cannot invent a luminous casting.
      expect(submit).not.toHaveBeenCalled(); expect(adapter.activeAttachmentId).toBeNull();
      expect(adapter.update(1100, true)).toBe(true);
      camera.updateMatrixWorld(true);
      // The tighter waiting view still holds the anvil and neighbouring hearth/dragon without clipping.
      for (const x of [-1.7, 8.65]) for (const y of [-.125, 4.8]) for (const z of [-5, 1.45]) {
        const p = new THREE.Vector3(x + 5, y, z + 8).project(camera);
        expect(Math.abs(p.x)).toBeLessThan(.96); expect(Math.abs(p.y)).toBeLessThan(.96);
      }
      handlers.ended?.('opaque-activity');
      expect(adapter.update(1150, true)).toBe(false);
      handlers.stage?.('opaque-activity', 'judging-piece');
      expect(adapter.update(1200, true)).toBe(false);
      handlers.committed?.(attachment, 'opaque-activity');
      await vi.waitFor(() => expect(scene.getObjectByName('realm-forge-clone:approved-dragon')).toBeDefined());
      expect(submit).toHaveBeenCalledOnce();
      expect(submit.mock.calls[0]![0]).toMatchObject({ kind: 'blueprint', blueprint: expected.blueprint });
      const clone = scene.getObjectByName('realm-forge-clone:approved-dragon')!;
      const destination = new THREE.Vector3(...socket.origin).multiplyScalar(VOXEL_METRES.build)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), home.yaw).add(new THREE.Vector3(...home.position));
      expect(clone.position.distanceTo(destination)).toBeLessThan(1e-8);
      expect(clone.rotation.y).toBeCloseTo(home.yaw);
      camera.position.set(100, 80, 60); const untouched = camera.position.clone();
      expect(adapter.update(7000, false)).toBe(false); expect(camera.position.equals(untouched)).toBe(true);
      expect(stageHeat).toHaveBeenLastCalledWith(expect.objectContaining({phase:'pour',source:'simulated'}));
      expect(adapter.sources()).toContainEqual({ position: [5, 1.88, 8], normal: [0, 1, 0], strength: 1 });
      // The actual pour prop must fit, not just the candidate: the production shot previously cut off its bail.
      camera.aspect=1440/900; adapter.update(7000,true); camera.updateMatrixWorld(true);
      const crucible=scene.getObjectByName('forge-crucible')!;
      const bounds=new THREE.Box3().setFromObject(crucible);
      for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
        const p=new THREE.Vector3(x,y,z).project(camera);
        expect(Math.abs(p.x)).toBeLessThan(.96);expect(Math.abs(p.y)).toBeLessThan(.96);
      }
      expect(smokeAlpha()).toBe(false);
      expect(hide).toHaveBeenCalledWith(attachment.id, true); expect(settled).not.toHaveBeenCalled();
      // Flight used to aim at the house early and leave the gift above the frame.
      for(const at of [18500,19500,20100]){
      adapter.update(at, true); camera.updateMatrixWorld(true); clone.updateWorldMatrix(true, false);
      const flyingBounds = buildBounds(expected.blueprint);
      for (const x of [flyingBounds.min.x, flyingBounds.max.x]) for (const y of [flyingBounds.min.y, flyingBounds.max.y]) for (const z of [flyingBounds.min.z, flyingBounds.max.z]) {
        const p = clone.localToWorld(new THREE.Vector3(x, y, z)).project(camera);
        expect(Math.abs(p.x)).toBeLessThan(1); expect(Math.abs(p.y)).toBeLessThan(1);
      }
      }
      expect((clone as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>).material.uniforms.uFlightHeat!.value).toBeGreaterThan(.5);
      expect(adapter.update(20200, true)).toBe(true);
      expect(hide).toHaveBeenLastCalledWith(attachment.id, true); expect(settled).toHaveBeenCalledExactlyOnceWith(attachment.id);
      expect(clone.visible).toBe(true);
      expect(smokeAlpha()).toBe(true);
      expect(adapter.sources().every(source => source.strength === 0)).toBe(true);
      adapter.update(20350, true);
      expect(adapter.sources()).toHaveLength(2);
      expect(Math.max(...adapter.sources().map(source => source.strength))).toBeCloseTo(.85);
      const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), home.yaw);
      expect(new THREE.Vector3(...adapter.sources()[0]!.normal).distanceTo(normal)).toBeLessThan(1e-8);
      // Both standard canvases show the entire receiving home and its real mounted piece, including the foundation.
      for (const [width, height] of [[1440, 900], [390, 844]]) {
        canvas.clientWidth = width!; canvas.clientHeight = height!; camera.aspect = width! / height!;
        adapter.update(20400, true); camera.updateMatrixWorld(true);
        for (const [blueprint, origin] of [[decodedBlueprint, [0, 0, 0]], [expected.blueprint, socket.origin]] as const) {
          for (const box of blueprint.boxes) if (box.material) for (const x of [box.from[0], box.to[0]]) for (const y of [box.from[1], box.to[1]]) for (const z of [box.from[2], box.to[2]]) {
            const p = new THREE.Vector3(x + origin[0], y + origin[1], z + origin[2]).multiplyScalar(VOXEL_METRES.build)
              .applyAxisAngle(new THREE.Vector3(0, 1, 0), home.yaw).add(new THREE.Vector3(...home.position)).project(camera);
            expect(Math.abs(p.x)).toBeLessThan(.9); expect(Math.abs(p.y)).toBeLessThan(.9);
          }
        }
        const localEye = camera.position.clone().sub(new THREE.Vector3(...home.position)).applyAxisAngle(new THREE.Vector3(0, 1, 0), -home.yaw);
        expect(localEye.z).toBeGreaterThan(decodedBlueprint.size[2] * VOXEL_METRES.build);
      }
      const landedEye = camera.position.clone();
      expect(adapter.update(23000, true)).toBe(true);
      expect(camera.position.distanceTo(landedEye)).toBeGreaterThan(.1);
      const portraitEye = camera.position.clone();
      adapter.update(23100, true);
      expect(camera.position.distanceTo(portraitEye)).toBeLessThan(1e-8);
      expect((clone as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>).material.uniforms.uLandingWarmth!.value).toBeGreaterThan(.9);
      expect(settled).toHaveBeenCalledOnce();
      adapter.update(23200, true); expect(adapter.sources()).toEqual([]);
      adapter.update(23000, false);
      expect(hide).toHaveBeenLastCalledWith(attachment.id, false);
      handlers.committed?.(attachment, 'opaque-activity'); expect(submit).toHaveBeenCalledOnce();
      expect(adapter.activeAttachmentId).toBeNull();
      expect(adapter.update(24000, true)).toBe(false);
    } finally { adapter.dispose(); material.dispose(); }
    expect(unsubscribe).toHaveBeenCalledOnce(); expect(settled).toHaveBeenCalledOnce();
  });
});
