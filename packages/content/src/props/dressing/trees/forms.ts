import { MAT } from '../../../materials';
import { grow, type Grower, type Piece, type Point } from './grammar';

const { leaf, moss, goldLeaf, grass, bark, thatch, cream, darkStone, stone, terracotta, earth } = MAT;

/** A tapered skirt of a conifer: its top rises to a point, its rim droops below the whorl it hangs from. */
function skirt(t: Grower, c: Point, rx: number, rz: number, height: number, droop: number, material: number = leaf) {
  const g = 2;
  for (let bz = Math.floor((c[2] - rz) / g) * g; bz < c[2] + rz; bz += g)
    for (let bx = Math.floor((c[0] - rx) / g) * g; bx < c[0] + rx; bx += g) {
      const r = Math.hypot((bx + 1 - c[0]) / rx, (bz + 1 - c[2]) / rz);
      if (r > 1) continue;
      const top = c[1] + height * (1 - r), bottom = c[1] - droop * r - 1;
      for (let by = Math.max(0, Math.floor(bottom / g) * g); by + 1 < top; by += g)
        for (let z = bz; z < bz + g; z++) for (let y = by; y < by + g; y++) for (let x = bx; x < bx + g; x++)
          if (t.get(x, y, z) === 0) t.set(x, y, z, material);
    }
}

/** The x and z of a bough's axis at height y, read from its authored points. */
function axisAt(points: readonly Point[], y: number): [number, number] {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    if (y <= b[1] || i === points.length - 1) {
      const f = Math.max(0, Math.min(1, (y - a[1]) / (b[1] - a[1] || 1)));
      return [a[0] + (b[0] - a[0]) * f, a[2] + (b[2] - a[2]) * f];
    }
  }
  return [points[0]![0], points[0]![2]];
}

/** Old roots carry moss on their upper faces where they leave the trunk and run into the turf. */
const mossyRoots = (t: Grower, height: number) => t.overgrow(bark, moss, 0, height);

/**
 * Old oak A: a broad, lived-in oak. A short thick bole leans a little, then forks low into five limbs: a long low
 * limb reaching out to the left under its own cloud, a heavy limb to the right, a crooked leader and two lighter
 * limbs to front and back. Each ends in a rounded cloud of leaves, the clouds fuse into one crown, and the dark
 * gaps between them show the limbs that hold them.
 */
export function oakOldA(): Piece {
  const t = grow([96, 112, 96], 4);
  t.bough([[48, 0, 48], [47, 12, 49], [49, 22, 47]], 7, 5.6);
  t.flare(48, 48, 9, [[0.02, 17, 3.6], [0.23, 14, 3.2], [0.41, 18, 3.8], [0.6, 13, 3], [0.8, 16, 3.4]]);
  t.bough([[49, 20, 47], [38, 28, 45], [27, 36, 43], [21, 44, 44]], 4, 1.6);
  t.bough([[49, 22, 47], [60, 32, 52], [70, 42, 56], [75, 50, 55]], 4.4, 1.6);
  t.bough([[49, 22, 47], [50, 40, 46], [52, 58, 44], [53, 76, 47]], 4.6, 1.6);
  t.bough([[49, 24, 48], [45, 36, 58], [41, 46, 68]], 3.4, 1.4);
  t.bough([[50, 28, 46], [57, 40, 36], [62, 50, 29]], 3.2, 1.3);
  t.cloud([50, 66, 48], [31, 24, 28], 6, 0.15, leaf, 0.55);
  t.cloud([23, 52, 45], [16, 14, 15], 3, 0.1);
  t.cloud([75, 56, 55], [16, 15, 16], 3, 0.4);
  t.cloud([54, 86, 44], [19, 13, 17], 4, 0.65);
  t.cloud([41, 56, 70], [16, 14, 14], 3, 0.8);
  t.cloud([62, 60, 28], [16, 14, 13], 3, 0.3);
  t.light(leaf, moss, 40);
  mossyRoots(t, 8);
  return t.piece();
}

