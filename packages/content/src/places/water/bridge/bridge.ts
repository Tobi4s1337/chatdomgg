import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { Boxes, CIVIC_KITS, CIVIC_SHIELD, shield, type CivicKit, type CivicStyle } from '../../../civic/kit';
import { MAT, STYLES } from '../../../materials';
import type { CellBox, ClearVolume, EmitterAnchor, Footing, SeatEdge, WalkStrip, WaterPiece } from '../place-piece';
import { hash, settle } from '../shore/shape';

/**
 * The millstream's humpback bridge: one semicircular stone arch whose springing sits exactly on the water, so the
 * arch and its reflection close into a full circle in the quiet pool. A coursed deck of setts climbs from both
 * banks at no more than one cell per column to a short flat crown, between sitting-height parapets whose oversailing
 * copings follow the hump. The kingdom's arms stand on a raised die in the parapet, its point resting on the
 * projecting keystone, on both faces. Newel piers at the four corners carry the bridge lamps; the host feeds their
 * glass to the shared people-light result, so they are warm only when real people are near.
 *
 * Frame, in build cells from the site origin: the span runs along X, the stream along Z. y = 0 is the pool bed
 * under the arch; `water` is the surface there and `bank` the bank top at both ends, each above the bed.
 */

const L = 144;
const D = 32;
const HEIGHT = 64;
/** The arch axis, a cell edge: the span is symmetric about x = C. */
const C = L / 2;
const R = 28;
const RING = 3;
/** Voussoirs around the half ring; the middle one is the keystone. Odd, so the keystone sits on the crown. */
const VOUSSOIRS = 21;
/** Deck top at the crown above the water: three ring cells, the keystone's lift and one course of setts. */
const CROWN_RISE = 33;
/** Half of the flat crown, then the easing over which the deck's slope grows from flat to 1:2. */
const FLAT = 4;
const EASE = 6;
const PARAPET = 4;
/** The masonry faces: the cells z 1..31; z 0 and 31 carry what projects (coping, keystone, arms, cutwaters). */
const NORTH_FACE = 1;
const WALK: readonly [number, number] = [4, 28];
const NEWEL = 4;
/** The crest die in the parapet: 14 cells wide, the shield inset one cell from either edge. */
const DIE_HALF = 7;
const SHIELD_W = CIVIC_SHIELD[0]!.length;
const SHIELD_H = CIVIC_SHIELD.length;
const HEADROOM = 16;

export const BRIDGE = {
  size: [L, HEIGHT, D],
  /** x of the arch axis; the clear span is x 44..100 (7 m) at the springing. */
  centre: C,
  span: [C - R, C + R],
  radius: R,
  ring: RING,
  /** Outer masonry faces (cell layers); everything at z 0 and 31 projects. */
  faces: [NORTH_FACE, D - 1 - NORTH_FACE],
  walk: WALK,
  crownRise: CROWN_RISE,
  parapet: PARAPET,
  newel: NEWEL,
  die: [C - DIE_HALF, C + DIE_HALF],
  headroom: HEADROOM,
  reach: 40,
} as const;

/** Per-site heights of the frame, all in cells above the bed. */
export interface BridgeFrame {
  readonly springing: number;
  /** Underside of the arch at the crown (the first ring cell); the opening reaches y = crownUnderside - 1. */
  readonly crownUnderside: number;
  readonly crownDeck: number;
  readonly parapetTop: number;
  /** The keystone's top, where the shield's point rests. */
  readonly keystoneTop: number;
  readonly dieTop: number;
  readonly newels: readonly { readonly id: string; readonly box: CellBox }[];
  readonly lanterns: readonly { readonly id: string; readonly glass: CellBox; readonly emitter: Vec3 }[];
}

function checkSite(water: number, bank: number): void {
  if (!Number.isInteger(water) || water < 2 || water > 32) throw new RangeError(`bridge: water must be a whole 2..32 cells, not ${water}.`);
  if (!Number.isInteger(bank) || bank < water + 1 || bank > 64) {
    throw new RangeError(`bridge: bank must be a whole ${water + 1}..64 cells above the bed, not ${bank}.`);
  }
}

