import type { Vec3 } from '@chatdom/shared';
import { MAT } from '@chatdom/content/materials';
import { Grid, SOFT, blob, checkOptions, finish, hash, stream, variantTag, type PieceKit, type Stream } from '../kit';
import type { GeneratedPiece, PieceOptions } from '../types';

/**
 * A ring of weathered standing stones on a worn earth circle: seven to eleven stones of different heights, widths
 * and tapers, some leaning, one fallen and broken, a trilithon with its lintel at the back opposite the entrance gap
 * (+Z), two taller portal stones flanking that gap with braziers in it, a low altar stone with a small hearth fire
 * at the centre, moss on the shaded faces and crowns, lichen flecks, rain streaks, a cairn by the path and
 * wildflowers in the long grass at the stones' feet. Everything is placed by the seed; the style picks the stone.
 */
export interface StoneSlot {
  /** Angle round the ring from +Z, radians (0 is the entrance's middle). */
  readonly angle: number;
  readonly role: 'stone' | 'portal' | 'trilithon' | 'fallen';
  readonly height: number;
}
export interface StonesLayout {
  readonly ring: number;
  readonly size: Vec3;
  readonly centre: readonly [number, number];
  readonly gap: number;
  readonly slots: readonly StoneSlot[];
  /** Standing stones counted one each, the trilithon's uprights as two. */
  readonly count: number;
}

const TAU = Math.PI * 2;

export function stonesLayout(seed: number): StonesLayout {
  const r = stream(seed, 0x570e5);
  const count = r.int(7, 11), ring = r.int(44, 56), gap = r.range(0.3, 0.4);
  const size: Vec3 = [2 * ring + 34, 46, 2 * ring + 48];
  const centre = [size[0] / 2, ring + 17] as const;
  const m = count - 1, spacing = (TAU - 2 * gap) / m;
  const angles = Array.from({ length: m }, (_, i) => gap + spacing * (i + 0.5) + (i === 0 || i === m - 1 ? 0 : r.range(-0.2, 0.2) * spacing));
  // The slot nearest the back takes the trilithon, set square to the entrance's axis.
  let back = 0;
  angles.forEach((a, i) => { if (Math.abs(a - Math.PI) < Math.abs(angles[back]! - Math.PI)) back = i; });
  angles[back] = Math.PI + r.range(-0.04, 0.04);
  const candidates = angles.map((_, i) => i).filter(i => i !== back && i !== 0 && i !== m - 1 && Math.abs(i - back) > 1);
  const fallen = candidates.length ? candidates[Math.floor(r.next() * candidates.length)]! : -1;
  const slots: StoneSlot[] = angles.map((angle, i) => {
    const role: StoneSlot['role'] = i === back ? 'trilithon' : i === fallen ? 'fallen' : i === 0 || i === m - 1 ? 'portal' : 'stone';
    const height = role === 'trilithon' ? r.int(28, 32) : role === 'portal' ? r.int(28, 36) : r.int(16, 32);
    return { angle, role, height };
  });
  return { ring, size, centre, gap, slots, count };
}

interface StoneShape {
  readonly h: number; readonly w: number; readonly d: number; readonly taper: number;
  readonly leanR: number; readonly leanT: number;
  readonly top: 'round' | 'slant' | 'point' | 'flat'; readonly slant: number;
  readonly material: number;
  /** Phases of the two slow swells along the stone's height, so no two profiles match. */
  readonly swell: readonly [number, number];
  readonly chips: readonly (readonly [number, number, number, number])[];
}

function shapeFor(r: Stream, kit: PieceKit, slot: StoneSlot, strongLean: boolean): StoneShape {
  const portal = slot.role === 'portal', lintel = slot.role === 'trilithon';
  const w = portal ? r.range(4, 5.2) : lintel ? r.range(4.5, 5.5) : r.range(4, 7.2);
  const d = r.range(2.2, 3.4), h = slot.height;
  const lean = strongLean ? r.pick([-1, 1]) * r.range(5, 7) : r.range(-1.8, 1.8);
  const chips: [number, number, number, number][] = [];
  for (let k = r.int(2, 4); k > 0; k--) chips.push([r.pick([-1, 1]) * w * r.range(0.8, 1.05), r.range(3, h - 1), r.pick([-1, 1]) * d * r.range(0.6, 1.1), r.range(1.3, 2.4)]);
  return {
    h, w, d, taper: lintel ? r.range(0.05, 0.12) : r.range(0.28, 0.55), swell: [r.range(0, 6.28), r.range(0, 6.28)],
    leanR: lintel ? 0 : strongLean ? lean : r.range(-1.5, 1.5), leanT: lintel ? 0 : strongLean ? r.range(-2, 2) : lean,
    top: lintel ? 'flat' : r.pick(['round', 'slant', 'point', 'round', 'slant'] as const), slant: r.range(-6, 6),
    material: r.chance(0.28) ? kit.rock : kit.stone, chips,
  };
}

