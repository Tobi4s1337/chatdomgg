import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { Boxes } from '../../../civic/kit';
import { MAT, STYLES, type StyleKey } from '../../../materials';
import type { CellBox } from '../place-piece';

type Box = VoxelBlueprint['boxes'][number];

/**
 * Shared craft for the shore pieces: a seeded hash for authored variety, superellipse courses for anything round
 * (stones, pads), a cell reader the factories use to derive honest metadata from their own boxes, and the rock
 * tones each kit's stone resolves to.
 */

/** A tiny integer hash in [0, 1). Same inputs, same value; variety comes only from the explicit variant. */
export function hash(...values: readonly number[]): number {
  let h = 0x2545f491;
  for (const v of values) {
    h = Math.imul(h ^ (v | 0), 0x9e3779b1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca77);
    h ^= h >>> 13;
  }
  return (h >>> 0) / 4294967296;
}

/** The tones a kit's rock is painted in: dry top, dry side, wet (at and under the waterline) and a bedding band. */
export interface RockTones {
  readonly top: number;
  readonly side: number;
  readonly wet: number;
  readonly band: number;
}

/**
 * Hearth is warm limestone with pale bedding and a blue-grey wet foot; Tide is grey stone with dark bedding;
 * Grove's own stone is already dark, so its wet foot goes to bark brown and its bedding to warm earth.
 */
export function rockTones(style: StyleKey): RockTones {
  const stone = STYLES[style].stone;
  if (style === 'hearth') return { top: stone, side: stone, wet: MAT.darkStone, band: MAT.cream };
  if (style === 'tide') return { top: stone, side: stone, wet: MAT.darkStone, band: MAT.darkStone };
  return { top: stone, side: stone, wet: MAT.bark, band: MAT.earth };
}

/** A horizontal superellipse: power 2 is an ellipse, higher powers square the shoulders, lower ones facet them. */
export interface Disc { readonly cx: number; readonly cz: number; readonly rx: number; readonly rz: number; readonly power?: number }
export type Region = { readonly x?: readonly [number, number]; readonly z?: readonly [number, number] };

/** Half-open X extent of the disc's row at cell row z, or undefined when the row misses it. */
export function discRow(d: Disc, z: number): readonly [number, number] | undefined {
  const p = d.power ?? 2;
  const t = Math.abs((z + 0.5 - d.cz) / d.rz);
  if (t >= 1) return undefined;
  const half = d.rx * (1 - t ** p) ** (1 / p);
  const x0 = Math.round(d.cx - half), x1 = Math.round(d.cx + half);
  return x1 > x0 ? [x0, x1] : undefined;
}

/**
 * Fills the disc as a prism from y0 to y1. Rows of equal extent merge into one box, so a course costs a handful
 * of boxes; `keep` clips it, so moss or a wet band can follow the same curved face as the stone it paints.
 */
export function disc(b: Boxes, size: Vec3, d: Disc, y0: number, y1: number, material: number, keep: Region = {}): void {
  const [kx0, kx1] = keep.x ?? [0, size[0]], [kz0, kz1] = keep.z ?? [0, size[2]];
  let run: { x0: number; x1: number; z0: number; z1: number } | undefined;
  const flush = () => { if (run) b.add(run.x0, y0, run.z0, run.x1, y1, run.z1, material); run = undefined; };
  for (let z = Math.max(0, kz0, Math.floor(d.cz - d.rz)); z < Math.min(size[2], kz1, Math.ceil(d.cz + d.rz)); z++) {
    const row = discRow(d, z);
    const x0 = row ? Math.max(0, kx0, row[0]) : 0, x1 = row ? Math.min(size[0], kx1, row[1]) : 0;
    if (x1 <= x0) { flush(); continue; }
    if (run && run.x0 === x0 && run.x1 === x1 && run.z1 === z) run.z1 = z + 1;
    else { flush(); run = { x0, x1, z0: z, z1: z + 1 }; }
  }
  flush();
}

/**
 * The factory's own reading of its ordered boxes (later boxes win, air carves), used to place metadata on the
 * cells that are really there. Tests check the same answers against the production rasterizer.
 */
