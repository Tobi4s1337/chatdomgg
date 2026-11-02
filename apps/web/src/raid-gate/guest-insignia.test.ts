import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { executeVoxelJob, type VoxelWorkerPool } from '@chatdom/voxel';
import { parseRaidGuestVisualMark } from '@chatdom/shared';
import { createGuestInsigniaLayer, guestInsigniaRuns } from './guest-insignia';

const now = 1_700_000_000_000;
const mark = { raidId: `raid.${'a'.repeat(64)}`, fromKingdomId: '12826', fromName: 'MashaD4', expiresAt: now + 1000 };
const pose = { id: 'guest', position: [0, 0, 0] as const, heading: 0, raidGuest: mark };
const worker = { submit: async (job: Parameters<typeof executeVoxelJob>[0]) => executeVoxelJob({ ...job, id: 1 }) } as unknown as VoxelWorkerPool;

describe('raid guest insignia', () => {
  it('uses the source arms and keeps a distinct source distinct', () => {
    const a = parseRaidGuestVisualMark(mark, now)!;
    const b = parseRaidGuestVisualMark({ ...mark, fromKingdomId: '129634568' }, now)!;
    expect(guestInsigniaRuns(a)).toBeTruthy();
    expect(guestInsigniaRuns(a)).toBe(guestInsigniaRuns(a));
    expect(guestInsigniaRuns(a)).not.toEqual(guestInsigniaRuns(b));
  });
  it('draws only actual valid poses and clears on leave and expiry', async () => {
    const scene = new THREE.Scene(), material = new THREE.MeshBasicMaterial();
    let time = now;
    const layer = await createGuestInsigniaLayer(scene, material, worker, () => time);
    layer.update([pose, { ...pose, id: 'host', raidGuest: undefined }]);
    expect(layer.count).toBe(1);
    layer.update([]); expect(layer.count).toBe(0);
    layer.update([pose]); expect(layer.count).toBe(1);
    time += 1000; layer.update([pose]); expect(layer.count).toBe(0);
    layer.dispose(); expect(scene.children).toHaveLength(0); material.dispose();
  });
  it('bounds duplicate or excess poses', async () => {
    const scene = new THREE.Scene(), material = new THREE.MeshBasicMaterial();
    const layer = await createGuestInsigniaLayer(scene, material, worker, () => now);
    layer.update(Array.from({ length: 310 }, (_, i) => ({ ...pose, id: String(i) })));
    expect(layer.count).toBe(300);
    layer.update([pose, pose]); expect(layer.count).toBe(1);
    layer.dispose(); material.dispose();
  });
});
