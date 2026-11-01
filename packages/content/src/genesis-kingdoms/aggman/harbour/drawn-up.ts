import { MAT } from '../../../materials';
import type { AggmanPiece, Livery } from '../piece';
import { layCreel, setPut, IRON, ROPE } from './gear';
import { Grid, noise, round, type P3 } from './grid';
import { TAR, hullShape, layHull, type HullForm } from './hull';

/**
 * A 3.75 m clinker rowing boat hauled up on the shingle above the tide: she rests on her keel amidships, heeled
 * over onto one bilge with a driftwood chock under it, her oars laid along the thwarts. Three paint jobs from the
 * livery, so a row of them never matches: 0 is blue with a gold top strake, 1 red with a blue one, 2 gold with a
 * red one; all three are tarred below a cream band, and their oar blades are tipped in the top strake's colour.
 *
 * - 0: heeled to port; her painter coiled on the bow thwart runs out over the stem to a stake in the shingle.
 * - 1: heeled to starboard; a copper bailer and a red cushion aboard, a grapnel lying ahead on its rope.
 * - 2: heeled to port; a basket of fish under the bow thwart and a lobster pot set down on the shingle beside her.
 *
 * Frame: bow at +Z, the keel along x = 9 (x = 15 for variant 2, which keeps room for the pot), y = 0 the shingle.
 */
export type DrawnUpVariant = 0 | 1 | 2;

const L = 30, B = 11, MID = 5;
const FLOOR = 2, THWART_ROW = 4;
const THWARTS = [[3, 5], [13, 15], [21, 23]] as const;

export const SKIFF_FORM: HullForm = {
  length: L,
  beam: B,
  keel: z => (z < 6 ? round(2 * ((6 - z) / 6) ** 2) : z > 21 ? round(5 * ((z - 21) / 8) ** 2.2) : 0),
  sheer: z => (z <= 12 ? round(6 + 2 * ((12 - z) / 12) ** 1.6) : round(6 + 3.4 * ((z - 12) / 17) ** 1.6)) + (z === L - 1 ? 1 : 0),
  plan: z => (z <= 12 ? 1 - 0.36 * ((12 - z) / 12) ** 2 : 1 - ((z - 12) / (L - 1 - 12)) ** 2.4),
  section: [0, 2, 3, 4, 5],
  fineness: (row, z) => (z > 12 ? 1 + 0.3 * (4 - row) : 1),
  stern: y => (y < 5 ? 1 : 0),
};

/** Each variant: [strakes, top strake], heel in degrees (positive lowers the port, −X, side), keel column. */
function paint(livery: Livery, variant: DrawnUpVariant) {
  return ([
    { strakes: livery.blue, top: livery.gold, heel: 11, keelX: 9 },
    { strakes: livery.red, top: livery.blue, heel: -9, keelX: 9 },
    { strakes: livery.gold, top: livery.red, heel: 13, keelX: 15 },
  ] as const)[variant];
}

export function createDrawnUpBoat(livery: Livery, variant: DrawnUpVariant): AggmanPiece {
  if (variant !== 0 && variant !== 1 && variant !== 2) throw new RangeError(`drawn-up boat: variant must be 0, 1 or 2, not ${String(variant)}.`);
  const coat = paint(livery, variant), shape = hullShape(SKIFF_FORM);
  const src = new Grid(B, 12, L);
  const skin = (x: number, y: number, z: number): number => {
    if (y < 2) return TAR;
    if (y === 2) return livery.cream;
    if (shape.halfBreadth(y, z) === 0) return MAT.timber;
    if (y === SKIFF_FORM.sheer(z) - 1) return coat.top;
    if (y === 3 && (z < 6 || z > 21) && noise(variant, x, z, 11) < 0.35) return MAT.timber;
    return coat.strakes;
  };
  layHull(src, shape, { skin, plank: MAT.timber, floorboard: MAT.bark, floor: FLOOR, thwartRow: THWART_ROW, thwarts: THWARTS }, 0, 0, 0);
  // The bow ring through the stem head.
  src.set(MID, SKIFF_FORM.sheer(L - 1) - 2, L - 1, livery.brass);
  oars(src, coat.top, variant);
  aboard(src, livery, variant);

  const width = variant === 2 ? 24 : 19, length = L + 9;
  const g = heel(src, coat.heel, coat.keelX, width, 13, length);
  chocks(g, coat.heel, coat.keelX);
  const bow = forward([MID + 0.5, SKIFF_FORM.sheer(L - 1) - 1.5, L - 0.5], coat.heel, coat.keelX);
  ashore(g, variant, coat.keelX, bow, livery);
  return { blueprint: g.blueprint(`genesis-aggman-drawn-up-boat-${variant}`), lanterns: [], footprint: g.groundFootprint() };
}