/**
 * Old oak B: a twin-stemmed oak grown wider than it is tall. The bole leans to the left and splits low; one stem
 * sweeps out over the meadow, the other climbs, and long side limbs carry flatter clouds far out to the right,
 * the front and the back, so its crown is a broad, uneven roof.
 */
export function oakOldB(): Piece {
  const t = grow([96, 112, 96], 4);
  t.bough([[52, 0, 46], [50, 10, 47], [46, 16, 48]], 7.4, 5.8);
  t.flare(51, 46, 8, [[0.08, 16, 3.6], [0.3, 18, 3.8], [0.5, 14, 3.2], [0.68, 17, 3.6], [0.88, 13, 3]]);
  t.bough([[46, 16, 48], [36, 28, 46], [27, 40, 44], [22, 50, 45]], 4.8, 2);
  t.bough([[46, 16, 48], [54, 30, 50], [60, 46, 52], [63, 60, 50]], 4.6, 1.8);
  t.bough([[54, 30, 50], [68, 38, 57], [79, 44, 60]], 3.2, 1.2);
  t.bough([[36, 28, 46], [31, 36, 62], [29, 44, 72]], 3, 1.2);
  t.bough([[60, 46, 52], [65, 52, 36], [67, 56, 27]], 2.8, 1.2);
  t.bough([[27, 40, 44], [21, 46, 33], [19, 48, 29]], 2.6, 1.1);
  t.cloud([46, 66, 48], [34, 20, 30], 7, 0.25, leaf, 0.5);
  t.cloud([22, 54, 45], [17, 13, 16], 4, 0.05);
  t.cloud([77, 50, 60], [15, 12, 14], 3, 0.7);
  t.cloud([30, 50, 73], [15, 12, 13], 3, 0.15);
  t.cloud([67, 58, 27], [15, 12, 13], 3, 0.55);
  t.cloud([19, 50, 29], [12, 10, 11], 2, 0.9);
  t.cloud([56, 80, 52], [18, 11, 16], 4, 0.4);
  t.light(leaf, moss, 36);
  mossyRoots(t, 8);
  return t.piece();
}

/**
 * Beech: a smooth grey bole on an elephant-foot flare, clean to eight metres, its limbs sweeping steeply up into
 * one high dome. The forest wall's fifth variant, it reads paler and taller than the oaks around it.
 */
export function beech(): Piece {
  const t = grow([96, 112, 96], 4);
  t.bough([[48, 0, 48], [48, 18, 48], [49, 34, 47]], 6, 4.4, stone);
  t.flare(48, 48, 7, [[0.1, 12, 3.6], [0.35, 11, 3.4], [0.55, 13, 3.8], [0.8, 11, 3.2]], stone);
  t.bough([[49, 34, 47], [40, 48, 44], [30, 60, 42]], 3.4, 1.4, stone);
  t.bough([[49, 34, 47], [58, 50, 50], [67, 62, 53]], 3.4, 1.4, stone);
  t.bough([[49, 34, 47], [50, 54, 56], [48, 72, 60]], 3.2, 1.3, stone);
  t.bough([[49, 36, 47], [52, 56, 40], [55, 78, 38]], 3.2, 1.3, stone);
  t.cloud([48, 72, 48], [32, 28, 30], 6, 0.1, leaf, 0.55);
  t.cloud([27, 56, 42], [14, 12, 13], 2, 0.3);
  t.cloud([70, 58, 54], [14, 12, 13], 2, 0.8);
  t.cloud([48, 54, 72], [12, 10, 11], 2, 0.55);
  t.light(leaf, moss, 60);
  return t.piece();
}

/**
 * The root seat of the elder oak, in build cells at the blueprint's origin, in the content seat shape
 * (`ContentSeatSchema`): `position` is the middle of the worn seat top, `approach` the standing spot in front of
 * it, `rest` the seated feet, and `facing` 0 faces +Z, toward the meadow the tree overlooks. Places-high binds it
 * as the forest's oak seat, turned with the tree's landmark yaw.
 */
