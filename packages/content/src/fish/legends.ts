import { Sculpt, fishModel, type FishModel } from './model';
import { MAT } from '../materials';

/*
 * The four legends. Each is carved from smooth elliptical sections (rather than the commons' rounded slabs), then
 * given one silhouette idea nobody else in the set has: the sturgeon's armour rows, crown and shark tail; the
 * emperor's towering back, open lips and coin scales; the ray's wingspan; the char's hooked kype and frost.
 */

type Keys = readonly (readonly [number, number])[];

/** Smoothstep interpolation through authored keys, so profiles bend without kinks. */
function curve(keys: Keys): (z: number) => number {
  return z => {
    if (z <= keys[0]![0]) return keys[0]![1];
    for (let i = 1; i < keys.length; i++) {
      const [z1, v1] = keys[i]!, [z0, v0] = keys[i - 1]!;
      if (z <= z1) { const t = (z - z0) / (z1 - z0); return v0 + (v1 - v0) * t * t * (3 - 2 * t); }
    }
    return keys[keys.length - 1]![1];
  };
}

interface Profile { readonly bot: (z: number) => number; readonly top: (z: number) => number; readonly half: (z: number) => number }

/** Elliptical sections between `bot` and `top` (cell edges) with half-width `half`, centred on `cx`. */
function body(s: Sculpt, cx: number, z0: number, z1: number, p: Profile, material: number): void {
  for (let z = z0; z <= z1; z++) {
    const b = p.bot(z), t = p.top(z), hw = p.half(z), cy = (b + t) / 2, hh = (t - b) / 2;
    for (let y = 0; y < s.sy; y++) for (let x = 0; x < s.sx; x++) {
      const u = (x + 0.5 - cx) / hw, v = (y + 0.5 - cy) / hh;
      if (u * u + v * v <= 1) s.set(x, y, z, material);
    }
    s.set(Math.floor(cx), Math.floor(cy), z, material);
  }
}

/** Highest occupied cell in a column, or -1. */
function topY(s: Sculpt, x: number, z: number): number {
  for (let y = s.sy - 1; y >= 0; y--) if (s.get(x, y, z)) return y;
  return -1;
}
function bottomY(s: Sculpt, x: number, z: number): number {
  for (let y = 0; y < s.sy; y++) if (s.get(x, y, z)) return y;
  return -1;
}
/** Outermost occupied x on the fish's left (+X, dir 1) or right (dir -1), or -1. */
function edgeX(s: Sculpt, y: number, z: number, dir: 1 | -1): number {
  if (dir > 0) { for (let x = s.sx - 1; x >= 0; x--) if (s.get(x, y, z)) return x; }
  else for (let x = 0; x < s.sx; x++) if (s.get(x, y, z)) return x;
  return -1;
}
const exposed = (s: Sculpt, x: number, y: number, z: number) =>
  !s.get(x + 1, y, z) || !s.get(x - 1, y, z) || !s.get(x, y + 1, z) || !s.get(x, y - 1, z) || !s.get(x, y, z + 1) || !s.get(x, y, z - 1);

/**
 * A fin drawn as seen from the left flank: rows run top to bottom from `yTop`, characters run tail to nose from
 * `z0`. '.' is empty; any other character is looked up in `key`. Cells span x in [x0, x1).
 */
function profileFin(s: Sculpt, x0: number, x1: number, yTop: number, z0: number, rows: readonly string[], key: Readonly<Record<string, number>>): void {
  rows.forEach((row, r) => {
    for (let i = 0; i < row.length; i++) {
      const c = row[i]!;
      if (c === '.' || c === ' ') continue;
      const m = key[c];
      if (m === undefined) throw new Error(`Unknown fin key ${c}.`);
      for (let x = x0; x < x1; x++) s.set(x, yTop - r, z0 + i, m);
    }
  });
}

/** Mirrored paired fins: at height y, `reach[z]` cells out from each flank. The first row out is `root`. */
function pairedFin(s: Sculpt, y: number, reach: Readonly<Record<number, number>>, root: number, tip: number, edge?: { readonly z: number; readonly m: number }): void {
  for (const [zs, n] of Object.entries(reach)) {
    const z = Number(zs);
    for (const dir of [1, -1] as const) {
      const e = edgeX(s, y, z, dir);
      if (e < 0) throw new Error(`No flank at y ${y}, z ${z} for a paired fin.`);
      for (let i = 1; i <= n; i++) s.set(e + dir * i, y, z, edge && z === edge.z ? edge.m : i === 1 ? root : tip);
    }
  }
}