/**
 * Rasterises one standing stone in its own frame (u along the ring's tangent, v out from the centre), with taper,
 * lean that grows with height, chamfered vertical arrises, a shaped crown and chips bitten out of the edges.
 */
function standing(g: Grid, cx: number, cz: number, angle: number, s: StoneShape, base = 0): void {
  const tx = Math.cos(angle), tz = -Math.sin(angle), rx = Math.sin(angle), rz = Math.cos(angle);
  const reach = Math.ceil(Math.max(s.w, s.d) + Math.abs(s.leanR) + Math.abs(s.leanT) + 3);
  for (let y = 0; y < s.h + 4; y++) {
    const f = y / s.h, bend = f ** 1.4;
    // Slow swells along the height, stronger across the face than through it: a hand-dressed, weathered profile.
    const swell = 1 + 0.11 * Math.sin(y * 0.31 + s.swell[0]) + 0.06 * Math.sin(y * 0.67 + s.swell[1]);
    const foot = base === 0 && y < 3 ? (3 - y) * 0.45 : 0;
    const hw = s.w * (1 - s.taper * f ** 1.5) * swell + foot, hd = s.d * (1 - s.taper * 0.35 * f) * (2 - swell * 0.95 + 0.05) + foot * 0.7;
    for (let z = Math.floor(cz - reach); z <= cz + reach; z++) for (let x = Math.floor(cx - reach); x <= cx + reach; x++) {
      const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
      const u = dx * tx + dz * tz - s.leanT * bend, v = dx * rx + dz * rz - s.leanR * bend;
      if (Math.abs(u) > hw || Math.abs(v) > hd) continue;
      if ((Math.abs(u) / hw) ** 2.4 + (Math.abs(v) / hd) ** 2.4 > 1) continue;
      const un = u / s.w;
      const crown = s.top === 'round' ? 6.5 * un * un : s.top === 'slant' ? s.slant * un + 3 * un * un + 1 : s.top === 'point' ? 9 * Math.abs(un) ** 1.3 : 0.8 * un * un;
      if (y >= s.h - crown) continue;
      if (s.chips.some(([cu, cy, cv, cr]) => (u - cu) ** 2 + (y + 0.5 - cy) ** 2 + (v - cv) ** 2 < cr * cr)) continue;
      g.set(x, y + base, z, s.material);
    }
  }
}

/** Weathers the stone cells in a region: moss on crowns and shaded north faces, lichen flecks and rain streaks. */
function weather(g: Grid, kit: PieceKit, x0: number, z0: number, x1: number, z1: number, top: number, salt: number): void {
  const stone = new Set([kit.stone, kit.rock]);
  const mossy = kit.style === 'grove' ? 1.05 : kit.style === 'tide' ? 0.85 : 1;
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    let streak = 0;
    for (let y = top; y >= 0; y--) {
      const m = g.get(x, y, z);
      if (!stone.has(m)) { streak = 0; continue; }
      const patch = hash(x >> 1, y >> 1, z >> 1, salt), crown = !g.get(x, y + 1, z), north = !g.get(x, y, z - 1), outer = !g.get(x, y, z + 1) || !g.get(x + 1, y, z) || !g.get(x - 1, y, z);
      // A rain streak starts under a crown on some columns and runs a few cells down the face.
      if (crown && hash(x, 3, z, salt) < 0.12) streak = 3 + Math.floor(hash(x, 4, z, salt) * 5);
      if (crown && patch < (y > 6 ? 0.5 : 0.75) * mossy) g.set(x, y, z, MAT.moss);
      else if (north && y < 12 && patch < (0.45 - y * 0.03) * mossy) g.set(x, y, z, MAT.moss);
      else if ((north || outer) && patch > 0.975 && y > 3) g.set(x, y, z, kit.stone === MAT.limestone ? MAT.stone : MAT.limestone);
      else if (streak > 0 && (north || outer)) { g.set(x, y, z, m === kit.stone ? kit.base : kit.stone); streak--; }
      else if (y < 2 && (north || outer) && patch < 0.5) g.set(x, y, z, kit.base);
    }
  }
}

