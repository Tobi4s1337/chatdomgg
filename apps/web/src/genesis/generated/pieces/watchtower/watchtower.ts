import type { Vec3 } from '@chatdom/shared';
import { MAT } from '@chatdom/content/materials';
import { Grid, SOFT, checkOptions, finish, hash, lanternPost, stream, variantTag, type PieceKit } from '../kit';
import type { GeneratedPiece, PieceColours, PieceOptions } from '../types';
import { contrast, emblem, type EmblemFigure } from '../emblem';

/**
 * The lookout on the rise at the edge of town, watching the road: one of three seeded forms, each its own silhouette.
 * - `round`: a round stone tower, either crenellated with a slim stair turret under a steep cone at the back and the
 *   beacon on the open roof, or carrying a timber hoarding all round under one broad cone, the beacon in its open bay;
 * - `square`: a square stone base carrying a half-timbered lookout room on a jettied gallery with knee braces, a railing
 *   and a bell-cast pyramid roof, the beacon on the gallery's front corner;
 * - `trestle`: a tall timber trestle on four splayed, girted and cross-braced legs on stone pads, a ladder up the side to
 *   a railed platform and a boarded lookout hut with a band of windows under a gable or pyramid roof.
 * Every form flies the kingdom's cloth twice (a hung banner with its roundel and a pennant on the apex pole), has a
 * door facing +Z, one or two lit windows or cross slits, and small life at its foot: a woodpile, a barrel, a lamp post
 * and a spear rack or a horn on a post. The seed picks the form, heights, roof pitch, sides and details.
 */
export type WatchtowerForm = 'round' | 'square' | 'trestle';
export type WatchtowerCrown = 'crenellated' | 'hoarding' | 'gallery' | 'hut';
export type WatchtowerRoof = 'cone' | 'pyramid' | 'gable';

export interface WatchtowerLayout {
  readonly form: WatchtowerForm;
  readonly crown: WatchtowerCrown;
  readonly roof: WatchtowerRoof;
  readonly size: Vec3;
  /** The tower's centre on the ground, in cells (x, z). */
  readonly centre: readonly [number, number];
  /** Cells of the rise the tower stands on: structure starts at this y. */
  readonly ground: number;
  /** Round: the shaft's outer radius; square: the base's half side; trestle: the legs' half spread at the foot. */
  readonly span: number;
  /** Round: the wall top; square: the stone base's top; trestle: the platform's underside. */
  readonly shaft: number;
  /** Round: the turret or hoarding height; square: the lookout room's height; trestle: the hut's height. */
  readonly upper: number;
  /** Square: the gallery's projection beyond the base; trestle: the legs' half spread at the top. */
  readonly reach: number;
  /** Roof rise per cell inward. */
  readonly pitch: number;
  /** The roof's apex (cells), below the pole and its pennant. */
  readonly apex: number;
  /** The side the hung banner and the pennant fly to: -1 west, +1 east (seen from the front). */
  readonly bannerSide: -1 | 1;
  /** The side the woodpile stands on; the lamp post and barrel take the other. */
  readonly woodSide: -1 | 1;
  readonly lit: 1 | 2;
  readonly foot: 'rack' | 'horn';
  readonly figure: EmblemFigure;
}

const TAU = Math.PI * 2;
/** Room above the apex for the finial, the pole and its pennant. */
const POLE = 12;
/** The tallest a roof apex may stand, so the pole still fits under 16 m. */
const MAX_APEX = 128 - POLE;
const ROOF_ALT: Readonly<Record<PieceKit['style'], number>> = { hearth: MAT.brick, tide: MAT.darkStone, grove: MAT.moss };

/** Cone layers for an eaves radius and pitch: a bell-cast first ring, then a steady rise to a two-cell tip. */
const coneLayers = (radius: number, pitch: number) => {
  let k = 0;
  while (coneRadius(radius, pitch, k) >= 0.75) k++;
  return k;
};
const coneRadius = (radius: number, pitch: number, k: number) => (k === 0 ? radius : radius - 0.8 - (k - 1) / pitch);
/** Half sides of a square roof's layers: a bell-cast first step, then one cell in per `pitch` layers. */
const squareHalf = (half: number, pitch: number, k: number) => (k === 0 ? half : half - 1 - Math.floor((k - 1) / pitch));
const squareLayers = (half: number, pitch: number) => {
  let k = 0;
  while (squareHalf(half, pitch, k) >= 1) k++;
  return k;
};

export function watchtowerLayout(seed: number): WatchtowerLayout {
  const r = stream(seed, 0x7a7c4);
  const form = r.pick(['round', 'square', 'trestle'] as const);
  const S = 64 + 4 * r.int(0, 2), G = 3, c = S / 2;
  const bannerSide = r.chance(0.5) ? 1 : -1, woodSide = r.chance(0.5) ? 1 : -1;
  const lit = r.chance(0.5) ? 2 : 1, foot = r.chance(0.5) ? 'rack' : 'horn';
  const figure = r.pick(['heart', 'star', 'diamond', 'note'] as const);
  let crown: WatchtowerCrown, roof: WatchtowerRoof, span: number, shaft: number, upper: number, reach = 0, pitch: number, apex: number, cz: number;
  if (form === 'round') {
    span = r.int(16, 18); roof = 'cone'; cz = c - 4;
    if (r.chance(0.5)) {
      crown = 'crenellated'; upper = r.int(14, 18); pitch = r.range(2.2, 2.9); shaft = G + r.int(56, 70);
      apex = shaft + upper + coneLayers(8.5, pitch);
      while (apex > 112) { shaft--; apex--; }
    } else {
      crown = 'hoarding'; upper = 12; pitch = r.range(1.2, 1.5); shaft = G + r.int(50, 60);
      apex = shaft + upper + 1 + coneLayers(span + 7.5, pitch);
      while (apex > 112) { shaft--; apex--; }
    }
  } else if (form === 'square') {
    crown = 'gallery'; roof = 'pyramid'; cz = c - 4;
    span = r.int(18, 20); reach = r.int(4, 5); upper = r.int(17, 20); pitch = r.range(1.4, 1.9);
    shaft = G + r.int(24, 32);
    apex = shaft + 3 + upper + squareLayers(span + reach + 2, pitch);
    while (apex > MAX_APEX) { shaft--; apex--; }
  } else {
    crown = 'hut'; roof = r.chance(0.5) ? 'gable' : 'pyramid'; cz = c - 1;
    span = r.int(21, 24); reach = r.int(11, 12); upper = r.int(16, 18); pitch = r.range(1.2, 1.6);
    shaft = G + r.int(68, 82);
    const half = reach + 6;
    apex = shaft + 3 + upper + (roof === 'gable' ? coneLayers(half, pitch) : squareLayers(half, pitch));
    while (apex > MAX_APEX) { shaft--; apex--; }
  }
  return {
    form, crown, roof, size: [S, apex + POLE, S], centre: [c, cz], ground: G, span, shaft, upper, reach, pitch, apex,
    bannerSide, woodSide, lit, foot, figure,
  };
}

interface Ctx {
  readonly g: Grid;
  readonly kit: PieceKit;
  readonly L: WatchtowerLayout;
  readonly cloth: PieceColours;
  readonly salt: number;
  readonly cx: number;
  readonly cz: number;
  /** The rise's surface height per column (x + S * z). */
  readonly hm: Uint8Array;
  readonly lanterns: Vec3[];
}

export function createWatchtower(options: PieceOptions): GeneratedPiece {
  const kit = checkOptions(options);
  const L = watchtowerLayout(options.seed);
  const [S, H] = L.size;
  const g = new Grid(S, H, S);
  const ctx: Ctx = { g, kit, L, cloth: options.colours, salt: (options.seed ^ 0x2b7e) | 0, cx: L.centre[0], cz: L.centre[1], hm: new Uint8Array(S * S), lanterns: [] };

  rise(ctx);
  if (L.form === 'round') roundTower(ctx);
  else if (L.form === 'square') squareTower(ctx);
  else trestleTower(ctx);
  yard(ctx);
  g.prune(SOFT);

  const id = `genesis-watchtower-${kit.style}-${L.form}-${L.crown}-${variantTag(options.seed, options.colours)}`;
  return finish(g, id, kit.style, ctx.lanterns);
}

