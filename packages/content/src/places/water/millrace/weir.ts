import type { Vec3 } from '@chatdom/shared';
import { Boxes } from '../../../civic/kit';
import { MAT, STYLES, type StyleKey } from '../../../materials';
import { NO_METADATA, type SoundAnchor, type WaterPiece } from '../place-piece';
import { disc, hash } from '../shore/shape';
import { checkStyle, checkWhole, coursed, masonry, millBlueprint } from './craft';

/**
 * The weir that holds the millpond, frozen so the land's levels and the water's foam lip agree. Flow runs +Z; the
 * stream's clear width lies between two wing walls; y = 0 is the downstream bed. The crest's top face is
 * `crestTop`: the pond stands one cell over it and the tail water `drop` cells lower.
 */
export const WEIR = {
  /** Clear stream width between the wing walls, and the drop from pond to tail water, in cells. */
  width: [24, 96] as const,
  drop: [4, 8] as const,
  /** Each bank's wing wall, in cells across the stream. */
  wing: 6,
  /** Length along the flow, in cells (5.5 m). */
  depth: 44,
  /** Tail-water depth over the downstream bed, in cells. */
  tail: 3,
  /** Half-open z spans: the capping (overhanging both faces of the crest by a cell) and the crest body under it. */
  cap: [2, 12] as const,
  body: [3, 11] as const,
  /** Depth of each step's tread, and where the laid apron ends (its last stones run ragged a little past it). */
  tread: 4,
  apronEnd: 38,
  /** The wing walls stand this far above the water they hold back. */
  freeboard: 3,
} as const;

export interface WeirLevels {
  /** Top face of the crest capping. */
  readonly crestTop: number;
  /** The millpond surface: one cell over the crest. */
  readonly upstream: number;
  /** The tail-water surface: `drop` cells under the pond. */
  readonly downstream: number;
}

/** The water levels a weir of this drop holds, in cells above the downstream bed. */
export function weirLevels(drop: number): WeirLevels {
  checkWhole('weir', 'drop', drop, ...WEIR.drop);
  const crestTop = WEIR.tail + drop - 1;
  return { crestTop, upstream: crestTop + 1, downstream: crestTop + 1 - drop };
}

/** The frame for one weir: everything a neighbour (pond, stream, renderer) joins to. */
export interface WeirFrame extends WeirLevels {
  readonly size: Vec3;
  /** Half-open x span of the clear stream between the wing walls. */
  readonly channel: readonly [number, number];
  /** Half-open x span where the crest dips a cell, so the sheet of water runs thicker there. */
  readonly dip: readonly [number, number];
  /** Tops of the steps on the downstream face, crest side first; the apron's laid stones top out at 1. */
  readonly steps: readonly number[];
  /** Where the stepped face ends and the apron begins (z). */
  readonly toe: number;
}

export function weirFrame(width: number, drop: number): WeirFrame {
  checkWhole('weir', 'width', width, ...WEIR.width);
  const levels = weirLevels(drop), W = width + 2 * WEIR.wing, count = drop >= 6 ? 3 : 2;
  // Steps share the fall from the crest to the apron evenly; every rise is at least a cell and a half.
  const rise = (levels.crestTop - 1) / (count + 1);
  const steps = Array.from({ length: count }, (_, k) => Math.round(levels.crestTop - (k + 1) * rise));
  // The dip sits off-centre in the middle third, where the old capping has worn.
  const dipLength = 4 + Math.floor(hash(width, drop, 3) * 5);
  const dip0 = WEIR.wing + Math.floor(width / 3 + hash(width, drop, 4) * (width / 3 - dipLength));
  return {
    ...levels, size: [W, levels.upstream + WEIR.freeboard, WEIR.depth], channel: [WEIR.wing, WEIR.wing + width],
    dip: [dip0, dip0 + dipLength], steps, toe: WEIR.body[1] + count * WEIR.tread,
  };
}

/**
 * A stone overflow weir: a capped crest across the stream with a worn one-cell dip, a stepped downstream face whose
 * risers stay wet, a laid apron with a ragged end and two scour boulders breaking the tail water, and coursed wing
 * walls on both banks that stand above the pond and step down along the fall to the tail water. Wet tones run to
 * the waterlines, and moss keeps to the slow water in the corners by the walls.
 */
