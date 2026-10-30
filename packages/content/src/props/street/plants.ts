import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '../../materials';
import type { StreetStyle } from './edges';

type Box = VoxelBlueprint['boxes'][number];
type Kit = (typeof STYLES)[StreetStyle];
type Vec = readonly [number, number, number];
type Region = { x?: readonly [number, number]; y?: readonly [number, number]; z?: readonly [number, number] };

/** Each kit's single flower accent: heather pink by the hearth, sea blue by the tide. */
const BLOOM: Record<StreetStyle, number> = { hearth: MAT.petal, tide: MAT.blueFlower };
const bloomOf = (kit: Kit) => BLOOM[kit.id as StreetStyle];

const put = (boxes: Box[], x: number, y: number, z: number, X: number, Y: number, Z: number, material: number) => {
  if (x < X && y < Y && z < Z) boxes.push({ from: [x, y, z], to: [X, Y, Z], material });
};

/** A footprint with its four vertical edges chamfered by one cell: the soft square every container uses. */
function softSquare(boxes: Box[], x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, material: number) {
  put(boxes, x0, y0, z0 + 1, x1, y1, z1 - 1, material);
  put(boxes, x0 + 1, y0, z0, x1 - 1, y1, z0 + 1, material);
  put(boxes, x0 + 1, y0, z1 - 1, x1 - 1, y1, z1, material);
}

/**
 * A rounded mass as stepped courses one cell high. Each course is a disc of rows along X; rows of equal extent
 * merge into one box, so a mass costs a few dozen boxes. `power` 2 is an ellipsoid; higher powers flatten the
 * faces and keep the shoulders round. `rise` sets the vertical exponent apart from the plan: a high rise keeps
 * the sides upright and turns the shoulder over in a few short steps, so stone reads as a weathered boulder
 * rather than a stack of terraces. `lean`
 * shifts each course along X by that many cells per course above the centre, an authored tilt rather than
 * noise. `keep` limits the cells written, so moss can follow the same curved surface as the stone beneath it.
 */
function rounded(boxes: Box[], [cx, cy, cz]: Vec, [rx, ry, rz]: Vec, material: number, size: Vec, { power = 2, rise = power, lean = 0, keep = {} as Region }: { power?: number; rise?: number; lean?: number; keep?: Region } = {}) {
  const [kx0, kx1] = keep.x ?? [0, size[0]], [ky0, ky1] = keep.y ?? [0, size[1]], [kz0, kz1] = keep.z ?? [0, size[2]];
  for (let y = Math.max(0, ky0, Math.floor(cy - ry)); y < Math.min(size[1], ky1, Math.ceil(cy + ry)); y++) {
    const course = 1 - Math.abs((y + 0.5 - cy) / ry) ** rise, shift = lean * (y + 0.5 - cy);
    if (course <= 0) continue;
    let run: { x0: number; x1: number; z0: number; z1: number } | undefined;
    const flush = () => { if (run) put(boxes, run.x0, y, run.z0, run.x1, y + 1, run.z1, material); run = undefined; };
    for (let z = Math.max(0, kz0, Math.floor(cz - rz)); z < Math.min(size[2], kz1, Math.ceil(cz + rz)); z++) {
      const row = course - Math.abs((z + 0.5 - cz) / rz) ** power;
      const half = row > 0 ? rx * row ** (1 / power) : 0;
      const x0 = Math.max(0, kx0, Math.round(cx + shift - half)), x1 = Math.min(size[0], kx1, Math.round(cx + shift + half));
      if (x1 <= x0) { flush(); continue; }
      if (run && run.x0 === x0 && run.x1 === x1 && run.z1 === z) run.z1 = z + 1;
      else { flush(); run = { x0, x1, z0: z, z1: z + 1 }; }
    }
    flush();
  }
}

/**
 * Overlapping masses can author the same box twice. Only the last copy matters (it rewrites the same cells with
 * the same material), so earlier copies are dropped and the final occupancy is unchanged.
 */
function settle(boxes: Box[]): Box[] {
  const seen = new Set<string>();
  return boxes.reverse().filter(box => { const k = JSON.stringify(box); if (seen.has(k)) return false; seen.add(k); return true; }).reverse();
}

