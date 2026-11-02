import type { GatherGame, Vec3 } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import { PerspectiveCamera, Vector3, MathUtils } from 'three';
import { clearShot, type PlaceShot } from '../interactions/places/framing';

export interface TavernTableFraming extends PlaceShot { readonly fov: number }

/** The actual table is the canvas. Flat games look down onto it; the upright frame has a three-quarter view. */
export function tavernTableFraming(centre: Vec3, facing: number, game: GatherGame, aspect: number,
  world: CollisionWorld): TavernTableFraming | null {
  const portrait = aspect < 1, upright = game === 'stones';
  const fx = Math.sin(facing), fz = Math.cos(facing), rx = -fz, rz = fx;
  const back = upright ? portrait ? 3.1 : 2.6 : portrait ? .85 : .35;
  const high = upright ? portrait ? 2.8 : 2.5 : portrait ? 2.6 : 2.2;
  const shift = portrait ? 0 : .35;
  // Near-vertical flat boards need a consistent chair axis; a lateral eye/aim mismatch rolls the board.
  const wide = upright ? portrait ? .65 : 1.25 : shift;
  const eye: Vec3 = [centre[0] - fx * back + rx * wide, centre[1] + high, centre[2] - fz * back + rz * wide];
  // Aim above the actual solid top. A portrait looks toward the near edge so the board sits above its controls.
  const toward = portrait && !upright ? -.65 : 0;
  const at: Vec3 = [centre[0] + rx * shift + fx * toward,
    centre[1] + (upright ? portrait ? .2 : .45 : .12), centre[2] + rz * shift + fz * toward];
  const clear = clearShot(world, { eye, at });
  if (!clear) return null;
  const base = upright ? portrait ? 51 : 35 : portrait ? 62 : 35;
  const probe = new PerspectiveCamera(base, aspect, .05, 250);
  probe.position.set(...clear.eye); probe.lookAt(...clear.at); probe.updateMatrixWorld();
  const bounds = upright
    ? [-.68, .68].flatMap(x => [.08, .92].map(y => new Vector3(centre[0] + x, centre[1] + y, centre[2])))
    : (game === 'pong' ? [-.64, .64] : [-.53, .53]).flatMap(x =>
      (game === 'pong' ? [-.47, .47] : [-.37, .37]).map(z => new Vector3(centre[0] + x, centre[1] + .1, centre[2] + z)));
  let scale = 1;
  for (const corner of bounds) {
    corner.project(probe);
    scale = Math.max(scale, Math.abs(corner.x) / .92, corner.y / .88, -corner.y / (portrait ? .43 : .9));
  }
  // A wall can pull a chair's eye inward. Fit the authored board again instead of clipping that chair's columns.
  const fov = MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(base / 2)) * scale));
  return { ...clear, fov };
}
