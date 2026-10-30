import { HOME_DEPTH_METRES, type ContentWindow, type HomeTier, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '../../materials';

/**
 * The Hearth construction grammar. Every coordinate is a build cell (0.125 m), boxes are half-open and run in
 * order, and material zero carves what came before. The lot is 64 × 160 × 128 cells; the street is +Z.
 */
export const KIT = STYLES.hearth;
export const LOT = [64, 160, 128] as const;
/** Interior floor surface: limestone bed with timber boards, two cells above the meadow. */
export const FLOOR = 2;
/** Plaster walls stand on a projecting limestone base course up to this height. */
export const BASE = 4;
/** Every wall is three cells (0.375 m) thick, so glass can sit in the middle of a real reveal. */
export const WALL = 3;

type Box = VoxelBlueprint['boxes'][number];
export type Facing = ContentWindow['facing'];

export function rearLimit(tier: HomeTier): number {
  return LOT[2] - HOME_DEPTH_METRES[tier] * 8;
}

/** An ordered, bounds-checked list of boxes and the presence windows that belong to them. */
export class Plan {
  readonly boxes: Box[] = [];
  readonly windows: ContentWindow[] = [];
  constructor(readonly id: string, readonly rear: number) {}

  put(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: number): void {
    if (x0 >= x1 || y0 >= y1 || z0 >= z1) return;
    if (x0 < 0 || y0 < 0 || z0 < 0 || x1 > LOT[0] || y1 > LOT[1] || z1 > LOT[2]) {
      throw new Error(`${this.id}: box ${[x0, y0, z0, x1, y1, z1].join(',')} leaves the reserved lot.`);
    }
    if (material !== MAT.air && z0 < this.rear) throw new Error(`${this.id}: box at z=${z0} enters the locked rear land.`);
    this.boxes.push({ from: [x0, y0, z0], to: [x1, y1, z1], material });
  }

  carve(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.put(x0, y0, z0, x1, y1, z1, MAT.air);
  }

  blueprint(): VoxelBlueprint {
    const seen = new Set<string>();
    for (const box of this.boxes) {
      if (box.material === MAT.air) continue;
      const key = JSON.stringify(box);
      if (seen.has(key)) throw new Error(`${this.id}: duplicate solid box ${key}.`);
      seen.add(key);
    }
    return { version: 1, id: this.id, styleId: KIT.id, kind: 'home', lattice: 'build', size: [...LOT], boxes: settle(this.boxes), windows: this.windows };
  }
}

let scratch: Int16Array | undefined;

/**
 * Drops every operation that leaves no trace: a solid box whose cells are all covered again later (a corner post
 * buried by the next wing's wall, studs on a face that a later tier builds against) and an air box that carves
 * nothing that stays carved. Each cell's final value comes from the last box that changed it, and all of those
 * are kept, so the result rasterizes identically with fewer boxes and no hidden geometry.
 */
export function settle(boxes: readonly Box[]): Box[] {
  if (boxes.length > 0x7fff) throw new Error('Too many boxes to settle.');
  // Only the region the boxes touch is rasterized: x across the lot, y to the highest box, z from the deepest.
  const SX = LOT[0];
  let SY = 0, Z0: number = LOT[2];
  for (const { from, to } of boxes) { SY = Math.max(SY, to[1]); Z0 = Math.min(Z0, from[2]); }
  const cells = SX * SY * (LOT[2] - Z0);
  scratch ??= new Int16Array(LOT[0] * LOT[1] * LOT[2]);
  const grid = scratch, air = new Uint8Array(boxes.length), kept = new Uint8Array(boxes.length);
  boxes.forEach((box, k) => { air[k] = box.material === MAT.air ? 1 : 0; });
  // Last to first: a solid box survives where no later box covers it.
  grid.fill(0, 0, cells);
  for (let k = boxes.length - 1; k >= 0; k--) {
    const { from, to } = boxes[k]!;
    let alive = 0;
    for (let z = from[2]; z < to[2]; z++) for (let y = from[1]; y < to[1]; y++) {
      const row = from[0] + SX * (y + SY * (z - Z0)), end = row + to[0] - from[0];
      for (let i = row; i < end; i++) if (!grid[i]) { grid[i] = 1; alive = 1; }
    }
    if (!air[k]) kept[k] = alive;
  }
  // First to last over the surviving solids: a carve survives where it is the last to turn solid into air.
  grid.fill(-1, 0, cells);
  for (let k = 0; k < boxes.length; k++) {
    if (!air[k] && !kept[k]) continue;
    const { from, to } = boxes[k]!;
    for (let z = from[2]; z < to[2]; z++) for (let y = from[1]; y < to[1]; y++) {
      const row = from[0] + SX * (y + SY * (z - Z0)), end = row + to[0] - from[0];
      if (!air[k]) for (let i = row; i < end; i++) grid[i] = k;
      else for (let i = row; i < end; i++) { const o = grid[i]!; if (o >= 0 && !air[o]) grid[i] = k; }
    }
  }
  for (let i = 0; i < cells; i++) { const o = grid[i]!; if (o >= 0 && air[o]) kept[o] = 1; }
  return boxes.filter((_, k) => kept[k]);
}

/**
 * A rectangular gabled range. x/z bounds are the outer wall faces. The ridge runs along `ridge`; the walls
 * parallel to it carry the eaves, the two end walls carry gables.
 */
export interface Wing {
  readonly x0: number; readonly x1: number; readonly z0: number; readonly z1: number;
  readonly wallTop: number;
  readonly ridge: 'x' | 'z';
  /** Overhang past the eave walls and past the gable ends. */
  readonly eave: number; readonly verge: number;
  /** Per-end verge, [low end, high end], when a wing runs in under a larger roof and must stop short. */
  readonly verges?: readonly [number, number];
  /** Tile courses: horizontal tread and vertical rise per course, and slab thickness. */
  readonly tread: number; readonly rise: number; readonly thickness: number;
  /** Which gable ends are built: [low end, high end] along the ridge axis. */
  readonly gables?: readonly [boolean, boolean];
  /** Verge barge boards at each end. Defaults to the built gables. */
  readonly barges?: readonly [boolean, boolean];
  /** A rolled ridge course; small dormer roofs close with their top course instead. */
  readonly cap?: boolean;
}

interface Span { a: number; b: number; mid: number; base: number; courses: number }

export function span(w: Wing): Span {
  const [s0, s1] = w.ridge === 'z' ? [w.x0, w.x1] : [w.z0, w.z1];
  const a = s0 - w.eave, b = s1 + w.eave;
  if ((b - a) % 2) throw new Error('A gabled span must be even so both slopes share one ridge.');
  const mid = (a + b) / 2;
  const base = w.wallTop + w.thickness - w.rise * (Math.floor(w.eave / w.tread) + 1);
  return { a, b, mid, base, courses: Math.ceil((mid - a) / w.tread) };
}

/** Top surface of the roof slab above span coordinate `s` (x for a z ridge, z for an x ridge). */
export function roofTop(w: Wing, s: number): number {
  const { a, b, mid, base } = span(w);
  const i = s < mid ? Math.floor((s - a) / w.tread) : Math.floor((b - 1 - s) / w.tread);
  return base + w.rise * (i + 1);
}

export function ridgeTop(w: Wing): number {
  const { base, courses } = span(w);
  return base + w.rise * courses;
}

/** Writes a box given span and length coordinates, whichever way the wing runs. */
function along(p: Plan, w: Wing, s0: number, s1: number, y0: number, y1: number, l0: number, l1: number, material: number): void {
  if (w.ridge === 'z') p.put(s0, y0, l0, s1, y1, l1, material);
  else p.put(l0, y0, s0, l1, y1, s1, material);
}

/** Limestone base course projecting one cell, solid to the floor until the interior is hollowed. */
export function base(p: Plan, w: Wing): void {
  p.put(w.x0 - 1, 0, w.z0 - 1, w.x1 + 1, BASE, w.z1 + 1, KIT.stone);
}

/** Plaster walls with a chamfered timber post at each corner and a projecting top plate. */
export function walls(p: Plan, w: Wing): void {
  p.put(w.x0, BASE, w.z0, w.x1, w.wallTop, w.z1, KIT.wall);
  const plate = w.wallTop - 2;
  p.put(w.x0 - 1, plate, w.z0 - 1, w.x1 + 1, w.wallTop, w.z1 + 1, KIT.trim);
  for (const x of [w.x0, w.x1 - WALL]) for (const z of [w.z0, w.z1 - WALL]) {
    const ox = x === w.x0 ? -1 : 1, oz = z === w.z0 ? -1 : 1;
    // Two crossed boards leave the outer arris empty: a softened, hand-dressed corner.
    p.put(Math.min(x, x + ox), BASE, z, Math.max(x + WALL, x + WALL + ox), plate, z + WALL, KIT.trim);
    p.put(x, BASE, Math.min(z, z + oz), x + WALL, plate, Math.max(z + WALL, z + WALL + oz), KIT.trim);
  }
}

/** Hollows a wing above the floor, leaving its four walls; run after every wing's walls so joins open up. */
export function hollow(p: Plan, w: Wing): void {
  p.carve(w.x0 + WALL, FLOOR, w.z0 + WALL, w.x1 - WALL, w.wallTop, w.z1 - WALL);
  p.put(w.x0 + WALL, FLOOR - 1, w.z0 + WALL, w.x1 - WALL, FLOOR, w.z1 - WALL, KIT.trim);
}

/** Stepped plaster gables that the roof slab will close over. */
export function gables(p: Plan, w: Wing): void {
  const { a, mid, courses } = span(w);
  const [s0, s1] = w.ridge === 'z' ? [w.x0, w.x1] : [w.z0, w.z1];
  const [l0, l1] = w.ridge === 'z' ? [w.z0, w.z1] : [w.x0, w.x1];
  const ends = w.gables ?? [true, true];
  for (let i = 0; i < courses; i++) {
    const top = roofTop(w, a + i * w.tread);
    const c0 = a + i * w.tread, c1 = Math.min(a + (i + 1) * w.tread, mid);
    for (const [u0, u1] of [[Math.max(s0, c0), Math.min(s1, c1)], [Math.max(s0, 2 * mid - c1), Math.min(s1, 2 * mid - c0)]] as const) {
      if (u0 >= u1 || top <= w.wallTop) continue;
      if (ends[0]) along(p, w, u0, u1, w.wallTop, top - 1, l0, l0 + WALL, KIT.wall);
      if (ends[1]) along(p, w, u0, u1, w.wallTop, top - 1, l1 - WALL, l1, KIT.wall);
    }
  }
}

/** Two broad slopes of terracotta courses, timber barge boards proud of the tiles, and a rolled ridge. */
export function roof(p: Plan, w: Wing): void {
  const { a, mid, courses } = span(w);
  const [v0, v1] = w.verges ?? [w.verge, w.verge];
  const [l0, l1] = w.ridge === 'z' ? [w.z0 - v0, w.z1 + v1] : [w.x0 - v0, w.x1 + v1];
  const barges = w.barges ?? w.gables ?? [true, true];
  const t0 = barges[0] ? l0 + 2 : l0, t1 = barges[1] ? l1 - 2 : l1;
  for (let i = 0; i < courses; i++) {
    const top = roofTop(w, a + i * w.tread);
    const left: [number, number] = [a + i * w.tread, Math.min(a + (i + 1) * w.tread, mid)];
    const right: [number, number] = [2 * mid - left[1], 2 * mid - left[0]];
    for (const [u0, u1] of [left, right]) {
      along(p, w, u0, u1, top - w.thickness, top, t0, t1, KIT.roof);
      if (barges[0]) along(p, w, u0, u1, top - w.thickness, top + 1, l0, t0, KIT.trim);
      if (barges[1]) along(p, w, u0, u1, top - w.thickness, top + 1, t1, l1, KIT.trim);
    }
  }
  if (w.cap === false) return;
  const crest = ridgeTop(w);
  along(p, w, mid - 2, mid + 2, crest, crest + 2, l0 + (barges[0] ? 1 : 0), l1 - (barges[1] ? 1 : 0), KIT.roof);
}

export interface Opening { readonly u0: number; readonly u1: number; readonly y0: number; readonly y1: number }

/** Outer face of a wall: the plane the glass sits one cell behind. */
export interface Face { readonly facing: Facing; readonly plane: number }

export function onFace(p: Plan, face: Face, u0: number, u1: number, y0: number, y1: number, n0: number, n1: number, material: number): void {
  // n is measured outward from the outer wall face: negative values lie inside the wall.
  const out = face.facing === 'south' || face.facing === 'east' ? 1 : -1;
  const a = out > 0 ? face.plane + n0 : face.plane - n1, b = out > 0 ? face.plane + n1 : face.plane - n0;
  if (face.facing === 'south' || face.facing === 'north') p.put(u0, y0, a, u1, y1, b, material);
  else p.put(a, y0, u0, b, y1, u1, material);
}

/**
 * A presence window: a reveal through the whole wall, glass in its middle cell, timber jambs and head and a
 * projecting limestone sill. The anchor rectangle is exactly the glass opening on its outward plane.
 */
export function window(p: Plan, id: string, face: Face, o: Opening, options: { mullion?: boolean } = {}): void {
  const { u0, u1, y0, y1 } = o;
  if ((u1 - u0) % 2 || (y1 - y0) % 2) throw new Error(`${p.id}/${id}: window size must be even to centre its anchor.`);
  onFace(p, face, u0 - 1, u1 + 1, y0 - 1, y1 + 2, -1, 1, KIT.trim);
  onFace(p, face, u0 - 2, u1 + 2, y1, y1 + 2, -1, 1, KIT.trim);
  onFace(p, face, u0 - 2, u1 + 2, y0 - 1, y0, -1, 2, KIT.stone);
  onFace(p, face, u0, u1, y0, y1, -WALL, 1, MAT.air);
  onFace(p, face, u0, u1, y0, y1, -2, -1, MAT.glass);
  if (options.mullion) {
    const m = (u0 + u1) / 2;
    onFace(p, face, m - 1, m + 1, y0, y1, -2, -1, KIT.trim);
  }
  const out = face.facing === 'south' || face.facing === 'east' ? 1 : -1;
  const glassPlane = out > 0 ? face.plane - 1 : face.plane + 1;
  const u = (u0 + u1) / 2, y = (y0 + y1) / 2;
  const centre: [number, number, number] = face.facing === 'south' || face.facing === 'north' ? [u, y, glassPlane] : [glassPlane, y, u];
  p.windows.push({ id, centre, width: u1 - u0, height: y1 - y0, facing: face.facing });
}

/**
 * Exposed timber framing on a plain wall: studs at a steady spacing and a mid rail. Run before openings; every
 * window and door carves its own reveal back through the frame.
 */
export function studs(p: Plan, face: Face, u0: number, u1: number, y1: number, every: number, y0 = BASE, rail: number | null = 14): void {
  for (let u = u0; u + 2 <= u1; u += every) onFace(p, face, u, u + 2, y0, y1, 0, 1, KIT.trim);
  if (rail !== null) onFace(p, face, u0, u1, rail, rail + 2, 0, 1, KIT.trim);
}

/**
 * A jettied upper storey. `ground` is the lower storey (its wallTop is the jetty line, its plate the joist bed);
 * `upper` contains it and oversails on every side where its outer face stands further out. The upper storey
 * sits on a projecting bressummer with the joist ends showing beneath it. Hollow both storeys afterwards with
 * `hollowJetty`, after every other wing's walls, so joins open up.
 */
export function jetty(p: Plan, ground: Wing, upper: Wing): void {
  const at = ground.wallTop;
  p.put(upper.x0, at, upper.z0, upper.x1, upper.wallTop, upper.z1, KIT.wall);
  const plate = upper.wallTop - 2;
  p.put(upper.x0 - 1, plate, upper.z0 - 1, upper.x1 + 1, upper.wallTop, upper.z1 + 1, KIT.trim);
  for (const x of [upper.x0, upper.x1 - WALL]) for (const z of [upper.z0, upper.z1 - WALL]) {
    const ox = x === upper.x0 ? -1 : 1, oz = z === upper.z0 ? -1 : 1;
    p.put(Math.min(x, x + ox), at, z, Math.max(x + WALL, x + WALL + ox), plate, z + WALL, KIT.trim);
    p.put(x, at, Math.min(z, z + oz), x + WALL, plate, Math.max(z + WALL, z + WALL + oz), KIT.trim);
  }
  const sides: Face[] = [];
  if (upper.x0 < ground.x0) sides.push({ facing: 'west', plane: upper.x0 });
  if (upper.x1 > ground.x1) sides.push({ facing: 'east', plane: upper.x1 });
  if (upper.z0 < ground.z0) sides.push({ facing: 'north', plane: upper.z0 });
  if (upper.z1 > ground.z1) sides.push({ facing: 'south', plane: upper.z1 });
  for (const face of sides) {
    const [u0, u1] = face.facing === 'west' || face.facing === 'east' ? [upper.z0, upper.z1] : [upper.x0, upper.x1];
    // Bressummer: a deep moulded beam one cell proud of the upper wall, the full width of the jetty.
    onFace(p, face, u0 - 1, u1 + 1, at, at + 2, 0, 1, KIT.trim);
    // Joist ends, one every three cells, carry it over the plate of the storey below.
    const back = face.facing === 'west' ? ground.x0 - upper.x0 : face.facing === 'east' ? upper.x1 - ground.x1 : face.facing === 'north' ? ground.z0 - upper.z0 : upper.z1 - ground.z1;
    for (let u = u0 + 1; u + 1 <= u1 - 1; u += 3) onFace(p, face, u, u + 1, at - 2, at, -back, 1, KIT.trim);
  }
}

/** Hollows a jettied pair: the ground storey to the jetty line, the oversailing storey above it. */
export function hollowJetty(p: Plan, ground: Wing, upper: Wing): void {
  hollow(p, ground);
  p.carve(upper.x0 + WALL, ground.wallTop, upper.z0 + WALL, upper.x1 - WALL, upper.wallTop, upper.z1 - WALL);
}

/**
 * Clears everything inside a wing's walls between its wall plate and the underside of its own roof, so a roof
 * laid earlier by a neighbouring wing never runs on through this wing's room. Run before `roof(w)`.
 */
export function attic(p: Plan, w: Wing): void {
  const { a, mid, courses } = span(w);
  const [s0, s1] = w.ridge === 'z' ? [w.x0 + WALL, w.x1 - WALL] : [w.z0 + WALL, w.z1 - WALL];
  const [l0, l1] = w.ridge === 'z' ? [w.z0 + WALL, w.z1 - WALL] : [w.x0 + WALL, w.x1 - WALL];
  for (let i = 0; i < courses; i++) {
    const under = roofTop(w, a + i * w.tread) - w.thickness;
    const c0 = a + i * w.tread, c1 = Math.min(a + (i + 1) * w.tread, mid);
    for (const [u0, u1] of [[Math.max(s0, c0), Math.min(s1, c1)], [Math.max(s0, 2 * mid - c1), Math.min(s1, 2 * mid - c0)]] as const) {
      if (u0 < u1 && under > w.wallTop) along(p, w, u0, u1, w.wallTop, under, l0, l1, MAT.air);
    }
  }
}

/** A small gabled hood over a door, carried on two stepped timber brackets; its eaves start at `y`. */
export function hood(p: Plan, face: Face, centre: number, y: number): void {
  const a = centre - 9, b = centre + 9;
  for (let i = 0; i < 9; i++) {
    const top = y + i;
    for (const [u0, u1] of [[a + i, a + i + 1], [b - i - 1, b - i]] as const) {
      onFace(p, face, u0, u1, top - 2, top, -3, 3, KIT.roof);
      onFace(p, face, u0, u1, top - 2, top + 1, 3, 4, KIT.trim);
    }
  }
  onFace(p, face, centre - 1, centre + 1, y + 9, y + 10, -3, 4, KIT.roof);
  for (const u of [a + 1, b - 3]) {
    onFace(p, face, u, u + 2, y - 11, y, 0, 1, KIT.trim);
    onFace(p, face, u, u + 2, y - 6, y, 1, 2, KIT.trim);
    onFace(p, face, u, u + 2, y - 3, y, 2, 3, KIT.trim);
  }
}

/** A planted timber trough hung below a sill, never in front of the glass. */
export function trough(p: Plan, face: Face, u0: number, u1: number, sillY: number, flowers: number): void {
  onFace(p, face, u0, u1, sillY - 4, sillY - 2, 0, 3, KIT.trim);
  onFace(p, face, u0 + 1, u1 - 1, sillY - 2, sillY - 1, 1, 3, MAT.leaf);
  for (let u = u0 + 2; u + 2 <= u1 - 1; u += 4) onFace(p, face, u, u + 2, sillY - 2, sillY - 1, 1, 3, flowers);
}

/**
 * An always-open doorway with a stepped head, timber frame, flush limestone threshold, a doorstep one cell
 * high and the plank leaf standing open against the inside wall. Returns the opening's focus cell.
 */
export function doorway(p: Plan, face: Face, centre: number, height: number, hinge: 'low' | 'high', step = true): [number, number, number] {
  const half = 6, top = FLOOR + height;
  onFace(p, face, centre - half - 1, centre + half + 1, BASE, top + 2, -1, 1, KIT.trim);
  onFace(p, face, centre - half - 2, centre + half + 2, top + 1, top + 3, -1, 1, KIT.trim);
  onFace(p, face, centre - half, centre + half, FLOOR, top, -WALL, 1, MAT.air);
  onFace(p, face, centre - half + 2, centre + half - 2, top, top + 1, -WALL, 1, MAT.air);
  onFace(p, face, centre - half, centre + half, 0, FLOOR, -WALL, 0, KIT.stone);
  if (step) onFace(p, face, centre - half - 2, centre + half + 2, 0, 1, 0, 4, KIT.stone);
  // The leaf is swung fully inward and rests along the inner reveal.
  const u = hinge === 'low' ? centre - half - 1 : centre + half;
  onFace(p, face, u, u + 1, FLOOR, top - 1, -WALL - 11, -WALL, KIT.trim);
  const inward = face.facing === 'south' || face.facing === 'east' ? -2 : 1;
  const n = face.plane + inward;
  const mid = FLOOR + Math.floor(height / 2);
  return face.facing === 'south' || face.facing === 'north' ? [centre, mid, n] : [n, mid, centre];
}

/**
 * An open passage between two rooms through a shared wall: timber jambs and a two-cell lintel, floor flush with
 * both rooms. `normal` is the axis the passage runs along; u spans the opening, n the wall thickness.
 */
export function passage(p: Plan, normal: 'x' | 'z', u0: number, u1: number, n0: number, n1: number, top: number): void {
  const put = (a0: number, a1: number, y0: number, y1: number, material: number) => {
    if (normal === 'z') p.put(a0, y0, n0, a1, y1, n1, material);
    else p.put(n0, y0, a0, n1, y1, a1, material);
  };
  put(u0 - 1, u1 + 1, FLOOR, top + 2, KIT.trim);
  put(u0, u1, FLOOR, top, MAT.air);
}

/**
 * A stout stone chimney built against a wall from the ground: a broad base, shouldered weatherings, a stack
 * with a corbelled cap, a dark flue and two terracotta pots.
 */
export function chimney(p: Plan, x0: number, x1: number, z0: number, z1: number, shoulder: number, top: number, side: 'east' | 'west' | 'none'): void {
  p.put(x0, 0, z0, x1, shoulder, z1, KIT.stone);
  const inset = side === 'east' ? [0, 2] : side === 'west' ? [2, 0] : [1, 1];
  const sx0 = x0 + inset[0]!, sx1 = x1 - inset[1]!;
  p.put(x0 + (side === 'east' ? 0 : 1), shoulder, z0 + 1, x1 - (side === 'west' ? 0 : 1), shoulder + 2, z1 - 1, KIT.stone);
  p.put(sx0, shoulder + 2, z0 + 2, sx1, top, z1 - 2, KIT.stone);
  // Projecting string courses break the tall stack into readable lifts.
  for (let y = shoulder + 12; y + 12 < top; y += 12) p.put(sx0 - 1, y, z0 + 1, sx1 + 1, y + 1, z1 - 1, KIT.stone);
  p.put(sx0 - 1, top, z0 + 1, sx1 + 1, top + 2, z1 - 1, KIT.stone);
  p.put(sx0 - 1, top + 2, z0 + 1, sx1 + 1, top + 3, z1 - 1, KIT.trim);
  const cx = Math.floor((sx0 + sx1) / 2), cz0 = z0 + 3, cz1 = z1 - 3;
  p.put(cx - 2, top + 3, cz0, cx + 1, top + 6, cz0 + 3, KIT.roof);
  p.put(cx - 1, top + 3, cz1 - 3, cx + 2, top + 5, cz1, KIT.roof);
  p.carve(cx - 1, top + 3, cz0 + 1, cx, top + 6, cz0 + 2);
  p.carve(cx, top + 3, cz1 - 2, cx + 1, top + 5, cz1 - 1);
}

/**
 * Where a lower roof crosses under a higher one at right angles, fills between the higher roof's tiles and the
 * lower roof's slab, so the lower slopes come down onto the higher ones in clean valleys instead of floating over
 * them. Run after both roofs are laid.
 */
export function meet(p: Plan, lower: Wing, upper: Wing): void {
  if (lower.ridge === upper.ridge) throw new Error(`${p.id}: only crossing roofs meet in valleys.`);
  const L = span(lower), U = span(upper);
  const [lv0, lv1] = lower.verges ?? [lower.verge, lower.verge];
  const [uv0, uv1] = upper.verges ?? [upper.verge, upper.verge];
  const lowerLength = lower.ridge === 'x' ? [lower.x0 - lv0, lower.x1 + lv1] : [lower.z0 - lv0, lower.z1 + lv1];
  const upperLength = upper.ridge === 'x' ? [upper.x0 - uv0, upper.x1 + uv1] : [upper.z0 - uv0, upper.z1 + uv1];
  const strips = (w: Wing, s: Span, lo: number, hi: number) => {
    const out: [number, number, number][] = [];
    for (let i = 0; i < s.courses; i++) {
      const c0 = s.a + i * w.tread, c1 = Math.min(s.a + (i + 1) * w.tread, s.mid), top = roofTop(w, c0);
      for (const [u0, u1] of [[c0, c1], [2 * s.mid - c1, 2 * s.mid - c0]] as const) {
        if (Math.max(u0, lo) < Math.min(u1, hi)) out.push([Math.max(u0, lo), Math.min(u1, hi), top]);
      }
    }
    return out;
  };
  for (const [c0, c1, high] of strips(lower, L, upperLength[0]!, upperLength[1]!)) {
    for (const [d0, d1, low] of strips(upper, U, lowerLength[0]!, lowerLength[1]!)) {
      const y1 = high - lower.thickness;
      if (y1 <= low) continue;
      if (upper.ridge === 'z') p.put(d0, low, c0, d1, y1, c1, KIT.roof);
      else p.put(c0, low, d0, c1, y1, d1, KIT.roof);
    }
  }
}