/** Walking height (top of the sett) over column x: flat banks, a 1:2 climb easing into a short flat crown. */
export function humpbackDeckTop(x: number, water: number, bank: number): number {
  checkSite(water, bank);
  if (!Number.isInteger(x) || x < 0 || x >= L) throw new RangeError(`bridge: column ${x} is outside 0..${L - 1}.`);
  const u = Math.abs(x + 0.5 - C);
  const fall = u <= FLAT ? 0 : u <= FLAT + EASE ? (u - FLAT) ** 2 / (4 * EASE) : EASE / 4 + (u - FLAT - EASE) / 2;
  return Math.max(bank, water + CROWN_RISE - Math.round(fall));
}

export function bridgeFrame(water: number, bank: number): BridgeFrame {
  checkSite(water, bank);
  const crownDeck = water + CROWN_RISE;
  const keystoneTop = water + R + RING + 1;
  const newelTop = bank + 8;
  const ends = [['west', 0], ['east', L - NEWEL]] as const;
  const sides = [['north', 0], ['south', D - NEWEL]] as const;
  const newels = ends.flatMap(([end, x]) => sides.map(([side, z]) => ({
    id: `newel-${side}-${end}`, box: { from: [x, bank - 1, z] as Vec3, to: [x + NEWEL, newelTop, z + NEWEL] as Vec3 },
  })));
  const lanterns = newels.map(({ id, box }) => ({
    id: id.replace('newel', 'lantern'),
    glass: { from: [box.from[0], newelTop + 1, box.from[2]] as Vec3, to: [box.to[0], newelTop + 5, box.to[2]] as Vec3 },
    emitter: [box.from[0] + 2, newelTop + 3, box.from[2] + 2] as Vec3,
  }));
  return {
    springing: water, crownUnderside: water + R, crownDeck, parapetTop: crownDeck + PARAPET, keystoneTop,
    dieTop: keystoneTop + SHIELD_H + 3, newels, lanterns,
  };
}

/** How each kit dresses the bridge: what caps it, what runs along its deck line and how its worn track darkens. */
interface Dressing {
  readonly coping: number;
  readonly copingAlt: number;
  readonly string: number;
  readonly track: readonly number[];
  readonly tint: number;
}

const DRESSING: Readonly<Record<CivicStyle, Dressing>> = {
  // Warm limestone under pale cream copings, a muddy cart track and the odd cream block in the coursing.
  hearth: { coping: MAT.cream, copingAlt: MAT.limestone, string: MAT.limestone, track: [MAT.earth, MAT.earth, MAT.darkStone, MAT.bark], tint: MAT.cream },
  // Grey stone under dark copings and string course, a slate-dark track and a few darker blocks.
  tide: { coping: MAT.darkStone, copingAlt: MAT.stone, string: MAT.darkStone, track: [MAT.darkStone], tint: MAT.darkStone },
};