/** Ancient, armoured and long: five rows of pale scutes, a shovel snout with barbels, a crown, a shark's tail. */
export function createStormcrownSturgeon(): FishModel {
  const s = new Sculpt(17, 16, 32), cx = 8.5;
  const p: Profile = {
    half: curve([[5, 1.0], [7, 1.5], [10, 2.5], [14, 3.7], [18, 4.6], [21, 4.9], [23, 4.7], [25, 4.2], [27, 3.6], [28, 3.2], [29, 2.6], [30, 2.0], [31, 1.3]]),
    top: curve([[5, 8.8], [7, 9.4], [10, 10.0], [14, 10.8], [18, 11.3], [22, 11.3], [24, 10.9], [26, 10.0], [27, 9.0], [28, 7.8], [29, 7.4], [30, 7.0], [31, 6.6]]),
    bot: curve([[5, 6.4], [7, 5.8], [10, 4.6], [14, 3.4], [18, 2.8], [22, 2.8], [24, 3.1], [26, 3.7], [27, 4.1], [28, 4.5], [29, 4.7], [30, 5.0], [31, 5.2]]),
  };
  body(s, cx, 5, 31, p, MAT.slate);
  const band = (y: number, z: number) => { const b = p.bot(z), t = p.top(z); return (y + 0.5 - (b + t) / 2) / ((t - b) / 2); };
  s.paint((_x, y, z) => { const t = band(y, z); return t > 0.4 ? MAT.slate : t < -0.45 ? MAT.limestone : MAT.darkStone; });

  // Five rows of bony scutes: a peaked dorsal ridge, raised lateral plates and lower ventral rows.
  for (const z of [12, 15, 18, 21]) {
    for (let dz = 0; dz < 2; dz++) for (let x = 7; x <= 9; x++) s.set(x, topY(s, x, z + dz) + 1, z + dz, MAT.cream);
    s.set(8, topY(s, 8, z) + 1, z, MAT.cream);
  }
  for (const z of [9, 12, 15, 18, 21]) for (let dz = 0; dz < 2; dz++) {
    const zz = z + dz, mid = Math.floor((p.bot(zz) + p.top(zz)) / 2), low = Math.floor(p.bot(zz) + 1.2);
    for (const dir of [1, -1] as const) {
      s.set(edgeX(s, mid, zz, dir) + dir, mid, zz, MAT.cream);
      const v = edgeX(s, low, zz, dir);
      if (v >= 0) s.set(v + dir, low, zz, MAT.cream);
    }
  }

  // The crown: a pale band over the head lifting into five points, tallest at the centre.
  for (const z of [23, 24]) for (let x = 4; x <= 12; x++) {
    const base = topY(s, x, z) + 1, rise = z === 23 ? 0 : x === 8 ? 3 : x === 6 || x === 10 ? 2 : x === 4 || x === 12 ? 1 : 0;
    for (let y = base; y <= base + rise; y++) s.set(x, y, z, y > base ? MAT.cream : MAT.limestone);
  }

  // Low paired fins, a dorsal set far back, and the long upper lobe of a heterocercal tail.
  pairedFin(s, 4, { 21: 1, 20: 3, 19: 4, 18: 4, 17: 3 }, MAT.darkStone, MAT.slate);
  pairedFin(s, 5, { 12: 1, 11: 2, 10: 2 }, MAT.darkStone, MAT.slate);
  for (const [z, h] of [[7, 3], [8, 3], [9, 2], [10, 1]] as const) for (let y = topY(s, 8, z) + 1, i = 0; i < h; i++) s.set(8, y + i, z, MAT.darkStone);
  for (const [z, h] of [[7, 2], [8, 2], [9, 1]] as const) for (let y = bottomY(s, 8, z) - 1, i = 0; i < h; i++) s.set(8, y - i, z, MAT.darkStone);
  profileFin(s, 8, 9, 15, 0, [
    'c#.....',
    'c##....',
    '.c##...',
    '..c##..',
    '..c###.',
    '...c###',
    '...####',
    '....###',
    '....###',
    '...###.',
    '..###..',
    '..##...',
    '..#....',
  ], { '#': MAT.darkStone, c: MAT.cream });

  // Shovel snout: four barbels hang in a row in front of an underslung mouth.
  for (const x of [5, 7, 9, 11]) for (let y = bottomY(s, x, 28) - 1; y >= 2; y--) s.set(x, y, 28, MAT.cream);
  const mouthY = bottomY(s, 8, 25) - 1;
  s.box(7, mouthY, 25, 10, mouthY + 1, 27, MAT.earth);
  for (const dir of [1, -1] as const) s.set(edgeX(s, 8, 25, dir), 8, 25, MAT.hairBlack);
  return fishModel('fish:stormcrown-sturgeon', s, [cx, mouthY + 0.5, 26], [cx, 7.5, 5]);
}

