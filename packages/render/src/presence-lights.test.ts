import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VOXEL_FIXTURE } from '@chatdom/shared/world-fixtures';
import { createWindowLights, windowLodCentre } from './presence-lights';

describe('window LOD placement', () => {
  it('rounds only the outward axis to the coarse cell boundary', () => {
    expect(windowLodCentre([5.5, 9, 7.5], 'south', 1)).toEqual([5.5, 9, 7.5]);
    expect(windowLodCentre([5.5, 9, 7.5], 'south', 4)).toEqual([5.5, 9, 8]);
    expect(windowLodCentre([5.5, 9, 7.5], 'north', 4)).toEqual([5.5, 9, 4]);
    expect(windowLodCentre([5.5, 9, 7.5], 'east', 2)).toEqual([6, 9, 7.5]);
    expect(windowLodCentre([5.5, 9, 7.5], 'west', 4)).toEqual([4, 9, 7.5]);
  });

  it('moves only visual planes, respects house yaw, and avoids redundant uploads', () => {
    const scene = new THREE.Scene();
    const blueprint = { ...VOXEL_FIXTURE, windows: [{ ...VOXEL_FIXTURE.windows[0]!, centre: [8, 14, 7] as [number, number, number] }] };
    const windows = createWindowLights(scene, [{ slot: 0, blueprint, position: [10, 0, 20], yaw: Math.PI / 2 }]);
    const [pane, halo] = scene.children as THREE.InstancedMesh[];
    const matrix = new THREE.Matrix4();
    const position = () => { pane!.getMatrixAt(0, matrix); return new THREE.Vector3().setFromMatrixPosition(matrix); };
    const original = position();
    const source = [...windows.getSources()[0]!.position];
    windows.setLod(0, 4);
    expect(position().x - original.x).toBeCloseTo(0.125);
    expect(position().z).toBeCloseTo(original.z);
    expect(windows.getSources()[0]!.position).toEqual(source);
    const paneVersion = pane!.instanceMatrix.version, haloVersion = halo!.instanceMatrix.version;
    windows.setLod(0, 4);
    expect(pane!.instanceMatrix.version).toBe(paneVersion);
    expect(halo!.instanceMatrix.version).toBe(haloVersion);
    windows.setLod(0, 1);
    expect(position().distanceTo(original)).toBeLessThan(1e-6);
    windows.dispose();
  });
});
