import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { Boxes } from '../../../civic/kit';
import { MAT, STYLES, type StyleKey } from '../../../materials';
import { hash, rockTones, settle } from '../shore/shape';

/**
 * Shared craft for the millrace: the wood and stone each kit resolves to, a stroke rasteriser for anything
 * sloped or round, and coursed masonry. Coordinates are build cells; every helper writes ordered half-open boxes.
 */

/** Plank faces and their end grain. Grove's bark is already the darkest wood, so its ends show warm earth. */
export interface Wood { readonly plank: number; readonly end: number }
export function wood(style: StyleKey): Wood {
  return style === 'grove' ? { plank: MAT.bark, end: MAT.earth } : { plank: STYLES[style].trim, end: MAT.bark };
}

/** Wrought iron: straps, journals, bands and bearing blocks. */
export const IRON = MAT.darkStone;

/** A kit's masonry: the dressed stone, an odd lighter or darker stone, the wet foot and moss in the shade. */
export interface Masonry { readonly stone: number; readonly band: number; readonly wet: number; readonly moss: number }
export function masonry(style: StyleKey): Masonry {
  const tones = rockTones(style);
  return { stone: tones.side, band: tones.band, wet: tones.wet, moss: MAT.moss };
}

type Cell2 = readonly [number, number];

/**
 * Cells (u, v) whose centres lie within `half` of the segment a→c. A half-width of at least √2/2 keeps the
 * stroke face-connected at every slope, so a brace or a bucket board is one piece of wood, not a dotted line.
 */
export function stroke(a: Cell2, c: Cell2, half = 0.72): [number, number][] {
  const out: [number, number][] = [];
  const [du, dv] = [c[0] - a[0], c[1] - a[1]];
  const len2 = du * du + dv * dv;
  for (let u = Math.floor(Math.min(a[0], c[0]) - half); u <= Math.ceil(Math.max(a[0], c[0]) + half); u++) {
    for (let v = Math.floor(Math.min(a[1], c[1]) - half); v <= Math.ceil(Math.max(a[1], c[1]) + half); v++) {
      const [pu, pv] = [u + 0.5 - a[0], v + 0.5 - a[1]];
      const t = len2 ? Math.max(0, Math.min(1, (pu * du + pv * dv) / len2)) : 0;
      if (Math.hypot(pu - t * du, pv - t * dv) <= half) out.push([u, v]);
    }
  }
  return out;
}

/** Hands each run of cells along u (per v) to `put(u0, u1, v)`, so a stroke costs one box per row it crosses. */
export function runs(cells: Iterable<Cell2>, put: (u0: number, u1: number, v: number) => void): void {
  const rows = new Map<number, number[]>();
  for (const [u, v] of cells) { const row = rows.get(v); if (row) row.push(u); else rows.set(v, [u]); }
  for (const [v, us] of [...rows].sort((p, q) => p[0] - q[0])) {
    const sorted = [...new Set(us)].sort((p, q) => p - q);
    let start = sorted[0]!, previous = start;
    for (const u of sorted.slice(1)) {
      if (u !== previous + 1) { put(start, previous + 1, v); start = u; }
      previous = u;
    }
    put(start, previous + 1, v);
  }
}

/**
 * One face of a solid wall laid as coursed stone. Courses are four cells (half a metre) high; each course is cut
 * into stones of four to eight cells with staggered head joints, and the joints are recessed one cell so the
 * contact shading draws the mortar. Stones below `wetTo` take the wet tone, some below `mossTo` the moss, and an
 * odd stone the band tone. `layer` is the outermost cell layer of the face; `span` runs along the face.
 */
export interface CourseFace {
  readonly normal: 'x' | 'z';
  readonly layer: number;
  readonly span: readonly [number, number];
  readonly y: readonly [number, number];
  readonly seed: number;
  readonly wetTo?: number;
  readonly mossTo?: number;
}

export const COURSE = 4;

export function coursed(b: Boxes, face: CourseFace, tones: Masonry): void {
  const { layer, span: [s0, s1], y: [fy0, fy1] } = face;
  const put = (u0: number, u1: number, y0: number, y1: number, m: number) => {
    if (face.normal === 'x') b.add(layer, y0, u0, layer + 1, y1, u1, m);
    else b.add(u0, y0, layer, u1, y1, layer + 1, m);
  };
  for (let k = 0, y0 = fy0; y0 < fy1; k++, y0 += COURSE) {
    const y1 = Math.min(y0 + COURSE, fy1), bed = k > 0 ? y0 : -1;
    const joints: number[] = [];
    let u = s0 - 1 - Math.floor(hash(face.seed, k, 7) * 5);
    for (let s = 0; u < s1; s++) {
      const len = 4 + Math.floor(hash(face.seed, k, s, 1) * 5);
      const a = Math.max(u, s0), c = Math.min(u + len - 1, s1), r = hash(face.seed, k, s, 2);
      const tone = face.wetTo !== undefined && y0 < face.wetTo ? tones.wet
        : face.mossTo !== undefined && y0 < face.mossTo && r < 0.35 ? tones.moss
          : r > 0.84 ? tones.band : undefined;
      if (tone !== undefined && c > a) put(a, c, y0, y1, tone);
      // A head joint keeps two cells off either end of the face, so where two coursed faces turn a corner the
      // quoin stone runs round it and stays bonded, rather than being cut off by a joint on each face.
      if (u + len - 1 >= s0 + 2 && u + len - 1 < s1 - 2) joints.push(u + len - 1);
      u += len;
    }
    // The mortar: the bed under the course, then the head joints standing on it.
    if (bed >= 0) put(s0, s1, bed, bed + 1, MAT.air);
    for (const j of joints) put(j, j + 1, Math.max(bed + 1, y0), y1, MAT.air);
  }
}

/** A blueprint from ordered boxes, with any repeated box dropped (the occupancy is unchanged). */
export function millBlueprint(id: string, style: StyleKey, kind: 'prop' | 'civic', size: Vec3, b: Boxes): VoxelBlueprint {
  for (const box of b.list) for (let a = 0; a < 3; a++) {
    if (box.from[a]! < 0 || box.to[a]! > size[a]!) throw new Error(`${id}: box ${JSON.stringify(box)} leaves ${size.join('×')}.`);
  }
  return { version: 1, id, styleId: STYLES[style].id, kind, lattice: 'build', size: [...size], boxes: settle(b.list), windows: [] };
}

export function checkStyle(form: string, style: StyleKey): void {
  if (!Object.hasOwn(STYLES, style)) throw new RangeError(`${form}: unknown style ${String(style)}.`);
}

export function checkWhole(form: string, name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${form}: ${name} must be a whole ${min}..${max} cells, not ${value}.`);
  }
}