/** A mirror carp of hammered gold: towering back, a long sweeping dorsal, coin scales and an open mouth. */
export function createGoldscaleEmperor(): FishModel {
  const s = new Sculpt(15, 24, 30), cx = 7.5;
  const p: Profile = {
    half: curve([[5, 1.3], [7, 2.0], [9, 3.0], [12, 4.2], [15, 5.0], [18, 5.4], [20, 5.4], [22, 5.0], [24, 4.4], [26, 3.6], [27, 3.0]]),
    top: curve([[5, 12.6], [7, 13.6], [9, 15.0], [12, 17.0], [15, 18.6], [18, 19.2], [20, 18.8], [22, 17.6], [24, 16.0], [26, 14.4], [27, 13.6]]),
    bot: curve([[5, 9.4], [7, 8.5], [9, 7.0], [12, 5.4], [15, 4.4], [18, 4.1], [20, 4.2], [22, 4.7], [24, 5.5], [26, 6.6], [27, 7.2]]),
  };
  body(s, cx, 5, 27, p, MAT.brass);
  const band = (y: number, z: number) => { const b = p.bot(z), t = p.top(z); return (y + 0.5 - (b + t) / 2) / ((t - b) / 2); };
  s.paint((_x, y, z) => { const t = band(y, z); return t > 0.7 ? MAT.hairChestnut : t > 0.45 ? MAT.goldLeaf : t < -0.55 ? MAT.cream : MAT.brass; });

  // Mirror scales: a few great coins along the dorsal base, one beneath the gill and one at the tail root, each lit
  // at its upper front and shadowed at its lower rear.
  const coins: readonly (readonly [number, number, number])[] = [[21, 11, 2.1], [18, 16, 2.1], [14, 15.5, 1.6], [10.5, 13.5, 1.5], [16, 10.5, 1.6], [8.5, 11.5, 1.2]];
  for (const [cz, cy, r] of coins) for (let z = Math.floor(cz - r); z <= cz + r; z++) for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    const u = z + 0.5 - cz, v = y + 0.5 - cy;
    if (u * u + v * v > r * r) continue;
    const m = u + v < -0.9 * r ? MAT.goldLeaf : u > 0 && v > 0 && u + v > 0.9 * r ? MAT.hairGold : MAT.fabricGold;
    for (const dir of [1, -1] as const) { const e = edgeX(s, y, z, dir); if (e >= 0) s.set(e, y, z, m); }
  }

  // The long sweeping dorsal rises high behind the head and runs back toward the tail.
  const sail = curve([[8, 15.5], [10, 18.0], [13, 20.0], [16, 21.6], [18, 23.0], [19, 23.0], [20, 21.5], [21, 19.5]]);
  for (let z = 8; z <= 21; z++) for (let y = topY(s, 7, z) + 1; y <= Math.round(sail(z)); y++) s.set(7, y, z, z >= 20 || z % 2 === 0 ? MAT.fabricOrange : MAT.hairChestnut);

  // Wide flowing tail and the underslung fins.
  profileFin(s, 7, 8, 20, 0, [
    'eo....',
    'eoo...',
    'eooo..',
    '.eooo.',
    '.eoooo',
    '..eooo',
    '..eooo',
    '...ooo',
    '....oo',
    '....oo',
    '...ooo',
    '..eooo',
    '..eooo',
    '.eoooo',
    '.eooo.',
    'eooo..',
    'eoo...',
    'eo....',
  ], { o: MAT.hairChestnut, e: MAT.fabricOrange });
  profileFin(s, 7, 8, 7, 7, ['.ooo', 'ooo.', 'oo..'], { o: MAT.hairChestnut });
  pairedFin(s, 5, { 17: 1, 16: 2, 15: 2 }, MAT.hairChestnut, MAT.fabricOrange);
  pairedFin(s, 7, { 24: 1, 23: 3, 22: 3, 21: 2 }, MAT.hairChestnut, MAT.fabricOrange);

  // Big open lips around a dark mouth, with a pair of long barbels at the corners.
  s.box(6, 9, 27, 9, 12, 28, MAT.hairBlack);
  for (const z of [28, 29]) {
    s.box(6, 8, z, 9, 9, z + 1, MAT.forgeCopper).box(6, 12, z, 9, 13, z + 1, MAT.forgeCopper);
    s.box(5, 9, z, 6, 12, z + 1, MAT.forgeCopper).box(9, 9, z, 10, 12, z + 1, MAT.forgeCopper);
  }
  for (const x of [4, 10]) for (let y = 6; y <= 9; y++) s.set(x, y, 29, MAT.hairGold);
  for (const dir of [1, -1] as const) s.set(edgeX(s, 13, 24, dir), 13, 24, MAT.hairBlack);
  return fishModel('fish:goldscale-emperor', s, [cx, 10.5, 30], [cx, 11, 5]);
}

