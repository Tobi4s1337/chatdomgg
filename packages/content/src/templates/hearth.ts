import type { HomeTier, Vec3 } from '@chatdom/shared';
import { MAT, STYLES } from '../materials';
import { TemplatePlan, anchor, onFace, templateId, type BuiltTemplate, type Face } from './plan';

/**
 * Hearth & heather starting shapes. Plaster walls stand on a projecting limestone plinth, held by stout timber
 * posts and a wall plate; roofs are steep terracotta gables with timber barge boards; windows sit deep in warm
 * reveals with a timber head and a limestone sill. Every plan is built from gabled wings: one wing for the gable,
 * two crossing wings for the corner, and three for the courtyard. All coordinates are build cells (0.125 m), boxes
 * are half-open and run in order, and the street is +Z.
 */
const KIT = STYLES.hearth;
/** Floor boards fill y=0; feet stand at y=1, one gentle step above the street. */
export const HEARTH_FEET = 1;
/** Limestone plinth height; plaster walls begin on top of it. */
const PLINTH = 3;
/** Roof pitch: each two-cell course climbs three (56°). A course is four cells deep where it shows. */
const TREAD = 2, RISE = 3, THICK = 4, EAVE = 3, VERGE = 3;
/** An open doorway: 1.5 m wide with 2.5 m of headroom above the threshold. */
const DOOR = 12, HEAD = 20;

/**
 * One gabled wing between its outer wall faces. The walls parallel to the ridge carry the eaves; the end walls
 * carry the gables. Wings of one plan share wall thickness, wall-plate height and span, so where two cross their
 * ridges meet at one height and their attics open into each other.
 */
interface Wing { readonly x0: number; readonly x1: number; readonly z0: number; readonly z1: number; readonly ridge: 'x' | 'z' }
interface Body { readonly wall: number; readonly wallTop: number; readonly wings: readonly Wing[] }

function faces(w: Wing): { south: Face; north: Face; west: Face; east: Face } {
  return { south: { facing: 'south', plane: w.z1 }, north: { facing: 'north', plane: w.z0 }, west: { facing: 'west', plane: w.x0 }, east: { facing: 'east', plane: w.x1 } };
}

interface Span { s0: number; s1: number; l0: number; l1: number; a: number; mid: number; base: number; count: number; crest: number }

function span(w: Wing, wallTop: number): Span {
  const [s0, s1] = w.ridge === 'z' ? [w.x0, w.x1] : [w.z0, w.z1];
  const [l0, l1] = w.ridge === 'z' ? [w.z0, w.z1] : [w.x0, w.x1];
  const a = s0 - EAVE, b = s1 + EAVE;
  if ((b - a) % 2) throw new Error('A gabled span must be even so both slopes share one ridge.');
  const mid = (a + b) / 2;
  // The course that lands on the wall face has its slab resting exactly on the wall plate.
  const base = wallTop + THICK - RISE * (Math.floor(EAVE / TREAD) + 1);
  const count = Math.ceil((mid - a) / TREAD);
  return { s0, s1, l0, l1, a, mid, base, count, crest: base + RISE * count };
}

/** Top of the ridge cap: the highest cell a wing's roof reaches. */
function ridgeTop(w: Wing, wallTop: number): number { return span(w, wallTop).crest + 2; }

/**
 * Every roof column across a span. Tiles show four cells deep at the eaves, over the walls and at the lower edge of
 * each course, where the step is seen; between those the field is one tile thick, so the roof costs the citizen's
 * allowance only where it can be seen. Over the walls the head is filled solid up to the tiles.
 */
interface Column { c: number; top: number; bottom: number; head: boolean }
function columns(w: Wing, b: Body): Column[] {
  const { s0, s1, a, mid, base, count } = span(w, b.wallTop), out: Column[] = [];
  for (let i = 0; i < count; i++) {
    const c0 = a + i * TREAD, c1 = Math.min(c0 + TREAD, mid), top = base + RISE * (i + 1);
    for (const [from, to, edge] of [[c0, c1, c0], [2 * mid - c1, 2 * mid - c0, 2 * mid - c0 - 1]] as const) {
      for (let c = from; c < to; c++) {
        const head = (c >= s0 && c < s0 + b.wall) || (c >= s1 - b.wall && c < s1);
        const full = i === 0 || c === edge || c < s0 + b.wall || c >= s1 - b.wall;
        out.push({ c, top, bottom: full ? top - THICK : top - 1, head });
      }
    }
  }
  return out;
}

function along(p: TemplatePlan, w: Wing, s0: number, s1: number, y0: number, y1: number, l0: number, l1: number, material: number): void {
  if (w.ridge === 'z') p.put(s0, y0, l0, s1, y1, l1, material);
  else p.put(l0, y0, s0, l1, y1, s1, material);
}