export function createHumpbackBridge(style: CivicStyle, water: number, bank: number): WaterPiece {
  if (!Object.hasOwn(CIVIC_KITS, style)) throw new RangeError(`bridge: civic style must be hearth or tide, not ${String(style)}.`);
  checkSite(water, bank);
  const kit = CIVIC_KITS[style], dress = DRESSING[style], frame = bridgeFrame(water, bank), b = new Boxes();
  const deck = Array.from({ length: L }, (_, x) => humpbackDeckTop(x, water, bank));
  const { crownDeck, keystoneTop } = frame;

  const radius = (x: number, y: number) => Math.hypot(x + 0.5 - C, y + 0.5 - water);
  const span = (x: number) => x >= C - R && x < C + R;
  const open = (x: number, y: number) => span(x) && (y < water || radius(x, y) < R);
  const inDie = (x: number) => x >= C - DIE_HALF && x < C + DIE_HALF;
  const inNewel = (x: number) => x < NEWEL || x >= L - NEWEL;

  // ── Parapet line, per side: deck + 4, set one course lower over a few seat stones and shouldering up to the die.
  const seatsAt = seatWindows(deck);
  const top = Array.from({ length: L }, (_, x) => {
    const seat = seatsAt.find(([s]) => x >= s && x < s + 4);
    if (seat) return Math.min(deck[seat[0]]!, deck[seat[0] + 3]!) + PARAPET;
    const u = Math.abs(x + 0.5 - C);
    return deck[x]! + PARAPET + (u > DIE_HALF && u < DIE_HALF + 2 ? 1 : 0);
  });
  // One coping stone on the south parapet has been knocked outward: its inner lip is gone.
  const displaced = seatsAt.length ? findRun(deck, C - 40) : undefined;

  // ── The body: solid masonry from the bed to the setts across the faces, in runs of equal deck height.
  runsOf(L, x => `${deck[x]}`, (x0, x1) => b.add(x0, 0, NORTH_FACE, x1, deck[x0]!, D - NORTH_FACE, kit.stone));

  // ── Parapets, string course and coping, mirrored across the deck.
  for (const south of [false, true]) {
    const Z = (z0: number, z1: number): [number, number] => (south ? [D - z1, D - z0] : [z0, z1]);
    runsOf(L, x => (inNewel(x) || inDie(x) ? 'skip' : `${deck[x]},${top[x]},${hash(17, Math.floor(x / 2), south ? 1 : 0) < 0.22}`), (x0, x1) => {
      if (inNewel(x0) || inDie(x0)) return;
      const d = deck[x0]!, t = top[x0]!;
      const [wz0, wz1] = Z(1, 3), [cz0, cz1] = Z(0, 4), [sz0, sz1] = Z(0, 1);
      b.add(x0, d, wz0, x1, t - 1, wz1, kit.stone);
      const alt = hash(17, Math.floor(x0 / 2), south ? 1 : 0) < 0.22;
      b.add(x0, t - 1, cz0, x1, t, cz1, alt ? dress.copingAlt : dress.coping);
      b.add(x0, d - 1, sz0, x1, d, sz1, dress.string);
    });
    if (south && displaced) {
      const [x0, x1] = displaced, [iz0, iz1] = Z(3, 4);
      b.add(x0, top[x0]! - 1, iz0, x1, top[x0]!, iz1, MAT.air);
      // The stone's outer half has dropped a cell into the wall's joint, so it reads as shifted, not cut.
      const [oz0, oz1] = Z(0, 1);
      b.add(x0, top[x0]! - 2, oz0, x1, top[x0]! - 1, oz1, dress.coping);
    }
    // Vertical joints in the parapet stones, outside and in, never at the same column.
    for (let x = NEWEL + 3; x < L - NEWEL - 2; x += 5 + Math.floor(hash(23, x, south ? 1 : 0) * 4)) {
      if (inDie(x) || inDie(x + 1) || seatsAt.some(([s]) => x >= s - 1 && x < s + 5)) continue;
      const [oz0, oz1] = Z(1, 2), [iz0, iz1] = Z(2, 3);
      b.add(x, deck[x]!, oz0, x + 1, top[x]! - 1, oz1, MAT.air);
      const xi = x + 2;
      if (!inDie(xi) && xi < L - NEWEL) b.add(xi, deck[xi]!, iz0, xi + 1, top[xi]! - 1, iz1, MAT.air);
    }
  }

  // ── The crest die: a raised panel in both parapets over the keystone, under a stepped cap.
  const dieTop = frame.dieTop;
  for (const south of [false, true]) {
    const Z = (z0: number, z1: number): [number, number] => (south ? [D - z1, D - z0] : [z0, z1]);
    const [wz0, wz1] = Z(1, 4), [cz0, cz1] = Z(0, 4), [kz0, kz1] = Z(1, 3), [sz0, sz1] = Z(0, 1);
    b.add(C - DIE_HALF, crownDeck, wz0, C + DIE_HALF, dieTop - 3, wz1, kit.stone);
    b.add(C - DIE_HALF, crownDeck - 1, sz0, C + DIE_HALF, crownDeck, sz1, dress.string);
    b.add(C - DIE_HALF - 1, dieTop - 3, cz0, C + DIE_HALF + 1, dieTop - 2, cz1, dress.coping);
    b.add(C - 5, dieTop - 2, kz0, C + 5, dieTop - 1, kz1, kit.stone);
    b.add(C - 2, dieTop - 1, kz0, C + 2, dieTop, kz1, dress.coping);
    // The inner face carries a sunk panel, so the die reads as dressed stone from the deck too.
    const [pz0, pz1] = Z(3, 4);
    b.add(C - DIE_HALF + 2, crownDeck + 2, pz0, C + DIE_HALF - 2, dieTop - 5, pz1, MAT.air);
  }

  // ── Newel piers at the four corners, coursed, with an oversailing cap on the deck side.
  for (const n of frame.newels) {
    const [x0, , z0] = n.box.from, [x1, y1, z1] = n.box.to, west = x0 === 0, north = z0 === 0;
    b.add(x0, bank - 1, z0, x1, y1 - 2, z1, kit.stone);
    const ox = west ? [x0, x0 + 1] : [x1 - 1, x1], oz = north ? [z0, z0 + 1] : [z1 - 1, z1];
    // A shadow joint around the two outer faces, and a cap one cell proud towards the deck.
    b.add(ox[0]!, bank + 2, z0, ox[1]!, bank + 3, z1, MAT.air);
    b.add(x0, bank + 2, oz[0]!, x1, bank + 3, oz[1]!, MAT.air);
    b.add(west ? x0 : x0 - 1, y1 - 2, z0, west ? x1 + 1 : x1, y1 - 1, z1, dress.coping);
    b.add(x0, y1 - 1, z0, x1, y1, z1, kit.stone);
  }

  // ── Coursed faces: recessed bed joints and staggered vertical joints on both outer faces, with the odd tinted
  // block. They keep off the ring, which carries its own joints.
  const masonry = (x: number, y: number) => {
    const u = Math.abs(x + 0.5 - C);
    return y < deck[x]! - 1 && !open(x, y) && radius(x, y) >= R + RING + 1 && !(u < R + 8 && y < water + 4);
  };
  for (const south of [false, true]) {
    const z = south ? D - 1 - NORTH_FACE : NORTH_FACE, seed = south ? 2 : 1;
    let y0 = 2;
    for (let course = 0; y0 < crownDeck; course++) {
      const height = 4 + (hash(31, course, seed) < 0.35 ? 1 : 0) - (hash(37, course, seed) < 0.2 ? 1 : 0);
      const y1 = y0 + height;
      // The bed joint under the course.
      runsOf(L, x => (masonry(x, y0) ? 'm' : ''), (x0, x1) => { if (masonry(x0, y0)) b.add(x0, y0, z, x1, y0 + 1, z + 1, MAT.air); });
      // Head joints: block lengths 6..10, so courses never stack their joints.
      for (let x = 2 + Math.floor(hash(41, course, seed) * 6); x < L - 2; x += 6 + Math.floor(hash(43, x, course, seed) * 5)) {
        runsOf(y1 - y0 - 1, i => (masonry(x, y0 + 1 + i) ? 'm' : ''), (i0, i1) => {
          if (masonry(x, y0 + 1 + i0)) b.add(x, y0 + 1 + i0, z, x + 1, y0 + 1 + i1, z + 1, MAT.air);
        });
        if (hash(47, x, course, seed) < 0.1 && masonry(x + 1, y0 + 1) && masonry(x + 4, y1 - 1)) {
          b.add(x + 1, y0 + 1, z, x + 5, y1, z + 1, dress.tint);
        }
      }
      y0 = y1;
    }
  }

  // ── The arch: carve the opening (the stream to the bed, then the half disc), then dress the ring's faces.
  b.add(C - R, 0, 0, C + R, water, D, MAT.air);
  runsOf(R, i => intradosRow(i).join(','), (i0, i1) => {
    const [a, c] = intradosRow(i0);
    b.add(a, water + i0, 0, c, water + i1, D, MAT.air);
  });
  const voussoir = (x: number, y: number) => Math.min(VOUSSOIRS - 1, Math.floor(Math.atan2(y + 0.5 - water, x + 0.5 - C) / (Math.PI / VOUSSOIRS)));
  for (let x = C - R - RING; x < C + R + RING; x++) {
    // Each column of the ring, split where it crosses from one voussoir to the next.
    const ring: number[] = [];
    for (let y = water; y < water + R + RING; y++) { const r = radius(x, y); if (r >= R && r < R + RING) ring.push(y); }
    if (!ring.length) continue;
    const yBottom = ring[0]!, yTop = ring[ring.length - 1]! + 1;
    for (const south of [false, true]) {
      const [z0, z1] = south ? [D - 1 - NORTH_FACE - 1, D - NORTH_FACE] : [NORTH_FACE, NORTH_FACE + 2];
      runsOf(yTop - yBottom, i => `${voussoir(x, yBottom + i)}`, (i0, i1) => {
        const k = voussoir(x, yBottom + i0);
        if (k % 2 === 0) b.add(x, yBottom + i0, z0, x + 1, yBottom + i1, z1, kit.band);
      });
      // The extrados joint: a recessed line just outside the ring on the face, so the circle reads clean.
      const zf = south ? D - 1 - NORTH_FACE : NORTH_FACE;
      runsOf(R + RING + 2, i => { const y = water + i, r = radius(x, y); return r >= R + RING && r < R + RING + 1 && y < deck[x]! - 1 ? 'j' : ''; }, (i0, i1) => {
        const r = radius(x, water + i0);
        if (r >= R + RING && r < R + RING + 1 && water + i0 < deck[x]! - 1) b.add(x, water + i0, zf, x + 1, water + i1, zf + 1, MAT.air);
      });
    }
  }
  // The keystone: the crown voussoir in the band stone, standing proud of both faces and one course above the ring.
  for (const [y, half] of [[water + R, 2], [water + R + 2, 3]] as const) {
    b.add(C - half, y, 0, C + half, Math.min(y + 2, keystoneTop), D, kit.band);
  }
  b.add(C - 3, keystoneTop - 1, NORTH_FACE + 1, C + 3, keystoneTop, D - NORTH_FACE - 1, kit.stone);

  // ── The arms on both outer faces, point down on the keystone, field flush and charge proud.
  const sx = C - SHIELD_W / 2;
  shield(b, kit, CIVIC_SHIELD, sx, keystoneTop, NORTH_FACE, 0);
  shield(b, kit, CIVIC_SHIELD, sx, keystoneTop, D - 1 - NORTH_FACE, D - 1);

  // ── Cutwaters at the springing on both faces: proud piers to just above the water under stepped weatherings.
  for (const south of [false, true]) {
    const z = south ? D - 1 : 0;
    for (const west of [true, false]) {
      const X = (x0: number, x1: number): [number, number] => (west ? [C - x1, C - x0] : [C + x0, C + x1]);
      const [a, c] = X(R, R + 7), [a1, c1] = X(R + 1, R + 6), [a2, c2] = X(R + 2, R + 5);
      b.add(a, 0, z, c, water + 2, z + 1, kit.base);
      b.add(a1, water + 2, z, c1, water + 3, z + 1, kit.base);
      b.add(a2, water + 3, z, c2, water + 4, z + 1, kit.base);
      b.add(a, water - 1, z, c, water + 1, z + 1, MAT.darkStone);
      // Moss on the cutwater's weathering, more on the shaded north face.
      if (!south || !west) b.add(a1, water + 2, z, a1 + 2 + (south ? 0 : 2), water + 3, z + 1, MAT.moss);
    }
  }

  // ── Water at the stone: a dark wet band at the waterline on the springing and channel faces, then moss.
  const wet = (x0: number, x1: number, z0: number, z1: number) => b.add(x0, Math.max(0, water - 2), z0, x1, water + 1, z1, MAT.darkStone);
  wet(C - R - 1, C - R, NORTH_FACE, D - NORTH_FACE);
  wet(C + R, C + R + 1, NORTH_FACE, D - NORTH_FACE);
  for (const zf of [NORTH_FACE, D - 1 - NORTH_FACE]) { wet(C - R - 8, C - R, zf, zf + 1); wet(C + R, C + R + 8, zf, zf + 1); }
  soffitMoss(b, water, open);
  for (const [x0, x1, zf, n] of [[C - R - 8, C - R - 3, NORTH_FACE, 0], [C + R + 2, C + R + 6, NORTH_FACE, 1], [C + R + 1, C + R + 4, D - 1 - NORTH_FACE, 2]] as const) {
    b.add(x0, water + 1, zf, x1, water + 2 + (n % 2), zf + 1, MAT.moss);
  }

  // ── The deck: setts laid in two-cell rows across the walk, with a darker worn track down the middle.
  layDeck(b, deck, dress, kit);

  // ── The bridge lamps: a brass plate, glass between four brass posts, a brass cap and hat.
  for (const n of frame.newels) {
    const [x0, , z0] = n.box.from, y = n.box.to[1];
    b.add(x0, y, z0, x0 + 4, y + 1, z0 + 4, MAT.brass);
    b.add(x0, y + 1, z0, x0 + 4, y + 5, z0 + 4, MAT.glass);
    for (const [cx, cz] of [[0, 0], [3, 0], [0, 3], [3, 3]] as const) b.add(x0 + cx, y + 1, z0 + cz, x0 + cx + 1, y + 5, z0 + cz + 1, MAT.brass);
    b.add(x0, y + 5, z0, x0 + 4, y + 6, z0 + 4, MAT.brass);
    b.add(x0 + 1, y + 6, z0 + 1, x0 + 3, y + 7, z0 + 3, MAT.brass);
  }

  const blueprint: VoxelBlueprint = {
    version: 1, id: `water-${style}-bridge-${water}-${bank}`, styleId: STYLES[style].id, kind: 'civic', lattice: 'build',
    size: [L, Math.max(HEIGHT, ...b.list.map(box => box.to[1])), D], boxes: settle(b.list), windows: [],
  };
  return { blueprint, ...metadata(deck, top, displaced, water, frame) };
}

