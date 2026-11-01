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

/**
 * A strand of harbour shingle following the ground the host sampled: rounded stones about 37 cm across laid as a
 * skin one cell proud of the bank, so the turf gives way to a pale stony beach between the grass and the sea.
 *
 * - Dry stones up the bank are warm grey and sandy grey, with some pale limestone and the odd cream quartz; a few
 *   stand a cell proud, and at the inland edge they thin out into the turf rather than stopping on a line.
 * - Below the wrack line the stones are wet and dark, and they run on under the water as a weedy bed, so the
 *   shallows show stones and not a seam.
 * - Along the wrack line lie weed and the odd bleached stick of driftwood, the last tide's mark.
 */
export function createShingleStrand(site: ShingleSite): ShingleStrand {
  const { length: L, depth: D, water, reach } = site;
  if (!Number.isInteger(L) || !Number.isInteger(D) || L < 8 || L > 256 || D < 8 || D > 256) throw new Error('A shingle strand is 8–256 cells each way.');
  if (!(reach > 8)) throw new Error('A shingle strand reaches more than eight cells up its bank.');
  const seed = [...site.id].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 0x01000193), 0x811c9dc5);
  // Stones are laid in rows of three-cell pebbles, each row shifted, so the courses never read as a grid.
  const stoneOf = (x: number, z: number): readonly [number, number, number, number] => {
    const row = Math.floor(z / 3), shift = Math.floor(noise(row, seed, 11) * 3), column = Math.floor((x + shift) / 3);
    return [column, row, column * 3 - shift + 1.5, row * 3 + 1.5];
  };
  type Column = { top: number; material: number; proud: boolean };
  const columns: (Column | undefined)[] = new Array(L * D);
  let low = Infinity, high = -Infinity;
  for (let z = 0; z < D; z++) for (let x = 0; x < L; x++) {
    if (site.clear?.(x + .5, z + .5)) continue;
    const inland = site.shore(x + .5, z + .5);
    const edge = reach * (.75 + .5 * drift(x, z, 40, seed));
    if (inland < -UNDERWATER || inland > edge) continue;
    const [sx, sz, cx, cz] = stoneOf(x, z), pick = noise(sx, sz, seed);
    // The inland fringe: whole stones drop out as the turf takes over, the nearer the edge the fewer.
    const fringe = (edge - inland) / (reach * .3);
    if (fringe < 1 && pick > fringe) continue;
    const ground = site.ground(x + .5, z + .5);
    const wet = inland < WRACK[0];
    const wrack = inland >= WRACK[0] && inland < WRACK[1] && drift(x, z, 9, seed + 7) > .58;
    let material: number;
    if (wrack) material = noise(x, z, seed, 3) < .7 ? MAT.moss : MAT.bark;
    // Close tones, so the bank reads as one calm beach at a distance and as stones only near to.
    else if (inland < 0) material = pick < .55 ? MAT.darkStone : pick < .85 ? MAT.waterbed : MAT.stone;
    else if (wet) material = pick < .5 ? MAT.darkStone : pick < .9 ? MAT.stone : MAT.paving;
    else material = pick < .55 ? MAT.stone : pick < .85 ? MAT.paving : pick < .98 ? MAT.limestone : MAT.cream;
    // A stone's cells share one height, so it sits as one rounded stone and not a stair of cells.
    const seat = site.ground(Math.min(L - .5, Math.max(.5, cx)), Math.min(D - .5, Math.max(.5, cz)));
    const top = Math.floor(Math.max(ground, seat - .5));
    const proud = !wet && !wrack && noise(sx, sz, seed, 5) < .06;
    columns[x + L * z] = { top, material, proud };
    low = Math.min(low, Math.floor(ground) - 1);
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
    const top = column.top - base;
    // A skin two cells deep under the top stone, of the same stone, so the step between neighbours on the bank shows
    // the stone's own side and not a dark riser striping the beach.
    for (let y = Math.max(0, top - 2); y <= top; y++) g.set(x, y, z, column.material);
    if (column.proud && top + 1 < height) g.set(x, top + 1, z, column.material);
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
        const column = columns[x + L * z];
        if (x >= L || z < 0 || z >= D || !column) break;
        g.set(x, column.top - base + 1, z, s === 0 || s === span - 1 ? MAT.bark : MAT.timber);
      }
      break;
    }
  }
  return { blueprint: g.blueprint(`genesis-aggman-shingle-${site.id}`, SKIN_ORDERS), lanterns: [], footprint: { from: [0, 0], to: [L, D] }, base };
}