/**
 * The stone a ring is raised from is always weathered grey stone: Grove's dark stone alone reads blue-painted at
 * dusk, so its ring is grey field stone mixed with warm limestone, the kit's dark stone kept for streaks and footings.
 * The kingdom's colours stay on the cloth, the ribbon and the altar, never on a stone.
 */
function ringKit(kit: PieceKit): PieceKit {
  return kit.style === 'grove' ? { ...kit, stone: MAT.stone, rock: MAT.limestone, base: MAT.darkStone } : kit;
}

export function createStandingStones(options: PieceOptions): GeneratedPiece {
  const kit = ringKit(checkOptions(options));
  const { field, charge, border } = options.colours;
  const L = stonesLayout(options.seed);
  const r = stream(options.seed, 0xc1c1e);
  const salt = (options.seed ^ 0x3a7d) | 0;
  const [sx, sy, sz] = L.size, [cx, cz] = L.centre, R = L.ring;
  const g = new Grid(sx, sy, sz);
  const lanterns: Vec3[] = [];

  // ── The worn ring and the path in through the gap.
  // Noise is sampled on three-cell blocks so the worn ground reads as patches (and merges into few boxes).
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const dx = x + 0.5 - cx, dz = z + 0.5 - cz, d = Math.hypot(dx, dz);
    const n = hash(Math.floor(x / 3), 0, Math.floor(z / 3), salt) * 2.2 + hash(x >> 3, 1, z >> 3, salt) * 2.4;
    // Feet wear a band just inside the stones, broken where the turf has crept back.
    const band = d > R - 9 - n && d < R + 2 + n * 0.5 && hash(x >> 3, 5, z >> 3, salt) > 0.12;
    const hearth = d < 9 + n;
    const pathHalf = 4.5 + 1.2 * Math.sin(z * 0.21 + salt) + n * 0.5;
    const path = dz > R - 6 && Math.abs(dx - 2 * Math.sin(z * 0.09)) < pathHalf;
    if (band || path || hearth) g.set(x, 0, z, MAT.earth);
  }
  // Tufts on the earth's rim, in little clumps.
  for (let z = 1; z < sz - 1; z++) for (let x = 1; x < sx - 1; x++) {
    if (g.get(x, 0, z) !== MAT.earth || hash(x >> 1, 6, z >> 1, salt) > 0.1) continue;
    if (g.get(x + 2, 0, z) && g.get(x - 2, 0, z) && g.get(x, 0, z + 2) && g.get(x, 0, z - 2)) continue;
    g.fill(x, 0, z, x + 2, 1, z + 2, MAT.leaf);
  }

  // ── The stones.
  const strong = new Set<number>();
  const pool = L.slots.map((s, i) => i).filter(i => L.slots[i]!.role === 'stone');
  for (let k = 0; k < Math.min(2, pool.length); k++) strong.add(pool[Math.floor(r.next() * pool.length)]!);
  let peak = 0;
  for (const [i, slot] of L.slots.entries()) {
    const sx0 = cx + Math.sin(slot.angle) * R, sz0 = cz + Math.cos(slot.angle) * R;
    const shape = shapeFor(r, kit, slot, strong.has(i));
    if (slot.role === 'trilithon') {
      // Two uprights a doorway apart, and a lintel laid across them with a little overhang at either end.
      const tx = Math.cos(slot.angle), tz = -Math.sin(slot.angle), apart = shape.w + 4.5;
      for (const side of [-1, 1]) standing(g, sx0 + tx * apart * side, sz0 + tz * apart * side, slot.angle, { ...shape, top: 'flat', h: slot.height + (side > 0 ? 0 : 1) });
      const span = apart + shape.w + 2.5, top = slot.height - 1;
      standing(g, sx0, sz0, slot.angle, { ...shape, h: 5, w: span, d: shape.d + 0.4, taper: 0, swell: [0, 0], top: 'flat', leanR: 0, leanT: 0, chips: shape.chips.map(([u, , v, cr]) => [u * 1.6, 2.5, v, cr]) }, top);
      peak = Math.max(peak, top + 6);
    } else if (slot.role === 'fallen') {
      fallen(g, kit, cx, cz, slot, shape, R, salt);
    } else {
      standing(g, sx0, sz0, slot.angle, shape);
      peak = Math.max(peak, shape.h + 1);
    }
    // Long grass and wildflowers round each foot.
    for (let k = 0; k < 14; k++) {
      const a = hash(i, k, 1, salt) * TAU, rr = shape.w + 1 + hash(i, k, 2, salt) * 4;
      const x = Math.round(sx0 + Math.cos(a) * rr), z = Math.round(sz0 + Math.sin(a) * rr);
      if (g.get(x, 1, z) || g.get(x, 0, z) === MAT.paving) continue;
      const h = 1 + Math.floor(hash(i, k, 3, salt) * 3);
      g.fill(x, 0, z, x + 1, h, z + 1, MAT.leaf);
      const bloom = hash(i, k, 4, salt);
      if (bloom < 0.45) g.set(x, h, z, bloom < 0.2 ? MAT.petal : bloom < 0.34 ? MAT.blueFlower : MAT.cream);
    }
  }

  // ── The centre: a low altar stone, and before it a ring of hearth stones round a small fire.
  const ax = Math.round(cx), az = Math.round(cz) - 6;
  g.fill(ax - 9, 0, az - 3, ax + 9, 4, az + 3, kit.stone);
  g.fill(ax - 10, 0, az - 2, ax + 10, 3, az + 2, kit.stone);
  g.fill(ax - 8, 4, az - 2, ax + 8, 5, az + 2, kit.stone);
  for (let x = ax - 10; x < ax + 10; x++) for (let z = az - 3; z < az + 3; z++) if (hash(x, 9, z, salt) < 0.12) g.set(x, 4 + (g.get(x, 4, z) ? 1 : 0) - 1, z, kit.base);
  // A brass bowl on the altar with a cloth laid beside it in the kingdom's colours.
  g.fill(ax + 3, 5, az - 1, ax + 6, 6, az + 1, kit.metal);
  g.fill(ax + 2, 6, az - 1, ax + 7, 7, az + 1, kit.metal);
  g.fill(ax + 3, 6, az - 1, ax + 6, 7, az + 1, MAT.petal);
  g.fill(ax - 7, 5, az - 2, ax - 1, 6, az + 2, field);
  g.fill(ax - 7, 5, az - 2, ax - 1, 6, az - 1, border);
  g.fill(ax - 7, 5, az + 1, ax - 1, 6, az + 2, border);
  g.fill(ax - 5, 5, az - 1, ax - 3, 6, az + 1, charge);
  g.fill(ax - 1, 2, az + 2, ax + 1, 5, az + 4, field);
  const hx = ax, hz = Math.round(cz) + 6;
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * TAU + 0.3, x = Math.round(hx + Math.cos(a) * 5.2), z = Math.round(hz + Math.sin(a) * 5.2);
    g.fill(x - 1, 0, z - 1, x + 1, 2 + (k % 3 === 0 ? 1 : 0), z + 1, k % 2 ? kit.stone : kit.base);
  }
  g.fill(hx - 3, 0, hz - 3, hx + 3, 1, hz + 3, MAT.darkStone);
  g.fill(hx - 2, 0, hz - 2, hx + 2, 1, hz + 2, MAT.bark);
  // Logs leaning in to a point: a small teepee with the fire's heart inside.
  for (const [dx, dz] of [[-2, 0], [2, 0], [0, -2], [0, 2]] as const) {
    g.fill(hx + dx - (dx > 0 ? 1 : 0), 1, hz + dz - (dz > 0 ? 1 : 0), hx + dx + (dx < 0 ? 1 : 0) + (dx === 0 ? 1 : 0), 4, hz + dz + (dz < 0 ? 1 : 0) + (dz === 0 ? 1 : 0), MAT.bark);
  }
  g.fill(hx - 1, 3, hz - 1, hx + 1, 4, hz + 1, MAT.bark);
  g.set(hx - 1, 1, hz - 1, MAT.air); g.set(hx, 1, hz, MAT.air); g.set(hx - 1, 2, hz, MAT.air); g.set(hx, 2, hz - 1, MAT.air);
  lanterns.push([hx, 2, hz]);
  // Two seat stones by the fire.
  for (const side of [-1, 1]) {
    const x = hx + side * 12, z = hz + 1;
    blob(g, x, 1, z, 3.2, 2.6, 2.4, kit.rock, (_x, y) => y >= 0);
    g.over(x - 3, 2, z - 2, x + 3, 4, z + 2, kit.rock);
  }

  // ── The braziers in the gap, on squat stone pedestals, and the cairn beside the path.
  const gz = Math.round(cz + R) + 2, ph = r.int(6, 9);
  for (const side of [-1, 1]) {
    const bx = Math.round(cx + side * 10);
    g.fill(bx - 3, 0, gz - 3, bx + 3, 1, gz + 3, kit.base);
    g.fill(bx - 2, 1, gz - 2, bx + 2, ph - 1, gz + 2, kit.stone);
    g.fill(bx - 3, ph - 1, gz - 3, bx + 3, ph, gz + 3, kit.base);
    // The iron bowl, open at the top, its coals a cell below the rim.
    g.fill(bx - 2, ph, gz - 2, bx + 2, ph + 1, gz + 2, kit.iron);
    g.fill(bx - 3, ph + 1, gz - 3, bx + 3, ph + 3, gz + 3, kit.iron);
    g.fill(bx - 2, ph + 1, gz - 2, bx + 2, ph + 3, gz + 2, MAT.air);
    g.fill(bx - 2, ph + 1, gz - 2, bx + 2, ph + 2, gz + 2, MAT.bark);
    g.fill(bx - 1, ph + 2, gz - 1, bx + 1, ph + 3, gz + 1, MAT.darkStone);
    for (const [dx, dz] of [[-3, -3], [2, -3], [-3, 2], [2, 2]] as const) g.set(bx + dx, ph + 3, gz + dz, kit.metal);
    lanterns.push([bx - 1, ph + 3, gz - 1]);
  }
  const cairnX = Math.round(cx + (r.chance(0.5) ? -1 : 1) * 16), cairnZ = Math.min(sz - 8, gz + 10);
  for (const [w, y0, y1] of [[5, 0, 3], [4, 3, 5], [3, 5, 7], [2, 7, 9], [1, 9, 10]] as const) {
    g.fill(cairnX - w, y0, cairnZ - w + 1, cairnX + w, y1, cairnZ + w - 1, y0 % 2 ? kit.rock : kit.stone);
    g.fill(cairnX - w + 1, y0, cairnZ - w, cairnX + w - 1, y1, cairnZ + w, y0 % 2 ? kit.stone : kit.rock);
  }
  // A ribbon tied round the cairn's top stone.
  g.set(cairnX - 1, 8, cairnZ + 2, border); g.set(cairnX, 8, cairnZ + 2, border); g.set(cairnX, 7, cairnZ + 3, field); g.set(cairnX, 6, cairnZ + 3, field);

  // ── Boulders half sunk in the grass outside the ring.
  for (let k = r.int(3, 5); k > 0; k--) {
    const a = r.range(L.gap + 0.4, TAU - L.gap - 0.4), d = R + r.range(11, 15);
    const bx = cx + Math.sin(a) * d, bz = cz + Math.cos(a) * d;
    blob(g, bx, 0, bz, r.range(2.5, 4.5), r.range(2, 3.5), r.range(2.5, 4), r.chance(0.5) ? kit.stone : kit.rock);
  }

  weather(g, kit, 0, 0, sx, sz, Math.min(sy - 1, peak + 2), salt);
  g.prune(SOFT);

  const id = `genesis-stones-${kit.style}-${L.count}-${variantTag(options.seed, options.colours)}`;
  return finish(g, id, kit.style, lanterns);
}

