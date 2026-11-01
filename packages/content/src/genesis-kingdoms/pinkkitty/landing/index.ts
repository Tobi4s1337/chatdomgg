import { StyleIdSchema, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '../../../materials';
import type { EmoteGlass } from '../../../genesis-emotes/glass';
import { Boxes, hash } from '../../../genesis-landmarks/kit';

/**
 * PinkKittyRose's river town: the stone landing and grand stair that climb from the market square up to the river
 * hall's town door, and the glass screen that holds the kingdom's window out in the market.
 *
 * The hall's sill is set by the river, and the town meadow lies about five metres below it, so the hall stands on
 * its bank above the square. The landing is the civic answer: a broad flight in paving with dark nosings, flanked
 * by raised rose terraces that step down with it between stepped limestone parapets, iron fire baskets on piers at
 * the head and the foot, all of it solid masonry founded a metre into the ground.
 *
 * Both pieces use the Hearth kit (limestone, timber, plaster, terracotta) with darkStone coping and ironwork, brass,
 * cream ashlar, and the roses: earth, leaf, petal and a little violet.
 */

// ── Landing ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface HallLandingOptions {
  /** Height of the hall's bank above the market floor, in build cells: even, 16–48. */
  readonly riseCells: number;
  /** Width across the stair (Z), in build cells: even, 80–200. Default 96 (12 m). */
  readonly widthCells?: number;
}

export interface HallLanding {
  readonly blueprint: VoxelBlueprint;
  /** The platform's run along X from the hall face; its top lies at y = 8 + riseCells. */
  readonly platformCells: number;
  /** The flight's run along X from the platform's edge down to the end of the lowest tread. */
  readonly flightCells: number;
  /** Flame bases of the four fire baskets, local build cells: the centre of each basket's open mouth. */
  readonly fires: readonly Vec3[];
  readonly size: Vec3;
}

/**
 * The landing's measured planes, shared by the factory and its tests. Frame, in build cells: +X runs from the hall
 * face (x = 0) down the stair to the market; Y up; Z across. y = 0 lies a metre below the market floor so the
 * masonry is founded in the ground; the market floor (and the lowest tread's top) is y = 8.
 */
export const HALL_LANDING = {
  /** The market floor. */
  market: 8,
  /** The platform's run, and the part of it the hall's own steps and bench rest on. */
  platform: 40,
  hallSteps: 28,
  /** Half the width of the clear zone in front of the hall door, either side of the centre line. */
  clearHalf: 24,
  /** Headroom kept free above the clear zone. */
  clearHeight: 24,
  /** The run the flight is laid out to; tread length is floor(run / steps). */
  run: 60,
  riser: 2,
  /** Parapet body inside z ∈ [1, 4), coping over [0, 5); terraces out to 20 cells from each side. */
  parapet: 4,
  terrace: 20,
  /** The raised beds stand this far above the tread just above their first step. */
  bedRaise: 4,
  /** The darkStone kerb strip across the foot, flush with the market. */
  foot: 2,
  pier: 8,
} as const;

const L = HALL_LANDING;

/** Boxes clipped to the piece's bounds, so overhangs at the edge never fall outside it. */
class Clipped extends Boxes {
  constructor(private readonly size: Vec3) { super(); }
  override add(x: number, y: number, z: number, X: number, Y: number, Z: number, material: number): void {
    super.add(Math.max(0, x), Math.max(0, y), Math.max(0, z), Math.min(this.size[0], X), Math.min(this.size[1], Y), Math.min(this.size[2], Z), material);
  }
}

/** A flag pattern along Z: flags 5–10 cells long, mostly paving with the odd grey and cream stone, by hash. */
function flags(b: Boxes, x0: number, x1: number, y: number, z0: number, z1: number, seed: number): void {
  let z = z0 + Math.floor(hash(x0, y, z0, seed) * 5) - 5;
  for (let i = 0; z < z1; i++) {
    const length = 5 + Math.floor(hash(x0, i, y, seed + 1) * 6), pick = hash(x0, i, y, seed + 2);
    const material = pick < 0.62 ? MAT.paving : pick < 0.86 ? MAT.stone : MAT.limestone;
    if (material !== MAT.paving) b.add(x0, y, Math.max(z0, z), x1, y + 1, Math.min(z1, z + length), material);
    z += length;
  }
}