/**
 * Two oars laid fore-and-aft on the thwarts: a square loom, a dark worn grip and a flat blade two cells wide whose
 * tip carries the top strake's colour.
 */
function oars(g: Grid, tip: number, variant: DrawnUpVariant): void {
  const y = THWART_ROW + 1, z0 = 3, z1 = 21;
  const lay: readonly (readonly [number, 1 | -1, boolean])[] = variant === 1 ? [[3, 1, true], [7, -1, false]] : [[3, 1, true], [7, -1, true]];
  for (const [x, inboard, forward] of lay) {
    const [bx0, bx1] = inboard > 0 ? [x, x + 2] : [x - 1, x + 1];
    const [b0, b1] = forward ? [z1 - 5, z1] : [z0, z0 + 5];
    const grip = forward ? z0 : z1 - 1, tipZ = forward ? z1 - 1 : z0;
    g.free(x, y, grip, x + 1, y + 1, grip + 1, MAT.bark, 'oar');
    g.free(x, y, forward ? z0 + 1 : b1, x + 1, y + 1, forward ? b0 : z1 - 1, MAT.earth, 'oar');
    g.free(bx0, y, forward ? b0 : b0 + 1, bx1, y + 1, forward ? b1 - 1 : b1, MAT.earth, 'oar blade');
    g.free(bx0, y, tipZ, bx1, y + 1, tipZ + 1, tip, 'oar tip');
  }
}