export const ELDER_OAK_SEAT = { id: 'root-seat', position: [64, 4, 68], approach: [64, 0, 80], rest: [64, 0, 72], facing: 0 } as const;

/** The seat's worn top, in cells: x and z ranges at course 3. */
const SEAT = { x: [56, 72], z: [62, 71], top: 4 } as const;

/**
 * The elder oak: the kingdom's eighteen-metre landmark at the forest edge. A massive crooked bole stands on a
 * plate of buttress roots. Two roots curl forward as the arms of a root seat whose top has been worn pale by
 * people sitting, with the bole as its back. A few marks are cut into the bark above it, too old to read. One great
 * limb runs out almost level to the west under its own clouds; the rest climb crookedly into a high, broken crown.
 */
export function elderOak(): Piece {
  const t = grow([128, 144, 128], 4);
  t.bough([[64, 0, 58], [63, 12, 59], [66, 28, 57], [62, 42, 60], [64, 50, 58]], 10, 7);
  // Buttress roots everywhere but the front, where the seat is.
  t.flare(64, 58, 12, [[0.0, 26, 4.6], [0.07, 22, 4], [0.45, 27, 4.8], [0.57, 21, 4.2], [0.7, 25, 4.6], [0.84, 23, 4.2], [0.94, 20, 3.8]]);
  // The seat's arms: two roots curling forward from the bole.
  t.root([55, 11, 64], [50, 75], 3.8, 1.4);
  t.root([73, 11, 64], [78, 75], 3.8, 1.4);
  // The seat itself: a root lying across the front of the bole, its front corners rounded off.
  for (let x = SEAT.x[0]; x < SEAT.x[1]; x++) for (let z = 58; z < SEAT.z[1] + 1; z++) for (let y = 0; y < SEAT.top; y++) {
    const corner = (x < SEAT.x[0] + 2 || x >= SEAT.x[1] - 2) && z >= SEAT.z[1] - 1;
    if (!corner && t.get(x, y, z) === 0) t.set(x, y, z, bark);
  }
  // Limbs: the great level limb west, then the crooked climb.
  const great: Point[] = [[62, 40, 60], [46, 46, 62], [28, 50, 58], [16, 55, 54]];
  t.bough(great, 5.5, 2);
  t.bough([[64, 48, 58], [76, 62, 62], [90, 74, 66], [99, 84, 62]], 5, 1.8);
  t.bough([[64, 50, 58], [60, 70, 54], [66, 92, 58], [62, 118, 56]], 5, 1.8);
  t.bough([[64, 46, 56], [70, 60, 42], [74, 74, 30], [72, 88, 24]], 4.2, 1.6);
  t.bough([[63, 44, 62], [52, 60, 74], [43, 76, 88]], 4, 1.5);
  t.bough([[76, 62, 62], [92, 64, 84], [99, 70, 93]], 3, 1.2);
  t.bough([[62, 80, 56], [72, 96, 64], [80, 106, 70]], 3.2, 1.4);
  t.bough([[61, 74, 55], [52, 90, 48], [46, 98, 44]], 3.2, 1.4);
  t.bough([[36, 49, 61], [36, 54, 61]], 2.4, 1.6);
  t.cloud([66, 100, 58], [40, 28, 36], 6, 0.2, leaf, 0.55);
  t.cloud([60, 124, 54], [24, 14, 22], 4, 0.6);
  t.cloud([18, 64, 54], [14, 12, 13], 3, 0.1);
  t.cloud([38, 64, 62], [12, 10, 12], 2, 0.6);
  t.cloud([100, 86, 64], [18, 16, 17], 3, 0.3);
  t.cloud([46, 82, 90], [18, 15, 16], 3, 0.05);
  t.cloud([76, 88, 24], [18, 15, 15], 3, 0.8);
  t.cloud([98, 76, 96], [14, 12, 13], 3, 0.4);
  t.light(leaf, moss, 50);
  mossyRoots(t, 14);
  // Moss along the top of the great limb, where rain sits.
  t.overgrow(bark, moss, 40, 60, x => x < 50);
  // The worn seat top, pale where people sit, and the marks cut in the bark above it.
  for (let x = SEAT.x[0] + 1; x < SEAT.x[1] - 1; x++) for (let z = SEAT.z[0]; z < SEAT.z[1]; z++)
    if (t.get(x, SEAT.top - 1, z) !== 0 && t.get(x, SEAT.top, z) === 0) t.set(x, SEAT.top - 1, z, thatch);
  const MARKS = [
    // A small heart, two initials' worth of tally strokes and a star, weathered, no letters.
    { x: 58, y: 13, rows: ['.#.#.', '#####', '.###.', '..#..'] },
    { x: 66, y: 15, rows: ['#.#.#', '#.#.#', '#.#.#'] },
    { x: 62, y: 21, rows: ['.#.', '###', '.#.'] },
  ];
  for (const mark of MARKS) mark.rows.forEach((row, r) => [...row].forEach((c, i) => {
    if (c !== '#') return;
    const x = mark.x + i, y = mark.y + mark.rows.length - 1 - r;
    for (let z = 127; z > 0; z--) if (t.get(x, y, z) === bark && t.get(x, y, z + 1) === 0) { t.set(x, y, z, thatch); break; }
  }));
  return t.piece();
}

