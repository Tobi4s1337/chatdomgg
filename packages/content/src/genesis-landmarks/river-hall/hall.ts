import { StyleIdSchema, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES, type StyleKey } from '../../materials';
import { CREST_HEIGHT, CREST_WIDTH, FLAG_HEIGHT, FLAG_LENGTH, crestGrid, type BannerCut, type CrestCharge, type CrestShape } from '../heraldry';
import { Boxes, LANDMARK_KITS, hash, type LandmarkKit } from '../kit';
import { extentOf, flagBlueprint } from '../parts';
import type { CellBox, LandmarkEmitter, LandmarkGlazing, LandmarkPiece, LandmarkWalk, LocalFacing } from '../types';

/**
 * The river hall: a civic hall carried across the river on three stone arches, between two tall crow-stepped
 * pavilions, one on each bank. Its visual rhythm is drawn from the kingdom's Retro category as a cue only, never as
 * game imagery: the gallery is eight identical bays like a row of tiles, each a tall window with a stepped
 * (pixel) head between pilasters; a two-colour checker frieze runs under the eaves; the gallery roof is laid in a
 * lozenge diaper on a coarse grid; the gables climb in square crow steps; the voussoirs alternate pale and grey;
 * and a lantern hangs at every pilaster and every arch crown, so at night the hall reads as an even marquee of
 * small warm lights doubled in the water.
 *
 * Frame, in build cells: the span runs along Z, the river flows along X under the arches. y = 0 is the river bed
 * the piers stand on; the water surface is drawn at `RIVER_HALL.water` and both banks at `RIVER_HALL.bank`. The
 * front (+Z) is the town bank: its pavilion carries the door, the crest, the bell cote and the flag, with a flight
 * of steps down to the bank. The far pavilion (−Z) is closed. A watermill kingdom's hall also turns an undershot
 * wheel on a timber trestle beside its downstream face, as a separate part on its axle.
 */
export interface RiverHallOptions {
  readonly style: StyleKey;
  /** A watermill kingdom's hall turns a wheel in the river; every other kingdom's hall does not. */
  readonly wheel: boolean;
  readonly crest: { readonly shape: CrestShape; readonly charge: CrestCharge };
  readonly bannerCut: BannerCut;
  /** Snapped cloth materials: the field of crest, banners and flag, and their band. */
  readonly colours: { readonly field: number; readonly band: number };
}

export const RIVER_HALL_SIZE: Vec3 = [112, 200, 256];
/** The middle of the span on the hall's long axis, over the middle of the centre arch, in cells. */
export const RIVER_HALL_AXIS = { x: 56, z: 116 } as const;
const CX = RIVER_HALL_AXIS.x;

/** The measured planes of the hall, shared by the factory, its metadata and its tests. */
export const RIVER_HALL = {
  water: 14,
  bank: 32,
  floor: 40,
  /** The bridge's masonry between its outer faces; the arches pass through it along X. */
  deck: { x: [28, 84] as const, z: [52, 180] as const },
  /** Each arch springs from the water line; `z` is its clear span between the piers or abutments. */
  arches: [
    { id: 'arch-far', z: [52, 82] as const, radius: 15 },
    { id: 'arch-middle', z: [96, 136] as const, radius: 20 },
    { id: 'arch-near', z: [150, 180] as const, radius: 15 },
  ] as const,
  ring: 3,
  piers: [[82, 96], [136, 150]] as const,
  /** Pointed cutwaters run out this far from both faces of every pier. */
  cutwater: 14,
  gallery: { x: [24, 88] as const, z: [52, 180] as const, y: [40, 84] as const, wall: 3 },
  bays: { count: 8, width: 16, window: 8, sill: 50, head: 70 },
  frieze: { y: [78, 84] as const, tile: 3 },
  eaves: 84,
  galleryRoof: { base: 86, half: 35 },
  pavilions: { x: [20, 92] as const, far: [4, 52] as const, near: [180, 228] as const, top: 112, wall: 4 },
  gable: { steps: 9, run: 4, rise: 5, thickness: 4 },
  pavilionRoof: { half: 36 },
  door: {
    opening: { x: [50, 62] as const, y: [40, 60] as const, z: [224, 230] as const },
    /** Stepped head rows above the opening: [y, x0, x1]. */
    arch: [[60, 51, 61], [61, 52, 60], [62, 53, 59], [63, 55, 57]] as const,
    leaf: { x: [50, 62] as const, y: [40, 64] as const, z: [221, 223] as const },
    threshold: 40,
    /** Seven steps from the door case down to the bank: [top, z0, z1, x0, x1]. */
    steps: Array.from({ length: 7 }, (_, k) => [39 - k, 230 + 2 * k, 232 + 2 * k, 44 - k, 68 + k] as const),
  },
  crest: { x: 49, y: 69, face: 227 },
  lanterns: { door: [{ id: 'door-lantern-west', x: 42 }, { id: 'door-lantern-east', x: 70 }] as const, glass: 5 },
  bench: { x: [24, 38] as const, y: [35, 36] as const, z: [248, 252] as const },
  cote: { x: [50, 62] as const, z: [221, 229] as const, y: [157, 179] as const, bell: { x: 56, y: 164, z: 225 } },
  pole: { x: [55, 57] as const, z: [224, 226] as const, y: [181, 199] as const },
  flag: { offset: [57, 185, 224] as const, pivot: [-1, 0, 1] as const },
  rose: { x: 56, y: 128, radius: 7 },
  wheel: { centre: [98, 24, 67] as const, radius: 12, width: [61, 73] as const, axle: [57, 77] as const, posts: [[57, 59], [75, 77]] as const },
} as const;

const { water: WATER, floor: FLOOR } = RIVER_HALL;

export function createRiverHall(options: RiverHallOptions): LandmarkPiece {
  const { style, wheel, crest, bannerCut, colours } = options;
  if (!(style in LANDMARK_KITS)) throw new Error(`Unknown landmark style ${String(style)}.`);
  if (typeof wheel !== 'boolean') throw new Error('The river hall needs to know whether it turns a wheel.');
  const kit = LANDMARK_KITS[style];
  const b = new HallBoxes();

  abutments(b, kit);
  bridge(b, kit);
  gallery(b, kit);
  galleryRoof(b, kit);
  for (const side of ['far', 'near'] as const) pavilion(b, kit, side);
  frontFace(b, kit, crest, colours);
  backFace(b, kit);
  cote(b, kit);
  lanterns(b, kit, wheel);
  bank(b, kit);
  if (wheel) trestle(b, kit);

  const id = `genesis-river-hall-${style}-${wheel ? 'wheel' : 'still'}-${crest.shape}-${crest.charge}-${bannerCut}-${colours.field}-${colours.band}`;
  const blueprint: VoxelBlueprint = {
    version: 1, id, styleId: StyleIdSchema.parse(STYLES[style].id), kind: 'civic', lattice: 'build',
    size: [...RIVER_HALL_SIZE], boxes: b.list, windows: [],
  };
  const { offset, pivot } = RIVER_HALL.flag;
  const parts: LandmarkPiece['parts'][number][] = [
    { id: 'flag', blueprint: flagBlueprint('river-hall', style, kit, bannerCut, colours), mount: 'flag-hoist', offset: [...offset] as Vec3, pivot: [...pivot] as Vec3 },
  ];
  if (wheel) {
    const { centre, radius, axle } = RIVER_HALL.wheel;
    parts.push({ id: 'wheel', blueprint: wheelPart(style, kit), mount: 'mill-wheel', offset: [centre[0] - radius, centre[1] - radius, axle[0]], pivot: [radius, radius, centre[2] - axle[0]] });
  }
  return { blueprint, ...metadata(blueprint, wheel), glazing: b.glazing, parts };
}

