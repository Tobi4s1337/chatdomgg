import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { KingdomIdSchema, type KingdomPresenceFrame } from '@chatdom/shared';
import { createHomeLife } from './index';

describe('home life', () => {
  it('warms on arrival and clears immediately when presence becomes stale', () => {
    const scene = new THREE.Scene();
    const life = createHomeLife(scene, [{ slot: 7, mouths: [[0, 1, 0]], lantern: [0, 0, 0], normal: [0, 0, 1] }]);
    const camera = new THREE.PerspectiveCamera(60, 1, .1, 100); camera.position.set(0, 2, 8); camera.lookAt(0, 1, 0); camera.updateMatrixWorld();
    const frame: KingdomPresenceFrame = { version: 1, kingdomId: KingdomIdSchema.parse('123'), epoch: 'test', sequence: 1, asOf: 1000, origin: 'simulated', streamLive: true, connection: 'fresh', windows: [{ slot: 7, present: true, publicName: 'Citizen', since: 1000 }] };
    life.update(1000, 1, undefined, 20, camera);
    expect(life.sources()[0]!.strength).toBe(0);
    life.update(1350, 1.35, frame, 20, camera);
    expect(life.sources()[0]!.strength).toBeCloseTo(.25);
    life.update(1700, 1.7, frame, 20, camera);
    expect(life.sources()[0]!.strength).toBeCloseTo(.5);
    const smoke = scene.children.find(child => child instanceof THREE.Mesh && child.geometry instanceof THREE.InstancedBufferGeometry) as THREE.Mesh<THREE.InstancedBufferGeometry>;
    expect(smoke.geometry.instanceCount).toBeGreaterThan(0);
    life.update(1800, 1.8, { ...frame, streamLive: false, connection: 'stale', windows: [] }, 20, camera);
    expect(life.sources()[0]!.strength).toBe(0);
    expect(smoke.geometry.instanceCount).toBe(0);
    life.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
