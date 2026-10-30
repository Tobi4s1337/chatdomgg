import { HOME_DEPTH_METRES, RESERVED_LOT_METRES, VOXEL_METRES, type ContentWindow, type HomeTier, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '../../materials';

/**
 * Salt & slate construction grammar. Every helper emits ordered half-open boxes in build cells; the families
 * compose them into whole shells. Solid boxes may set a course or stone into an earlier wall (an ordered material
 * break-up), and `MAT.air` carves openings, never decoration.
 */
export const KIT = STYLES.tide;
export const WALL = KIT.wall;
export const ROOF = KIT.roof;
export const TRIM = KIT.trim;
export const STONE = KIT.stone;

const cells = (metres: number) => Math.round(metres / VOXEL_METRES.build);
export const LOT = [cells(RESERVED_LOT_METRES[0]), cells(RESERVED_LOT_METRES[1]), cells(RESERVED_LOT_METRES[2])] as const;
/** Outer face of the street facade. Every family keeps its front within a cell or two of this plane. */
export const FACADE = 124;
/** Interior floor surface: flags at y=0, boards at y=1, people stand on y=2. */
export const FLOOR = 2;
export const DOOR = { width: 12, height: 21 } as const;

/** First z of the tier's active prism; everything behind it is the locked rear land. */
export const activeRear = (tier: HomeTier) => LOT[2] - cells(HOME_DEPTH_METRES[tier]);

export type Facing = ContentWindow['facing'];
type Box = VoxelBlueprint['boxes'][number];
type Vec3 = [number, number, number];

export class Shell {
  readonly boxes: Box[] = [];
  readonly windows: ContentWindow[] = [];

  /** Places one half-open box. Authoring mistakes (inverted or out-of-lot boxes) fail loudly. */
  put(material: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const from: Vec3 = [x0, y0, z0], to: Vec3 = [x1, y1, z1];
    if ([...from, ...to].some(v => !Number.isInteger(v))) throw new Error(`Box coordinates must be integers: ${from}→${to}`);
    if (from.some((v, axis) => v >= to[axis]!)) throw new Error(`Empty or inverted box ${from}→${to}`);
    if (from.some(v => v < 0) || to.some((v, axis) => v > LOT[axis]!)) throw new Error(`Box ${from}→${to} leaves the reserved lot`);
    this.boxes.push({ from, to, material });
  }

  air(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.put(MAT.air, x0, y0, z0, x1, y1, z1);
  }

  /** A box in facade coordinates: u runs along the face, d is depth outward from the face plane. */
  face(face: Face, material: number, u0: number, u1: number, y0: number, y1: number, d0: number, d1: number): void {
    const [n0, n1] = face.facing === 'south' || face.facing === 'east' ? [face.plane + d0, face.plane + d1] : [face.plane - d1, face.plane - d0];
    if (face.facing === 'south' || face.facing === 'north') this.put(material, u0, y0, n0, u1, y1, n1);
    else this.put(material, n0, y0, u0, n1, y1, u1);
  }

  blueprint(id: string): VoxelBlueprint {
    return { version: 1, id, styleId: KIT.id, kind: 'home', lattice: 'build', size: [...LOT], boxes: this.boxes, windows: this.windows };
  }
}

/** An outer wall face. `plane` is the coordinate of the exterior surface on the face's normal axis. */
export interface Face { facing: Facing; plane: number }
export const south = (plane: number): Face => ({ facing: 'south', plane });
export const north = (plane: number): Face => ({ facing: 'north', plane });
export const east = (plane: number): Face => ({ facing: 'east', plane });
export const west = (plane: number): Face => ({ facing: 'west', plane });

/* ------------------------------------------------------------------------------------------------------------ */
/* Footprints: walls, plinths and floors follow one authored plan instead of hand-matched rectangles.            */

export class Plan {
  private readonly mask = new Uint8Array(LOT[0] * LOT[2]);

  add(x0: number, z0: number, x1: number, z1: number): this { return this.fill(x0, z0, x1, z1, 1); }
  cut(x0: number, z0: number, x1: number, z1: number): this { return this.fill(x0, z0, x1, z1, 0); }
  has(x: number, z: number): boolean { return x >= 0 && z >= 0 && x < LOT[0] && z < LOT[2] && this.mask[x + LOT[0] * z] === 1; }

  /** Cells within `thickness` (square metric) of the outside: the wall band. */
  band(thickness: number): Uint8Array {
    const inner = this.eroded(thickness), out = new Uint8Array(this.mask.length);
    for (let i = 0; i < out.length; i++) out[i] = this.mask[i]! && !inner[i] ? 1 : 0;
    return out;
  }

  interior(thickness: number): Uint8Array { return this.eroded(thickness); }

  /** Plinth cells on the shaded north side: those directly behind the plan. */
  northRing(reach: number): Uint8Array {
    const ring = this.ring(reach);
    for (let z = 0; z < LOT[2]; z++) for (let x = 0; x < LOT[0]; x++) {
      let behind = false;
      for (let d = 1; d <= reach; d++) behind ||= this.has(x, z + d);
      if (!behind) ring[x + LOT[0] * z] = 0;
    }
    return ring;
  }

  /** Cells outside the plan but within `reach` of it: plinth courses and drip bands. */
  ring(reach: number): Uint8Array {
    let grown: Uint8Array = this.mask.slice();
    for (let step = 0; step < reach; step++) grown = morph(grown, true);
    for (let i = 0; i < grown.length; i++) if (this.mask[i]) grown[i] = 0;
    return grown;
  }

  private eroded(thickness: number): Uint8Array {
    let current: Uint8Array = this.mask.slice();
    for (let step = 0; step < thickness; step++) current = morph(current, false);
    return current;
  }

  private fill(x0: number, z0: number, x1: number, z1: number, value: 0 | 1): this {
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) this.mask[x + LOT[0] * z] = value;
    return this;
  }
}

