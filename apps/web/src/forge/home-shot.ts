import * as THREE from 'three';

/** Follow the gift over the neighbourhood, then introduce its home on the final approach. */
export function forgeFlightShot(home: THREE.Box3, piece: THREE.Box3, pieceWorld: THREE.Matrix4,
  position: THREE.Vector3, yaw: number, width: number, height: number, progress: number) {
  const toHome = new THREE.Matrix4().makeRotationY(yaw).setPosition(position).invert().multiply(pieceWorld);
  const flying = piece.clone().applyMatrix4(toHome);
  const receive = forgeHomeShot(home, flying, position, yaw, width, height, 0);
  const centre = piece.getCenter(new THREE.Vector3()).applyMatrix4(pieceWorld);
  const size = piece.getSize(new THREE.Vector3());
  const distance = Math.max(27, size.length() * 2.5 * Math.max(1, height / Math.max(1, width)));
  const target = centre.add(new THREE.Vector3(0, -2, 0));
  // Retain the above-anvil launch view; look up only once the gift has gained height.
  const elevation = THREE.MathUtils.lerp(.32, .03, THREE.MathUtils.smootherstep(progress, 0, .2));
  const offset = new THREE.Vector3(-.3, elevation, 1).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiplyScalar(distance);
  // The receiving home is too distant to share a tight frame at launch. Hold the gift until it is near.
  const approach = THREE.MathUtils.smootherstep(progress, .65, .95);
  return { target: target.lerp(receive.target, approach), offset: offset.lerp(receive.offset, approach) };
}

/** The receiving home stays in the story even when the new roof ornament gets its close-up. */
export function forgeHomeShot(home: THREE.Box3, roof: THREE.Box3, position: THREE.Vector3, yaw: number,
  width: number, height: number, age: number) {
  const whole = home.clone().union(roof);
  const portrait = roof.clone().expandByVector(new THREE.Vector3(1.7, 1.05, 1.35));
  // Keep the facade and doorway beneath the gift, rather than an anonymous fragment of roof.
  portrait.min.y = Math.min(portrait.min.y, home.min.y + home.getSize(new THREE.Vector3()).y * .12);
  portrait.max.y += 1.1;
  const centre = roof.getCenter(new THREE.Vector3());
  portrait.min.x = Math.min(portrait.min.x, centre.x - 2.8);
  portrait.max.x = Math.max(portrait.max.x, centre.x + 2.8);
  function fit(bounds: THREE.Box3, direction: THREE.Vector3) {
    const centre = bounds.getCenter(new THREE.Vector3());
    const axis = new THREE.Vector3(0, 1, 0);
    const backward = direction.normalize().applyAxisAngle(axis, yaw);
    const right = new THREE.Vector3().crossVectors(axis, backward).normalize();
    const up = new THREE.Vector3().crossVectors(backward, right);
    const tanV = Math.tan(THREE.MathUtils.degToRad(43 / 2)) * .86;
    const tanH = tanV * Math.max(1, width) / Math.max(1, height);
    let distance = 6;
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const corner = new THREE.Vector3(x, y, z).sub(centre).applyAxisAngle(axis, yaw);
      const depth = corner.dot(backward);
      distance = Math.max(distance, depth + Math.abs(corner.dot(right)) / tanH, depth + Math.abs(corner.dot(up)) / tanV);
    }
    return { target: centre.applyAxisAngle(axis, yaw).add(position), offset: backward.multiplyScalar(distance + .6) };
  }
  const receive = fit(whole, new THREE.Vector3(-.3, .44, 1));
  const close = fit(portrait, new THREE.Vector3(-.16, .24, 1));
  const settle = THREE.MathUtils.smootherstep(age, .65, 2.8);
  return { target: receive.target.lerp(close.target, settle), offset: receive.offset.lerp(close.offset, settle) };
}
