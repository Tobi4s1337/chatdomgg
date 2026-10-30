import type { HomeTier } from '@chatdom/shared';
import { MAT, STYLES } from '../materials';
import { TemplatePlan, anchor, onFace, templateId, type BuiltTemplate, type Face } from './plan';

/**
 * Hearth & heather starting shapes. Plaster walls stand on a projecting limestone plinth, held by stout timber
 * posts and a wall plate; roofs are steep terracotta gables with timber barge boards; windows sit deep in warm
 * reveals with a timber head and a limestone sill. All coordinates are build cells (0.125 m), boxes are half-open
 * and run in order, and the street is +Z.
 */
const KIT = STYLES.hearth;
/** Floor boards fill y=0; feet stand at y=1, one gentle step above the street. */
export const HEARTH_FEET = 1;
/** Limestone plinth height; plaster walls begin on top of it. */
const PLINTH = 3;
/** Walls are three cells (0.375 m) thick so glass sits in the middle of a real reveal. */
const WALL = 3;

/** One gabled range: outer wall faces, wall-plate height and its steep terracotta roof. */
interface Range {
  readonly x0: number; readonly x1: number; readonly z0: number; readonly z1: number;
  readonly wallTop: number;
  /** Ridge axis; the walls parallel to it carry the eaves and the end walls carry the gables. */
  readonly ridge: 'x' | 'z';
  readonly eave: number; readonly verge: number;
  readonly tread: number; readonly rise: number; readonly thickness: number;
}

interface Span { a: number; b: number; mid: number; base: number; courses: number }

function span(r: Range): Span {
  const [s0, s1] = r.ridge === 'z' ? [r.x0, r.x1] : [r.z0, r.z1];
  const a = s0 - r.eave, b = s1 + r.eave;
  if ((b - a) % 2) throw new Error('A gabled span must be even so both slopes share one ridge.');
  const mid = (a + b) / 2;
  // The course that lands on the wall face has its slab resting exactly on the wall plate.
  const base = r.wallTop + r.thickness - r.rise * (Math.floor(r.eave / r.tread) + 1);
  return { a, b, mid, base, courses: Math.ceil((mid - a) / r.tread) };
}

/** Top of the roof slab for course `i`, counted from the eave. */
function courseTop(r: Range, i: number): number { return span(r).base + r.rise * (i + 1); }

/** Each course as two mirrored strips across the span. */
function courses(r: Range): { i: number; strips: [number, number][]; top: number }[] {
  const { a, mid, courses: count } = span(r);
  return Array.from({ length: count }, (_, i) => {
    const c0 = a + i * r.tread, c1 = Math.min(a + (i + 1) * r.tread, mid);
    return { i, strips: [[c0, c1], [2 * mid - c1, 2 * mid - c0]], top: courseTop(r, i) };
  });
}

function along(p: TemplatePlan, r: Range, s0: number, s1: number, y0: number, y1: number, l0: number, l1: number, material: number): void {
  if (r.ridge === 'z') p.put(s0, y0, l0, s1, y1, l1, material);
  else p.put(l0, y0, s0, l1, y1, s1, material);
}

/** Plinth, plaster walls, stout corner posts and a projecting wall plate, solid until `hollow` runs. */
function shell(p: TemplatePlan, r: Range): void {
  p.put(r.x0 - 1, 0, r.z0 - 1, r.x1 + 1, PLINTH, r.z1 + 1, KIT.stone);
  p.put(r.x0, PLINTH, r.z0, r.x1, r.wallTop, r.z1, KIT.wall);
  const plate = r.wallTop - 2;
  p.put(r.x0 - 1, plate, r.z0 - 1, r.x1 + 1, r.wallTop, r.z1 + 1, KIT.trim);
  // Square timber posts one cell proud on both faces: the corners read as structure, not as plaster.
  for (const [x, z] of [[r.x0 - 1, r.z0 - 1], [r.x1 - WALL, r.z0 - 1], [r.x0 - 1, r.z1 - WALL], [r.x1 - WALL, r.z1 - WALL]] as const) {
    p.put(x, PLINTH, z, x + WALL + 1, plate, z + WALL + 1, KIT.trim);
  }
}