function morph(source: Uint8Array, grow: boolean): Uint8Array {
  const out = new Uint8Array(source.length), [sx, sz] = [LOT[0], LOT[2]];
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    let any = false, all = true;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, nz = z + dz;
      const on = nx >= 0 && nz >= 0 && nx < sx && nz < sz && source[nx + sx * nz] === 1;
      any ||= on; all &&= on;
    }
    out[x + sx * z] = (grow ? any : all) ? 1 : 0;
  }
  return out;
}

export interface Rect { x0: number; z0: number; x1: number; z1: number }

/** Greedy rectangles over a plan mask, optionally clipped, so a footprint becomes a few broad boxes. */
export function rects(mask: Uint8Array, clip: Rect = { x0: 0, z0: 0, x1: LOT[0], z1: LOT[2] }): Rect[] {
  const sx = LOT[0], used = new Uint8Array(mask.length), out: Rect[] = [];
  const on = (x: number, z: number) => x >= clip.x0 && x < clip.x1 && z >= clip.z0 && z < clip.z1 && mask[x + sx * z] === 1 && !used[x + sx * z];
  for (let z = clip.z0; z < clip.z1; z++) for (let x = clip.x0; x < clip.x1; x++) {
    if (!on(x, z)) continue;
    let x1 = x + 1;
    while (on(x1, z)) x1++;
    let z1 = z + 1;
    while (z1 < clip.z1 && Array.from({ length: x1 - x }, (_, i) => on(x + i, z1)).every(Boolean)) z1++;
    for (let zz = z; zz < z1; zz++) for (let xx = x; xx < x1; xx++) used[xx + sx * zz] = 1;
    out.push({ x0: x, z0: z, x1, z1 });
  }
  return out;
}

export function extrude(shell: Shell, mask: Uint8Array, material: number, y0: number, y1: number, clip?: Rect): void {
  for (const r of rects(mask, clip)) shell.put(material, r.x0, y0, r.z0, r.x1, y1, r.z1);
}

