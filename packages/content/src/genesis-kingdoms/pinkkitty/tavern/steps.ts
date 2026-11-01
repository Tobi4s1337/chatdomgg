import { StyleIdSchema, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '../../../materials';
import { Boxes, hash } from '../../../genesis-landmarks/kit';
import { LANTERN_AND_OAR } from './index';

/**
 * The Lantern and Oar's levee steps. PinkKittyRose's river runs on its own levee, so the inn's floor stands on the
 * crest and the town's meadow lies a few metres below its front. The steps are the inn's answer, as a levee house
 * builds them: a paved stone terrace across the whole front at the floor's level, retained by a coursed wall with a
 * parapet; a square landing straight out from the porch through a gap in the parapet; and a flight that turns and
 * runs down alongside the terrace wall to a flagged foot on the meadow. Newel piers carry caged lanterns at the
 * landing's outer corners and at the foot, and roses trail along the parapet.
 *
 * Everything is measured in the inn's own frame (`LANTERN_AND_OAR`): X across the front, Z from the river (−Z) to
 * the street (+Z), the floor at y = GROUND. The piece's origin sits at `offset` in that frame, so a host places it
 * with the inn's own placement. All of it is solid masonry founded a metre under the foot.
 */

const T = LANTERN_AND_OAR;
const G = T.ground;
/** The door's centre along X, the axis the landing is laid on. */
const DOOR = (T.door.x[0] + T.door.x[1]) / 2;

export const TAVERN_STEPS = {
  /** The terrace runs from the front of the jetty's flagged apron out to its retaining wall's face. */
  terrace: { x: [11, T.yard.x[1]] as const, z: [T.jettyFront + 1, 144] as const },
  /** The parapet along the terrace's outer edge, and the gap in it onto the landing. */
  parapet: { thick: 3, high: 7, gap: 8 },
  /** The landing's half width along X, centred on the door, and the flight's width out from the terrace wall. */
  landingHalf: 10,
  flight: 16,
  riser: 2,
  tread: 4,
  /** The flagged foot beyond the lowest tread. */
  foot: 8,
  pier: 4,
  /** Rise limits, cells: two risers at least, the full levee at most. */
  rise: { min: 8, max: 48 },
} as const;
const S = TAVERN_STEPS;

export interface TavernStepsOptions {
  /** Floor above the foot's ground, cells: even, 8–48. */
  readonly riseCells: number;
  /** Which way along the front the flight runs down: −1 toward the inn's −X end, +1 toward its +X end. */
  readonly toward: -1 | 1;
}

export interface TavernSteps {
  readonly blueprint: VoxelBlueprint;
  readonly size: Vec3;
  /** The piece's origin in the inn's frame, cells. */
  readonly offset: Vec3;
  /** In the inn's frame, cells: the middle of the foot's outer edge, on the foot's ground. */
  readonly foot: Vec3;
  /** In the inn's frame, cells: the ground the piece covers, [x0, z0, x1, z1]. */
  readonly footprint: readonly [number, number, number, number];
  /** Flame bases of the pier lanterns, in the inn's frame, cells. */
  readonly fires: readonly Vec3[];
}

/** The run along X of the flight and its foot for a rise, cells; what a host needs before it builds the piece. */
export function tavernStepsReach(riseCells: number): number {
  return S.landingHalf + (riseCells / S.riser) * S.tread + S.foot;
}

/** The ground the steps would cover, in the inn's frame (cells), and the foot point, before building them. */
export function tavernStepsPlan(options: TavernStepsOptions): { readonly footprint: readonly [number, number, number, number]; readonly foot: Vec3 } {
  check(options);
  const { riseCells: rise, toward } = options, reach = tavernStepsReach(rise);
  const z0 = 87, z1 = S.terrace.z[1] + S.flight + S.parapet.thick;
  const end = DOOR + toward * reach;
  const x0 = Math.min(S.terrace.x[0], end, DOOR - S.landingHalf), x1 = Math.max(S.terrace.x[1], end, DOOR + S.landingHalf);
  return { footprint: [x0, z0, x1, z1], foot: [end, G - rise, S.terrace.z[1] + S.flight / 2] };
}

function check(options: TavernStepsOptions): void {
  const r = options.riseCells;
  if (!Number.isInteger(r) || r % 2 || r < S.rise.min || r > S.rise.max) throw new Error(`riseCells must be an even integer in ${S.rise.min}–${S.rise.max}, not ${r}.`);
  if (options.toward !== 1 && options.toward !== -1) throw new Error('toward must be −1 or 1.');
}

/** A caged lantern on a pier cap at `y`, the tavern's own pattern. Returns the flame base. */
function lantern(b: Boxes, cx: number, y: number, cz: number): Vec3 {
  b.add(cx - 1, y, cz - 1, cx + 2, y + 1, cz + 2, MAT.darkStone);
  b.add(cx - 2, y + 1, cz - 2, cx + 3, y + 2, cz + 3, MAT.brass);
  b.add(cx - 2, y + 2, cz - 2, cx + 3, y + 7, cz + 3, MAT.glass);
  b.add(cx - 1, y + 2, cz - 1, cx + 2, y + 7, cz + 2, MAT.air);
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) b.add(cx + dx, y + 2, cz + dz, cx + dx + 1, y + 7, cz + dz + 1, MAT.darkStone);
  b.add(cx, y + 2, cz, cx + 1, y + 4, cz + 1, MAT.cream);
  b.add(cx - 2, y + 7, cz - 2, cx + 3, y + 8, cz + 3, MAT.brass);
  b.add(cx - 1, y + 8, cz - 1, cx + 2, y + 9, cz + 2, MAT.brass);
  b.add(cx, y + 9, cz, cx + 1, y + 10, cz + 1, MAT.darkStone);
  return [cx + 0.5, y + 4, cz + 0.5];
}