/** Opens the room: everything inside the walls above the floor, with timber boards laid at y=0. */
function hollow(p: TemplatePlan, r: Range): void {
  p.carve(r.x0 + WALL, HEARTH_FEET, r.z0 + WALL, r.x1 - WALL, r.wallTop, r.z1 - WALL);
  p.put(r.x0 + WALL, 0, r.z0 + WALL, r.x1 - WALL, HEARTH_FEET, r.z1 - WALL, KIT.trim);
}

/** Plaster gable ends stepped up under each roof course so the roof closes over them without gaps. */
function gables(p: TemplatePlan, r: Range): void {
  const [s0, s1] = r.ridge === 'z' ? [r.x0, r.x1] : [r.z0, r.z1];
  const [l0, l1] = r.ridge === 'z' ? [r.z0, r.z1] : [r.x0, r.x1];
  for (const { strips, top } of courses(r)) for (const [c0, c1] of strips) {
    const u0 = Math.max(s0, c0), u1 = Math.min(s1, c1);
    if (u0 >= u1 || top - 1 <= r.wallTop) continue;
    along(p, r, u0, u1, r.wallTop, top - 1, l0, l0 + WALL, KIT.wall);
    along(p, r, u0, u1, r.wallTop, top - 1, l1 - WALL, l1, KIT.wall);
  }
}

/** Terracotta courses, timber barge boards standing one cell proud of the tiles, and a rolled ridge. */
function roof(p: TemplatePlan, r: Range): void {
  const [l0, l1] = r.ridge === 'z' ? [r.z0 - r.verge, r.z1 + r.verge] : [r.x0 - r.verge, r.x1 + r.verge];
  for (const { strips, top } of courses(r)) for (const [c0, c1] of strips) {
    along(p, r, c0, c1, top - r.thickness, top, l0 + 2, l1 - 2, KIT.roof);
    along(p, r, c0, c1, top - r.thickness, top + 1, l0, l0 + 2, KIT.trim);
    along(p, r, c0, c1, top - r.thickness, top + 1, l1 - 2, l1, KIT.trim);
  }
  const { mid, base, courses: count } = span(r);
  const crest = base + r.rise * count;
  along(p, r, mid - 2, mid + 2, crest, crest + 2, l0 + 1, l1 - 1, KIT.roof);
}

/**
 * An open doorway: no leaf crosses the passage. Stout timber jambs and a deep lintel stand one cell proud, a
 * flush limestone threshold carries the floor out through the wall and a broad doorstep meets the street.
 * Returns the feet point in the middle of the threshold.
 */
function doorway(p: TemplatePlan, face: Face, centre: number, clear: number, height: number): [number, number, number] {
  const half = clear / 2, top = HEARTH_FEET + height;
  onFace(p, face, centre - half - 2, centre + half + 2, PLINTH, top, -1, 1, KIT.trim);
  onFace(p, face, centre - half - 3, centre + half + 3, top, top + 3, -1, 1, KIT.trim);
  onFace(p, face, centre - half, centre + half, HEARTH_FEET, top, -WALL, 2, MAT.air);
  onFace(p, face, centre - half, centre + half, 0, HEARTH_FEET, -WALL, 1, KIT.stone);
  onFace(p, face, centre - half - 2, centre + half + 2, 0, HEARTH_FEET, 1, 4, KIT.stone);
  const inward = face.facing === 'south' || face.facing === 'east' ? -2 : 1;
  return face.facing === 'south' || face.facing === 'north' ? [centre, HEARTH_FEET, face.plane + inward] : [face.plane + inward, HEARTH_FEET, centre];
}

/**
 * A presence window deep in its reveal: timber surround and head, glass in the wall's middle cell, an optional
 * centre mullion and a limestone sill projecting two cells. The two outward cells across the glass stay air.
 */
function window(p: TemplatePlan, id: string, face: Face, u0: number, u1: number, y0: number, y1: number, mullion = false): void {
  onFace(p, face, u0 - 1, u1 + 1, y0 - 1, y1 + 1, -1, 1, KIT.trim);
  onFace(p, face, u0 - 2, u1 + 2, y1, y1 + 2, -1, 1, KIT.trim);
  onFace(p, face, u0 - 2, u1 + 2, y0 - 1, y0, -1, 2, KIT.stone);
  onFace(p, face, u0, u1, y0, y1, -WALL, 1, MAT.air);
  onFace(p, face, u0, u1, y0, y1, -2, -1, MAT.glass);
  if (mullion) onFace(p, face, (u0 + u1) / 2 - 1, (u0 + u1) / 2 + 1, y0, y1, -2, -1, KIT.trim);
  anchor(p, id, face, u0, u1, y0, y1, 1);
}