/** Stone flags with a boarded floor laid over them, inside the wall band. */
export function floor(shell: Shell, plan: Plan, wall: number, boards = TRIM): void {
  const inside = plan.interior(wall);
  extrude(shell, inside, STONE, 0, 1);
  extrude(shell, inside, boards, 1, FLOOR);
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Slate roofs: three-cell courses stepping two cells inward, so each row casts its own drip shadow.             */

export interface Gable {
  /** The ridge runs along this axis; the slopes face across it. */
  ridge: 'x' | 'z';
  /** Outer eave edges across the ridge, half-open, including overhang. */
  lo: number; hi: number;
  /** Bottom of the first course on each side; a higher base makes an asymmetric gable. */
  baseLo: number; baseHi: number;
  /** Extent along the ridge, including verge overhang. */
  along: readonly [number, number];
  rise?: number; run?: number; thick?: number;
}

export interface Course { a0: number; a1: number; y0: number; y1: number; side: 'lo' | 'hi' | 'crest' }

/** The course rows of a gable roof from eave to crest; pure geometry, shared by roof, gable walls and tests. */
export function gableCourses(g: Gable): Course[] {
  const rise = g.rise ?? 3, run = g.run ?? 2, thick = g.thick ?? 5;
  if ((g.baseHi - g.baseLo) % rise !== 0) throw new Error('Gable bases must share a course rhythm');
  const out: Course[] = [];
  const start = Math.min(g.baseLo, g.baseHi);
  for (let y = start; ; y += rise) {
    const lo = y >= g.baseLo ? g.lo + run * ((y - g.baseLo) / rise) : g.lo;
    const hi = y >= g.baseHi ? g.hi - run * ((y - g.baseHi) / rise) : g.hi;
    if (hi - lo <= 0) break;
    if (hi - lo <= 2 * thick) { out.push({ a0: lo, a1: hi, y0: y, y1: y + rise, side: 'crest' }); continue; }
    if (y >= g.baseLo) out.push({ a0: lo, a1: lo + thick, y0: y, y1: y + rise, side: 'lo' });
    if (y >= g.baseHi) out.push({ a0: hi - thick, a1: hi, y0: y, y1: y + rise, side: 'hi' });
  }
  return out;
}

const across = (shell: Shell, ridge: 'x' | 'z', material: number, a0: number, a1: number, y0: number, y1: number, l0: number, l1: number) =>
  ridge === 'z' ? shell.put(material, a0, y0, l0, a1, y1, l1) : shell.put(material, l0, y0, a0, l1, y1, a1);

export interface RoofTrim {
  /** Timber bargeboard under each course at these ridge-axis ends ('hi' is the +x/+z verge). */
  barge?: readonly ('lo' | 'hi')[];
  /** Ridge board material; omitted for a plain slate crest. */
  cap?: number;
}

export function gableRoof(shell: Shell, g: Gable, trim: RoofTrim = {}): { top: number; ridge: number } {
  const courses = gableCourses(g);
  const [l0, l1] = g.along;
  for (const c of courses) across(shell, g.ridge, ROOF, c.a0, c.a1, c.y0, c.y1, l0, l1);
  for (const end of trim.barge ?? []) for (const c of courses) {
    const [b0, b1] = end === 'lo' ? [l0, l0 + 1] : [l1 - 1, l1];
    across(shell, g.ridge, TRIM, c.a0, c.a1, c.y0, c.y0 + 1, b0, b1);
  }
  const crest = courses.at(-1)!;
  const top = crest.y1, ridge = Math.floor((crest.a0 + crest.a1) / 2);
  if (trim.cap !== undefined) across(shell, g.ridge, trim.cap, crest.a0 - 1, crest.a1 + 1, top, top + 2, l0, l1);
  return { top: trim.cap === undefined ? top : top + 2, ridge };
}

/** Fills a gable end wall up under its roof, between the wall's own side faces. Place before the roof. */
export function gableWall(shell: Shell, g: Gable, from: number, wallLo: number, wallHi: number, l0: number, l1: number, material: number = WALL): void {
  const courses = gableCourses(g);
  for (const y0 of new Set(courses.map(c => c.y0))) {
    const row = courses.filter(c => c.y0 === y0), crest = row.find(c => c.side === 'crest');
    const y1 = y0 + (g.rise ?? 3);
    if (y1 <= from) continue;
    const lo = Math.max(wallLo, crest?.a0 ?? row.find(c => c.side === 'lo')?.a0 ?? wallLo);
    const hi = Math.min(wallHi, crest?.a1 ?? row.find(c => c.side === 'hi')?.a1 ?? wallHi);
    if (hi > lo) across(shell, g.ridge, material, lo, hi, Math.max(from, y0), y1, l0, l1);
  }
}

export interface Hip {
  x0: number; z0: number; x1: number; z1: number; base: number;
  rise?: number; run?: number; thick?: number;
  /** A side left without a slope, where the roof leans against a taller wall. */
  open?: 'south';
  /** Stop after this many courses and close the remainder flat against that wall. */
  courses?: number;
  /**
   * With an open south side: where each ring stops, so a lower wing's slopes run on until they die into the
   * course of the taller roof at the same height instead of ending in a cut section.
   */
  southAt?: (ring: number) => number;
}

/** A hipped roof of shrinking course rings; the last rectangle is its ridge. */
export function hipRoof(shell: Shell, h: Hip, cap?: number): { top: number } {
  const rise = h.rise ?? 2, run = h.run ?? 2, thick = h.thick ?? 4, limit = h.courses ?? Infinity;
  let top = h.base, last: Rect | undefined;
  for (let k = 0; k < limit; k++) {
    const r = { x0: h.x0 + run * k, z0: h.z0 + run * k, x1: h.x1 - run * k, z1: h.open === 'south' ? h.southAt?.(k) ?? h.z1 : h.z1 - run * k };
    if (r.x1 <= r.x0 || r.z1 <= r.z0) break;
    const y0 = h.base + rise * k, y1 = y0 + rise;
    const closing = k === limit - 1;
    if (closing || r.x1 - r.x0 <= 2 * thick || r.z1 - r.z0 <= 2 * thick) shell.put(ROOF, r.x0, y0, r.z0, r.x1, y1, r.z1);
    else {
      const south = h.open === 'south' ? r.z1 : r.z1 - thick;
      shell.put(ROOF, r.x0, y0, r.z0, r.x1, y1, r.z0 + thick);
      if (h.open !== 'south') shell.put(ROOF, r.x0, y0, south, r.x1, y1, r.z1);
      shell.put(ROOF, r.x0, y0, r.z0 + thick, r.x0 + thick, y1, south);
      shell.put(ROOF, r.x1 - thick, y0, r.z0 + thick, r.x1, y1, south);
    }
    top = y1; last = r;
  }
  if (cap !== undefined && last) {
    const midZ = last.z0 + Math.floor((last.z1 - last.z0) / 2), midX = last.x0 + Math.floor((last.x1 - last.x0) / 2);
    if (last.x1 - last.x0 >= last.z1 - last.z0) shell.put(cap, last.x0, top, midZ - 1, last.x1, top + 2, midZ + 1);
    else shell.put(cap, midX - 1, top, last.z0, midX + 1, top + 2, last.z1);
    top += 2;
  }
  return { top };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Openings.                                                                                                    */

export interface WindowSpec {
  id: string;
  /** Lower-left corner of the glass in facade coordinates; width and height are even so the anchor is a cell. */
  u: number; y: number; w: number; h: number;
  /** Wall thickness to carve through, and how far the glass sits back from the face. */
  wall: number; recess: number;
  mullion?: boolean;
  transom?: number;
  sill?: number;
  head?: number;
}

/** A framed, inset casement and its executable presence anchor on the outward glass plane. */
export function windowIn(shell: Shell, face: Face, s: WindowSpec): void {
  if (s.w % 2 || s.h % 2) throw new Error(`${s.id}: window size must be even`);
  const { u, y, w, h, wall, recess } = s;
  // Sill and head are set into the wall first; the opening is then carved through.
  if (s.sill !== undefined) shell.face(face, s.sill, u - 2, u + w + 2, y - 2, y - 1, -wall, 2);
  if (s.head !== undefined) shell.face(face, s.head, u - 2, u + w + 2, y + h + 1, y + h + 3, -wall, 1);
  shell.face(face, MAT.air, u - 1, u + w + 1, y - 1, y + h + 1, -wall, 0);
  if (s.sill !== undefined) shell.face(face, s.sill, u - 1, u + w + 1, y - 1, y, -recess - 2, -recess);
  const back = -recess - 2, front = -recess;
  shell.face(face, TRIM, u - 1, u + w + 1, y + h, y + h + 1, back, front);
  if (s.sill === undefined) shell.face(face, TRIM, u - 1, u + w + 1, y - 1, y, back, front);
  shell.face(face, TRIM, u - 1, u, y, y + h, back, front);
  shell.face(face, TRIM, u + w, u + w + 1, y, y + h, back, front);
  shell.face(face, MAT.glass, u, u + w, y, y + h, front - 1, front);
  if (s.mullion) shell.face(face, TRIM, u + w / 2 - 1, u + w / 2 + 1, y, y + h, back, front);
  if (s.transom !== undefined) shell.face(face, TRIM, u, u + w, s.transom, s.transom + 1, back, front);
  const plane = face.facing === 'south' || face.facing === 'east' ? face.plane - recess : face.plane + recess;
  const centre: Vec3 = face.facing === 'south' || face.facing === 'north' ? [u + w / 2, y + h / 2, plane] : [plane, y + h / 2, u + w / 2];
  shell.windows.push({ id: s.id, centre, width: w, height: h, facing: face.facing });
}

/**
 * An open doorway with a rounded head, a dressed stone surround and a worn, half-round step.
 * Returns the bench focus: the middle of the opening, about halfway up.
 */
export function doorway(shell: Shell, face: Face, u: number, wall: number, surround: number = STONE, step = true): Vec3 {
  const w = DOOR.width, top = FLOOR + DOOR.height;
  shell.face(face, surround, u - 2, u + w + 2, 0, top + 4, -wall, 1);
  shell.face(face, MAT.air, u, u + w, FLOOR, top, -wall - 1, 2);
  shell.face(face, MAT.air, u + 1, u + w - 1, top, top + 1, -wall - 1, 2);
  shell.face(face, MAT.air, u + 3, u + w - 3, top + 1, top + 2, -wall - 1, 2);
  // The threshold continues the floor through the wall, flush with the boards inside.
  shell.face(face, STONE, u, u + w, 0, FLOOR, -wall, 1);
  if (step) {
    shell.face(face, STONE, u - 2, u + w + 2, 0, 1, 1, 2);
    shell.face(face, STONE, u - 1, u + w + 1, 0, 1, 2, 3);
    shell.face(face, STONE, u + 2, u + w - 2, 0, 1, 3, 4);
  }
  const d = -Math.floor(wall / 2) - 1;
  const n = face.facing === 'south' || face.facing === 'east' ? face.plane + d : face.plane - d - 1;
  const y = FLOOR + Math.floor(DOOR.height / 2);
  return face.facing === 'south' || face.facing === 'north' ? [u + w / 2, y, n] : [n, y, u + w / 2];
}

/** Alternating long and short quoin stones up a corner, set into the wall courses. */
export function quoins(shell: Shell, x: number, z: number, xDir: 1 | -1, zDir: 1 | -1, y0: number, y1: number, size = 3): void {
  for (let y = y0, i = 0; y < y1; y += size, i++) {
    const along = i % 2 === 0 ? 5 : 3, side = i % 2 === 0 ? 3 : 5;
    const top = Math.min(y + size, y1);
    const xs = xDir > 0 ? [x, x + along] : [x - along, x];
    const zs = zDir > 0 ? [z, z + side] : [z - side, z];
    shell.put(STONE, xs[0]!, y, z + (zDir > 0 ? 0 : -1), xs[1]!, top, z + (zDir > 0 ? 1 : 0));
    shell.put(STONE, x + (xDir > 0 ? 0 : -1), y, zs[0]!, x + (xDir > 0 ? 1 : 0), top, zs[1]!);
  }
}

export interface Chimney { x: number; z: number; w: number; d: number; base: number; top: number; lean?: readonly [number, number] }

/** A stone stack with a one-cell crook halfway, a corbelled cap, a slate drip and an open flue. */
export function chimney(shell: Shell, c: Chimney): number {
  const [lx, lz] = c.lean ?? [1, 0];
  const mid = c.base + Math.floor((c.top - c.base) * 0.6);
  shell.put(STONE, c.x, c.base, c.z, c.x + c.w, mid, c.z + c.d);
  shell.put(STONE, c.x + lx, mid, c.z + lz, c.x + c.w + lx, c.top, c.z + c.d + lz);
  const x = c.x + lx, z = c.z + lz;
  shell.put(STONE, x - 1, c.top, z - 1, x + c.w + 1, c.top + 2, z + c.d + 1);
  shell.put(ROOF, x - 1, c.top + 2, z - 1, x + c.w + 1, c.top + 3, z + c.d + 1);
  shell.put(STONE, x + 1, c.top + 3, z + 1, x + c.w - 1, c.top + 6, z + c.d - 1);
  shell.air(x + 2, c.top + 1, z + 2, x + c.w - 2, c.top + 6, z + c.d - 2);
  return c.top + 6;
}
