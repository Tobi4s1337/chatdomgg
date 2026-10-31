import type { Vec3 } from '@chatdom/shared';
import { Boxes } from '../../../civic/kit';
import { MAT, STYLES, type StyleKey } from '../../../materials';
import { IRON, checkStyle, coursed, masonry, millBlueprint, runs, stroke, wood, type Masonry } from '../millrace/craft';
import { NO_METADATA, type Footing, type WaterPiece } from '../place-piece';
import { cells, groundFooting, hash, type Region } from '../shore/shape';

/**
 * The mill by the millstream, in one frame. Its long walls run along Z; the wheel side faces +X, the front gable
 * with the door, the lucam and the sacks faces +Z, and the back gable faces −Z, in the shade. y = 0 is the yard.
 * The plaster body stands one cell inside its coursed plinth, and the timber frame stands proud of the plaster on
 * the plinth's line, so the walls read as panels between posts. Everything is in build cells.
 */
export const MILL = {
  size: [37, 75, 64] as const satisfies Vec3,
  /** The plaster body's half-open spans. The plinth and the proud timber frame stand one cell outside them. */
  body: { x: [6, 34], z: [4, 48] } as const,
  plinthTop: 12,
  /** The floor rail between the storeys, and the wall plate under the eaves. */
  rail: 21,
  /** The underside of the first roof course, how far the roof oversails every wall, and the top of the ridge roll. */
  eaves: 36,
  overhang: 3,
  ridge: 68,
  /** The wheel side's outer plane (the plinth's +X face). */
  wheelFace: 35,
  /** The shaft boss: the axle's line on a cell corner, at the outer face of its brass collar. */
  shaft: [37, 8, 26] as const satisfies Vec3,
  /** The front door: its opening, the leaf's outer cell layer and the plinth face it is recessed from. */
  door: { x: [16, 24], y: [2, 20], leaf: 44, face: 49 } as const,
  /** The lucam housing, the top of its own little roof, the hoist beam's z run and the rope's (x, z) column. */
  lucam: { x: [15, 25], y: [38, 50], z: [48, 55], ridge: 62, beam: [48, 61], rope: [20, 58] } as const,
  /** The chimney stack from where it rises out of the attic to where its cap begins, and the pot's top. */
  chimney: { base: 46, cap: 70, top: 75 } as const,
} as const;

/** Every roof course is two cells high and steps one cell in: a steep pitch that still reads as courses. */
const RISE = 2;
const SEED: Readonly<Record<StyleKey, number>> = { hearth: 101, tide: 211, grove: 307 };
/** Hemp: the hoist rope and every sack's tie. */
const TWINE = MAT.thatch;

/** One wall: its proud cell layer (the timber line), which way is out, and its span along the wall. */
interface Wall { readonly normal: 'x' | 'z'; readonly out: number; readonly sign: 1 | -1; readonly span: readonly [number, number] }
const WEST: Wall = { normal: 'x', out: 5, sign: -1, span: [3, 49] };
const EAST: Wall = { normal: 'x', out: 34, sign: 1, span: [3, 49] };
const BACK: Wall = { normal: 'z', out: 3, sign: -1, span: [5, 35] };
const FRONT: Wall = { normal: 'z', out: 48, sign: 1, span: [5, 35] };

/** A small-paned window: lower-left cell along the wall and its odd width and height, frame included. */
interface Light { readonly u: number; readonly y: number; readonly w: number; readonly h: number }

/**
 * Where the lights and studs go. Mills are lit unevenly, so no two walls match: the wheel side keeps its lower
 * storey blind behind the wheel, and the front gives its middle to the door and the lucam's braces.
 */
const WALLS: readonly { readonly wall: Wall; readonly studs: readonly number[]; readonly lights: readonly Light[] }[] = [
  { wall: FRONT, studs: [16, 23], lights: [{ u: 8, y: 13, w: 5, h: 7 }, { u: 8, y: 24, w: 7, h: 9 }, { u: 25, y: 24, w: 7, h: 9 }] },
  { wall: BACK, studs: [9, 21, 26, 30], lights: [{ u: 20, y: 13, w: 7, h: 7 }, { u: 12, y: 24, w: 7, h: 9 }, { u: 18, y: 40, w: 5, h: 5 }] },
  {
    wall: WEST, studs: [9, 23, 30, 45],
    lights: [{ u: 10, y: 13, w: 7, h: 7 }, { u: 33, y: 13, w: 7, h: 7 }, { u: 14, y: 24, w: 7, h: 9 }, { u: 36, y: 24, w: 7, h: 9 }],
  },
  { wall: EAST, studs: [17, 23, 29, 34], lights: [{ u: 7, y: 24, w: 7, h: 9 }, { u: 38, y: 24, w: 7, h: 9 }] },
];