/** Calls `emit(from, to)` for every maximal run of indices in [0, length) with an equal non-empty key. */
function runsOf(length: number, key: (i: number) => string, emit: (from: number, to: number) => void): void {
  let start = 0, current = length ? key(0) : '';
  for (let i = 1; i <= length; i++) {
    const next = i < length ? key(i) : '\u0000';
    if (next === current) continue;
    if (current !== '') emit(start, i);
    start = i; current = next;
  }
}

/**
 * Four-column windows on each ramp where the deck rises by one cell halfway along: the coping there is laid flat at
 * sitting height, three to four cells above the setts, so a person can sit on it facing the deck.
 */
function seatWindows(deck: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const target of [C - 22, C - 36]) {
    for (let d = 0; d < 12; d++) {
      const x = target - d;
      if (x < NEWEL + 2) break;
      if (deck[x] === deck[x + 1] && deck[x + 2] === deck[x + 3] && deck[x + 2] === deck[x]! + 1) {
        out.push([x, x + 4], [L - x - 4, L - x]);
        break;
      }
    }
  }
  return out;
}

/** A two-column tread on the west ramp near `x` (its deck flat across both), for the displaced coping stone. */
function findRun(deck: readonly number[], x: number): [number, number] | undefined {
  for (let d = 0; d < 10; d++) {
    const a = x - d;
    if (a > NEWEL && deck[a] === deck[a + 1] && deck[a - 1] !== deck[a] && deck[a + 2] !== deck[a]) return [a, a + 2];
  }
  return undefined;
}