/** A timber trough hung below a sill on the plinth, planted with leaves and a few blooms; never over the glass. */
function trough(p: TemplatePlan, face: Face, u0: number, u1: number, sill: number): void {
  onFace(p, face, u0, u1, PLINTH - 1, sill - 1, 0, 3, KIT.trim);
  onFace(p, face, u0 + 1, u1 - 1, sill - 1, sill, 1, 3, MAT.leaf);
  for (let u = u0 + 2; u + 2 <= u1 - 1; u += 3) onFace(p, face, u, u + 1, sill - 1, sill, 1, 3, MAT.petal);
}

/**
 * A stout limestone chimney against a side wall with a real fireplace inside: the breast rises from the ground,
 * steps in at shouldered weatherings, and the stack jogs one cell on its way up, the way an old hand builds.
 */
function chimney(p: TemplatePlan, side: Face, z0: number, z1: number, shoulder: number, top: number, room: number): void {
  if (side.facing !== 'west') throw new Error(`${p.id}: Hearth chimneys stand on the west flank.`);
  const x1 = side.plane, x0 = x1 - 6;
  p.put(x0, 0, z0, x1, shoulder, z1, KIT.stone);
  p.put(x0 + 1, shoulder, z0 + 1, x1, shoulder + 2, z1 - 1, KIT.stone);
  const lower = Math.floor((shoulder + top) / 2);
  p.put(x0 + 1, shoulder + 2, z0 + 2, x0 + 5, lower, z1 - 2, KIT.stone);
  p.put(x0, lower, z0 + 2, x0 + 4, top, z1 - 2, KIT.stone);
  p.put(x0 - 1, top, z0 + 1, x0 + 5, top + 2, z1 - 1, KIT.stone);
  // The fireplace: a deep stone hearth set into the breast under a timber bressummer.
  const f0 = z0 + 2, f1 = z1 - 2;
  p.carve(x0 + 2, HEARTH_FEET, f0, room, HEARTH_FEET + 8, f1);
  p.put(x0 + 2, 0, f0 - 1, room + 1, HEARTH_FEET, f1 + 1, KIT.stone);
  p.put(room - 1, HEARTH_FEET + 8, f0 - 1, room + 1, HEARTH_FEET + 10, f1 + 1, KIT.trim);
}

/** The gabled room per tier. Only finished tiers are listed; the others are authored in later work. */
const GABLE: Partial<Record<HomeTier, Range>> = {
  // 3.5 × 4.75 m with 2.6 m walls under a 56° roof whose gable faces the street; the ridge cap tops out at
  // 5.9 m inside the hut's 6 m allowance.
  hut: { x0: 18, x1: 46, z0: 84, z1: 122, wallTop: 21, ridge: 'z', eave: 3, verge: 3, tread: 2, rise: 3, thickness: 4 },
};

/** A single legible room under one complete roof, its gable and open door facing the street. */
export function hearthGable(tier: HomeTier): BuiltTemplate {
  const r = GABLE[tier];
  if (!r) throw new Error(`${templateId('hearth', 'gable', tier)} is not finished in this build.`);
  const p = new TemplatePlan(templateId('hearth', 'gable', tier), 'hearth', tier);
  const front: Face = { facing: 'south', plane: r.z1 }, back: Face = { facing: 'north', plane: r.z0 };
  const west: Face = { facing: 'west', plane: r.x0 }, east: Face = { facing: 'east', plane: r.x1 };
  const centre = (r.x0 + r.x1) / 2;
  shell(p, r);
  hollow(p, r);
  gables(p, r);
  roof(p, r);
  const threshold = doorway(p, front, centre, 12, 21);
  // A gable eye over the lintel lights the open roof of the room and greets the street.
  window(p, 'gable-eye', front, centre - 3, centre + 3, 27, 33);
  window(p, 'west-ingle', west, 106, 114, 6, 16, true);
  window(p, 'east-garden', east, 98, 108, 6, 16, true);
  window(p, 'north-loft', back, centre - 3, centre + 3, 27, 33);
  trough(p, east, 97, 109, 5);
  chimney(p, west, 89, 99, 13, 42, r.x0 + WALL);
  return { blueprint: p.blueprint(), review: { threshold, rooms: [[centre, HEARTH_FEET, 104]], windows: p.windows.map(w => w.id) } };
}
