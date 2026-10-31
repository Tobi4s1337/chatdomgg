import { AVATAR_PALETTE, MAT } from '@chatdom/content';
import { StyleIdSchema, VoxelBlueprintSchema, type VoxelBlueprint } from '@chatdom/shared';

/**
 * A home banner in build cells (0.125 m), authored for this lane. Local frame: +x along the wall, +y up, +z out
 * of the wall. The mount point (the host's anchor) is the wall surface under the middle of the rod.
 *
 * - Bracket: two iron wall plates (x 2..3, 12..13) with arms, braces and hooks cradle a timber rod (x 0..15,
 *   y 4..5, z 2..3) that ends in brass knobs. It is fixed to the house, so it never sways.
 * - Cloth: 9 cells wide (x 3..12), hanging in front of the rod (z 3..4). A head row with three tabs looped over
 *   the rod, then 14 rows: a tier-coloured band (row 1), the kingdom's chevron (rows 2..5) over the lozenge sub
 *   mark (rows 7..11) in cream, a tier-coloured border down both sides and a swallowtail hem (rows 12..14).
 * - Roll: the furled cloth, a faceted 9 × 3 × 3 cylinder that rides down the wall as the cloth unrolls.
 * - Ribbons: month ribbons tied at the rod's right end, one tail per authored month count.
 */
export const BANNER_CELLS = { width: 15, rod: { y: 4, z: 2 }, cloth: { x: 3, width: 9, z: 3, rows: 14 }, mount: [7.5, 4.5, 0] as const } as const;
export const CELL = 0.125;

export type BannerTier = 'prime' | '1' | '2' | '3';
export type BannerKit = 'hearth' | 'tide';
/** Kingdom field per kit, matching the civic arms (Hearth cloth red, Tide slate). */
const FIELD: Record<BannerKit, number> = { hearth: MAT.cloth, tide: MAT.slate };
/** A lapsed sub keeps its colours but loses their sheen: the same hues from the muted fabric row. */
const FIELD_LAPSED: Record<BannerKit, number> = { hearth: MAT.fabricMutedRed, tide: MAT.fabricMutedBlue };
const RAINBOW = AVATAR_PALETTE.rainbow, RAINBOW_LAPSED = AVATAR_PALETTE.fabricLapsed;
const RIBBON_COLOURS = [MAT.fabricGold, MAT.cream, MAT.fabricBlue, MAT.fabricGreen, MAT.fabricViolet] as const;
const RIBBON_LAPSED = [MAT.fabricMutedGold, MAT.plaster, MAT.fabricMutedBlue, MAT.fabricMutedGreen, MAT.fabricMutedViolet] as const;
/** Tier 3's border carries the rainbow; it marches one row per phase, a slow shimmer down the cloth. */
export const SHIMMER_PHASES = RAINBOW.length;

export const field = (kit: BannerKit, lapsed = false) => (lapsed ? FIELD_LAPSED : FIELD)[kit];
export const border = (tier: BannerTier, row: number, phase = 0, lapsed = false) => tier === '3'
  ? (lapsed ? RAINBOW_LAPSED : RAINBOW)[(row + phase) % RAINBOW.length]!
  : tier === '2' ? (lapsed ? MAT.fabricMutedRed : MAT.petal) : lapsed ? MAT.fabricMutedGold : MAT.fabricGold;

export type Box = { from: [number, number, number]; to: [number, number, number]; material: number };
export function blueprint(id: string, kit: BannerKit, size: [number, number, number], boxes: Box[]): VoxelBlueprint {
  return VoxelBlueprintSchema.parse({ version: 1, id, styleId: StyleIdSchema.parse(kit), kind: 'prop', lattice: 'build', size, boxes, windows: [] });
}
export const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: number): Box => ({ from: [x0, y0, z0], to: [x1, y1, z1], material });

