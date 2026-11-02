import { Sculpt, loft, fishModel, type FishModel } from './model';
import { MAT } from '../materials';

type Span = readonly [y0: number, y1: number, half: number];

/** Lofts one section per entry, starting at `z0` and walking toward the nose. */
function body(s: Sculpt, cx: number, z0: number, spans: readonly Span[], material: number): Sculpt {
  spans.forEach(([y0, y1, half], i) => loft(s, cx, [{ z: z0 + i, y0, y1, half }], material));
  return s;
}

/** Paints a mirrored pair on the outermost flank cells of row (y, z), so eyes always sit on the surface. */
function pair(s: Sculpt, y: number, z: number, material: number): Sculpt {
  let lo = -1, hi = -1;
  for (let x = 0; x < s.sx; x++) if (s.get(x, y, z)) { if (lo < 0) lo = x; hi = x; }
  if (lo < 0 || lo === hi) throw new Error(`No flank pair at y ${y}, z ${z}.`);
  return s.set(lo, y, z, material).set(hi, y, z, material);
}

/** Deep, wedge-headed rudd: a straight bronze back that runs out to an upturned jaw, a big golden eye and blood-red fins. */
export function createGlimmerRudd(): FishModel {
  const s = new Sculpt(7, 13, 16);
  body(s, 3.5, 3, [
    [5, 7, 1], [4, 8, 1], [3, 9, 2], [2, 10, 2], [1, 10, 2], [1, 10, 2],
    [1, 10, 2], [1, 10, 2], [2, 10, 2], [3, 10, 2], [4, 10, 2], [5, 9, 1],
  ], MAT.goldLeaf);
  // The lower jaw juts up and forward past the sloping forehead.
  s.box(2, 7, 15, 5, 9, 16, MAT.hairGold).set(3, 9, 15, MAT.hairGold);
  s.paint((_x, y, z, m) => y >= 10 ? MAT.fabricMutedGold : (y >= 8 || (z >= 11 && y >= 6)) && z < 15 ? MAT.brass : y <= 2 ? MAT.cream : z >= 12 && y <= 5 ? MAT.hairGold : y <= 4 ? MAT.fabricGold : m);
  pair(s, 8, 14, MAT.bark);
  // Large forked tail, a dorsal set far back over the anal fin, paired pelvics and pectorals: all blood red.
  s.box(3, 4, 2, 4, 9, 3, MAT.fabricRed)
    .box(3, 3, 1, 4, 6, 2, MAT.fabricRed).box(3, 7, 1, 4, 10, 2, MAT.fabricRed)
    .box(3, 2, 0, 4, 5, 1, MAT.fabricRed).box(3, 8, 0, 4, 11, 1, MAT.fabricRed);
  s.box(3, 11, 6, 4, 12, 9, MAT.fabricRed).box(3, 12, 6, 4, 13, 8, MAT.fabricRed);
  s.box(3, 0, 5, 4, 2, 7, MAT.fabricRed).set(3, 0, 7, MAT.fabricRed);
  s.box(2, 0, 9, 3, 1, 11, MAT.fabricRed).box(4, 0, 9, 5, 1, 11, MAT.fabricRed);
  s.box(0, 3, 10, 1, 4, 12, MAT.fabricRed).box(6, 3, 10, 7, 4, 12, MAT.fabricRed);
  // Big golden eye: a ring around a dark pupil on each cheek.
  for (const [y, z] of [[8, 12], [6, 12], [7, 11], [7, 13]] as const) pair(s, y, z, MAT.hairGold);
  pair(s, 7, 12, MAT.hairBlack);
  return fishModel('fish:glimmer-rudd', s, [3.5, 9.5, 16], [3.5, 6.5, 3]);
}

const SPECKLES = new Set(['2,4', '1,6', '4,5', '3,7', '5,7', '2,9', '4,9', '1,8', '5,10']);

/** A tiny flat-bellied bottom fish: big low head, two hanging barbels, flat side fins and a speckled sandy back. */
export function createThimbleGudgeon(): FishModel {
  const s = new Sculpt(7, 8, 13);
  body(s, 3.5, 3, [
    [2, 4, 1], [1, 4, 1], [1, 5, 2], [0, 5, 2], [0, 5, 2], [0, 5, 2], [1, 5, 2], [1, 4, 2],
  ], MAT.limestone);
  s.box(2, 2, 11, 5, 4, 12, MAT.limestone);
  s.paint((x, y, z, m) => {
    if (y <= 1) return MAT.cream;
    if (y >= 4) return SPECKLES.has(`${x},${z}`) ? MAT.hairBrown : MAT.thatch;
    if (y === 3 && (z === 4 || z === 6 || z === 8)) return MAT.hairBrown;
    return m;
  });
  // Small forked tail, one stubby dorsal and flat pectorals spread like feet.
  s.box(3, 2, 2, 4, 4, 3, MAT.earth)
    .box(3, 1, 1, 4, 3, 2, MAT.earth).box(3, 3, 1, 4, 5, 2, MAT.earth)
    .box(3, 0, 0, 4, 2, 1, MAT.earth).box(3, 4, 0, 4, 6, 1, MAT.earth);
  s.box(3, 6, 6, 4, 7, 8, MAT.earth).set(3, 7, 6, MAT.earth);
  s.box(0, 1, 8, 1, 2, 10, MAT.thatch).box(6, 1, 8, 7, 2, 10, MAT.thatch);
  // Two barbels hang from the corners of the mouth and curl forward under the snout.
  for (const x of [2, 4]) s.set(x, 1, 11, MAT.earth).set(x, 1, 12, MAT.earth).set(x, 0, 12, MAT.earth);
  pair(s, 3, 10, MAT.hairBlack);
  return fishModel('fish:thimble-gudgeon', s, [3.5, 2, 12], [3.5, 3, 2]);
}