/**
 * Wind-bent pine: a pine that grew on an exposed rim. Its roots grip the ground on the windward side, and its
 * trunk bows away from the wind toward local +X, red-barked above, carrying flat pads of needles that stream the
 * same way.
 */
export function pineWindbent(): Piece {
  const t = grow([72, 88, 72]);
  // The upper trunk's warm bark first, so the grey lower trunk does not overwrite it where they meet.
  t.bough([[30, 40, 36], [46, 58, 35], [56, 66, 36]], 2.6, 1.6, terracotta);
  t.bough([[18, 0, 36], [19, 14, 36], [24, 30, 37], [34, 46, 36]], 3.8, 2.6);
  t.flare(18, 36, 6, [[0.05, 13, 2.4], [0.3, 9, 2], [0.5, 12, 2.4], [0.72, 10, 2], [0.9, 12, 2.2]]);
  t.root([15, 6, 36], [4, 34], 2.4, 1.2);
  t.root([16, 5, 38], [6, 46], 2, 1.1);
  t.bough([[24, 30, 37], [30, 38, 46], [38, 45, 50]], 1.8, 1.1, terracotta);
  t.bough([[34, 46, 36], [40, 51, 27], [47, 56, 23]], 1.6, 1, terracotta);
  t.bough([[46, 58, 35], [53, 60, 43], [59, 64, 47]], 1.6, 1, terracotta);
  t.bough([[40, 52, 36], [31, 58, 33], [27, 63, 31]], 1.4, 1, terracotta);
  t.bough([[50, 62, 36], [48, 70, 38], [45, 77, 38]], 1.4, 1, terracotta);
  t.cloud([53, 70, 36], [14, 7, 13], 3, 0.1, leaf, 0.5);
  t.cloud([38, 45, 50], [11, 6, 10], 2, 0.3, leaf, 0.5);
  t.cloud([47, 56, 23], [11, 6, 10], 2, 0.6, leaf, 0.5);
  t.cloud([59, 64, 47], [9, 5, 9], 2, 0.85, leaf, 0.5);
  t.cloud([27, 63, 31], [8, 5, 8], 1, 0.2, leaf, 0.5);
  t.cloud([45, 77, 38], [11, 6, 10], 2, 0.45, leaf, 0.5);
  t.light(leaf, moss, 30);
  return t.piece();
}