/**
 * The crooked stack, on the wheel-side slope so it stands over the wheel in the mill's best view. Each section
 * steps off the one below on both axes, so the crook reads from the side and from either gable, while keeping
 * most of its bed on the section beneath.
 */
const STACK: readonly { readonly x: readonly [number, number]; readonly z: readonly [number, number]; readonly y: readonly [number, number] }[] = [
  { x: [26, 32], z: [8, 14], y: [MILL.chimney.base, 60] },
  { x: [28, 34], z: [10, 16], y: [60, 66] },
  { x: [26, 32], z: [9, 15], y: [66, MILL.chimney.cap] },
];

/**
 * Fills u0..u1 × y0..y1 of a wall between depths d0 and d1, half-open: depth 0 is the proud timber line, 1 the
 * plaster face, larger is inside and negative stands out in front.
 */
function slab(b: Boxes, w: Wall, u0: number, u1: number, y0: number, y1: number, d0: number, d1: number, m: number): void {
  const a = w.out - w.sign * d0, c = w.out - w.sign * (d1 - 1);
  const [lo, hi] = [Math.min(a, c), Math.max(a, c) + 1];
  if (w.normal === 'x') b.add(lo, y0, u0, hi, y1, u1, m);
  else b.add(u0, y0, lo, u1, y1, hi, m);
}

interface Course { readonly a0: number; readonly a1: number; readonly y0: number }

/**
 * A pitched roof across lo..hi from `base`: `rows` is the outer extent at every course height (what lies under the
 * roof), `courses` the slope courses `thick` cells broad, closing in a single crest course.
 */
function pitch(lo: number, hi: number, base: number, thick: number): { rows: Course[]; courses: Course[] } {
  const rows: Course[] = [], courses: Course[] = [];
  for (let k = 0; ; k++) {
    const a0 = lo + k, a1 = hi - k, y0 = base + RISE * k;
    rows.push({ a0, a1, y0 });
    if (a1 - a0 <= 2 * thick) { courses.push({ a0, a1, y0 }); break; }
    courses.push({ a0, a1: a0 + thick, y0 }, { a0: a1 - thick, a1, y0 });
  }
  return { rows, courses };
}

/**
 * A small-paned light in a deep reveal: cut through the timber line and two cells of wall, a timber frame with
 * a cross of glazing bars, and behind the glass a dim panelled room, unlit, so the window says nothing about who
 * is home. A stone sill oversails below; a timber lintel caps it. It is laid in three passes over every light
 * (panelling, hollows, glazing), so two lights near one corner share a room and neither panels over the other.
 */
function light(b: Boxes, w: Wall, l: Light, pass: 0 | 1 | 2, frame: number, sill: number): void {
  const u1 = l.u + l.w, y1 = l.y + l.h, mu = l.u + (l.w >> 1), my = l.y + (l.h >> 1);
  if (pass === 0) return slab(b, w, l.u - 1, u1 + 1, l.y - 1, y1 + 1, 3, 8, MAT.bark);
  if (pass === 1) {
    slab(b, w, l.u, u1, l.y, y1, 4, 7, MAT.air);
    return slab(b, w, l.u, u1, l.y, y1, 0, 3, MAT.air);
  }
  slab(b, w, l.u, u1, l.y, y1, 3, 4, frame);
  slab(b, w, l.u + 1, u1 - 1, l.y + 1, y1 - 1, 3, 4, MAT.glass);
  slab(b, w, mu, mu + 1, l.y + 1, y1 - 1, 3, 4, frame);
  slab(b, w, l.u + 1, u1 - 1, my, my + 1, 3, 4, frame);
  slab(b, w, l.u - 1, u1 + 1, l.y - 1, l.y, -1, 3, sill);
  slab(b, w, l.u - 1, u1 + 1, y1, y1 + 1, 0, 2, frame);
}