// ── Faces ────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A wall face: its outer surface lies on `plane` across `axis`, and `out` is the outward direction. Depths count
 * from the outer surface into the wall (negative depths stand proud of it); `u` runs along the face (Z on an X face,
 * X on a Z face).
 */
interface Face { readonly axis: 'x' | 'z'; readonly plane: number; readonly out: 1 | -1 }
const WEST: Face = { axis: 'x', plane: RIVER_HALL.gallery.x[0], out: -1 };
const EAST: Face = { axis: 'x', plane: RIVER_HALL.gallery.x[1], out: 1 };
const facingOf = (face: Face): LocalFacing => (face.axis === 'x' ? (face.out === 1 ? 'east' : 'west') : face.out === 1 ? 'south' : 'north');
const sideOf = (face: Face): string => facingOf(face);

/** The hall's boxes, and the glazed panes laid as it is built. */
class HallBoxes extends Boxes {
  readonly glazing: LandmarkGlazing[] = [];
  /** A pane on `face`, its outer surface `depth` cells in. */
  pane(opening: string, face: Face, depth: number, u0: number, u1: number, y0: number, y1: number): void {
    const plane = face.plane - face.out * depth, centre: Vec3 = face.axis === 'x' ? [plane, (y0 + y1) / 2, (u0 + u1) / 2] : [(u0 + u1) / 2, (y0 + y1) / 2, plane];
    const index = this.glazing.filter(g => g.opening === opening).length;
    this.glazing.push({ id: `${opening}/${index}`, opening, centre, width: u1 - u0, height: y1 - y0, facing: facingOf(face) });
  }
}

function slab(b: Boxes, face: Face, d0: number, d1: number, u0: number, u1: number, y0: number, y1: number, material: number): void {
  const [p0, p1] = face.out === 1 ? [face.plane - d1, face.plane - d0] : [face.plane + d0, face.plane + d1];
  if (face.axis === 'x') b.add(p0, y0, u0, p1, y1, u1, material);
  else b.add(u0, y0, p0, u1, y1, p1, material);
}

/**
 * A window of width `w` centred at `uc`: an opening `depth` deep from `y0` to `y1`, then a head that steps in a cell
 * each side every two rows, glazed two cells in, on a proud sill. `frame` adds a one-cell band outline that follows
 * the steps. Returns the glass centre.
 */
function windowOn(b: HallBoxes, kit: LandmarkKit, id: string, face: Face, uc: number, w: number, y0: number, y1: number, depth: number, frame: boolean): void {
  const h = w / 2, rows: [number, number, number][] = [[y0, y1, h]];
  for (let k = 1, y = y1; h - k > 0; k++, y += 2) rows.push([y, y + 2, h - k]);
  if (frame) {
    slab(b, face, -1, 0, uc - h - 1, uc + h + 1, y0, y1, kit.band);
    for (const [r0, r1, half] of rows.slice(1)) slab(b, face, -1, 0, uc - half - 1, uc + half + 1, r0 - 1, r1 + 1, kit.band);
  }
  for (const [r0, r1, half] of rows) slab(b, face, frame ? -1 : 0, depth, uc - half, uc + half, r0, r1, MAT.air);
  for (const [r0, r1, half] of rows) {
    slab(b, face, 2, 3, uc - half, uc + half, r0, r1, MAT.glass);
    b.pane(id, face, 2, uc - half, uc + half, r0, r1);
  }
  // A timber mullion a cell proud of the glass splits a wide light in two.
  if (w >= 8) slab(b, face, 1, 3, uc - 1, uc + 1, y0, y1, kit.trim);
  slab(b, face, -1, 2, uc - h - 1, uc + h + 1, y0 - 2, y0, kit.band);
}

// ── Banks, piers and arches ──────────────────────────────────────────────────────────────────────────────────────

function abutments(b: Boxes, kit: LandmarkKit): void {
  const { pavilions, deck, bank } = RIVER_HALL;
  // Each abutment is founded on the bed and carries its pavilion; above the bank it shows as a grey base course.
  b.add(pavilions.x[0], 0, 0, pavilions.x[1], FLOOR, deck.z[0], kit.stone);
  b.add(pavilions.x[0], 0, deck.z[1], pavilions.x[1], FLOOR, 256, kit.stone);
  b.add(pavilions.x[0] - 1, bank, pavilions.far[0], pavilions.x[1] + 1, FLOOR - 2, pavilions.far[1], kit.base);
  b.add(pavilions.x[0] - 1, bank, pavilions.near[0], pavilions.x[1] + 1, FLOOR - 2, pavilions.near[1], kit.base);
  b.add(pavilions.x[0] - 1, FLOOR - 2, pavilions.far[0], pavilions.x[1] + 1, FLOOR, pavilions.far[1], kit.band);
  b.add(pavilions.x[0] - 1, FLOOR - 2, pavilions.near[0], pavilions.x[1] + 1, FLOOR, pavilions.near[1], kit.band);
  // The bank in front of each pavilion is the abutment's paved top at bank height.
  b.add(pavilions.x[0], bank, 0, pavilions.x[1], FLOOR, pavilions.far[0], MAT.air);
  b.add(pavilions.x[0], bank, pavilions.near[1], pavilions.x[1], FLOOR, 256, MAT.air);
  b.add(pavilions.x[0], bank - 1, 0, pavilions.x[1], bank, pavilions.far[0], kit.base);
  b.add(pavilions.x[0], bank - 1, pavilions.near[1], pavilions.x[1], bank, 256, kit.base);
}

/** Height of an arch's ring extrados over column z (a cell), or −1 off the ring. */
function extrados(z: number): number {
  let top = -1;
  for (const arch of RIVER_HALL.arches) {
    const zc = (arch.z[0] + arch.z[1]) / 2, R = arch.radius + RIVER_HALL.ring, dz = z + 0.5 - zc;
    if (Math.abs(dz) < R) top = Math.max(top, WATER + Math.sqrt(R * R - dz * dz));
  }
  return top;
}

