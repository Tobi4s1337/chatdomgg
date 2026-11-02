import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createRaidLayer, type RaidLayerHost } from './raid-view';

/** A real supplied road, rotated to catch assumptions about a world axis. */
function candidates(portrait: boolean) {
  const root = new THREE.Group();
  const host: RaidLayerHost = {
    kit: 'hearth', material: new THREE.MeshBasicMaterial(),
    mesh: () => { throw new Error('The camera must not mesh anything'); },
    place: () => ({ position: [10, 0, 20], facing: [1, 0, 0] }),
    route: () => ({ inbound: [[10, 0, 20], [10, 0, 60]], outbound: [[10, 0, 60], [10, 0, 100]] }),
  };
  const layer = createRaidLayer(root, host);
  const shots = [...layer.shots(portrait)];
  layer.dispose(); host.material.dispose();
  return shots;
}

describe('raid gate camera', () => {
  for (const [portrait, aspect] of [[false, 1920 / 1080], [true, 390 / 844]] as const) {
    it(`frames the gate and the column coming through it towards the town in ${portrait ? 'portrait' : 'landscape'}`, () => {
      const shots = candidates(portrait);
      expect(shots.length).toBeGreaterThan(3); // The host can reject obstructed candidates.
      const [eye, target, fov] = shots[0]!;
      // From the street inside the gate, looking back out through it.
      expect(eye.z).toBeGreaterThan(35);
      expect(target.z).toBeLessThan(20);
      // Fallbacks look in from outside the gate along the road.
      expect(shots.at(-1)![0].z).toBeLessThan(20);
      const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 500);
      camera.position.copy(eye); camera.lookAt(target); camera.updateMatrixWorld();
      const visible = (point: THREE.Vector3) => {
        const p = point.project(camera);
        expect(Math.abs(p.x)).toBeLessThan(0.95);
        expect(Math.abs(p.y)).toBeLessThan(0.95);
        expect(p.z).toBeGreaterThan(-1); expect(p.z).toBeLessThan(1);
      };
      // Gate crossbar and pole (8 m), plus both braziers at the road edges.
      for (const x of [11.4, 13.4]) for (const y of [0, 8]) visible(new THREE.Vector3(x, y, 20));
      for (const x of [8, 12]) visible(new THREE.Vector3(x, 1.8, 21.2));
      // Wagon envelope includes its pony and 5.5 m standard, from emergence to well inside the gate.
      for (const distance of [-3, 0, 4, 8]) for (const x of [9, 11]) for (const y of [0, 5.5]) {
        for (const z of [distance - 2.5, distance + 2.5]) visible(new THREE.Vector3(x, y, 20 + z));
      }
    });
  }
});
