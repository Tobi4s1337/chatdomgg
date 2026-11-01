import { expect, it } from 'vitest';
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content/materials';
import { PORTRAIT_FIXTURES } from '@chatdom/content/avatar-style';
import { createVoxelMaterial } from '@chatdom/render';
import { createCitizenRenderer, createStyledCitizenLook, type CitizenSample } from './index';
import { createFootstepState, stepFootsteps } from './footsteps';

it.each([[1.2, .008], [7, .008], [7, 1 / 30], [7, 1 / 20], [7, 1 / 15]])('holds actual rendered stance feet at %s m/s with %s second frames through a turn', async (speed, dt) => {
  const scene = new THREE.Scene(), material = createVoxelMaterial(MATERIALS, 'avatar');
  const look = createStyledCitizenLook('test', PORTRAIT_FIXTURES[0]!.look);
  const renderer = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks: [look] });
  let x = 0, z = 0, distance = 0, now = 0;
  const sample: CitizenSample = { id: 'p', look: 'test', position: [0, 0, 0], heading: 0, distance, moving: 1, speed };
  const state = createFootstepState({ ...sample, speed, timeMs: now });
  renderer.update([sample], undefined, now);
  let previous: THREE.Vector3[] = [], lastStance: readonly boolean[] = [false, false], observed = 0;
  const foot = (side: 'Left' | 'Right') => {
    const mesh = scene.getObjectByName(`Citizen test foot${side} solid`) as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4(); mesh.getMatrixAt(0, matrix);
    return new THREE.Vector3(side === 'Left' ? -.125 : .125, .0625, 0).applyMatrix4(matrix);
  };
  try {
    for (let i = 0; i < 400; i++) {
      const turn = i > 200 ? .25 : 0, d = speed * dt;
      x += Math.sin(turn) * d; z += Math.cos(turn) * d; distance += d; now += dt * 1000;
      const next = { ...sample, position: [x, 0, z] as const, heading: turn, distance };
      const result = stepFootsteps(state, { ...next, speed, timeMs: now });
      // Mirror the renderer's shortest-arc heading smoothing for the IK frame.
      renderer.update([next], undefined, now);
      const current = [foot('Left'), foot('Right')];
      for (let j = 0; j < 2; j++) if (i > 40 && result.stance[j] && lastStance[j]) {
        expect(current[j]!.distanceTo(previous[j]!)).toBeLessThan(.004);
        observed++;
      }
      previous = current; lastStance = result.stance;
    }
    // At 15 fps, a 0.36 m stance is shorter than a 0.467 m frame:
    // no two consecutive frames are guaranteed to sample the same contact.
    if (dt <= 1 / 20) expect(observed).toBeGreaterThan(1);
    expect(state.blend).toBeCloseTo(1);
    expect(state.distance).toBeCloseTo(distance);
    // Relocation/height changes rebase immediately; the feet cannot stretch back across town.
    renderer.update([{ ...sample, position: [100, 1, 100], distance: 0 }], undefined, now + 16);
    expect(foot('Left').distanceTo(new THREE.Vector3(99.875, 1.0625, 100))).toBeLessThan(.12);
  } finally { renderer.dispose(); material.dispose(); }
});