/** A thick olive log of a fish: blunt head, rounded paddle fins and a square tail on a heavy wrist. */
export function createWillowTench(): FishModel {
  const s = new Sculpt(11, 13, 18);
  body(s, 5.5, 3, [
    [4, 8, 1], [4, 8, 2], [3, 9, 2], [3, 9, 3], [2, 10, 3], [2, 10, 3], [2, 10, 3],
    [2, 10, 3], [2, 10, 3], [2, 10, 3], [3, 10, 3], [3, 9, 2], [4, 9, 2], [4, 8, 2], [5, 7, 1],
  ], MAT.moss);
  s.paint((_x, y, _z, m) => y >= 9 ? MAT.leaf : y <= 3 ? MAT.fabricMutedGold : m);
  // Thick wrist into a square paddle tail.
  s.box(4, 4, 2, 7, 9, 3, MAT.fabricMutedGreen)
    .box(5, 2, 1, 6, 11, 2, MAT.fabricMutedGreen).box(5, 2, 0, 6, 11, 1, MAT.fabricMutedGreen);
  // Rounded dorsal and anal fins, big rounded pelvics and flat pectoral paddles.
  s.box(5, 11, 8, 6, 12, 12, MAT.fabricMutedGreen).box(5, 12, 9, 6, 13, 11, MAT.fabricMutedGreen);
  s.box(5, 1, 5, 6, 3, 7, MAT.fabricMutedGreen).box(5, 0, 6, 6, 2, 8, MAT.fabricMutedGreen);
  s.box(2, 1, 9, 4, 2, 12, MAT.fabricMutedGreen).box(1, 1, 9, 2, 2, 11, MAT.fabricMutedGreen)
    .box(7, 1, 9, 9, 2, 12, MAT.fabricMutedGreen).box(9, 1, 9, 10, 2, 11, MAT.fabricMutedGreen);
  s.box(1, 4, 12, 2, 5, 15, MAT.fabricMutedGreen).box(0, 4, 12, 1, 5, 14, MAT.fabricMutedGreen)
    .box(9, 4, 12, 10, 5, 15, MAT.fabricMutedGreen).box(10, 4, 12, 11, 5, 14, MAT.fabricMutedGreen);
  // Small red eye with a dark pupil; dark lips on the blunt mouth.
  pair(s, 7, 16, MAT.fabricRed);
  pair(s, 7, 15, MAT.hairBlack);
  s.box(4, 5, 17, 7, 6, 18, MAT.bark);
  return fishModel('fish:willow-tench', s, [5.5, 5.5, 18], [5.5, 6.5, 3]);
}

/** A three-cell-wide sliver of silver: pointed upturned head, a long low anal fin and a deep V of a tail. */
export function createStarlitBleak(): FishModel {
  const s = new Sculpt(5, 9, 14);
  body(s, 2.5, 5, [
    [3, 5, 1], [3, 6, 1], [2, 6, 1], [2, 6, 1], [2, 6, 1], [3, 6, 1], [3, 6, 1], [4, 5, 1],
  ], MAT.hairSilver);
  s.set(2, 5, 13, MAT.hairSilver);
  s.paint((_x, y, _z, m) => y >= 6 ? MAT.blueFlower : y <= 2 ? MAT.cream : m);
  // Deeply forked tail on a fine wrist.
  s.box(2, 4, 3, 3, 6, 5, MAT.blueFlower).box(2, 3, 2, 3, 7, 3, MAT.blueFlower)
    .box(2, 2, 1, 3, 4, 2, MAT.blueFlower).box(2, 6, 1, 3, 8, 2, MAT.blueFlower)
    .box(2, 1, 0, 3, 3, 1, MAT.hairSilver).box(2, 7, 0, 3, 9, 1, MAT.hairSilver);
  s.box(2, 7, 8, 3, 8, 10, MAT.blueFlower);
  s.box(2, 1, 5, 3, 2, 9, MAT.blueFlower).box(2, 0, 7, 3, 1, 9, MAT.blueFlower);
  pair(s, 5, 11, MAT.hairBlack);
  return fishModel('fish:starlit-bleak', s, [2.5, 5.5, 14], [2.5, 5, 3]);
}