function bridge(b: Boxes, kit: LandmarkKit): void {
  const { deck, arches, ring, piers, cutwater } = RIVER_HALL;
  b.add(deck.x[0], 0, deck.z[0], deck.x[1], FLOOR - 2, deck.z[1], kit.stone);
  // Cutwaters: pointed both ways, rising to a capped slope that falls towards the nose.
  for (const [p0, p1] of piers) {
    const pc = (p0 + p1) / 2, half = (p1 - p0) / 2;
    for (let d = 0; d < cutwater; d += 2) {
      const hw = Math.max(1, Math.round(half * (1 - (d + 1) / cutwater))), top = 30 - Math.floor(d / 2);
      for (const [x0, x1] of [[deck.x[0] - d - 2, deck.x[0] - d], [deck.x[1] + d, deck.x[1] + d + 2]] as const) {
        b.add(x0, 0, pc - hw, x1, top, pc + hw, kit.base);
        b.add(x0, top - 1, pc - hw, x1, top, pc + hw, kit.band);
      }
    }
    // The piers' own faces in the base stone, and weed along the water line.
    b.add(deck.x[0] - 1, 0, p0, deck.x[1] + 1, WATER + 2, p1, kit.base);
    for (const [x0, x1] of [[deck.x[0] - 1, deck.x[0]], [deck.x[1], deck.x[1] + 1]] as const) {
      for (let z = p0 + 1; z < p1; z += 4) b.add(x0, WATER - 1, z, x1, WATER + (hash(z, x0, 0, 81) < 0.5 ? 1 : 2), z + 2, MAT.moss);
    }
  }
  // The arches: a barrel through the deck, open from the bed to the soffit, its ring of alternating voussoirs
  // standing a cell proud of both faces.
  for (const arch of arches) {
    const zc = (arch.z[0] + arch.z[1]) / 2, r = arch.radius, R = r + ring;
    b.add(deck.x[0], 0, arch.z[0], deck.x[1], WATER, arch.z[1], MAT.air);
    const voussoirs = r > 16 ? 13 : 11;
    const cell = (z: number, y: number): number => {
      const dz = z + 0.5 - zc, dy = y + 0.5 - WATER, d = Math.hypot(dz, dy);
      if (d < r) return -1;
      if (d < R) return Math.floor((Math.atan2(dy, -dz) / Math.PI) * voussoirs) % 2 ? kit.rock : kit.band;
      return 0;
    };
    // Each row's runs, merged upwards into rectangles while the run below matches exactly.
    const open = new Map<string, { material: number; z0: number; z1: number; y0: number; y1: number }>();
    const emit = ({ material, z0, z1, y0, y1 }: { material: number; z0: number; z1: number; y0: number; y1: number }) => {
      if (material === -1) b.add(deck.x[0], y0, z0, deck.x[1], y1, z1, MAT.air);
      else b.add(deck.x[0] - 1, y0, z0, deck.x[1] + 1, y1, z1, material);
    };
    for (let y = WATER; y < WATER + R; y++) {
      const from = arch.z[0] - ring, to = arch.z[1] + ring;
      let start = from;
      for (let z = from + 1; z <= to; z++) {
        if (z < to && cell(z, y) === cell(start, y)) continue;
        const material = cell(start, y);
        if (material !== 0) {
          const key = `${material}:${start}:${z}`, run = open.get(key);
          if (run && run.y1 === y) run.y1 = y + 1;
          else { if (run) emit(run); open.set(key, { material, z0: start, z1: z, y0: y, y1: y + 1 }); }
        }
        start = z;
      }
    }
    for (const run of open.values()) emit(run);
    // The keystone stands a cell further out and a course higher.
    b.add(deck.x[0] - 2, WATER + r, zc - 1, deck.x[1] + 2, WATER + R + 1, zc + 1, kit.band);
  }
  // A few darker stones in the spandrels so the masonry reads as laid blocks.
  for (let i = 0; i < 34; i++) {
    const z = deck.z[0] + 1 + Math.floor(hash(i, 1, 0, 82) * (deck.z[1] - deck.z[0] - 5)), y = WATER + 3 + Math.floor(hash(i, 2, 0, 82) * 16);
    const w = 3 + Math.floor(hash(i, 3, 0, 82) * 3);
    if (extrados(z) + 1 >= y || extrados(z + w - 1) + 1 >= y) continue;
    const x = i % 2 ? deck.x[0] : deck.x[1] - 1;
    b.add(x, y, z, x + 1, y + 2, z + w, kit.rock);
  }
  // Corbels under the jettied gallery: three tiers, each a cell further out, wherever the arch rings leave room.
  for (let z = deck.z[0] + 2; z + 2 <= deck.z[1] - 2; z += 4) {
    if (Math.max(extrados(z), extrados(z + 1)) > 31) continue;
    for (let tier = 0; tier < 3; tier++) b.add(deck.x[0] - 1 - tier, 32 + 2 * tier, z, deck.x[1] + 1 + tier, 34 + 2 * tier, z + 2, kit.stone);
  }
}

// ── The gallery ──────────────────────────────────────────────────────────────────────────────────────────────────

function gallery(b: HallBoxes, kit: LandmarkKit): void {
  const { gallery: g, bays, frieze, eaves } = RIVER_HALL;
  // The jetty: a timber floor beam carried over the corbels, the plastered walls, and the room behind them.
  b.add(g.x[0], FLOOR - 2, g.z[0], g.x[1], FLOOR, g.z[1], kit.trim);
  b.add(g.x[0], FLOOR, g.z[0], g.x[1], eaves, g.z[1], kit.wall);
  b.add(g.x[0] - 1, FLOOR, g.z[0], g.x[1] + 1, FLOOR + 2, g.z[1], kit.stone);
  // Pilasters between the bays and a sill course binding them.
  for (let k = 1; k < bays.count; k++) {
    const z = g.z[0] + k * bays.width;
    b.add(g.x[0] - 1, FLOOR, z - 1, g.x[1] + 1, frieze.y[0], z + 1, kit.stone);
  }
  b.add(g.x[0] - 1, bays.sill - 4, g.z[0], g.x[1] + 1, bays.sill - 3, g.z[1], kit.band);
  // The checker frieze: two rows of square tiles in terracotta and cream, offset row on row.
  b.add(g.x[0] - 1, frieze.y[0], g.z[0], g.x[1] + 1, frieze.y[1], g.z[1], kit.band);
  for (let row = 0; row < (frieze.y[1] - frieze.y[0]) / frieze.tile; row++) {
    const y = frieze.y[0] + row * frieze.tile;
    for (let z = g.z[0] + (row % 2) * frieze.tile; z < g.z[1]; z += 2 * frieze.tile) b.add(g.x[0] - 1, y, z, g.x[1] + 1, y + frieze.tile, z + frieze.tile, kit.roof);
  }
  b.add(g.x[0] - 1, frieze.y[0] - 1, g.z[0], g.x[1] + 1, frieze.y[0], g.z[1], kit.stone);
  // The room: hollow behind the walls and the frieze.
  b.add(g.x[0] + g.wall, FLOOR, g.z[0], g.x[1] - g.wall, eaves, g.z[1], MAT.air);
  // One tall window per bay on both faces.
  for (let k = 0; k < bays.count; k++) {
    const zc = g.z[0] + k * bays.width + bays.width / 2;
    for (const face of [WEST, EAST]) windowOn(b, kit, `gallery-${k}-${sideOf(face)}`, face, zc, bays.window, bays.sill, bays.head, g.wall + 1, true);
  }
}