function soffitMoss(b: Boxes, water: number, open: (x: number, y: number) => boolean): void {
  // Every solid cell that faces the opening; moss gathers low on the haunches and deep in the barrel's shade.
  for (let x = C - R - 1; x <= C + R; x++) {
    for (let y = Math.max(0, water - 1); y < water + R + 1; y++) {
      if (open(x, y)) continue;
      if (!(open(x - 1, y) || open(x + 1, y) || open(x, y - 1))) continue;
      const height = y - water;
      for (let band = 0; band < 6; band++) {
        const z0 = 1 + band * 5, z1 = Math.min(D - 1, z0 + 3 + Math.floor(hash(53, x, y, band) * 3));
        const deep = band >= 1 && band <= 4;
        const chance = height < 3 ? 0.55 : height < 9 ? 0.3 : deep ? 0.12 : 0;
        if (hash(59, x, y, band) < chance) b.add(x, y, z0, x + 1, y + 1, z1, MAT.moss);
      }
    }
  }
}

function layDeck(b: Boxes, deck: readonly number[], dress: Dressing, kit: CivicKit): void {
  for (let x0 = 0; x0 < L;) {
    let x1 = x0 + 1;
    while (x1 < L && x1 - x0 < 2 && deck[x1] === deck[x0]) x1++;
    const y = deck[x0]! - 1, row = Math.floor(x0 / 2);
    for (let z = 3 + (row % 2 ? 2 : 0); z < D - 3;) {
      const length = 2 + Math.floor(hash(61, x0, z) * 3), z1 = Math.min(D - 3, z + length);
      const middle = (z + z1) / 2, off = Math.abs(middle - D / 2);
      const p = hash(67, x0, z);
      const dark = off < 3 ? p < 0.78 : off < 5.5 ? p < 0.35 : false;
      const material = dark ? dress.track[Math.floor(hash(71, x0, z) * dress.track.length)]! : p > 0.88 ? kit.band : undefined;
      if (material !== undefined) b.add(x0, y, z, x1, y + 1, z1, material);
      z = z1;
    }
    x0 = x1;
  }
}