/** A manta under the harbour: crescent wings, cephalic fins, a pale crescent moon and a long whip tail. */
export function createMoonwakeRay(): FishModel {
  const s = new Sculpt(32, 9, 32), cx = 16, front = 27, back = 10, tipZ = 12, span = 16;
  // Leading edge: a convex sweep from the head to the wing tips. Trailing edge: a concave crescent that bows
  // forward between tip and tail root, so the tips point back like a manta's.
  const lead = (z: number) => z >= tipZ ? 5 + (span - 5) * Math.pow((front - z) / (front - tipZ), 0.7) : span;
  const trail = (d: number) => { const t = Math.min(1, Math.max(0, (d - 2.5) / (span - 2.5))); return back + (tipZ - back) * t + 5.5 * Math.sin(Math.PI * Math.pow(t, 0.8)); };
  const spans = new Map<string, [number, number]>();
  for (let z = back; z <= front; z++) for (let x = 0; x < s.sx; x++) {
    const d = Math.abs(x + 0.5 - cx), L = lead(z);
    if (d > L + 0.2 || z + 0.5 < trail(d)) continue;
    const wing = Math.max(0, (d - 3.5) / Math.max(1, L - 3.5));
    const edge = Math.min(1, (L + 0.2 - d) / 2.5, (z + 0.5 - trail(d)) / 2);
    const thick = Math.max(0, (1 - wing) * edge);
    const mid = wing > 0.7 ? 3 : 4;
    spans.set(`${x},${z}`, [mid - Math.round(1.6 * thick), mid + Math.round(2.2 * thick)]);
  }
  // Every column overlaps the neighbour it was reached from, so thin, drooping tips stay face-connected.
  const queue: [number, number][] = [[cx, 20], [cx - 1, 20]], seen = new Set(queue.map(([x, z]) => `${x},${z}`));
  while (queue.length) {
    const [x, z] = queue.shift()!, [lo, hi] = spans.get(`${x},${z}`)!;
    for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]] as const) {
      const key = `${nx},${nz}`, n = spans.get(key);
      if (!n || seen.has(key)) continue;
      if (n[1] < lo) n[1] = lo;
      if (n[0] > hi) n[0] = hi;
      seen.add(key); queue.push([nx, nz]);
    }
  }
  for (const [key, [lo, hi]] of spans) { const [x, z] = key.split(',').map(Number) as [number, number]; s.box(x, lo, z, x + 1, hi + 1, z + 1, MAT.slate); }
  // Underside cream; the back slate with a pale crescent moon and a lighter wake along the trailing edges.
  s.paint((x, y, z, m) => {
    if (!s.get(x, y - 1, z) && s.get(x, y + 1, z)) return MAT.cream;
    if (s.get(x, y + 1, z)) return m;
    const u = x + 0.5 - cx, v = z + 0.5 - 18.5;
    if (u * u + v * v <= 4.8 * 4.8 && (u - 1.9) ** 2 + (v - 1.3) ** 2 > 4.2 * 4.2) return MAT.hairSilver;
    const d = Math.abs(u);
    if (d > 6 && z + 0.5 - trail(d) < 1.2) return MAT.fabricMutedBlue;
    return m;
  });
  // Cephalic fins curl forward at the corners of the head, either side of a wide, dark mouth.
  for (const [outer, inner] of [[cx + 4, cx + 3], [cx - 5, cx - 4]] as const) {
    s.box(Math.min(outer, inner), 3, 28, Math.max(outer, inner) + 1, 5, 31, MAT.slate);
    s.box(inner, 3, 31, inner + 1, 5, 32, MAT.slate);
    s.set(inner, 3, 31, MAT.cream).set(inner, 3, 30, MAT.cream).set(outer, 3, 29, MAT.cream);
  }
  s.box(cx - 3, 3, front, cx + 3, 4, front + 1, MAT.hairBlack);
  for (const x of [cx - 5, cx + 4]) s.set(x, topY(s, x, 26), 26, MAT.hairBlack);
  // The long whip tail, with a small dorsal fin at its root.
  s.box(cx - 1, 3, 0, cx + 1, 4, back, MAT.slate);
  s.box(cx - 1, 4, back - 2, cx + 1, 5, back, MAT.darkStone).box(cx - 1, 5, back - 1, cx + 1, 6, back, MAT.darkStone);
  return fishModel('fish:moonwake-ray', s, [cx, 3.5, 28], [cx, 3.5, back]);
}

