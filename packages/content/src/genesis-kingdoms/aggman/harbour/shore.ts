import { MAT } from '../../../materials';
import type { AggmanPiece, Livery } from '../piece';
import { CREEL, layBarrel, layBasket, layCoil, layCreel, setPut, IRON, NET } from './gear';
import { Grid, noise, round, strokeCells } from './grid';

/** Lays a 2D stroke (u = z, v = y) as a timber member `thick` cells deep in x from x0. */
function member(g: Grid, x0: number, thick: number, a: readonly [number, number], b: readonly [number, number], material: number): void {
  for (const [, y, z] of strokeCells([0.5, a[1], a[0]], [0.5, b[1], b[0]], 0.72)) {
    if (y < 0 || y >= g.sy) continue;
    for (let x = x0; x < x0 + thick; x++) g.set(x, y, z, material);
  }
}

/**
 * Nets hung to dry: two timber A-frames, their legs crossed at the top into a crotch, a pole laid across them and
 * the nets thrown over it, hanging to both sides in folds. The mesh is real: tanned twine with holes the back
 * sheet shows through. The front sheet's foot is the cork line, floats in the livery's gold and cream; the back
 * sheet's foot is the lead line. A heap of net waits on the ground in front. ~4.25 m long along X; front is +Z.
 */
export const NET_RACK = { size: [34, 21, 18] as const, pole: { y: [17, 19] as const, z: [7, 9] as const }, nets: [5, 29] as const } as const;

export function createNetRack(livery: Livery): AggmanPiece {
  const [SX, SY, SZ] = NET_RACK.size, g = new Grid(SX, SY, SZ);
  const [py0, py1] = NET_RACK.pole.y, [pz0, pz1] = NET_RACK.pole.z;
  // The A-frames: legs from splayed feet crossing above the pole, a collar tie, and a darker foot where the
  // ground has wet them.
  for (const x0 of [2, 30]) {
    member(g, x0, 2, [1.5, 0.5], [9.8, 20.5], MAT.timber);
    member(g, x0, 2, [15.5, 0.5], [6.2, 20.5], MAT.timber);
    g.box(x0, 6, 4, x0 + 2, 7, 13, MAT.timber);
    for (let z = 0; z < SZ; z++) for (let x = x0; x < x0 + 2; x++) if (g.get(x, 0, z)) g.set(x, 0, z, MAT.bark);
  }
  g.box(0, py0, pz0, SX, py1, pz1, MAT.timber);
  g.box(0, py0, pz0, 1, py1, pz1, MAT.bark);
  g.box(SX - 1, py0, pz0, SX, py1, pz1, MAT.bark);

  // The drape: a sheet each side of the pole, tight over it and swinging out in folds lower down.
  const [n0, n1] = NET_RACK.nets;
  const foot = (x: number) => 3 + round(1.2 * Math.sin(x * 0.55) + noise(x, 9) * 1.4);
  const fold = (x: number, y: number, side: number) => {
    const slack = Math.max(0, Math.min(1, (py1 - y) / 13));
    return round(slack * (1.3 + 1.2 * Math.sin(x * 0.8 + side * 1.9)));
  };
  for (let x = n0; x < n1; x++) for (let z = pz0; z < pz1; z++) g.set(x, py1, z, NET);
  for (const side of [1, -1]) {
    const face = side > 0 ? pz1 : pz0 - 1;
    for (let x = n0; x < n1; x++) for (let y = foot(x); y < py1 + 1; y++) {
      const o = fold(x, y, side);
      let lo = o, hi = o;
      for (const [nx, ny] of [[x - 1, y], [x, y - 1]] as const) if (nx >= n0 && ny >= foot(nx)) { const n = fold(nx, ny, side); lo = Math.min(lo, n); hi = Math.max(hi, n); }
      const steady = lo === hi && [[x + 1, y], [x, y + 1]].every(([nx, ny]) => nx! < n1 && fold(nx!, ny!, side) === o);
      const hole = steady && x % 2 === 1 && y % 2 === 1 && y > foot(x) && y < py1 - 1;
      if (hole) continue;
      for (let k = lo; k <= hi; k++) g.set(x, y, face + side * k, NET);
    }
    // The foot of each sheet: cork floats in front, the lead line behind.
    for (let x = n0; x < n1; x++) {
      const y = foot(x), z = face + side * fold(x, y, side);
      if (side > 0 && (x - n0) % 4 < 2) {
        const float = Math.floor((x - n0) / 4) % 2 ? livery.cream : livery.gold;
        g.set(x, y, z + 1, float);
        g.set(x, y + 1, z + 1, float);
      } else if (side < 0) g.set(x, y, z, IRON);
    }
  }
  // A heap of net on the ground in front, a few floats showing in it.
  for (let x = 9; x < 22; x++) for (let z = 13; z < SZ; z++) {
    const d = ((x - 15.5) / 6.5) ** 2 + ((z - 15.5) / 2.6) ** 2;
    if (d > 1) continue;
    const h = d < 0.3 ? 3 : d < 0.7 ? 2 : 1;
    for (let y = 0; y < h; y++) g.set(x, y, z, (x + y + z) % 3 === 0 ? IRON : NET);
    if (h === 3 && noise(x, z, 4) < 0.35) g.set(x, h, z, noise(x, z, 5) < 0.5 ? livery.gold : livery.cream);
  }
  return { blueprint: g.blueprint('genesis-aggman-net-rack'), lanterns: [], footprint: g.groundFootprint() };
}

export type PotStackVariant = 0 | 1;