/** Fir: a straight dark spire in whorled skirts, broad and drooping below, tightening to a narrow tip. */
export function fir(): Piece {
  const t = grow([56, 96, 56]);
  t.bough([[28, 0, 28], [28, 40, 28], [28, 86, 28]], 3.2, 1.1);
  t.flare(28, 28, 4, [[0.1, 7, 1.8], [0.43, 6, 1.6], [0.75, 7, 1.8]]);
  const TIERS: readonly (readonly [y: number, r: number, h: number, droop: number])[] = [
    [14, 22, 16, 6], [25, 20, 15, 6], [36, 17, 14, 5], [47, 14, 13, 5], [57, 11, 12, 4], [66, 8, 11, 3], [75, 5, 12, 2],
  ];
  TIERS.forEach(([y, r, h, droop], k) => {
    const wobble = Math.sin(k * 1.7) * 0.08;
    skirt(t, [28 + Math.round(Math.sin(k * 2.3) * 1.5), y, 28 + Math.round(Math.cos(k * 1.9) * 1.5)], r * (1 + wobble), r * (1 - wobble), h, droop);
  });
  t.light(leaf, grass, 10);
  return t.piece();
}

/**
 * Birch: two slender pale stems from one dark, fissured foot, marked with dark bands, holding up a light, open
 * crown of small gold-green clouds with sky between them.
 */
export function birch(): Piece {
  const t = grow([48, 80, 48]);
  const main: Point[] = [[24, 0, 24], [25, 20, 23], [23, 40, 25], [24, 60, 24]];
  const second: Point[] = [[25, 0, 26], [29, 14, 29], [32, 30, 31], [34, 44, 30]];
  t.bough([[24, 0, 24], [24.5, 7, 24]], 3, 2.7);
  t.bough([[25.5, 0, 26.5], [27, 5, 28]], 2.2, 2);
  t.flare(24.5, 25, 3, [[0.1, 6, 1.6], [0.45, 6, 1.5], [0.8, 6, 1.6]]);
  t.bough(main, 2.6, 1.1, cream);
  t.bough(second, 1.8, 1, cream);
  t.bough([[23, 38, 25], [16, 46, 21], [13, 49, 20]], 1.4, 1, cream);
  t.bough([[25, 32, 23], [32, 44, 19], [36, 50, 18]], 1.3, 1, cream);
  t.bough([[33, 38, 31], [36, 46, 33]], 1.2, 1, cream);
  // Dark bands round the stems at authored heights, each a short dash on one side.
  for (const [stem, marks] of [[main, [[9, 0.3], [15, 2.4], [21, 4.4], [27, 1.2], [33, 3.4]]], [second, [[11, 1.4], [18, 4.6], [25, 2.8]]]] as const)
    for (const [y, angle] of marks) {
      const [ax, az] = axisAt(stem, y + 0.5);
      for (let z = Math.floor(az) - 4; z <= az + 4; z++) for (let x = Math.floor(ax) - 4; x <= ax + 4; x++) {
        if (t.get(x, y, z) !== cream) continue;
        const delta = Math.atan2(z + 0.5 - az, x + 0.5 - ax) - angle;
        if (Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) < 0.75) t.set(x, y, z, darkStone);
      }
    }
  t.cloud([24, 56, 24], [15, 16, 14], 4, 0.2, moss, 0.6);
  t.cloud([13, 48, 20], [9, 10, 8], 2, 0.1, moss);
  t.cloud([36, 50, 18], [9, 10, 8], 2, 0.5, moss);
  t.cloud([20, 44, 33], [8, 9, 8], 2, 0.8, moss);
  t.cloud([36, 46, 33], [8, 9, 8], 2, 0.65, moss);
  t.light(moss, goldLeaf, 69);
  return t.piece();
}

/**
 * Alder: a waterside tree that splits low into two stems on a stilted root plate, under a dark, close oval crown
 * that rises a little to a peak. It leans toward local +X, the way alders lean out over their water.
 */