/** A winter king: humped back speckled with frost, a deep ember belly, white-edged fins and a hooked kype. */
export function createFrostkingChar(): FishModel {
  const s = new Sculpt(15, 18, 31), cx = 7.5;
  const p: Profile = {
    half: curve([[5, 1.2], [7, 1.8], [9, 2.6], [12, 3.6], [15, 4.3], [18, 4.6], [21, 4.4], [23, 4.0], [25, 3.4], [26, 3.0]]),
    top: curve([[5, 10.0], [7, 10.8], [9, 11.9], [12, 13.4], [15, 14.6], [17, 15.0], [20, 14.5], [22, 13.7], [24, 12.6], [26, 11.6]]),
    bot: curve([[5, 7.4], [7, 6.8], [9, 6.0], [12, 4.8], [15, 4.0], [18, 3.8], [21, 4.0], [23, 4.5], [25, 5.4], [26, 6.0]]),
  };
  body(s, cx, 5, 26, p, MAT.blueFlower);
  const band = (y: number, z: number) => { const b = p.bot(z), t = p.top(z); return (y + 0.5 - (b + t) / 2) / ((t - b) / 2); };
  s.paint((x, y, z) => {
    const t = band(y, z);
    if (t < -0.68) return MAT.hairCopper;
    if (t < -0.22) return MAT.fabricRed;
    const back = t > 0.7 ? MAT.fabricMutedBlue : MAT.blueFlower;
    // Frost: a staggered lattice of pale spots, settling thickest on the back.
    const frost = z >= 7 && z <= 23 && exposed(s, x, y, z) && (x + y) % 2 === 0 && (z + x + y) % 4 === 0 && t > 0.05;
    return frost ? MAT.hairSilver : back;
  });

  // A shorter upper jaw, the mouth open beneath it, and the kype: a long lower jaw hooking up in front.
  s.box(6, 9, 27, 9, 12, 28, MAT.blueFlower).box(6, 9, 28, 9, 11, 29, MAT.blueFlower).box(6, 11, 27, 9, 12, 28, MAT.fabricMutedBlue);
  s.box(6, 8, 26, 9, 9, 28, MAT.hairBlack);
  s.box(6, 6, 26, 9, 8, 30, MAT.cream).box(6, 7, 30, 9, 8, 31, MAT.cream).box(7, 8, 30, 8, 11, 31, MAT.hairSilver);

  // Dorsal on the hump, a small adipose, white-edged lower fins and a broad, barely forked tail.
  profileFin(s, 7, 8, 17, 14, ['.dddw', 'ddddw', 'ddddw', 'ddddw'], { d: MAT.fabricMutedBlue, w: MAT.hairSilver });
  s.box(7, topY(s, 7, 8) + 1, 7, 8, topY(s, 7, 8) + 2, 9, MAT.fabricMutedBlue);
  profileFin(s, 7, 8, 5, 8, ['rrw', 'rrw', '.rw'], { r: MAT.fabricRed, w: MAT.hairSilver });
  pairedFin(s, 5, { 22: 1, 21: 3, 20: 3, 19: 2 }, MAT.fabricRed, MAT.fabricRed, { z: 22, m: MAT.hairSilver });
  pairedFin(s, 5, { 14: 1, 13: 2, 12: 2 }, MAT.fabricRed, MAT.fabricRed, { z: 14, m: MAT.hairSilver });
  profileFin(s, 7, 8, 15, 0, [
    'dd....',
    'ddd...',
    '.ddd..',
    '.dddd.',
    '..dddd',
    '..dddd',
    '..dddd',
    '..rrrr',
    '..rrrr',
    '.rrrr.',
    '.rrr..',
    'wrr...',
    'ww....',
  ], { d: MAT.fabricMutedBlue, r: MAT.fabricRed, w: MAT.hairSilver });
  for (const dir of [1, -1] as const) s.set(edgeX(s, 11, 24, dir), 11, 24, MAT.hairBlack);
  return fishModel('fish:frostking-char', s, [cx, 8.5, 29], [cx, 8.5, 5]);
}
