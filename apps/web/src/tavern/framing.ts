import type { GatherGame, Vec3 } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import { PerspectiveCamera, Vector3, MathUtils } from 'three';
import { clearShot, type PlaceShot } from '../interactions/places/framing';

export interface TavernTableFraming extends PlaceShot { readonly fov: number }

/** The carved game card covers a phone below this clip-space height (its top edge at 390×844, with a margin). */
export const PHONE_HUD_TOP = .34;
/** How far the tallest hat (the pointed hat) lifts a seated head's crown above a bare one, measured on the citizen renderer. */
export const TALLEST_HAT = .25;
/**
 * A seated citizen's head sits behind the chair it is on. `top` is its crown in the tallest hat, with a little
 * headroom, above the table top; `side` is how far that hat's flopped tip reaches to either side of the head.
 */
export const ACROSS_HEAD = { reach: 1.375, top: .66 + TALLEST_HAT, side: .5 } as const;

/**
 * The actual table is the canvas. Flat games are seen from the chair, about thirty degrees down on desktop and fifty
 * on a phone, the way a seated player sees a table: the board in front, the whole head of whoever sits across above
 * it. The upright frame has a three-quarter view.
 */
export function tavernTableFraming(centre: Vec3, facing: number, game: GatherGame, aspect: number,
  world: CollisionWorld): TavernTableFraming | null {
  const portrait = aspect < 1, upright = game === 'stones';
  const fx = Math.sin(facing), fz = Math.cos(facing), rx = -fz, rz = fx;
  const back = upright ? portrait ? 3.1 : 2.6 : portrait ? 1.2 : 1.3;
  const high = upright ? portrait ? 2.8 : 2.5 : portrait ? 1.55 : 1.1;
  const shift = portrait ? 0 : .35;
  // Flat boards keep the chair's axis: a lateral eye/aim mismatch rolls the board.
  const wide = upright ? portrait ? .65 : 1.25 : shift;
  const eye: Vec3 = [centre[0] - fx * back + rx * wide, centre[1] + high, centre[2] - fz * back + rz * wide];
  // Aim above the actual solid top, between the board and the face across it. A portrait aims nearer so the board
  // sits above its controls.
  const toward = upright ? 0 : portrait ? -.2 : .15;
  const at: Vec3 = [centre[0] + rx * shift + fx * toward,
    centre[1] + (upright ? portrait ? .2 : .45 : portrait ? .4 : .3), centre[2] + rz * shift + fz * toward];
  const clear = clearShot(world, { eye, at });
  if (!clear) return null;
  const base = upright ? portrait ? 51 : 35 : portrait ? 62 : 35;
  const probe = new PerspectiveCamera(base, aspect, .05, 250);
  probe.position.set(...clear.eye); probe.lookAt(...clear.at); probe.updateMatrixWorld();
  const bounds = upright
    ? [-.68, .68].flatMap(x => [.08, .92].map(y => new Vector3(centre[0] + x, centre[1] + y, centre[2])))
    : (game === 'pong' ? [-.64, .64] : [-.53, .53]).flatMap(x =>
      (game === 'pong' ? [-.47, .47] : [-.37, .37]).map(z => new Vector3(centre[0] + x, centre[1] + .1, centre[2] + z)))
      .concat([-ACROSS_HEAD.side, ACROSS_HEAD.side].map(side => new Vector3(centre[0] + fx * ACROSS_HEAD.reach + rx * side, centre[1] + ACROSS_HEAD.top,
        centre[2] + fz * ACROSS_HEAD.reach + rz * side)));
  // The board keeps a margin under the top edge; only the tallest hat's crown, the last two points, may come nearer.
  let scale = 1;
  const crown = upright ? bounds.length : bounds.length - 2;
  for (const [i, corner] of bounds.entries()) {
    corner.project(probe);
    scale = Math.max(scale, Math.abs(corner.x) / .92, corner.y / (i >= crown ? .94 : .88),
      -corner.y / (portrait ? PHONE_HUD_TOP : .9));
  }
  // A wall can pull a chair's eye inward. Fit the authored board again instead of clipping that chair's columns.
  const fov = MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(base / 2)) * scale));
  return { ...clear, fov };
}