function metadata(deck: readonly number[], top: readonly number[], displaced: [number, number] | undefined,
  water: number, frame: BridgeFrame): Omit<WaterPiece, 'blueprint'> {
  const walks: WalkStrip[] = [{ id: 'deck', axis: 'x', along: [0, L], across: WALK, tops: [...deck] }];
  // Flat runs of coping at sitting height, between the newels and the die; the displaced stone is no seat.
  const seats: SeatEdge[] = [];
  for (const south of [false, true]) {
    for (const west of [true, false]) {
      const range = west ? [NEWEL, C - DIE_HALF - 2] : [C + DIE_HALF + 2, L - NEWEL];
      runsOf(range[1]! - range[0]!, i => {
        const x = range[0]! + i, rise = top[x]! - deck[x]!;
        const bad = south && displaced && x >= displaced[0] && x < displaced[1];
        return rise >= 3 && rise <= 5 && !bad ? `${top[x]}` : '';
      }, (i0, i1) => {
        if (i1 - i0 < 4) return;
        const x0 = range[0]! + i0, x1 = range[0]! + i1, t = top[x0]!;
        const [z0, z1] = south ? [D - 4, D] : [0, 4];
        seats.push({ id: `coping-${south ? 'south' : 'north'}-${x0}`, facing: south ? 'north' : 'south', box: { from: [x0, t - 1, z0], to: [x1, t, z1] } });
      });
    }
  }
  const emitters: EmitterAnchor[] = frame.lanterns.map(l => ({ id: l.id, position: l.emitter, reach: BRIDGE.reach }));
  const clear: ClearVolume[] = [{ id: 'arch-water', role: 'arch-opening', box: { from: [C - R, 0, 0], to: [C + R, water, D] } }];
  runsOf(R, i => intradosRow(i).join(','), (i0, i1) => {
    const [a, c] = intradosRow(i0);
    clear.push({ id: `arch-opening-${i0}`, role: 'arch-opening', box: { from: [a, water + i0, 0], to: [c, water + i1, D] } });
  });
  runsOf(L, x => `${deck[x]}`, (x0, x1) => {
    clear.push({ id: `headroom-${x0}`, role: 'headroom', box: { from: [x0, deck[x0]!, WALK[0]], to: [x1, deck[x0]! + HEADROOM, WALK[1]] } });
  });
  const footings: Footing[] = [
    { id: 'abutment-west', box: { from: [0, 0, 0], to: [C - R, 1, D] } },
    { id: 'abutment-east', box: { from: [C + R, 0, 0], to: [L, 1, D] } },
  ];
  return {
    footings, walks, seats, emitters, texts: [], mounts: [], clear,
    sounds: [{ id: 'arch', kind: 'arch', position: [C, water + 1, D / 2] }],
  };
}

/** The opening's half-open x extent on the row `i` cells above the springing: cell centres inside the intrados. */
export function intradosRow(i: number): [number, number] {
  const dy = i + 0.5;
  if (dy >= R) return [C, C];
  const half = Math.sqrt(R * R - dy * dy);
  // Cell x is open when |x + 0.5 - C| < half.
  return [Math.floor(C - half - 0.5) + 1, Math.ceil(C + half - 0.5)];
}