// ── The rise: a rounded-square hummock of turf in three soft steps, a worn earth path down to the road at +Z, and a few
// field stones where the steps break.

function rise(c: Ctx): void {
  const { g, kit, L, salt, hm, cx } = c;
  const S = L.size[0], half = S / 2;
  const path = (x: number, z: number) => z > c.cz + 4 && Math.abs(x + 0.5 - cx - 2.2 * Math.sin(z * 0.17 + salt)) < 3.2 + hash(x >> 2, 3, z >> 2, salt);
  for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
    const dx = Math.abs(x + 0.5 - half) / (half - 0.5), dz = Math.abs(z + 0.5 - half) / (half - 0.5);
    const n = hash(Math.floor(x / 3), 0, Math.floor(z / 3), salt) * 0.07 + hash(x >> 3, 1, z >> 3, salt) * 0.08;
    const d = (dx ** 3 + dz ** 3) ** (1 / 3) + n - 0.08;
    const layers = d < 0.74 ? 3 : d < 0.88 ? 2 : d < 1.0 ? 1 : 0;
    hm[x + S * z] = layers;
    if (!layers) continue;
    const worn = path(x, z) || (layers === 3 && hash(x >> 2, 2, z >> 2, salt) < 0.08);
    g.fill(x, 0, z, x + 1, layers, z + 1, worn ? MAT.earth : MAT.grass);
  }
  // Field stones half sunk where the turf steps down, and a stepping stone or two in the path.
  for (let k = 0; k < 9; k++) {
    const a = hash(k, 7, 1, salt) * TAU, rr = half * (0.8 + hash(k, 7, 2, salt) * 0.1);
    const x = Math.round(half + Math.sin(a) * rr), z = Math.round(half + Math.cos(a) * rr);
    if (path(x, z)) continue;
    const y = hm[x + S * z] ?? 0, w = 2 + Math.floor(hash(k, 7, 3, salt) * 2);
    g.fill(x - 1, Math.max(0, y - 1), z - 1, x - 1 + w, y + 1, z - 1 + w, hash(k, 7, 4, salt) < 0.5 ? kit.rock : kit.base);
    g.set(x - 1, y + 1, z - 1, MAT.moss);
  }
  for (let z = c.cz + 8; z < S - 1; z += 5) for (let x = 0; x < S; x++) {
    if (!path(x, z) || !path(x + 2, z) || !path(x, z + 1) || hash(x, 8, z, salt) > 0.25) continue;
    const y = hm[x + S * z]!;
    if (y) { g.fill(x, y - 1, z, x + 3, y, z + 2, MAT.paving); x += 4; }
  }
}

const surface = (c: Ctx, x: number, z: number) => c.hm[x + c.L.size[0] * z] ?? 0;

// ── Shared parts.

/** A solid ring (or a disc when `inner` < 0) about a centre on the cell lattice, from y0 up to y1. */
function ring(g: Grid, cx: number, cz: number, outer: number, inner: number, y0: number, y1: number, m: number): void {
  const R = Math.ceil(outer) + 1;
  for (let z = Math.floor(cz - R); z <= cz + R; z++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
    const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
    if (d <= outer && d > inner) g.fill(x, y0, z, x + 1, y1, z + 1, m);
  }
}

/**
 * Hand-laid stone: the exposed cells of the kit's stone in a region get coursed blocks of the other two stones here and
 * there, staggered course by course, and moss creeping up the shaded north foot.
 */
function dress(c: Ctx, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, ox: number, oz: number): void {
  const { g, kit, salt, L } = c;
  const second = kit.rock !== kit.stone ? kit.rock : kit.base;
  for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (g.get(x, y, z) !== kit.stone || !g.exposed(x, y, z)) continue;
    const course = Math.floor(y / 3);
    const arc = Math.atan2(x + 0.5 - ox, z + 0.5 - oz) * 18;
    const block = Math.floor(arc / 5 + (course & 1) * 0.5);
    const h = hash(block, course, 7, salt);
    if (h < 0.075) g.set(x, y, z, second);
    else if (h < 0.115) g.set(x, y, z, kit.base);
    else if (y < L.ground + 7 && z < oz && hash(x >> 1, y >> 1, z >> 1, salt) < 0.42 - (y - L.ground) * 0.05) g.set(x, y, z, MAT.moss);
  }
}

/**
 * An iron fire basket: a bowl (`n` × `n`, n = 2 or 4) on whatever stand the caller built, its floor at y with its
 * west-north corner at (x, z), a rim one cell round it with brass tips, split logs, and coals glowing at the heart.
 * Pushes the flame cell, in the air over the coals, as a lantern.
 */
function brazier(c: Ctx, x: number, y: number, z: number, n: 2 | 4): void {
  const { g, kit } = c;
  g.fill(x, y, z, x + n, y + 1, z + n, kit.iron);
  g.fill(x - 1, y + 1, z - 1, x + n + 1, y + 3, z + n + 1, kit.iron);
  g.fill(x, y + 1, z, x + n, y + 3, z + n, MAT.air);
  g.fill(x, y + 1, z, x + n, y + 2, z + n, MAT.bark);
  const k = n === 4 ? 1 : 0;
  g.fill(x + k, y + 2, z + k, x + n - k, y + 3, z + n - k, MAT.darkStone);
  if (n === 4) { g.set(x, y + 2, z + 3, MAT.forgeCopper); g.set(x + 3, y + 2, z, MAT.forgeCopper); }
  for (const [dx, dz] of [[-1, -1], [n, -1], [-1, n], [n, n]] as const) g.set(x + dx, y + 3, z + dz, kit.metal);
  c.lanterns.push([x + k, y + 3, z + k]);
}

/** An iron pole on the apex cell (x, y, z) with a brass ball and a rippling swallow-tailed pennant flying to `side`. */
function pennant(c: Ctx, x: number, y: number, z: number, side: -1 | 1): void {
  const { g, kit, cloth } = c;
  g.fill(x, y, z, x + 1, y + 10, z + 1, kit.iron);
  g.set(x, y + 10, z, kit.metal);
  for (let k = 0; k < 11; k++) {
    const h = k < 4 ? 4 : k < 8 ? 3 : 2;
    const lift = Math.round(Math.sin(k * 0.75) * 0.9);
    for (let dy = 0; dy < h; dy++) {
      if (k >= 9 && dy === 0 && h === 2) continue; // the swallow tail's notch
      const m = dy === h - 1 ? cloth.border : k >= 2 && k <= 3 && dy === 1 ? cloth.charge : cloth.field;
      g.set(x + side * (1 + k), y + 9 - dy + (h > 2 ? lift : 0) - (h === 2 ? 1 : 0), z, m);
    }
  }
}

/**
 * A hung banner in the x–y plane at depth z: `w` wide and `len` long below its top row at y, starting at x0 and running
 * to `side`. A border hem down both edges, a header band, the kingdom's roundel in the upper half and a dovetailed foot.
 */
function banner(c: Ctx, x0: number, y: number, z: number, w: number, len: number, side: -1 | 1): void {
  const { g, cloth, L } = c;
  const xs = Array.from({ length: w }, (_, i) => x0 + side * i).sort((a, b) => a - b);
  const left = xs[0]!, right = xs[w - 1]!, mid = (left + right) / 2;
  for (const x of xs) {
    const fromMid = Math.abs(x - mid), tail = Math.round(fromMid * 0.9);
    for (let dy = 0; dy < len - 3 + tail; dy++) {
      const edge = x === left || x === right, head = dy < 2;
      g.set(x, y - dy, z, head || edge ? cloth.border : cloth.field);
    }
  }
  const ground = contrast([cloth.field, MAT.cream, MAT.darkStone], [cloth.charge, cloth.border]);
  const radius = w >= 11 ? 4 : 3;
  emblem(g, L.figure, Math.round(mid), y - 4 - radius, z, radius, cloth.charge, cloth.border, ground, 'z');
  // A brass rod through the header, a cell proud of either hem.
  g.fill(left - 1, y, z, right + 2, y + 1, z + 1, c.kit.metal);
}