/**
 * An iron fire basket standing on a cap whose top is `y`: a stem in a brass collar, a darkStone floor, corner bars
 * and a brass rim, holding a bed of coals heaped to an ember crown level with the rim. Returns the flame base, the
 * centre of the open mouth, which is air over the embers.
 */
function cresset(b: Boxes, cx: number, y: number, cz: number): Vec3 {
  b.add(cx - 1, y, cz - 1, cx + 1, y + 2, cz + 1, MAT.darkStone);
  b.add(cx - 2, y + 1, cz - 2, cx + 2, y + 2, cz + 2, MAT.brass);
  b.add(cx - 3, y + 2, cz - 3, cx + 3, y + 3, cz + 3, MAT.darkStone);
  for (const [dx, dz] of [[-3, -3], [2, -3], [-3, 2], [2, 2]] as const) b.add(cx + dx, y + 3, cz + dz, cx + dx + 1, y + 5, cz + dz + 1, MAT.darkStone);
  b.add(cx - 2, y + 3, cz - 2, cx + 2, y + 5, cz + 2, MAT.brick);
  b.add(cx - 3, y + 5, cz - 3, cx + 3, y + 6, cz - 2, MAT.brass);
  b.add(cx - 3, y + 5, cz + 2, cx + 3, y + 6, cz + 3, MAT.brass);
  b.add(cx - 3, y + 5, cz - 2, cx - 2, y + 6, cz + 2, MAT.brass);
  b.add(cx + 2, y + 5, cz - 2, cx + 3, y + 6, cz + 2, MAT.brass);
  b.add(cx - 1, y + 5, cz - 1, cx + 1, y + 6, cz + 1, MAT.forgeCopper);
  return [cx, y + 6, cz];
}

/**
 * A square newel pier `L.pier` cells on a side, its lower corner at (x0, z0), founded at y = 0 and standing on a
 * ground of `base`: a grey plinth, a limestone shaft with long-and-short cream quoins, a sunk panel on its downhill
 * (+X) face carved with a rose, a darkStone cornice and a cream cushion. `plinthZ` bounds the plinth and cornice across
 * Z so neither steps out over the flight. Returns the cap's top.
 */
function pier(b: Boxes, x0: number, z0: number, base: number, top: number, plinthZ: readonly [number, number]): number {
  const s = L.pier, x1 = x0 + s, z1 = z0 + s;
  b.add(x0 - 1, 0, Math.max(plinthZ[0], z0 - 1), x1 + 1, base + 2, Math.min(plinthZ[1], z1 + 1), MAT.stone);
  b.add(x0, 0, z0, x1, top - 3, z1, MAT.limestone);
  // Quoins: three-cell courses, alternately long on the Z faces and long on the X faces.
  for (let y = base + 2, k = 0; y + 3 <= top - 3; y += 3, k++) {
    const [ax, az] = k % 2 ? [1, 2] : [2, 1];
    for (const [cx, sx] of [[x0, 1], [x1, -1]] as const) for (const [cz, sz] of [[z0, 1], [z1, -1]] as const) {
      const xa = sx > 0 ? cx : cx - ax, za = sz > 0 ? cz : cz - az;
      b.add(xa, y, sz > 0 ? cz : cz - 1, xa + ax, y + 3, sz > 0 ? cz + 1 : cz, MAT.cream);
      b.add(sx > 0 ? cx : cx - 1, y, za, sx > 0 ? cx + 1 : cx, y + 3, za + az, MAT.cream);
    }
  }
  // The sunk panel on the downhill face, and the rose carved in it: bloom, stem and two leaves.
  const p0 = base + 4, p1 = top - 6, pc = z0 + s / 2;
  if (p1 - p0 >= 8) {
    b.add(x1 - 1, p0, z0 + 2, x1, p1, z1 - 2, MAT.air);
    const bloom = p1 - 4;
    b.add(x1 - 1, bloom, pc - 1, x1, bloom + 2, pc + 1, MAT.petal);
    b.add(x1 - 1, bloom + 2, pc - 1, x1, bloom + 3, pc, MAT.petal);
    b.add(x1 - 1, p0 + 1, pc - 1, x1, bloom, pc, MAT.leaf);
    b.add(x1 - 1, p0 + 3, pc, x1, p0 + 4, pc + 1, MAT.leaf);
    b.add(x1 - 1, p0 + 5, pc - 2, x1, p0 + 6, pc - 1, MAT.leaf);
  }
  b.add(x0 - 1, top - 3, Math.max(plinthZ[0], z0 - 1), x1 + 1, top - 2, Math.min(plinthZ[1], z1 + 1), MAT.darkStone);
  b.add(x0, top - 2, z0, x1, top - 1, z1, MAT.limestone);
  b.add(x0 + 1, top - 1, z0 + 1, x1 - 1, top, z1 - 1, MAT.cream);
  return top;
}

