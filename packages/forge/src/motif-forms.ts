import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT } from '@chatdom/content/materials';

type Cell = [number, number, number];
type Box = VoxelBlueprint['boxes'][number];
/** One authored sculpture: boxes in its own cells, its bottom contact (`mount`) and a placement anchor (`emitter`). */
export interface MotifShape { size: Cell; boxes: Box[]; mount: Cell; emitter: Cell }

/** Ordered boxes into a dense grid; material zero carves, exactly as the voxel rasterizer does. */
export function motifCells(shape: MotifShape): { size: Cell; cells: Uint16Array } {
  const [sx, sy, sz] = shape.size;
  const cells = new Uint16Array(sx * sy * sz);
  for (const box of shape.boxes) {
    for (let z = Math.max(0, box.from[2]); z < Math.min(sz, box.to[2]); z++)
      for (let y = Math.max(0, box.from[1]); y < Math.min(sy, box.to[1]); y++)
        for (let x = Math.max(0, box.from[0]); x < Math.min(sx, box.to[0]); x++) cells[x + sx * (y + sy * z)] = box.material;
  }
  return { size: [sx, sy, sz], cells };
}

/** Greedy runs along x, then identical runs stacked along y: a compact, deterministic box list. */
export function cellsToBoxes(size: Cell, cells: Uint16Array): Box[] {
  const [sx, sy, sz] = size, used = new Uint8Array(cells.length), boxes: Box[] = [];
  const at = (x: number, y: number, z: number) => x + sx * (y + sy * z);
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    const i = at(x, y, z), m = cells[i]!;
    if (!m || used[i]) continue;
    let x1 = x + 1;
    while (x1 < sx && cells[at(x1, y, z)] === m && !used[at(x1, y, z)]) x1++;
    let y1 = y + 1;
    grow: while (y1 < sy) {
      for (let X = x; X < x1; X++) if (cells[at(X, y1, z)] !== m || used[at(X, y1, z)]) break grow;
      y1++;
    }
    for (let Y = y; Y < y1; Y++) for (let X = x; X < x1; X++) used[at(X, Y, z)] = 1;
    boxes.push({ from: [x, y, z], to: [x1, y1, z + 1], material: m });
  }
  return boxes;
}

/** The side a relief is read from: the sculpture's front (+Z) or its left/right profile. */
export type ReliefView = 'front' | 'left' | 'right';

/**
 * A wall relief of a sculpture: what the eye sees from `view`, pressed into `depth` cells facing +Z. Nearer
 * surfaces stand prouder, so a muzzle or a paw still reads in front of a body. The back face is flat, so the
 * relief sits flush on a plaque or a wall. Deterministic: the same sculpture always gives the same relief.
 */
export function reliefForm(shape: MotifShape, view: ReliefView, depth = 3): MotifShape {
  if (!Number.isInteger(depth) || depth < 1 || depth > 4) throw new Error('A relief is one to four cells deep.');
  const { size: [sx, sy, sz], cells } = motifCells(shape);
  const width = view === 'front' ? sx : sz;
  const out = new Uint16Array(width * sy * depth);
  for (let y = 0; y < sy; y++) for (let u = 0; u < width; u++) {
    // Walk from the viewer into the sculpture; the first solid cell is what shows.
    let material = 0, distance = 0;
    const span = view === 'front' ? sz : sx;
    for (let d = 0; d < span && !material; d++) {
      const x = view === 'front' ? u : view === 'left' ? d : sx - 1 - d;
      const z = view === 'front' ? sz - 1 - d : view === 'left' ? sz - 1 - u : u;
      const m = cells[x + sx * (y + sy * z)]!;
      if (m && m !== MAT.air) { material = m; distance = d; }
    }
    if (!material) continue;
    // Rank the visible surface by its distance across the sculpture's own depth.
    const near = Math.max(1, depth - Math.floor(distance * depth / Math.max(1, span)));
    for (let k = 0; k < near; k++) out[u + width * (y + sy * k)] = material;
  }
  const size: Cell = [width, sy, depth];
  // Relief faces +Z: the slab is ordered back (k=0, flush) to front.
  const mount: Cell = [Math.floor(width / 2), 0, 0];
  const emitter: Cell = [Math.floor(width / 2), Math.floor(sy / 2), depth];
  return { size, boxes: cellsToBoxes(size, out), mount, emitter };
}

/**
 * The same sculpture at half scale: each 2×2×2 block keeps its commonest material when at least three of its eight
 * cells are solid, so thin limbs and ears survive. Used where a whole sculpture would crowd a small slot.
 */
export function smallForm(shape: MotifShape): MotifShape {
  const { size: [sx, sy, sz], cells } = motifCells(shape);
  const size: Cell = [Math.ceil(sx / 2), Math.ceil(sy / 2), Math.ceil(sz / 2)];
  const out = new Uint16Array(size[0] * size[1] * size[2]);
  for (let z = 0; z < size[2]; z++) for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
    const counts = new Map<number, number>();
    let solid = 0;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const X = 2 * x + dx, Y = 2 * y + dy, Z = 2 * z + dz;
      if (X >= sx || Y >= sy || Z >= sz) continue;
      const m = cells[X + sx * (Y + sy * Z)]!;
      if (!m || m === MAT.air) continue;
      solid++; counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    // The bottom layer always keeps its contact, so the small form still stands on its mount.
    if (solid >= 3 || (y === 0 && solid >= 1)) {
      let best = 0, bestCount = -1;
      for (const [m, n] of counts) if (n > bestCount || (n === bestCount && m < best)) { best = m; bestCount = n; }
      out[x + size[0] * (y + size[1] * z)] = best;
    }
  }
  const half = (c: Cell): Cell => [Math.floor(c[0] / 2), Math.floor(c[1] / 2), Math.floor(c[2] / 2)];
  return { size, boxes: cellsToBoxes(size, out), mount: half(shape.mount), emitter: half(shape.emitter) };
}

/**
 * Only the cells that hold on: a flood from every cell for which `held` is true (a mount, a back face) keeps what it
 * reaches and drops the rest. A downsampled form can shed a lone cell; a piece never shows one.
 */
export function keepHeld(shape: MotifShape, held: (x: number, y: number, z: number) => boolean): MotifShape {
  const { size: [sx, sy, sz], cells } = motifCells(shape);
  const keep = new Uint8Array(cells.length), queue: number[] = [];
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    const i = x + sx * (y + sy * z);
    if (cells[i] && held(x, y, z)) { keep[i] = 1; queue.push(i); }
  }
  for (let q = 0; q < queue.length; q++) {
    const n = queue[q]!, x = n % sx, y = Math.floor(n / sx) % sy, z = Math.floor(n / (sx * sy));
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
      const X = x + dx, Y = y + dy, Z = z + dz;
      if (X < 0 || Y < 0 || Z < 0 || X >= sx || Y >= sy || Z >= sz) continue;
      const j = X + sx * (Y + sy * Z);
      if (cells[j] && !keep[j]) { keep[j] = 1; queue.push(j); }
    }
  }
  for (let i = 0; i < cells.length; i++) if (!keep[i]) cells[i] = 0;
  return { ...shape, size: [sx, sy, sz], boxes: cellsToBoxes([sx, sy, sz], cells) };
}
