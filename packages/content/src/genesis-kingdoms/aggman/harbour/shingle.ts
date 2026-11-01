import { MAT } from '../../../materials';
import type { AggmanPiece } from '../piece';
import { Grid, noise } from './grid';

/**
 * Where a strand of shingle lies, as the host sampled it. Local frame in build cells: x and z run across the strand
 * in plan (the host chooses the turn), y = 0 is the piece's base, reported back as `base` in absolute cells.
 */
export interface ShingleSite {
  readonly id: string;
  /** Plan size in cells, each ≤ 256. */
  readonly length: number;
  readonly depth: number;
  /** Absolute cells of the sea surface. */
  readonly water: number;
  /** Absolute cells of the (graded) ground or sea bed at local cell point (x, z). */
  ground(x: number, z: number): number;
  /** Cells inland of the waterline at local cell point (x, z): negative out in the sea. */
  shore(x: number, z: number): number;
  /** How far the stones run up the bank, in cells; the inland edge wanders a quarter either way. */
  readonly reach: number;
  /** Cells left bare, in plan: where the quay, a slip or a building already stands. */
  readonly clear?: (x: number, z: number) => boolean;
  /**
   * Cells outside the nearest berth at local cell point (x, z), ≤ 0 inside: where a boat lies drawn up. A berth is
   * stones however far up the bank it lies, with a margin of stones round it, so no hull ever rests on turf.
   */
  readonly berth?: (x: number, z: number) => number;
}

export interface ShingleStrand extends AggmanPiece {
  /** Absolute world cells of the blueprint's y = 0. */
  readonly base: number;
}

/** How far the stones run on under the water, in cells, so the shallows show a stony bed and not a seam. */
const UNDERWATER = 22;
/** The wrack line: weed and driftwood left at the last high tide, this many cells above the waterline. */
const WRACK = [7, 12] as const;

/** A skin one stone thick packs best stone by stone in plan, then down its column: one sweep, not six. */
const SKIN_ORDERS = [[0, 2, 1]] as const;

/** Smooth 0..1 value noise over cells, so the strand's inland edge wanders instead of stepping. */
function drift(x: number, z: number, scale: number, seed: number): number {
  const u = x / scale, v = z / scale, i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = noise(i, j, seed), b = noise(i + 1, j, seed), c = noise(i, j + 1, seed), d = noise(i + 1, j + 1, seed);
  return a + (b - a) * s(fu) + (c - a) * s(fv) + (a - b - c + d) * s(fu) * s(fv);
}

/** Pebble spacing in cells: one stone seeded in every 3×3 cell square, about 37 cm across. */
const SPACING = 3;
/** Cells nearer than this to the crack between two stones are its shadowed line. */
const CRACK = .35;
/** Cells round a berth that are stones too, before the margin thins into the turf like the strand's own edge. */
const BERTH_MARGIN = 9;

/** A stone of the strand: its seed point in cells and its key. Nearer points to a cell are cut by a weight, so stones differ in size. */
interface Pebble { readonly key: number; readonly cx: number; readonly cz: number; readonly size: number }

/**
 * The stones round a cell, Worley fashion: each 3×3 square of the strand seeds one stone at a jittered point with
 * its own size, and a cell belongs to the stone nearest it (less its size). The gap to the second nearest tells how
 * close the cell is to a crack between two stones.
 */
function pebbleAt(x: number, z: number, seed: number): { readonly stone: Pebble; readonly crack: number; readonly middle: number } {
  const gi = Math.floor(x / SPACING), gj = Math.floor(z / SPACING);
  let first: Pebble | undefined, d1 = Infinity, d2 = Infinity;
  for (let j = gj - 1; j <= gj + 1; j++) for (let i = gi - 1; i <= gi + 1; i++) {
    const cx = (i + .2 + .6 * noise(i, j, seed, 31)) * SPACING, cz = (j + .2 + .6 * noise(i, j, seed, 32)) * SPACING;
    const size = noise(i, j, seed, 33) * 1.1 - .35;
    const d = Math.hypot(x - cx, z - cz) - size;
    if (d < d1) { d2 = d1; d1 = d; first = { key: (i & 0xffff) | ((j & 0xffff) << 16), cx, cz, size }; }
    else if (d < d2) d2 = d;
  }
  return { stone: first!, crack: d2 - d1, middle: d1 + first!.size };
}

/**
 * A strand of harbour shingle following the ground the host sampled: rounded stones of uneven size, about 37 cm
 * across, laid as a skin one cell proud of the bank, so the turf gives way to a pale stony beach between the grass
 * and the sea.
 *
 * - Each stone is its own shape: cells belong to the nearest of a jittered field of stones of uneven size, the
 *   cracks between them are shadowed a tone darker and the bigger stones crown a cell higher at their middles, so
 *   close in the beach reads as rounded pebbles bedded in each other, never as courses of paving.
 * - Dry stones up the bank are warm grey and sandy grey, with some pale limestone and the odd cream quartz; at the
 *   inland edge they thin out into the turf rather than stopping on a line.
 * - Below the wrack line the stones are wet and dark, and they run on under the water as a weedy bed, so the
 *   shallows show stones and not a seam.
 * - Along the wrack line lie weed and the odd bleached stick of driftwood, the last tide's mark.
 * - Wherever a boat lies drawn up, the stones run on round her berth, so no hull rests on turf.
 */
