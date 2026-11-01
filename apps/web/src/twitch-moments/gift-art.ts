import { AVATAR_PALETTE, MAT } from '@chatdom/content';
import type { VoxelBlueprint } from '@chatdom/shared';
import { blueprint, box, field, type BannerKit, type Box } from './banner';

/**
 * Gift pieces in build cells (0.125 m), authored for this lane. Every blueprint's origin is its minimum corner;
 * the `*_CELLS` constants say where its pivot sits so the view can place and animate it.
 *
 * - Parcel: cream paper (the lightest warm cloth in the kit, so it still reads against dusk roofs and the cart's
 *   timber), banded in the kingdom's own field colour, a bow in the tier's hue (gold, rose, rainbow; tier 3 runs
 *   the rainbow along the band too), and the giver's wax seal large on the front: a red roundel with a gold
 *   impression for a named giver, violet with a cream heart for "a friend of the realm", red and brass stamps side
 *   by side when a gift is paid forward. +z is the front.
 * - Canopy: a small striped cloth canopy on four cords that carries a parcel down onto a doorstep.
 * - Gift cart: an open wagon in timber with the kingdom's cloth band, a pennant and room for twelve parcels,
 *   drawn by a chestnut pony. Wheels, pony legs and tail are separate parts so they can turn and step.
 */

export type GiftTier = '1' | '2' | '3';
export type SealKind = 'named' | 'friend' | 'forward';
export const SEAL_KINDS: readonly SealKind[] = ['named', 'friend', 'forward'];
export const GIFT_TIERS: readonly GiftTier[] = ['1', '2', '3'];

const RAINBOW = AVATAR_PALETTE.rainbow;
/** The bow carries the tier, matching the window edge hue: gold, rose, rainbow. */
const ribbon = (tier: GiftTier, i: number) => tier === '3' ? RAINBOW[i % RAINBOW.length]! : tier === '2' ? MAT.petal : MAT.fabricGold;
/** The band carries the kingdom: its field colour on cream paper, the rainbow for tier 3. */
const band = (tier: GiftTier, kit: BannerKit, i: number) => tier === '3' ? RAINBOW[i % RAINBOW.length]! : field(kit);

/** Parcel: 5 × 3 × 5 body, bow on top (y 3), seal one cell proud of the front (z 5). Pivot: bottom centre. */
export const PARCEL_CELLS = { size: [5, 4, 6] as const, pivot: [2.5, 0, 2.5] as const, top: 3 } as const;

export function parcelBlueprint(tier: GiftTier, seal: SealKind, kit: BannerKit): VoxelBlueprint {
  const paper = MAT.cream, boxes: Box[] = [box(0, 0, 0, 5, 3, 5, paper)];
  // The band crosses the box on both axes: over the top, down the front, back and both sides.
  for (let i = 0; i < 5; i++) boxes.push(box(2, 2, i, 3, 3, i + 1, band(tier, kit, i)), box(i, 2, 2, i + 1, 3, 3, band(tier, kit, i + 2)));
  boxes.push(box(2, 0, 0, 3, 2, 1, band(tier, kit, 1)), box(2, 0, 4, 3, 2, 5, band(tier, kit, 3)));
  boxes.push(box(0, 0, 2, 1, 2, 3, band(tier, kit, 4)), box(4, 0, 2, 5, 2, 3, band(tier, kit, 5)));
  // The bow in the tier's hue: two loops across the knot and two tails, a brass knot in the middle.
  boxes.push(box(1, 3, 2, 2, 4, 3, ribbon(tier, 0)), box(3, 3, 2, 4, 4, 3, ribbon(tier, 2)), box(2, 3, 2, 3, 4, 3, MAT.brass));
  boxes.push(box(1, 3, 3, 2, 4, 4, ribbon(tier, 1)), box(3, 3, 1, 4, 4, 2, ribbon(tier, 3)));
  // The giver's seal, pressed over the band on the front face and standing one cell proud of it.
  if (seal === 'forward') {
    // Two stamps, the giver's red low on the left and the forwarded brass high on the right, the band between.
    boxes.push(box(0, 0, 5, 2, 2, 6, MAT.fabricRed), box(3, 1, 5, 5, 3, 6, MAT.brass));
  } else {
    // A roundel: a plus of wax three cells across with its impression at the heart.
    const wax = seal === 'named' ? MAT.fabricRed : MAT.fabricViolet, heart = seal === 'named' ? MAT.goldLeaf : MAT.cream;
    boxes.push(box(1, 1, 5, 4, 2, 6, wax), box(2, 0, 5, 3, 3, 6, wax), box(2, 1, 5, 3, 2, 6, heart));
  }
  return blueprint(`moment-parcel-${kit}-${tier}-${seal}`, kit, [5, 4, 6], boxes);
}

