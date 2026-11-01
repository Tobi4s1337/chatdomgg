import type { BoundsXZ, XZ } from '../../../settlement/types';

/**
 * A boolean field over the physical region, one cell per half metre. The town's footprint is shaped here with
 * distance fields (dilate, close, fill), and its outline is traced once at the end. Cell (i, j) is centred at
 * (minX + (i + .5)·cell, minZ + (j + .5)·cell).
 */
export class MaskGrid {
  readonly w: number;
  readonly h: number;
  readonly count: number;
  constructor(readonly minX: number, readonly minZ: number, w: number, h: number, readonly cell: number) {
    this.w = w; this.h = h; this.count = w * h;
  }
  static over(region: BoundsXZ, cell: number): MaskGrid {
    return new MaskGrid(region.minX, region.minZ, Math.max(1, Math.round((region.maxX - region.minX) / cell)), Math.max(1, Math.round((region.maxZ - region.minZ) / cell)), cell);
  }
  cx(i: number): number { return this.minX + (i + 0.5) * this.cell; }
  cz(j: number): number { return this.minZ + (j + 0.5) * this.cell; }
  /** Index of the cell containing (x, z), or -1 outside the grid. */
  at(x: number, z: number): number {
    const i = Math.floor((x - this.minX) / this.cell), j = Math.floor((z - this.minZ) / this.cell);
    return i < 0 || j < 0 || i >= this.w || j >= this.h ? -1 : i + j * this.w;
  }
  /** Calls `visit` for every cell whose centre lies in the rectangle. */
  forRect(b: BoundsXZ, visit: (index: number, x: number, z: number) => void): void {
    const i0 = Math.max(0, Math.ceil((b.minX - this.minX) / this.cell - 0.5)), i1 = Math.min(this.w - 1, Math.floor((b.maxX - this.minX) / this.cell - 0.5));
    const j0 = Math.max(0, Math.ceil((b.minZ - this.minZ) / this.cell - 0.5)), j1 = Math.min(this.h - 1, Math.floor((b.maxZ - this.minZ) / this.cell - 0.5));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) visit(i + j * this.w, this.cx(i), this.cz(j));
  }
  /** Bilinear-free lookup: the value of the cell under (x, z), `outside` beyond the grid. */
  sample(field: Float32Array, x: number, z: number, outside: number): number {
    const index = this.at(x, z);
    return index < 0 ? outside : field[index]!;
  }
}

/** Euclidean distance in metres from every cell centre to the nearest marked cell centre (Felzenszwalb–Huttenlocher). */
export function distanceField(mask: Uint8Array, grid: MaskGrid): Float32Array {
  const { w, h } = grid, big = 1e12, squared = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) squared[i] = mask[i] ? 0 : big;
  const n = Math.max(w, h), f = new Float64Array(n), v = new Int32Array(n), edge = new Float64Array(n + 1), out = new Float64Array(n);
  // One-dimensional lower envelope of parabolas over f[0..length), into out.
  const envelope = (length: number) => {
    let j = 0; v[0] = 0; edge[0] = -Infinity; edge[1] = Infinity;
    for (let q = 1; q < length; q++) {
      const fq = f[q]! + q * q;
      let p = v[j]!, s = (fq - (f[p]! + p * p)) / (2 * q - 2 * p);
      while (s <= edge[j]!) { j--; p = v[j]!; s = (fq - (f[p]! + p * p)) / (2 * q - 2 * p); }
      j++; v[j] = q; edge[j] = s; edge[j + 1] = Infinity;
    }
    j = 0;
    for (let q = 0; q < length; q++) { while (edge[j + 1]! < q) j++; const p = v[j]!; out[q] = (q - p) * (q - p) + f[p]!; }
  };
  for (let x = 0; x < w; x++) {
    let any = false;
    for (let k = 0, i = x; k < h; k++, i += w) { f[k] = squared[i]!; if (f[k]! < big) any = true; }
    if (!any) continue;
    envelope(h);
    for (let k = 0, i = x; k < h; k++, i += w) squared[i] = out[k]!;
  }
  for (let z = 0; z < h; z++) {
    const row = z * w;
    let any = false;
    for (let k = 0; k < w; k++) { f[k] = squared[row + k]!; if (f[k]! < big) any = true; }
    if (!any) continue;
    envelope(w);
    for (let k = 0; k < w; k++) squared[row + k] = out[k]!;
  }
  const result = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) result[i] = squared[i]! >= big / 2 ? Infinity : Math.sqrt(squared[i]!) * grid.cell;
  return result;
}

/** Morphological closing by a disc of `radius` metres: everything a rolling disc of that size cannot reach. */
export function closeMask(mask: Uint8Array, grid: MaskGrid, radius: number): Uint8Array {
  const toMask = distanceField(mask, grid), grown = new Uint8Array(grid.count);
  for (let i = 0; i < grid.count; i++) grown[i] = toMask[i]! <= radius ? 1 : 0;
  const inverse = new Uint8Array(grid.count);
  for (let i = 0; i < grid.count; i++) inverse[i] = grown[i] ? 0 : 1;
  // Cells past the grid border count as open land the disc can roll in.
  for (let x = 0; x < grid.w; x++) { inverse[x] = 1; inverse[x + (grid.h - 1) * grid.w] = 1; }
  for (let z = 0; z < grid.h; z++) { inverse[z * grid.w] = 1; inverse[grid.w - 1 + z * grid.w] = 1; }
  const toOpen = distanceField(inverse, grid), closed = new Uint8Array(grid.count);
  for (let i = 0; i < grid.count; i++) closed[i] = mask[i] || toOpen[i]! > radius ? 1 : 0;
  return closed;
}

