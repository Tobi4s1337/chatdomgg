import { MAT } from '../../../materials';
import type { AggmanPiece, Livery } from '../piece';
import { layCoil, setPut, IRON, ROPE } from './gear';
import { Grid, noise, ring } from './grid';

/** A square slab of `size` cells at (x0, z0) with its corners cut by `cut`, so round things read faceted. */
function octagon(g: Grid, x0: number, y0: number, z0: number, size: number, height: number, cut: number, material: number | ((x: number, y: number, z: number) => number)): void {
  for (let y = y0; y < y0 + height; y++) for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const cx = Math.min(x, size - 1 - x), cz = Math.min(z, size - 1 - z);
    if (cx + cz < cut) continue;
    g.set(x0 + x, y, z0 + z, typeof material === 'number' ? material : material(x0 + x, y, z0 + z));
  }
}

export type BollardVariant = 0 | 1;

/**
 * A squat mooring bollard about 0.6 m high, with a mooring line's eye dropped over it and the line led away along
 * +Z (the quay edge). Frame: the bollard's axis at (5, 5), y = 0 the quay surface.
 *
 * - 0: cast iron, cannon-fashion: a flared foot on a granite pad, a waist the rope bites into, an overhanging lip
 *   and a domed head, worn bright where the ropes run.
 * - 1: dressed stone: a coursed drum on a plinth with an iron band under a mushroom head, moss in the foot's angle,
 *   and its line's tail lying coiled on the quay.
 */
export function createMooringBollard(variant: BollardVariant): AggmanPiece {
  if (variant !== 0 && variant !== 1) throw new RangeError(`mooring bollard: variant must be 0 or 1, not ${String(variant)}.`);
  const g = new Grid(12, 7, variant === 0 ? 17 : 20);
  let neck: number;
  if (variant === 0) {
    octagon(g, 0, 0, 0, 11, 1, 3, (x, _y, z) => (noise(x >> 2, z >> 2, 1) < 0.3 ? MAT.limestone : MAT.stone));
    octagon(g, 2, 1, 2, 7, 1, 2, IRON);
    octagon(g, 3, 2, 3, 5, 2, 1, IRON);
    octagon(g, 2, 4, 2, 7, 1, 2, IRON);
    octagon(g, 3, 5, 3, 5, 1, 2, IRON);
    // Rope-polished metal on the lip's sea side.
    g.box(4, 4, 8, 7, 5, 9, MAT.stone);
    neck = 2;
  } else {
    octagon(g, 1, 0, 1, 9, 1, 2, MAT.stone);
    octagon(g, 2, 1, 2, 7, 3, 1, (x, y, z) => (y === 2 && noise(x, z, 2) < 0.35 ? MAT.limestone : MAT.stone));
    octagon(g, 2, 4, 2, 7, 1, 2, IRON);
    octagon(g, 1, 5, 1, 9, 1, 3, MAT.stone);
    octagon(g, 3, 6, 3, 5, 1, 2, MAT.limestone);
    for (const [x, z] of [[1, 3], [1, 4], [2, 2], [7, 1], [8, 2], [9, 6]] as const) g.fill(x, 0, z, MAT.moss);
    neck = 2;
  }
  // The eye: a bight of rope round the waist, pulled tight on the sea side where both legs leave it.
  const ropeY = neck + 1;
  for (const [x, z] of ring(5.5, 5.5, 2.4, 3.6)) g.fill(x, ropeY, z, ROPE);
  for (const [x, z] of ring(5.5, 5.5, 2.4, 3.2)) if (z > 6) g.fill(x, ropeY - 1, z, ROPE);
  // The two legs close into the splice and the line runs off over the quay edge.
  const splice = [5.5, variant === 0 ? 1.5 : 0.5, 11.5] as const;
  g.stroke([4.5, ropeY + 0.5, 8.5], splice, ROPE, 0.75, true);
  g.stroke([6.5, ropeY + 0.5, 8.5], splice, ROPE, 0.75, true);
  if (variant === 0) {
    g.stroke(splice, [5.5, 0.5, 13.5], ROPE, 0.75, true);
    g.box(5, 0, 13, 6, 1, 17, ROPE);
  } else {
    g.box(5, 0, 11, 6, 1, 13, ROPE);
    layCoil((x, y, z, m) => g.fill(x, y, z, m), 5.5, 0, 16, 2.9, 2);
  }
  return { blueprint: g.blueprint(`genesis-aggman-mooring-bollard-${variant}`), lanterns: [], footprint: g.groundFootprint() };
}

