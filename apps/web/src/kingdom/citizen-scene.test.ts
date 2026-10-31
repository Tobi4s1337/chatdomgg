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