/**
 * A door in a wall facing +Z: an `half`-wide round-arched opening between x = cx ± half, from y0, with its plank leaf
 * set back at `zd` (the wall's inner skin) and a stone surround of alternating voussoirs on the outer face.
 */
function door(c: Ctx, cx: number, y0: number, zd: number, zMax: number, half: number, rise: number): void {
  const { g, kit } = c;
  const spring = y0 + rise;
  const inside = (x: number, y: number) => Math.abs(x + 0.5 - cx) < half && (y < spring || Math.hypot(x + 0.5 - cx, y + 0.5 - spring) < half);
  for (let y = y0; y < spring + half + 3; y++) for (let x = cx - half - 3; x < cx + half + 3; x++) {
    if (inside(x, y)) {
      for (let z = zd + 1; z <= zMax; z++) g.set(x, y, z, MAT.air);
      const strap = y === y0 + 3 || y === spring - 1;
      g.set(x, y, zd, strap ? kit.iron : (x - cx + 64) % 3 === 2 ? kit.wood : kit.trim);
      continue;
    }
    // The surround: one or two cells round the opening, on the outermost solid cell of each column.
    const e = y < spring ? Math.abs(x + 0.5 - cx) - half : Math.hypot(x + 0.5 - cx, y + 0.5 - spring) - half;
    if (e < 0 || e > 2.1 || y < y0) continue;
    let z = zMax;
    while (z > zd && !g.get(x, y, z)) z--;
    if (z <= zd) continue;
    const a = y < spring ? y - y0 : Math.atan2(y + 0.5 - spring, x + 0.5 - cx) * 4;
    const key = y >= spring + half - 1 && Math.abs(x + 0.5 - cx) < 1.1;
    g.set(x, y, z, key ? kit.rock : Math.floor(a / (y < spring ? 3 : 1)) % 2 ? kit.base : kit.stone === kit.base ? kit.rock : kit.stone);
  }
  // A brass ring handle.
  g.set(cx + Math.floor(half / 2), y0 + Math.floor(rise / 2) + 1, zd + 1, kit.metal);
}

// ── Form 1: the round tower.

function roundTower(c: Ctx): void {
  const { g, kit, L, cx, cz } = c;
  const G = L.ground, r = L.span, top = L.shaft, side = L.bannerSide;
  ring(g, cx, cz, r + 3, -1, 0, G, kit.base);
  ring(g, cx, cz, r + 2, -1, G, G + 2, kit.base);
  ring(g, cx, cz, r + 1, r - 3, G + 2, G + 5, kit.stone);
  ring(g, cx, cz, r, r - 3, G + 5, top, kit.stone);
  // A string course a little over halfway, and a slight swell to the shaft just under it, as old towers settle.
  const band = G + Math.round((top - G) * 0.56);
  ring(g, cx, cz, r + 1, r - 3, band, band + 1, kit.base);

  if (L.crown === 'crenellated') {
    // Corbels under the parapet: stepped stones every other block, the gaps between them in shadow.
    const n = 2 * Math.round((TAU * (r + 1)) / 8);
    for (let z = cz - r - 4; z < cz + r + 4; z++) for (let x = cx - r - 4; x < cx + r + 4; x++) {
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      if (d <= r - 1 || d > r + 2.2) continue;
      const a = Math.atan2(x + 0.5 - cx, z + 0.5 - cz), u = ((a / TAU) * n + n) % 2;
      if (u < 1.0) {
        if (d <= r + 1.2) g.fill(x, top - 4, z, x + 1, top - 2, z + 1, kit.stone);
        g.fill(x, top - 2, z, x + 1, top, z + 1, kit.stone);
      }
    }
    ring(g, cx, cz, r - 1, -1, top - 1, top, kit.base);
    ring(g, cx, cz, r + 2, r - 1, top, top + 4, kit.stone);
    ring(g, cx, cz, r + 2.2, r - 1.2, top + 4, top + 5, kit.base);
    // Merlons: the crenel phase is set so the front, where the beacon stands, is open.
    const m = 2 * Math.round((TAU * (r + 1)) / 12);
    for (let z = cz - r - 4; z < cz + r + 4; z++) for (let x = cx - r - 4; x < cx + r + 4; x++) {
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      if (d <= r - 1 || d > r + 2) continue;
      const a = Math.atan2(x + 0.5 - cx, z + 0.5 - cz), k = Math.floor((a / TAU) * m + 0.5 + m);
      if (k % 2 === 1) g.fill(x, top + 5, z, x + 1, top + 9, z + 1, kit.stone);
    }
    // The stair turret at the back, its doorway onto the roof, a cornice, and a steep cone of the kit's roof.
    const tx = cx - side * 5, tz = cz - 8, tTop = top + L.upper;
    ring(g, tx, tz, 6.5, 4.4, top, tTop, kit.stone);
    ring(g, tx, tz, 4.4, -1, tTop - 1, tTop, kit.trim);
    for (let y = top; y < top + 8; y++) for (let x = tx - 2; x < tx + 2; x++) for (let z = tz; z < tz + 8; z++) {
      if (Math.hypot(x + 0.5 - tx, z + 0.5 - tz) > 4.2 && (y < top + 7 || Math.abs(x + 0.5 - tx) < 1)) g.set(x, y, z, MAT.air);
    }
    ring(g, tx, tz, 7.5, -1, tTop, tTop + 1, kit.base);
    const apex = cone(c, tx, tz, tTop + 1, 8.5);
    pennant(c, Math.floor(tx), apex, Math.floor(tz), side);
    dress(c, tx - 8, top, tz - 8, tx + 8, tTop, tz + 8, tx, tz);
    // The beacon on the roof at the front, on a stepped stone pedestal, flaming in the open crenel.
    const bz = cz + r - 8;
    g.fill(cx - 3, top, bz, cx + 3, top + 2, bz + 6, kit.base);
    g.fill(cx - 2, top + 2, bz + 1, cx + 2, top + 4, bz + 5, kit.stone);
    brazier(c, cx - 2, top + 4, bz + 1, 4);
    // A trap hatch and a ladder from below, a little life up top.
    g.fill(cx + side * 4, top - 1, cz - 2, cx + side * 4 + 4, top, cz + 2, kit.trim);
  } else {
    // The hoarding: joists through the wall, knee braces under them, a boarded fighting gallery all round, an open
    // bay at the front where the beacon burns, and one broad cone over it all.
    const n = Math.round((TAU * (r + 4)) / 6);
    for (let z = cz - r - 6; z < cz + r + 6; z++) for (let x = cx - r - 6; x < cx + r + 6; x++) {
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      if (d <= r - 1 || d > r + 5.5) continue;
      const a = Math.atan2(x + 0.5 - cx, z + 0.5 - cz), u = ((((a / TAU) * n) % 1) + 1) % 1;
      if (u < 0.38) g.fill(x, top - 2, z, x + 1, top, z + 1, kit.wood);
    }
    for (let j = 0; j < n; j += 2) {
      const a = ((j + 0.19) / n) * TAU, sa = Math.sin(a), ca = Math.cos(a);
      for (const dy of [0, 1]) {
        g.line([Math.floor(cx + sa * (r - 1)), top - 11 + dy, Math.floor(cz + ca * (r - 1))], [Math.floor(cx + sa * (r + 4.5)), top - 2 + dy, Math.floor(cz + ca * (r + 4.5))], kit.wood);
      }
    }
    ring(g, cx, cz, r + 5.5, -1, top, top + 1, kit.trim);
    const hTop = top + L.upper;
    const boards = Math.round((TAU * (r + 4.5)) / 2);
    for (let z = cz - r - 7; z < cz + r + 7; z++) for (let x = cx - r - 7; x < cx + r + 7; x++) {
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      if (d <= r + 3.5 || d > r + 5.5) continue;
      const a = Math.atan2(x + 0.5 - cx, z + 0.5 - cz), b = Math.floor(((a / TAU) * boards) + boards);
      g.fill(x, top + 1, z, x + 1, hTop, z + 1, b % 2 ? kit.wood : kit.trim);
      const bay = Math.abs(a) < 0.3;
      // The open bay above a breastwork, and little square loops round the rest.
      if (bay) g.fill(x, top + 5, z, x + 1, hTop - 2, z + 1, MAT.air);
      else if (Math.floor((a / TAU) * 10 + 10) % 2 === 0 && ((((a / TAU) * 10) % 1) + 1) % 1 > 0.4 && ((((a / TAU) * 10) % 1) + 1) % 1 < 0.62) g.fill(x, top + 6, z, x + 1, top + 9, z + 1, MAT.air);
    }
    // Posts either side of the bay, and the wall plate the cone sits on.
    for (const s of [-1, 1]) {
      const a = s * 0.33, x = Math.floor(cx + Math.sin(a) * (r + 4.5)), z = Math.floor(cz + Math.cos(a) * (r + 4.5));
      g.fill(x, top + 1, z, x + 1, hTop, z + 1, kit.wood);
    }
    ring(g, cx, cz, r + 6, -1, hTop, hTop + 1, kit.trim);
    const apex = cone(c, cx, cz, hTop + 1, r + 7.5);
    pennant(c, Math.floor(cx), apex, Math.floor(cz), side);
    // The beacon in the bay, on an iron stand over the gallery floor.
    const bz = cz + r + 1;
    g.fill(cx - 1, top + 1, bz + 1, cx + 1, top + 4, bz + 3, kit.iron);
    brazier(c, cx - 2, top + 4, bz, 4);
  }

  // The door at the front, cross slits round the shaft (one or two lit), a banner on an iron arm off the flank.
  door(c, cx, G + 2, Math.floor(cz + r - 3), cz + r + 3, 4, 10);
  g.fill(cx - 5, G, Math.floor(cz + r + 1), cx + 5, G + 2, Math.floor(cz + r + 4), kit.base);
  const slits: [number, number][] = [[-side * 0.62, G + Math.round((top - G) * 0.36)], [side * 0.34, G + Math.round((top - G) * 0.74)]];
  slits.forEach(([a, yc], i) => crossSlit(c, cx, cz, r, a, yc, i < L.lit));
  const armY = top - 15, ax = side > 0 ? cx + r - 1 : cx - r;
  g.fill(Math.min(ax, ax + side * 14), armY, cz, Math.max(ax, ax + side * 14) + 1, armY + 1, cz + 1, kit.iron);
  g.line([ax, armY + 9, cz], [ax + side * 12, armY + 1, cz], kit.iron);
  g.set(ax + side * 14, armY + 1, cz, kit.metal);
  banner(c, ax + side * 3, armY - 1, cz, 10, Math.min(26, Math.round((armY - G) * 0.55)), side);
  dress(c, cx - r - 4, G, cz - r - 4, cx + r + 4, top + 9, cz + r + 4, cx, cz);
  ivy(c, cx, cz, r, -side * 2.2);
}