export function bannerBracket(kit: BannerKit): VoxelBlueprint {
  const iron = MAT.darkStone, boxes: Box[] = [];
  for (const x of [2, 12]) {
    boxes.push(box(x, 1, 0, x + 1, 7, 1, iron));     // wall plate
    boxes.push(box(x, 3, 1, x + 1, 4, 4, iron));     // arm
    boxes.push(box(x, 2, 1, x + 1, 3, 2, iron));     // brace
    boxes.push(box(x, 4, 3, x + 1, 5, 4, iron));     // hook in front of the rod
  }
  boxes.push(box(0, 4, 2, 15, 5, 3, MAT.timber));   // rod
  for (const x of [0, 14]) {                          // brass knobs
    boxes.push(box(x, 3, 2, x + 1, 6, 3, MAT.brass));
    boxes.push(box(x, 4, 1, x + 1, 5, 4, MAT.brass));
  }
  return blueprint(`moment-banner-${kit}-bracket`, kit, [15, 7, 4], boxes);
}

/** Material of cloth cell (col, row) for rows 1..14, or air where the swallowtail is cut. */
export function clothCell(tier: BannerTier, kit: BannerKit, col: number, row: number, phase = 0): number {
  const { width, rows } = BANNER_CELLS.cloth, centre = (width - 1) / 2;
  const fromHem = rows - row;
  // Swallowtail: the notch rises three rows from the hem.
  if (fromHem < 3 && Math.abs(col - centre) <= 2 - fromHem) return MAT.air;
  if (col === 0 || col === width - 1 || row === 1) return border(tier, row, phase);
  // The arms: a chevron (one roof) over a lozenge (the light kept under it), in cream.
  const d = Math.abs(col - centre);
  if (row >= 2 && row <= 5 && (d === row - 2 || d === row - 3)) return MAT.cream;
  const lozenge = [0, 1, 2, 1, 0][row - 7];
  if (lozenge !== undefined && d <= lozenge) return MAT.cream;
  return FIELD[kit];
}

export function bannerHead(kit: BannerKit): VoxelBlueprint {
  // Placed at banner cells (3, 4, 1): the head hangs in front of the rod and three tabs loop over it.
  const { width } = BANNER_CELLS.cloth, cloth = FIELD[kit];
  const boxes = [box(0, 0, 2, width, 1, 3, cloth)];
  for (const x of [1, 4, 7]) boxes.push(box(x, 1, 0, x + 1, 2, 3, cloth), box(x, 0, 0, x + 1, 1, 1, cloth));
  return blueprint(`moment-banner-${kit}-head`, kit, [width, 2, 3], boxes);
}

export function bannerRow(tier: BannerTier, kit: BannerKit, row: number, phase = 0): VoxelBlueprint {
  const { width } = BANNER_CELLS.cloth, boxes: Box[] = [];
  let start = 0;
  for (let col = 1; col <= width; col++) {
    const a = clothCell(tier, kit, start, row, phase);
    if (col < width && clothCell(tier, kit, col, row, phase) === a) continue;
    if (a !== MAT.air) boxes.push(box(start, 0, 0, col, 1, 1, a));
    start = col;
  }
  return blueprint(`moment-banner-${kit}-${tier}-row-${row}${phase ? `-p${phase}` : ''}`, kit, [width, 1, 1], boxes);
}

/** The furled roll. Lapsed, it keeps its colours in the muted row: the sheen goes, nothing vanishes. */
export function bannerRoll(tier: BannerTier, kit: BannerKit, lapsed = false): VoxelBlueprint {
  const { width } = BANNER_CELLS.cloth, cloth = field(kit, lapsed), edge = border(tier, 3, 0, lapsed);
  const boxes = [box(1, 0, 1, width - 1, 3, 2, cloth), box(1, 1, 0, width - 1, 2, 3, cloth)];
  for (const x of [0, width - 1]) boxes.push(box(x, 0, 1, x + 1, 3, 2, edge), box(x, 1, 0, x + 1, 2, 3, edge));
  // A cream tie holds a lapsed roll shut on its rod.
  if (lapsed) boxes.push(box(4, 0, 0, 5, 3, 3, MAT.plaster));
  return blueprint(`moment-banner-${kit}-${tier}-roll${lapsed ? '-lapsed' : ''}`, kit, [width, 3, 3], boxes);
}

/**
 * The tier's cloak on the home: a swagged valance over the rod (tier 2 rose, tier 3 the rainbow in vertical
 * panels), with a gold fringe. Placed at banner cells (2, 3, 4), in front of the head row; 11 × 4 × 1.
 */
