import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MATERIALS } from '@chatdom/content';
import { generateSettlementPlan } from '@chatdom/world';
import type { KingdomId } from '@chatdom/shared';
import type { VoxelRenderState } from '@chatdom/render';
import type { VoxelWorkerPool } from '@chatdom/voxel';
import { createKingdomMoments } from './index';
import type { DockAct } from '../dock-acts';

it('renders the authoritative welcome through the existing raid banner and caravan layer', async () => {
  const scene = new THREE.Scene(), abort = new AbortController(), kingdomId = '129634568' as KingdomId;
  const camera = new THREE.PerspectiveCamera(50, 1440 / 900, .1, 1000);
  camera.position.set(0, 30, 60); camera.lookAt(0, 8, 0); camera.updateMatrixWorld();
  const moments = createKingdomMoments({ scene, camera, canvas: { clientWidth: 1440, clientHeight: 900 } as HTMLCanvasElement,
    target: new THREE.Vector3(), plan: generateSettlementPlan({ seed: 'welcome-layer', tier: 'hamlet', firstYear: 2025, year: 2026 }), houses: [],
    pool: { submit: async () => ({ kind: 'asset', chunks: [] }) } as unknown as VoxelWorkerPool,
    material: { material: new THREE.ShaderMaterial() } as VoxelRenderState, registry: MATERIALS, kingdomId,
    kit: 'hearth', sound: null, signal: abort.signal, feed: { origin: 'simulated', subscribe: () => () => {} } });
  try {
    await moments.ready;
    const now = Date.now(); moments.update(now, undefined, true);
    const act: DockAct = { version: 1, id: 'SIMULATED-welcome', actionId: 'SIMULATED-press', kingdomId, origin: 'simulated', kind: 'raid-welcome',
      occurredAt: now, expiresAt: now + 60_000, gate: 'open', fire: 'unlit', targetId: 'SIMULATED-raid', targetName: 'SIMULATED Mossbrook',
      raid: { raidKey: 'SIMULATED-raid', from: { kingdomId: '42' as KingdomId, displayName: 'SIMULATED Mossbrook', crestKey: null }, viewers: 9, founded: false } };
    expect(moments.welcomeRaid({ ...act, targetId: 'wrong-raid' }, 0)).toBe(false);
    expect(moments.welcomeRaid(act, 0)).toBe(true);
    expect(moments.welcomeRaid(act, 6500)).toBe(true);
    expect(moments.metrics().view).toMatchObject({ 'raid.gate': 1, 'raid.caravans': 1 });
    expect(Number(moments.metrics().view['raid.wagons'])).toBeGreaterThan(0);
    expect(Number(moments.metrics().view['raid.instances'])).toBeGreaterThan(0);
  } finally { abort.abort(); }
});

it.each(['complete', 'abort', 'error'] as const)('keeps optional preparation behind four workers and handles %s without leaking the feed or scene', async outcome => {
  const scene = new THREE.Scene(), abort = new AbortController(), disconnect = vi.fn();
  let release!: () => void;
  const worker = new Promise<void>(resolve => { release = resolve; });
  const submit = vi.fn(async () => {
    await worker;
    if (outcome === 'error') throw new Error('Worker meshing failed');
    return { kind: 'asset' as const, chunks: [] };
  });
  const moments = createKingdomMoments({
    scene, camera: new THREE.PerspectiveCamera(), canvas: { clientWidth: 1440, clientHeight: 900 } as HTMLCanvasElement,
    target: new THREE.Vector3(), plan: generateSettlementPlan({ seed: 'moment-loading', tier: 'hamlet', firstYear: 2025, year: 2026 }), houses: [],
    pool: { submit } as unknown as VoxelWorkerPool, material: { material: new THREE.ShaderMaterial() } as VoxelRenderState,
    registry: MATERIALS, kingdomId: '129634568' as KingdomId, kit: 'hearth', sound: null, signal: abort.signal,
    feed: { origin: 'live', subscribe: () => disconnect },
  });
  await Promise.resolve();
  expect(submit).toHaveBeenCalledTimes(4);
  expect(moments.metrics().preparation).toBe('loading');
  expect(moments.update(Date.now(), undefined, true)).toBe(false);
  expect(moments.captions()).toEqual([]);
  if (outcome === 'abort') abort.abort();
  release();
  if (outcome === 'complete') {
    await moments.ready;
    expect(moments.metrics().preparation).toBe('ready');
    expect(submit.mock.calls.length).toBeGreaterThan(4);
  } else {
    await expect(moments.ready).rejects.toThrow(outcome === 'abort' ? 'Moments closed while preparing' : 'Worker meshing failed');
    expect(moments.metrics()).toMatchObject({ preparation: outcome === 'abort' ? 'disposed' : 'failed', preparationError: outcome === 'abort' ? null : 'Worker meshing failed' });
    // A rejected lane can release its next job before Promise.all observes that rejection. Disposal must
    // stop the queue after that one bounded wave rather than submitting the remaining future spectacles.
    const submitted = submit.mock.calls.length;
    expect(submitted).toBeLessThanOrEqual(outcome === 'abort' ? 4 : 8);
    await Promise.resolve();
    expect(submit).toHaveBeenCalledTimes(submitted);
  }
  abort.abort();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(scene.children).toHaveLength(0);
  expect(moments.update(Date.now(), undefined, true)).toBe(false);
});