/**
 * The quay lamp, 3.25 m to its finial: a coursed granite plinth with a wet dark foot, a cast-iron base, a fluted
 * shaft painted in the livery blue with gold collars, a capital and finial, and an iron arm with a scroll brace
 * reaching out over the quay (+Z). From the arm's end hangs a brass lantern: a stepped brass base and cap, four
 * corner posts and three-by-three glass round the one lantern cell. A ring buoy in livery red and cream hangs on
 * the shaft's east face, and an iron mooring ring hangs from a staple in the plinth's front.
 */
export const HARBOUR_LANTERN = { lantern: [6, 15, 13] as const } as const;

export function createHarbourLantern(livery: Livery): AggmanPiece {
  const g = new Grid(13, 26, 17);
  // Plinth: a dark wet footing course, two courses of granite with a joint between, a chamfered cap.
  octagon(g, 1, 0, 1, 11, 1, 2, MAT.darkStone);
  octagon(g, 2, 1, 2, 9, 2, 1, (x, y, z) => (noise(x >> 1, y, z >> 1, 4) < 0.25 ? MAT.limestone : MAT.stone));
  octagon(g, 3, 3, 3, 7, 1, 1, MAT.stone);
  // Cast-iron base, then the painted shaft with flutes cut at its corners.
  octagon(g, 4, 4, 4, 5, 2, 1, IRON);
  g.box(5, 6, 5, 8, 22, 8, livery.blue);
  for (const [x, z] of [[5, 5], [7, 5], [5, 7], [7, 7]] as const) g.box(x, 7, z, x + 1, 21, z + 1, IRON);
  for (const y of [6, 13, 20]) octagon(g, 4, y, 4, 5, 1, 2, livery.gold);
  // Capital and finial.
  octagon(g, 4, 22, 4, 5, 1, 1, IRON);
  g.box(5, 23, 5, 8, 24, 8, IRON);
  g.box(6, 24, 6, 7, 26, 7, livery.brass);
  // The arm, its brace and the scroll at its end.
  g.box(6, 20, 8, 7, 21, 15, IRON);
  g.box(6, 21, 14, 7, 22, 15, IRON);
  g.stroke([6.5, 15.5, 8.5], [6.5, 19.5, 12.5], IRON, 0.72, true);
  // The lantern, hung from the arm on a ring: cap, square frame, three-high glass round the lantern cell with a
  // brass post at each corner, the frame again, a stepped base and a drip finial.
  const [, ly, lz] = HARBOUR_LANTERN.lantern;
  g.box(6, ly + 4, lz, 7, ly + 5, lz + 1, livery.brass);
  g.box(5, ly + 3, lz - 1, 8, ly + 4, lz + 2, livery.brass);
  g.box(4, ly + 2, lz - 2, 9, ly + 3, lz + 3, livery.brass);
  for (const x of [4, 8]) for (const z of [lz - 2, lz + 2]) g.box(x, ly - 1, z, x + 1, ly + 2, z + 1, livery.brass);
  g.box(5, ly - 1, lz - 1, 8, ly + 2, lz + 2, MAT.glass);
  g.box(4, ly - 2, lz - 2, 9, ly - 1, lz + 3, livery.brass);
  g.box(5, ly - 3, lz - 1, 8, ly - 2, lz + 2, livery.brass);
  g.box(6, ly - 4, lz, 7, ly - 3, lz + 1, livery.brass);
  // Ring buoy on the east face, hung on an iron peg.
  for (const [z, y] of ring(6.5, 11, 1.3, 3)) {
    const quarter = Math.floor((Math.atan2(y + 0.5 - 11, z + 0.5 - 6.5) + Math.PI * 1.25) / (Math.PI / 2)) % 4;
    g.set(8, y, z, quarter % 2 === 0 ? livery.red : livery.cream);
  }
  g.set(8, 14, 6, IRON);
  // Mooring ring on the plinth's front, through an iron staple.
  g.set(6, 2, 11, IRON);
  for (const [x, y] of ring(6.5, 1.2, 0.7, 1.75)) if (y >= 0) g.fill(x, y, 12, IRON);
  return { blueprint: g.blueprint('genesis-aggman-harbour-lantern'), lanterns: [[...HARBOUR_LANTERN.lantern]], footprint: g.groundFootprint() };
}