/** A cone of the kit's roof from y0 (eaves radius `radius`), shingle flecks and a ridge-cap ring; returns the pole's base y. */
function cone(c: Ctx, cx: number, cz: number, y0: number, radius: number): number {
  const { g, kit, salt, L } = c;
  const alt = ROOF_ALT[kit.style];
  let k = 0;
  for (; ; k++) {
    const rad = coneRadius(radius, L.pitch, k);
    if (rad < 0.75) break;
    ring(g, cx, cz, rad, -1, y0 + k, y0 + k + 1, kit.roof);
  }
  // A darker course every few rows and a scatter of odd shingles, only where the roof shows.
  const R = Math.ceil(radius) + 1;
  for (let y = y0; y < y0 + k; y++) for (let z = Math.floor(cz - R); z <= cz + R; z++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
    if (g.get(x, y, z) !== kit.roof || g.get(x, y + 1, z)) continue;
    const course = (y - y0) % 7 === 3, fleck = hash(x >> 1, y, z >> 1, salt) < 0.07;
    if (course || fleck) g.set(x, y, z, alt);
  }
  // A brass finial ball on the tip.
  const tip = y0 + k;
  g.fill(Math.floor(cx) - 1, tip, Math.floor(cz) - 1, Math.floor(cx) + 1, tip + 1, Math.floor(cz) + 1, kit.metal);
  return tip + 1;
}

/** A cross-shaped arrow loop through a round wall at angle a (from +Z) centred at y; glazed, and lit if `lit`. */
function crossSlit(c: Ctx, cx: number, cz: number, r: number, a: number, yc: number, lit: boolean): void {
  const { g, kit } = c;
  const sa = Math.sin(a), ca = Math.cos(a);
  let lamp: Vec3 | null = null, best = Infinity;
  for (let z = Math.floor(cz - r - 2); z <= cz + r + 2; z++) for (let x = Math.floor(cx - r - 2); x <= cx + r + 2; x++) {
    const dx = x + 0.5 - cx, dz = z + 0.5 - cz, d = Math.hypot(dx, dz);
    if (d <= r - 3 || d > r + 0.2) continue;
    const along = dx * sa + dz * ca, u = dx * ca - dz * sa;
    if (along <= 0) continue;
    for (let y = yc - 5; y <= yc + 5; y++) {
      const arm = Math.abs(u) < 2.4 && (y === yc || y === yc + 1), stem = Math.abs(u) < 0.9 && Math.abs(y - yc - 0.5) < 5;
      if (arm || stem) {
        g.set(x, y, z, lit ? MAT.glass : MAT.darkStone);
        if (lit && y === yc && d < best) { best = d; lamp = [x, y, z]; }
      } else if (Math.abs(u) < 2 && Math.abs(y - yc - 0.5) < 6.6 && d > r - 0.8 && g.get(x, y, z)) g.set(x, y, z, kit.base);
    }
  }
  if (lamp) c.lanterns.push(lamp);
}

/** Ivy climbing a round wall from its foot at angle a: leaves one cell proud, thinning as it goes up. */
function ivy(c: Ctx, cx: number, cz: number, r: number, a: number): void {
  const { g, L, salt } = c;
  const G = L.ground, height = 22 + Math.floor(hash(1, 2, 3, salt) * 14);
  for (let z = Math.floor(cz - r - 3); z <= cz + r + 3; z++) for (let x = Math.floor(cx - r - 3); x <= cx + r + 3; x++) {
    const dx = x + 0.5 - cx, dz = z + 0.5 - cz, d = Math.hypot(dx, dz);
    if (d <= r || d > r + 1.2) continue;
    const off = Math.atan2(dx, dz) - a, w = Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) * r;
    for (let y = G + 2; y < G + height; y++) {
      const reach = 6 * (1 - (y - G) / height) + 1.5 * Math.sin(y * 0.4 + salt);
      if (w > reach || g.get(x, y, z) || hash(x, y >> 1, z, salt) < 0.3) continue;
      if (!g.get(x, y - 1, z) && !wallBehind(g, x, y, z, cx, cz)) continue;
      g.set(x, y, z, hash(x, y, z, salt + 1) < 0.08 ? MAT.petal : MAT.leaf);
    }
  }
}
const wallBehind = (g: Grid, x: number, y: number, z: number, cx: number, cz: number) =>
  !!(g.get(x + Math.sign(cx - x - 0.5), y, z) || g.get(x, y, z + Math.sign(cz - z - 0.5)));

// ── Form 2: the square base and the lookout room.

