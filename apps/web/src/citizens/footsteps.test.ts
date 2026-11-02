import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content/materials';
import { PORTRAIT_FIXTURES } from '@chatdom/content/avatar-style';
import { createVoxelMaterial } from '@chatdom/render';
import { createCitizenRenderer, createStyledCitizenLook, type CitizenSample } from './index';
import { createFootstepState, FOOT_SOLE, stepFootsteps, type FootstepSample } from './footsteps';

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
      for (const y of soles()) expect(y).toBeGreaterThanOrEqual(-1e-4);
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
      for (const y of soles()) expect(y).toBeGreaterThanOrEqual(-1e-4);
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

type Ground = (x: number, z: number) => number;
/** The modelled sole of a level foot whose ankle is at `ankle`: its four corners, at the sole's height. */
function soleCorners(ankle: THREE.Vector3, heading: number): THREE.Vector3[] {
  const f = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading)), l = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
  const corners: THREE.Vector3[] = [];
  for (const along of [-FOOT_SOLE.heel, FOOT_SOLE.toe]) for (const across of [-FOOT_SOLE.half, FOOT_SOLE.half]) {
    corners.push(ankle.clone().addScaledVector(f, along).addScaledVector(l, across).setY(ankle.y - .0625));
  }
  return corners;
}
/** Walk a body drawn on `ground` along a heading, stop, and return the lowest sole clearance seen. */
function lowestSole(ground: Ground, options: { speed: number; fps: number; heading: number; sampled: boolean; learn?: number }) {
  const { speed, fps, heading, sampled } = options, dt = 1 / fps;
  let x = .3, z = -.2, distance = 0, now = 0, lowest = Infinity;
  const at = (moving: number): FootstepSample => ({ position: [x, ground(x, z), z], heading, distance, moving, speed: moving ? speed : 0, timeMs: now,
    ...(sampled ? { ground } : {}) });
  const state = createFootstepState(at(0));
  const check = (result: ReturnType<typeof stepFootsteps>, sample: FootstepSample) => {
    for (const foot of result.feet) for (const corner of soleCorners(foot, heading)) lowest = Math.min(lowest, corner.y - ground(corner.x, corner.z));
    // The rig's standing branch draws level neutral soles raised by `lift` while the planted targets fade out.
    if (result.blend < 1) for (const side of [-1, 1]) {
      const px = sample.position[0] + Math.cos(heading) * side * .125, pz = sample.position[2] - Math.sin(heading) * side * .125;
      for (const corner of soleCorners(new THREE.Vector3(px, sample.position[1] + .0625 + result.lift, pz), heading)) {
        lowest = Math.min(lowest, corner.y - ground(corner.x, corner.z));
      }
    }
  };
  for (let frame = 0; frame < fps * 4; frame++) {
    now += dt * 1000;
    const moving = frame < fps * 3 ? 1 : 0;
    if (moving) { x += Math.sin(heading) * speed * dt; z += Math.cos(heading) * speed * dt; distance += speed * dt; }
    const sample = at(moving), result = stepFootsteps(state, sample);
    if (frame >= (options.learn ?? 0) * fps) check(result, sample);
  }
  return lowest;
}

const SPEEDS = [.6, 1.2, 2.5, 4, 7], RATES = [60, 30, 20];
const GROUNDS: [string, Ground][] = [
  ['flat street', () => 9],
  ['uphill', (_x, z) => .3 * z],
  ['downhill', (_x, z) => -.3 * z],
  ['across a slope', x => .3 * x],
  ['a diagonal slope', (x, z) => .35 * (x + z)],
  ['rolling terrain', (x, z) => .4 * Math.sin(x / 3) + .3 * Math.sin(z / 4) + .2 * Math.sin((x + z) / 5)],
];

