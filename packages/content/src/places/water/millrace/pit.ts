import type { Vec3 } from '@chatdom/shared';
import { Boxes } from '../../../civic/kit';
import { MAT, STYLES, type StyleKey } from '../../../materials';
import { NO_METADATA, type CellBox, type Footing, type WaterPiece } from '../place-piece';
import { hash } from '../shore/shape';
import { COURSE, IRON, checkStyle, checkWhole, coursed, masonry, millBlueprint, runs, stroke, wood } from './craft';
import { WHEEL } from './wheel';

/**
 * The wheel pit and its launder, in one frame. The trough's upstream end, where the supplied earth leat meets it,
 * is z = 0; the stone pit follows `run` cells downstream of it. Inside the pit's own 48-cell length the wheel
 * sits at [6, 2, 4], so its hub is the corner (16, 22, 24) and its journals rest on the two bearing blocks.
 * y = 0 is the pit floor, which is the tailrace bed. Everything below is in the piece frame unless named `pit`.
 */
export const WHEEL_PIT = {
  /** Across the stream (x) and along it (z) for the stone pit alone, and the piece's height. */
  width: 32,
  length: 48,
  height: 49,
  /** The side walls' half-open x spans; both run the full pit length from y 0 to the coping top. */
  walls: [[0, 6], [26, 32]] as const,
  wallTop: 25,
  copingTop: 27,
  /** The headwall closing the pit's upstream end, as a pit-local z span. */
  headwall: [0, 3] as const,
  /** Where the wheel's (0,0,0) corner sits in pit-local cells, and so its hub corner. */
  wheelInPit: [6, 2, 4] as const,
  hubInPit: [16, 22, 24] as const,
  /** The launder: inner channel x span, the top of its floor, and how far its lip stands past the hub. */
  channel: [12, 20] as const,
  troughFloor: 45,
  troughWalls: 3,
  lipPastHub: 3,
  /** Upstream trough run, in cells beyond the pit. */
  run: [16, 160] as const,
  /** Raised trestle feet: foundation height above the pit floor, in cells. */
  foot: [0, 36] as const,
  /** Trestles stand at most this far apart along the run. */
  spacing: 16,
} as const;

/** How many upstream trestles (and so `feet` entries) a run needs: never more than 2 m apart. */
export function wheelPitTrestles(run: number): number {
  checkWhole('wheel pit', 'run', run, ...WHEEL_PIT.run);
  return Math.ceil(run / WHEEL_PIT.spacing);
}

/** The frame for one run: every point a neighbour joins to, in the piece frame. */
export interface WheelPitFrame {
  readonly size: Vec3;
  /** Where the pit's own z = 0 lies in the piece. */
  readonly pitStart: number;
  /** Where the wheel blueprint's (0,0,0) corner is placed. */
  readonly wheelOffset: Vec3;
  /** The axle centre: a cell corner. */
  readonly hub: Vec3;
  /** Top of the trough floor, the water's bed all the way from the leat to the lip. */
  readonly troughFloor: number;
  /** Centre of the lip edge, where the water leaves the trough. */
  readonly lip: Vec3;
  /** Centre of the upstream end at floor height, where the earth leat's bed must arrive. */
  readonly leatEnd: Vec3;
  /** Upstream trestle centres along z, ordered from the pit outward (matching `feet`). */
  readonly trestles: readonly number[];
}

export function wheelPitFrame(run: number): WheelPitFrame {
  const n = wheelPitTrestles(run), P = WHEEL_PIT, mid = (P.channel[0] + P.channel[1]) / 2;
  const hub: Vec3 = [P.hubInPit[0], P.hubInPit[1], run + P.hubInPit[2]];
  return {
    size: [P.width, P.height, run + P.length],
    pitStart: run,
    wheelOffset: [P.wheelInPit[0], P.wheelInPit[1], run + P.wheelInPit[2]],
    hub,
    troughFloor: P.troughFloor,
    lip: [mid, P.troughFloor, hub[2] + P.lipPastHub],
    leatEnd: [mid, P.troughFloor, 0],
    trestles: Array.from({ length: n }, (_, i) => Math.round(run - ((i + 1) * run) / n) + 1),
  };
}