/**
 * The slipway capstan that hauls the boats up the hard: a stone pad in two octagonal courses, an iron pawl ring
 * with its pawls, a timber barrel of alternating staves with two turns of the hauling rope and four whelps above
 * them, a broad drumhead with eight bar sockets, four bars shipped in them with dark worn grips, and a brass boss.
 * The hauling line leaves the barrel and runs down the slip along +Z. Frame: the barrel's axis at (12, 12).
 */
export function createSlipwayCapstan(): AggmanPiece {
  const g = new Grid(24, 12, 31);
  octagon(g, 4, 0, 4, 16, 1, 4, (x, _y, z) => (noise(x >> 2, z >> 2, 5) < 0.3 ? MAT.limestone : MAT.stone));
  octagon(g, 5, 1, 5, 14, 1, 4, MAT.stone);
  octagon(g, 7, 2, 7, 10, 1, 3, IRON);
  for (const [x, z] of [[7, 11], [16, 12], [11, 7], [12, 16]] as const) g.set(x, 3, z, IRON);
  // The barrel: staves of two tones round an octagon.
  octagon(g, 9, 3, 9, 6, 6, 1, (x, _y, z) => ((x + z) % 2 ? MAT.timber : MAT.bark));
  // Two turns of rope on the barrel.
  for (const y of [4, 5]) for (const [x, z] of ring(12, 12, 3.1, 4.1)) g.fill(x, y, z, ROPE);
  // Whelps above the rope.
  for (const [x0, z0, x1, z1] of [[8, 11, 9, 13], [15, 11, 16, 13], [11, 8, 13, 9], [11, 15, 13, 16]] as const) g.box(x0, 6, z0, x1, 9, z1, MAT.timber);
  // Drumhead with bar sockets, cap and boss.
  octagon(g, 7, 9, 7, 10, 2, 3, MAT.timber);
  for (const [x, z] of [[7, 9], [16, 14], [9, 16], [14, 7]] as const) g.set(x, 9, z, MAT.bark);
  octagon(g, 9, 11, 9, 6, 1, 2, MAT.bark);
  g.box(11, 11, 11, 13, 12, 13, MAT.brass);
  // Four bars shipped, waist high.
  const bars: readonly [number, number, number, number][] = [[0, 11, 7, 13], [17, 11, 24, 13], [11, 0, 13, 7], [11, 17, 13, 24]];
  for (const [x0, z0, x1, z1] of bars) g.box(x0, 9, z0, x1, 10, z1, MAT.timber);
  for (const [x0, z0, x1, z1] of [[0, 11, 2, 13], [22, 11, 24, 13], [11, 0, 13, 2], [11, 22, 13, 24]] as const) g.box(x0, 9, z0, x1, 10, z1, MAT.bark);
  // The hauling line leaves the barrel and runs down the slip.
  g.stroke([12.5, 4.5, 16.5], [12.5, 2.5, 18.5], ROPE, 0.75, true);
  g.stroke([12.5, 2.5, 18.5], [12.5, 0.5, 21.5], ROPE, 0.75, true);
  g.box(12, 0, 21, 13, 1, 31, ROPE);
  layCoil((x, y, z, m) => g.fill(x, y, z, m), 18.5, 0, 26.5, 2.4, 0);
  return { blueprint: g.blueprint('genesis-aggman-slipway-capstan'), lanterns: [], footprint: g.groundFootprint() };
}