/**
 * The gallery roof, laid on a grid of tiles four rows high and eight cells along: a lozenge lattice of slate on
 * terracotta with a pale tile at each lozenge's heart. Each row steps in a cell, so the slope stays smooth while the
 * pattern stays coarse.
 */
function galleryRoof(b: Boxes, kit: LandmarkKit): void {
  const { gallery: g, galleryRoof: roof, eaves } = RIVER_HALL;
  const x0 = g.x[0] - 3, x1 = g.x[1] + 3;
  b.add(x0 + 1, eaves, g.z[0], x1 - 1, eaves + 1, g.z[1], kit.trim);
  b.add(x0, eaves + 1, g.z[0], x1, roof.base, g.z[1], kit.roof);
  const rows = roof.half, groups = Math.ceil(rows / 4), length = g.z[1] - g.z[0];
  const tile = (gr: number, c: number) => {
    const a = (((c + gr) % 4) + 4) % 4, d = (((c - gr) % 4) + 4) % 4;
    if (a === 0 || d === 0) return MAT.slate;
    return a === 2 && d === 2 ? kit.band : kit.roof;
  };
  for (let gr = 0; gr < groups; gr++) {
    const y = roof.base + 4 * gr, Y = Math.min(roof.base + rows, y + 4);
    let start = 0;
    for (let c = 1; c <= length / 8; c++) {
      if (c < length / 8 && tile(gr, c) === tile(gr, start)) continue;
      b.add(x0 + 4 * gr, y, g.z[0] + 8 * start, x1 - 4 * gr, Y, g.z[0] + 8 * c, tile(gr, start));
      start = c;
    }
    // Hollow under the slope, a shell at least three cells thick.
    if (x1 - 4 * gr - 3 - (x0 + 4 * gr + 3) > 6) b.add(x0 + 4 * gr + 6, y, g.z[0], x1 - 4 * gr - 6, Y, g.z[1], MAT.air);
  }
  for (let r = 0; r < rows; r++) {
    const j = r % 4;
    if (!j) continue;
    const gr = Math.floor(r / 4), y = roof.base + r;
    b.add(x0 + 4 * gr, y, g.z[0], x0 + r, y + 1, g.z[1], MAT.air);
    b.add(x1 - r, y, g.z[0], x1 - 4 * gr, y + 1, g.z[1], MAT.air);
  }
  // A cream ridge, and a small louvred lantern over the middle arch with its own pointed cap and vane.
  const ridge = roof.base + rows;
  b.add(CX - 2, ridge - 1, g.z[0], CX + 2, ridge + 1, g.z[1], kit.band);
  const zc = RIVER_HALL_AXIS.z;
  b.octagon(CX, zc, 7, 2, ridge - 4, ridge + 1, kit.trim);
  b.octagon(CX, zc, 6, 2, ridge + 1, ridge + 11, kit.wall);
  b.octagon(CX, zc, 4, 1, ridge + 1, ridge + 11, MAT.air);
  // Louvres: an opening through every side with three slats across it.
  for (const [x0, z0, x1, z1] of [[CX - 2, zc + 4, CX + 2, zc + 6], [CX - 2, zc - 6, CX + 2, zc - 4], [CX + 4, zc - 2, CX + 6, zc + 2], [CX - 6, zc - 2, CX - 4, zc + 2]] as const) {
    b.add(x0, ridge + 3, z0, x1, ridge + 10, z1, MAT.air);
    for (const y of [ridge + 4, ridge + 6, ridge + 8]) b.add(x0, y, z0, x1, y + 1, z1, kit.trim);
  }
  b.octagon(CX, zc, 7, 2, ridge + 11, ridge + 12, kit.trim);
  for (let k = 0; k < 7; k++) b.octagon(CX, zc, 6 - k, Math.max(0, 2 - Math.floor(k / 3)), ridge + 12 + k, ridge + 13 + k, kit.roof);
  b.add(CX - 1, ridge + 18, zc - 1, CX + 1, ridge + 22, zc + 1, kit.metal);
  b.add(CX, ridge + 22, zc - 4, CX + 1, ridge + 23, zc + 4, kit.iron);
  b.add(CX, ridge + 23, zc + 2, CX + 1, ridge + 25, zc + 4, kit.iron);
}

// ── The pavilions ────────────────────────────────────────────────────────────────────────────────────────────────

function pavilion(b: HallBoxes, kit: LandmarkKit, side: 'far' | 'near'): void {
  const { pavilions: p, gable, pavilionRoof } = RIVER_HALL;
  const [z0, z1] = p[side];
  b.add(p.x[0], FLOOR, z0, p.x[1], p.top, z1, kit.stone);
  b.add(p.x[0] + p.wall, FLOOR, z0 + p.wall, p.x[1] - p.wall, p.top - 4, z1 - p.wall, MAT.air);
  // A storey course and a cornice, and long-and-short quoins in the pale stone on all four corners.
  b.add(p.x[0] - 1, 88, z0 - 1, p.x[1] + 1, 90, z1 + 1, kit.band);
  b.add(p.x[0] - 1, p.top - 2, z0 - 1, p.x[1] + 1, p.top, z1 + 1, kit.band);
  for (let y = FLOOR + 2, k = 0; y + 4 <= p.top - 2; y += 8, k++) {
    if (y >= 86 && y < 90) continue;
    // One block per corner, alternately long and short on its two faces; its hidden inner corner is the wall's.
    const long = k % 2 ? 4 : 7, short = k % 2 ? 7 : 4;
    for (const [x, X] of [[p.x[0], p.x[0] + long], [p.x[1] - long, p.x[1]]] as const) {
      b.add(x, y, z0, X, y + 4, z0 + short, kit.band);
      b.add(x, y, z1 - short, X, y + 4, z1, kit.band);
    }
  }
  // Two windows a storey on each flank.
  for (const face of [{ axis: 'x', plane: p.x[0], out: -1 }, { axis: 'x', plane: p.x[1], out: 1 }] as const) {
    for (const zc of [z0 + 16, z1 - 16]) {
      windowOn(b, kit, `${side}-${sideOf(face)}-${zc}-lower`, face, zc, 6, 48, 62, p.wall + 1, false);
      windowOn(b, kit, `${side}-${sideOf(face)}-${zc}-upper`, face, zc, 6, 94, 106, p.wall + 1, false);
    }
  }
  // Its roof runs between the two gables, the gables' crow steps standing proud of it.
  const t = gable.thickness;
  for (let r = 0; r <= pavilionRoof.half; r++) b.add(p.x[0] - 2 + r, p.top + r, z0 + t, p.x[1] + 2 - r, p.top + r + 1, z1 - t, kit.roof);
  b.add(p.x[0] - 1, p.top - 1, z0 + t, p.x[1] + 1, p.top, z1 - t, kit.trim);
  for (const [g0, g1] of [[z0, z0 + t], [z1 - t, z1]] as const) {
    for (let i = 0; i < gable.steps; i++) {
      const x = p.x[0] + gable.run * i, X = p.x[1] - gable.run * i, y = p.top + gable.rise * i, Y = y + gable.rise;
      b.add(x, y, g0, X, Y, g1, kit.stone);
      // A pale coping on every step's tread, overhanging the gable a cell each way.
      const tread = i === gable.steps - 1 ? [[x - 1, X + 1]] : [[x - 1, x + gable.run], [X - gable.run, X + 1]];
      for (const [c0, c1] of tread) b.add(c0!, Y - 1, g0 - 1, c1!, Y, g1 + 1, kit.band);
    }
  }
  // A chimney on the roof's east slope with a cap.
  const cz = side === 'near' ? z0 + 12 : z1 - 12;
  b.add(74, 120, cz - 3, 80, 142, cz + 3, kit.stone);
  b.add(73, 142, cz - 4, 81, 144, cz + 4, kit.band);
  b.add(75, 141, cz - 2, 79, 144, cz + 2, MAT.air);
}