/** Plinth, plaster walls, stout corner posts and a projecting wall plate, solid until `hollow` runs. */
function shell(p: TemplatePlan, b: Body, w: Wing): void {
  p.put(w.x0 - 1, 0, w.z0 - 1, w.x1 + 1, PLINTH, w.z1 + 1, KIT.stone);
  p.put(w.x0, PLINTH, w.z0, w.x1, b.wallTop, w.z1, KIT.wall);
  const plate = b.wallTop - 2;
  p.put(w.x0 - 1, plate, w.z0 - 1, w.x1 + 1, b.wallTop, w.z1 + 1, KIT.trim);
  // Square timber posts one cell proud on both faces: the corners read as structure, not as plaster.
  // Where two wings share a corner, its post stands once.
  for (const [x, z] of [[w.x0 - 1, w.z0 - 1], [w.x1 - b.wall, w.z0 - 1], [w.x0 - 1, w.z1 - b.wall], [w.x1 - b.wall, w.z1 - b.wall]] as const) {
    const shared = b.wings.slice(0, b.wings.indexOf(w)).some(o => [[o.x0 - 1, o.z0 - 1], [o.x1 - b.wall, o.z0 - 1], [o.x0 - 1, o.z1 - b.wall], [o.x1 - b.wall, o.z1 - b.wall]].some(([ox, oz]) => ox === x && oz === z));
    if (!shared) p.put(x, PLINTH, z, x + b.wall + 1, plate, z + b.wall + 1, KIT.trim);
  }
}

/** Opens a wing's room: everything inside the walls above the floor, with timber boards laid at y=0. */
function hollow(p: TemplatePlan, b: Body, w: Wing): void {
  p.carve(w.x0 + b.wall, HEARTH_FEET, w.z0 + b.wall, w.x1 - b.wall, b.wallTop, w.z1 - b.wall);
  p.put(w.x0 + b.wall, 0, w.z0 + b.wall, w.x1 - b.wall, HEARTH_FEET, w.z1 - b.wall, KIT.trim);
}

/** Plaster gable ends stepped up under each roof course so the roof closes over them without gaps. */
function gables(p: TemplatePlan, b: Body, w: Wing): void {
  const { s0, s1, l0, l1 } = span(w, b.wallTop);
  for (const { c, top } of columns(w, b)) {
    if (c < s0 || c >= s1 || top - 1 <= b.wallTop) continue;
    along(p, w, c, c + 1, b.wallTop, top - 1, l0, l0 + b.wall, KIT.wall);
    along(p, w, c, c + 1, b.wallTop, top - 1, l1 - b.wall, l1, KIT.wall);
  }
}

/** Terracotta courses, a filled wall head, timber barge boards one cell proud of the tiles, and a rolled ridge. */
function roof(p: TemplatePlan, b: Body, w: Wing): void {
  const { l0, l1, mid, crest } = span(w, b.wallTop), v0 = l0 - VERGE, v1 = l1 + VERGE;
  for (const { c, top, bottom, head } of columns(w, b)) {
    if (head && bottom > b.wallTop) along(p, w, c, c + 1, b.wallTop, bottom, l0, l1, KIT.wall);
    along(p, w, c, c + 1, bottom, top, v0 + 2, v1 - 2, KIT.roof);
    along(p, w, c, c + 1, top - THICK, top + 1, v0, v0 + 2, KIT.trim);
    along(p, w, c, c + 1, top - THICK, top + 1, v1 - 2, v1, KIT.trim);
  }
  // A rolled ridge: a four-cell capping course with a two-cell roll along its crown.
  along(p, w, mid - 2, mid + 2, crest, crest + 1, v0 + 1, v1 - 1, KIT.roof);
  along(p, w, mid - 1, mid + 1, crest + 1, crest + 2, v0 + 1, v1 - 1, KIT.roof);
}

/**
 * Clears the wing's attic up to the underside of its own tiles. Where wings cross, each one's attic removes the
 * other's slab and gable from inside it, so the outside shows the higher roof and the rooms share one open roof.
 */
function attic(p: TemplatePlan, b: Body, w: Wing): void {
  const { s0, s1, l0, l1 } = span(w, b.wallTop);
  for (const { c, bottom } of columns(w, b)) {
    if (c < s0 + b.wall || c >= s1 - b.wall || bottom <= b.wallTop) continue;
    along(p, w, c, c + 1, b.wallTop, bottom, l0 + b.wall, l1 - b.wall, MAT.air);
  }
}

/** Raises the whole body in the only order that keeps crossing wings honest. */
function raise(p: TemplatePlan, b: Body): void {
  for (const step of [shell, hollow, gables, roof, attic]) for (const w of b.wings) step(p, b, w);
}

/**
 * An open doorway: no leaf crosses the passage. Stout timber jambs and a deep lintel stand one cell proud, a
 * flush limestone threshold carries the floor out through the wall and a broad doorstep meets the ground.
 * Returns the feet point in the middle of the threshold.
 */
function doorway(p: TemplatePlan, face: Face, centre: number, wall: number, height = HEAD): Vec3 {
  const half = DOOR / 2, top = HEARTH_FEET + height;
  onFace(p, face, centre - half - 2, centre + half + 2, PLINTH, top, -1, 1, KIT.trim);
  onFace(p, face, centre - half - 3, centre + half + 3, top, top + 3, -1, 1, KIT.trim);
  onFace(p, face, centre - half, centre + half, HEARTH_FEET, top, -wall, 2, MAT.air);
  onFace(p, face, centre - half, centre + half, 0, HEARTH_FEET, -wall, 1, KIT.stone);
  onFace(p, face, centre - half - 2, centre + half + 2, 0, HEARTH_FEET, 1, 4, KIT.stone);
  const inward = face.facing === 'south' || face.facing === 'east' ? -2 : 1;
  return face.facing === 'south' || face.facing === 'north' ? [centre, HEARTH_FEET, face.plane + inward] : [face.plane + inward, HEARTH_FEET, centre];
}