/** A square newel pier from `base` to `top`: grey plinth, limestone shaft with cream quoins, darkStone cap. */
function pier(b: Boxes, x0: number, z0: number, base: number, top: number): void {
  const s = S.pier, x1 = x0 + s, z1 = z0 + s;
  b.add(x0 - 1, base - 8, z0 - 1, x1 + 1, base + 2, z1 + 1, MAT.stone);
  b.add(x0, base, z0, x1, top - 1, z1, MAT.limestone);
  for (let y = base + 2, k = 0; y + 2 <= top - 1; y += 2, k++) {
    b.add(k % 2 ? x0 : x1 - 1, y, z0, k % 2 ? x0 + 1 : x1, y + 2, z1, MAT.cream);
  }
  b.add(x0 - 1, top - 1, z0 - 1, x1 + 1, top, z1 + 1, MAT.darkStone);
}

/** Rose clumps along a coping between x0 and x1 at `y`, a cell in from the face at z. */
function roses(b: Boxes, x0: number, x1: number, y: number, z0: number, z1: number, seed: number): void {
  for (let x = x0 + 2; x < x1 - 4; x += 7 + Math.floor(hash(x, y, seed, 57) * 6)) {
    const w = 3 + Math.floor(hash(x, 1, seed, 57) * 3);
    b.add(x, y, z0, x + w, y + 2, z1, MAT.leaf);
    b.add(x + 1, y + 2, z0, x + w - 1, y + 3, z1, MAT.leaf);
    b.add(x + Math.floor(w / 2), y + 2, z0, x + Math.floor(w / 2) + 1, y + 3, z1, MAT.petal);
    if (hash(x, 2, seed, 57) < 0.6) b.add(x, y + 1, z0, x + 1, y + 2, z1, MAT.petal);
    // A trailing stem down the wall's face.
    if (hash(x, 3, seed, 57) < 0.5) b.add(x + 1, y - 4, z1 - 1, x + 2, y, z1, MAT.leaf);
  }
}