function squareTower(c: Ctx): void {
  const { g, kit, L, cx, cz, cloth } = c;
  const G = L.ground, b = L.span, top = L.shaft, jet = L.reach, F = top + 3, side = L.bannerSide;
  const x0 = cx - b, x1 = cx + b, z0 = cz - b, z1 = cz + b;
  g.fill(x0 - 2, 0, z0 - 2, x1 + 2, G, z1 + 2, kit.base);
  g.fill(x0 - 1, G, z0 - 1, x1 + 1, G + 3, z1 + 1, kit.base);
  g.fill(x0, G + 3, z0, x1, top, z1, kit.stone);
  g.fill(x0 + 3, G + 3, z0 + 3, x1 - 3, top - 1, z1 - 3, MAT.air);
  // A batter: the lowest courses a cell proud, stepping back.
  g.under(x0 - 1, G + 3, z0 - 1, x1 + 1, G + 5, z1 + 1, kit.stone);
  // Quoins in the paler or darker stone, long and short by turns.
  const quoin = kit.style === 'hearth' ? MAT.cream : kit.rock !== kit.stone ? kit.rock : kit.base;
  for (let y = G + 5; y < top - 1; y += 3) {
    const long = ((y - G - 5) / 3) % 2 === 0;
    for (const [qx, sx] of [[x0, 1], [x1 - 1, -1]] as const) for (const [qz, sz] of [[z0, 1], [z1 - 1, -1]] as const) {
      const ax = long ? 5 : 3, az = long ? 3 : 5;
      g.over(Math.min(qx, qx + sx * (ax - 1)), y, qz, Math.max(qx, qx + sx * (ax - 1)) + 1, y + 3, qz + 1, quoin);
      g.over(qx, y, Math.min(qz, qz + sz * (az - 1)), qx + 1, y + 3, Math.max(qz, qz + sz * (az - 1)) + 1, quoin);
    }
  }
  dress(c, x0 - 1, G + 3, z0 - 1, x1 + 1, top, z1 + 1, cx, cz);
  // A cornice course under the jetty.
  g.fill(x0 - 1, top - 1, z0 - 1, x1 + 1, top, z1 + 1, kit.base);

  // The jetty: joists out over every face, knee braces, a planked gallery floor with a fascia, and a railing.
  for (let x = x0 + 1; x < x1 - 1; x += 5) g.fill(x, top, z0 - jet, x + 2, top + 2, z1 + jet, kit.wood);
  for (let z = z0 + 1; z < z1 - 1; z += 5) g.fill(x0 - jet, top, z, x1 + jet, top + 2, z + 2, kit.wood);
  g.fill(x0 - jet, top + 2, z0 - jet, x1 + jet, F, z1 + jet, kit.trim);
  for (const [ax0, az0, ax1, az1] of [[x0 - jet, z0 - jet, x1 + jet, z0 - jet + 1], [x0 - jet, z1 + jet - 1, x1 + jet, z1 + jet], [x0 - jet, z0 - jet, x0 - jet + 1, z1 + jet], [x1 + jet - 1, z0 - jet, x1 + jet, z1 + jet]] as const) {
    g.fill(ax0, top + 1, az0, ax1, F, az1, kit.trim);
  }
  for (const u of [-b + 3, b - 5]) for (const t of [0, 1]) {
    g.line([cx + u + t, top - 10, z1 - 1], [cx + u + t, top, z1 + jet - 2], kit.wood);
    g.line([cx + u + t, top - 10, z0], [cx + u + t, top, z0 - jet + 1], kit.wood);
    g.line([x1 - 1, top - 10, cz + u + t], [x1 + jet - 2, top, cz + u + t], kit.wood);
    g.line([x0, top - 10, cz + u + t], [x0 - jet + 1, top, cz + u + t], kit.wood);
  }
  railing(c, x0 - jet, z0 - jet, x1 + jet, z1 + jet, F, 8);

  // The lookout room: a half-timbered box set in from the gallery edge, plastered between its posts and rails, a
  // window on every face (the front one and maybe a side one lit), shutters folded back.
  const rw = b - 3, rx0 = cx - rw, rx1 = cx + rw, rz0 = cz - rw, rz1 = cz + rw, rh = L.upper, R = F + rh;
  g.fill(rx0, F, rz0, rx1, R, rz1, kit.wall);
  g.fill(rx0 + 2, F, rz0 + 2, rx1 - 2, R - 1, rz1 - 2, MAT.air);
  const frame = (fx0: number, fy0: number, fz0: number, fx1: number, fy1: number, fz1: number) => g.over(fx0, fy0, fz0, fx1, fy1, fz1, kit.trim);
  frame(rx0, F, rz0, rx1, F + 2, rz1); frame(rx0, R - 2, rz0, rx1, R, rz1); frame(rx0, F + 6, rz0, rx1, F + 7, rz1);
  for (const x of [rx0, rx0 + 6, rx1 - 8, rx1 - 2]) { frame(x, F, rz0, x + 2, R, rz0 + 1); frame(x, F, rz1 - 1, x + 2, R, rz1); }
  for (const z of [rz0, rz0 + 6, rz1 - 8, rz1 - 2]) { frame(rx0, F, z, rx0 + 1, R, z + 2); frame(rx1 - 1, F, z, rx1, R, z + 2); }
  // Diagonal braces in the corner panels, above the window rail.
  for (let k = 0; k < Math.min(rh - 9, 6); k++) {
    const y = F + 7 + k;
    for (const [x, z] of [[rx0 + 2 + k, rz1 - 1], [rx1 - 3 - k, rz1 - 1], [rx0 + 2 + k, rz0], [rx1 - 3 - k, rz0]] as const) g.set(x, y, z, kit.trim);
    for (const [x, z] of [[rx0, rz0 + 2 + k], [rx0, rz1 - 3 - k], [rx1 - 1, rz0 + 2 + k], [rx1 - 1, rz1 - 3 - k]] as const) g.set(x, y, z, kit.trim);
  }
  const wy0 = F + 8, wy1 = Math.min(R - 3, F + 15);
  const windowAt = (face: 'front' | 'back' | 'east' | 'west', lit: boolean) => {
    const across = face === 'front' || face === 'back';
    const outer = face === 'front' ? rz1 - 1 : face === 'back' ? rz0 : face === 'east' ? rx1 - 1 : rx0;
    const inner = outer + (face === 'front' || face === 'east' ? -1 : 1), out = outer + (face === 'front' || face === 'east' ? 1 : -1);
    for (let y = wy0 - 1; y <= wy1; y++) for (let t = -4; t < 4; t++) {
      const a = (across ? cx : cz) + t;
      const at = (d: number, m: number) => (across ? g.set(a, y, d, m) : g.set(d, y, a, m));
      if (y === wy0 - 1 || y === wy1) { at(outer, kit.trim); continue; }
      at(outer, t === -4 || t === 3 ? kit.trim : t === -1 || t === 0 ? kit.trim : MAT.air);
      if (!(t === -4 || t === 3 || t === -1 || t === 0)) at(inner, MAT.glass);
      if (lit && y === Math.floor((wy0 + wy1) / 2) && t === -3) c.lanterns.push(across ? [a, y, inner] : [inner, y, a]);
    }
    // The sill, a cell proud, and the shutters standing open against the wall either side.
    for (let t = -5; t < 5; t++) { const a = (across ? cx : cz) + t; if (across) g.set(a, wy0 - 1, out, kit.trim); else g.set(out, wy0 - 1, a, kit.trim); }
    for (let y = wy0; y < wy1; y++) for (const t of [-8, -7, -6, -5, 4, 5, 6, 7]) {
      const a = (across ? cx : cz) + t, m = t === -6 || t === 5 ? kit.trim : kit.wood;
      if (across) g.set(a, y, out, m); else g.set(out, y, a, m);
    }
  };
  windowAt('front', true);
  windowAt('back', false);
  windowAt(side > 0 ? 'west' : 'east', L.lit === 2);
  windowAt(side > 0 ? 'east' : 'west', false);

  // The bell-cast pyramid roof, its hips capped, and the pole with its pennant on the apex.
  const E = b + jet + 2;
  const alt = ROOF_ALT[kit.style];
  let k = 0;
  for (; ; k++) {
    const h = squareHalf(E, L.pitch, k);
    if (h < 1) break;
    g.fill(cx - h, R + k, cz - h, cx + h, R + k + 1, cz + h, kit.roof);
    if (h > 1) for (const [hx, hz] of [[cx - h, cz - h], [cx + h - 1, cz - h], [cx - h, cz + h - 1], [cx + h - 1, cz + h - 1]] as const) g.set(hx, R + k, hz, alt);
  }
  roofFlecks(c, cx - E, R, cz - E, cx + E, R + k, cz + E);
  g.fill(cx - 1, R + k, cz - 1, cx + 1, R + k + 1, cz + 1, kit.metal);
  pennant(c, cx - 1, R + k + 1, cz - 1, side);

  // The beacon on the gallery's front corner (away from the banner), on an iron stand.
  const bx = side > 0 ? x0 - jet + 2 : x1 + jet - 6, bz = z1 + jet - 6;
  for (const [dx, dz] of [[0, 0], [3, 0], [0, 3], [3, 3]] as const) g.fill(bx + dx, F, bz + dz, bx + dx + 1, F + 4, bz + dz + 1, kit.iron);
  brazier(c, bx, F + 4, bz, 4);

  // The banner hung over the front rail on the banner side, its roundel over the jetty.
  banner(c, cx + side * 3, F + 7, z1 + jet, 11, Math.min(26, F - G - 8), side);
  void cloth;

  // The door in the base, and a cross slit in its flank.
  door(c, cx, G + 3, z1 - 3, z1 + 1, 4, 9);
  g.fill(cx - 5, G, z1 + 1, cx + 5, G + 3, z1 + 4, kit.base);
  for (let y = G + 12; y < G + 21; y++) {
    const x = side > 0 ? x0 : x1 - 1, arm = y === G + 16 || y === G + 17;
    for (let t = -2; t <= 2; t++) if (arm || Math.abs(t) < 1) for (const xx of [x, x + (side > 0 ? 1 : -1), x + (side > 0 ? 2 : -2)]) g.set(xx, y, cz + t, MAT.darkStone);
  }
}

