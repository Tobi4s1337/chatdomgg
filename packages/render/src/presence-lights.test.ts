import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VOXEL_FIXTURE } from '@chatdom/shared/world-fixtures';
import { createWindowLights, windowLodCentre } from './presence-lights';

describe('window LOD placement', () => {
  it('renders one designated presence window per home, with an inspection opt-in for all anchors', () => {
    const blueprint = { ...VOXEL_FIXTURE, windows: [0, 1, 2].map(i => ({ ...VOXEL_FIXTURE.windows[0]!, id: `window-${i}` })) };
    const house = { slot: 0, blueprint, position: [0, 0, 0] as [number, number, number], yaw: 0 };
    const production = createWindowLights(new THREE.Scene(), [house]);
    const inspection = createWindowLights(new THREE.Scene(), [house], { allWindows: true });
    expect(production.getSources()).toHaveLength(1);
    expect(inspection.getSources()).toHaveLength(3);
    production.dispose(); inspection.dispose();
  });
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

  it.each([0, Math.PI / 2])('keeps complementary outgoing and incoming planes through refinement and coarsening at yaw %s', yaw => {
    const scene = new THREE.Scene();
    const blueprint = { ...VOXEL_FIXTURE, windows: [{ ...VOXEL_FIXTURE.windows[0]!, centre: [8, 14, 7] as [number, number, number] }] };
    const windows = createWindowLights(scene, [{ slot: 0, blueprint, position: [10, 0, 20], yaw }]);
    const [pane, halo] = scene.children as THREE.InstancedMesh[];
    const matrix = new THREE.Matrix4();
    const position = (mesh: THREE.InstancedMesh, index: number) => { mesh.getMatrixAt(index, matrix); return new THREE.Vector3().setFromMatrixPosition(matrix); };
    const source = [...windows.getSources()[0]!.position];
    for (const [from, to, displacement] of [[4, 1, -0.125], [1, 4, 0.125]] as const) {
      windows.setDetail(0, from, to, 0.4);
      const outgoing = position(pane!, 0), incoming = position(pane!, 1);
      expect(incoming.x - outgoing.x).toBeCloseTo(displacement * Math.sin(yaw));
      expect(incoming.z - outgoing.z).toBeCloseTo(displacement * Math.cos(yaw));
      for (const mesh of [pane!, halo!]) {
        const fades = mesh.geometry.getAttribute('detailFade');
        expect(fades.getX(0)).toBeCloseTo(-1.4);
        expect(fades.getX(1)).toBeCloseTo(0.4);
      }
      const version = pane!.instanceMatrix.version;
      windows.setDetail(0, from, to, 0.7);
      expect(pane!.instanceMatrix.version).toBe(version);
      expect(windows.getSources()[0]!.position).toEqual(source);
    }
    windows.dispose();
  });
});