/**
 * Lobster pots stacked on the quay between trips, each sitting on the crowns of the pots below a cell off true,
 * with a dan buoy beside them: a pole through a livery-gold float, a flag in the livery red at its head, and its
 * line coiled at the foot.
 *
 * - 0: a pyramid, three, two and one turned crossways on top.
 * - 1: a column four high, leaning a hand's breadth as it climbs, with one more set down beside it.
 */
export function createPotStack(livery: Livery, variant: PotStackVariant): AggmanPiece {
  if (variant !== 0 && variant !== 1) throw new RangeError(`pot stack: variant must be 0 or 1, not ${String(variant)}.`);
  const H = CREEL.height;
  const g = new Grid(variant === 0 ? 34 : 26, 21, 16), put = setPut(g);
  let pole: readonly [number, number];
  if (variant === 0) {
    for (let i = 0; i < 3; i++) layCreel(put, i * 7, 0, 2, 'x', i === 1);
    for (let i = 0; i < 2; i++) layCreel(put, 3 + i * 8, H, 2 + i, 'x', i === 0);
    layCreel(put, 8, 2 * H, 1, 'z', true);
    pole = [25, 5];
  } else {
    [0, 1, 1, 2].forEach((shift, level) => layCreel(put, shift, level * H, 2 + (level === 2 ? 1 : 0), 'x', level % 2 === 1));
    layCreel(put, 10, 0, 1, 'z', false);
    pole = [18, 6];
  }
  // The dan buoy: a pole standing on its weighted foot, the float a third of the way up, the flag at its head.
  const [px, pz] = pole;
  g.box(px - 1, 0, pz - 1, px + 2, 1, pz + 2, IRON);
  g.box(px, 1, pz, px + 1, 20, pz + 1, MAT.timber);
  for (let y = 4; y < 8; y++) for (let x = px - 1; x < px + 2; x++) for (let z = pz - 1; z < pz + 2; z++) {
    if ((y === 4 || y === 7) && x !== px && z !== pz) continue;
    if (x === px && z === pz) continue;
    g.set(x, y, z, y === 4 || y === 7 ? MAT.bark : livery.gold);
  }
  for (let x = px + 1; x < px + 7; x++) {
    const z = pz + (x - px > 3 ? 1 : 0), droop = x - px > 4 ? 1 : 0;
    for (let y = 15 - droop; y < 19 - (x === px + 6 ? 1 : 0); y++) {
      g.set(x, y, z, livery.red);
      if (x - px === 4) g.set(x, y, pz, livery.red);
    }
  }
  g.set(px, 20, pz, IRON);
  layCoil(put, px + 3.5, 0, pz + 6.5, 2.6, 2);
  return { blueprint: g.blueprint(`genesis-aggman-pot-stack-${variant}`), lanterns: [], footprint: g.groundFootprint() };
}

/**
 * A fish crate: a slatted box with corner posts of darker end grain, a gap between its two slats where the catch
 * shows, and the owner's mark on its front. `painted` crates wear the livery blue; the rest are bare boards.
 */
function crate(g: Grid, x0: number, y0: number, z0: number, painted: number | undefined, mark: number, full: boolean, seed: number): void {
  const W = 7, D = 5, board = painted ?? MAT.timber;
  for (let y = 0; y < 3; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const wall = x === 0 || z === 0 || x === W - 1 || z === D - 1;
    const post = (x === 0 || x === W - 1) && (z === 0 || z === D - 1);
    let m: number;
    if (y === 0) m = post ? MAT.bark : board;
    else if (post) m = MAT.bark;
    else if (wall) m = y === 1 ? IRON : board;
    else if (!full) continue;
    else m = y === 2 ? (noise(seed, x, z) < 0.5 ? MAT.stone : MAT.limestone) : MAT.stone;
    g.set(x0 + x, y0 + y, z0 + z, m);
  }
  if (full) g.set(x0 + 2 + (seed % 3), y0 + 3, z0 + 2, MAT.cream);
  g.set(x0 + 3, y0 + 2, z0 + D - 1, mark);
}

/**
 * The catch landed on the quay: fish crates stacked three and two high with one open on the ground, two barrels
 * (the tall one open and heaped with salt), a wicker basket of fish and a coil of rope. Front is +Z.
 */
export function createFishCrates(livery: Livery): AggmanPiece {
  const g = new Grid(30, 12, 18), put = setPut(g);
  crate(g, 0, 0, 0, livery.blue, livery.cream, false, 1);
  crate(g, 0, 3, 0, undefined, livery.red, false, 2);
  crate(g, 1, 6, 1, livery.blue, livery.cream, true, 3);
  crate(g, 7, 0, 1, undefined, livery.red, true, 4);
  crate(g, 7, 3, 0, livery.blue, livery.cream, false, 5);
  crate(g, 2, 0, 7, undefined, livery.red, true, 6);
  layBarrel(put, 16, 0, 2, 8, 3, 0);
  layBarrel(put, 24, 0, 5, 6, 2, 1);
  // The tall barrel stands open, heaped with salt for the catch.
  for (let x = 16; x < 22; x++) for (let z = 2; z < 8; z++) if (g.get(x, 7, z) === MAT.bark) g.set(x, 7, z, MAT.cream);
  layBasket(put, 15, 0, 11, MAT.stone);
  layCoil(put, 25.5, 0, 13.5, 2.6, 1);
  return { blueprint: g.blueprint('genesis-aggman-fish-crates'), lanterns: [], footprint: g.groundFootprint() };
}