/** The gable apex, where the bell cote stands. */
const APEX = RIVER_HALL.pavilions.top + RIVER_HALL.gable.rise * RIVER_HALL.gable.steps;

function rose(b: HallBoxes, kit: LandmarkKit, id: string, face: Face): void {
  const { x, y, radius } = RIVER_HALL.rose;
  for (let yy = y - radius - 2; yy < y + radius + 2; yy++) {
    const dy = yy + 0.5 - y;
    const outer = Math.sqrt(Math.max(0, (radius + 1.5) ** 2 - dy * dy)), inner = Math.sqrt(Math.max(0, (radius - 0.5) ** 2 - dy * dy));
    if (outer > 0.5) slab(b, face, -1, 0, Math.round(x - outer), Math.round(x + outer), yy, yy + 1, kit.band);
    if (inner > 0.5) {
      slab(b, face, -1, 2, Math.round(x - inner), Math.round(x + inner), yy, yy + 1, MAT.air);
      slab(b, face, 2, 3, Math.round(x - inner), Math.round(x + inner), yy, yy + 1, MAT.glass);
      // The two rows behind the tracery's cross bar show no glass, so they carry no pane.
      if (yy < y - 1 || yy >= y + 1) b.pane(id, face, 2, Math.round(x - inner), Math.round(x + inner), yy, yy + 1);
    }
  }
  // Tracery: a cross of pale stone and a ring of four lights, so the rose reads as a square-cut flower.
  slab(b, face, 1, 3, x - 1, x + 1, y - radius, y + radius, kit.band);
  slab(b, face, 1, 3, x - radius, x + radius, y - 1, y + 1, kit.band);
  slab(b, face, 0, 3, x - 2, x + 2, y - 2, y + 2, kit.band);
  slab(b, face, 0, 1, x - 1, x + 1, y - 1, y + 1, kit.metal);
}

function frontFace(b: HallBoxes, kit: LandmarkKit, crest: RiverHallOptions['crest'], colours: RiverHallOptions['colours']): void {
  const { pavilions: p, door } = RIVER_HALL;
  const face: Face = { axis: 'z', plane: p.near[1], out: 1 };
  // A thicker front wall round the door, so the leaf sits deep in its reveal.
  b.add(door.opening.x[0] - 4, FLOOR, p.near[1] - 8, door.opening.x[1] + 4, 68, p.near[1], kit.stone);
  // The door case: a pale stepped ring two cells proud and its keystone, on a stone platform at the threshold.
  b.add(44, 0, 228, 68, FLOOR, 230, kit.stone);
  b.add(44, FLOOR - 1, 229, 68, FLOOR, 230, kit.band);
  b.add(door.opening.x[0] - 3, FLOOR, 228, door.opening.x[1] + 3, 62, 230, kit.band);
  for (const [y, x0, x1] of [[62, 48, 64], [63, 49, 63], [64, 50, 62], [65, 52, 60], [66, 54, 58]] as const) b.add(x0, y, 228, x1, y + 1, 230, kit.band);
  b.add(55, 64, 228, 57, 68, 231, kit.band);
  const { opening, leaf } = door;
  b.add(opening.x[0], opening.y[0], leaf.z[0], opening.x[1], opening.y[1], opening.z[1], MAT.air);
  for (const [y, x0, x1] of door.arch) b.add(x0, y, leaf.z[0], x1, y + 1, opening.z[1], MAT.air);
  b.add(leaf.x[0], leaf.y[0], leaf.z[0], leaf.x[1], opening.y[1], leaf.z[1], kit.trim);
  for (const [y, x0, x1] of door.arch) b.add(x0, y, leaf.z[0], x1, y + 1, leaf.z[1], kit.trim);
  for (const x of [53, 56, 59]) b.add(x, leaf.y[0], leaf.z[0], x + 1, 62, leaf.z[1], MAT.bark);
  // Strap hinges, studs in a square grid, and a bright ring.
  for (const y of [44, 55]) b.add(leaf.x[0], y, leaf.z[1], leaf.x[0] + 9, y + 1, leaf.z[1] + 1, kit.iron);
  for (const x of [52, 56, 60]) for (const y of [48, 51, 58]) b.add(x, y, leaf.z[1], x + 1, y + 1, leaf.z[1] + 1, kit.iron);
  b.add(57, 50, leaf.z[1], 58, 51, leaf.z[1] + 1, kit.metal);
  b.add(56, 49, leaf.z[1], 59, 50, leaf.z[1] + 1, kit.metal);
  // The sill: worn stone under the leaf and the reveal.
  b.add(opening.x[0], FLOOR - 1, leaf.z[0], opening.x[1], FLOOR, opening.z[1], kit.stone);
  // The steps down to the bank, each with a pale nosing.
  for (const [top, z0, z1, x0, x1] of door.steps) {
    b.add(x0, 0, z0, x1, top, z1, kit.stone);
    b.add(x0, top - 1, z1 - 1, x1, top, z1, kit.band);
  }
  // Low cheek walls either side of the flight, stepping down with it.
  for (const [x0, x1] of [[35, 37], [75, 77]] as const) {
    for (let k = 0; k < 7; k += 2) b.add(x0, RIVER_HALL.bank, 230 + 2 * k, x1, 44 - k, 234 + 2 * k, kit.base);
  }
  crestPanel(b, kit, crest, colours.field);
  // Three windows to the upper hall, and the rose in the gable.
  for (const xc of [42, 56, 70]) windowOn(b, kit, `near-front-${xc}-upper`, face, xc, 6, 94, 106, 9, false);
  rose(b, kit, 'near-rose', face);
  banners(b, kit, colours);
}

function backFace(b: HallBoxes, kit: LandmarkKit): void {
  const { pavilions: p } = RIVER_HALL;
  const face: Face = { axis: 'z', plane: p.far[0], out: -1 };
  for (const xc of [36, 76]) windowOn(b, kit, `far-back-${xc}-lower`, face, xc, 6, 48, 62, p.wall + 1, false);
  for (const xc of [42, 56, 70]) windowOn(b, kit, `far-back-${xc}-upper`, face, xc, 6, 94, 106, p.wall + 1, false);
  rose(b, kit, 'far-rose', face);
}