/** The highest solid cell in one column after the ordered boxes so far, and its material. */
function topOf(boxes: readonly Box[], x: number, z: number): { y: number; material: number } {
  const column: number[] = [];
  for (const { from, to, material } of boxes) {
    if (x < from[0] || x >= to[0] || z < from[2] || z >= to[2]) continue;
    for (let y = from[1]; y < to[1]; y++) column[y] = material;
  }
  for (let y = column.length - 1; y >= 0; y--) if (column[y] !== undefined && column[y] !== MAT.air) return { y, material: column[y]! };
  return { y: -1, material: MAT.air };
}

/**
 * A flower head that sits in the foliage rather than on a stalk: the top leaf of each listed column turns to
 * blossom. With `crown`, the first column carries one more blossom above, so a larger head has a top.
 */
function blossom(boxes: Box[], material: number, size: Vec, columns: readonly (readonly [number, number])[], crown = true) {
  const tops = columns.map(([x, z]) => ({ x, z, ...topOf(boxes, x, z) }));
  tops.forEach(({ x, y, z, material: top }, i) => {
    if (top !== MAT.leaf) throw new Error(`A blossom at ${x},${z} has no foliage to sit in.`);
    put(boxes, x, y, z, x + 1, Math.min(size[1], y + (crown && i === 0 ? 2 : 1)), z + 1, material);
  });
}

/**
 * A chunky garden pot, one metre across. A chamfered foot, a shadow groove at the waist, a plain belly and a
 * two-course lip that oversails it all round, so the rim reads at any distance. Earth sits one cell below the
 * lip. The plant is a mound of leafy clumps set to the back left, so earth shows at the front, and one cluster
 * of the kit's flower sits in its sunny front shoulder.
 */
export function flowerPot(kit: Kit): Box[] {
  const boxes: Box[] = [], size: Vec = [8, 12, 8];
  softSquare(boxes, 1, 1, 7, 7, 0, 1, kit.stone);
  put(boxes, 2, 1, 2, 6, 2, 6, kit.stone);
  softSquare(boxes, 1, 1, 7, 7, 2, 5, kit.stone);
  softSquare(boxes, 0, 0, 8, 8, 5, 7, kit.stone);
  softSquare(boxes, 1, 1, 7, 7, 5, 6, MAT.earth);
  softSquare(boxes, 1, 1, 7, 7, 6, 7, MAT.air);
  const inside: Region = { x: [1, 7], y: [6, 12], z: [1, 7] };
  for (const [centre, radii] of [
    [[3.2, 6.4, 3.4], [2.6, 3, 2.4]], [[5.2, 6.6, 3], [1.9, 2.4, 1.9]], [[3, 6.4, 5.4], [1.9, 2.2, 1.6]], [[4.2, 8.6, 3.8], [2, 2.6, 2]],
  ] as const) rounded(boxes, centre, radii, MAT.leaf, size, { keep: inside, power: 2.2 });
  blossom(boxes, bloomOf(kit), size, [[4, 5], [5, 4], [3, 5], [4, 4]]);
  return settle(boxes);
}

/**
 * A long stone trough in the pot's craft: a foot course, the same shadow groove, a plain body and a lip that
 * oversails it on every side. Three plants of different heights fill it; their foliage stops one cell short of
 * both ends, so troughs stand end to end or against a wall with clean ends. One trailing stem spills over the
 * front lip and hangs in the shadow beneath it.
 */
export function flowerTrough(kit: Kit): Box[] {
  const boxes: Box[] = [], size: Vec = [16, 10, 6];
  softSquare(boxes, 1, 1, 15, 5, 0, 1, kit.stone);
  put(boxes, 2, 1, 2, 14, 2, 4, kit.stone);
  softSquare(boxes, 1, 1, 15, 5, 2, 4, kit.stone);
  softSquare(boxes, 0, 0, 16, 6, 4, 6, kit.stone);
  softSquare(boxes, 1, 1, 15, 5, 4, 5, MAT.earth);
  softSquare(boxes, 1, 1, 15, 5, 5, 6, MAT.air);
  const inside: Region = { x: [1, 15], y: [5, 10], z: [1, 5] };
  for (const [centre, radii] of [
    [[3.6, 5.4, 2.6], [2.6, 3.6, 1.9]], [[5.4, 5.2, 3.4], [1.8, 2.4, 1.6]], [[8.8, 5.2, 2.8], [2.2, 2, 1.8]],
    [[12, 5.4, 2.6], [2.4, 3, 1.9]], [[13, 5.2, 3.6], [1.6, 2, 1.4]],
  ] as const) rounded(boxes, centre, radii, MAT.leaf, size, { keep: inside, power: 2.2 });
  blossom(boxes, bloomOf(kit), size, [[4, 3], [3, 3], [4, 4]], false);
  blossom(boxes, bloomOf(kit), size, [[12, 3], [13, 3], [12, 4]], false);
  // A trailing stem over the front lip, hanging in the lip's shadow.
  put(boxes, 9, 6, 5, 11, 7, 6, MAT.leaf);
  put(boxes, 10, 2, 5, 11, 4, 6, MAT.leaf);
  put(boxes, 9, 3, 5, 10, 4, 6, MAT.leaf);
  return settle(boxes);
}