/** Flag pattern on a paved top: mostly paving, the odd grey and limestone flag. */
function flags(b: Boxes, x0: number, x1: number, y: number, z0: number, z1: number, seed: number): void {
  for (let z = z0; z < z1; z += 4) {
    let x = x0 - Math.floor(hash(z, y, x0, seed) * 5);
    for (let i = 0; x < x1; i++) {
      const length = 4 + Math.floor(hash(z, i, y, seed + 1) * 5), pick = hash(z, i, y, seed + 2);
      const m = pick < 0.62 ? MAT.paving : pick < 0.85 ? MAT.stone : MAT.limestone;
      if (m !== MAT.paving) b.add(Math.max(x0, x), y, z, Math.min(x1, x + length), y + 1, Math.min(z1, z + 4), m);
      x += length;
    }
  }
}

/**
 * Ashlar on a wall face whose outer cells lie on the plane z (u along X): courses six cells high with their bed joints
 * raked back a cell, the perpends staggered course to course, and only the odd stone a shade off the limestone.
 */
function coursed(b: Boxes, x0: number, x1: number, y0: number, y1: number, z: number, seed: number): void {
  for (let y = y0, row = 0; y + 6 <= y1; y += 6, row++) {
    b.add(x0, y, z, x1, y + 1, z + 1, MAT.air);
    let x = x0 + (row % 2 ? 5 : 0) + Math.floor(hash(row, 0, seed, 71) * 4);
    while (x < x1 - 2) {
      const length = 9 + Math.floor(hash(x, row, seed, 71) * 6), pick = hash(x, row, seed, 72);
      if (x > x0) b.add(x, y + 1, z, x + 1, y + 6, z + 1, MAT.air);
      const end = Math.min(x1, x + length);
      if (pick < 0.1) b.add(x + 1, y + 1, z, end, y + 6, z + 1, MAT.stone);
      else if (pick < 0.2) b.add(x + 1, y + 1, z, end, y + 6, z + 1, MAT.cream);
      else if (pick < 0.24) b.add(x + 1, y + 1, z, Math.min(end, x + 3), y + 2, z + 1, MAT.moss);
      x += length;
    }
  }
}

/** Climbing roses hanging down a wall face from its coping at `top`, on the plane z (one cell proud of it). */
function trailing(b: Boxes, x0: number, x1: number, top: number, floor: number, z: number, seed: number): void {
  for (let x = x0 + 3; x < x1 - 3; x += 9 + Math.floor(hash(x, top, seed, 61) * 8)) {
    const fall = Math.min(top - floor - 2, 8 + Math.floor(hash(x, 1, seed, 61) * 18));
    if (fall < 4) continue;
    b.add(x, top - fall, z, x + 1, top, z + 1, MAT.leaf);
    b.add(x - 1, top - 4, z, x + 2, top, z + 1, MAT.leaf);
    for (let y = top - fall + 2; y < top - 1; y += 3 + Math.floor(hash(x, y, seed, 62) * 3)) {
      const side = hash(x, y, seed, 63) < 0.5 ? -1 : 1;
      b.add(x + side, y, z, x + side + 1, y + 1, z + 1, hash(x, y, seed, 64) < 0.45 ? MAT.petal : MAT.leaf);
    }
  }
}

