import { expect, it } from 'vitest';
import * as THREE from 'three';
import { AvatarCapeBlueprintSchema, type AvatarCapeBlueprint } from '@chatdom/shared';
import { MAT, MATERIALS, AVATAR_PALETTE } from '@chatdom/content/materials';
import { createVoxelMaterial, getEnvironment } from '@chatdom/render';
import { createCitizenCapeRenderer } from './capes';

it('keeps cloth separate from voxels, batches cuts, settles after a stop and releases absent identities', () => {
  const cape: AvatarCapeBlueprint = {
    version: 1, id: 'cape.test', kind: 'cape', attachment: 'back', shape: 'flared', width: .58, length: .61,
    hem: 'rounded', trimWidth: .018, mount: { height: .0625, back: .095 },
    colours: { cloth: MAT.fabricRed, lining: MAT.fabricMutedRed, trim: MAT.fabricGold },
    shimmer: { swatches: [...AVATAR_PALETTE.rainbow], strength: .6 },
  };
  expect(AvatarCapeBlueprintSchema.safeParse(cape).success).toBe(true);
  expect(AvatarCapeBlueprintSchema.safeParse({ ...cape, boxes: [] }).success).toBe(false);
  expect(AvatarCapeBlueprintSchema.safeParse({ ...cape, length: 2 }).success).toBe(false);
  expect(AvatarCapeBlueprintSchema.safeParse({ ...cape, shimmer: { swatches: [40, 41], strength: 1 } }).success).toBe(false);
  expect(AvatarCapeBlueprintSchema.safeParse({ ...cape, colours: { ...cape.colours, cloth: 0 } }).success).toBe(false);

  const scene = new THREE.Scene(), lighting = createVoxelMaterial(MATERIALS, 'avatar');
  lighting.setEnvironment(getEnvironment(19));
  const renderer = createCitizenCapeRenderer(scene, { registry: MATERIALS, material: lighting, capacity: 2 });
  const back = new THREE.Matrix4().makeTranslation(4, .875, 8);
  const a = { id: 'real-identity-a', heading: 0, distance: 2, speed: 3 };
  const b = { id: 'real-identity-b', heading: Math.PI, distance: 1, speed: 0 };
  const upload = (time: number, speed: number) => {
    renderer.beginFrame(time, [0, 0]); renderer.add({ ...a, speed }, cape, back); renderer.endFrame();
  };
  renderer.beginFrame(0);
  renderer.add(a, cape, back);
  renderer.add(b, { ...cape, id: 'cape.other', shape: 'tapered', hem: 'notched' }, back);
  renderer.endFrame();
  expect(renderer.stats).toEqual({ draws: 1, capes: 2, triangles: 240, trackedCitizens: 2 });
  expect(renderer.mesh.geometry.getAttribute('position').count).toBe(77);
  expect(renderer.mesh.geometry.index?.count).toBe(360);
  expect(renderer.mesh.material.side).toBe(THREE.DoubleSide);
  expect(renderer.mesh.material.uniforms.uLight).toBe(lighting.material.uniforms.uLight);
  expect(renderer.mesh.material.uniforms.uSun).toBe(lighting.material.uniforms.uSun);
  const actual = new THREE.Matrix4();
  renderer.mesh.getMatrixAt(0, actual);
  expect(actual.elements).toEqual(back.elements);
  const motion = renderer.mesh.geometry.getAttribute('aCapeMotion');
  const runningLift = motion.getX(0);
  upload(1 / 60, 0);
  expect(motion.getX(0)).toBeGreaterThan(runningLift * .9); // no movement=0 snap
  expect(renderer.stats.trackedCitizens).toBe(1); // absent B has no retained history
  for (let frame = 2; frame <= 120; frame++) upload(frame / 60, 0);
  expect(motion.getX(0)).toBeLessThan(.001);
  renderer.beginFrame(3); renderer.endFrame();
  expect(renderer.stats).toEqual({ draws: 0, capes: 0, triangles: 0, trackedCitizens: 0 });
  renderer.dispose();
  expect(scene.children).toHaveLength(0);
  lighting.dispose();
});