it('finishes a stop with one supporting foot, restarts smoothly and rebases corrections and height steps', () => {
  let now = 0, z = 0, distance = 0;
  const sample = () => ({ position: [0, 0, z] as const, heading: 0, distance, moving: 1, speed: 1.2, timeMs: now });
  const state = createFootstepState(sample());
  for (let i = 0; i < 45; i++) { now += 10; z += .012; distance += .012; stepFootsteps(state, sample()); }
  let previous = stepFootsteps(state, { ...sample(), moving: 0 });
  let plantedFrames = 0;
  for (let i = 0; i < 50; i++) {
    now += 10;
    const current = stepFootsteps(state, { ...sample(), moving: 0 });
    for (let leg = 0; leg < 2; leg++) if (previous.stance[leg] && current.stance[leg]) {
      expect(current.feet[leg]!.distanceTo(previous.feet[leg]!)).toBeLessThan(.001);
      plantedFrames++;
    }
    previous = current;
  }
  expect(plantedFrames).toBeGreaterThan(40);
  let rendered = previous.feet.map(v => v.clone());
  for (let i = 0; i < 20; i++) {
    now += 10; z += .012; distance += .012;
    const next = stepFootsteps(state, sample());
    const blended = next.feet.map((v, leg) => new THREE.Vector3(leg ? .125 : -.125, .0625, z).lerp(v, next.blend));
    for (let leg = 0; leg < 2; leg++) expect(blended[leg]!.distanceTo(rendered[leg]!)).toBeLessThan(.05);
    rendered = blended;
  }
  now += 10;
  const corrected = stepFootsteps(state, { ...sample(), position: [20, 0, 20] });
  expect(corrected.blend).toBe(0);
  expect(corrected.feet[0].distanceTo(new THREE.Vector3(19.875, .0625, 20))).toBeLessThan(1e-6);
  const stepped = stepFootsteps(state, { ...sample(), position: [20, .125, 20], timeMs: now + 10 });
  expect(stepped.blend).toBe(0);
  expect(stepped.feet[0].y).toBeCloseTo(.1875);
});

it('preserves the planted toe pivot and seated sole datum outside locomotion', async () => {
  const scene = new THREE.Scene(), material = createVoxelMaterial(MATERIALS, 'avatar');
  const look = createStyledCitizenLook('test', PORTRAIT_FIXTURES[0]!.look);
  const renderer = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks: [look] });
  const sample: CitizenSample = { id: 'p', look: 'test', position: [0, 0, 0], heading: 0, distance: 0, moving: 0 };
  const toe = () => {
    const mesh = scene.getObjectByName('Citizen test footRight solid') as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4(); mesh.getMatrixAt(0, matrix);
    return new THREE.Vector3(.125, 0, .1875).applyMatrix4(matrix);
  };
  try {
    renderer.update([sample], undefined, 0);
    const standing = toe();
    renderer.update([{ ...sample, tiptoe: 1 }], undefined, 100);
    expect(toe().distanceTo(standing)).toBeLessThan(1e-6);
    renderer.update([], undefined, 200);
    renderer.update([{ ...sample, posture: 'seated' }], undefined, 300);
    expect(toe().y).toBeCloseTo(0, 6);
  } finally { renderer.dispose(); material.dispose(); }
});

it('emits each actual touchdown once, with no entry, stationary, rebase or hidden catch-up events', async () => {
  const scene = new THREE.Scene(), material = createVoxelMaterial(MATERIALS, 'avatar');
  const look = createStyledCitizenLook('test', PORTRAIT_FIXTURES[0]!.look);
  const renderer = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks: [look] });
  const sample: CitizenSample = { id: 'walker', look: 'test', position: [0, 0, 0], heading: 0, distance: 0, moving: 1, speed: 4 };
  try {
    renderer.update([sample], undefined, 0);
    expect(renderer.footfalls).toEqual([]);
    const events: { side: 'left' | 'right'; z: number }[] = [];
    for (let i = 1; i <= 120; i++) {
      const distance = 4 * i / 60;
      renderer.update([{ ...sample, position: [0, 0, distance], distance }], undefined, i * 1000 / 60);
      expect(renderer.footfalls.length).toBeLessThanOrEqual(1);
      for (const event of renderer.footfalls) {
        expect(event.id).toBe('walker'); expect(event.position[1]).toBe(0);
        events.push({ side: event.side, z: event.position[2] });
      }
    }
    expect(events.length).toBeGreaterThanOrEqual(8);
    expect(events.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.side).not.toBe(events[i - 1]!.side);
      expect(events[i]!.z - events[i - 1]!.z).toBeCloseTo(.85, 4);
    }
    renderer.update([{ ...sample, position: [0, 0, 8], distance: 8, moving: 0, speed: 0 }], undefined, 2017);
    expect(renderer.footfalls).toEqual([]);
    renderer.update([{ ...sample, position: [100, 0, 100], distance: 0 }], undefined, 2034);
    expect(renderer.footfalls).toEqual([]);
    renderer.update([{ ...sample, position: [100, 0, 101], distance: 1 }], undefined, 3034);
    expect(renderer.footfalls).toEqual([]);
    renderer.update([], undefined, 3050);
    expect(renderer.footfalls).toEqual([]);
  } finally { renderer.dispose(); material.dispose(); }
});