export function createShingleStrand(site: ShingleSite): ShingleStrand {
  const { length: L, depth: D, water, reach } = site;
  if (!Number.isInteger(L) || !Number.isInteger(D) || L < 8 || L > 256 || D < 8 || D > 256) throw new Error('A shingle strand is 8–256 cells each way.');
  if (!(reach > 8)) throw new Error('A shingle strand reaches more than eight cells up its bank.');
  const seed = [...site.id].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 0x01000193), 0x811c9dc5);
  type Column = { top: number; floor: number; material: number };
  const columns: (Column | undefined)[] = new Array(L * D);
  let low = Infinity, high = -Infinity;
  for (let z = 0; z < D; z++) for (let x = 0; x < L; x++) {
    if (site.clear?.(x + .5, z + .5)) continue;
    const inland = site.shore(x + .5, z + .5);
    if (inland < -UNDERWATER) continue;
    const { stone, crack, middle } = pebbleAt(x + .5, z + .5, seed);
    const pick = noise(stone.key, seed, 1);
    // The inland fringe: whole stones drop out as the turf takes over, the nearer the edge the fewer.
    const edge = reach * (.75 + .5 * drift(x, z, 40, seed));
    const fringe = (edge - inland) / (reach * .3);
    const onStrand = inland <= edge && (fringe >= 1 || pick <= fringe);
    // A berth's margin thins the same way, so the stones round a boat meet the turf as the strand does.
    const out = site.berth?.(x + .5, z + .5) ?? Infinity;
    const margin = BERTH_MARGIN * (.7 + .6 * drift(x, z, 12, seed + 3));
    const inBerth = out <= 0 || (out < margin && pick <= (margin - out) / (margin * .5));
    if (!onStrand && !inBerth) continue;
    const ground = site.ground(x + .5, z + .5);
    const wet = inland < WRACK[0];
    const wrack = inland >= WRACK[0] && inland < WRACK[1] && drift(x, z, 9, seed + 7) > .58;
    let material: number;
    if (wrack) material = noise(x, z, seed, 3) < .7 ? MAT.moss : MAT.bark;
    // Close tones, so the bank reads as one calm beach at a distance and as stones only near to.
    else if (inland < 0) material = pick < .55 ? MAT.darkStone : pick < .85 ? MAT.waterbed : MAT.stone;
    else if (wet) material = pick < .5 ? MAT.darkStone : pick < .9 ? MAT.stone : MAT.paving;
    else material = pick < .55 ? MAT.stone : pick < .85 ? MAT.paving : pick < .98 ? MAT.limestone : MAT.cream;
    // A stone sits as one: its cells take the height of the bank at its middle, a cell proud of the turf.
    const seat = site.ground(Math.min(L - .5, Math.max(.5, stone.cx)), Math.min(D - .5, Math.max(.5, stone.cz)));
    const bed = Math.floor(ground);
    let top = Math.max(bed, Math.floor(seat - .5)) + 1;
    // The crack between two stones is shadowed: a darker tone, wet or dry. A big dry stone crowns a cell higher at
    // its middle, so close in each stone shows a lit top and a shaded rim. (Cracks a cell lower read better still,
    // but cost three times the triangles of a plain skin; tone and crown cost half again.)
    if (!wrack && crack < CRACK) material = wet ? (material === MAT.darkStone ? MAT.waterbed : MAT.darkStone) : material === MAT.stone ? MAT.darkStone : MAT.stone;
    else if (!wet && !wrack && stone.size > .25 && middle < .9) top += 1;
    columns[x + L * z] = { top, floor: Math.min(top - 2, bed - 1), material };
    low = Math.min(low, bed - 1);
    high = Math.max(high, top + 2);
  }
  if (!Number.isFinite(low)) throw new Error(`shingle strand ${site.id}: no shore within the strand.`);
  const base = Math.max(low, water - 12);
  const height = high - base + 1;
  if (height > 256) throw new Error(`shingle strand ${site.id}: the bank rises more than one blueprint.`);
  const g = new Grid(L, height, D);
  for (let z = 0; z < D; z++) for (let x = 0; x < L; x++) {
    const column = columns[x + L * z];
    if (!column) continue;
    // A skin down to under the bank, of the same stone, so the step between neighbours on the bank shows the
    // stone's own side and not a dark riser striping the beach.
    for (let y = Math.max(0, column.floor - base); y <= column.top - base; y++) g.set(x, y, z, column.material);
  }
  // Driftwood: a few bleached sticks along the wrack line, never more than one in ten metres of strand.
  for (let i = 0; i < Math.floor(L / 80) + 1; i++) {
    const x0 = Math.floor(noise(i, seed, 21) * (L - 24)) + 4;
    for (let z0 = 0; z0 < D; z0++) {
      const inland = site.shore(x0 + .5, z0 + .5);
      if (inland < WRACK[0] + 1 || inland > WRACK[1]) continue;
      const span = 10 + Math.floor(noise(i, seed, 22) * 8), slant = noise(i, seed, 23) < .5 ? 1 : -1;
      for (let s = 0; s < span; s++) {
        const x = x0 + s, z = z0 + Math.floor(s / 5) * slant;
        const column = x < L && z >= 0 && z < D ? columns[x + L * z] : undefined;
        if (!column) break;
        g.set(x, column.top - base + 1, z, s === 0 || s === span - 1 ? MAT.bark : MAT.timber);
      }
      break;
    }
  }
  return { blueprint: g.blueprint(`genesis-aggman-shingle-${site.id}`, SKIN_ORDERS), lanterns: [], footprint: { from: [0, 0], to: [L, D] }, base };
}