export function alder(): Piece {
  const t = grow([56, 72, 56]);
  t.bough([[28, 0, 28], [28, 8, 28]], 3.6, 3.2);
  t.flare(28, 28, 5, [[0.0, 9, 2], [0.2, 8, 1.8], [0.4, 10, 2.2], [0.6, 8, 1.8], [0.82, 9, 2]]);
  t.bough([[28, 8, 28], [24, 24, 26], [22, 40, 27], [23, 52, 28]], 2.6, 1.2);
  t.bough([[28, 8, 28], [33, 22, 31], [37, 36, 30], [38, 48, 27]], 2.4, 1.2);
  t.bough([[24, 24, 26], [18, 30, 31], [16, 32, 31]], 1.4, 1);
  t.bough([[33, 22, 31], [39, 28, 26], [43, 31, 24]], 1.4, 1);
  t.cloud([31, 44, 26], [19, 20, 18], 4, 0.2, leaf, 0.7);
  t.cloud([16, 32, 31], [9, 9, 9], 2, 0.05);
  t.cloud([43, 31, 24], [9, 9, 9], 2, 0.55);
  t.cloud([34, 57, 24], [10, 8, 9], 3, 0.45);
  t.light(leaf, grass, 40);
  return t.piece();
}

/** Staked sapling: a three-metre young tree tied to a fresh stake, in the turned ring it was planted in. */
export function saplingStaked(): Piece {
  const t = grow([16, 28, 16]);
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x + 0.5 - 8, z + 0.5 - 8);
    if (d > 1.6 && d < 4.2) t.set(x, 0, z, earth);
  }
  t.bough([[8, 0, 8], [8, 14, 8], [7.5, 22, 8.5]], 1, 0.9);
  t.bough([[8, 12, 8], [10.5, 17, 6]], 0.9, 0.9);
  t.bough([[8, 15, 8], [5.5, 19, 9.5]], 0.9, 0.9);
  // The stake, fresh-cut and one cell square, and the cloth tie that holds the stem to it.
  for (let y = 0; y < 17; y++) t.set(11, y, 8, thatch);
  t.set(9, 12, 8, cream); t.set(10, 12, 8, cream);
  t.cloud([8, 21, 8], [5.5, 5, 5.5], 3, 0.15, leaf, 0.7);
  t.light(leaf, moss, 14);
  return t.piece();
}

/**
 * Bramble hedge: a four-metre hedgerow run that wanders a little side to side, five rounded humps of different
 * heights on a few arching canes, lower at both ends so runs meet without a seam. Nothing on it to pick.
 */
export function brambleHedge(): Piece {
  const t = grow([32, 12, 10]);
  for (const [x0, x1, z] of [[3, 7, 4], [12, 9, 6], [17, 20, 5], [26, 23, 4]] as const) t.bough([[x0, 0.5, z], [x1, 5, z + 0.5]], 1, 0.9);
  const HUMPS: readonly (readonly [x: number, z: number, rx: number, h: number])[] = [[5, 4.5, 4.6, 7], [10.5, 5.5, 5, 10], [16.5, 5, 4.6, 8], [22, 4.5, 5, 10], [27, 5.2, 4.6, 7]];
  for (const [x, z, rx, h] of HUMPS) t.lobe([x, 2, z], [rx, h - 2, 3.6], leaf, 1);
  t.light(leaf, moss, 6);
  return t.piece();
}

/**
 * Pear espalier: a pear trained flat against a wall in four tiers. A central stem with a low root flare carries
 * pairs of level arms, each upturned where it leaves the stem, clothed in small leafy spurs and a few pale
 * blossoms. There is no fruit.
 */