describe('soles stay on the drawn ground', () => {
  it.each(GROUNDS)('with the drawn ground sampled, on %s, at every speed and frame rate, walking, stopping and standing', (_name, ground) => {
    for (const speed of SPEEDS) for (const fps of RATES) for (const heading of [0, 1.1, -2.4]) {
      expect(lowestSole(ground, { speed, fps, heading, sampled: true }), `${speed} m/s, ${fps} fps, heading ${heading}`).toBeGreaterThanOrEqual(-1e-4);
    }
  });

  it.each(GROUNDS.slice(0, 3))('with no sampler the slope along travel is learned from the body, on %s', (_name, ground) => {
    for (const speed of SPEEDS) for (const fps of RATES) {
      expect(lowestSole(ground, { speed, fps, heading: 0, sampled: false, learn: .5 }), `${speed} m/s, ${fps} fps`).toBeGreaterThanOrEqual(-1e-4);
    }
  });

  it('follows a slope without rebasing, but still rebases a half-metre step', () => {
    const ground: Ground = (_x, z) => .3 * z;
    let z = 0, now = 0, rebases = 0;
    const state = createFootstepState({ position: [0, 0, 0], heading: 0, distance: 0, moving: 1, speed: 7, timeMs: 0 });
    for (let frame = 1; frame <= 60; frame++) {
      now += 1000 / 30; z += 7 / 30;
      const result = stepFootsteps(state, { position: [0, ground(0, z), z], heading: 0, distance: z, moving: 1, speed: 7, timeMs: now });
      if (frame > 10 && result.blend === 0) rebases++;
    }
    expect(rebases).toBe(0);
    expect(state.gradient.y).toBeCloseTo(.3, 3);
    now += 1000 / 30; z += 7 / 30;
    const stepped = stepFootsteps(state, { position: [0, ground(0, z) + .5, z], heading: 0, distance: z, moving: 1, speed: 7, timeMs: now });
    expect(stepped.blend).toBe(0);
    expect(state.gradient.lengthSq()).toBe(0);
  });

  it('starts rested on the sampled slope and needs no lift on flat ground', () => {
    const slope: Ground = (x, z) => .2 * x - .1 * z;
    const sample: FootstepSample = { position: [1, slope(1, 2), 2], heading: .4, distance: 0, moving: 0, speed: 0, timeMs: 0, ground: slope };
    const state = createFootstepState(sample);
    expect(state.gradient.x).toBeCloseTo(.2, 9); expect(state.gradient.y).toBeCloseTo(-.1, 9);
    for (const leg of state.legs) for (const corner of soleCorners(leg.contact, .4)) expect(corner.y - slope(corner.x, corner.z)).toBeGreaterThanOrEqual(-1e-9);
    const flat = stepFootsteps(createFootstepState({ ...sample, position: [1, 9, 2], ground: () => 9 }), { ...sample, position: [1, 9, 2], ground: () => 9, timeMs: 16 });
    expect(flat.lift).toBe(0);
    expect(stepFootsteps(state, { ...sample, timeMs: 16 }).lift).toBeGreaterThan(0);
  });

  // Stairs of solid treads along +z, and the body height the movement law gives on them: the highest tread under its
  // ±0.28 m footprint. Remote walkers are drawn between snapshots 0.2 s apart, so their height ramps between treads.
  const STAIRS = [[.25, .5], [.125, .25], [.5, 1], [.25, 1.5]] as const;
  function lowestOnStairs(rise: number, run: number, options: { speed: number; fps: number; direction: 1 | -1; lagged: boolean; floored: boolean }) {
    const { speed, fps, direction } = options, dt = 1 / fps;
    const tread = (z: number) => Math.floor(z / run) * rise * direction;
    const body = (z: number) => Math.max(tread(z - .28 + 1e-9), tread(z + .28 - 1e-9), tread(z));
    const floor = (_x: number, z: number, below: number) => tread(z) <= below ? tread(z) : null;
    let z = .1, now = 0, lowest = Infinity;
    const span = speed * .2, datum = (at: number) => {
      if (!options.lagged) return body(at);
      const from = .1 + Math.floor((at - .1) / span) * span;
      return THREE.MathUtils.lerp(body(from), body(from + span), (at - from) / span);
    };
    const at = (moving: number): FootstepSample => ({ position: [0, datum(z), z], heading: 0, distance: z, moving, speed: moving ? speed : 0, timeMs: now,
      ...(options.floored ? { floor } : {}) });
    const state = createFootstepState(at(0));
    for (let frame = 0; frame < fps * 4; frame++) {
      now += dt * 1000;
      const moving = frame < fps * 3 ? 1 : 0;
      if (moving) z += speed * dt;
      const sample = at(moving), result = stepFootsteps(state, sample);
      const feet = [...result.feet];
      if (result.blend < 1) for (const side of [-1, 1]) feet.push(new THREE.Vector3(side * .125, sample.position[1] + .0625 + result.lift, z));
      for (const foot of feet) for (const corner of soleCorners(foot, 0)) lowest = Math.min(lowest, corner.y - tread(corner.z));
    }
    return lowest;
  }

  it.each(STAIRS)('never sets a sole into a tread, up or down stairs of rise %s and run %s, with the solid floor given', (rise, run) => {
    for (const speed of SPEEDS) for (const fps of RATES) for (const direction of [1, -1] as const) for (const lagged of [false, true]) {
      expect(lowestOnStairs(rise, run, { speed, fps, direction, lagged, floored: true }), `${speed} m/s, ${fps} fps, ${direction > 0 ? 'up' : 'down'}${lagged ? ', interpolated' : ''}`)
        .toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('without the solid floor a step up stairs plants its sole into the next tread', () => {
    // The datum alone cannot know a tread ahead of the body footprint: this is why the walk passes `floor`.
    expect(lowestOnStairs(.125, .25, { speed: 1.2, fps: 60, direction: 1, lagged: false, floored: false })).toBeLessThan(-.05);
  });

  it('ignores solid tops out of a step’s reach and keeps level floors exact', () => {
    const base: FootstepSample = { position: [0, 2, 0], heading: 0, distance: 0, moving: 0, speed: 0, timeMs: 0 };
    const wall = createFootstepState({ ...base, floor: (_x, _z, below) => (3 <= below ? 3 : null) });
    for (const leg of wall.legs) expect(leg.contact.y).toBeCloseTo(2.0625, 12);
    const level = createFootstepState({ ...base, floor: () => 2 });
    for (const leg of level.legs) expect(leg.contact.y).toBeCloseTo(2.0625, 12);
    const above = createFootstepState({ ...base, floor: () => 2.5 });
    for (const leg of above.legs) expect(leg.contact.y).toBeCloseTo(2.5625, 12);
    expect(stepFootsteps(level, { ...base, timeMs: 16, floor: () => 2 }).lift).toBe(0);
  });

  it('ignores a sampler that is not answering for these feet', () => {
    const sample: FootstepSample = { position: [0, 4, 0], heading: 0, distance: 0, moving: 0, speed: 0, timeMs: 0, ground: () => 1 };
    expect(createFootstepState(sample).gradient.lengthSq()).toBe(0);
    expect(createFootstepState({ ...sample, ground: () => null }).gradient.lengthSq()).toBe(0);
  });
});

it.each([[1.2, 60], [4, 60], [7, 30], [2.5, 20]])('keeps every rendered sole corner on an up and down slope at %s m/s and %s fps once the slope is learned', async (speed, fps) => {
  const scene = new THREE.Scene(), material = createVoxelMaterial(MATERIALS, 'avatar');
  const look = createStyledCitizenLook('test', PORTRAIT_FIXTURES[0]!.look);
  const renderer = await createCitizenRenderer(scene, { registry: MATERIALS, material, looks: [look] });
  const sole = (side: 'Left' | 'Right') => {
    const mesh = scene.getObjectByName(`Citizen test foot${side} solid`) as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4(); mesh.getMatrixAt(0, matrix);
    const box = mesh.geometry.boundingBox!, corners: THREE.Vector3[] = [];
    for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, box.min.y, z).applyMatrix4(matrix));
    return corners;
  };
  try {
    for (const rise of [.3, -.3]) {
      let z = 0, now = 0, lowest = Infinity;
      renderer.update([], undefined, now);
      for (let frame = 0; frame < fps * 3; frame++) {
        now += 1000 / fps; z += speed / fps;
        renderer.update([{ id: 'p', look: 'test', position: [0, rise * z, z], heading: 0, distance: z, moving: 1, speed }], undefined, now);
        if (frame < fps / 2) continue;
        for (const corner of [...sole('Left'), ...sole('Right')]) lowest = Math.min(lowest, corner.y - rise * corner.z);
      }
      expect(lowest, `rise ${rise}`).toBeGreaterThanOrEqual(-1e-4);
    }
  } finally { renderer.dispose(); material.dispose(); }
});