/** The Lantern and Oar's levee steps for a rise and a direction. See `TAVERN_STEPS`. */
export function createTavernSteps(options: TavernStepsOptions): TavernSteps {
  check(options);
  const { riseCells: rise, toward } = options;
  const n = rise / S.riser, foot = G - rise, base = foot - 8;
  const [tx0, tx1] = S.terrace.x, [tz0, tz1] = S.terrace.z;
  const fz0 = tz1, fz1 = tz1 + S.flight, oz1 = fz1 + S.parapet.thick;
  const p = S.parapet, pTop = G + p.high;
  // Build in the inn's frame with the flight running to −X, mirroring across the door's axis for +X.
  const raw = new Boxes();
  const mx = (x0: number, x1: number): [number, number] => (toward < 0 ? [x0, x1] : [2 * DOOR - x1, 2 * DOOR - x0]);
  const add = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: number, mirror = true) => {
    const [a, c] = mirror ? mx(x0, x1) : [x0, x1];
    raw.add(a, y0, z0, c, y1, z1, m);
  };

  // ── The terrace ──
  // Solid to the floor, except under the porch and the cross-wing, which stand on their own footing: there only
  // the masonry below it is the terrace's.
  const PORCH = [T.porch.roof[0] - 2, T.porch.roof[1] + 2] as const;
  const under: [number, number, number][] = [[PORCH[0], PORCH[1], T.porch.front], [T.wing.x[0], T.wing.x[1], T.wing.front],
    [T.bay.x[0], T.bay.x[1], T.wing.front + T.bay.depth], [T.yard.x[0], T.yard.x[1], T.yard.z[1]]];
  raw.add(tx0, base, tz0, tx1, G, tz1, MAT.limestone);
  for (const [x0, x1, z1] of under) raw.add(x0, T.found, tz0, x1, G, z1, MAT.air);
  // Beside the west gable, from the stack to the front, the terrace runs back along the inn's flank.
  const flank = [tx0, T.body.x[0], 87] as const;
  raw.add(flank[0], base, flank[2], flank[1], G, tz0, MAT.limestone);
  raw.add(flank[0], G - 1, flank[2], flank[1], G, tz0, MAT.paving);
  raw.add(flank[0], G, flank[2], flank[0] + 1, pTop - 1, tz0, MAT.limestone);
  raw.add(flank[0] - 1, pTop - 1, flank[2], flank[0] + 1, pTop, tz0, MAT.darkStone);
  // Paving over the open parts, flagged, with a darkStone kerb along the apron's edge.
  const open = (draw: (x0: number, x1: number, z0: number) => void) => {
    // Strips of the terrace's top along X, each starting in front of the deepest thing that stands over it.
    const edges = [...new Set([tx0, tx1, ...under.flatMap(([x0, x1]) => [x0, x1])])].filter(x => x >= tx0 && x <= tx1).sort((a, c) => a - c);
    for (let i = 1; i < edges.length; i++) {
      const x0 = edges[i - 1]!, x1 = edges[i]!;
      draw(x0, x1, Math.max(tz0, ...under.filter(([a, c]) => a < x1 && c > x0).map(([, , z1]) => z1)));
    }
  };
  open((x0, x1, z0) => { raw.add(x0, G - 1, z0, x1, G, tz1 - p.thick, MAT.paving); flags(raw, x0, x1, G - 1, z0, tz1 - p.thick, 11 + x0); });
  // The retaining wall's face and its ends, coursed; a cream plinth course where the wall meets the ground.
  coursed(raw, tx0, tx1, base + 10, G - 2, tz1 - 1, 5);
  raw.add(tx0 - 1, base, tz0, tx0, base + 10, tz1 + 1, MAT.stone);
  raw.add(tx1, base, tz0, tx1 + 1, base + 10, tz1 + 1, MAT.stone);
  raw.add(tx0, base, tz1 - 1, tx1, base + 10, tz1 + 1, MAT.stone);
  // The parapet, with the gap onto the landing on the door's axis.
  raw.add(tx0, G, tz1 - p.thick, tx1, pTop - 1, tz1, MAT.limestone);
  raw.add(tx0 - 1, pTop - 1, tz1 - p.thick - 1, tx1 + 1, pTop, tz1 + 1, MAT.darkStone);
  for (const x of [tx0, tx1 - 1]) raw.add(x, G, tz0, x + 1, pTop - 1, tz1, MAT.limestone);
  for (const x of [tx0 - 1, tx1]) raw.add(x, pTop - 1, tz0, x + 1, pTop, tz1, MAT.darkStone);
  raw.add(DOOR - p.gap, G, tz1 - p.thick, DOOR + p.gap, pTop, tz1, MAT.air);
  raw.add(DOOR - p.gap, G - 1, tz1 - p.thick, DOOR + p.gap, G, tz1, MAT.paving);
  roses(raw, tx0, DOOR - p.gap - 1, pTop, tz1 - p.thick, tz1, 3);
  roses(raw, DOOR + p.gap + 1, tx1, pTop, tz1 - p.thick, tz1, 4);

  // ── The landing ── straight out of the gap, at the floor, a parapet on its outer side and its far end.
  const lx0 = DOOR - S.landingHalf, lx1 = DOOR + S.landingHalf;
  add(lx0, base, fz0, lx1, G, fz1, MAT.limestone);
  add(lx0, G - 1, fz0, lx1, G, fz1, MAT.paving);
  add(lx0, G - 1, fz0, lx1, G, fz0 + 1, MAT.darkStone);
  add(lx0, base, fz1, lx1 + 1, pTop - 1, oz1, MAT.limestone);
  add(lx1, base, fz0, lx1 + 1, pTop - 1, oz1, MAT.limestone);
  add(lx0 - 1, pTop - 1, fz1 - 1, lx1 + 2, pTop, oz1 + 1, MAT.darkStone);
  add(lx1, pTop - 1, fz0, lx1 + 2, pTop, oz1 + 1, MAT.darkStone);

  // ── The flight ── n treads of S.tread running away from the landing, each two cells lower, its lowest flush with
  // the foot; dark nosings; the outer parapet steps down with it, and beyond the terrace an inner one does too.
  const flightEnd = lx0 - n * S.tread;
  for (let k = 0; k < n; k++) {
    const x1 = lx0 - k * S.tread, x0 = x1 - S.tread, top = G - S.riser * (k + 1);
    add(x0, base, fz0, x1, top, fz1, MAT.limestone);
    add(x0, top - 1, fz0, x1, top, fz1, MAT.paving);
    add(x1 - 1, top - 1, fz0, x1, top, fz1, MAT.darkStone);
    const wallTop = top + p.high;
    add(x0, base, fz1, x1, wallTop - 1, oz1, MAT.limestone);
    add(x0, wallTop - 1, fz1, x1, wallTop, oz1, MAT.darkStone);
    // The terrace wall stands on the flight's inner side within the terrace; beyond it the flight needs its own.
    const [mx0, mx1] = mx(x0, x1);
    if (mx1 <= tx0 || mx0 >= tx1) {
      add(x0, base, fz0 - p.thick, x1, wallTop - 1, fz0, MAT.limestone);
      add(x0, wallTop - 1, fz0 - p.thick, x1, wallTop, fz0, MAT.darkStone);
    }
  }
  // Coursed stones on the outer parapet's face and the flight's outer wall.
  {
    const [a, c] = mx(flightEnd, lx1 + 1);
    for (let y = base + 9; y + 2 <= G; y += 2) {
      let x = a + Math.floor(hash(y, 1, 9, 71) * 6);
      while (x < c - 3) {
        const length = 3 + Math.floor(hash(x, y, 9, 71) * 5), pick = hash(x, y, 9, 72);
        // Only where the wall stands that high at this x.
        const k = toward < 0 ? Math.floor((lx0 - x) / S.tread) : Math.floor((x - (2 * DOOR - lx0)) / S.tread);
        const wall = k < 0 ? pTop : G - S.riser * (k + 1) + p.high;
        if (y + 2 <= wall - 1 && pick < 0.4) raw.add(x, y, oz1 - 1 + 1, Math.min(c, x + length), y + 2, oz1 + 1, pick < 0.3 ? MAT.stone : MAT.cream);
        x += length + 1;
      }
    }
  }
  // The flagged foot, flush with the meadow, kerbed in darkStone at its outer edge.
  add(flightEnd - S.foot, base, fz0 - p.thick, flightEnd, foot, oz1, MAT.limestone);
  add(flightEnd - S.foot, foot - 1, fz0 - p.thick, flightEnd, foot, oz1, MAT.paving);
  add(flightEnd - S.foot, foot - 1, fz0 - p.thick, flightEnd - S.foot + 1, foot, oz1, MAT.darkStone);

  // ── The wall's dressing ── where neither the landing nor the flight stands before it: pilasters every three
  // metres with darkStone caps under the parapet, and roses trailing from the parapet down the face.
  {
    const [busy0, busy1] = mx(flightEnd - S.foot - S.pier, lx1 + 2);
    const spans: [number, number][] = [[tx0, Math.min(tx1, busy0)], [Math.max(tx0, busy1), tx1]];
    const free = spans.filter(([a, c]) => c - a > 8);
    for (const [a, c] of free) {
      for (let x = a + 6; x + 4 <= c - 4; x += 24) {
        raw.add(x, base, tz1, x + 4, G - 3, tz1 + 2, MAT.limestone);
        raw.add(x - 1, base, tz1, x + 5, base + 10, tz1 + 3, MAT.stone);
        raw.add(x - 1, G - 3, tz1, x + 5, G - 2, tz1 + 3, MAT.darkStone);
        for (let y = base + 12; y + 2 <= G - 3; y += 6) raw.add(x, y, tz1 + 1, x + 4, y + 1, tz1 + 2, MAT.cream);
      }
      trailing(raw, a, c, pTop - 1, base + 10, tz1, 13 + a);
    }
  }

  // ── Piers and lanterns ── at the landing's outer corners and flanking the foot.
  const fires: Vec3[] = [];
  const pierAt = (x0: number, z0: number, ground: number, top: number) => {
    const [a] = mx(x0, x0 + S.pier);
    pier(raw, a, z0, ground, top);
    fires.push(lantern(raw, a + S.pier / 2 - 0.5 | 0, top, z0 + S.pier / 2 - 0.5 | 0));
  };
  pierAt(lx1 - S.pier + 1, oz1 - S.pier, G, pTop + 4);
  pierAt(flightEnd - S.pier, oz1 - S.pier, foot, foot + p.high + 6);
  pierAt(flightEnd - S.pier, fz0 - p.thick, foot, foot + p.high + 6);

  // Shift into the piece's own corner frame.
  let minX = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const box of raw.list) { minX = Math.min(minX, box.from[0]); maxX = Math.max(maxX, box.to[0]); maxY = Math.max(maxY, box.to[1]); maxZ = Math.max(maxZ, box.to[2]); }
  const offset: Vec3 = [minX - 1, base, 87];
  const size: Vec3 = [maxX - offset[0] + 1, maxY - offset[1], maxZ - offset[2] + 1];
  const boxes = raw.list.map(box => ({ from: [box.from[0] - offset[0], Math.max(0, box.from[1] - offset[1]), box.from[2] - offset[2]] as [number, number, number],
    to: [box.to[0] - offset[0], box.to[1] - offset[1], box.to[2] - offset[2]] as [number, number, number], material: box.material }));
  const blueprint: VoxelBlueprint = {
    version: 1, id: `genesis-pinkkitty-tavern-steps-${rise}-${toward < 0 ? 'w' : 'e'}`, styleId: StyleIdSchema.parse(STYLES.hearth.id),
    kind: 'civic', lattice: 'build', size: [...size], boxes, windows: [],
  };
  const [fx] = mx(flightEnd - S.foot, flightEnd);
  const plan = tavernStepsPlan(options);
  return { blueprint, size, offset, foot: [toward < 0 ? fx : fx + S.foot, foot, plan.foot[2]], footprint: plan.footprint, fires };
}