/** Canopy: dome y 5..6, rim y 4, cords y 0..3 down to the parcel's top corners. Pivot: bottom centre. */
export const CANOPY_CELLS = { size: [9, 7, 9] as const, pivot: [4.5, 0, 4.5] as const } as const;

export function canopyBlueprint(kit: BannerKit): VoxelBlueprint {
  const cloth = field(kit), boxes: Box[] = [];
  const panel = (x: number, z: number) => ((Math.floor(x / 3) + Math.floor(z / 3)) % 2 === 0 ? cloth : MAT.cream);
  for (let x = 0; x < 9; x++) for (let z = 0; z < 9; z++) {
    const corner = (x === 0 || x === 8) && (z === 0 || z === 8);
    if (!corner) boxes.push(box(x, 4, z, x + 1, 5, z + 1, panel(x, z)));
    if (x >= 1 && x <= 7 && z >= 1 && z <= 7 && !((x === 1 || x === 7) && (z === 1 || z === 7))) boxes.push(box(x, 5, z, x + 1, 6, z + 1, panel(x, z)));
    if (x >= 3 && x <= 5 && z >= 3 && z <= 5) boxes.push(box(x, 6, z, x + 1, 7, z + 1, x === 4 && z === 4 ? MAT.brass : panel(x, z)));
  }
  for (const [x, z] of [[2, 2], [6, 2], [2, 6], [6, 6]] as const) boxes.push(box(x, 0, z, x + 1, 4, z + 1, MAT.plaster));
  return blueprint(`moment-canopy-${kit}`, kit, [9, 7, 9], boxes);
}

/**
 * Gift cart body: bed x 0..18 (front +x), z 0..12, floor at y 4; sideboards to y 8 with the kingdom's cloth
 * band; axle blocks; shafts reaching forward to x 25; a pennant pole at the back corner. Pivot: ground centre of
 * the bed, (9, 0, 6).
 */
export const CART_CELLS = {
  size: [26, 17, 12] as const, pivot: [9, 0, 6] as const,
  wheels: [[3.5, 3.5, -1], [14.5, 3.5, -1], [3.5, 3.5, 12], [14.5, 3.5, 12]] as const, wheelRadius: 3.5,
  /** Parcel seats on the bed (cell of the parcel's pivot), two layers of six. */
  load: [[4, 5, 3.5], [9.5, 5, 3.5], [15, 5, 3.5], [4, 5, 8.5], [9.5, 5, 8.5], [15, 5, 8.5],
    [6.5, 8, 3.5], [12, 8, 3.5], [6.5, 8, 8.5], [12, 8, 8.5], [9.5, 11, 6], [4, 8, 6]] as const,
  pony: [28, 0, 6] as const,
} as const;

export function cartBlueprint(kit: BannerKit): VoxelBlueprint {
  const wood = MAT.timber, dark = MAT.bark, band = field(kit), boxes: Box[] = [];
  boxes.push(box(0, 4, 0, 18, 5, 12, wood));
  for (const z of [0, 11]) {
    boxes.push(box(0, 5, z, 18, 8, z + 1, wood), box(0, 6, z, 18, 7, z + 1, band));
    for (const x of [0, 6, 12, 17]) boxes.push(box(x, 5, z, x + 1, 9, z + 1, dark));
  }
  for (const x of [0, 17]) boxes.push(box(x, 5, 1, x + 1, 8, 11, wood), box(x, 6, 1, x + 1, 7, 11, band));
  // Brass caps on the corner posts.
  for (const x of [0, 17]) for (const z of [0, 11]) boxes.push(box(x, 9, z, x + 1, 10, z + 1, MAT.brass));
  // Axle blocks and the shafts.
  for (const x of [3, 14]) boxes.push(box(x, 3, 0, x + 1, 4, 12, MAT.darkStone));
  for (const z of [2, 9]) boxes.push(box(18, 5, z, 25, 6, z + 1, wood), box(24, 5, z, 26, 6, z + 1, MAT.brass));
  boxes.push(box(18, 4, 2, 19, 5, 10, dark));
  // Pennant: a pole at the back corner with a swallow-tailed gold flag.
  boxes.push(box(1, 9, 1, 2, 17, 2, dark));
  for (let y = 12; y < 16; y++) {
    const length = y === 12 || y === 15 ? 4 : 5;
    boxes.push(box(2, y, 1, 2 + length, y + 1, 2, y === 12 || y === 15 ? MAT.fabricGold : MAT.goldLeaf));
  }
  return blueprint(`moment-cart-${kit}`, kit, [26, 17, 12], boxes);
}

