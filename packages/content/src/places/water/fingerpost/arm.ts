import type { Vec3 } from '@chatdom/shared';
import { Boxes } from '../../../civic/kit';
import { MAT, type StyleKey } from '../../../materials';
import { IRON, checkStyle, millBlueprint, wood } from '../millrace/craft';
import { NO_METADATA, type WaterPiece } from '../place-piece';
import { hash } from '../shore/shape';
import { FINGERPOST, FINGERPOST_DESTINATIONS, checkDestination, type FingerpostDestination } from './frame';

/**
 * The emblems, seven cells wide and five tall, top row first. Each is left–right symmetric, so it reads the same
 * on both faces of the arm. Cream carries the silhouette (it holds in greyscale); colour is the accent:
 * C cream, G gold leaf, B brass, R cloth, W blue flower, '.' the iron plaque behind.
 */
const EMBLEMS: Readonly<Record<FingerpostDestination, readonly string[]>> = {
  // A crenellated tower with an arrow slit and a dark gate.
  castle: ['.C.C.C.', '.CCCCC.', '.CC.CC.', '.CCCCC.', '.CC.CC.'],
  // A market stall: a striped, scalloped awning on two posts over a counter laid with goods.
  market: ['RCRCRCR', 'R.R.R.R', '.G...G.', '.GBCBG.', 'GGGGGGG'],
  // A sailing boat with an upswept hull, riding a zigzag wave line.
  lake: ['...C...', 'G.CCC.G', '.GGGGG.', 'W.W.W.W', '.W.W.W.'],
  // A spoked cart wheel round a brass hub: the road out.
  road: ['..CCC..', '.C.C.C.', '.CCBCC.', '.C.C.C.', '..CCC..'],
};
const INK: Readonly<Record<string, number>> = { C: MAT.cream, G: MAT.goldLeaf, B: MAT.brass, R: MAT.cloth, W: MAT.blueFlower };

/** Root cells to seed a support flood from: the arm hangs from its shoe on the post, not from its own floor. */
export const FINGER_ARM_ROOT_SEEDS: readonly Vec3[] = Array.from({ length: FINGERPOST.arm.size[1] }, (_, y) =>
  Array.from({ length: FINGERPOST.arm.size[2] }, (_, z): Vec3 => [FINGERPOST.arm.shoe[0], y, z])).flat();

/**
 * One finger arm pointing along +X: an iron shoe that seats against the post, a clean two-cell board whose flat
 * faces carry the caller's name, an iron plaque with the destination's emblem standing a cell proud on both faces,
 * and the board stepping down to a pointed end-grain finger with a spot of lichen on its top. The arm carries no
 * letters; the host draws the supplied name on `name-north` and `name-south`.
 */
export function createFingerArm(style: StyleKey, destination: FingerpostDestination): WaterPiece {
  checkStyle('finger arm', style);
  checkDestination('finger arm', destination);
  const A = FINGERPOST.arm, [z0, z1] = A.board, [, H, D] = A.size, { plank, end } = wood(style), b = new Boxes();
  const seed = FINGERPOST_DESTINATIONS.indexOf(destination);
  // The board, row by row so the far end steps to a point; the last cell of each row shows its end grain.
  A.point.forEach((x1, y) => {
    b.add(A.shoe[0], y, z0, x1, y + 1, z1, plank);
    b.add(x1 - 1, y, z0, x1, y + 1, z1, end);
  });
  // The plaque: an iron plate through the board, and the emblem on both faces in front of it.
  const [p0, p1] = A.plaque;
  b.add(p0, 0, z0, p1, H, z1, IRON);
  EMBLEMS[destination].forEach((row, i) => {
    const y = H - 1 - i;
    for (let x = 0, start = 0; x <= row.length; x++) {
      if (x < row.length && row[x] === row[start]) continue;
      if (row[start] !== '.') for (const z of [z0 - 1, z1]) b.add(p0 + start, y, z, p0 + x, y + 1, z + 1, INK[row[start]!]!);
      start = x;
    }
  });
  // Lichen on the open top of the finger's shoulder, where the rain sits; it never reaches the name face.
  const lichen = A.point[4] + Math.floor(hash(seed, 41) * (A.point[3] - A.point[4]));
  b.add(lichen, H - 2, z0, lichen + 1, H - 1, z1, MAT.moss);
  // The iron shoe that wraps the root, with a brass bolt head on each face.
  const [s0, s1] = A.shoe;
  b.add(s0, 0, 0, s1, H, D, IRON);
  const bolt = 1 + Math.floor(hash(seed, 43) * 3);
  for (const z of [0, D - 1]) b.add(s1 - 1, bolt, z, s1, bolt + 1, z + 1, MAT.brass);
  const blueprint = millBlueprint(`water-${style}-finger-${destination}`, style, 'prop', A.size, b);
  const [n0, n1] = A.name, along = (n0 + n1) / 2;
  return {
    ...NO_METADATA, blueprint,
    texts: [
      { id: 'name-north', centre: [along, H / 2, z0], facing: 'north', width: n1 - n0, height: H },
      { id: 'name-south', centre: [along, H / 2, z1], facing: 'south', width: n1 - n0, height: H },
    ],
    mounts: [{ id: 'root', position: [...A.root], axis: [0, 1, 0] }],
  };
}