/**
 * Rose bushes over a bed of soil whose top is `y`: on a jittered four-cell grid, a leaf mound three or four cells
 * across and two to four high, with a smaller lump on one shoulder so no bush reads as a cube, crowned with three
 * blooms (mostly pink, now and then violet or cream) and one more opening on the bush's sunny flank.
 */
function roses(b: Boxes, x0: number, x1: number, z0: number, z1: number, y: number, seed: number): void {
  const bloomOf = (r: number) => (r < 0.14 ? MAT.fabricViolet : r < 0.24 ? MAT.cream : MAT.petal);
  for (let gx = x0; gx < x1; gx += 4) for (let gz = z0; gz < z1; gz += 4) {
    const r = (salt: number) => hash(gx, gz, y + salt * 131, seed);
    if (r(0) < 0.08) continue;
    const w = Math.min(x1 - gx, 3 + Math.floor(r(1) * 2)), d = Math.min(z1 - gz, 3 + Math.floor(r(2) * 2)), h = 2 + Math.floor(r(3) * 3);
    if (w < 2 || d < 2) continue;
    const bx = Math.min(x1 - w, gx + Math.floor(r(4) * 2)), bz = Math.min(z1 - d, gz + Math.floor(r(5) * 2));
    b.add(bx, y, bz, bx + w, y + h, bz + d, MAT.leaf);
    // The shoulder lump, a cell higher or lower than the crown, on the bush's +X or +Z side.
    const lump = r(10) < 0.5, lh = Math.max(1, h + (r(11) < 0.5 ? 1 : -1));
    if (lump) b.add(bx + 1, y, bz + d - 1, bx + w, y + lh, Math.min(z1, bz + d + 1), MAT.leaf);
    else b.add(bx + w - 1, y, bz + 1, Math.min(x1, bx + w + 1), y + lh, bz + d, MAT.leaf);
    for (let k = 0; k < 3; k++) {
      const px = bx + Math.floor(r(20 + k) * w), pz = bz + Math.floor(r(30 + k) * d);
      b.add(px, y + h, pz, px + 1, y + h + 1, pz + 1, bloomOf(r(40 + k)));
    }
    const fz = bz + Math.floor(r(9) * d);
    if (h >= 3 && bx + w < x1) b.add(bx + w, y + h - 2, fz, bx + w + 1, y + h - 1, fz + 1, bloomOf(r(12)));
  }
}

/**
 * The landing and grand stair from the market up to the river hall's town door. See `HALL_LANDING` for the frame.
 *
 * Platform: x ∈ [0, 40) at the hall's bank level, paved in flags with a rose-compass inlay at its head; its first
 * 28 cells are left flat and clear across the door's zone for the hall's own steps and bench. Flight: from x = 40,
 * `riseCells / 2` treads of floor(60 / steps) cells with two-cell risers and darkStone nosings, the lowest tread
 * flush with the market. Either side, raised rose terraces step down with the flight between it and the stepped
 * parapets; newel piers carry fire baskets at the foot and at the platform's outer corners.
 */