/** The small things aboard, on the floorboards and thwarts. */
function aboard(g: Grid, livery: Livery, variant: DrawnUpVariant): void {
  const seat = THWART_ROW + 1, floor = FLOOR + 1;
  if (variant === 0) {
    const [z0] = THWARTS[2];
    for (const [x, z] of [[4, 0], [5, 0], [6, 0], [4, 1], [6, 1]] as const) g.free(x, seat, z0 + z, x + 1, seat + 1, z0 + z + 1, ROPE, 'painter coil');
    g.free(5, seat, z0 + 1, 6, seat + 1, z0 + 2, ROPE, 'painter coil');
    g.free(6, seat + 1, z0, 7, seat + 2, z0 + 2, ROPE, 'painter coil');
  } else if (variant === 1) {
    g.free(4, floor, 8, 6, floor + 1, 10, MAT.forgeCopper, 'bailer');
    g.free(4, floor + 1, 9, 6, floor + 2, 10, MAT.forgeCopper, 'bailer');
    const [z0, z1] = THWARTS[0];
    g.free(4, seat, z0, 6, seat + 1, z1, livery.red, 'cushion');
  } else {
    g.free(4, floor, 15, 7, floor + 1, 19, MAT.thatch, 'basket');
    for (const [x0, x1, z0, z1] of [[4, 7, 15, 16], [4, 7, 18, 19], [4, 5, 16, 18], [6, 7, 16, 18]] as const) g.free(x0, floor + 1, z0, x1, floor + 2, z1, MAT.thatch, 'basket');
    g.free(5, floor + 1, 16, 6, floor + 3, 18, MAT.stone, 'fish');
    g.free(5, floor + 3, 17, 6, floor + 4, 18, MAT.cream, 'fish tail');
  }
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** A source point (hull frame) to the heeled frame: rotated about the keel's underside, then set on keelX. */
function forward(p: P3, deg: number, keelX: number): P3 {
  const t = rad(deg), u = p[0] - (MID + 0.5), v = p[1];
  return [keelX + 0.5 + u * Math.cos(t) - v * Math.sin(t), u * Math.sin(t) + v * Math.cos(t), p[2]];
}

/**
 * Heels the upright boat about the underside of her keel. Every heeled cell takes the material its centre came
 * from; then each source cell, sampled at nine points, fills any cell that sampling left empty, so the thin skin
 * never opens a pinhole.
 */
function heel(src: Grid, deg: number, keelX: number, sx: number, sy: number, sz: number): Grid {
  const g = new Grid(sx, sy, sz), t = rad(deg), c = Math.cos(t), s = Math.sin(t);
  for (let z = 0; z < src.sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    const u = x + 0.5 - (keelX + 0.5), v = y + 0.5;
    const su = u * c + v * s, sv = -u * s + v * c;
    const m = src.get(Math.floor(MID + 0.5 + su), Math.floor(sv), z);
    if (m) g.set(x, y, z, m);
  }
  for (let z = 0; z < src.sz; z++) for (let y = 0; y < src.sy; y++) for (let x = 0; x < src.sx; x++) {
    const m = src.get(x, y, z);
    if (!m) continue;
    for (const du of [0.2, 0.5, 0.8]) for (const dv of [0.2, 0.5, 0.8]) {
      const [X, Y] = forward([x + du, y + dv, z], deg, keelX);
      const cx = Math.floor(X), cy = Math.floor(Y);
      if (cy >= 0 && g.inside(cx, cy, z)) g.fill(cx, cy, z, m);
    }
  }
  return g;
}

/** Driftwood chocks wedged under the low bilge at two stations, cut to the hull's own curve. */
function chocks(g: Grid, deg: number, keelX: number): void {
  const side = deg > 0 ? -1 : 1;
  for (const [z0, z1] of [[9, 12], [17, 20]] as const) for (let z = z0; z < z1; z++) for (let i = 1; i <= 6; i++) {
    const x = keelX + side * i;
    let lowest = -1;
    for (let y = 0; y < g.sy; y++) if (g.get(x, y, z)) { lowest = y; break; }
    if (lowest < 1 || lowest > 3) continue;
    for (let y = 0; y < lowest; y++) g.set(x, y, z, y === lowest - 1 ? MAT.timber : MAT.bark);
  }
}

/** What lies on the shingle round her. */
function ashore(g: Grid, variant: DrawnUpVariant, keelX: number, bow: P3, livery: Livery): void {
  const ahead = L + 5;
  if (variant === 0) {
    // A stake driven into the shingle, and the painter sagging to it from the bow ring.
    g.box(keelX, 0, ahead, keelX + 2, 5, ahead + 2, MAT.timber);
    g.box(keelX, 5, ahead, keelX + 2, 6, ahead + 2, MAT.bark);
    const mid: P3 = [(bow[0] + keelX + 1) / 2, 2.6, (bow[2] + ahead) / 2];
    g.stroke(bow, mid, ROPE, 0.75, true);
    g.stroke(mid, [keelX + 0.5, 4.5, ahead + 0.5], ROPE, 0.75, true);
  } else if (variant === 1) {
    // A grapnel lying on its side: the shank along the shingle, the crown and three flukes, the ring and the rope
    // led back to the bow.
    const x = keelX + 3, z0 = L + 3;
    g.box(x, 0, z0, x + 1, 1, z0 + 5, IRON);
    g.box(x - 1, 0, z0 + 4, x + 2, 1, z0 + 5, IRON);
    g.box(x - 2, 0, z0 + 5, x - 1, 1, z0 + 6, IRON);
    g.box(x + 2, 0, z0 + 5, x + 3, 1, z0 + 6, IRON);
    g.box(x, 1, z0 + 4, x + 1, 3, z0 + 5, IRON);
    g.box(x, 0, z0 - 1, x + 1, 2, z0, IRON);
    const sag: P3 = [(bow[0] + x + 0.5) / 2, 1.5, bow[2] + 1.5];
    g.stroke(bow, sag, ROPE, 0.75, true);
    g.stroke(sag, [x + 0.5, 0.5, z0 - 1.5], ROPE, 0.75, true);
  } else {
    // A lobster pot set down beside her, a buoy line coiled on it; pebbles kicked up round the keel.
    layCreel(setPut(g), 1, 0, 10, 'z', true);
    g.box(2, 4, 12, 4, 5, 15, ROPE);
    g.box(3, 4, 15, 4, 5, 16, livery.red);
  }
  for (let i = 0; i < 9; i++) {
    const z = 4 + Math.floor(noise(variant, i, 5) * (L - 8)), x = keelX + (noise(variant, i, 6) < 0.5 ? -2 : 2) + (i % 2 ? 1 : -1) * Math.floor(noise(variant, i, 7) * 3);
    g.fill(x, 0, z, noise(variant, i, 8) < 0.5 ? MAT.stone : MAT.limestone);
  }
}