/** A railing round a rectangle's edge at floor y: posts every `every` cells and at the corners, a top and a mid rail. */
function railing(c: Ctx, x0: number, z0: number, x1: number, z1: number, y: number, every: number): void {
  const { g, kit } = c;
  for (const [ax0, az0, ax1, az1] of [[x0, z0, x1, z0 + 1], [x0, z1 - 1, x1, z1], [x0, z0, x0 + 1, z1], [x1 - 1, z0, x1, z1]] as const) {
    g.fill(ax0, y + 6, az0, ax1, y + 7, az1, kit.trim);
    g.fill(ax0, y + 3, az0, ax1, y + 4, az1, kit.wood);
  }
  const posts = (a0: number, a1: number) => {
    const n = Math.max(1, Math.round((a1 - a0) / every)), out: number[] = [];
    for (let i = 0; i <= n; i++) out.push(Math.round(a0 + ((a1 - 1 - a0) * i) / n));
    return out;
  };
  for (const x of posts(x0, x1)) { g.fill(x, y, z0, x + 1, y + 8, z0 + 1, kit.trim); g.fill(x, y, z1 - 1, x + 1, y + 8, z1, kit.trim); }
  for (const z of posts(z0, z1)) { g.fill(x0, y, z, x0 + 1, y + 8, z + 1, kit.trim); g.fill(x1 - 1, y, z, x1, y + 8, z + 1, kit.trim); }
}

function roofFlecks(c: Ctx, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  const { g, kit, salt } = c;
  const alt = ROOF_ALT[kit.style];
  for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (g.get(x, y, z) !== kit.roof || g.get(x, y + 1, z)) continue;
    if ((y - y0) % 6 === 2 || hash(x >> 1, y, z >> 1, salt) < 0.06) g.set(x, y, z, alt);
  }
}

// ── Form 3: the trestle tower.