function crestPanel(b: Boxes, kit: LandmarkKit, crest: RiverHallOptions['crest'], field: number): void {
  const { x, y, face } = RIVER_HALL.crest;
  // A pale frame proud of the wall and a sill under it; the field flush in the face, border and charge proud.
  b.add(x - 2, y - 2, face + 1, x + CREST_WIDTH + 2, y + CREST_HEIGHT + 2, face + 2, kit.band);
  b.add(x - 1, y - 1, face + 1, x + CREST_WIDTH + 1, y + CREST_HEIGHT + 1, face + 2, MAT.air);
  b.add(x - 3, y - 3, face + 1, x + CREST_WIDTH + 3, y - 2, face + 3, kit.band);
  const material: Record<string, number> = { B: kit.metal, C: kit.charge };
  crestGrid(crest.shape, crest.charge).forEach((row, i) => {
    const yy = y + CREST_HEIGHT - 1 - i;
    for (let c = 0; c < row.length; c++) {
      const mark = row[c]!;
      if (mark === '.') continue;
      b.add(x + c, yy, face, x + c + 1, yy + 1, face + 1, field);
      if (mark !== 'F') b.add(x + c, yy, face + 1, x + c + 1, yy + 1, face + 2, material[mark]!);
    }
  });
}

/** Two long banners in the kingdom's colours hang from iron rods either side of the door, forked at the foot. */
function banners(b: Boxes, kit: LandmarkKit, colours: RiverHallOptions['colours']): void {
  const face = RIVER_HALL.pavilions.near[1], top = 104, foot = 70;
  for (const x0 of [24, 80]) {
    const x1 = x0 + 8;
    b.add(x0 - 1, top, face, x1 + 1, top + 1, face + 3, kit.iron);
    for (const x of [x0 - 1, x1]) b.add(x, top + 1, face, x + 1, top + 3, face + 1, kit.iron);
    b.add(x0, foot, face + 1, x1, top, face + 2, colours.field);
    b.add(x0 + 3, foot + 3, face + 1, x0 + 5, top, face + 2, colours.band);
    b.add(x0, top - 3, face + 1, x1, top - 2, face + 2, colours.band);
    // The fork: a notch rising three rows from the hem between two tails.
    for (let k = 0; k < 3; k++) b.add(x0 + 1 + k, foot + k, face + 1, x0 + 7 - k, foot + k + 1, face + 2, MAT.air);
  }
}

/** The bell cote on the town gable's apex: two piers, a stepped head, the bell on its headstock, the flagpole. */
function cote(b: Boxes, kit: LandmarkKit): void {
  const { cote: c, pole } = RIVER_HALL, top = c.y[1];
  b.add(c.x[0], APEX - 1, c.z[0], c.x[1], APEX + 1, c.z[1], kit.band);
  b.add(c.x[0], APEX + 1, c.z[0] + 1, c.x[0] + 3, top - 6, c.z[1] - 1, kit.stone);
  b.add(c.x[1] - 3, APEX + 1, c.z[0] + 1, c.x[1], top - 6, c.z[1] - 1, kit.stone);
  for (let k = 0; k < 3; k++) b.add(c.x[0] + k, top - 6 + k, c.z[0] + 1, c.x[1] - k, top - 5 + k, c.z[1] - 1, kit.stone);
  b.add(c.x[0] + 4, top - 6, c.z[0] + 1, c.x[1] - 4, top - 4, c.z[1] - 1, MAT.air);
  // The bell: lip, waist, shoulder and crown, hung from a timber headstock across the piers.
  const { bell } = c;
  b.add(c.x[0] + 3, top - 8, bell.z - 1, c.x[1] - 3, top - 7, bell.z + 1, kit.trim);
  b.add(bell.x - 1, top - 9, bell.z - 1, bell.x + 1, top - 8, bell.z + 1, kit.metal);
  b.add(bell.x - 1, bell.y + 2, bell.z - 1, bell.x + 1, top - 9, bell.z + 1, kit.metal);
  b.add(bell.x - 2, bell.y, bell.z - 2, bell.x + 2, bell.y + 2, bell.z + 2, kit.metal);
  b.add(bell.x - 1, bell.y - 1, bell.z - 1, bell.x + 1, bell.y, bell.z + 1, kit.iron);
  // A stepped cap, a bright ball and the flagpole.
  for (let k = 0; k < 4; k++) b.add(c.x[0] - 1 + 2 * k, top - 3 + k, c.z[0], c.x[1] + 1 - 2 * k, top - 2 + k, c.z[1], kit.roof);
  b.add(pole.x[0] - 1, top + 1, pole.z[0] - 1, pole.x[1] + 1, pole.y[0], pole.z[1] + 1, kit.metal);
  b.add(pole.x[0], pole.y[0], pole.z[0], pole.x[1], pole.y[1] - 1, pole.z[1], kit.trim);
  b.add(pole.x[0], pole.y[1] - 1, pole.z[0], pole.x[1], pole.y[1], pole.z[1], kit.metal);
}

// ── Lanterns ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A caged lantern whose 3 × 5 × 3 glass is centred on (gx, gz) from `gy`, hung from a bracket that reaches out of a
 * wall at `wall` along the normal (`nx`, `nz`). Returns the glass centre.
 */
function lantern(b: Boxes, kit: LandmarkKit, gx: number, gy: number, gz: number, nx: number, nz: number, wall: number): Vec3 {
  const g = RIVER_HALL.lanterns.glass;
  b.add(gx - 1, gy, gz - 1, gx + 2, gy + g, gz + 2, MAT.glass);
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) b.add(gx + dx, gy, gz + dz, gx + dx + 1, gy + g, gz + dz + 1, kit.iron);
  b.add(gx - 2, gy - 1, gz - 2, gx + 3, gy, gz + 3, kit.metal);
  b.add(gx - 2, gy + g, gz - 2, gx + 3, gy + g + 1, gz + 3, kit.metal);
  b.add(gx - 1, gy + g + 1, gz - 1, gx + 2, gy + g + 2, gz + 2, kit.metal);
  b.add(gx, gy + g + 2, gz, gx + 1, gy + g + 4, gz + 1, kit.iron);
  // The bracket: from the hanger back to the wall face, along the normal.
  const arm = gy + g + 4;
  if (nx) b.add(Math.min(gx, wall), arm, gz, Math.max(gx + 1, wall), arm + 1, gz + 1, kit.iron);
  else b.add(gx, arm, Math.min(gz, wall), gx + 1, arm + 1, Math.max(gz + 1, wall), kit.iron);
  return [gx + 0.5, gy + g / 2, gz + 0.5];
}