/** A spoked wheel, 7 cells across and 1 thick; pivot (3.5, 3.5, 0.5). Rotates about its local z axis. */
export function wheelBlueprint(kit: BannerKit): VoxelBlueprint {
  const boxes: Box[] = [];
  for (let x = 0; x < 7; x++) for (let y = 0; y < 7; y++) {
    const dx = x + 0.5 - 3.5, dy = y + 0.5 - 3.5, r = Math.hypot(dx, dy);
    if (r > 3.6) continue;
    const material = x === 3 && y === 3 ? MAT.brass : r > 2.4 ? MAT.timber : x === 3 || y === 3 ? MAT.bark : MAT.air;
    if (material !== MAT.air) boxes.push(box(x, y, 0, x + 1, y + 1, 1, material));
  }
  return blueprint(`moment-cart-wheel-${kit}`, kit, [7, 7, 1], boxes);
}

/**
 * The pony, facing +x. Body x 0..11, y 6..11, z 1..6 with a kingdom saddle cloth falling to a gold edge one cell
 * proud of each flank (z 0 and 6) and a brass collar; neck and head reach forward to x 17; legs and tail are
 * separate parts. Pivot: (5.5, 0, 3.5) on the ground, under the middle of the body.
 */
export const PONY_CELLS = {
  size: [17, 16, 7] as const, pivot: [5.5, 0, 3.5] as const,
  /** Hip cells of the four legs: front pair then back pair, under each flank. Each leg hangs 6 cells from its hip. */
  legs: [[9, 6, 1.5], [9, 6, 5.5], [2, 6, 1.5], [2, 6, 5.5]] as const,
  tail: [-0.5, 10.5, 3.5] as const,
} as const;

export function ponyBlueprint(kit: BannerKit, cloth?: { readonly material: number; readonly tag: string }): VoxelBlueprint {
  // The saddle cloth is the kingdom's own field; a visiting caravan's ponies wear their raider's colour instead.
  const coat = MAT.hairChestnut, mane = MAT.hairBlack, saddle = cloth?.material ?? field(kit), boxes: Box[] = [];
  boxes.push(box(0, 6, 0, 11, 11, 5, coat), box(1, 11, 1, 10, 12, 4, coat));
  // Saddle cloth over the back, falling down both flanks, with a gold edge.
  boxes.push(box(4, 12, 1, 8, 13, 4, saddle), box(4, 8, 0, 8, 12, 1, saddle), box(4, 8, 4, 8, 12, 5, saddle));
  boxes.push(box(4, 8, -1, 8, 9, 0, MAT.goldLeaf), box(4, 8, 5, 8, 9, 6, MAT.goldLeaf));
  // Collar and the neck rising forward.
  boxes.push(box(10, 7, -1, 11, 12, 6, MAT.brass));
  boxes.push(box(10, 10, 1, 13, 14, 4, coat), box(11, 12, 1, 14, 15, 4, coat));
  // Head with a cream blaze down the muzzle, dark eyes and ears.
  boxes.push(box(13, 11, 1, 16, 14, 4, coat), box(15, 10, 1, 17, 12, 4, coat), box(16, 11, 2, 17, 13, 3, MAT.cream));
  boxes.push(box(14, 13, 0, 15, 14, 1, mane), box(14, 13, 4, 15, 14, 5, mane));
  boxes.push(box(12, 15, 1, 13, 16, 2, coat), box(12, 15, 3, 13, 16, 4, coat));
  // The mane along the crest.
  boxes.push(box(9, 12, 2, 13, 13, 3, mane), box(10, 14, 2, 12, 16, 3, mane), box(12, 13, 2, 13, 15, 3, mane));
  return blueprint(`moment-pony-${kit}${cloth ? `-${cloth.tag}` : ''}`, kit, [17, 16, 7], boxes.map(b => ({ ...b, from: [b.from[0], b.from[1], b.from[2] + 1], to: [b.to[0], b.to[1], b.to[2] + 1] })));
}

/** One leg, 2 × 6 × 1 cells: coat above a dark hoof. Pivot at the hip, (1, 6, 0.5). */
export function ponyLegBlueprint(kit: BannerKit): VoxelBlueprint {
  return blueprint(`moment-pony-leg-${kit}`, kit, [2, 6, 1], [box(0, 1, 0, 2, 6, 1, MAT.hairChestnut), box(0, 0, 0, 2, 1, 1, MAT.hairBlack)]);
}

/** The tail, hanging from (0.5, 5, 0.5). */
export function ponyTailBlueprint(kit: BannerKit): VoxelBlueprint {
  return blueprint(`moment-pony-tail-${kit}`, kit, [2, 5, 1], [box(0, 2, 0, 1, 5, 1, MAT.hairBlack), box(1, 0, 0, 2, 3, 1, MAT.hairBlack)]);
}

export function giftParts(kit: BannerKit): VoxelBlueprint[] {
  return [
    ...GIFT_TIERS.flatMap(tier => SEAL_KINDS.map(seal => parcelBlueprint(tier, seal, kit))),
    canopyBlueprint(kit), cartBlueprint(kit), wheelBlueprint(kit), ponyBlueprint(kit), ponyLegBlueprint(kit), ponyTailBlueprint(kit),
  ];
}
