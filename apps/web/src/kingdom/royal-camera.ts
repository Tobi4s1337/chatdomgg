import * as THREE from 'three';
import type { WindowHouse } from '@chatdom/render';

/** From the court approach: the whole castle crowns its rise, with the personal lancet below the beacon. */
export function composeRoyalCamera(keep: WindowHouse) {
  const point = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), keep.yaw).add(new THREE.Vector3(...keep.position));
  return { eye: point(-5, 14, 65), target: point(16, 14, 16), fov: 64 };
}
