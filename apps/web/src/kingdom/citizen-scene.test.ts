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
  const expected = first.motion.sample(now + 5_000);
  first.dispose();
  const restored = createKingdomCitizens(scene, layout, {} as VoxelWorkerPool, clay, false, checkpoint);
  restored.applyFrame({ ...frame, sequence: 2, asOf: now + 1_000 });
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