export function createHallLanding(options: HallLandingOptions): HallLanding {
  const rise = options.riseCells, W = options.widthCells ?? 96;
  if (!Number.isInteger(rise) || rise % 2 || rise < 16 || rise > 48) throw new Error(`riseCells must be an even integer in 16–48, not ${rise}.`);
  if (!Number.isInteger(W) || W % 2 || W < 80 || W > 200) throw new Error(`widthCells must be an even integer in 80–200, not ${W}.`);

  const T = L.market + rise, steps = rise / L.riser, tread = Math.floor(L.run / steps), end = L.platform + steps * tread;
  const fz0 = L.terrace, fz1 = W - L.terrace, mid = W / 2;
  const treadX = (k: number) => L.platform + k * tread;
  const treadTop = (k: number) => T - L.riser * (k + 1);
  // Terrace tiers of about ten cells each; tier 0 starts on the platform beside the stair head.
  const per = Math.max(1, Math.round(10 / tread)), tierCount = Math.ceil(steps / per);
  const tiers = Array.from({ length: tierCount }, (_, i) => ({
    x0: i === 0 ? 30 : treadX(i * per),
    x1: i === tierCount - 1 ? end : treadX((i + 1) * per),
    top: (i === 0 ? T : treadTop(i * per - 1)) + L.bedRaise,
  }));
  const parapetTop = (i: number) => tiers[i]!.top + 6;
  const cornerTop = T + 14, footTop = L.market + 18;
  // The tallest thing is a corner basket: cap, then six cells of basket.
  const size: Vec3 = [end + L.foot, Math.max(cornerTop, footTop) + 6, W];
  const b = new Clipped(size);
  const sides = [{ s: 1, outer: 0 }, { s: -1, outer: W }] as const;
  /** A Z range measured inward from one side: [a, b) from the edge, mirrored for the far side. */
  const across = (side: (typeof sides)[number], a: number, c: number): [number, number] => (side.s > 0 ? [a, c] : [W - c, W - a]);

  // The foot: a grey kerb strip across the whole front, flush with the market, the masonry's edge in the square.
  b.add(end, 0, 1, end + L.foot, L.market, W - 1, MAT.stone);
  // A grey plinth course along both outer sides, two cells over the market, a cell proud of the parapets.
  b.add(0, 0, 0, end, L.market + 2, 1, MAT.stone);
  b.add(0, 0, W - 1, end, L.market + 2, W, MAT.stone);

  // Platform: solid to the bank, paved in flags laid in rows four cells deep.
  b.add(0, 0, 1, L.platform, T, W - 1, MAT.limestone);
  b.add(0, T - 1, 1, L.platform, T, W - 1, MAT.paving);
  for (let x = 0; x < L.platform; x += 4) flags(b, x, Math.min(L.platform, x + 4), T - 1, L.parapet, W - L.parapet, 17 + x);
  // The rose compass at the stair head: a darkStone diamond, brick petals, a cream heart and a brass boss.
  const cx = 34;
  for (let x = cx - 6; x < cx + 6; x++) {
    const row: number[] = [];
    for (let z = mid - 6; z < mid + 6; z++) {
      const d = Math.abs(x + 0.5 - cx) + Math.abs(z + 0.5 - mid);
      row.push(d <= 2.5 ? MAT.cream : d <= 5 ? MAT.brick : d <= 6 ? MAT.darkStone : MAT.air);
    }
    for (let i = 0; i < row.length;) {
      let e = i;
      while (e < row.length && row[e] === row[i]) e++;
      if (row[i] !== MAT.air) b.add(x, T - 1, mid - 6 + i, x + 1, T, mid - 6 + e, row[i]!);
      i = e;
    }
  }
  b.add(cx - 1, T - 1, mid - 1, cx + 1, T, mid + 1, MAT.brass);
  // The stair head's nosing along the platform's front edge.
  b.add(L.platform - 1, T - 1, fz0, L.platform, T, fz1, MAT.darkStone);

  // The flight: each tread solid to the ground, paved, with a darkStone nosing on its leading edge.
  for (let k = 0; k < steps; k++) {
    const x0 = treadX(k), x1 = x0 + tread, top = treadTop(k);
    b.add(x0, 0, fz0, x1, top, fz1, MAT.limestone);
    b.add(x0, top - 1, fz0, x1, top, fz1, MAT.paving);
    flags(b, x0, x1, top - 1, fz0, fz1, 401 + k);
    b.add(x1 - 1, top - 1, fz0, x1, top, fz1, MAT.darkStone);
  }

  for (const side of sides) {
    // Raised rose terraces: a limestone mass per tier with cream-capped kerbs round a bed of soil.
    for (const [i, t] of tiers.entries()) {
      const [z0, z1] = across(side, L.parapet, L.terrace);
      b.add(t.x0, 0, z0, t.x1, t.top, z1, MAT.limestone);
      b.add(t.x0, t.top - 1, z0, t.x1, t.top, z1, MAT.cream);
      const [s0, s1] = across(side, L.parapet, L.terrace - 2);
      const bx0 = i === 0 ? t.x0 + 2 : t.x0, bx1 = t.x1 - 2;
      b.add(bx0, t.top - 1, s0, bx1, t.top, s1, MAT.air);
      b.add(bx0, t.top - 3, s0, bx1, t.top - 1, s1, MAT.earth);
      roses(b, bx0, bx1, s0, s1, t.top - 1, 7 + i * 13 + (side.s > 0 ? 0 : 1000));
      // Roses spilling over each bed's front wall onto the next bed down, and over the last one into the square.
      const floor = i + 1 < tiers.length ? tiers[i + 1]!.top : L.market + 2;
      for (let n = 0; n < 2; n++) {
        // Along the parapet half of the bed, clear of the foot pier and the flight.
        const zz = side.s > 0 ? s0 + 1 + Math.floor(hash(i, n, side.outer, 77) * 5) : s1 - 3 - Math.floor(hash(i, n, side.outer, 77) * 5);
        const hang = 2 + Math.floor(hash(i, n, side.outer, 78) * 3), y0 = Math.max(floor, t.top - 1 - hang);
        if (t.x1 + 1 > size[0] || y0 >= t.top) continue;
        b.add(t.x1, y0, zz, t.x1 + 1, t.top, zz + 2, MAT.leaf);
        b.add(t.x1, y0, zz + (n % 2), t.x1 + 1, y0 + 1, zz + (n % 2) + 1, MAT.petal);
      }
    }
    // A grey plinth course at the foot of the last bed's face, a cell proud into the square.
    const [fz, fZ] = across(side, 1, L.terrace - L.pier);
    b.add(end, L.market, fz, end + 1, L.market + 2, fZ, MAT.stone);

    // Parapets: limestone on the outer edge with darkStone coping, stepping down tier by tier.
    const [pz0, pz1] = across(side, 1, L.parapet), [cz0, cz1] = across(side, 0, L.parapet + 1);
    const segments: [number, number, number][] = [[0, 32, T + 8], ...tiers.map((t, i): [number, number, number] => [Math.max(L.platform, t.x0), t.x1, parapetTop(i)])];
    for (const [x0, x1, top] of segments) {
      b.add(x0, 0, pz0, x1, top - 1, pz1, MAT.limestone);
      b.add(x0, top - 1, cz0, x1, top, cz1, MAT.darkStone);
      // A cream string course a cell under the coping, carried on the parapet's outer face.
      const [oz0, oz1] = across(side, 0, 1);
      b.add(x0, top - 3, oz0, x1, top - 2, oz1, MAT.cream);
    }
    // Where the parapet steps down it ends in a short pier, a course proud and two higher, capped dark.
    for (let i = 1; i < tiers.length; i++) {
      const x = tiers[i]!.x0, top = parapetTop(i - 1) + 2;
      const [qz0, qz1] = across(side, 0, L.parapet + 1);
      b.add(x - 3, 0, qz0, x, top - 1, qz1, MAT.limestone);
      b.add(x - 4, top - 1, qz0, x + 1, top, qz1, MAT.darkStone);
    }
    // The parapet's terminal at the foot, and its head where it meets the hall.
    {
      const top = parapetTop(tiers.length - 1) + 3, [qz0, qz1] = across(side, 0, L.parapet + 1);
      b.add(end - 5, 0, qz0, end, top - 1, qz1, MAT.limestone);
      b.add(end - 6, top - 1, qz0, end + 1, top, qz1, MAT.darkStone);
      b.add(end - 4, top, qz0 + 1, end - 1, top + 1, qz1 - 1, MAT.cream);
    }
  }

  // Newel piers and their fire baskets: two at the platform's outer corners, two flanking the foot of the flight.
  const fires: Vec3[] = [];
  for (const side of sides) {
    const [cz] = across(side, 1, 1 + L.pier);
    const capTop = pier(b, L.platform - L.pier, cz, T, cornerTop, [0, W]);
    fires.push(cresset(b, L.platform - L.pier / 2, capTop, cz + L.pier / 2));
  }
  for (const side of sides) {
    const [fz] = side.s > 0 ? [fz0 - L.pier] : [fz1];
    const capTop = pier(b, end - L.pier, fz, L.market, footTop, side.s > 0 ? [0, fz0] : [fz1, W]);
    fires.push(cresset(b, end - L.pier / 2, capTop, fz + L.pier / 2));
  }

  const blueprint: VoxelBlueprint = {
    version: 1, id: `genesis-pinkkitty-landing-r${rise}-w${W}`, styleId: StyleIdSchema.parse(STYLES.hearth.id), kind: 'civic', lattice: 'build',
    size: [...size], boxes: b.list, windows: [],
  };
  return { blueprint, platformCells: L.platform, flightCells: end - L.platform, fires, size };
}

