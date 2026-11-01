import * as THREE from 'three';
import { expect, it } from 'vitest';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial } from '@chatdom/render';
import { KingdomIdSchema } from '@chatdom/shared';
import { generateSettlementPlan } from '@chatdom/world';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import { createKingdomCitizens } from './citizen-scene';

it('keeps the citizen name once when their home tag and speech are both visible', () => {
  const scene = new THREE.Scene(), clay = createVoxelMaterial(MATERIALS, 'build');
  const layout = generateSettlementPlan({ seed: 'speech-name', tier: 'hamlet', firstYear: 2025, year: 2026 });
  const citizens = createKingdomCitizens(scene, layout, {} as VoxelWorkerPool, clay);
  try {
    const kingdomId = KingdomIdSchema.parse('129634568'), slot = layout.homes[0]!.slot, now = 200_000;
    citizens.applyFrame({ version: 1, kingdomId, epoch: 'SIMULATED-name-test', sequence: 1, asOf: now,
      origin: 'simulated', streamLive: false, connection: 'offline',
      windows: [{ slot, present: true, publicName: 'SIMULATED Juniper', since: 0 }] });
    const person = citizens.update(now, 0)[0]!;
    const camera = new THREE.PerspectiveCamera(60, 1, .1, 100);
    camera.position.set(person.position[0], person.position[1] + 2, person.position[2] + 6);
    camera.lookAt(person.position[0], person.position[1] + 1.9, person.position[2]); camera.updateMatrixWorld();
    const parts = [{ kind: 'text' as const, text: 'Home, at last!' }];
    expect(citizens.receiveChat({ version: 1, id: 'SIMULATED-line', kingdomId, epoch: 'SIMULATED-name-test',
      origin: 'simulated', slot, asOf: now, expiresAt: now + 10_000, parts })).toBe(true);
    expect(citizens.speechLabels(camera, 900, 900, now)[0]?.name).toBe('SIMULATED Juniper');
    expect(citizens.speechLabels(camera, 900, 900, now, new Set([slot]))[0]).toMatchObject({ name: null, parts });
    expect(citizens.speechLabels(camera, 900, 900, now, new Set())[0]?.name).toBe('SIMULATED Juniper');
  } finally { citizens.dispose(); clay.dispose(); }
});

it('continues forge walks across a scene rebuild only under the current presence authority', () => {
  const scene = new THREE.Scene(), clay = createVoxelMaterial(MATERIALS, 'build');
  const layout = generateSettlementPlan({ seed: 'forge-checkpoint', tier: 'hamlet', firstYear: 2025, year: 2026 });
  const kingdomId = KingdomIdSchema.parse('129634568'), slot = layout.homes[0]!.slot, now = 200_000;
  const frame = { version: 1 as const, kingdomId, epoch: 'SIMULATED-checkpoint', sequence: 1, asOf: now,
    origin: 'simulated' as const, streamLive: true, connection: 'fresh' as const,
    windows: [{ slot, present: true, publicName: 'SIMULATED Juniper', since: 0 }] };
  const first = createKingdomCitizens(scene, layout, {} as VoxelWorkerPool, clay);
  first.applyFrame(frame);
  first.watchForge(true, now, [0, 9, 8]);
  first.update(now, 0);
  const checkpoint = first.checkpoint()!;
  expect(checkpoint.watchers.size).toBe(1);
  const expected = first.motion.sample(now + 5_000);
  // The candidate warms independently before the visible renderer releases its motion.
  const restored = createKingdomCitizens(scene, layout, {} as VoxelWorkerPool, clay);
  restored.applyFrame({ ...frame, sequence: 2, asOf: now + 1_000 });
  first.dispose();
  restored.restoreCheckpoint(checkpoint);
  restored.watchForge(false, now + 1_000, [0, 9, 8]);
  restored.update(now + 1_000, 0);
  expect(restored.checkpoint()!.watchers).toEqual(checkpoint.watchers);
  restored.watchForge(true, now + 1_100, [0, 9, 8]);
  restored.update(now + 1_100, 0);
  expect(restored.motion.sample(now + 5_000)).toEqual(expected);
  restored.dispose();
  const beforeAbsence = createKingdomCitizens(scene, layout, {} as VoxelWorkerPool, clay);
  beforeAbsence.applyFrame(frame);
  const absentCheckpoint = beforeAbsence.checkpoint()!;
  beforeAbsence.dispose();
  const absent = createKingdomCitizens(scene, layout, {} as VoxelWorkerPool, clay, false, absentCheckpoint);
  absent.applyFrame({ ...frame, sequence: 2, asOf: now + 1_000, streamLive: false, connection: 'offline', windows: [{ ...frame.windows[0]!, present: false, publicName: null }] });
  expect(absent.motion.sample(now + 5_000)).toEqual([]);
  absent.dispose(); clay.dispose();
});