export function cells(boxes: readonly Box[], size: Vec3) {
  const [sx, sy, sz] = size;
  const grid = new Uint8Array(sx * sy * sz);
  for (const { from, to, material } of boxes) {
    for (let z = from[2]; z < to[2]; z++) for (let y = from[1]; y < to[1]; y++) {
      grid.fill(material, from[0] + sx * (y + sy * z), to[0] + sx * (y + sy * z));
    }
  }
  const at = (x: number, y: number, z: number): number =>
    x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 0 : grid[x + sx * (y + sy * z)]!;
  /** One above the highest solid cell of a column (its walking height), or 0 when the column is empty. */
  const top = (x: number, z: number): number => { for (let y = sy - 1; y >= 0; y--) if (at(x, y, z)) return y + 1; return 0; };
  return { at, top };
}

/**
 * The largest axis-aligned rectangle of columns whose walking height is exactly `height` (so nothing stands on
 * it), within an optional region. Ties keep the first found, scanning from the front; deterministic.
 */
export function flatRect(read: ReturnType<typeof cells>, size: Vec3, height: number, region: Region = {}):
  { x: [number, number]; z: [number, number] } | undefined {
  const [rx0, rx1] = region.x ?? [0, size[0]], [rz0, rz1] = region.z ?? [0, size[2]];
  const ok = (x: number, z: number) => read.top(x, z) === height;
  let best: { x: [number, number]; z: [number, number] } | undefined, area = 0;
  for (let z0 = rz1 - 1; z0 >= rz0; z0--) for (let x0 = rx0; x0 < rx1; x0++) {
    if (!ok(x0, z0)) continue;
    let width = rx1 - x0;
    for (let z1 = z0; z1 < rz1; z1++) {
      let w = 0;
      while (w < width && ok(x0 + w, z1)) w++;
      width = w;
      if (!width) break;
      const a = width * (z1 - z0 + 1);
      if (a > area) { area = a; best = { x: [x0, x0 + width], z: [z0, z1 + 1] }; }
    }
  }
  return best;
}

/**
 * Overlapping masses can author the same box twice. Only the last copy matters (it rewrites the same cells with
 * the same material), so earlier copies are dropped and the final occupancy is unchanged.
 */
export function settle(boxes: readonly Box[]): Box[] {
  const seen = new Set<string>();
  return [...boxes].reverse().filter(box => { const k = JSON.stringify(box); if (seen.has(k)) return false; seen.add(k); return true; }).reverse();
}

export function shoreBlueprint(id: string, style: StyleKey, kind: 'flora' | 'prop', size: Vec3, b: Boxes): VoxelBlueprint {
  return { version: 1, id, styleId: STYLES[style].id, kind, lattice: 'build', size: [...size], boxes: settle(b.list), windows: [] };
}

/** The footprint a piece bears on at y = 0: the bounding rectangle of its ground cells. */
export function groundFooting(read: ReturnType<typeof cells>, size: Vec3, region: Region = {}): CellBox {
  const [rx0, rx1] = region.x ?? [0, size[0]], [rz0, rz1] = region.z ?? [0, size[2]];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let z = rz0; z < rz1; z++) for (let x = rx0; x < rx1; x++) if (read.at(x, 0, z)) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); z0 = Math.min(z0, z); z1 = Math.max(z1, z + 1);
  }
  if (!Number.isFinite(x0)) throw new Error('A footing needs ground cells under it.');
  return { from: [x0, 0, z0], to: [x1, 1, z1] };
}

export function checkStyle(form: string, style: StyleKey): void {
  if (!Object.hasOwn(STYLES, style)) throw new RangeError(`${form}: unknown style ${String(style)}.`);
}

export const SHORE_VARIANTS = [0, 1, 2] as const;
export type ShoreVariant = (typeof SHORE_VARIANTS)[number];

export function checkVariant(form: string, variant: number): asserts variant is ShoreVariant {
  if (!Number.isInteger(variant) || variant < 0 || variant > 2) throw new RangeError(`${form}: variant must be 0, 1 or 2, not ${variant}.`);
}

/** Water depth over the bed in cells: the surface lies on the plane y = water. */
export function checkWater(form: string, water: number): void {
  if (!Number.isInteger(water) || water < 1 || water > 16) throw new RangeError(`${form}: water must be a whole 1..16 cells, not ${water}.`);
}