interface Lamp { readonly id: string; readonly at: Vec3 }
/** Every lantern on the hall: door, pilasters and arch crowns. Computed once and drawn by `lanterns`. */
/** The wheel turns where the far arch's downstream lantern would hang, so a wheel hall leaves that one out. */
function lamps(wheel: boolean): { readonly door: Lamp[]; readonly marquee: Lamp[]; readonly arches: Lamp[] } {
  const { gallery: g, bays, arches, lanterns: l } = RIVER_HALL;
  const out = { door: [] as Lamp[], marquee: [] as Lamp[], arches: [] as Lamp[] };
  for (const { id, x } of l.door) out.door.push({ id, at: [x, 50, 231] });
  for (let k = 1; k < bays.count; k++) {
    const z = g.z[0] + k * bays.width;
    out.marquee.push({ id: `pilaster-${k}-west`, at: [g.x[0] - 4, 62, z] }, { id: `pilaster-${k}-east`, at: [g.x[1] + 3, 62, z] });
  }
  for (const arch of arches) {
    const zc = (arch.z[0] + arch.z[1]) / 2, crown = WATER + arch.radius;
    out.arches.push({ id: `${arch.id}-west`, at: [RIVER_HALL.deck.x[0] - 4, crown - 9, zc] });
    if (!(wheel && arch.id === 'arch-far')) out.arches.push({ id: `${arch.id}-east`, at: [RIVER_HALL.deck.x[1] + 3, crown - 9, zc] });
  }
  return out;
}

function lanterns(b: Boxes, kit: LandmarkKit, wheel: boolean): void {
  const { door, marquee, arches } = lamps(wheel);
  for (const { at: [x, y, z] } of door) {
    lantern(b, kit, x, y, z, 0, 1, RIVER_HALL.pavilions.near[1]);
  }
  for (const { id, at: [x, y, z] } of marquee) lantern(b, kit, x, y, z, id.endsWith('west') ? -1 : 1, 0, id.endsWith('west') ? RIVER_HALL.gallery.x[0] - 1 : RIVER_HALL.gallery.x[1] + 1);
  // Under each arch crown the lantern hangs from the keystone, in front of the opening, over the water.
  for (const { id, at: [x, y, z] } of arches) lantern(b, kit, x, y, z, id.endsWith('west') ? -1 : 1, 0, id.endsWith('west') ? RIVER_HALL.deck.x[0] - 2 : RIVER_HALL.deck.x[1] + 2);
}

// ── The bank, and the mill trestle ───────────────────────────────────────────────────────────────────────────────

function bank(b: Boxes, kit: LandmarkKit): void {
  const { bench, bank } = RIVER_HALL;
  // A bench on the landing beside the steps, facing out over the bank.
  b.add(bench.x[0], bench.y[0], bench.z[0], bench.x[1], bench.y[1], bench.z[1], kit.trim);
  for (const x of [bench.x[0] + 1, bench.x[1] - 3]) b.add(x, bank, bench.z[0] + 1, x + 2, bench.y[0], bench.z[1] - 1, kit.stone);
  // Mooring rings let into the abutments' river faces, and a pair of bollards on the town landing.
  for (const z of [RIVER_HALL.deck.z[0], RIVER_HALL.deck.z[1] - 1]) {
    for (const x of [22, 88]) b.add(x, WATER + 4, z, x + 2, WATER + 6, z + 1, kit.iron);
  }
  for (const x of [26, 84]) {
    b.octagon(x + 1, 240, 2, 0, bank, bank + 7, kit.iron);
    b.octagon(x + 1, 240, 3, 1, bank + 7, bank + 8, kit.iron);
  }
}

function trestle(b: Boxes, kit: LandmarkKit): void {
  const { centre, posts } = RIVER_HALL.wheel, axle = centre[1] - 1;
  // Two timber posts on the bed either side of the wheel, saddled to take the axle, and tied back to the pier face.
  for (const [z0, z1] of posts) {
    b.add(centre[0] - 1, 0, z0, centre[0] + 1, axle, z1, kit.trim);
    b.add(centre[0] - 2, axle - 1, z0, centre[0] + 2, axle, z1, kit.iron);
    b.add(RIVER_HALL.deck.x[1], axle + 6, z0, centre[0] + 2, axle + 8, z1, kit.trim);
    b.add(centre[0] + 1, axle, z0, centre[0] + 2, axle + 6, z1, kit.trim);
  }
}

/**
 * The undershot wheel as its own part, turning about its axle on the trestle. Part cells: the wheel lies in the X–Y
 * plane centred on (radius, radius); the axle runs the part's length along Z. Two shrouded rims with eight spokes,
 * and sixteen paddles between them.
 */
function wheelPart(style: StyleKey, kit: LandmarkKit): VoxelBlueprint {
  const { radius: r, width, axle } = RIVER_HALL.wheel, b = new Boxes(), size = 2 * r;
  const w0 = width[0] - axle[0], w1 = width[1] - axle[0];
  const ring = (x: number, y: number) => {
    const dx = x + 0.5 - r, dy = y + 0.5 - r, d = Math.hypot(dx, dy);
    if (d >= r) return 0;
    if (d >= r - 2.2) return kit.trim;
    if (d < 3) return kit.iron;
    const a = Math.atan2(dy, dx) * 4 / Math.PI;
    // Within 0.75 of a cell of the spoke's centre line, so the diagonal spokes stay joined face to face.
    return Math.abs(a - Math.round(a)) * d * Math.PI / 4 < 0.75 ? kit.trim : 0;
  };
  for (let y = 0; y < size; y++) {
    let start = 0;
    for (let x = 1; x <= size; x++) {
      if (x < size && ring(x, y) === ring(start, y)) continue;
      const m = ring(start, y);
      if (m) for (const [z0, z1] of [[w0, w0 + 2], [w1 - 2, w1]] as const) b.add(start, y, z0, x, y + 1, z1, m);
      start = x;
    }
  }
  for (let k = 0; k < 16; k++) {
    const a = (k + 0.5) * Math.PI / 8;
    // Each paddle is a radial plate; where its line steps diagonally a corner cell keeps it joined face to face.
    let last: [number, number] | null = null;
    for (let d = r - 4.5; d < r - 0.5; d += 1) {
      const x = Math.floor(r + Math.cos(a) * d), y = Math.floor(r + Math.sin(a) * d);
      if (last && last[0] !== x && last[1] !== y) b.add(x, last[1], w0 + 2, x + 1, last[1] + 1, w1 - 2, kit.trim);
      b.add(x, y, w0 + 2, x + 1, y + 1, w1 - 2, kit.trim);
      last = [x, y];
    }
  }
  b.add(r - 1, r - 1, 0, r + 1, r + 1, axle[1] - axle[0], kit.iron);
  return {
    version: 1, id: `genesis-river-hall-wheel-${style}`, styleId: StyleIdSchema.parse(STYLES[style].id),
    kind: 'prop', lattice: 'build', size: [size, size, axle[1] - axle[0]], boxes: b.list, windows: [],
  };
}

// ── Metadata ─────────────────────────────────────────────────────────────────────────────────────────────────────