/** The fallen stone: toppled outward, lying half sunk in the turf and broken across in two, moss on its back. */
function fallen(g: Grid, kit: PieceKit, cx: number, cz: number, slot: StoneSlot, s: StoneShape, R: number, salt: number): void {
  const rx = Math.sin(slot.angle), rz = Math.cos(slot.angle), tx = Math.cos(slot.angle), tz = -Math.sin(slot.angle);
  const len = s.h, base = R - 2;
  const reach = Math.ceil(len + s.w + 4);
  for (let z = Math.floor(cz + rz * (base + len / 2) - reach); z <= cz + rz * (base + len / 2) + reach; z++) {
    for (let x = Math.floor(cx + rx * (base + len / 2) - reach); x <= cx + rx * (base + len / 2) + reach; x++) {
      const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
      const along = dx * rx + dz * rz - base, across = dx * tx + dz * tz;
      if (along < 0 || along > len) continue;
      const f = along / len, hw = s.w * (1 - s.taper * f ** 1.6);
      // The break: a crooked crack two cells wide a little past the middle; the outer piece slewed sideways.
      const crack = len * 0.58 + 1.5 * Math.sin(across * 0.7);
      if (Math.abs(along - crack) < 1) continue;
      const slew = along > crack ? 1.5 : 0;
      if (Math.abs(across - slew) > hw) continue;
      const th = s.d * 2 * (1 - 0.25 * Math.abs(across - slew) / hw) - (hash(x, 1, z, salt) < 0.3 ? 1 : 0);
      for (let y = 0; y < th; y++) g.set(x, y, z, s.material);
    }
  }
}