/** Raised feet: whole cells, one per upstream trestle, each within the foot range. */
function checkFeet(run: number, feet: readonly number[]): void {
  const n = wheelPitTrestles(run);
  if (feet.length !== n) throw new RangeError(`wheel pit: a ${run}-cell run stands on ${n} trestles, not ${feet.length} feet.`);
  feet.forEach((h, i) => checkWhole('wheel pit', `foot ${i}`, h, ...WHEEL_PIT.foot));
}

/**
 * The static housing of the overshot wheel for the `mill:wheel` site: two coursed stone side walls and a headwall
 * round a flagged floor that is the tailrace bed; stone corbels carrying iron plummer blocks with brass cheeks
 * under the journals; and the timber launder, a planked U channel on frames, carried from the earth leat on
 * splayed trestles (raised feet on supplied ground), across the headwall and over the pit on a wall-to-wall
 * trestle, ending at a lip just past top dead centre. Its floor never steps, so the water never does.
 */
export function createWheelPit(style: StyleKey, run: number, feet: readonly number[]): WaterPiece {
  checkStyle('wheel pit', style);
  checkFeet(run, feet);
  const P = WHEEL_PIT, F = wheelPitFrame(run), b = new Boxes(), [W, H, D] = F.size, z0 = F.pitStart;
  const tones = masonry(style), timber = wood(style), stone = STYLES[style].stone, seed = run * 7 + 3;
  const [[wx0, wx1], [ex0, ex1]] = P.walls, [hz0, hz1] = [z0 + P.headwall[0], z0 + P.headwall[1]];
  const mossy = style === 'hearth' ? 9 : style === 'tide' ? 7 : 13;

  // --- The pit ---------------------------------------------------------------------------------------------------
  // The floor: wet flags across the bed between the walls, an odd dry or banded flag among them.
  b.add(wx1, 0, z0, ex0, 1, z0 + P.length, tones.wet);
  for (let z = z0, s = 0; z < z0 + P.length; s++) {
    const len = 3 + Math.floor(hash(seed, s, 11) * 4);
    for (let x = wx1, t = 0; x < ex0; t++) {
      const w = 4 + Math.floor(hash(seed, s, t, 12) * 4), r = hash(seed, s, t, 13);
      if (r > 0.55) b.add(x, 0, z, Math.min(x + w, ex0), 1, Math.min(z + len, z0 + P.length), r > 0.85 ? tones.band : stone);
      x += w;
    }
    z += len;
  }
  // Side walls and the headwall, solid, then every exposed face laid in courses.
  for (const [x0, x1] of P.walls) b.add(x0, 0, z0, x1, P.wallTop, z0 + P.length, stone);
  b.add(wx1, 0, hz0, ex0, P.wallTop, hz1, stone);
  const faces = [
    { normal: 'x', layer: wx1 - 1, span: [hz1, z0 + P.length], wetTo: 4, mossTo: mossy },
    { normal: 'x', layer: ex0, span: [hz1, z0 + P.length], wetTo: 4, mossTo: mossy },
    { normal: 'x', layer: wx0, span: [z0, z0 + P.length] },
    { normal: 'x', layer: ex1 - 1, span: [z0, z0 + P.length] },
    { normal: 'z', layer: hz1 - 1, span: [wx1, ex0], wetTo: 4, mossTo: mossy },
    { normal: 'z', layer: z0, span: [0, W] },
    { normal: 'z', layer: z0 + P.length - 1, span: [wx0, wx1], wetTo: 4 },
    { normal: 'z', layer: z0 + P.length - 1, span: [ex0, ex1], wetTo: 4 },
  ] as const;
  faces.forEach((f, i) => coursed(b, { ...f, y: [0, P.wallTop], seed: seed + 31 * i }, tones));
  // Copings: slabs of uneven length with a drip edge one cell into the pit, their joints cut into the top.
  const coping = (x0: number, x1: number, za: number, zb: number, s: number) => {
    b.add(x0, P.wallTop, za, x1, P.copingTop, zb, stone);
    for (let z = za + 2 + Math.floor(hash(seed, s, 21) * 4), k = 0; z < zb - 2; k++) {
      if (hash(seed, s, k, 22) > 0.7) b.add(x0, P.wallTop, Math.max(za, z - 5), x1, P.copingTop, z, tones.band);
      b.add(x0, P.copingTop - 1, z, x1, P.copingTop, z + 1, MAT.air);
      z += 5 + Math.floor(hash(seed, s, k, 23) * 5);
    }
  };
  coping(wx0, wx1 + 1, z0, z0 + P.length, 1);
  coping(ex0 - 1, ex1, z0, z0 + P.length, 2);
  b.add(wx1, P.wallTop, hz0, ex0, P.copingTop, hz1, stone);
  for (const x of [8, 16, 23]) b.add(x, P.copingTop - 1, hz0, x + 1, P.copingTop, hz1, MAT.air);
  // Moss creeping over the coping's shaded inner edge and down from it in a few places.
  // It keeps off the bearings, which the miller greases.
  const bearing = [z0 + P.hubInPit[2] - 6, z0 + P.hubInPit[2] + 6] as const;
  for (let k = 0; k < 6; k++) {
    const z = z0 + 6 + Math.floor(hash(seed, k, 41) * (P.length - 12)), len = 2 + Math.floor(hash(seed, k, 42) * 4);
    if (z + len > bearing[0] && z < bearing[1]) continue;
    const [x0, x1] = k % 2 ? [ex0 - 1, ex0] : [wx1, wx1 + 1];
    b.add(x0, P.wallTop - 1 - (k % 3), z, x1, P.copingTop, z + len, MAT.moss);
  }

  // Bearings: a stepped stone corbel out of each side wall, an iron plummer block on it, brass cheeks either side
  // of the journal and an iron cap over it. The journal's lowest layer rests directly on the block.
  const hubPit = F.hub, journalY = P.wheelInPit[1] + WHEEL.hub[0] - 1, jz = hubPit[2] - 1;
  for (const [x0, x1] of WHEEL.journals.map(([a, c]) => [a + P.wheelInPit[0], c + P.wheelInPit[0]] as const)) {
    const out = x0 < W / 2 ? (lo: number, hi: number) => [x0, x0 + hi - lo] as const : (lo: number, hi: number) => [x1 - (hi - lo), x1] as const;
    const [a1, b1] = out(0, 1), [a2, b2] = out(0, 2);
    b.add(a1, journalY - 9, jz - 3, b1, journalY - 6, jz + 5, stone);
    b.add(a2, journalY - 6, jz - 4, b2, journalY - 3, jz + 6, stone);
    b.add(a2, journalY - 6, jz - 4, b2, journalY - 5, jz + 6, tones.band);
    b.add(x0, journalY - 3, jz - 2, x1, journalY, jz + 4, IRON);
    b.add(x0, journalY, jz - 1, x1, journalY + 2, jz, MAT.brass);
    b.add(x0, journalY, jz + 2, x1, journalY + 2, jz + 3, MAT.brass);
    b.add(x0, journalY + 2, jz - 1, x1, journalY + 3, jz + 3, IRON);
    b.add(x0, journalY + 3, jz - 1, x1, journalY + 4, jz, MAT.brass);
    b.add(x0, journalY + 3, jz + 2, x1, journalY + 4, jz + 3, MAT.brass);
  }

  // --- The launder ----------------------------------------------------------------------------------------------
  const [c0, c1] = P.channel, fy = P.troughFloor - 1, top = P.troughFloor + P.troughWalls, lipZ = F.lip[2];
  b.add(c0 - 1, fy, 0, c1 + 1, fy + 1, lipZ, timber.plank);
  b.add(c0 - 1, fy + 1, 0, c0, top, lipZ, timber.plank);
  b.add(c1, fy + 1, 0, c1 + 1, top, lipZ, timber.plank);
  // Frames every metre: a bearer under the floor and a cleat up each side; every other one carries a spreader.
  for (let z = 3, k = 0; z < lipZ - 1; z += 8, k++) {
    b.add(c0 - 2, fy - 1, z, c1 + 2, fy, z + 1, timber.plank);
    b.pair(W, c0 - 2, fy, z, c0 - 1, top, z + 1, timber.plank);
    if (k % 2) b.add(c0 - 2, top, z, c1 + 2, top + 1, z + 1, timber.plank);
  }
  // Board ends: three-metre boards, butted beside a frame, show darker end grain right round the channel; a few of
  // the joints weep, darkening the side below them and growing a beard of moss under the floor.
  const joint = (z: number, weeps: boolean) => {
    b.add(c0 - 1, fy, z, c1 + 1, fy + 1, z + 1, timber.end);
    b.add(c0 - 1, fy + 1, z, c0, top, z + 1, timber.end);
    b.add(c1, fy + 1, z, c1 + 1, top, z + 1, timber.end);
    if (weeps) {
      b.add(c0 - 1, fy + 1, z - 1, c0, fy + 2, z + 2, MAT.moss);
      b.add(c0 + 2, fy - 1, z, c0 + 4, fy, z + 1, MAT.moss);
    }
  };
  for (let z = 20, k = 0; z < lipZ - 2; z += 24, k++) joint(z, hash(seed, k, 51) < 0.5 || k === 0);
  joint(0, false);
  joint(lipZ - 1, false);

  // Trestles. Over the pit: one on the headwall, one from wall to wall just upstream of the lip. Its header crosses
  // the wheel's swing one clear cell above the rim, so there it is a single beam; elsewhere it is two cells deep.
  const header = (x0: number, x1: number, z: number) => b.add(x0, fy - 2, z, x1, fy, z + 2, timber.plank);
  header(c0 - 4, c1 + 4, hz0);
  b.pair(W, c0 - 3, P.copingTop, hz0, c0 - 1, fy - 2, hz0 + 2, timber.plank);
  const tz = hubPit[2] - 4, [sw0, sw1] = [wx0 + 2, wx0 + 4], swing = P.wheelInPit[0] + WHEEL.hubSpan[0] - 1;
  b.add(sw0, fy - 2, tz, swing, fy, tz + 2, timber.plank);
  b.add(W - swing, fy - 2, tz, W - sw0, fy, tz + 2, timber.plank);
  b.add(swing, fy - 1, tz, W - swing, fy, tz + 2, timber.plank);
  b.pair(W, sw0, P.copingTop, tz, sw1, fy - 2, tz + 2, timber.plank);
  for (const flip of [false, true]) {
    const knee = stroke([sw1 + 0.2, fy - 8], [swing - 0.6, fy - 2.4]);
    runs(knee, (x0, x1, y) => b.add(flip ? W - x1 : x0, y, tz, flip ? W - x0 : x1, y + 1, tz + 2, timber.plank));
  }
  // Upstream: splayed post pairs under the header, each foot on a padstone at its supplied height.
  const footings: Footing[] = [];
  F.trestles.forEach((zc, i) => {
    const h = feet[i]!, z = Math.max(0, zc - 1), tall = fy - 2 - (h + 1), splay = Math.min(2, Math.floor(tall / 10));
    // Segment s (0 at the top) of a post spans postY(s)..postY(s - 1); its west edge is c0 - 3 - s.
    const postY = (s: number) => s < 0 ? fy - 2 : h + 1 + Math.round((tall * (splay - s)) / (splay + 1));
    const postX = (y: number) => { let s = 0; while (s < splay && y < postY(s)) s++; return c0 - 3 - s; };
    header(c0 - 4, c1 + 4, z);
    for (const flip of [false, true]) {
      const put = (x0: number, y0: number, x1: number, y1: number, za: number, zb: number, m: number) =>
        b.add(flip ? W - x1 : x0, y0, za, flip ? W - x0 : x1, y1, zb, m);
      // The post leans out a cell at each of its splay steps, overlapping a cell so it stays one timber.
      for (let s = 0; s <= splay; s++) put(c0 - 3 - s, postY(s), c0 - 1 - s, postY(s - 1), z, z + 2, timber.plank);
      // The padstone, a cell wider than the foot all round, and its footing.
      const [p0, p1] = [c0 - 4 - splay, c0 - splay];
      const pz0 = Math.max(0, z - 1), pz1 = z + 3;
      put(p0, h, p1, h + 1, pz0, pz1, stone);
      const box: CellBox = flip ? { from: [W - p1, h, pz0], to: [W - p0, h + 1, pz1] } : { from: [p0, h, pz0], to: [p1, h + 1, pz1] };
      footings.push({ id: `foot-${i}-${flip ? 'east' : 'west'}`, box });
    }
    // Bracing on the upstream face: one diagonal on a middling trestle, a saltire on a tall one.
    if (tall >= 10) {
      // Each brace runs from the inner cell of one post to the inner cell of the other, so both ends bear.
      const lo = h + 2, hi = fy - 3, bz = z > 0 ? z - 1 : z + 2;
      const [l, r] = [postX(lo) + 1.5, W - postX(hi) - 1.5], [l2, r2] = [W - postX(lo) - 1.5, postX(hi) + 1.5];
      const braces = tall >= 22 ? [[[l, lo], [r, hi]], [[l2, lo], [r2, hi]]] as const : [[[l, lo], [r, hi]]] as const;
      for (const [a, c] of braces) runs(stroke(a, c), (x0, x1, y) => b.add(x0, y, bz, x1, y + 1, bz + 1, timber.plank));
    }
  });

  const blueprint = millBlueprint(`water-${style}-wheel-pit-${run}-${feet.join('.')}`, style, 'civic', [W, H, D], b);
  const mid = F.lip[0];
  return {
    ...NO_METADATA, blueprint,
    footings: [
      { id: 'wall-west', box: { from: [wx0, 0, z0], to: [wx1, 1, z0 + P.length] } },
      { id: 'wall-east', box: { from: [ex0, 0, z0], to: [ex1, 1, z0 + P.length] } },
      { id: 'pit-floor', box: { from: [wx1, 0, z0], to: [ex0, 1, z0 + P.length] } },
      ...footings,
    ],
    mounts: [
      { id: 'axle', position: F.hub, axis: [1, 0, 0] },
      { id: 'lip', position: F.lip, axis: [0, 0, 1] },
      { id: 'leat-end', position: F.leatEnd, axis: [0, 0, 1] },
    ],
    sounds: [
      { id: 'trough', kind: 'trough', position: [mid, P.troughFloor + 1, Math.round(lipZ / 2)] },
      { id: 'wheel', kind: 'wheel', position: F.hub },
    ],
    clear: [
      { id: 'wheel-pit', role: 'wheel-pit', box: wheelSwing(F) },
      { id: 'tailrace', role: 'tailrace', box: { from: [wx1, 1, hz1], to: [ex0, 1 + COURSE + 1, z0 + P.length] } },
      { id: 'spillway', role: 'spillway', box: { from: [c0, P.troughFloor, 0], to: [c1, top, lipZ] } },
    ],
  };
}

/** The wheel's swing (hub and shrouds, without the axle ends) with one clear cell all round. */
function wheelSwing(F: WheelPitFrame): CellBox {
  const [ox, oy, oz] = F.wheelOffset;
  return {
    from: [ox + WHEEL.hubSpan[0] - 1, oy - 1, oz - 1],
    to: [ox + WHEEL.hubSpan[1] + 1, oy + WHEEL.size[1] + 1, oz + WHEEL.size[2] + 1],
  };
}