/** 4-connected component labels (0 = unmarked); returns the labels and the component count. */
export function components(mask: Uint8Array, grid: MaskGrid): { labels: Int32Array; count: number } {
  const { w, h } = grid, labels = new Int32Array(w * h), stack = new Int32Array(w * h);
  let count = 0;
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || labels[start]) continue;
    count++; let top = 0; stack[top++] = start; labels[start] = count;
    while (top) {
      const at = stack[--top]!, x = at % w, z = (at - x) / w;
      const visit = (next: number) => { if (mask[next] && !labels[next]) { labels[next] = count; stack[top++] = next; } };
      if (x > 0) visit(at - 1);
      if (x < w - 1) visit(at + 1);
      if (z > 0) visit(at - w);
      if (z < h - 1) visit(at + w);
    }
  }
  return { labels, count };
}

/** Marks every unmarked cell the grid border cannot reach through unmarked cells (4-connected). */
export function fillHoles(mask: Uint8Array, grid: MaskGrid): void {
  const { w, h } = grid, outside = new Uint8Array(w * h), stack = new Int32Array(w * h);
  let top = 0;
  const seed = (i: number) => { if (!mask[i] && !outside[i]) { outside[i] = 1; stack[top++] = i; } };
  for (let x = 0; x < w; x++) { seed(x); seed(x + (h - 1) * w); }
  for (let z = 0; z < h; z++) { seed(z * w); seed(w - 1 + z * w); }
  while (top) {
    const at = stack[--top]!, x = at % w, z = (at - x) / w;
    if (x > 0) seed(at - 1);
    if (x < w - 1) seed(at + 1);
    if (z > 0) seed(at - w);
    if (z < h - 1) seed(at + w);
  }
  for (let i = 0; i < w * h; i++) if (!outside[i]) mask[i] = 1;
}

/**
 * The outline of a marked region as closed loops through the midpoints between cell centres (marching squares).
 * Diagonal-only contacts stay apart, matching the 4-connected components above. The grid border is outside.
 */
export function outlineLoops(mask: Uint8Array, grid: MaskGrid): XZ[][] {
  const { w, h, cell } = grid;
  const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < w && j < h && mask[i + j * w] === 1;
  // Edge keys: horizontal edge between centre (i,j) and (i+1,j) is 2·(i + j·(w+1)); vertical between (i,j) and (i,j+1) is +1.
  const W = w + 1, links = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    let list = links.get(a); if (!list) links.set(a, list = []); list.push(b);
    list = links.get(b); if (!list) links.set(b, list = []); list.push(a);
  };
  for (let j = -1; j < h; j++) for (let i = -1; i < w; i++) {
    const a = inside(i, j), b = inside(i + 1, j), c = inside(i + 1, j + 1), d = inside(i, j + 1);
    const code = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0);
    if (code === 0 || code === 15) continue;
    const ii = i + 1, jj = j + 1;
    const bottom = 2 * (ii + jj * W), top = 2 * (ii + (jj + 1) * W), left = 2 * (ii + jj * W) + 1, right = 2 * (ii + 1 + jj * W) + 1;
    switch (code) {
      case 1: case 14: link(bottom, left); break;
      case 2: case 13: link(bottom, right); break;
      case 4: case 11: link(right, top); break;
      case 8: case 7: link(left, top); break;
      case 3: case 12: link(left, right); break;
      case 6: case 9: link(bottom, top); break;
      case 5: link(bottom, left); link(right, top); break;
      case 10: link(bottom, right); link(left, top); break;
    }
  }
  const position = (key: number): XZ => {
    const vertical = key & 1, base = key >> 1, ii = base % W, jj = (base - ii) / W, i = ii - 1, j = jj - 1;
    return vertical ? [grid.minX + (i + 0.5) * cell, grid.minZ + (j + 1) * cell] : [grid.minX + (i + 1) * cell, grid.minZ + (j + 0.5) * cell];
  };
  const seen = new Set<number>(), loops: XZ[][] = [];
  const keys = [...links.keys()].sort((p, q) => p - q);
  for (const start of keys) {
    if (seen.has(start)) continue;
    const loop: XZ[] = [];
    let previous = -1, at = start;
    for (let guard = 0; guard <= links.size; guard++) {
      seen.add(at); loop.push(position(at));
      const next = links.get(at)!.find(k => k !== previous && !seen.has(k));
      if (next === undefined) break;
      previous = at; at = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** Shoelace area in the XZ plane: positive when the loop runs with its interior on the left of (x right, z up). */
export function signedArea(loop: readonly XZ[]): number {
  let area = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) area += loop[j]![0] * loop[i]![1] - loop[i]![0] * loop[j]![1];
  return area / 2;
}

export function pointInPolygon(polygon: readonly XZ[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]!, b = polygon[i]!;
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