export function pearEspalier(): Piece {
  // Its leafy spurs are small by nature: a 2×2 bud along an arm is the smallest mass it keeps.
  const t = grow([48, 40, 6], 2, 2, 4);
  t.bough([[24, 0, 3], [24, 37, 3]], 1.6, 1.1);
  t.flare(24, 3, 2, [[0, 5, 1.2], [0.5, 5, 1.2]]);
  const ARMS = [[8, 21], [16, 20], [24, 18], [32, 11]] as const;
  for (const [y, reach] of ARMS) for (const side of [-1, 1]) {
    t.bough([[24, y - 3, 3], [24 + side * 4, y, 3], [24 + side * reach, y, 3]], 1.2, 0.9);
    for (let k = 1; 4 + k * 5 <= reach; k++) {
      const x = 24 + side * (3 + k * 5), up = (k + y / 8) % 2 === 0;
      t.lobe([x, y + (up ? 2.5 : -1), 3], [3.1, 2.6, 2.6], leaf, 0.8);
    }
  }
  t.lobe([24, 37, 3], [3.4, 2.6, 2.6], leaf, 0.8);
  t.light(leaf, moss, 6, 1);
  // A few pale blossoms resting on the spurs, a pair of cells each; never fruit.
  for (const [x, y] of [[7, 13], [30, 21], [15, 29], [40, 13], [20, 37]] as const) for (const bx of [x, x + 1]) {
    for (let k = Math.min(y + 3, 39); k > 0; k--) if (t.get(bx, k - 1, 3) !== 0 && t.get(bx, k, 3) === 0) { t.set(bx, k, 3, cream); break; }
  }
  return t.piece();
}

/**
 * Woodland clump: six crowns grown into one mass for the far hills, read at LOD 4. Five broadleaf crowns of
 * different heights and one dark spire, short trunks showing beneath, a paler birch crown at one side. Its lattice
 * is the LOD-4 block, so the far copy keeps every lobe whole.
 */
export function woodlandClump(): Piece {
  const t = grow([192, 120, 192], 4);
  const CROWNS: readonly (readonly [x: number, y: number, z: number, rx: number, ry: number, rz: number, bumps: number, turn: number, body: number])[] = [
    [62, 42, 72, 28, 30, 26, 5, 0.1, leaf],
    [118, 52, 86, 32, 36, 30, 6, 0.4, leaf],
    [92, 36, 134, 24, 26, 22, 4, 0.7, leaf],
    [146, 34, 120, 22, 24, 22, 4, 0.25, leaf],
    [54, 30, 132, 20, 22, 20, 4, 0.85, moss],
    [132, 36, 46, 22, 24, 20, 4, 0.55, leaf],
  ];
  for (const [x, y, z] of CROWNS) t.bough([[x, 0, z], [x + 2, y, z - 1]], 4.2, 3);
  t.bough([[34, 0, 52], [34, 80, 52]], 3.6, 2);
  for (const [x, y, z, rx, ry, rz, bumps, turn, body] of CROWNS) t.cloud([x, y, z], [rx, ry, rz], bumps, turn, body, 0.7);
  for (const [y, r, h] of [[14, 16, 22], [32, 13, 20], [48, 10, 18], [64, 6, 18]] as const) {
    for (let bz = 52 - r - 4; bz < 52 + r + 4; bz += 4) for (let bx = 34 - r - 4; bx < 34 + r + 4; bx += 4) {
      const rr = Math.hypot(bx + 2 - 34, bz + 2 - 52) / r;
      if (rr > 1) continue;
      for (let by = Math.floor((y - 4 * rr) / 4) * 4; by < y + h * (1 - rr); by += 4)
        for (let zz = bz; zz < bz + 4; zz++) for (let yy = by; yy < by + 4; yy++) for (let xx = bx; xx < bx + 4; xx++)
          if (t.get(xx, yy, zz) === 0) t.set(xx, yy, zz, leaf);
    }
  }
  // The birch crown's own light first, so the moss caps of the others are not turned gold after it.
  t.light(moss, goldLeaf, 40, 4);
  t.light(leaf, moss, 40, 4);
  return t.piece();
}
