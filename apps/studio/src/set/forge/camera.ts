// The lens as a pure function of shot time: a Hermite path through the shot's keys whose tangents come from the
// neighbouring keys (Catmull-Rom with real key times), so speed carries smoothly through every key and any short
// window of the take is a single, continuous move.
import * as THREE from 'three';
import type { CameraKey } from './shots';

type Triple = readonly [number, number, number];

function tangent(keys: readonly CameraKey[], i: number, pick: (k: CameraKey) => Triple): THREE.Vector3 {
  const a = keys[Math.max(0, i - 1)]!, b = keys[Math.min(keys.length - 1, i + 1)]!;
  const span = b.at - a.at;
  if (span <= 0) return new THREE.Vector3();
  return new THREE.Vector3(...pick(b)).sub(new THREE.Vector3(...pick(a))).divideScalar(span);
}

function hermite(keys: readonly CameraKey[], i: number, u: number, pick: (k: CameraKey) => Triple): THREE.Vector3 {
  const k0 = keys[i]!, k1 = keys[i + 1]!, h = k1.at - k0.at;
  const u2 = u * u, u3 = u2 * u;
  const p0 = new THREE.Vector3(...pick(k0)), p1 = new THREE.Vector3(...pick(k1));
  const m0 = tangent(keys, i, pick).multiplyScalar(h), m1 = tangent(keys, i + 1, pick).multiplyScalar(h);
  return p0.multiplyScalar(2 * u3 - 3 * u2 + 1).addScaledVector(m0, u3 - 2 * u2 + u)
    .addScaledVector(p1, -2 * u3 + 3 * u2).addScaledVector(m1, u3 - u2);
}

/** Eye, look-at point (both relative to the shot's origin) and field of view at shot second t. */
export function sampleCamera(keys: readonly CameraKey[], t: number): { eye: THREE.Vector3; look: THREE.Vector3; fov: number } {
  const first = keys[0]!, last = keys[keys.length - 1]!;
  if (keys.length === 1 || t <= first.at) return { eye: new THREE.Vector3(...first.eye), look: new THREE.Vector3(...first.look), fov: first.fov };
  if (t >= last.at) return { eye: new THREE.Vector3(...last.eye), look: new THREE.Vector3(...last.look), fov: last.fov };
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1]!.at) i++;
  const k0 = keys[i]!, k1 = keys[i + 1]!, u = (t - k0.at) / (k1.at - k0.at);
  const fov = hermite(keys, i, u, k => [k.fov, 0, 0]).x;
  return { eye: hermite(keys, i, u, k => k.eye), look: hermite(keys, i, u, k => k.look), fov };
}