/** An upright sack on a 4 × 4 foot: a rounded body, a gathered shoulder, the twine tie and two ears of cloth. */
function uprightSack(b: Boxes, x: number, z: number, h: number): void {
  b.add(x, 0, z + 1, x + 4, h, z + 3, MAT.cloth);
  b.add(x + 1, 0, z, x + 3, h, z + 4, MAT.cloth);
  b.add(x + 1, h, z + 1, x + 3, h + 1, z + 3, MAT.cloth);
  b.add(x + 1, h + 1, z + 1, x + 3, h + 2, z + 3, TWINE);
  b.add(x + 1, h + 2, z + 1, x + 2, h + 3, z + 2, MAT.cloth);
  b.add(x + 2, h + 2, z + 2, x + 3, h + 3, z + 3, MAT.cloth);
  // Flour caught on the shoulder the miller carried it on.
  b.add(x, h - 1, z + 1, x + 1, h, z + 3, MAT.cream);
}

/**
 * A sack lying along `axis` from a0 to a1, four cells across from c0 and three high from y0, rounded in section.
 * `tied` puts the twine and its tuft beyond the a1 end; an untied sack lies open at a0 and has slumped towards it.
 */
function lyingSack(b: Boxes, axis: 'x' | 'z', a0: number, a1: number, c0: number, y0: number, tied: boolean): void {
  const put = (p0: number, p1: number, y: number, q0: number, q1: number, m: number) =>
    axis === 'x' ? b.add(p0, y, q0, p1, y + 1, q1, m) : b.add(q0, y, p0, q1, y + 1, p1, m);
  put(a0, a1, y0, c0 + 1, c0 + 3, MAT.cloth);
  put(a0, a1, y0 + 1, c0, c0 + 4, MAT.cloth);
  put(tied ? a0 : a0 + 2, a1, y0 + 2, c0 + 1, c0 + 3, MAT.cloth);
  if (tied) {
    put(a1, a1 + 1, y0 + 1, c0 + 1, c0 + 3, TWINE);
    put(a1 + 1, a1 + 2, y0 + 1, c0 + 1, c0 + 3, MAT.cloth);
    put(a1 + 1, a1 + 2, y0 + 2, c0 + 1, c0 + 2, MAT.cloth);
  } else {
    put(a0, a0 + 1, y0, c0 + 1, c0 + 3, MAT.cream);
    put(a0, a0 + 1, y0 + 1, c0 + 1, c0 + 3, MAT.cream);
  }
}

/**
 * The stack's stone: Grove's is brick-red against the thatch with the odd over-burnt brick, the others are laid in
 * their own stone with the odd dark one. The band tone is also the soot on the top courses.
 */
function flue(style: StyleKey): Masonry {
  const grove = style === 'grove', stone = grove ? MAT.terracotta : STYLES[style].stone;
  return { stone, band: grove ? MAT.bark : MAT.darkStone, wet: stone, moss: MAT.moss };
}

/**
 * The mill: a tall, narrow body of two and a half storeys on a coursed stone plinth, wet and mossed low on the
 * wheel side and in the shade, under a steep stepped roof that oversails every wall with bargeboards at both
 * gables and a ridge that has settled a cell along its middle. A gabled lucam projects from the front gable on two
 * knee braces, its hoist beam carrying a rope and a sack halfway up. A crooked chimney jogs sideways twice on its
 * way past the ridge to a wonky cap and a pot. Below, a recessed plank door on a stone threshold, everything
 * around its foot floured; a heap of sacks with one slumped and spilling, a barrow parked against the plinth, a
 * spare millstone leaning on the west wall, a bird box under the eaves and a window box on the front. The wheel
 * side carries an iron boss with a brass collar where the wheel's shaft enters (the `shaft` mount); the wheel and
 * its pit are separate pieces. Small-paned windows in deep reveals open on dim, unlit rooms: no presence anchors.
 */
