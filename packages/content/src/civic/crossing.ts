import { MAT } from '../materials';
import { Boxes, CIVIC_SHIELD, shield, type CivicKit } from './kit';

/**
 * Footbridge planes in build cells (README, "Footbridge"). The walk strip is z 5..27 along the whole length; the
 * landings are the flat runs x 0..4 and 60..64 with their top at y 1. Each tread is four cells long and one cell
 * higher than the last, up to an eight-cell crown at y 8 (x 28..36).
 */
export const FOOTBRIDGE = { size: [64, 24, 32], walk: [5, 27], landing: 4, crown: [28, 36], crownTop: 8, open: [14, 50] } as const;

/** Top of the walking surface over column x, in cells. */
export function footbridgeDeckTop(x: number): number {
  const d = x < 32 ? x : 63 - x;
  return d < 4 ? 1 : Math.min(8, 2 + Math.floor((d - 4) / 4));
}

/** Gateway passage: this whole box is air, so a 3 m wide, 4 m high way runs through along Z. */
export const GATEWAY = { size: [48, 64, 16], passage: { from: [12, 0, 0], to: [36, 32, 16] } } as const;

const W = 64;
/** The side beams and hand rails follow one smooth hump; the treads step under it. */
const stringerTop = (x: number) => Math.round(4 + 5 * (1 - ((x + 0.5 - 32) / 20) ** 2));

export function footbridge(kit: CivicKit): Boxes {
  const b = new Boxes();
  // Abutments, mirrored: a stone threshold, two stone treads and a bearing seat the timber span rests on.
  b.pair(W, 0, 0, 4, 4, 1, 28, kit.stone);
  b.pair(W, 4, 0, 4, 8, 2, 28, kit.stone);
  b.pair(W, 8, 0, 3, 12, 3, 29, kit.stone);
  b.pair(W, 12, 0, 1, 14, 2, 31, kit.base);
  // Low wing walls flank the approach between an end stone at the threshold and a tall pier at the span.
  for (const [z, Z, cz, CZ] of [[1, 4, 0, 4], [28, 31, 28, 32]] as const) {
    b.pair(W, 0, 0, cz, 10, 2, CZ, kit.base);
    b.pair(W, 3, 2, z, 10, 6, Z, kit.stone);
    b.pair(W, 3, 6, cz, 10, 7, CZ, kit.base);
  }
  for (const [z, Z] of [[0, 5], [27, 32]] as const) {
    const [oz, OZ] = z === 0 ? [0, 6] : [26, 32];
    b.pair(W, 0, 0, z, 3, 8, Z, kit.stone);
    b.pair(W, 0, 8, z, 3, 9, Z, kit.base);
    // The pier foot spreads below the treads only, never into the open span.
    b.pair(W, 9, 0, oz, 14, 2, OZ, kit.base);
    b.pair(W, 10, 2, z, 14, 16, Z, kit.stone);
    // Coursed: two shadow joints on the outer face, then a cap that oversails along the rail, never over the
    // walk, under a little tiled hat.
    for (const y of [6, 11]) b.pair(W, 10, y, z === 0 ? 0 : 31, 14, y + 1, z === 0 ? 1 : 32, MAT.air);
    b.pair(W, 9, 16, z, 15, 18, Z, kit.base);
    b.pair(W, 10, 18, z + 1, 14, 19, Z - 1, kit.roof);
    b.pair(W, 11, 19, z + 2, 13, 20, Z - 2, kit.roof);
  }
  // Arched side beams carry the span, sitting one cell proud of the planks as a kerb.
  for (let x = 12; x < 52; x++) {
    const top = stringerTop(x);
    b.add(x, Math.max(0, top - 4), 1, x + 1, top, 3, kit.trim);
    b.add(x, Math.max(0, top - 4), 29, x + 1, top, 31, kit.trim);
  }
  // Two-cell planks, laid across the walk and every third a darker board, so the tread rhythm reads.
  for (let x = 12; x < 52; x += 2) {
    const top = footbridgeDeckTop(x);
    b.add(x, top - 2, 3, x + 2, top, 29, (x / 2) % 3 === 1 ? MAT.bark : kit.trim);
  }
  // Paired hand rails: posts on the deck edge, a top rail on the hump and a lower rail or rope.
  const railTop = (x: number) => stringerTop(x) + 9;
  for (const z of [3, 27]) {
    for (let x = 13; x < 51; x++) b.add(x, railTop(x) - 2, z, x + 1, railTop(x), z + 2, kit.trim);
    for (const x of [22, 31, 40]) b.add(x, footbridgeDeckTop(x), z, x + 2, railTop(x) - 2, z + 2, kit.trim);
    lowerRail(b, kit, z, railTop);
  }
  // A little wear where the stone stays damp: moss in the shaded bearing seats and at the wing wall feet.
  b.pair(W, 13, 1, 1, 14, 2, 8, MAT.moss);
  b.pair(W, 4, 2, 0, 6, 3, 1, MAT.moss);
  b.pair(W, 5, 0, 31, 7, 1, 32, MAT.moss);
  return b;
}

