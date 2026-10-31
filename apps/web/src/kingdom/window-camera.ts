import * as THREE from 'three';
import type { WindowHouse } from '@chatdom/render';
import type { Vec3 } from '@chatdom/shared';

/** Frame the actual roof, doorstep and person together, rather than enlarging one pane into a wall crop. */
export function composeWindowCamera(home: WindowHouse, doorstep: Vec3, aspect: number, facing: number) {
  const points: THREE.Vector3[] = [], axis = new THREE.Vector3(0, 1, 0);
  const size = home.blueprint.size.map(value => value * .125);
  for (const x of [0, size[0]!]) for (const y of [0, size[1]!]) for (const z of [0, size[2]!]) {
    points.push(new THREE.Vector3(x, y, z).applyAxisAngle(axis, home.yaw).add(new THREE.Vector3(...home.position)));
  }
  points.push(new THREE.Vector3(...doorstep), new THREE.Vector3(...doorstep).add(new THREE.Vector3(0, 2.4, 0)));
  const target = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
  const outward = new THREE.Vector3(Math.sin(facing), .12, Math.cos(facing));
  outward.add(new THREE.Vector3(Math.cos(facing), 0, -Math.sin(facing)).multiplyScalar(.2)).normalize();
  const right = new THREE.Vector3().crossVectors(axis, outward).normalize();
  const up = new THREE.Vector3().crossVectors(outward, right).normalize();
  const fov = 64, vertical = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * .82;
  const horizontal = vertical * Math.max(.1, aspect);
  let distance = 5;
  for (const point of points) {
    const delta = point.clone().sub(target);
    distance = Math.max(distance, delta.dot(outward) + Math.max(Math.abs(delta.dot(right)) / horizontal, Math.abs(delta.dot(up)) / vertical));
  }
  return { eye: target.clone().addScaledVector(outward, distance), target, fov };
}
