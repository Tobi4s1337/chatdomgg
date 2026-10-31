import * as THREE from 'three';

/**
 * The mirrored camera for a horizontal water plane y = `level`, with its near plane obliquely clipped onto the water
 * so nothing under the surface reaches the reflection (E. Lengyel, "Modifying the Projection Matrix to Perform
 * Oblique Near-Plane Clipping", 2005). Writes `mirror` and the texture matrix that maps world points to its image.
 * Returns false when the eye is not above the water: there is then no valid reflected view.
 */
export function mirrorCamera(camera: THREE.Camera, level: number, mirror: THREE.PerspectiveCamera, textureMatrix: THREE.Matrix4): boolean {
  camera.updateMatrixWorld();
  const eye = scratch.eye.setFromMatrixPosition(camera.matrixWorld);
  if (!(eye.y > level + 1e-3) || !Number.isFinite(level)) return false;
  const forward = scratch.forward.set(0, 0, -1).transformDirection(camera.matrixWorld);
  const up = scratch.up.set(0, 1, 0).transformDirection(camera.matrixWorld);
  mirror.position.set(eye.x, 2 * level - eye.y, eye.z);
  forward.y = -forward.y; up.y = -up.y;
  mirror.up.copy(up);
  mirror.lookAt(scratch.target.copy(mirror.position).add(forward));
  mirror.layers.mask = camera.layers.mask;
  mirror.updateMatrixWorld();
  mirror.matrixWorldInverse.copy(mirror.matrixWorld).invert();
  mirror.projectionMatrix.copy(camera.projectionMatrix);
  if ('far' in camera && typeof camera.far === 'number') mirror.far = camera.far;

  // The water plane in the mirror camera's view space, then the oblique near plane through it.
  const plane = scratch.plane.setFromNormalAndCoplanarPoint(scratch.normal.set(0, 1, 0), scratch.point.set(eye.x, level, eye.z));
  plane.applyMatrix4(mirror.matrixWorldInverse);
  const clip = scratch.clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  const p = mirror.projectionMatrix.elements;
  const q = scratch.q.set((Math.sign(clip.x) + p[8]!) / p[0]!, (Math.sign(clip.y) + p[9]!) / p[5]!, -1, (1 + p[10]!) / p[14]!);
  clip.multiplyScalar(2 / clip.dot(q));
  p[2] = clip.x; p[6] = clip.y; p[10] = clip.z + 1; p[14] = clip.w;
  mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();

  textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
    .multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);
  return true;
}

const scratch = {
  eye: new THREE.Vector3(), forward: new THREE.Vector3(), up: new THREE.Vector3(), target: new THREE.Vector3(),
  normal: new THREE.Vector3(), point: new THREE.Vector3(), plane: new THREE.Plane(), clip: new THREE.Vector4(), q: new THREE.Vector4(),
};