/** Hearth runs a straight lower rail; Tide slings a rope that sags between each pair of supports. */
function lowerRail(b: Boxes, kit: CivicKit, z: number, railTop: (x: number) => number): void {
  const supports = [14, 22, 24, 31, 33, 40, 42, 50];
  for (let s = 0; s < supports.length; s += 2) {
    const [from, to] = [supports[s]!, supports[s + 1]!];
    let previous: number | undefined;
    for (let x = from; x < to; x++) {
      const sag = kit.cord === MAT.thatch ? Math.round(1.6 * Math.sin(Math.PI * (x + 0.5 - from) / (to - from))) : 0;
      const y = railTop(x) - 6 - sag;
      const low = Math.min(y, previous ?? y), high = Math.max(y, previous ?? y) + 1;
      b.add(x, low, z + (kit.cord === MAT.thatch ? 1 : 0), x + 1, high, z + 2, kit.cord);
      previous = y;
    }
  }
}

const GW = 48;
/** Arch soffit over column x: an ellipse springing at y 32 and cresting at y 40. */
const soffit = (x: number) => 32 + Math.round(8 * Math.sqrt(Math.max(0, 1 - ((x + 0.5 - 24) / 12) ** 2)));

export function ceremonialGateway(kit: CivicKit): Boxes {
  const b = new Boxes();
  // Two substantial feet, all outside the passage: a stepped plinth, a chamfered shaft that sets back once at a
  // weathering course, and an impost block that oversails it to receive the arch.
  b.pair(GW, 0, 0, 0, 12, 2, 16, kit.base);
  b.pair(GW, 1, 2, 1, 12, 3, 15, kit.base);
  b.pair(GW, 2, 3, 2, 12, 17, 14, kit.stone);
  b.pair(GW, 2, 17, 2, 12, 18, 14, kit.base);
  b.pair(GW, 3, 18, 3, 12, 32, 13, kit.stone);
  for (const [z, y, Y, x] of [[2, 3, 17, 2], [13, 3, 17, 2], [3, 18, 28, 3], [12, 18, 28, 3]] as const) {
    b.pair(GW, x, y, z, x + 1, Y, z + 1, MAT.air);
  }
  b.pair(GW, 1, 28, 1, 12, 31, 15, kit.stone);
  b.pair(GW, 1, 28, 1, 12, 29, 15, kit.base);
  b.pair(GW, 1, 3, 10, 2, 4, 15, MAT.moss);
  // The arch: one stone body, its passage carved out, then a proud ring of alternating voussoirs.
  b.add(2, 32, 2, 46, 48, 14, kit.stone);
  for (let x = 12; x < 36; x++) {
    const s = soffit(x);
    b.add(x, 32, 0, x + 1, s, 16, MAT.air);
    let start = s, material = voussoir(kit, x, s);
    for (let y = s + 1; y <= s + 4; y++) {
      const next = y < s + 4 ? voussoir(kit, x, y) : -1;
      if (next === material) continue;
      b.add(x, start, 1, x + 1, y, 15, material);
      start = y; material = next;
    }
  }
  // A beam on brackets carries a framed frieze and a steep little roof whose eaves shelter both faces.
  b.pair(GW, 0, 45, 4, 2, 48, 12, kit.trim);
  b.add(0, 48, 1, 48, 50, 15, kit.style === 'hearth' ? kit.trim : kit.stone);
  b.add(2, 50, 2, 46, 54, 14, kit.wall);
  for (const x of [2, 14, 32, 44]) b.add(x, 50, 1, x + 2, 54, 15, kit.trim);
  for (let i = 0; i < 8; i++) {
    b.add(0, 54 + i, i, 48, 55 + i, 16 - i, kit.roof);
    // Gable ends are rendered infill under two-cell tile verges.
    if (16 - 2 * i > 4) for (const x of [0, 47]) b.add(x, 54 + i, i + 2, x + 1, 55 + i, 14 - i, kit.wall);
  }
  b.add(0, 62, 6, 48, 64, 10, kit.trim);
  // The kingdom's shield is the keystone, inset on both faces and breaking the beam above it.
  shield(b, kit, CIVIC_SHIELD, 18, 40, 2, 1);
  shield(b, kit, CIVIC_SHIELD, 18, 40, 13, 14);
  return b;
}

/** Seven broad voussoirs by angle around the arch centre; neighbours alternate stone and the kit's band. */
function voussoir(kit: CivicKit, x: number, y: number): number {
  const angle = Math.atan2((y + 0.5 - 32) / 8, (x + 0.5 - 24) / 12);
  return Math.floor(angle / (Math.PI / 7)) % 2 ? kit.band : kit.stone;
}
