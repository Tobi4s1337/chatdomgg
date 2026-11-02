import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createEmptyPointSkipper } from './empty-points';

function pool(alphas: number[]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(alphas.length * 3), 3));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(alphas), 1));
  return new THREE.Points(geometry, new THREE.PointsMaterial());
}

describe('skipping empty particle pools', () => {
  it('hides an all-zero pool for the frame and shows it again when a point lights', () => {
    const scene = new THREE.Scene(), idle = pool([0, 0, 0]), live = pool([0, .4, 0]);
    scene.add(idle, live);
    const skipper = createEmptyPointSkipper(scene);
    expect(skipper.update(0)).toBe(1);
    expect(idle.visible).toBe(false);
    expect(live.visible).toBe(true);
    (idle.geometry.getAttribute('aAlpha').array as Float32Array)[2] = .1;
    expect(skipper.update(16)).toBe(0);
    expect(idle.visible).toBe(true);
  });

  it('never shows a pool its owner hid, and leaves other points alone', () => {
    const scene = new THREE.Scene(), owned = pool([0, 0]), plain = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
    owned.visible = false;
    scene.add(owned, plain);
    const skipper = createEmptyPointSkipper(scene);
    (owned.geometry.getAttribute('aAlpha').array as Float32Array)[0] = 1;
    skipper.update(0);
    expect(owned.visible).toBe(false);
    expect(plain.visible).toBe(true);
  });

  it('finds pools added later and restores everything it hid on dispose', () => {
    const scene = new THREE.Scene(), skipper = createEmptyPointSkipper(scene);
    skipper.update(0);
    const late = pool([0]);
    scene.add(late);
    skipper.update(100);
    expect(late.visible).toBe(true);
    skipper.update(2100);
    expect(late.visible).toBe(false);
    skipper.dispose();
    expect(late.visible).toBe(true);
  });
});
