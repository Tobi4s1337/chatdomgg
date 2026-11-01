import { StyleIdSchema, VOXEL_METRES, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import type { WallSite } from './site';
import type { WallStyle } from './types';

export const BUILD = VOXEL_METRES.build;
/** Masonry is laid in quarter-metre columns (two build cells): fine enough for curves, coarse enough to read as stone. */
export const COLUMN = 2 * BUILD;
const MAX_CELLS = 256;
const MAX_BOXES = 20000;
/** Every footprint is padded by this much when carving, so a column's whole cell stays clear. */
const CARVE_CLEARANCE = 0.3;

/** One vertical column of build cells, addressed in absolute settlement metres. */
export class Column {
  constructor(readonly cells: Uint8Array, readonly originY: number) {}
  private range(y0: number, y1: number): [number, number] {
    return [Math.max(0, Math.round((y0 - this.originY) / BUILD)), Math.min(this.cells.length, Math.round((y1 - this.originY) / BUILD))];
  }
  fill(y0: number, y1: number, material: number): void { const [a, b] = this.range(y0, y1); if (a < b) this.cells.fill(material, a, b); }
  carve(y0: number, y1: number): void { this.fill(y0, y1, 0); }
  /** Recolours only cells that are already solid: a slit, a door, a course band on a face. */
  paint(y0: number, y1: number, material: number): void {
    const [a, b] = this.range(y0, y1);
    for (let i = a; i < b; i++) if (this.cells[i]) this.cells[i] = material;
  }
}

export interface PieceBounds { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number }

export interface Painter {
  readonly bounds: PieceBounds;
  /** Headroom a street keeps under this piece (an arch spans it); null forbids the piece anywhere in a corridor. */
  readonly headroom: number | null;
  paint(x: number, z: number, column: Column): void;
}

export interface RasterPiece { readonly blueprint: VoxelBlueprint; readonly position: Vec3 }

const floorTo = (value: number, step: number) => Math.floor(value / step + 1e-9) * step;

/** The extent a piece of this size would occupy, in build cells, for the per-axis blueprint limit. */
export function cellExtent(bounds: PieceBounds): Vec3 {
  const ox = floorTo(bounds.minX, COLUMN), oz = floorTo(bounds.minZ, COLUMN), oy = floorTo(bounds.minY, BUILD);
  return [Math.ceil((bounds.maxX - ox) / COLUMN) * 2, Math.ceil((bounds.maxY - oy) / BUILD), Math.ceil((bounds.maxZ - oz) / COLUMN) * 2];
}

/**
 * Paints every quarter-metre column of a piece, carves whatever the site forbids (lots, squares, castle, water, the
 * region's edge, street corridors), then merges equal columns into boxes: identical neighbours along x first, then
 * identical rows along z, so flat faces become a handful of large boxes.
 */
export function rasterise(id: string, style: WallStyle, painter: Painter, site: WallSite): RasterPiece {
  const b = painter.bounds;
  const ox = floorTo(b.minX, COLUMN), oz = floorTo(b.minZ, COLUMN), oy = floorTo(b.minY, BUILD);
  const [sx, sy, sz] = cellExtent(b);
  if (sx > MAX_CELLS || sy > MAX_CELLS || sz > MAX_CELLS || sx < 1 || sy < 1 || sz < 1) throw new Error(`Wall piece ${id} is ${sx}×${sy}×${sz} cells`);
  const columnsX = sx / 2, columnsZ = sz / 2, cells = new Uint8Array(sy), column = new Column(cells, oy);
  const signatures: string[] = new Array(columnsX * columnsZ), spans = new Map<string, [number, number, number][]>();
  for (let k = 0; k < columnsZ; k++) for (let i = 0; i < columnsX; i++) {
    const x = ox + (i + 0.5) * COLUMN, z = oz + (k + 0.5) * COLUMN;
    cells.fill(0);
    painter.paint(x, z, column);
    let empty = true;
    for (let c = 0; c < sy; c++) if (cells[c]) { empty = false; break; }
    if (!empty) {
      const forbidden = site.forbiddenBelow(x, z, painter.headroom ?? 0, CARVE_CLEARANCE);
      if (forbidden === Infinity || (painter.headroom === null && forbidden > -Infinity)) cells.fill(0);
      else if (forbidden > -Infinity) column.carve(oy, forbidden);
    }
    const runs: [number, number, number][] = [];
    for (let c = 0; c < sy;) {
      const material = cells[c]!;
      let end = c + 1;
      while (end < sy && cells[end] === material) end++;
      if (material) runs.push([c, end, material]);
      c = end;
    }
    const signature = runs.map(r => r.join(',')).join(';');
    signatures[i + k * columnsX] = signature;
    if (signature && !spans.has(signature)) spans.set(signature, runs);
  }
  // Rows: maximal runs of equal signature along x. Then rectangles: equal runs stacked along z.
  interface Open { i0: number; i1: number; k0: number; signature: string }
  const boxes: VoxelBlueprint['boxes'] = [];
  const emit = (rect: Open, k1: number) => {
    for (const [y0, y1, material] of spans.get(rect.signature)!)
      boxes.push({ from: [rect.i0 * 2, y0, rect.k0 * 2], to: [rect.i1 * 2, y1, k1 * 2], material });
  };
  let open = new Map<string, Open>();
  for (let k = 0; k <= columnsZ; k++) {
    const next = new Map<string, Open>();
    if (k < columnsZ) for (let i = 0; i < columnsX;) {
      const signature = signatures[i + k * columnsX]!;
      let end = i + 1;
      while (end < columnsX && signatures[end + k * columnsX] === signature) end++;
      if (signature) {
        const key = `${i}:${end}:${signature}`, previous = open.get(key);
        if (previous) { open.delete(key); next.set(key, previous); } else next.set(key, { i0: i, i1: end, k0: k, signature });
      }
      i = end;
    }
    for (const rect of open.values()) emit(rect, k);
    open = next;
  }
  if (boxes.length > MAX_BOXES) throw new Error(`Wall piece ${id} needs ${boxes.length} boxes`);
  const blueprint: VoxelBlueprint = {
    version: 1, id, styleId: StyleIdSchema.parse(style), kind: 'civic', lattice: 'build',
    size: [sx, sy, sz], boxes, windows: [],
  };
  return { blueprint, position: [ox, oy, oz] };
}