/**
 * A presence window deep in its reveal: timber surround and head, glass in the wall behind one open cell, an
 * optional centre mullion and a limestone sill projecting two cells. The two outward cells across the glass stay air.
 */
function window(p: TemplatePlan, id: string, face: Face, wall: number, u0: number, u1: number, y0: number, y1: number, mullion = false): void {
  onFace(p, face, u0 - 1, u1 + 1, y0 - 1, y1 + 1, -1, 1, KIT.trim);
  onFace(p, face, u0 - 2, u1 + 2, y1, y1 + 2, -1, 1, KIT.trim);
  onFace(p, face, u0 - 2, u1 + 2, y0 - 1, y0, -1, 2, KIT.stone);
  onFace(p, face, u0, u1, y0, y1, -wall, 1, MAT.air);
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
 * A stout limestone chimney against an outside wall with a real fireplace inside: the breast rises from the
 * ground, steps in at shouldered weatherings, and the stack jogs one cell on its way up, the way an old hand builds.
 */
function chimney(p: TemplatePlan, face: Face, wall: number, u0: number, u1: number, shoulder: number, top: number): void {
  onFace(p, face, u0, u1, 0, shoulder, 0, 6, KIT.stone);
  onFace(p, face, u0 + 1, u1 - 1, shoulder, shoulder + 2, 0, 5, KIT.stone);
  const lower = Math.floor((shoulder + top) / 2);
  onFace(p, face, u0 + 2, u1 - 2, shoulder + 2, lower, 1, 5, KIT.stone);
  onFace(p, face, u0 + 2, u1 - 2, lower, top, 2, 6, KIT.stone);
  onFace(p, face, u0 + 1, u1 - 1, top, top + 2, 1, 7, KIT.stone);
  // The fireplace: a deep stone hearth set into the breast under a timber bressummer.
  onFace(p, face, u0 + 2, u1 - 2, HEARTH_FEET, HEARTH_FEET + 8, -wall, 4, MAT.air);
  onFace(p, face, u0 + 1, u1 - 1, 0, HEARTH_FEET, -wall - 1, 4, KIT.stone);
  onFace(p, face, u0 + 1, u1 - 1, HEARTH_FEET + 8, HEARTH_FEET + 10, -wall - 1, -wall + 1, KIT.trim);
}

/** A timber post one cell proud of a long wall, from plinth to plate: the bay rhythm of a framed building. */
function bayPost(p: TemplatePlan, b: Body, face: Face, u: number): void {
  onFace(p, face, u - 1, u + 1, PLINTH, b.wallTop - 2, -1, 1, KIT.trim);
}

/**
 * A square timber post standing in an inside corner, from plinth to plate. `(x, z)` is where the two wall faces
 * meet; `dx`/`dz` point into the open ground the corner looks onto.
 */
function innerPost(p: TemplatePlan, b: Body, x: number, z: number, dx: 1 | -1, dz: 1 | -1): void {
  const x0 = dx > 0 ? x : x - 2, z0 = dz > 0 ? z : z - 2;
  p.put(x0, PLINTH, z0, x0 + 2, b.wallTop - 2, z0 + 2, KIT.trim);
}

/**
 * A timber frame across a room where two wings meet: a post against each wall and a tie beam at plate height,
 * marking one room from the next while the floor and the roof run on.
 */
function frame(p: TemplatePlan, b: Body, axis: 'x' | 'z', at: number, from: number, to: number): void {
  const top = b.wallTop;
  const put = (u0: number, u1: number, y0: number, y1: number) => axis === 'x' ? p.put(u0, y0, at, u1, y1, at + 2, KIT.trim) : p.put(at, y0, u0, at + 2, y1, u1, KIT.trim);
  put(from, from + 2, HEARTH_FEET, top - 2);
  put(to - 2, to, HEARTH_FEET, top - 2);
  put(from, to, top - 2, top);
}

/**
 * A plaster cross wall from the floor to the plate with a timber tie along its head and, given `door`, an open
 * framed doorway centred there.
 * `axis` is the direction the wall runs; it stands at `at`..`at + wall`.
 */
function partition(p: TemplatePlan, b: Body, axis: 'x' | 'z', at: number, from: number, to: number, door?: number): void {
  const put = (u0: number, u1: number, y0: number, y1: number, n0: number, n1: number, m: number) =>
    axis === 'x' ? p.put(u0, y0, n0, u1, y1, n1, m) : p.put(n0, y0, u0, n1, y1, u1, m);
  const half = DOOR / 2, top = HEARTH_FEET + HEAD;
  put(from, to, HEARTH_FEET, b.wallTop - 2, at, at + b.wall, KIT.wall);
  put(from, to, b.wallTop - 2, b.wallTop, at, at + b.wall, KIT.trim);
  if (door === undefined) return;
  put(door - half - 2, door + half + 2, HEARTH_FEET, top + 3, at - 1, at + b.wall + 1, KIT.trim);
  put(door - half, door + half, HEARTH_FEET, top, at - 1, at + b.wall + 1, MAT.air);
}

/** Limestone flags laid on the ground at y=0, flush with the floor boards. */
function pave(p: TemplatePlan, x0: number, z0: number, x1: number, z1: number): void {
  p.put(x0, 0, z0, x1, HEARTH_FEET, z1, KIT.stone);
}

/** A pentice hood over a gable door: two tile courses on timber bearers and brackets, clear of the door. */
function hood(p: TemplatePlan, face: Face, centre: number, y: number): void {
  const half = DOOR / 2 + 3;
  onFace(p, face, centre - half - 1, centre - half + 1, y - 4, y, 0, 2, KIT.trim);
  onFace(p, face, centre + half - 1, centre + half + 1, y - 4, y, 0, 2, KIT.trim);
  onFace(p, face, centre - half - 1, centre + half + 1, y, y + 1, 0, 5, KIT.trim);
  onFace(p, face, centre - half - 2, centre + half + 2, y + 1, y + 2, 0, 6, KIT.roof);
  onFace(p, face, centre - half - 2, centre + half + 2, y + 2, y + 4, 0, 3, KIT.roof);
}

/** A planted bed: an earth bank edged in limestone with leaves and a few flowers, laid flat on the ground. */
function bed(p: TemplatePlan, x0: number, z0: number, x1: number, z1: number): void {
  p.put(x0, 0, z0, x1, 1, z1, KIT.stone);
  p.put(x0 + 1, 0, z0 + 1, x1 - 1, 1, z1 - 1, MAT.earth);
  p.put(x0 + 1, 1, z0 + 1, x1 - 1, 2, z1 - 1, MAT.leaf);
  for (let z = z0 + 2; z < z1 - 2; z += 3) for (let x = x0 + 2 + (z % 2); x < x1 - 2; x += 4) p.put(x, 2, z, x + 1, 3, z + 1, MAT.petal);
}

/* ------------------------------------------------------------------ the gabled room ------------------------------------------------------------------ */

interface Opening { readonly id: string; readonly side: 'west' | 'east'; readonly from: number; readonly to: number; readonly mullion?: boolean }

interface GablePlan {
  readonly wing: Wing; readonly wall: number; readonly wallTop: number;
  /** Gable eye over the door and its twin in the back gable: width and sill/head heights. */
  readonly eye: readonly [width: number, y0: number, y1: number];
  /** Side windows run from the plinth course up to this height. */
  readonly sill: number; readonly head: number;
  readonly windows: readonly Opening[];
  readonly bays: readonly number[];
  readonly chimneys: readonly { readonly side: 'west' | 'east'; readonly from: number; readonly to: number; readonly shoulder: number }[];
  readonly trough: readonly [from: number, to: number];
  readonly hood: boolean;
  readonly room: number;
}

/**
 * The gabled room per tier: one wing, its gable and open door to the street. The hut is 3.5 × 4.75 m; each tier
 * widens and lengthens the room, lifts the wall plate and adds framed bays, more windows and a second hearth.
 */
const GABLE: Record<HomeTier, GablePlan> = {
  hut: {
    wing: { x0: 18, x1: 46, z0: 84, z1: 122, ridge: 'z' }, wall: 3, wallTop: 21, eye: [6, 27, 33], sill: 6, head: 16,
    windows: [{ id: 'west-ingle', side: 'west', from: 106, to: 114, mullion: true }, { id: 'east-garden', side: 'east', from: 98, to: 108, mullion: true }],
    bays: [], chimneys: [{ side: 'west', from: 89, to: 99, shoulder: 13 }], trough: [97, 109], hood: false, room: 104,
  },
  cottage: {
    wing: { x0: 16, x1: 48, z0: 66, z1: 122, ridge: 'z' }, wall: 3, wallTop: 24, eye: [8, 31, 39], sill: 6, head: 18,
    windows: [
      { id: 'west-ingle', side: 'west', from: 104, to: 114, mullion: true }, { id: 'east-garden', side: 'east', from: 100, to: 110, mullion: true },
      { id: 'east-orchard', side: 'east', from: 74, to: 84, mullion: true },
    ],
    bays: [93], chimneys: [{ side: 'west', from: 76, to: 88, shoulder: 15 }], trough: [99, 111], hood: true, room: 100,
  },
  house: {
    wing: { x0: 14, x1: 50, z0: 50, z1: 122, ridge: 'z' }, wall: 3, wallTop: 27, eye: [8, 34, 44], sill: 6, head: 20,
    windows: [
      { id: 'west-ingle', side: 'west', from: 104, to: 114, mullion: true }, { id: 'east-garden', side: 'east', from: 100, to: 110, mullion: true },
      { id: 'east-orchard', side: 'east', from: 76, to: 86, mullion: true }, { id: 'west-settle', side: 'west', from: 56, to: 66, mullion: true },
    ],
    bays: [94, 70], chimneys: [{ side: 'west', from: 76, to: 88, shoulder: 17 }], trough: [99, 111], hood: true, room: 96,
  },
  manor: {
    wing: { x0: 11, x1: 53, z0: 32, z1: 122, ridge: 'z' }, wall: 3, wallTop: 30, eye: [10, 37, 49], sill: 6, head: 22,
    windows: [
      { id: 'west-ingle', side: 'west', from: 102, to: 114, mullion: true }, { id: 'east-garden', side: 'east', from: 100, to: 112, mullion: true },
      { id: 'east-orchard', side: 'east', from: 74, to: 86, mullion: true }, { id: 'west-settle', side: 'west', from: 50, to: 62, mullion: true },
      { id: 'east-well', side: 'east', from: 46, to: 58, mullion: true },
    ],
    bays: [94, 68, 42], chimneys: [{ side: 'west', from: 74, to: 88, shoulder: 19 }], trough: [99, 113], hood: true, room: 88,
  },
  hall: {
    wing: { x0: 8, x1: 56, z0: 14, z1: 122, ridge: 'z' }, wall: 3, wallTop: 33, eye: [12, 40, 54], sill: 6, head: 24,
    windows: [
      { id: 'west-ingle', side: 'west', from: 102, to: 114, mullion: true }, { id: 'east-garden', side: 'east', from: 100, to: 112, mullion: true },
      { id: 'east-orchard', side: 'east', from: 74, to: 86, mullion: true }, { id: 'west-settle', side: 'west', from: 48, to: 60, mullion: true },
      { id: 'west-dais', side: 'west', from: 22, to: 34, mullion: true },
    ],
    bays: [96, 70, 44], chimneys: [{ side: 'west', from: 74, to: 88, shoulder: 21 }, { side: 'east', from: 22, to: 38, shoulder: 21 }], trough: [99, 113], hood: true, room: 80,
  },
};

/** A single legible room under one complete roof, its gable and open door facing the street. */
export function hearthGable(tier: HomeTier): BuiltTemplate {
  const plan = GABLE[tier], w = plan.wing, b: Body = { wall: plan.wall, wallTop: plan.wallTop, wings: [w] };
  const p = new TemplatePlan(templateId('hearth', 'gable', tier), 'hearth', tier);
  const f = faces(w), centre = (w.x0 + w.x1) / 2, crest = ridgeTop(w, b.wallTop) - 2;
  raise(p, b);
  for (const z of plan.bays) for (const face of [f.west, f.east]) bayPost(p, b, face, z);
  // Tie beams across the room at every bay post, at plate height: the frame reads from inside too.
  for (const z of plan.bays) p.put(w.x0 + b.wall, b.wallTop - 2, z - 1, w.x1 - b.wall, b.wallTop, z + 1, KIT.trim);
  const threshold = doorway(p, f.south, centre, b.wall, 21);
  if (plan.hood) hood(p, f.south, centre, HEARTH_FEET + 21 + 3);
  // A gable eye over the lintel lights the open roof of the room and greets the street; its twin lights the back.
  const [eye, e0, e1] = plan.eye;
  window(p, 'gable-eye', f.south, b.wall, centre - eye / 2, centre + eye / 2, e0, e1);
  for (const o of plan.windows) window(p, o.id, f[o.side], b.wall, o.from, o.to, plan.sill, plan.head, o.mullion);
  window(p, 'north-loft', f.north, b.wall, centre - eye / 2, centre + eye / 2, e0, e1);
  trough(p, f.east, plan.trough[0], plan.trough[1], plan.sill - 1);
  for (const c of plan.chimneys) chimney(p, f[c.side], b.wall, c.from, c.to, c.shoulder, crest - 4);
  return { blueprint: p.blueprint(), review: { threshold, rooms: [[centre, HEARTH_FEET, plan.room]], windows: p.windows.map(x => x.id) } };
}

/* ------------------------------------------------------------------ the corner house ------------------------------------------------------------------ */

interface CornerPlan {
  readonly wall: number; readonly wallTop: number;
  /** The street wing, gable to the street, and the back wing that turns east from behind it. */
  readonly front: Wing; readonly back: Wing;
  readonly door: number;
  /** Cross walls dividing the street wing into rooms, front to back of the house: their z and door x. */
  readonly partitions: readonly number[];
  readonly sill: number; readonly head: number;
  readonly chimney: readonly [from: number, to: number];
  readonly windows: readonly { readonly id: string; readonly wing: 'front' | 'back'; readonly side: 'south' | 'north' | 'west' | 'east'; readonly from: number; readonly to: number; readonly mullion?: boolean }[];
  /** Standing points in the back wing, then each street-wing room from the turn towards the street. */
  readonly rooms: readonly Vec3[];
}

const cornerWindows = (front: Wing, back: Wing, sill: number, head: number, extra: CornerPlan['windows'] = []): CornerPlan['windows'] => {
  const fx = (front.x0 + front.x1) / 2;
  return [
    { id: 'street-parlour', wing: 'front', side: 'south', from: fx - 6, to: fx + 6, mullion: true },
    { id: 'west-ingle', wing: 'front', side: 'west', from: front.z1 - 18, to: front.z1 - 8, mullion: true },
    { id: 'dooryard', wing: 'front', side: 'east', from: front.z1 - 14, to: front.z1 - 6 },
    { id: 'east-garden', wing: 'back', side: 'east', from: back.z0 + 6, to: back.z0 + 6 + (head - sill > 12 ? 12 : 10), mullion: true },
    { id: 'north-hearth', wing: 'back', side: 'north', from: front.x0 + 8, to: front.x0 + 16 },
    ...extra,
  ];
};

/**
 * Two wings around a dooryard. The street wing shows its gable and parlour window to the street; the back wing
 * turns east behind it and takes the door, which opens off a paved path in the sheltered inside corner.
 */
const CORNER: Record<HomeTier, CornerPlan> = (() => {
  const plan = (wall: number, wallTop: number, front: Wing, back: Wing, door: number, partitions: number[], sill: number, head: number, chimney: [number, number], rooms: Vec3[], extra: CornerPlan['windows'] = []): CornerPlan =>
    ({ wall, wallTop, front, back, door, partitions, sill, head, chimney, rooms, windows: cornerWindows(front, back, sill, head, extra) });
  return {
    hut: plan(2, 24, { x0: 5, x1: 27, z0: 82, z1: 122, ridge: 'z' }, { x0: 5, x1: 57, z0: 82, z1: 104, ridge: 'x' }, 44, [], 6, 16, [40, 50],
      [[44, 1, 93], [16, 1, 112]]),
    cottage: plan(2, 24, { x0: 4, x1: 30, z0: 66, z1: 122, ridge: 'z' }, { x0: 4, x1: 58, z0: 66, z1: 92, ridge: 'x' }, 45, [], 6, 18, [40, 52],
      [[45, 1, 79], [17, 1, 106]], [{ id: 'west-pantry', wing: 'back', side: 'west', from: 72, to: 82 }]),
    house: plan(3, 27, { x0: 4, x1: 34, z0: 50, z1: 122, ridge: 'z' }, { x0: 4, x1: 60, z0: 50, z1: 80, ridge: 'x' }, 47, [98], 6, 20, [40, 52],
      [[47, 1, 65], [19, 1, 89], [19, 1, 110]],
      [{ id: 'west-pantry', wing: 'back', side: 'west', from: 58, to: 68 }, { id: 'west-hall', wing: 'front', side: 'west', from: 84, to: 94, mullion: true }, { id: 'dooryard-hall', wing: 'front', side: 'east', from: 84, to: 92 }]),
    manor: plan(3, 30, { x0: 4, x1: 36, z0: 34, z1: 122, ridge: 'z' }, { x0: 4, x1: 60, z0: 34, z1: 66, ridge: 'x' }, 48, [96], 6, 22, [42, 54],
      [[48, 1, 50], [20, 1, 81], [20, 1, 110]],
      [{ id: 'west-pantry', wing: 'back', side: 'west', from: 42, to: 54 }, { id: 'west-hall', wing: 'front', side: 'west', from: 76, to: 88, mullion: true }, { id: 'dooryard-hall', wing: 'front', side: 'east', from: 76, to: 86 }]),
    hall: plan(3, 33, { x0: 4, x1: 38, z0: 14, z1: 122, ridge: 'z' }, { x0: 4, x1: 60, z0: 14, z1: 48, ridge: 'x' }, 49, [96, 72], 6, 24, [42, 56],
      [[49, 1, 31], [21, 1, 60], [21, 1, 85], [21, 1, 110]],
      [
        { id: 'west-pantry', wing: 'back', side: 'west', from: 24, to: 36 }, { id: 'west-hall', wing: 'front', side: 'west', from: 78, to: 90, mullion: true },
        { id: 'dooryard-hall', wing: 'front', side: 'east', from: 78, to: 88 }, { id: 'west-solar', wing: 'front', side: 'west', from: 54, to: 66, mullion: true },
        { id: 'dooryard-solar', wing: 'front', side: 'east', from: 54, to: 64 },
      ]),
  };
})();

/** Two joined wings and a connected L-shaped route: the back wing's door, the turn, and the rooms to the street. */
export function hearthCorner(tier: HomeTier): BuiltTemplate {
  const plan = CORNER[tier], { front, back } = plan, b: Body = { wall: plan.wall, wallTop: plan.wallTop, wings: [front, back] };
  const p = new TemplatePlan(templateId('hearth', 'corner', tier), 'hearth', tier);
  const ff = faces(front), bf = faces(back), wall = b.wall, crest = ridgeTop(front, b.wallTop) - 2;
  raise(p, b);
  innerPost(p, b, front.x1, back.z1, 1, 1);
  // Where the back wing's south wall would cross the street wing, a timber frame marks the turn instead.
  frame(p, b, 'x', back.z1 - 2, front.x0 + wall, front.x1 - wall);
  const fx = (front.x0 + front.x1) / 2;
  for (const z of plan.partitions) partition(p, b, 'x', z, front.x0 + wall, front.x1 - wall, fx);
  // A paved path from the street to the doorstep, through the dooryard.
  pave(p, plan.door - 6, back.z1 + 4, plan.door + 6, 128);
  const threshold = doorway(p, bf.south, plan.door, wall);
  const f = { front: ff, back: bf };
  for (const o of plan.windows) window(p, o.id, f[o.wing][o.side], wall, o.from, o.to, plan.sill, plan.head, o.mullion);
  // A gable eye in the street gable over the parlour window.
  const gableSpan = front.x1 - front.x0, eye = gableSpan >= 30 ? 8 : gableSpan >= 26 ? 6 : 4, eye0 = plan.wallTop + 4;
  window(p, 'gable-eye', ff.south, wall, fx - eye / 2, fx + eye / 2, eye0, eye0 + eye);
  const dy = plan.windows.find(o => o.id === 'dooryard')!;
  trough(p, ff.east, dy.from - 1, dy.to + 1, plan.sill - 1);
  chimney(p, bf.north, wall, plan.chimney[0], plan.chimney[1], 13 + (plan.wallTop - 24), crest - 3);
  return { blueprint: p.blueprint(), review: { threshold, rooms: plan.rooms, windows: p.windows.map(x => x.id) } };
}

/* ------------------------------------------------------------------ rooms around a court ------------------------------------------------------------------ */

/**
 * Hut and cottage: the court opens straight onto the street between two gabled wings, with the back range behind.
 * Each wing is the narrowest real room (2 m clear) so the court between them keeps 2.25 m of open sky.
 */
interface OpenCourtPlan { readonly back: number; readonly front: number; readonly partition?: number; readonly courtDoor: number }
const OPEN_COURT: Record<'hut' | 'cottage', OpenCourtPlan> = {
  hut: { back: 72, front: 110, courtDoor: 100 },
  cottage: { back: 56, front: 118, partition: 96, courtDoor: 107 },
};

function openCourt(tier: 'hut' | 'cottage'): BuiltTemplate {
  const plan = OPEN_COURT[tier], p = new TemplatePlan(templateId('hearth', 'courtyard', tier), 'hearth', tier);
  const west: Wing = { x0: 3, x1: 23, z0: plan.back, z1: plan.front, ridge: 'z' }, east: Wing = { x0: 41, x1: 61, z0: plan.back, z1: plan.front, ridge: 'z' };
  const back: Wing = { x0: 3, x1: 61, z0: plan.back, z1: plan.back + 20, ridge: 'x' };
  const b: Body = { wall: 2, wallTop: 24, wings: [west, east, back] }, wall = b.wall;
  const wf = faces(west), ef = faces(east), bf = faces(back), crest = ridgeTop(back, b.wallTop) - 2;
  const wx = (west.x0 + west.x1) / 2, ex = (east.x0 + east.x1) / 2;
  raise(p, b);
  innerPost(p, b, west.x1, back.z1, 1, 1);
  innerPost(p, b, east.x0, back.z1, -1, 1);
  for (const w of [west, east]) frame(p, b, 'x', back.z1 - 2, w.x0 + wall, w.x1 - wall);
  if (plan.partition !== undefined) for (const [w, x] of [[west, wx], [east, ex]] as const) partition(p, b, 'x', plan.partition, w.x0 + wall, w.x1 - wall, x);
  // A flagged path from the street to the back range's door; the rest of the court is open ground.
  pave(p, 26, back.z1, 38, 128);
  const threshold = doorway(p, bf.south, 32, wall);
  doorway(p, wf.east, plan.courtDoor, wall);
  doorway(p, ef.west, plan.courtDoor, wall);
  window(p, 'street-west', wf.south, wall, wx - 5, wx + 5, 6, 16, true);
  window(p, 'street-east', ef.south, wall, ex - 5, ex + 5, 6, 16, true);
  window(p, 'west-ingle', wf.west, wall, plan.courtDoor - 5, plan.courtDoor + 5, 6, 16, true);
  window(p, 'east-garden', ef.east, wall, plan.courtDoor - 5, plan.courtDoor + 5, 6, 16, true);
  window(p, 'north-hearth', bf.north, wall, 12, 20, 6, 16);
  const parlour = plan.partition === undefined ? undefined : Math.round((back.z1 + plan.partition) / 2);
  if (parlour !== undefined) {
    window(p, 'west-parlour', wf.west, wall, parlour - 5, parlour + 5, 6, 16, true);
    window(p, 'east-parlour', ef.east, wall, parlour - 5, parlour + 5, 6, 16, true);
  }
  trough(p, wf.south, wx - 6, wx + 6, 5);
  trough(p, ef.south, ex - 6, ex + 6, 5);
  chimney(p, bf.north, wall, 40, 50, 13, crest - 3);
  const side = (x: number): Vec3[] => parlour === undefined ? [[x, HEARTH_FEET, plan.courtDoor]] : [[x, HEARTH_FEET, parlour], [x, HEARTH_FEET, plan.courtDoor]];
  const rooms: Vec3[] = [[32, HEARTH_FEET, back.z0 + 10], ...side(wx), ...side(ex).reverse()];
  return { blueprint: p.blueprint(), review: { threshold, rooms, court: [32, HEARTH_FEET, plan.courtDoor], windows: p.windows.map(x => x.id) } };
}

/**
 * House and up: the court sits behind the street. The west range runs from the back range to the street, the
 * street range stands across the east half, and between them an open gate under a tiled beam leads in. A garden
 * wall with a limestone coping closes the fourth side, so the court can grow into a real yard.
 */
interface GateCourtPlan {
  readonly wallTop: number; readonly span: number; readonly back: number;
  /** Cross walls dividing the west range into rooms, back to front: their z. */
  readonly partitions: readonly number[];
  /** Which west-range room, counted from the back, opens onto the court. */
  readonly courtRoom: number; readonly head: number;
}
const GATE_COURT: Record<Exclude<HomeTier, 'hut'>, GateCourtPlan> = {
  cottage: { wallTop: 24, span: 20, back: 56, partitions: [98], courtRoom: 0, head: 16 },
  house: { wallTop: 24, span: 22, back: 39, partitions: [90], courtRoom: 0, head: 16 },
  manor: { wallTop: 27, span: 22, back: 23, partitions: [70, 94], courtRoom: 1, head: 18 },
  hall: { wallTop: 30, span: 22, back: 7, partitions: [52, 74, 96], courtRoom: 1, head: 20 },
};

function gateCourt(tier: Exclude<HomeTier, 'hut'>): BuiltTemplate {
  const plan = GATE_COURT[tier], wall = 2, s = plan.span, p = new TemplatePlan(templateId('hearth', 'courtyard', tier), 'hearth', tier);
  const west: Wing = { x0: 3, x1: 3 + s, z0: plan.back, z1: 122, ridge: 'z' };
  const back: Wing = { x0: 3, x1: 61, z0: plan.back, z1: plan.back + s, ridge: 'x' };
  const g0 = west.x1, g1 = g0 + DOOR, gate = (g0 + g1) / 2;
  const street: Wing = { x0: g1, x1: 61, z0: 122 - s, z1: 122, ridge: 'x' };
  const b: Body = { wall, wallTop: plan.wallTop, wings: [west, back, street] };
  const wf = faces(west), bf = faces(back), sf = faces(street), crest = ridgeTop(back, b.wallTop) - 2;
  const wx = (west.x0 + west.x1) / 2, fx = (street.x0 + street.x1) / 2, fz = (street.z0 + street.z1) / 2;
  const c0 = back.z1, c1 = street.z0;
  const starts = [back.z1, ...plan.partitions.map(z => z + wall)], ends = [...plan.partitions, west.z1 - wall];
  const westRooms = starts.map((start, i) => Math.round((start + ends[i]!) / 2)), courtDoor = westRooms[plan.courtRoom]!;
  raise(p, b);
  innerPost(p, b, west.x1, c0, 1, 1);
  frame(p, b, 'x', back.z1 - 2, west.x0 + wall, west.x1 - wall);
  for (const z of plan.partitions) partition(p, b, 'x', z, west.x0 + wall, west.x1 - wall, wx);
  // The gate: a deep timber beam on the two buildings' corner posts at the street line, under a little tiled hood.
  const gateTop = HEARTH_FEET + HEAD + 1;
  p.put(g0 - 2, gateTop, 119, g1 + 2, gateTop + 3, 122, KIT.trim);
  p.put(g0 - 4, gateTop + 3, 117, g1 + 4, gateTop + 4, 124, KIT.roof);
  p.put(g0 - 4, gateTop + 4, 118, g1 + 4, gateTop + 6, 123, KIT.roof);
  p.put(g0 - 4, gateTop + 6, 119, g1 + 4, gateTop + 7, 122, KIT.roof);
  // Flags through the gate and across the court; a garden wall with a coping on the east; one planted bed.
  pave(p, g0, c1, g1, 128);
  pave(p, west.x1, c0, 61 - wall, c1);
  p.put(61 - wall, 0, c0, 61, 10, c1, KIT.stone);
  p.put(61 - wall - 1, 10, c0, 61, 11, c1, KIT.stone);
  bed(p, 51, c0 + 2, 61 - wall, c0 + 12);
  const threshold: Vec3 = [gate, HEARTH_FEET, 120];
  doorway(p, sf.west, fz, wall);
  doorway(p, bf.south, gate, wall);
  doorway(p, wf.east, courtDoor, wall);
  const sill = 6, head = plan.head;
  window(p, 'street-west', wf.south, wall, wx - 6, wx + 6, sill, head, true);
  window(p, 'gable-eye', wf.south, wall, wx - 3, wx + 3, plan.wallTop + 4, plan.wallTop + 10);
  window(p, 'street-east', sf.south, wall, fx - 6, fx + 6, sill, head, true);
  window(p, 'west-ingle', wf.west, wall, courtDoor - 6, courtDoor + 6, sill, head, true);
  window(p, 'east-garden', sf.east, wall, fz - 5, fz + 5, sill, head, true);
  window(p, 'north-hearth', bf.north, wall, 10, 18, sill, head);
  window(p, 'court-north', bf.south, wall, 42, 50, sill, head, true);
  window(p, 'court-south', sf.north, wall, fx - 5, fx + 5, sill, head, true);
  trough(p, sf.south, fx - 7, fx + 7, sill - 1);
  chimney(p, bf.north, wall, 40, 52, 13 + (plan.wallTop - 24), crest - 3);
  const rooms: Vec3[] = [[fx, HEARTH_FEET, fz], [gate, HEARTH_FEET, back.z0 + s / 2]];
  westRooms.forEach((mid, i) => {
    rooms.push([wx, HEARTH_FEET, mid]);
    // The street-end room keeps one window ID at every size; rooms between are counted from the back.
    const id = i === westRooms.length - 1 ? 'west-parlour' : `west-room-${i + 1}`;
    if (i !== plan.courtRoom) window(p, id, wf.west, wall, mid - 5, mid + 5, sill, head, true);
  });
  return { blueprint: p.blueprint(), review: { threshold, rooms, court: [44, HEARTH_FEET, courtDoor], windows: p.windows.map(x => x.id) } };
}

/** Connected rooms around three sides of a court that is open to the sky, with a clear way in from the street. */
export function hearthCourtyard(tier: HomeTier): BuiltTemplate {
  return tier === 'hut' ? openCourt(tier) : gateCourt(tier);
}
