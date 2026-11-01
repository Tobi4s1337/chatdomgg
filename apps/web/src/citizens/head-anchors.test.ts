import { expect, it } from 'vitest';
import * as THREE from 'three';
import { MAT, MATERIALS, AVATAR_PALETTE } from '@chatdom/content/materials';
import { compileAvatarPart, createBodyParts } from '@chatdom/content/avatars';
import { type AvatarPartBlueprint } from '@chatdom/shared';
import { VoxelWorkerPool, type VoxelWorkerAdapter } from '@chatdom/voxel';
import { executeVoxelJob, type VoxelJob } from '../../../../packages/voxel/src/protocol';
import { PORTRAIT_FIXTURES } from '@chatdom/content/avatar-style';
import { createVoxelMaterial } from '@chatdom/render';
import { createCitizenRenderer, createStyledCitizenLook, type CitizenSample } from './index';

it('tracks rendered head and tall hat bounds through sitting, bowing, tiptoe and departure', async () => {
  const base = PORTRAIT_FIXTURES[0]!.look;
  const plain = createStyledCitizenLook('plain', { ...base, hat: null, glasses: null });
  const tall = createStyledCitizenLook('tall', { ...base, glasses: null, hat: { style: 'pointed-hat', colour: '#31488c', trim: '#f2d785' } });
  const scene = new THREE.Scene(), material = createVoxelMaterial(MATERIALS, 'avatar');
  const renderer = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks: [plain, tall] });
  const sample: CitizenSample = { id: 'person', look: 'tall', position: [0, 0, 0], heading: 0, distance: 0, moving: 0, time: 0 };
  const bounds = (look: string, index = 0) => {
    const mesh = scene.getObjectByName(`Citizen ${look} head solid`) as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4(); mesh.getMatrixAt(index, matrix);
    return mesh.geometry.boundingBox!.clone().applyMatrix4(matrix);
  };
  const check = (id: string, look: string) => {
    const anchor = renderer.heads.get(id)!, box = bounds(look);
    expect(anchor.y).toBeCloseTo(box.max.y + .08, 6);
    expect(anchor.x).toBeCloseTo((box.min.x + box.max.x) / 2, 6);
    expect(anchor.z).toBeCloseTo((box.min.z + box.max.z) / 2, 6);
    return anchor.clone();
  };
  try {
    renderer.update([{ ...sample, id: 'plain-person', look: 'plain', position: [2, 0, 0] }, sample], undefined, 0);
    const shortHead = check('plain-person', 'plain'), standing = check('person', 'tall');
    expect(standing.y - shortHead.y).toBeGreaterThan(.1);
    let priorHeight = standing.y;
    for (let i = 1; i <= 4; i++) {
      renderer.update([{ ...sample, posture: 'seated' }], undefined, i * 70);
      const current = check('person', 'tall');
      expect(current.y).toBeLessThan(priorHeight);
      priorHeight = current.y;
    }
    expect(standing.y - priorHeight).toBeCloseTo(.25, 5);
    expect(renderer.heads.has('plain-person')).toBe(false);
    for (let i = 5; i <= 8; i++) renderer.update([{ ...sample, gesture: 'bow', lookPitch: .25 }], undefined, i * 70);
    const bowed = check('person', 'tall');
    expect(bowed.distanceTo(standing)).toBeGreaterThan(.05);
    for (let i = 9; i <= 12; i++) renderer.update([{ ...sample, tiptoe: 1, opacity: 0 }], undefined, i * 70);
    const toes = check('person', 'tall');
    expect(toes.y).toBeGreaterThan(standing.y);
    renderer.update([], undefined, 1000);
    expect(renderer.heads.size).toBe(0);
    renderer.dispose(); expect(renderer.heads.size).toBe(0);
  } finally { renderer.dispose(); material.dispose(); }
});

it('includes a legacy hat socket and drops anchors when its citizen is culled', async () => {
  const pool = new VoxelWorkerPool({ size: 1, createWorker: () => {
    const worker: VoxelWorkerAdapter = {
      onmessage: null, onerror: null,
      postMessage(job: VoxelJob) { queueMicrotask(() => worker.onmessage?.({ data: executeVoxelJob(job) } as MessageEvent)); },
      terminate() {},
    };
    return worker;
  } });
  const head = createBodyParts('balanced', AVATAR_PALETTE.skin[0]).find(part => part.attachment === 'head')!;
  const hat: AvatarPartBlueprint = { version: 1, id: 'fixture.anchor-hat', lattice: 'avatar', size: [2, 5, 2], pivot: [0, 0, 0], attachment: 'hat', layer: 'accessory', boxes: [{ from: [0, 0, 0], to: [2, 5, 2], material: MAT.brass }] };
  const look = { id: 'legacy', parts: [head, hat].map(blueprint => ({ blueprint, asset: compileAvatarPart(blueprint, 0) })) };
  const scene = new THREE.Scene(), material = createVoxelMaterial(MATERIALS, 'avatar');
  const renderer = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks: [look], pool });
  const sample: CitizenSample = { id: 'p', look: 'legacy', position: [0, 0, 0], heading: 0, distance: 0, moving: 0 };
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, .1, 100);
  camera.position.set(0, 2, 10); camera.lookAt(0, 1, 0); camera.updateProjectionMatrix();
  try {
    renderer.update([sample], undefined, 0);
    const hatMesh = scene.getObjectByName('Citizen legacy fixture.anchor-hat') as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4(); hatMesh.getMatrixAt(0, matrix);
    // This 5-cell hat starts at its own zero pivot, on the head's hat socket.
    const hatTop = new THREE.Vector3(0, 5 / 16, 0).applyMatrix4(matrix);
    expect(renderer.heads.get('p')!.y).toBeCloseTo(hatTop.y + .08, 6);
    camera.lookAt(100, 2, 10);
    renderer.update([sample], camera, 16);
    expect(renderer.heads.has('p')).toBe(false);
  } finally { renderer.dispose(); material.dispose(); pool.dispose(); }
});