// ── Glass screen ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface GlassScreen {
  readonly blueprint: VoxelBlueprint;
  /** Where the glass unit's own (0, 0, 0) corner goes in the screen's local cells. */
  readonly glassOffset: Vec3;
  /** Flame base of the lamp basket behind the glass. */
  readonly fires: readonly Vec3[];
  readonly size: Vec3;
}

/** The screen's fixed proportions, in build cells. y = 0 is the market floor the screen stands on. */
export const GLASS_SCREEN = {
  /** Wall thickness: the glass unit's frame depth, so its frame face is flush with the wall's front. */
  wall: 6,
  /** Solid jamb either side of the opening. */
  jamb: 8,
  /** The glass unit's sill course rides this high over the market. */
  sill: 8,
  /** The rear step and lamp sit behind the wall; the seats and buttresses in front. */
  back: 10,
  front: 11,
  /** The roof's overhang past the wall's ends and faces. */
  eaves: 3,
} as const;

/** The unit's occupancy, flattened along Z over its wall depth: 1 where any cell in z ∈ [0, depth) is solid. */
function unitColumns(glass: EmoteGlass, depth: number): { mask: Uint8Array; w: number; h: number } {
  const [w, h, d] = glass.blueprint.size;
  const cells = new Uint16Array(w * h * d);
  for (const box of glass.blueprint.boxes) {
    for (let z = box.from[2]; z < box.to[2]; z++) for (let y = box.from[1]; y < box.to[1]; y++) {
      cells.fill(box.material, box.from[0] + w * (y + h * z), box.to[0] + w * (y + h * z));
    }
  }
  const mask = new Uint8Array(w * h);
  for (let z = 0; z < Math.min(depth, d); z++) for (let i = 0; i < w * h; i++) if (cells[i + w * h * z]) mask[i] = 1;
  return { mask, w, h };
}