export const SWAG_CELLS = { x: 2, y: 2, z: 4, width: 11, height: 4 } as const;
export function bannerSwag(tier: '2' | '3', kit: BannerKit, lapsed = false): VoxelBlueprint {
  const { width, height } = SWAG_CELLS, boxes: Box[] = [];
  const rainbow = lapsed ? RAINBOW_LAPSED : RAINBOW, fringe = lapsed ? MAT.fabricMutedGold : MAT.goldLeaf;
  // Two swags: each column hangs to its own depth, deepest between the tabs, so the hem reads as two soft curves.
  const depth = [2, 3, 4, 4, 3, 2, 3, 4, 4, 3, 2];
  for (let x = 0; x < width; x++) {
    const colour = tier === '2' ? (lapsed ? MAT.fabricMutedRed : MAT.petal) : rainbow[Math.floor(x * rainbow.length / width)]!;
    const bottom = height - depth[x]!;
    boxes.push(box(x, bottom + 1, 0, x + 1, height, 1, colour), box(x, bottom, 0, x + 1, bottom + 1, 1, fringe));
  }
  // Brass rosettes where the swags gather.
  for (const x of [0, 5, 10]) boxes.push(box(x, height - 1, 0, x + 1, height, 1, lapsed ? MAT.fabricMutedGold : MAT.brass));
  return blueprint(`moment-banner-${kit}-${tier}-swag${lapsed ? '-lapsed' : ''}`, kit, [width, height, 1], boxes);
}

/**
 * Ten distinct tails, one per authored month count, tied under the rod's ends: first beside the cloth on the right
 * (x 13, under the rod; x 14, under the knob), then on the left. `top` is the knot cell; tails never share a cell.
 */
export const RIBBON_SLOTS = ([[13, 3], [13, 1], [14, 3], [14, 1], [13, 2], [14, 2], [1, 3], [1, 1], [1, 2], [0, 2]] as const)
  .map(([x, z], i) => ({ x, z, top: x === 13 || x === 1 ? 3 : 2, length: [6, 5, 5, 4, 7, 6, 6, 5, 7, 5][i]! }));

export function bannerRibbon(kit: BannerKit, index: number, lapsed = false): VoxelBlueprint {
  const slot = RIBBON_SLOTS[index], colour = (lapsed ? RIBBON_LAPSED : RIBBON_COLOURS)[index % RIBBON_COLOURS.length]!;
  if (!slot) throw new Error('There are ten authored month ribbons');
  // A cream knot, the tail, and a darker notched tip one cell proud.
  const boxes = [box(0, slot.length - 1, 0, 1, slot.length, 1, lapsed ? MAT.plaster : MAT.cream), box(0, 1, 0, 1, slot.length - 1, 1, colour),
    box(0, 0, 0, 1, 1, 1, lapsed ? MAT.fabricMutedGold : MAT.goldLeaf)];
  return blueprint(`moment-banner-${kit}-ribbon-${index}${lapsed ? '-lapsed' : ''}`, kit, [1, slot.length, 1], boxes);
}

export const BANNER_TIERS: readonly BannerTier[] = ['prime', '1', '2', '3'];
export function bannerParts(tier: BannerTier, kit: BannerKit) {
  return {
    head: bannerHead(kit),
    rows: Array.from({ length: BANNER_CELLS.cloth.rows }, (_, i) => bannerRow(tier, kit, i + 1)),
    roll: bannerRoll(tier, kit),
    rollLapsed: bannerRoll(tier, kit, true),
    /** Tier 3 only: every row's border at each shimmer phase (phase 0 is `rows`). */
    shimmer: tier === '3' ? Array.from({ length: SHIMMER_PHASES }, (_, p) => Array.from({ length: BANNER_CELLS.cloth.rows }, (_, i) => bannerRow(tier, kit, i + 1, p))) : [],
    swag: tier === '2' || tier === '3' ? bannerSwag(tier, kit) : null,
    swagLapsed: tier === '2' || tier === '3' ? bannerSwag(tier, kit, true) : null,
  };
}