it.each([30, 20, 15])('reconstructs sprint touchdowns at %s fps without duplicate or catch-up bursts', fps => {
  const first = { position: [0, 0, 0] as const, heading: 0, distance: 0, moving: 1, speed: 7, timeMs: 0 };
  const state = createFootstepState(first), events: { side: 'left' | 'right'; sole: THREE.Vector3 }[] = [];
  stepFootsteps(state, first);
  for (let i = 1; i <= fps * 2; i++) {
    const d = 7 * i / fps;
    const result = stepFootsteps(state, { ...first, position: [0, 0, d], distance: d, timeMs: i * 1000 / fps });
    expect(result.footfalls.length).toBeLessThanOrEqual(1);
    events.push(...result.footfalls);
    expect(result.blend).toBeGreaterThan(i / fps < .18 ? 0 : .9);
  }
  expect(events.length).toBeGreaterThanOrEqual(16);
  expect(events.length).toBeLessThanOrEqual(17);
  for (let i = 1; i < events.length; i++) {
    expect(events[i]!.side).not.toBe(events[i - 1]!.side);
    expect(events[i]!.sole.z - events[i - 1]!.sole.z).toBeCloseTo(.85, 5);
  }
});

it('keeps first-person transparent footsteps, but never replays contacts after frustum culling', async () => {
  const scene = new THREE.Scene(), material = createVoxelMaterial(MATERIALS, 'avatar');
  const look = createStyledCitizenLook('test', PORTRAIT_FIXTURES[0]!.look);
  const renderer = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks: [look] });
  const camera = new THREE.OrthographicCamera(-3, 3, 3, -3, .1, 100);
  camera.position.set(0, 2, 15); camera.lookAt(0, 1, 0); camera.updateProjectionMatrix();
  const sample: CitizenSample = { id: 'p', look: 'test', position: [0, 0, 0], heading: 0, distance: 0, moving: 1, speed: 4, opacity: 0 };
  try {
    let contacts = 0;
    for (let i = 0; i <= 60; i++) {
      const distance = i * 4 / 60;
      renderer.update([{ ...sample, position: [0, 0, distance], distance }], camera, i * 1000 / 60);
      contacts += renderer.footfalls.length;
    }
    expect(contacts).toBeGreaterThan(0);
    camera.lookAt(100, 2, 15);
    renderer.update([{ ...sample, position: [0, 0, 4.067], distance: 4.067 }], camera, 1017);
    expect(renderer.footfalls).toEqual([]);
    camera.lookAt(0, 1, 4.13);
    renderer.update([{ ...sample, position: [0, 0, 4.13], distance: 4.13 }], camera, 1034);
    expect(renderer.footfalls).toEqual([]);
    expect(renderer.grips.has('p')).toBe(true);
  } finally { renderer.dispose(); material.dispose(); }
});

