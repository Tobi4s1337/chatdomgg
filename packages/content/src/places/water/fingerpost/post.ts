import { Boxes, octagon } from '../../../civic/kit';
import { MAT, STYLES, type StyleKey } from '../../../materials';
import { IRON, checkStyle, masonry, millBlueprint, wood } from '../millrace/craft';
import { NO_METADATA, type WaterPiece } from '../place-piece';
import { cells, groundFooting, hash } from '../shore/shape';
import { createFingerArm } from './arm';
import { FINGERPOST, checkDestinations, fingerpostFrame, type FingerpostDestination } from './frame';

export interface FingerpostArm {
  readonly destination: FingerpostDestination;
  /** The post mount this arm's `root` sits on; the host yaws the arm about +Y to the destination's bearing. */
  readonly mount: string;
  readonly piece: WaterPiece;
}
export interface Fingerpost { readonly post: WaterPiece; readonly arms: readonly FingerpostArm[] }

/**
 * The fingerpost at the foot of the millstream bridge: one arm for each supplied destination, in the order given,
 * the first right under the finial. Refuses an empty list, a repeat, an unknown destination or more than four;
 * it never adds an arm for somewhere the host did not supply.
 */
export function createFingerpost(style: StyleKey, destinations: readonly FingerpostDestination[]): Fingerpost {
  checkStyle('fingerpost', style);
  checkDestinations('fingerpost', destinations);
  const post = createFingerpostPost(style, destinations.length);
  return {
    post,
    arms: destinations.map((destination, i) => ({ destination, mount: `arm-${i}`, piece: createFingerArm(style, destination) })),
  };
}

/**
 * The post alone, for `count` arms: a chamfered square timber set in a dressed stone plinth with dark boulders,
 * moss and a leafy tuft at its foot. The foot is darkened by damp, one face has a weathered split and a lichen
 * patch, iron bands close the arm stack above and below, and a cap plate carries a brass ball finial. Each collar
 * mount sits on the post's axis at its arm's root height.
 */
export function createFingerpostPost(style: StyleKey, count: number): WaterPiece {
  checkStyle('fingerpost', style);
  const frame = fingerpostFrame(count), { plan, timber: [t0, t1], plinth: [q0, q1], band: [r0, r1] } = FINGERPOST;
  const { plank, end } = wood(style), tones = masonry(style), b = new Boxes();
  const seed = Object.keys(STYLES).indexOf(style), mid = (t0 + t1) / 2;
  // The plinth: a chamfered block with a damp bottom course and a set-back top course the post rises through.
  octagon(b, q0, 0, q0, q1, 3, q1, tones.stone);
  octagon(b, q0, 0, q0, q1, 1, q1, tones.wet);
  octagon(b, r0, 3, r0, r1, 4, r1, tones.stone);
  // Moss on the shaded north ledge of the plinth.
  const mossFrom = q0 + 1 + Math.floor(hash(seed, 3) * 3);
  b.add(mossFrom, 2, q0, mossFrom + 2 + Math.floor(hash(seed, 4) * 2), 3, q0 + 1, MAT.moss);
  // Boulders bedded against the west, east and north sides, each with moss on its crown.
  const boulders: readonly (readonly [number, number, number, number, number])[] = [
    [0, q0 + 1 + Math.floor(hash(seed, 5) * 2), 2, 3, 2],
    [q1, mid - 2 + Math.floor(hash(seed, 7) * 2), 2, 3, 2],
    [mid - 3, 0, 3, q0, 1],
  ];
  boulders.forEach(([x, z, w, d, h], i) => {
    b.add(x, 0, z, x + w, h, z + d, MAT.darkStone);
    if (h > 1) b.add(x, h - 1, z + 1, x + w, h, z + 2, MAT.moss);
    else b.add(x + 1 + Math.floor(hash(seed, 9, i) * (w - 1)), 0, z, x + 2 + Math.floor(hash(seed, 9, i) * (w - 1)), 1, z + 1, MAT.moss);
  });
  // A tuft of leaf at the south-east foot, with one blue flower in it.
  b.add(q1, 0, q1 - 2, q1 + 1, 2, q1 - 1, MAT.leaf);
  b.add(q1 - 1, 0, q1, q1 + 2, 1, q1 + 1, MAT.leaf);
  b.add(q1, 0, q1 - 1, q1 + 1, 1, q1, MAT.leaf);
  b.add(q1, 2, q1 - 2, q1 + 1, 3, q1 - 1, MAT.blueFlower);
  // The timber, from the footing to the top band, its first cells above the plinth dark with damp.
  const [low, high] = frame.bands;
  octagon(b, t0, 0, t0, t1, high, t1, plank);
  octagon(b, t0, 4, t0, t1, 6, t1, end);
  // A weathered split down the east face, and lichen on the north face.
  const split = 7 + Math.floor(hash(seed, 11) * 3);
  b.add(t1 - 1, split, mid - 1, t1, split + 5 + Math.floor(hash(seed, 13) * 2), mid, MAT.air);
  const lichen = 7 + Math.floor(hash(seed, 17) * 3);
  b.add(t0 + 1, lichen, t0, t0 + 2, lichen + 2, t0 + 1, MAT.moss);
  b.add(t0 + 2, lichen + 1, t0, t0 + 3, lichen + 2, t0 + 1, MAT.moss);
  // The iron bands that close the arm stack, under the lowest arm and over the highest.
  for (const y of [low, high]) octagon(b, r0, y, r0, r1, y + 1, r1, IRON);
  // The crown: an end-grain cap plate, a neck and a faceted brass ball with its tip.
  octagon(b, r0, high + 1, r0, r1, high + 2, r1, end);
  b.add(mid - 1, high + 2, mid - 1, mid + 1, high + 3, mid + 1, plank);
  octagon(b, t0, high + 3, t0, t1, high + 5, t1, MAT.brass);
  b.add(mid - 1, high + 5, mid - 1, mid + 1, high + 6, mid + 1, MAT.brass);
  const size = [plan, frame.height, plan] as const;
  const blueprint = millBlueprint(`water-${style}-fingerpost-${count}`, style, 'civic', [...size], b);
  return {
    ...NO_METADATA, blueprint,
    footings: [{ id: 'plinth', box: groundFooting(cells(blueprint.boxes, blueprint.size), blueprint.size) }],
    mounts: frame.collars.map(c => ({ id: c.id, position: c.position, axis: [0, 1, 0] })),
  };
}