function metadata(blueprint: VoxelBlueprint, wheel: boolean): Omit<LandmarkPiece, 'blueprint' | 'parts'> {
  const { door, bench, pole, flag: banner, cote: c, deck, arches, bank, pavilions } = RIVER_HALL;
  const hoistAt: Vec3 = [(pole.x[0] + pole.x[1]) / 2, banner.offset[1], (pole.z[0] + pole.z[1]) / 2];
  const ground = 6, head = 20, outer = blueprint.size[2] + ground;
  const tops: number[] = [];
  for (let z = door.opening.z[0]; z < outer; z++) {
    const step = door.steps.find(([, z0, z1]) => z >= z0 && z < z1);
    tops.push(z < door.steps[0]![1] ? door.threshold : step ? step[0] : bank);
  }
  const approach: LandmarkWalk = { id: 'door-approach', axis: 'z', along: [door.opening.z[0], outer], across: [door.opening.x[0], door.opening.x[1]], tops };
  const { door: doorLamps, marquee, arches: archLamps } = lamps(wheel);
  const lanternAt = (at: Vec3): Vec3 => [at[0] + 0.5, at[1] + RIVER_HALL.lanterns.glass / 2, at[2] + 0.5];
  const emitters: LandmarkEmitter[] = [...doorLamps, ...marquee, ...archLamps].map(({ id, at }) => ({ id, kind: 'lantern' as const, position: lanternAt(at), reach: 40 }));
  const bell: Vec3 = [c.bell.x, c.bell.y + 4, c.bell.z];
  // Each waterway is a box wholly inside its arch barrel and the proud course of its ring: five cells in from the
  // springings, as high as the soffit allows. The arch lanterns hang just outside each mouth, low over the water.
  const waterways = arches.map(arch => {
    const zc = (arch.z[0] + arch.z[1]) / 2, half = arch.radius - 5, rise = Math.floor(Math.sqrt(arch.radius ** 2 - (half + 0.5) ** 2) - 0.5);
    return { id: arch.id, role: 'waterway' as const, box: { from: [deck.x[0] - 1, 0, zc - half], to: [deck.x[1] + 1, WATER + rise, zc + half] } as CellBox };
  });
  const { centre, radius, width } = RIVER_HALL.wheel;
  return {
    extent: extentOf(blueprint),
    footings: [
      { id: 'far-abutment', box: { from: [pavilions.x[0], 0, 0], to: [pavilions.x[1], bank, deck.z[0]] }, embed: bank },
      { id: 'near-abutment', box: { from: [pavilions.x[0], 0, deck.z[1]], to: [pavilions.x[1], bank, blueprint.size[2]] }, embed: bank },
      ...RIVER_HALL.piers.map(([z0, z1], i) => ({ id: `pier-${i + 1}`, box: { from: [deck.x[0] - RIVER_HALL.cutwater, 0, z0], to: [deck.x[1] + RIVER_HALL.cutwater, 1, z1] } as CellBox, embed: WATER })),
      ...(wheel ? RIVER_HALL.wheel.posts.map(([z0, z1], i) => ({ id: `trestle-${i + 1}`, box: { from: [centre[0] - 1, 0, z0], to: [centre[0] + 1, 1, z1] } as CellBox, embed: WATER })) : []),
    ],
    doorways: [{
      id: 'door', facing: 'south',
      opening: { from: [door.opening.x[0], door.opening.y[0], door.opening.z[0]], to: [door.opening.x[1], door.opening.y[1], door.opening.z[1]] },
      leaf: { from: [door.leaf.x[0], door.leaf.y[0], door.leaf.z[0]], to: [door.leaf.x[1], door.leaf.y[1], door.leaf.z[1]] },
      threshold: door.threshold, approach,
      clearance: { from: [door.opening.x[0], door.threshold, door.opening.z[0]], to: [door.opening.x[1], door.threshold + head, outer] },
      groundAt: bank, state: 'closed',
    }],
    walks: [approach],
    seats: [{ id: 'landing-bench', box: { from: [bench.x[0], bench.y[0], bench.z[0]], to: [bench.x[1], bench.y[1], bench.z[1]] }, facing: 'south' }],
    emitters,
    sounds: [
      { id: 'river', kind: 'river', position: [CX, WATER, RIVER_HALL_AXIS.z] },
      { id: 'bell', kind: 'bell', position: bell },
      { id: 'flag', kind: 'flag', position: [hoistAt[0] + FLAG_LENGTH / 2, hoistAt[1] + FLAG_HEIGHT / 2, hoistAt[2]] },
      ...(wheel ? [{ id: 'mill-wheel', kind: 'mill-wheel' as const, position: [...centre] as Vec3 }] : []),
    ],
    mounts: [
      { id: 'flag-hoist', position: hoistAt, axis: [0, 1, 0] },
      { id: 'bell-headstock', position: [c.bell.x, c.y[1] - 7.5, c.bell.z], axis: [1, 0, 0] },
      ...(wheel ? [{ id: 'mill-wheel', position: [...centre] as Vec3, axis: [0, 0, 1] as Vec3 }] : []),
    ],
    clear: [
      { id: 'doorway', role: 'doorway', box: { from: [door.opening.x[0], door.opening.y[0], door.opening.z[0]], to: [door.opening.x[1], door.opening.y[1], door.opening.z[1]] } },
      { id: 'door-approach', role: 'approach', box: { from: [door.opening.x[0], door.threshold, door.opening.z[1]], to: [door.opening.x[1], door.threshold + head, outer] } },
      ...waterways,
      { id: 'flag-swing', role: 'flag-swing', box: { from: [hoistAt[0] - FLAG_LENGTH - 2, hoistAt[1], hoistAt[2] - FLAG_LENGTH - 2], to: [hoistAt[0] + FLAG_LENGTH + 2, hoistAt[1] + FLAG_HEIGHT, hoistAt[2] + FLAG_LENGTH + 2] } },
      { id: 'bell-swing', role: 'bell-swing', box: { from: [c.x[0] + 3, c.bell.y - 1, c.z[0] + 1], to: [c.x[1] - 3, c.y[1] - 8, c.z[1] - 1] } },
      ...(wheel ? [{ id: 'wheel-sweep', role: 'wheel-sweep' as const, box: { from: [centre[0] - radius, centre[1] - radius, width[0]], to: [centre[0] + radius, centre[1] + radius, width[1]] } as CellBox }] : []),
    ],
    affordances: [
      { id: 'enter', kind: 'enter', uses: ['door', 'door-approach'], status: 'needs-host', requires: 'A host door action and the hall interior; the leaf stays closed in this piece.' },
      { id: 'sit', kind: 'sit', uses: ['landing-bench'], status: 'needs-host', requires: 'Host seat registration from the placed bench edge.' },
      { id: 'ring-bell', kind: 'ring-bell', uses: ['bell-headstock', 'bell-swing'], status: 'needs-host', requires: 'A host bell rung by a real civic moment, swinging the bell on its headstock; content never rings it.' },
    ],
    water: { level: WATER, bank, channel: { from: [deck.x[0], 0, deck.z[0]], to: [deck.x[1], WATER, deck.z[1]] } },
  };
}
