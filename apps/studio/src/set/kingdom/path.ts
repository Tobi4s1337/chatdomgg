// One eased camera move through a shot's keys. The eye travels a centripetal Catmull-Rom curve at a speed set by
// the ease alone (the curve is walked by distance, so a key never makes the camera speed up or brake); the target and
// the lens follow the same curve parameter.
import * as THREE from 'three';
import type { Ease } from './shots';

export interface View { eye: THREE.Vector3; target: THREE.Vector3; fov: number }
export interface ResolvedKey { eye: THREE.Vector3; target: THREE.Vector3; fov: number }

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const smooth = (n: number) => n * n * (3 - 2 * n);

export function eased(ease: Ease, u: number): number {
  const x = clamp(u);
  if (ease === 'inout') return x * x * x * (x * (x * 6 - 15) + 10);
  if (ease === 'gentle') return (1 - Math.cos(Math.PI * x)) / 2;
  // A drift is a steady glide that still starts and stops softly, so the edit can cut into it anywhere.
  return .65 * x + .35 * smooth(x);
}

export function cameraPath(keys: readonly ResolvedKey[], duration: number, ease: Ease): (t: number) => View {
  if (!keys.length) throw new Error('A shot needs at least one camera key');
  if (keys.length === 1) { const key = keys[0]!; return () => ({ eye: key.eye.clone(), target: key.target.clone(), fov: key.fov }); }
  const curve = (points: THREE.Vector3[]) => points.length === 2 ? new THREE.LineCurve3(points[0]!, points[1]!) : new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const eyes = curve(keys.map(key => key.eye.clone())), targets = curve(keys.map(key => key.target.clone()));
  const travelled = eyes.getLength();
  const fovAt = (p: number) => {
    const x = p * (keys.length - 1), i = Math.min(keys.length - 2, Math.floor(x)), f = x - i;
    return keys[i]!.fov + (keys[i + 1]!.fov - keys[i]!.fov) * smooth(f);
  };
  return (t: number) => {
    const u = eased(ease, duration > 0 ? t / duration : 1);
    // A fixed eye (a pan or a lens change only) has no length to walk: use the ease directly.
    const p = travelled > .01 ? eyes.getUtoTmapping(u, 0) : u;
    return { eye: eyes.getPoint(p), target: targets.getPoint(p), fov: fovAt(p) };
  };
}