export function createWeir(style: StyleKey, width: number, drop: number): WaterPiece {
  checkStyle('weir', style);
  const F = weirFrame(width, drop), [W, H, D] = F.size, [c0, c1] = F.channel, b = new Boxes();
  const tones = masonry(style), stone = STYLES[style].stone, seed = width * 13 + drop;
  const [cap0, cap1] = WEIR.cap, [body0, body1] = WEIR.body;

  // --- Wing walls ----------------------------------------------------------------------------------------------
  // Full height first, faced in courses, then cut down to their stepped profile and coped. The courses stop a cell
  // under the coping, so each coping slab beds on an unbroken stone and its joints never meet a face joint.
  const upTop = F.upstream + WEIR.freeboard, downTop = F.downstream + WEIR.freeboard;
  const walls = [[0, c0], [c1, W]] as const;
  for (const [x0, x1] of walls) b.add(x0, 0, 0, x1, upTop, D, stone);
  walls.forEach(([x0, x1], side) => {
    const layer = side ? x0 : x1 - 1, s = seed + 101 * side;
    coursed(b, { normal: 'x', layer, span: [0, cap1], y: [0, upTop - 2], seed: s, wetTo: F.upstream, mossTo: F.upstream + 3 }, tones);
    coursed(b, { normal: 'x', layer, span: [cap1, D], y: [0, upTop - 2], seed: s + 1, wetTo: F.downstream, mossTo: F.downstream + 4 }, tones);
    coursed(b, { normal: 'z', layer: D - 1, span: [x0, x1], y: [0, downTop - 2], seed: s + 2, wetTo: F.downstream }, tones);
  });
  // The profile: level over the pond, then down a cell at a time along the fall, each step two or three cells
  // long, so even the deepest drop reaches the tail-water height by z 36.
  const profile: [number, number, number][] = [];
  for (let z = cap1, top = upTop, k = 0; z < D; k++) {
    const len = top > downTop ? 2 + Math.floor(hash(seed, k, 5) * 2) : D - z;
    profile.push([z, Math.min(z + len, D), top]);
    z += len;
    if (top > downTop) top--;
  }
  for (const [za, zb, top] of profile) for (const [x0, x1] of walls) b.add(x0, top, za, x1, upTop, zb, MAT.air);
  // Copings over every run, their joints cut into the top; the odd slab is a different stone.
  for (const [za, zb, top] of [[0, cap1, upTop] as const, ...profile]) {
    walls.forEach(([x0, x1], side) => {
      b.add(x0, top - 1, za, x1, top, zb, stone);
      for (let z = za + 2 + Math.floor(hash(seed, side, za, 6) * 4), k = 0; z < zb - 2; k++) {
        if (hash(seed, side, za, k, 7) > 0.7) b.add(x0, top - 1, Math.max(za, z - 5), x1, top, z, tones.band);
        b.add(x0, top - 1, z, x1, top, z + 1, MAT.air);
        z += 5 + Math.floor(hash(seed, side, za, k, 8) * 5);
      }
    });
  }
  // Waterlines: a dark weed line where each water meets the inner faces, broken where the current scours it.
  const waterlines = [[0, cap1, F.upstream], [cap1, D, F.downstream]] as const;
  walls.forEach(([x0, x1], side) => {
    const x = side ? x0 : x1 - 1;
    for (const [za, zb, y] of waterlines) {
      for (let z = za, k = 0; z < zb; k++) {
        const len = 3 + Math.floor(hash(seed, side, y, k, 9) * 6);
        if (hash(seed, side, y, k, 10) < 0.6) b.add(x, y - 1, z, x + 1, y + 1, Math.min(z + len, zb), k % 3 ? MAT.moss : tones.wet);
        z += len + 1 + Math.floor(hash(seed, side, y, k, 11) * 4);
      }
    }
  });

  // --- The crest -----------------------------------------------------------------------------------------------
  // A toe of rubble before it, the body, and the capping slabs over it with their joints and wet lip.
  b.add(c0, 0, 0, c1, 2, body0, tones.wet);
  for (let x = c0, k = 0; x < c1; k++) {
    const len = 3 + Math.floor(hash(seed, k, 12) * 5);
    if (hash(seed, k, 13) > 0.6) b.add(x, 2, 0, Math.min(x + len - 1, c1), 3, 2, tones.wet);
    x += len;
  }
  b.add(c0, 0, body0, c1, F.crestTop - 2, body1, tones.wet);
  b.add(c0, F.crestTop - 2, cap0, c1, F.crestTop, cap1, stone);
  b.add(c0, F.crestTop - 2, cap1 - 1, c1, F.crestTop - 1, cap1, tones.wet);
  b.add(c0, F.crestTop - 2, cap0, c1, F.crestTop - 1, cap0 + 1, tones.wet);
  for (let x = c0 + 3 + Math.floor(hash(seed, 14) * 4), k = 0; x < c1 - 2; k++) {
    const len = 5 + Math.floor(hash(seed, k, 15) * 5);
    if (hash(seed, k, 16) > 0.75) b.add(x - len + 1, F.crestTop - 1, cap0, x, F.crestTop, cap1, tones.band);
    // The dip has worn its own joints away; none is cut beside it either, so its edges stay one clean step.
    if (x < F.dip[0] - 1 || x > F.dip[1]) b.add(x, F.crestTop - 1, cap0, x + 1, F.crestTop, cap1, MAT.air);
    x += len;
  }
  // Slack water in the corners lets weed take the capping's downstream half.
  for (const [x0, x1] of [[c0, c0 + 3], [c1 - 4, c1]] as const) b.add(x0, F.crestTop - 1, cap0 + 5, x1, F.crestTop, cap1, MAT.moss);
  b.add(F.dip[0], F.crestTop - 1, cap0, F.dip[1], F.crestTop, cap1, MAT.air);

  // --- Steps ---------------------------------------------------------------------------------------------------
  // Each step is a row of big stones; their head joints are cut into the riser and the tread, and the risers,
  // which the falling sheet always wets, take the wet tone.
  F.steps.forEach((top, k) => {
    const z0 = body1 + k * WEIR.tread, z1 = z0 + WEIR.tread, below = F.steps[k + 1] ?? 1;
    b.add(c0, 0, z0, c1, top, z1, stone);
    b.add(c0, below, z1 - 1, c1, top, z1, tones.wet);
    for (let x = c0 + 1 + Math.floor(hash(seed, k, 17) * 5), s = 0; x < c1 - 2; s++) {
      const len = 5 + Math.floor(hash(seed, k, s, 18) * 5), r = hash(seed, k, s, 19);
      if (r > 0.8) b.add(Math.max(c0, x - len + 1), top - 1, z0, x, top, z1 - 1, tones.band);
      b.add(x, below, z1 - 1, x + 1, top, z1, MAT.air);
      b.add(x, top - 1, z0, x + 1, top, z1 - 1, MAT.air);
      x += len;
    }
    for (const [x0, x1] of [[c0, c0 + 2 + (k % 2)], [c1 - 3 + (k % 2), c1]] as const) b.add(x0, top - 1, z0, x1, top, z1 - 1, MAT.moss);
  });

  // --- Apron and scour stones ----------------------------------------------------------------------------------
  // Flags laid in rows on a wet bed course; the bed course shows as the joints, a few flags stand proud and the
  // last row runs out ragged into the stream bed.
  b.add(c0, 0, F.toe, c1, 1, WEIR.apronEnd, tones.wet);
  for (let z = F.toe, row = 0; z < WEIR.apronEnd; row++) {
    const len = 3 + Math.floor(hash(seed, row, 20) * 3), z1 = Math.min(z + len, WEIR.apronEnd), last = z1 === WEIR.apronEnd;
    for (let x = c0 - Math.floor(hash(seed, row, 21) * 4), s = 0; x < c1; s++) {
      const w = 4 + Math.floor(hash(seed, row, s, 22) * 5), r = hash(seed, row, s, 23), [a, c] = [Math.max(x, c0), Math.min(x + w - 1, c1)];
      const tail = last ? Math.floor(hash(seed, row, s, 24) * 4) : 0;
      if (c > a) {
        b.add(a, 0, z, c, 1, z1 - 1 + tail, r > 0.86 ? tones.band : stone);
        if (r < 0.14 && !last) b.add(a + 1, 1, z + 1, c - 1, 2, z1 - 2, stone);
      }
      x += w;
    }
    z = z1;
  }
  const boulders = [
    { cx: c0 + width * 0.31, cz: 37.5, rx: 3.6, rz: 2.8, top: F.downstream + 1, mossy: true },
    { cx: c0 + width * 0.71, cz: 34.5, rx: 2.8, rz: 2.4, top: F.downstream, mossy: false },
  ];
  for (const s of boulders) {
    for (let y = 0; y < s.top; y++) {
      const shrink = y < s.top - 1 ? 1 - 0.06 * y : 0.68;
      const ring = { cx: s.cx, cz: s.cz, rx: s.rx * shrink, rz: s.rz * shrink, power: 2.4 };
      disc(b, F.size, ring, y, y + 1, y < F.downstream ? tones.wet : stone);
    }
    if (s.mossy) disc(b, F.size, { cx: s.cx - 0.6, cz: s.cz - 0.4, rx: s.rx * 0.5, rz: s.rz * 0.5 }, s.top - 1, s.top, MAT.moss);
  }

  const blueprint = millBlueprint(`water-${style}-weir-${width}-${drop}`, style, 'civic', [W, H, D], b);
  const mid = (c0 + c1) / 2, voices = Math.ceil(width / 48);
  const sounds: SoundAnchor[] = Array.from({ length: voices }, (_, i) => ({
    id: voices > 1 ? `weir-${i}` : 'weir', kind: 'weir',
    position: [c0 + ((i + 0.5) * width) / voices, F.downstream, (cap1 + F.toe) / 2],
  }));
  return {
    ...NO_METADATA, blueprint,
    footings: [
      { id: 'wing-west', box: { from: [0, 0, 0], to: [c0, 1, D] } },
      { id: 'wing-east', box: { from: [c1, 0, 0], to: [W, 1, D] } },
      { id: 'crest', box: { from: [c0, 0, 0], to: [c1, 1, F.toe] } },
      { id: 'apron', box: { from: [c0, 0, F.toe], to: [c1, 1, WEIR.apronEnd] } },
    ],
    mounts: [{ id: 'crest', position: [mid, F.crestTop, cap1], axis: [0, 0, 1] }],
    sounds,
    clear: [{ id: 'spillway', role: 'spillway', box: { from: [c0, F.crestTop, 0], to: [c1, F.upstream + 2, D] } }],
  };
}