it('walks the existing rehearsal neighbours around both sides of the anvil, including the installed barrel', () => {
  // Same graph/config as the hash-verified adopted rehearsal; no cached file or
  // invented square residents. The nearest doors begin tens of metres away.
  const layout = generateSettlementPlan({ seed: 'willowmere', tier: 'town', firstYear: 2022, year: 2026 });
  const scene = new THREE.Scene(), clay = createVoxelMaterial(MATERIALS, 'build');
  const barrel = { position: [-8, 9, 1.125] as const, height: 11 / 8 };
  let citizens = createKingdomCitizens(scene, layout, {} as VoxelWorkerPool, clay, false, undefined, barrel);
  const now = 1_000_000, kingdomId = KingdomIdSchema.parse('129634568');
  const nodes = new Map(layout.nodes.map(node => [node.id, node.position]));
  const distance = (plot: typeof layout.homes[number]) => { const door = nodes.get(`${plot.id}:front`) ?? plot.position; return Math.hypot(door[0], door[2] - 10); };
  const homes = layout.homes.filter(home => home.slot !== 2).sort((a, b) => distance(a) - distance(b)).slice(0, 70);
  let frame = { version: 1 as const, kingdomId, epoch: 'SIMULATED-rehearsal', sequence: 1, asOf: now,
    origin: 'simulated' as const, streamLive: false, connection: 'offline' as const,
    windows: homes.map(home => ({ slot: home.slot, present: true, publicName: 'SIMULATED neighbour', since: now - 600_000 })) };
  citizens.applyFrame(frame);
  const arrivedCounts: number[] = [];
  try {
    for (const ms of [0, 2_000, 13_000, 31_000, 38_000, 62_000, 64_000, 72_000, 124_000, 125_000, 132_000]) {
      if (ms === 2_000) {
        frame = { ...frame, sequence: 2, asOf: now + ms, windows: [...frame.windows,
          { slot: 2, present: true, publicName: 'SIMULATED maker', since: now + ms }] };
        citizens.applyFrame(frame);
      }
      if (ms === 124_000) {
        const checkpoint = citizens.checkpoint()!;
        citizens.dispose();
        citizens = createKingdomCitizens(scene, layout, {} as VoxelWorkerPool, clay, false, checkpoint, barrel);
        citizens.applyFrame(frame);
        citizens.watchForge(false, now + ms, [0, 9, 8]);
        citizens.update(now + ms, ms / 1000);
      }
      citizens.watchForge(ms >= 38_000, now + ms, [0, 9, 8]);
      const samples = citizens.update(now + ms, ms / 1000), watchers = citizens.checkpoint()!.watchers;
      const arrived = samples.filter(sample => watchers.get(sample.slot) === sample.goalNodeId && sample.goalReached);
      if ([38_000, 62_000, 64_000, 72_000, 132_000].includes(ms)) arrivedCounts.push(arrived.length);
      for (const sample of arrived) {
        expect(frame.windows.some(window => window.slot === sample.slot && window.present)).toBe(true);
        expect(sample.homeLit).toBe(true);
        expect(sample.heading).toBeCloseTo(Math.atan2(-sample.position[0], 8 - sample.position[2]), 9);
        expect(sample.speed).toBe(0);
      }
      if (ms === 38_000) {
        expect(watchers.size).toBe(32);
        expect(new Set(watchers.values()).size).toBe(32);
        expect(samples.filter(sample => watchers.has(sample.slot)).every(sample => !sample.goalReached && sample.position[1] < 10)).toBe(true);
      }
      if (ms === 132_000) {
        expect(arrived.length).toBeGreaterThanOrEqual(20);
        expect(arrived.length).toBeLessThanOrEqual(32);
        for(let index=0;index<arrived.length;index++)for(const other of arrived.slice(index+1)){
          const person=arrived[index]!;
          expect(Math.hypot(person.position[0]-other.position[0],person.position[2]-other.position[2])).toBeGreaterThanOrEqual(1);
        }
        const side = (sample: typeof arrived[number]) => sample.position[0] * 12 - (sample.position[2] - 8) * 4.8;
        expect(arrived.some(sample => side(sample) > 26)).toBe(true);
        expect(arrived.some(sample => side(sample) < -26)).toBe(true);
        const raised = arrived.find(sample => sample.goalNodeId === 'forge:watch:14')!;
        expect(raised.position).toEqual([-8, 9 + barrel.height, 1.125]);
        expect(citizens.subject(raised.slot)?.position).toEqual(raised.position);
        const ground = citizens.motion.sample(now + ms).find(sample => sample.slot === raised.slot)!;
        expect(ground.position[1]).toBe(9);
        expect(raised.distance).toBe(ground.distance);
      }
    }
    // The old 72s still was necessarily early: accepted goals were not arrivals.
    expect(arrivedCounts.slice(0,3)).toEqual([0,0,0]);
    expect(arrivedCounts[3]).toBeGreaterThan(0);
    expect(arrivedCounts[4]).toBeGreaterThanOrEqual(20);
  } finally { citizens.dispose(); clay.dispose(); }
});