function trestleTower(c: Ctx): void {
  const { g, kit, L, cx, cz } = c;
  const G = L.ground, foot = L.span, T = L.reach, P = L.shaft, F = P + 3, hh = L.upper, side = L.bannerSide;
  const spread = (y: number) => foot + (T - foot) * Math.min(1, Math.max(0, (y - G) / (P - G)));
  const legAt = (sx: number, sz: number, y: number): [number, number, number] => {
    const s = spread(y);
    return [Math.round(cx + sx * s - 1.5) + 1, y, Math.round(cz + sz * s - 1.5) + 1];
  };
  const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const;
  // Stone pads, and the four legs leaning in to the platform.
  for (const [sx, sz] of corners) {
    const [px, , pz] = legAt(sx, sz, G);
    g.fill(px - 4, 0, pz - 4, px + 4, G + 1, pz + 4, kit.base);
    g.fill(px - 3, G + 1, pz - 3, px + 3, G + 3, pz + 3, kit.stone);
    g.fill(px - 2, G + 3, pz - 2, px + 2, G + 4, pz + 2, kit.base);
    for (let y = G + 3; y < F; y++) { const [lx, , lz] = legAt(sx, sz, y); g.fill(lx - 1, y, lz - 1, lx + 2, y + 1, lz + 2, kit.trim); }
    const [lx, , lz] = legAt(sx, sz, G + 4);
    g.fill(lx - 1, G + 4, lz - 1, lx + 2, G + 6, lz + 2, kit.iron);
  }
  // Girts at two levels and under the platform, and a cross brace in every panel of every face.
  const levels = [G + 4, G + Math.round((P - G) * 0.36), G + Math.round((P - G) * 0.68), P];
  for (const y of levels.slice(1)) {
    for (const sz of [-1, 1]) { const [ax, , az] = legAt(-1, sz, y), [bx] = legAt(1, sz, y); g.fill(ax, y, az, bx + 1, y + 2, az + 1, kit.trim); }
    for (const sx of [-1, 1]) { const [ax, , az] = legAt(sx, -1, y), [, , bz] = legAt(sx, 1, y); g.fill(ax, y, az, ax + 1, y + 2, bz + 1, kit.trim); }
  }
  for (let i = 0; i < 3; i++) {
    const lo = levels[i]! + 2, hi = levels[i + 1]!;
    for (const sz of [-1, 1]) for (const [a, b2] of [[-1, 1], [1, -1]] as const) {
      const p = legAt(a, sz, lo), q = legAt(b2, sz, hi);
      g.line(p, q, kit.wood); g.line([p[0], p[1] + 1, p[2]], [q[0], q[1] + 1, q[2]], kit.wood);
    }
    for (const sx of [-1, 1]) {
      // The sides take a single raking brace per panel, alternating, so the ladder face stays open.
      const flip = (i + (sx > 0 ? 1 : 0)) % 2 ? 1 : -1;
      const p = legAt(sx, flip, lo), q = legAt(sx, -flip, hi);
      g.line(p, q, kit.wood); g.line([p[0], p[1] + 1, p[2]], [q[0], q[1] + 1, q[2]], kit.wood);
    }
  }

  // The platform: joists out past the legs, a planked floor, a hatch where the ladder comes through, a railing.
  const ph = T + 8;
  for (let x = cx - ph + 1; x < cx + ph - 1; x += 5) g.fill(x, P, cz - ph, x + 2, P + 2, cz + ph, kit.wood);
  g.fill(cx - ph, P + 2, cz - ph, cx + ph, F, cz + ph, kit.trim);
  for (const [ax0, az0, ax1, az1] of [[cx - ph, cz - ph, cx + ph, cz - ph + 1], [cx - ph, cz + ph - 1, cx + ph, cz + ph], [cx - ph, cz - ph, cx - ph + 1, cz + ph], [cx + ph - 1, cz - ph, cx + ph, cz + ph]] as const) {
    g.fill(ax0, P + 1, az0, ax1, F, az1, kit.wood);
  }
  // Corner struts from each leg out to the platform's corner.
  for (const [sx, sz] of corners) for (const t of [0, 1]) {
    const [lx, , lz] = legAt(sx, sz, P - 10);
    g.line([lx, P - 10 + t, lz], [cx + sx * (ph - 1) - (sx > 0 ? 0 : 0), P + t, cz + sz * (ph - 1) - (sz > 0 ? 0 : 0)], kit.wood);
  }
  railing(c, cx - ph, cz - ph, cx + ph, cz + ph, F, 7);

  // The ladder up the flank away from the banner, leaning with the legs, through a hatch in the floor.
  const ls = (-side) as -1 | 1;
  const ladderX = (y: number) => (ls > 0 ? Math.round(cx + spread(y) + 3) : Math.round(cx - spread(y) - 3) - 1);
  const lz0 = cz - 3, lz1 = cz + 2;
  const hx = ladderX(P);
  g.fill(Math.min(hx - 1, hx + 1), P, lz0, Math.max(hx - 1, hx + 1) + 1, F, lz1 + 1, MAT.air);
  for (let y = 0; y < F + 6; y++) {
    const x = ladderX(Math.min(y, P));
    g.set(x, y, lz0, kit.trim); g.set(x, y, lz1, kit.trim);
    if (y > G && y % 4 === 0 && y < F) g.fill(x, y, lz0 + 1, x + 1, y + 1, lz1, kit.wood);
  }
  for (let y = F + 1; y < F + 6; y += 4) g.fill(hx, y, lz0 + 1, hx + 1, y + 1, lz1, kit.wood);

  // The hut: vertical boards, corner posts, a band of lookout windows all round, a door at the front.
  const Hh = T + 2, hx0 = cx - Hh, hx1 = cx + Hh, hz0 = cz - Hh, hz1 = cz + Hh, top = F + hh;
  for (let y = F; y < top; y++) for (let z = hz0; z < hz1; z++) for (let x = hx0; x < hx1; x++) {
    const edge = Math.min(x - hx0, hx1 - 1 - x, z - hz0, hz1 - 1 - z);
    if (edge > 1) continue;
    const along = z === hz0 || z === hz1 - 1 || z === hz0 + 1 || z === hz1 - 2 ? x : z;
    g.set(x, y, z, edge === 1 ? kit.trim : (along - cx + 64) % 4 < 2 ? kit.trim : kit.wood);
  }
  for (const [x, z] of [[hx0, hz0], [hx1 - 2, hz0], [hx0, hz1 - 2], [hx1 - 2, hz1 - 2]] as const) g.fill(x, F, z, x + 2, top, z + 2, kit.wood);
  g.fill(hx0, top - 1, hz0, hx1, top, hz1, kit.trim);
  const wy0 = F + 6, wy1 = F + 12;
  for (let y = wy0 - 1; y <= wy1; y++) for (let t = -Hh + 2; t < Hh - 2; t++) {
    const mull = (t + Hh + 64) % 5 === 0, rail = y === wy0 - 1 || y === wy1;
    for (const [outer, inner, across] of [[hz1 - 1, hz1 - 2, true], [hz0, hz0 + 1, true], [hx1 - 1, hx1 - 2, false], [hx0, hx0 + 1, false]] as const) {
      const a = (across ? cx : cz) + t;
      if (across && outer === hz1 - 1 && Math.abs(a + 0.5 - cx) < 4.5) continue; // the door
      const at = (d: number, m: number) => (across ? g.set(a, y, d, m) : g.set(d, y, a, m));
      if (rail || mull) { at(outer, kit.wood); at(inner, kit.wood); continue; }
      at(outer, MAT.air); at(inner, MAT.glass);
    }
  }
  // Lit windows: the front pane by the door, and maybe one on the banner side.
  c.lanterns.push([cx + 6, wy0 + 2, hz1 - 2]);
  if (L.lit === 2) c.lanterns.push(side > 0 ? [hx1 - 2, wy0 + 2, cz + 2] : [hx0 + 1, wy0 + 2, cz + 2]);
  // The sill under the band, a cell proud all round.
  for (const [ax0, az0, ax1, az1] of [[hx0 - 1, hz1, hx1 + 1, hz1 + 1], [hx0 - 1, hz0 - 1, hx1 + 1, hz0], [hx1, hz0, hx1 + 1, hz1], [hx0 - 1, hz0, hx0, hz1]] as const) g.fill(ax0, wy0 - 1, az0, ax1, wy0, az1, kit.wood);
  g.fill(cx - 4, F, hz1, cx + 4, wy0 - 1, hz1 + 1, MAT.air);
  door(c, cx, F, hz1 - 2, hz1, 3, 9);

  // The roof: a steep gable facing the road with the kingdom's roundel in it, or a pyramid; and the pole.
  const E = Hh + 4, alt = ROOF_ALT[kit.style];
  let k = 0;
  if (L.roof === 'gable') {
    for (; ; k++) {
      const h = coneRadius(E, L.pitch, k);
      if (h < 0.75) break;
      const xh = Math.round(h);
      const y = top + k;
      g.fill(cx - xh, y, cz - E, cx - xh + 3, y + 1, cz + E, kit.roof);
      g.fill(cx + xh - 3, y, cz - E, cx + xh, y + 1, cz + E, kit.roof);
      if (xh > 3) for (const gz of [hz0, hz1 - 1]) g.fill(cx - xh + 3, y, gz, cx + xh - 3, y + 1, gz + 1, (cx - xh + 3 + 64) % 2 ? kit.trim : kit.wall);
      if (xh > 3) g.fill(cx - xh + 3, y, hz0 + 1, cx + xh - 3, y + 1, hz1 - 1, kit.trim);
    }
    // Bargeboards down the front gable's edge and a ridge cap.
    for (let kk = 0; kk < k; kk++) {
      const xh = Math.round(coneRadius(E, L.pitch, kk));
      for (const s of [-1, 1]) g.set(s < 0 ? cx - xh : cx + xh - 1, top + kk, cz + E - 1, kit.trim);
    }
    g.fill(cx - 1, top + k - 1, cz - E, cx + 1, top + k, cz + E, alt);
    const ground = contrast([c.cloth.field, MAT.cream, MAT.darkStone], [c.cloth.charge, c.cloth.border]);
    emblem(g, L.figure, cx, top + Math.round(k * 0.4), hz1, 4, c.cloth.charge, c.cloth.border, ground, 'z');
    roofFlecks(c, cx - E, top, cz - E, cx + E, top + k, cz + E);
    pennant(c, cx - 1, top + k, cz + E - 2, side);
  } else {
    for (; ; k++) {
      const h = squareHalf(E, L.pitch, k);
      if (h < 1) break;
      g.fill(cx - h, top + k, cz - h, cx + h, top + k + 1, cz + h, kit.roof);
      if (h > 1) for (const [hx2, hz] of [[cx - h, cz - h], [cx + h - 1, cz - h], [cx - h, cz + h - 1], [cx + h - 1, cz + h - 1]] as const) g.set(hx2, top + k, hz, alt);
    }
    roofFlecks(c, cx - E, top, cz - E, cx + E, top + k, cz + E);
    g.fill(cx - 1, top + k, cz - 1, cx + 1, top + k + 1, cz + 1, kit.metal);
    pennant(c, cx - 1, top + k + 1, cz - 1, side);
  }

  // The beacon on the platform's front corner by the ladder, on a stone hearth slab, and the banner off the rail.
  const bx = ls > 0 ? cx + ph - 5 : cx - ph + 3, bz = cz + ph - 5;
  g.fill(bx - 1, F, bz - 1, bx + 3, F + 1, bz + 3, kit.base);
  g.fill(bx, F + 1, bz, bx + 2, F + 4, bz + 2, kit.iron);
  brazier(c, bx, F + 4, bz, 2);
  banner(c, cx + side * 2, F + 7, cz + ph, 10, 22, side);
}