export function createMill(style: StyleKey): WaterPiece {
  checkStyle('mill', style);
  const kit = STYLES[style], b = new Boxes(), seed = SEED[style], tones = masonry(style), timber = wood(style);
  // Tide's render is already the palest the palette allows, so only the plaster kits show older limewash.
  const frame = kit.trim, render = kit.wall, weathered = render === MAT.cream ? undefined : MAT.cream;
  const [bx0, bx1] = MILL.body.x, [bz0, bz1] = MILL.body.z, [W, H, D] = MILL.size;
  const P = MILL.plinthTop, E = MILL.eaves, O = MILL.overhang, R = MILL.rail;

  // --- Plinth and body -------------------------------------------------------------------------------------------
  b.add(bx0 - 1, 0, bz0 - 1, bx1 + 1, P, bz1 + 1, tones.stone);
  const plinth = [
    { wall: WEST, mossTo: 4 },
    { wall: EAST, wetTo: 4, mossTo: 8 },
    { wall: BACK, mossTo: 8 },
    { wall: FRONT },
  ] as const;
  plinth.forEach(({ wall, ...wear }, i) =>
    coursed(b, { normal: wall.normal, layer: wall.out, span: wall.span, y: [0, P], seed: seed + 17 * i, ...wear }, tones));
  b.add(bx0, P, bz0, bx1, E, bz1, render);
  // The attic is solid under the roof's rows, so both gables fill right up to the courses.
  const roof = pitch(bx0 - O, bx1 + O, E, 3);
  for (const r of roof.rows) b.add(Math.max(bx0, r.a0), r.y0, bz0, Math.min(bx1, r.a1), r.y0 + RISE, bz1, render);
  // Moss on the plinth's ledge in the shade and by the wheel, and a damp stain in the plaster just above it there.
  for (const [wall, n] of [[BACK, 5], [EAST, 4]] as const) for (let i = 0; i < n; i++) {
    const [s0, s1] = wall.span, u = s0 + 3 + Math.floor(hash(seed, wall.out, i, 1) * (s1 - s0 - 8));
    slab(b, wall, u, u + 2 + Math.floor(hash(seed, wall.out, i, 2) * 3), P, P + 1, 0, 1, MAT.moss);
  }
  for (let i = 0; i < 5; i++) {
    const u = 6 + Math.floor(hash(seed, i, 3) * 36);
    slab(b, EAST, u, u + 3 + Math.floor(hash(seed, i, 4) * 4), P, P + 1 + Math.floor(hash(seed, i, 5) * 2), 1, 2, MAT.moss);
  }

  // --- Timber frame, panels and windows -----------------------------------------------------------------------------
  for (const { wall, studs } of WALLS) {
    const [s0, s1] = wall.span;
    // Corner posts wrap their corner two cells each way; the floor rail and the wall plate run right round.
    slab(b, wall, s0, s0 + 2, P, E, 0, 2, frame);
    slab(b, wall, s1 - 2, s1, P, E, 0, 2, frame);
    slab(b, wall, s0, s1, R, R + 2, 0, 1, frame);
    slab(b, wall, s0, s1, E - 2, E, 0, 1, frame);
    // Upper-storey panels between the studs, a few of them in an older, paler limewash.
    const posts = [s0 + 1, ...studs, s1 - 2];
    for (let i = 0; i + 1 < posts.length; i++) {
      if (weathered !== undefined && hash(seed, wall.out, i, 6) < 0.4) slab(b, wall, posts[i]! + 1, posts[i + 1]!, R + 2, E - 2, 1, 2, weathered);
    }
    for (const u of studs) slab(b, wall, u, u + 1, R + 2, E - 2, 0, 1, frame);
  }
  // Where the plaster has fallen from the lower storey, the rubble behind it shows.
  for (const [wall, u, y, len] of [[FRONT, 27, 15, 4], [WEST, 25, 14, 5], [BACK, 8, 15, 4]] as const) {
    slab(b, wall, u, u + len, y, y + 1, 1, 2, tones.stone);
    slab(b, wall, u - 1, u + len - 1, y + 1, y + 2, 1, 2, tones.stone);
    slab(b, wall, u + 1, u + len - 2, y + 2, y + 3, 1, 2, tones.stone);
    slab(b, wall, u + 1, u + 2, y + 1, y + 2, 1, 2, MAT.air);
  }
  // The back gable: two posts flanking the attic light and a collar across, standing under the verge.
  for (const u of [16, 24]) slab(b, BACK, u, u + 1, E, 58, 0, 1, frame);
  slab(b, BACK, 12, 28, 48, 49, 0, 1, frame);
  for (const pass of [0, 1, 2] as const) for (const { wall, lights } of WALLS) for (const l of lights) light(b, wall, l, pass, frame, kit.stone);

  // --- The door ------------------------------------------------------------------------------------------------------
  const [d0, d1] = MILL.door.x, [dy0, dy1] = MILL.door.y, leaf = MILL.door.leaf, face = MILL.door.face;
  // Quoined stone jambs, long and short in turn, through the wall to the leaf, with their beds sunk on the face.
  for (let y = 0, i = 0; y < dy1; y += 3, i++) {
    const reach = i % 2 ? 2 : 3, top = Math.min(y + 3, dy1);
    b.add(d0 - reach, y, leaf + 1, d0, top, face, kit.stone);
    b.add(d1, y, leaf + 1, d1 + reach, top, face, kit.stone);
    if (y) for (const [x0, x1] of [[d0 - reach, d0], [d1, d1 + reach]] as const) b.add(x0, y, face - 1, x1, y + 1, face, MAT.air);
  }
  b.add(d0, dy0, leaf + 1, d1, dy1, face, MAT.air);
  // Shoulders soften the head; an oak lintel spans it.
  b.add(d0, dy1 - 1, leaf + 1, d0 + 1, dy1, face, kit.stone);
  b.add(d1 - 1, dy1 - 1, leaf + 1, d1, dy1, face, kit.stone);
  b.add(d0 - 3, dy1, leaf + 1, d1 + 3, dy1 + 2, face, frame);
  // The leaf: three boards with sunk joints, two iron straps, an iron latch and a brass ring. Grove's oak has
  // weathered to a warm grey-brown, lighter than its frame, so the door still reads deep in its reveal.
  b.add(d0, dy0, leaf - 1, d1, dy1, leaf + 1, style === 'grove' ? MAT.earth : timber.plank);
  for (const x of [d0 + 2, d0 + 5]) b.add(x, dy0, leaf, x + 1, dy1, leaf + 1, MAT.air);
  for (const y of [dy0 + 3, dy1 - 5]) {
    b.add(d0, y, leaf + 1, d1 - 1, y + 1, leaf + 2, IRON);
    b.add(d0, y - 1, leaf + 1, d0 + 2, y + 2, leaf + 2, IRON);
  }
  b.add(d1 - 3, dy0 + 9, leaf + 1, d1 - 1, dy0 + 10, leaf + 2, IRON);
  b.add(d1 - 2, dy0 + 8, leaf + 1, d1 - 1, dy0 + 9, leaf + 2, MAT.brass);
  // Flour up the lower boards, highest where the sacks go through.
  for (let x = d0; x < d1; x++) b.add(x, dy0, leaf, x + 1, dy0 + 1 + Math.floor(hash(seed, x, 7) * 3), leaf + 1, MAT.cream);
  // The threshold: a stone sill under the leaf running out as the top step, and a low flag before it.
  b.add(d0 - 1, 0, leaf - 1, d1 + 1, 2, face + 2, kit.stone);
  b.add(d0 - 2, 0, face + 2, d1 + 2, 1, face + 5, kit.stone);
  // Flour trodden over both steps, thickest at the door, and out onto the yard where the sacks are set down.
  const dust = (y: number, x0: number, x1: number, z0: number, z1: number, p: (z: number) => number, salt: number) => {
    const out: [number, number][] = [];
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) if (hash(seed, x, z, salt) < p(z)) out.push([x, z]);
    runs(out, (u0, u1, z) => b.add(u0, y, z, u1, y + 1, z + 1, MAT.cream));
  };
  dust(1, d0 - 1, d1 + 1, leaf + 1, face + 2, z => 0.85 - 0.08 * (z - leaf), 8);
  dust(0, d0 - 2, d1 + 2, face + 2, face + 5, () => 0.4, 9);
  const yard: [number, number][] = [];
  for (let z = face + 5; z < face + 12; z++) {
    // A drift fanning from the step, and a spill from the slumped sack's open mouth joining it.
    const half = 5.5 - 0.7 * (z - face - 5) + hash(seed, z, 10) * 1.5;
    for (let x = d0 - 2; x < d1 + 2; x++) {
      const drift = Math.abs(x + 0.5 - (d0 + d1) / 2) < half;
      const spill = x >= d1 - 9 && x < d1 - 3 && Math.abs(z + 0.5 - 57.5) < 0.6 + 0.45 * (d1 - 3 - x);
      if ((drift && hash(seed, x, z, 11) < 0.8) || spill) yard.push([x, z]);
    }
  }
  runs(yard, (u0, u1, z) => b.add(u0, 0, z, u1, 1, z + 1, MAT.cream));

  // --- Roof --------------------------------------------------------------------------------------------------------
  const [vz0, vz1] = [bz0 - O, bz1 + O];
  for (const c of roof.courses) b.add(c.a0, c.y0, vz0, c.a1, c.y0 + RISE, vz1, kit.roof);
  // Bargeboards under every verge course, so both gables are edged in a stepped timber line.
  for (const c of roof.courses) for (const z of [vz0, vz1 - 1]) b.add(c.a0, c.y0, z, c.a1, c.y0 + 1, z + 1, timber.plank);
  const crest = roof.rows.at(-1)!, top = crest.y0 + RISE;
  b.add(crest.a0 - 1, top, vz0, crest.a1 + 1, top + 2, vz1, kit.roof);
  b.add(crest.a0 - 1, top + 1, bz0 + 14, crest.a1 + 1, top + 2, bz1 - 14, MAT.air);
  const [ex0, ex1] = [bx0 - O, bx1 + O];
  if (style === 'grove') {
    // Thatch: liggers pinned along the ridge roll, and a ragged fringe hanging from both eaves.
    for (let z = vz0 + 2; z < vz1 - 1; z += 4) for (const x of [crest.a0 - 1, crest.a1]) b.add(x, top, z, x + 1, top + 1, z + 1, MAT.bark);
    for (const x of [ex0, ex1 - 1]) {
      const fringe: [number, number][] = [];
      for (let z = vz0; z < vz1; z++) if (hash(seed, x, z, 12) < 0.45) fringe.push([z, 0]);
      runs(fringe, (z0, z1) => b.add(x, E - 1, z0, x + 1, E, z1, MAT.thatch));
    }
  } else {
    // Tile and slate: rafter feet under the eaves, every half metre.
    for (let z = bz0 + 1; z < bz1; z += 4) for (const [x0, x1] of [[ex0, ex0 + 2], [ex1 - 2, ex1]] as const) b.add(x0, E - 1, z, x1, E, z + 1, frame);
  }
  // Moss on the shaded lower courses of the west slope, towards the back.
  for (let k = 0; k < 7; k++) {
    if (hash(seed, k, 13) > 0.65) continue;
    const z = vz0 + Math.floor(hash(seed, k, 14) * 22), len = 3 + Math.floor(hash(seed, k, 15) * 6);
    b.add(ex0 + k, E + RISE * k, z, ex0 + k + 1, E + RISE * (k + 1), z + len, MAT.moss);
  }

  // --- The lucam -----------------------------------------------------------------------------------------------------
  const L = MILL.lucam, [lx0, lx1] = L.x, [ly0, ly1] = L.y, [lz0, lz1] = L.z;
  // Pale weatherboarding, so the housing stands clear of the gable behind it: a shadowed lap every third row down
  // both sides, a timber sill and corner posts, and the dark loading door set back a cell in its face.
  b.add(lx0, ly0, lz0, lx1, ly1, lz1, render);
  for (let y = ly0 + 3; y < ly1; y += 3) for (const x of [lx0, lx1 - 1]) b.add(x, y, lz0, x + 1, y + 1, lz1, frame);
  b.add(lx0, ly0, lz0, lx1, ly0 + 1, lz1, frame);
  for (const x of [lx0, lx1 - 1]) b.add(x, ly0, lz1 - 1, x + 1, ly1, lz1, frame);
  b.add(lx0 + 2, ly0 + 2, lz1 - 1, lx1 - 2, ly1 - 2, lz1, MAT.air);
  b.add(lx0 + 2, ly0 + 2, lz1 - 2, lx1 - 2, ly1 - 2, lz1 - 1, timber.plank);
  for (const x of [lx0 + 4, lx0 + 6]) b.add(x, ly0 + 2, lz1 - 2, x + 1, ly1 - 2, lz1 - 1, timber.end);
  for (const y of [ly0 + 4, ly1 - 4]) b.add(lx0 + 2, y, lz1 - 1, lx1 - 3, y + 1, lz1, IRON);
  // Its own little roof, filled beneath and bargeboarded at the front.
  const hood = pitch(lx0 - 2, lx1 + 2, ly1, 2);
  for (const r of hood.rows) b.add(Math.max(lx0, r.a0), r.y0, lz0, Math.min(lx1, r.a1), r.y0 + RISE, lz1, render);
  for (const c of hood.courses) {
    b.add(c.a0, c.y0, lz0, c.a1, c.y0 + RISE, lz1 + 1, kit.roof);
    b.add(c.a0, c.y0, lz1, c.a1, c.y0 + 1, lz1 + 1, timber.plank);
  }
  // Two knee braces from the studs below carry its floor.
  for (const x of [lx0 + 1, lx1 - 2]) {
    runs(stroke([lz0 + 0.5, R + 8.5], [lz1 - 1.5, ly0 - 0.5]), (z0, z1, y) => b.add(x, y, z0, x + 1, y + 1, z1, frame));
  }
  // The hoist: a beam out under the hood's ridge, an iron block, the rope and a sack halfway up.
  const [rx, rz] = L.rope, [, bz] = L.beam;
  b.add(rx - 1, 54, lz0, rx + 1, 56, bz, timber.plank);
  b.add(rx - 1, 54, bz - 1, rx + 1, 56, bz, timber.end);
  b.add(rx - 1, 51, rz, rx + 1, 54, rz + 2, IRON);
  b.add(rx, 30, rz, rx + 1, 51, rz + 1, TWINE);
  b.add(rx - 2, 23, rz - 1, rx + 3, 28, rz + 2, MAT.cloth);
  b.add(rx - 1, 23, rz - 2, rx + 2, 28, rz + 3, MAT.cloth);
  b.add(rx - 1, 22, rz - 1, rx + 2, 23, rz + 2, MAT.cloth);
  b.add(rx - 1, 28, rz - 1, rx + 2, 29, rz + 2, MAT.cloth);
  b.add(rx - 1, 29, rz - 1, rx + 2, 30, rz + 2, TWINE);
  b.add(rx - 1, 30, rz - 1, rx, 31, rz, MAT.cloth);
  b.add(rx + 1, 30, rz + 1, rx + 2, 31, rz + 2, MAT.cloth);

  // --- The chimney ---------------------------------------------------------------------------------------------------
  const brick = flue(style), slope = (x: number) => E + RISE * (ex1 - x);
  STACK.forEach((s, i) => {
    b.add(s.x[0], s.y[0], s.z[0], s.x[1], s.y[1], s.z[1], brick.stone);
    const faces = [
      { normal: 'x', layer: s.x[0], span: s.z }, { normal: 'x', layer: s.x[1] - 1, span: s.z },
      { normal: 'z', layer: s.z[0], span: s.x }, { normal: 'z', layer: s.z[1] - 1, span: s.x },
    ] as const;
    faces.forEach((f, j) => coursed(b, { ...f, y: s.y, seed: seed + 50 + 7 * i + j }, brick));
    // Below the thatch line the stack is solid: no joint is cut into the roof it rises through.
    for (let x = s.x[0]; x < s.x[1]; x++) b.add(x, s.y[0], s.z[0], x + 1, Math.min(s.y[1], slope(x)), s.z[1], brick.stone);
  });
  // Soot on the top courses, a corbelled cap that has dropped a cell on one side, and a pot.
  const last = STACK.at(-1)!, cap = MILL.chimney.cap;
  b.add(last.x[0], cap - 2, last.z[0], last.x[1], cap, last.z[1], brick.band);
  b.add(last.x[0] - 1, cap, last.z[0] - 1, last.x[1] + 1, cap + 1, last.z[1] + 1, brick.stone);
  b.add(last.x[1] - 3, cap + 1, last.z[0] - 1, last.x[1] + 1, cap + 2, last.z[1] + 1, kit.stone);
  b.add(last.x[0] + 1, cap + 1, last.z[0] + 2, last.x[0] + 4, MILL.chimney.top, last.z[0] + 5, MAT.terracotta);
  b.add(last.x[0] + 2, cap + 2, last.z[0] + 3, last.x[0] + 3, MILL.chimney.top, last.z[0] + 4, MAT.air);

  // --- The shaft boss on the wheel side ------------------------------------------------------------------------------
  // A dressed bearing stone let into the coursing, an iron plate on it with a broad brass collar standing proud
  // (it has to read against Grove's dark stone), and the socket the shaft's end turns in.
  const [sx, sy, sz] = MILL.shaft, f = MILL.wheelFace;
  b.add(f - 1, sy - 5, sz - 5, f, P, sz + 5, kit.stone);
  b.add(f, sy - 4, sz - 3, f + 1, sy + 4, sz + 3, IRON);
  b.add(f, sy - 3, sz - 4, f + 1, sy + 3, sz + 4, IRON);
  b.add(f + 1, sy - 3, sz - 2, sx, sy + 3, sz + 2, MAT.brass);
  b.add(f + 1, sy - 2, sz - 3, sx, sy + 2, sz + 3, MAT.brass);
  b.add(f - 1, sy - 1, sz - 1, sx, sy + 1, sz + 1, MAT.air);

  // --- Little stories round the walls ----------------------------------------------------------------------------------
  // Sacks by the door: two standing against the plinth, one lying before them with another across it, and one
  // slumped open under the hoist, its flour run out onto the yard.
  uprightSack(b, 30, bz1 + 1, 5);
  uprightSack(b, 26, bz1 + 2, 4);
  lyingSack(b, 'x', 27, 34, 54, 0, true);
  lyingSack(b, 'z', 54, 58, 29, 3, true);
  lyingSack(b, 'x', d1 - 3, d1 + 3, 55, 0, false);
  // A barrow parked with its handles against the plinth, flour in the tray.
  b.add(7, 3, 51, 13, 6, 57, timber.plank);
  b.add(8, 4, 52, 12, 6, 56, MAT.air);
  b.add(9, 4, 53, 11, 5, 55, MAT.cream);
  for (const x of [7, 12]) { b.add(x, 0, 51, x + 1, 3, 52, timber.plank); b.add(x, 5, bz1 + 1, x + 1, 6, 51, timber.plank); }
  const tyre: [number, number][] = [];
  for (let y = 0; y < 6; y++) for (let z = 56; z < 63; z++) if (Math.hypot(z + 0.5 - 59, y + 0.5 - 2.6) < 2.7) tyre.push([z, y]);
  runs(tyre, (z0, z1, y) => b.add(9, y, z0, 11, y + 1, z1, timber.plank));
  b.add(8, 2, 59, 12, 3, 60, IRON);
  // A spare millstone on its edge, leaning on the west plinth, its eye through and moss along its top.
  const stone: [number, number][] = [];
  for (let y = 0; y < 12; y++) for (let z = 21; z < 33; z++) if (Math.hypot(z + 0.5 - 27, y + 0.5 - 6) < 5.9) stone.push([z, y]);
  const lean = (y: number) => (y < 6 ? 2 : 3), inStone = new Set(stone.map(([z, y]) => z * 64 + y));
  runs(stone, (z0, z1, y) => b.add(lean(y), y, z0, lean(y) + 2, y + 1, z1, MAT.darkStone));
  // Its dressed face: furrows swept off the eye like the strings of a harp, still white with the last grinding.
  for (const a of [0.5, 2.1, 3.7, 5.2]) {
    const furrow = stroke([27 + 1.2 * Math.cos(a), 6 + 1.2 * Math.sin(a)], [27 + 5 * Math.cos(a + 0.35), 6 + 5 * Math.sin(a + 0.35)], 0.5);
    runs(furrow.filter(([z, y]) => inStone.has(z * 64 + y)), (z0, z1, y) => b.add(lean(y), y, z0, lean(y) + 1, y + 1, z1, MAT.cream));
  }
  b.add(2, 5, 26, 5, 7, 28, MAT.air);
  b.add(3, 11, 26, 5, 12, 28, MAT.moss);
  // A bird box on the west wall with its own little roof, a hole and a perch.
  b.add(3, 27, 25, 6, 31, 28, timber.plank);
  b.add(2, 31, 24, 6, 32, 29, kit.roof);
  b.add(3, 29, 26, 4, 30, 27, MAT.air);
  b.add(2, 28, 26, 3, 29, 27, frame);
  // A window box hung on the floor rail under the front's west light.
  b.add(8, R, bz1 + 1, 15, R + 2, bz1 + 3, timber.plank);
  for (let x = 8; x < 15; x++) {
    b.add(x, R + 2, bz1 + 2, x + 1, R + 3, bz1 + 3, MAT.leaf);
    const r = hash(seed, x, 16);
    if (r < 0.6) b.add(x, R + 3, bz1 + 2, x + 1, R + 4, bz1 + 3, r < 0.3 ? MAT.petal : r < 0.45 ? MAT.blueFlower : MAT.leaf);
  }

  const blueprint = millBlueprint(`water-${style}-mill`, style, 'civic', [W, H, D], b);
  const read = cells(blueprint.boxes, blueprint.size);
  const ground = (id: string, region: Region): Footing => ({ id, box: groundFooting(read, blueprint.size, region) });
  return {
    ...NO_METADATA, blueprint,
    footings: [
      { id: 'plinth', box: { from: [bx0 - 1, 0, bz0 - 1], to: [bx1 + 1, 1, bz1 + 1] } },
      ground('threshold', { x: [d0 - 2, d1 + 2], z: [face, face + 5] }),
      ground('yard', { x: [d0 - 2, d1 + 2], z: [face + 5, D] }),
      ground('sacks', { x: [d1 + 2, W], z: [face, D] }),
      ground('barrow', { x: [0, d0 - 2], z: [face, D] }),
      ground('millstone', { x: [0, bx0 - 1], z: [0, face] }),
    ],
    // From the flag up onto the sill to a stride short of the leaf (its straps stand a cell proud of it).
    walks: [{
      id: 'threshold', axis: 'z', along: [leaf + 2, face + 5], across: [d0 + 1, d1 - 1],
      tops: Array.from({ length: face + 3 - leaf }, (_, i) => (leaf + 2 + i < face + 2 ? 2 : 1)),
    }],
    mounts: [{ id: 'shaft', position: MILL.shaft, axis: [1, 0, 0] }],
  };
}