/**
 * A free-standing market screen wall holding a stained-glass window unit: a limestone wall six cells thick with
 * its opening sized to `glass.opening`, a two-step grey plinth in front for sitting and leaving things on, short
 * set-off buttresses front and back, a timber-framed plaster gable under a terracotta roof with timber barges and
 * a brass-knobbed finial, a climbing rose on one flank, and a bracketed iron fire basket behind the glass so a host
 * flame lights it from the back. Front is +Z.
 *
 * The opening: the wall is cut away wherever the unit has stone or glass, so the unit drops in without a single
 * shared cell, and the wall keeps the spandrels the lancet's surround leaves empty above its arch, so the wall
 * and the unit together close the opening with no gap to see through.
 */
export function createGlassScreen(glass: EmoteGlass): GlassScreen {
  const G = GLASS_SCREEN;
  const [OW, OH] = glass.opening, [UW, UH, UD] = glass.blueprint.size;
  if (UW !== OW || UH !== OH) throw new Error(`The glass unit ${glass.blueprint.id} is ${UW}×${UH} but asks for a ${OW}×${OH} opening.`);
  if (UD > G.wall + 1) throw new Error(`The glass unit ${glass.blueprint.id} is ${UD} cells deep; the screen holds units up to ${G.wall + 1}.`);

  const WX0 = G.eaves + 1, WX1 = WX0 + OW + 2 * G.jamb, gx = WX0 + G.jamb, gy = G.sill;
  const zb = G.back, zf = zb + G.wall, mid = (WX0 + WX1) / 2;
  const S = gy + OH + 3, R = (WX1 - WX0) / 2;
  const size: Vec3 = [WX1 + G.eaves + 1, S + R + 9, zf + G.front];
  const b = new Clipped(size);

  // Plinth: the rear step the lamp stands on, then the two front steps between and before the buttresses.
  b.add(WX0 - 2, 0, 0, WX1 + 2, 4, zb, MAT.stone);
  b.add(WX0 - 2, 3, 0, WX1 + 2, 4, 1, MAT.cream);
  b.add(WX0 - 2, 0, zf, WX1 + 2, 4, zf + G.front, MAT.stone);
  b.add(WX0 - 2, 3, zf + G.front - 1, WX1 + 2, 4, zf + G.front, MAT.cream);
  b.add(WX0 + 6, 0, zf, WX1 - 6, 7, zf + 5, MAT.stone);
  b.add(WX0 + 6, 6, zf + 4, WX1 - 6, 7, zf + 5, MAT.cream);
  // A grey base course round the wall's foot.
  b.add(WX0 - 1, 0, zb - 1, WX1 + 1, 4, zf + 1, MAT.stone);

  // The wall to the shoulder, then the opening: cut wherever the unit has a cell, kept in its empty spandrels.
  b.add(WX0, 0, zb, WX1, S, zf, MAT.limestone);
  b.add(gx, gy, zb, gx + OW, gy + OH, zf, MAT.air);
  const { mask, w } = unitColumns(glass, G.wall);
  let open: { from: number; runs: string; list: [number, number][] } | null = null;
  const flush = (to: number) => {
    if (open) for (const [x0, x1] of open.list) b.add(gx + x0, gy + open.from, zb, gx + x1, gy + to, zf, MAT.limestone);
    open = null;
  };
  for (let y = 0; y < OH; y++) {
    const list: [number, number][] = [];
    for (let x = 0; x < OW;) {
      if (mask[x + w * y]) { x++; continue; }
      let e = x;
      while (e < OW && !mask[e + w * y]) e++;
      list.push([x, e]);
      x = e;
    }
    const runs = list.map(r => r.join('-')).join(',');
    if (open && open.runs === runs) continue;
    flush(y);
    if (list.length) open = { from: y, runs, list };
  }
  flush(OH);
  // The unit's sill line carried across the jambs in cream, and a darkStone string at the shoulder.
  b.add(WX0 + 6, gy + 2, zf, gx + 1, gy + 3, zf + 1, MAT.cream);
  b.add(gx + OW - 1, gy + 2, zf, WX1 - 6, gy + 3, zf + 1, MAT.cream);
  b.add(WX0 - 1, S - 2, zb - 1, WX1 + 1, S - 1, zf + 1, MAT.darkStone);
  // Long-and-short cream quoins up the wall's four corners above the buttresses.
  for (let y = 48, k = 0; y + 3 <= S - 2; y += 3, k++) {
    const along = k % 2 ? 2 : 4;
    for (const [x0, x1] of [[WX0, WX0 + along], [WX1 - along, WX1]] as const) {
      b.add(x0, y, zb, x1, y + 3, zb + 1, MAT.cream);
      b.add(x0, y, zf - 1, x1, y + 3, zf, MAT.cream);
    }
  }

  // Buttresses at the wall's ends, front and back, in three stages with cream weatherings.
  for (const [x0, x1] of [[WX0, WX0 + 6], [WX1 - 6, WX1]] as const) {
    for (const dir of [1, -1] as const) {
      const face = dir > 0 ? zf : zb;
      const span = (d: number): [number, number] => (dir > 0 ? [face, face + d] : [face - d, face]);
      for (const [y0, y1, d] of [[0, 26, 9], [26, 46, 6], [46, 58, 3]] as const) {
        const [z0, z1] = span(d);
        b.add(x0, y0, z0, x1, y1, z1, MAT.limestone);
        const [w0, w1] = span(d - 1);
        b.add(x0, y1, w0, x1, y1 + 1, w1, MAT.cream);
      }
    }
  }

  // The gable: a timber tie beam, plaster infill a cell back from both faces, a king post and two raking struts.
  b.add(WX0 - 1, S, zb - 1, WX1 + 1, S + 2, zf + 1, MAT.timber);
  for (let r = 2; r < R; r++) b.add(WX0 + r, S + r, zb + 1, WX1 - r, S + r + 1, zf - 1, MAT.plaster);
  for (let r = 2; r < R; r++) for (const z of [zb, zf - 1]) {
    b.add(WX0 + r, S + r, z, WX0 + r + 1, S + r + 1, z + 1, MAT.timber);
    b.add(WX1 - r - 1, S + r, z, WX1 - r, S + r + 1, z + 1, MAT.timber);
  }
  b.add(mid - 1, S + 2, zb, mid + 1, S + R, zf, MAT.timber);
  for (let t = 0; mid - 3 - t >= WX0 + 2 + t; t++) {
    b.add(mid - 3 - t, S + 2 + t, zb, mid - 1 - t, S + 3 + t, zb + 1, MAT.timber);
    b.add(mid + 1 + t, S + 2 + t, zb, mid + 3 + t, S + 3 + t, zb + 1, MAT.timber);
    b.add(mid - 3 - t, S + 2 + t, zf - 1, mid - 1 - t, S + 3 + t, zf, MAT.timber);
    b.add(mid + 1 + t, S + 2 + t, zf - 1, mid + 3 + t, S + 3 + t, zf, MAT.timber);
  }
  // The roof: a three-cell terracotta shell rising a cell per cell, overhanging the wall's ends and both faces.
  const rz0 = zb - G.eaves - 1, rz1 = zf + G.eaves + 1;
  for (let r = 0; r <= R + 1; r++) {
    b.add(WX0 - G.eaves + r, S + r, rz0, WX0 + r, S + r + 1, rz1, MAT.terracotta);
    b.add(WX1 - r, S + r, rz0, WX1 + G.eaves - r, S + r + 1, rz1, MAT.terracotta);
  }
  b.add(mid - 2, S + R + 2, rz0 + 1, mid + 2, S + R + 3, rz1 - 1, MAT.brick);
  // Timber barges: the lowest tile of every column on both faces, so the verge reads as a board along the slope.
  for (let c = -G.eaves; c < R; c++) for (const z of [rz0, rz1 - 1]) {
    const y = S + Math.max(0, c + 1);
    b.add(WX0 + c, y, z, WX0 + c + 1, y + 1, z + 1, MAT.timber);
    b.add(WX1 - 1 - c, y, z, WX1 - c, y + 1, z + 1, MAT.timber);
  }
  // A timber finial with a brass knob over each gable.
  for (const z of [rz0, rz1 - 2]) {
    b.add(mid - 1, S + R + 3, z, mid + 1, S + R + 7, z + 2, MAT.timber);
    b.add(mid - 1, S + R + 7, z, mid + 1, S + R + 9, z + 2, MAT.brass);
  }
  // Timber brackets under the eaves at the four corners.
  for (const x of [WX0 - 2, WX1]) for (const z of [zb - 1, zf]) {
    b.add(x, S - 4, z, x + 2, S, z + 1, MAT.timber);
  }

  // The lamp behind the glass: a stone pedestal on the rear step, an iron standard braced back into the wall below
  // the opening, a brass ring on the stay, and the fire basket on top at a third of the window's height.
  const lz = zb - 6, lampTop = gy + 14;
  b.add(mid - 2, 4, lz - 2, mid + 2, 7, lz + 2, MAT.stone);
  b.add(mid - 3, 4, lz - 3, mid + 3, 5, lz + 3, MAT.stone);
  b.add(mid - 1, 7, lz - 1, mid + 1, lampTop, lz + 1, MAT.darkStone);
  b.add(mid - 1, gy - 3, lz + 1, mid + 1, gy - 2, zb, MAT.darkStone);
  b.add(mid - 1, gy - 4, lz + 3, mid + 1, gy - 1, lz + 4, MAT.brass);
  b.add(mid - 1, lampTop - 3, lz + 1, mid + 1, lampTop - 2, lz + 3, MAT.darkStone);
  b.add(mid - 1, lampTop - 2, lz + 2, mid + 1, lampTop, lz + 3, MAT.darkStone);
  const fires = [cresset(b, mid, lampTop, lz)];

  // A climbing rose up the left flank, rooted at the base course and clinging to the buttress and wall.
  for (let y = 4; y < 40; y++) {
    const spread = 2 + Math.floor(hash(y, 3, 5, 91) * 3) + (y < 24 ? 2 : 0), centre = zf + 1 + Math.round(2 * Math.sin(y / 5));
    const z0 = Math.max(zb, centre - spread), z1 = Math.min(zf + 9, centre + spread);
    if (y > 34 && hash(y, 1, 1, 92) < 0.4) continue;
    b.add(WX0 - 1, y, z0, WX0, y + 1, z1, MAT.leaf);
    if (hash(y, 2, 2, 93) < 0.45) {
      const z = z0 + Math.floor(hash(y, 4, 4, 94) * (z1 - z0));
      b.add(WX0 - 2, y, z, WX0 - 1, y + 1, z + 1, hash(y, 5, 5, 95) < 0.18 ? MAT.fabricViolet : MAT.petal);
    }
  }

  const blueprint: VoxelBlueprint = {
    version: 1, id: `genesis-pinkkitty-glass-screen-${glass.blueprint.id}`, styleId: StyleIdSchema.parse(STYLES.hearth.id), kind: 'civic', lattice: 'build',
    size: [...size], boxes: b.list, windows: [],
  };
  return { blueprint, glassOffset: [gx, gy, zb], fires, size };
}