it('keeps both rendered soles above ground throughout walking into and out of sitting and tiptoe', async () => {
  const scene = new THREE.Scene(), material = createVoxelMaterial(MATERIALS, 'avatar');
  const look = createStyledCitizenLook('test', PORTRAIT_FIXTURES[0]!.look);
  const renderer = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks: [look] });
  let now = 0, distance = 0;
  const sample: CitizenSample = { id: 'p', look: 'test', position: [0, 0, 0], heading: 0, distance: 0, moving: 1, speed: 1.2 };
  const soles = () => (['Left', 'Right'] as const).map(side => {
    const mesh = scene.getObjectByName(`Citizen test foot${side} solid`) as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4(); mesh.getMatrixAt(0, matrix);
    return mesh.geometry.boundingBox!.clone().applyMatrix4(matrix).min.y;
  });
  const tips = () => (['Left', 'Right'] as const).map(side => {
    const mesh = scene.getObjectByName(`Citizen test foot${side} solid`) as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4(); mesh.getMatrixAt(0, matrix);
    return new THREE.Vector3(side === 'Left' ? -.125 : .125, 0, .1875).applyMatrix4(matrix);
  });
  try {
    for (let i = 0; i < 30; i++) {
      now += 20; distance += .024;
      renderer.update([{ ...sample, position: [0, 0, distance], distance }], undefined, now);
    }
    const stopped = { ...sample, position: [0, 0, distance] as const, distance, moving: 0, speed: 0 };
    let lastTips = tips();
    for (let frame = 0; frame < 30; frame++) {
      now += 20;
      renderer.update([{ ...stopped, ...(frame < 15 ? { posture: 'seated' as const } : {}) }], undefined, now);
      for (const y of soles()) expect(y).toBeGreaterThanOrEqual(-1e-5);
      const currentTips = tips();
      for (let leg = 0; leg < 2; leg++) if (lastTips[leg]!.y < .001 && currentTips[leg]!.y < .001) {
        expect(currentTips[leg]!.distanceTo(lastTips[leg]!)).toBeLessThan(.008);
      }
      lastTips = currentTips;
    }
    // Restart, then stop and rise gradually while the walking blend is still settling.
    for (let i = 0; i < 25; i++) {
      now += 20; distance += .024;
      renderer.update([{ ...sample, position: [0, 0, distance], distance }], undefined, now);
    }
    lastTips = tips();
    for (let frame = 1; frame <= 20; frame++) {
      now += 20;
      renderer.update([{ ...sample, position: [0, 0, distance], distance, moving: 0, speed: 0, tiptoe: Math.min(1, frame / 10) }], undefined, now);
      for (const y of soles()) expect(y).toBeGreaterThanOrEqual(-1e-5);
      const currentTips = tips();
      for (let leg = 0; leg < 2; leg++) if (lastTips[leg]!.y < .001 && currentTips[leg]!.y < .001) {
        expect(currentTips[leg]!.distanceTo(lastTips[leg]!)).toBeLessThan(.008);
      }
      lastTips = currentTips;
    }
  } finally { renderer.dispose(); material.dispose(); }
});

it('keeps planted feet and swing continuity when a walker reverses or strafes abruptly', async () => {
  const scene = new THREE.Scene(), material = createVoxelMaterial(MATERIALS, 'avatar');
  const look = createStyledCitizenLook('test', PORTRAIT_FIXTURES[0]!.look);
  const renderer = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks: [look] });
  let timeMs = 0, x = 0, z = 0, distance = 0;
  const sample = () => ({ position: [x, 0, z] as const, heading: 0, distance, moving: 1, speed: 2, timeMs });
  const state = createFootstepState(sample());
  let previous = stepFootsteps(state, sample()), plantedFrames = 0;
  const feet = () => (['Left', 'Right'] as const).map(side => {
    const mesh = scene.getObjectByName(`Citizen test foot${side} solid`) as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4(); mesh.getMatrixAt(0, matrix);
    return new THREE.Vector3(side === 'Left' ? -.125 : .125, .0625, 0).applyMatrix4(matrix);
  });
  renderer.update([{ ...sample(), id: 'p', look: 'test' }], undefined, timeMs);
  let rendered = feet();
  try {
  for (let frame = 0; frame < 160; frame++) {
    timeMs += 16; distance += .032;
    if (frame < 50) z += .032;
    else if (frame < 100) z -= .032;
    else x += .032;
    const current = stepFootsteps(state, sample());
    renderer.update([{ ...sample(), id: 'p', look: 'test' }], undefined, timeMs);
    const nextRendered = feet();
    for (let leg = 0; leg < 2; leg++) {
      if (frame === 50 || frame === 100) {
        expect(current.feet[leg]!.distanceTo(previous.feet[leg]!), `frame ${frame}, leg ${leg}`).toBeLessThan(.055);
        expect(nextRendered[leg]!.distanceTo(rendered[leg]!), `rendered frame ${frame}, leg ${leg}`).toBeLessThan(.055);
      }
      if (current.stance[leg] && previous.stance[leg]) {
        expect(current.feet[leg]!.distanceTo(previous.feet[leg]!)).toBeLessThan(.004);
        if (frame > 15) expect(nextRendered[leg]!.distanceTo(rendered[leg]!)).toBeLessThan(.004);
        plantedFrames++;
      }
    }
    previous = current; rendered = nextRendered;
  }
  expect(plantedFrames).toBeGreaterThan(40);
  } finally { renderer.dispose(); material.dispose(); }
});
