import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { AVATAR_RIG, AVATAR_LOOK_LIMITS, VOXEL_METRES } from '@chatdom/shared';
import { MATERIALS, AVATAR_PALETTE } from '@chatdom/content/materials';
import { compileAvatarPart, createBodyParts, createCape } from '@chatdom/content/avatars';
import { buildCitizen, PORTRAIT_FIXTURES, slotColours } from '@chatdom/content/avatar-style';
import { createVoxelMaterial, getEnvironment } from '@chatdom/render';
import { VoxelWorkerPool, type VoxelWorkerAdapter } from '@chatdom/voxel';
import { executeVoxelJob, type VoxelJob } from '../../../../packages/voxel/src/protocol';
import { createCitizenRenderer, type CitizenSample } from './index';
import { createStyledCitizenLook, meshStyledCitizen, partitionStyledCitizen, STYLED_CITIZEN_RIG } from './style-adapter';
import { createStyledCitizenMaterial, styledCitizenGeometry } from './style-material';

const recipe = PORTRAIT_FIXTURES[0]!.look;
const sample = (id: string, look: string): CitizenSample => ({ id, look, position: [0, 0, 0], heading: 0, distance: 0, moving: 0, time: 0 });

describe('painted citizen runtime adapter', () => {
  it('preserves every painted cell in all 20 whole citizens and closes articulated parts within the look budget', () => {
    expect(PORTRAIT_FIXTURES).toHaveLength(20);
    for (const fixture of PORTRAIT_FIXTURES) {
      const original = buildCitizen(fixture.look), restored = new Map<string, string>();
      const parts = partitionStyledCitizen(fixture.look);
      for (const grid of parts.values()) for (const [cell, slot] of grid.entries()) {
        expect(restored.has(cell.join(','))).toBe(false);
        restored.set(cell.join(','), slot);
      }
      expect(restored.size).toBe(original.size);
      for (const [cell, slot] of original.entries()) expect(restored.get(cell.join(','))).toBe(slot);
      const meshes = meshStyledCitizen(createStyledCitizenLook(fixture.name, fixture.look));
      expect(meshes.reduce((n, part) => n + part.mesh.indices.length / 3, 0)).toBeLessThan(AVATAR_LOOK_LIMITS.maxTriangles);
      expect(meshes.length).toBeLessThanOrEqual(17); // fifteen bones, a continuous hem and optional lenses
      const bytes = meshes.reduce((n, part) => n + Object.values(part.mesh).reduce((sum, value) => sum + (ArrayBuffer.isView(value) ? value.byteLength : 0), 0), 0);
      expect(bytes).toBeLessThan(2_000_000);
    }
  });

  it('keeps long hair on the head and continuous garment hems on their hip hinge', () => {
    const long = { ...recipe, hair: { ...recipe.hair, style: 'long-waves' as const }, top: { ...recipe.top, style: 'robe' as const }, outer: null };
    const parts = partitionStyledCitizen(long);
    const head = [...parts.get('head')!.entries()];
    expect(head.some(([[, y], slot]) => y < 16 && slot.startsWith('hair'))).toBe(true);
    const hem = [...parts.get('hem')!.entries()];
    expect(hem.some(([[, y], slot]) => y === 3 && slot.startsWith('top'))).toBe(true);
    for (const [bone, grid] of parts) if (bone !== 'head') {
      expect([...grid.entries()].some(([, slot]) => slot.startsWith('hair'))).toBe(false);
    }
    const skirt = partitionStyledCitizen({ ...recipe, bottom: { ...recipe.bottom, style: 'skirt' }, outer: null });
    expect([...skirt.get('hem')!.entries()].filter(([[, y], slot]) => y === 3 && slot.startsWith('bottom')).length).toBeGreaterThan(0);
  });

  it('uses exact linear paint and source corner AO in the existing environment, including live texture replacement', () => {
    const look = createStyledCitizenLook('exact-paint', { ...recipe, skin: '#42a7c3' });
    const head = meshStyledCitizen(look).find(part => part.attachment === 'head' && part.surface === 'solid')!;
    const geometry = styledCitizenGeometry(head.mesh, 'solid');
    const expected = new THREE.Color('#42a7c3');
    const skin = slotColours(look.recipe).skin;
    const i = Array.from({ length: head.mesh.colours.length / 3 }, (_, i) => i).find(i => skin.every((v, c) => Math.abs(head.mesh.colours[i * 3 + c]! - v) < 1e-6))!;
    expect(i).toBeDefined();
    const paint = geometry.getAttribute('aPaint');
    expect(paint.getX(i)).toBeCloseTo(expected.r, 6);
    expect(paint.getY(i)).toBeCloseTo(expected.g, 6);
    expect(paint.getZ(i)).toBeCloseTo(expected.b, 6);
    expect(geometry.getAttribute('aOcclusion').array).toEqual(head.mesh.occlusion);
    const lighting = createVoxelMaterial(MATERIALS, 'avatar');
    const material = createStyledCitizenMaterial(lighting, 'solid');
    expect(material.uniforms).toBe(lighting.material.uniforms);
    lighting.setEnvironment(getEnvironment(19));
    expect(material.uniforms.uNight).toBe(lighting.material.uniforms.uNight);
    lighting.setLight({ revision: 1, origin: [1, 2, 3], size: [2, 2, 2], cellSize: .5, light: new Uint8Array(8).fill(12), visited: 8, estimatedPeakBytes: 8 });
    expect(material.uniforms.uLight!.value.image.width).toBe(2);
    expect(material.fragmentShader).toContain('surfaceField(uLight');
    expect(material.fragmentShader).toContain('float opticalDepth=');
    expect(material.fragmentShader).toContain('#include <tonemapping_fragment>');
    expect(material.fragmentShader).not.toContain('texelFetch(uPalette,ivec2(int(vMaterial');
    expect(material.fragmentShader).not.toContain('base*=1.+(.03*variation');
    material.dispose(); geometry.dispose(); lighting.dispose();
  });

  it('preserves lens transparency without deleting the eyes behind it', () => {
    const look = createStyledCitizenLook('glasses', { ...recipe, glasses: { style: 'square', colour: '#123456', lens: '#ffffff' } });
    const parts = meshStyledCitizen(look), lenses = parts.find(part => part.surface === 'glass')!;
    expect(lenses.attachment).toBe('head');
    const geometry = styledCitizenGeometry(lenses.mesh, 'glass');
    expect(geometry.getAttribute('aPaintAlpha').getX(0)).toBeCloseTo(.2);
    const lighting = createVoxelMaterial(MATERIALS, 'avatar');
    const material = createStyledCitizenMaterial(lighting, 'glass');
    expect(material.transparent).toBe(true); expect(material.depthWrite).toBe(false);
    const eye = slotColours(look.recipe).eye;
    expect(parts.find(part => part.attachment === 'head' && part.surface === 'solid')!.mesh.colours.some((_, i, values) => i % 3 === 0 && eye.every((v, c) => Math.abs(values[i + c]! - v) < 1e-6))).toBe(true);
    material.dispose(); geometry.dispose(); lighting.dispose();
  });

  it('animates old and new looks together with local shoulder offsets, moving grips and the same thin cloth', async () => {
    let terminated = false;
    const pool = new VoxelWorkerPool({ size: 1, createWorker: () => {
      const worker: VoxelWorkerAdapter = {
        onmessage: null, onerror: null,
        postMessage(job: VoxelJob) { queueMicrotask(() => worker.onmessage?.({ data: executeVoxelJob(job) } as MessageEvent)); },
        terminate() { terminated = true; },
      };
      return worker;
    } });
    const blueprint = createBodyParts('balanced', AVATAR_PALETTE.skin[2])[0]!;
    const legacy = { id: 'legacy', parts: [{ blueprint, asset: compileAvatarPart(blueprint, 0) }] };
    const cape = createCape('shortCloak', { body: 'balanced', style: 'hearth' });
    const look = createStyledCitizenLook('new', recipe, { cape });
    const scene = new THREE.Scene(), lighting = createVoxelMaterial(MATERIALS, 'avatar');
    const lightingDisposed = vi.fn(); lighting.material.addEventListener('dispose', lightingDisposed);
    const renderer = await createCitizenRenderer(scene, { registry: MATERIALS, material: lighting, looks: [legacy, look], capacity: 2, pool });
    renderer.update([sample('old-person', 'legacy'), sample('new-person', 'new')], undefined, 0);
    const oldGrip = new THREE.Vector3().setFromMatrixPosition(renderer.grips.get('old-person')!);
    const newGrip = new THREE.Vector3().setFromMatrixPosition(renderer.grips.get('new-person')!);
    expect(oldGrip.x - newGrip.x).toBeCloseTo(VOXEL_METRES.avatar, 8);
    expect(oldGrip.y).toBeCloseTo(newGrip.y, 8);
    expect(oldGrip.z).toBeCloseTo(newGrip.z, 8);
    expect(AVATAR_RIG.find(b => b.id === 'upperArmRight')!.offset[0]).toBe(5);
    expect(STYLED_CITIZEN_RIG.find(b => b.id === 'upperArmRight')!.offset[0]).toBe(4);
    const cloth = scene.children.find(o => o.name === 'Citizen cape cloth') as THREE.InstancedMesh;
    expect(cloth.count).toBe(1); expect(cloth.geometry.getAttribute('position').count).toBe(77);
    const mesh = scene.getObjectByName('Citizen new head solid') as THREE.InstancedMesh;
    const initial = new THREE.Matrix4(); mesh.getMatrixAt(0, initial);
    for (let frame = 1; frame <= 10; frame++) {
      const distance = .045 * frame;
      renderer.update([{ ...sample('new-person', 'new'), position: [0, 0, distance], distance, moving: 1, speed: .45, gesture: 'wave', time: frame / 10, opacity: .4 }], undefined, frame * 100);
    }
    expect(renderer.grips.has('old-person')).toBe(false);
    const relativeGrip = new THREE.Vector3().setFromMatrixPosition(renderer.grips.get('new-person')!).sub(new THREE.Vector3(0, 0, .45));
    expect(relativeGrip.distanceTo(newGrip)).toBeGreaterThan(.1);
    expect(mesh.geometry.getAttribute('aLodFade').getX(0)).toBeCloseTo(.4);
    const walked = new THREE.Matrix4(); mesh.getMatrixAt(0, walked);
    expect(walked.equals(initial)).toBe(false);
    const disposed = vi.fn(); (mesh.material as THREE.Material).addEventListener('dispose', disposed);
    renderer.update([]); expect(cloth.count).toBe(0); expect(mesh.count).toBe(0);
    renderer.dispose(); expect(scene.children).toHaveLength(0); expect(disposed).toHaveBeenCalledOnce();
    expect(lightingDisposed).not.toHaveBeenCalled(); expect(terminated).toBe(false);
    pool.dispose(); lighting.dispose(); expect(terminated).toBe(true);
  });

  it('prepares painted-only looks without workers and rejects duplicate look IDs', async () => {
    const scene = new THREE.Scene(), lighting = createVoxelMaterial(MATERIALS, 'avatar');
    const look = createStyledCitizenLook('new', recipe);
    const renderer = await createCitizenRenderer(scene, { registry: MATERIALS, material: lighting, looks: [look] });
    expect(() => renderer.update([sample('person', 'unknown')])).toThrow('Unknown citizen look');
    renderer.dispose();
    await expect(createCitizenRenderer(scene, { registry: MATERIALS, material: lighting, looks: [look, look] })).rejects.toThrow('Duplicate citizen look');
    expect(scene.children).toHaveLength(0);
    lighting.dispose();
  });

  it('folds a continuous skirt onto the seated lap without crossing the sole datum', async () => {
    const look = createStyledCitizenLook('skirt', { ...recipe, bottom: { ...recipe.bottom, style: 'skirt' }, outer: null });
    const scene = new THREE.Scene(), lighting = createVoxelMaterial(MATERIALS, 'avatar');
    const renderer = await createCitizenRenderer(scene, { registry: MATERIALS, material: lighting, looks: [look] });
    renderer.update([{ ...sample('seated-person', 'skirt'), posture: 'seated' }]);
    const hem = scene.getObjectByName('Citizen skirt hem solid') as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4(); hem.getMatrixAt(0, matrix);
    const bounds = hem.geometry.boundingBox!.clone().applyMatrix4(matrix);
    expect(bounds.min.y).toBeGreaterThanOrEqual(0);
    expect(bounds.max.z - bounds.min.z).toBeCloseTo(5 * VOXEL_METRES.avatar);
    const foot = scene.getObjectByName('Citizen skirt footRight solid') as THREE.InstancedMesh;
    foot.getMatrixAt(0, matrix);
    expect(foot.geometry.boundingBox!.clone().applyMatrix4(matrix).min.y).toBeCloseTo(0, 7);
    renderer.dispose(); lighting.dispose();
  });
});