// ── The foot: the woodpile, a barrel or two, a lamp post by the path, and a spear rack or a horn on a post.

function yard(c: Ctx): void {
  const { g, L, cx, cz } = c;
  const S = L.size[0], ws = L.woodSide;
  const front = L.form === 'round' ? cz + L.span + 3 : L.form === 'square' ? cz + L.span + 2 : cz + L.span - 4;
  const yardZ = Math.min(S - 12, front + 1);
  const lamp = (x: number, z: number) => {
    const y = Math.min(surface(c, x, z), surface(c, x + 1, z + 1), surface(c, x - 2, z - 2), surface(c, x + 3, z + 3));
    c.lanterns.push(lanternPost(g, c.kit, x, z, 18, y));
  };
  if (L.form === 'trestle') {
    // Under the trestle: the woodpile sheltered between the back legs, the barrel by a front leg; the lamp by the path.
    woodpile(c, cx - 7, cz - 6, 14, 1);
    barrel(c, cx - ws * 12 - 2, cz + 9);
    barrel(c, cx - ws * 7 - 2, cz + 13);
    footPiece(c, cx + ws * 11, cz + 8);
    lamp(cx - ws * 9 - 1, S - 9);
    return;
  }
  const wx = ws > 0 ? cx + 9 : cx - 21;
  woodpile(c, wx, yardZ + 1, 12, ws);
  barrel(c, cx - ws * 9 - 2, front - 1);
  if (L.lit === 1) barrel(c, cx - ws * 14 - 2, front - 4);
  footPiece(c, cx + ws * (L.form === 'round' ? L.span - 2 : L.span + 3), front - (L.form === 'round' ? 9 : 4));
  lamp(cx - ws * 10 - 1, Math.min(S - 8, yardZ + 7));
}

/** Split logs stacked between stakes, cut ends to the front, a chopping block with an axe beside it. */
function woodpile(c: Ctx, x0: number, z0: number, len: number, ws: -1 | 1): void {
  const { g, kit, salt } = c;
  const y0 = Math.min(surface(c, x0, z0), surface(c, x0 + len, z0 + 5));
  const depth = 6;
  for (let row = 0; row < 3; row++) {
    const inset = row, y = y0 + row * 2;
    for (let x = x0 + inset; x + 2 <= x0 + len - inset; x += 2) {
      g.fill(x, y, z0, x + 2, y + 2, z0 + depth, MAT.bark);
      const end = hash(x, row, 5, salt) < 0.5 ? MAT.plaster : MAT.limestone;
      g.fill(x, y, z0 + depth - 1, x + 2, y + 2, z0 + depth, end);
      g.set(x + (row % 2), y + 1, z0 + depth - 1, kit.wood);
    }
  }
  for (const x of [x0 - 1, x0 + len]) for (const z of [z0 + 1, z0 + depth - 2]) g.fill(x, y0, z, x + 1, y0 + 7, z + 1, kit.wood);
  // A chopping block, an axe bitten into it, and a few chips on the ground.
  const bx = ws > 0 ? x0 + len + 2 : x0 - 5, bz = z0 + 2;
  const by = surface(c, bx + 1, bz + 1);
  g.fill(bx, by, bz, bx + 3, by + 3, bz + 3, MAT.bark);
  g.fill(bx, by + 3, bz, bx + 3, by + 4, bz + 3, MAT.plaster);
  g.fill(bx + 1, by + 4, bz + 1, bx + 2, by + 5, bz + 2, kit.iron);
  g.fill(bx + 1, by + 5, bz + 1, bx + 2, by + 6, bz + 2, kit.iron);
  g.fill(bx + 1, by + 5, bz + 2, bx + 2, by + 6, bz + 7, kit.trim);
  g.set(bx + 1, by + 4, bz + 2, kit.trim);
  g.set(bx + 4, by, bz + 4, MAT.plaster); g.set(bx - 1, by, bz + 1, MAT.plaster);
}

/** A coopered barrel: rounded staves, two iron hoops, a lid. (x, z) is its west-north corner. */
function barrel(c: Ctx, x: number, z: number): void {
  const { g, kit } = c;
  const y = Math.min(surface(c, x + 2, z + 2), surface(c, x, z), surface(c, x + 4, z + 4));
  g.fill(x, y, z + 1, x + 5, y + 7, z + 4, kit.trim);
  g.fill(x + 1, y, z, x + 4, y + 7, z + 5, kit.trim);
  g.fill(x + 1, y + 1, z + 1, x + 4, y + 6, z + 4, kit.trim);
  for (const h of [y + 1, y + 5]) { g.over(x, h, z, x + 5, h + 1, z + 5, kit.iron); }
  g.fill(x + 1, y + 7, z + 1, x + 4, y + 8, z + 4, kit.wood);
  g.fill(x, y + 2, z + 2, x + 5, y + 4, z + 3, kit.wood);
}

/** The spear rack with a shield in the kingdom's cloth, or a horn hung from a capped post. (x, z) is its centre. */
function footPiece(c: Ctx, x: number, z: number): void {
  const { g, kit, L, cloth } = c;
  const y = Math.min(surface(c, x, z), surface(c, x - 4, z), surface(c, x + 4, z));
  if (L.foot === 'rack') {
    for (const px of [x - 5, x + 4]) g.fill(px, y, z, px + 1, y + 12, z + 2, kit.trim);
    g.fill(x - 5, y + 10, z, x + 5, y + 11, z + 2, kit.trim);
    g.fill(x - 5, y + 3, z, x + 5, y + 4, z + 2, kit.wood);
    for (const sx of [x - 3, x - 1, x + 2]) {
      g.fill(sx, y + 1, z + 2, sx + 1, y + 16, z + 3, kit.wood);
      g.fill(sx, y + 16, z + 2, sx + 1, y + 18, z + 3, kit.iron);
      g.set(sx, y + 18, z + 2, kit.metal);
    }
    g.fill(x - 3, y + 11, z + 2, x + 3, y + 12, z + 3, kit.trim);
    // A round shield leaning on the rack: border rim, field, a boss of the charge.
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > 3.4) continue;
      g.set(x + dx, y + 3 + dy + 1, z + 3, d > 2.4 ? cloth.border : d < 1 ? cloth.charge : cloth.field);
    }
  } else {
    g.fill(x - 1, y, z - 1, x + 2, y + 1, z + 2, kit.base);
    g.fill(x, y, z, x + 1, y + 15, z + 1, kit.trim);
    g.fill(x - 1, y + 1, z, x + 2, y + 2, z + 1, kit.trim);
    const arm = L.woodSide;
    g.fill(Math.min(x, x + arm * 5), y + 14, z, Math.max(x, x + arm * 5) + 1, y + 15, z + 1, kit.trim);
    g.fill(x - 2, y + 15, z - 1, x + 3, y + 16, z + 2, c.kit.roof);
    g.fill(x - 1, y + 16, z, x + 2, y + 17, z + 1, c.kit.roof);
    // The horn: a cord to its baldric, an ivory curve with a brass mouth and bell.
    const hx = x + arm * 5;
    g.set(hx, y + 13, z, kit.cord); g.set(hx, y + 12, z, kit.cord);
    const curve: [number, number][] = [[0, 11], [arm, 11], [2 * arm, 10], [3 * arm, 10], [3 * arm, 9], [4 * arm, 9]];
    for (const [dx, dy] of curve) g.set(hx + dx, y + dy, z, MAT.cream);
    g.set(hx - arm, y + 11, z, kit.metal);
    g.fill(Math.min(hx + 4 * arm, hx + 5 * arm), y + 8, z, Math.max(hx + 4 * arm, hx + 5 * arm) + 1, y + 11, z + 1, kit.metal);
    g.set(hx + arm, y + 12, z, cloth.field); g.set(hx + 2 * arm, y + 11, z, cloth.field);
  }
}