/**
 * Three weathered stones settled into the ground at their widest. Their faces are broad and their shoulders
 * round. The dominant stone leans a little toward its smaller neighbour; the third is nearly buried. Moss
 * holds the shaded back of the big stone and the joints where the stones meet.
 */
export function rockCluster(kit: Kit): Box[] {
  const boxes: Box[] = [], size: Vec = [12, 7, 10];
  const big = [[5, 0, 4.6], [4.7, 7, 4.2]] as const, bigShape = { power: 2.4, rise: 3.4, lean: 0.12 };
  rounded(boxes, ...big, kit.stone, size, bigShape);
  rounded(boxes, [9.5, 0, 6.8], [2.6, 4.2, 2.9], kit.stone, size, { power: 2.4, rise: 3.4 });
  rounded(boxes, [2.4, 0, 8.4], [2.4, 2.4, 1.7], kit.stone, size, { power: 2.4, rise: 2.6 });
  rounded(boxes, ...big, MAT.moss, size, { ...bigShape, keep: { y: [4, 7], z: [0, 3] } });
  put(boxes, 7, 0, 5, 8, 1, 8, MAT.moss);
  put(boxes, 3, 0, 7, 5, 1, 8, MAT.moss);
  return settle(boxes);
}

/**
 * A garden shrub on a short visible stem: three root flares, a trunk that forks into the canopy and a crown of
 * overlapping leafy clumps, lumpy at the edge, higher at the back and open enough underneath to show the stem.
 * Three flower heads of the kit's colour sit in its front and sunlit shoulders.
 */
export function leafyShrub(kit: Kit): Box[] {
  const boxes: Box[] = [], size: Vec = [12, 12, 12];
  put(boxes, 5, 0, 5, 7, 4, 7, MAT.bark);
  put(boxes, 3, 0, 5, 5, 1, 7, MAT.bark);
  put(boxes, 7, 0, 6, 9, 1, 7, MAT.bark);
  put(boxes, 5, 0, 7, 6, 1, 9, MAT.bark);
  put(boxes, 4, 3, 6, 5, 5, 7, MAT.bark);
  put(boxes, 7, 3, 5, 8, 6, 6, MAT.bark);
  for (const [centre, radii] of [
    [[6, 6.8, 6], [4.2, 3, 4.2]],
    [[2.9, 5.6, 5], [2.9, 2.5, 2.8]], [[8.9, 6, 4.4], [3.1, 2.6, 2.9]], [[6.4, 5.4, 9], [3, 2.4, 2.6]], [[3.6, 6, 8.6], [2.4, 2.2, 2.3]],
    [[5.6, 7.4, 2.8], [2.9, 2.6, 2.6]], [[9, 6.2, 8.2], [2.6, 2.4, 2.6]],
    [[4.4, 9, 5.4], [2.8, 2.4, 2.8]], [[8, 9.4, 5.6], [2.6, 2.4, 2.6]], [[6.2, 9, 8], [2.5, 2.2, 2.4]], [[6, 10.4, 5], [2.2, 1.6, 2.2]],
  ] as const) rounded(boxes, centre, radii, MAT.leaf, size, { power: 2.2 });
  const bloom = bloomOf(kit);
  blossom(boxes, bloom, size, [[3, 9], [2, 9], [3, 10]]);
  blossom(boxes, bloom, size, [[9, 9], [10, 9], [9, 10]]);
  blossom(boxes, bloom, size, [[7, 7], [8, 7], [7, 8]]);
  return settle(boxes);
}
