import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content/materials';
import { PORTRAIT_FIXTURES } from '@chatdom/content/avatar-style';
import { createVoxelMaterial } from '@chatdom/render';
import { createCitizenRenderer, createStyledCitizenLook, type CitizenGesture, type CitizenSample } from './index';

it('eases gestures and heading, keeps walking legs distance-driven, and seats only while stopped', async () => {
  let now = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const scene = new THREE.Scene(), material = createVoxelMaterial(MATERIALS, 'avatar');
  const look = createStyledCitizenLook('person', PORTRAIT_FIXTURES[0]!.look);
  const renderer = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks: [look] });
  const sample: CitizenSample = { id: 'person', look: 'person', position: [0, 0, 0], heading: 0, distance: .3, moving: 1, time: 1 };
  const matrix = (name: string) => {
    const result = new THREE.Matrix4();
    (scene.getObjectByName(`Citizen person ${name} solid`) as THREE.InstancedMesh).getMatrixAt(0, result);
    return result;
  };
  const tick = (patch: Partial<CitizenSample>, elapsed = 100) => { now += elapsed; renderer.update([{ ...sample, ...patch }]); };
  try {
    renderer.update([sample]);
    for (let i = 0; i < 4; i++) tick({ gesture: 'none' });
    const foot = matrix('footRight');
    const poses = new Map<CitizenGesture, THREE.Matrix4>();
    for (const gesture of ['wave', 'bow', 'cheer', 'point'] as const) {
      // Let the previous pose settle away before observing the next one.
      for (let i = 0; i < 4; i++) tick({ gesture: 'none' });
      const before = matrix('upperArmRight');
      tick({ gesture });
      const first = matrix('upperArmRight');
      for (let i = 0; i < 3; i++) tick({ gesture });
      const settled = matrix('upperArmRight');
      if (gesture !== 'bow') expect(first.equals(settled)).toBe(false);
      expect(settled.equals(before)).toBe(false);
      expect(matrix('footRight').equals(foot)).toBe(true);
      poses.set(gesture, settled);
    }
    expect(poses.get('wave')!.equals(poses.get('point')!)).toBe(false);
    for (let i = 0; i < 4; i++) tick({ gesture: 'dance', moving: 0, time: 1 });
    const dance = matrix('upperArmLeft');
    tick({ gesture: 'dance', moving: 0, time: 1.3 });
    expect(matrix('upperArmLeft').equals(dance)).toBe(false);
    for (let i = 0; i < 4; i++) tick({ gesture: 'sit' });
    expect(matrix('footRight').equals(foot)).toBe(true);
    for (let i = 0; i < 4; i++) tick({ gesture: 'sit', moving: 0 });
    expect(matrix('footRight').equals(foot)).toBe(false);
    tick({ heading: Math.PI / 2, gesture: 'none' });
    const headingStep = matrix('footRight');
    for (let i = 0; i < 10; i++) tick({ heading: Math.PI / 2, gesture: 'none' });
    expect(headingStep.equals(matrix('footRight'))).toBe(false);
  } finally {
    renderer.dispose(); material.dispose(); clock.mockRestore();
  }
});
