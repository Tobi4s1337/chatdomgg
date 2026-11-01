import { StyleIdSchema, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '../../../materials';
import { Boxes, hash } from '../../../genesis-landmarks/kit';

/**
 * PinkKittyRose's river town: The Lantern and Oar, the tavern on the town bank a short walk from the market square,
 * where chat gathers. A two-storey Hearth inn: a limestone ground storey on a grey plinth, a timber-framed plaster
 * upper storey jettied out over the street on a carved bressummer, and a steep terracotta roof, half-hipped at the
 * east end, with a dormer on its front slope. A cross-wing gable stands forward of the front, its own upper storey
 * and gable each jettied again over a canted bay window carried up to the jetty, with a timber oriel above it.
 *
 * The big limestone stack climbs the west gable, crooked at the head, with a smaller kitchen chimney on the back
 * slope. The front door sits under the jetty behind an open gabled porch on two posts, rose-twined, with a caged
 * lantern hanging off each end of its tie beam. An iron bracket off the west corner carries the hanging sign, a
 * lantern crossed with an oar on a dark board with a violet border, lit by its own small lamp. A bench sits under
 * the front window, ale barrels lie racked and stand by the east yard beside the cellar flaps, and the back stands
 * on a stone quay with a timber jetty stub and two mooring posts over the river.
 *
 * The kingdom's colours stay a touch: violet shutters and the sign's border, roses in the window boxes and on the
 * porch. Every pane is unlit glass over a dark room: a lit window in Chatdom is a person, and this land is unfounded.
 * The lanterns are place lights, and `fires` names their flame bases so a host can burn them.
 */

export interface LanternAndOar {
  /** The whole building, porch, sign, barrels, bench and jetty. */
  readonly blueprint: VoxelBlueprint;
  /** Cells. */
  readonly size: Vec3;
  /**
   * Local frame: front (door) faces +Z, the river side is −Z. Street ground is y = GROUND. y = 0 is the foot of the
   * jetty's piles and the stone quay, three metres below the street, so they reach the river bed; the rest of the
   * masonry is founded a metre into the ground (from y = GROUND − 8).
   */
  readonly ground: number;
  /** Door threshold centre on the ground in front of the door, cells; the keeper stands here facing −Z to the door. */
  readonly door: Vec3;
  /** Hanging sign board centre, cells. */
  readonly sign: Vec3;
  /** Flame bases of the door lanterns (and any other place lamps), cells. */
  readonly fires: readonly Vec3[];
  /** Barrel tops and the bench seat centre, cells. */
  readonly barrel: Vec3;
  readonly bench: Vec3;
  /** Mooring post tops on the jetty, cells. */
  readonly moorings: readonly Vec3[];
  /** The masonry/ground footprint rectangle of the building incl. porch (not jetty), cells: [x0,z0,x1,z1]. */
  readonly footprint: readonly [number, number, number, number];
  /** The jetty rectangle, cells, which stands over water/bank: [x0,z0,x1,z1]. */
  readonly jetty: readonly [number, number, number, number];
}

/**
 * The inn's measured planes, shared by the factory and its tests. Build cells: X across the front (west to east),
 * Y up, Z from the river (−Z) to the street (+Z).
 */
export const LANTERN_AND_OAR = {
  size: [158, 140, 140] as const,
  ground: 24,
  /** The masonry's footing, a metre under the street. */
  found: 16,
  /** The ground storey's outer faces. */
  body: { x: [26, 138] as const, z: [34, 114] as const },
  wall: 4,
  /** Top of the ground storey (the jetty soffit), the floor beam above it, the upper storey and the eaves. */
  storey: 50,
  upper: [52, 76] as const,
  eaves: 76,
  /** The upper storey's front face, jettied six cells over the street. */
  jettyFront: 120,
  /** The cross-wing: its ground storey's front face, its jettied upper storey's, and its jettied gable's. */
  wing: { x: [90, 130] as const, front: 126, upper: 132, gable: 134 },
  bay: { x: [98, 122] as const, depth: 6 },
  porch: { roof: [58, 82] as const, posts: [60, 78] as const, z: [127, 129] as const, tie: 42, front: 131 },
  door: { x: [64, 76] as const, height: 20, leaf: 110 },
  /** The east yard where the barrels and the cellar flaps stand. */
  yard: { x: [138, 156] as const, z: [58, 124] as const },
  quay: { x: [24, 140] as const, z: [31, 35] as const },
  deck: { x: [84, 124] as const, z: [2, 31] as const },
  /** The main roof: eaves overhang front and back, verge past the gables, and the row where the east hip begins. */
  roof: { front: 124, back: 30, west: 23, east: 141, hip: 28, ridgeRow: 41 },
} as const;

const T = LANTERN_AND_OAR;
const G = T.ground, FOUND = T.found, E = T.eaves;
const [U0, U1] = T.upper;
const [BX0, BX1] = T.body.x, [BZ0, BZ1] = T.body.z;
const [WX0, WX1] = T.wing.x;

/** Boxes clipped to the piece's bounds. */
class Clipped extends Boxes {
  constructor(private readonly size: readonly number[]) { super(); }
  override add(x: number, y: number, z: number, X: number, Y: number, Z: number, material: number): void {
    super.add(Math.max(0, x), Math.max(0, y), Math.max(0, z), Math.min(this.size[0]!, X), Math.min(this.size[1]!, Y), Math.min(this.size[2]!, Z), material);
  }
}

// ── Faces ────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A wall face: its outer surface lies on `plane` across `axis` and `out` points outward. Depths count inward from
 * the outer surface (negative depths stand proud); `u` runs along the face (X on a Z face, Z on an X face).
 */
interface Face { readonly axis: 'x' | 'z'; readonly plane: number; readonly out: 1 | -1 }

function slab(b: Boxes, f: Face, d0: number, d1: number, u0: number, u1: number, y0: number, y1: number, m: number): void {
  const [p0, p1] = f.out === 1 ? [f.plane - d1, f.plane - d0] : [f.plane + d0, f.plane + d1];
  if (f.axis === 'x') b.add(p0, y0, u0, p1, y1, u1, m);
  else b.add(u0, y0, p0, u1, y1, p1, m);
}

/**
 * A timber line `w` cells wide on a face from (ua, ya) to (ub, yb − 1): a path of face-joined cells that keeps
 * closest to the true line, drawn as its straight runs so a brace costs a box per step of its slope.
 */
function line(b: Boxes, f: Face, d0: number, d1: number, ua: number, ya: number, ub: number, yb: number, w: number, m: number): void {
  const y1 = yb - 1, du = ub - ua, dy = y1 - ya, cells: [number, number][] = [[ua, ya]];
  // A steep line two or more cells wide is joined by its own width: one box per column it passes.
  if (w >= 2 && Math.abs(du) <= dy) {
    const at = (y: number) => Math.round(ua + (du * (y - ya)) / Math.max(1, dy));
    for (let y = ya, start = ya; y <= y1; y++) {
      if (y < y1 && at(y + 1) === at(start)) continue;
      slab(b, f, d0, d1, at(start), at(start) + w, start, y + 1, m);
      start = y + 1;
    }
    return;
  }
  const err = (u: number, y: number) => Math.abs((u - ua) * dy - (y - ya) * du);
  for (let u = ua, y = ya; u !== ub || y !== y1;) {
    const su = Math.sign(ub - u), sy = Math.sign(y1 - y);
    if (su && (!sy || err(u + su, y) <= err(u, y + sy))) u += su;
    else y += sy;
    cells.push([u, y]);
  }
  for (let i = 0; i < cells.length;) {
    const [u, y] = cells[i]!;
    let j = i;
    if (cells[i + 1]?.[0] === u) {
      while (cells[j + 1]?.[0] === u) j++;
      slab(b, f, d0, d1, u, u + w, Math.min(y, cells[j]![1]), Math.max(y, cells[j]![1]) + 1, m);
    } else {
      while (cells[j + 1]?.[1] === y) j++;
      slab(b, f, d0, d1, Math.min(u, cells[j]![0]), Math.max(u, cells[j]![0]) + w, y, y + 1, m);
    }
    i = j + 1;
  }
}

const FRONT: Face = { axis: 'z', plane: BZ1, out: 1 };
const FRONT_UP: Face = { axis: 'z', plane: T.jettyFront, out: 1 };
const BACK: Face = { axis: 'z', plane: BZ0, out: -1 };
const WEST: Face = { axis: 'x', plane: BX0, out: -1 };
const EAST: Face = { axis: 'x', plane: BX1, out: 1 };
const WING_FRONT: Face = { axis: 'z', plane: T.wing.front, out: 1 };
const WING_UP: Face = { axis: 'z', plane: T.wing.upper, out: 1 };
const WING_WEST: Face = { axis: 'x', plane: T.wing.x[0], out: -1 };
const WING_EAST: Face = { axis: 'x', plane: T.wing.x[1], out: 1 };
const WING_GABLE: Face = { axis: 'z', plane: T.wing.gable, out: 1 };

// ── The main roof's rows ─────────────────────────────────────────────────────────────────────────────────────────

/** How far row r of the main roof has climbed in from its eaves: a two-cell kick for three rows, then 45°. */
const inset = (r: number) => (r < 3 ? 2 * r : r + 3);
const roofFront = (r: number) => T.roof.front - inset(r);
const roofBack = (r: number) => T.roof.back + inset(r);
/** The east end of row r: the gable's verge, stepping back a cell a row over the half-hip. */
const roofEast = (r: number) => T.roof.east - Math.max(0, r - T.roof.hip);
const RIDGE = E + T.roof.ridgeRow;

// ── Ground storey ────────────────────────────────────────────────────────────────────────────────────────────────

/** Long-and-short cream quoins up a corner: face a runs away from the corner along +sa, face b along +sb. */
function quoins(b: Boxes, fa: Face, ua: number, sa: 1 | -1, fb: Face, ub: number, sb: 1 | -1, y0: number, y1: number): void {
  for (let y = y0, k = 0; y + 3 <= y1; y += 3, k++) {
    const la = k % 2 ? 2 : 4, lb = k % 2 ? 4 : 2;
    slab(b, fa, 0, 1, sa > 0 ? ua : ua - la, sa > 0 ? ua + la : ua, y, y + 3, MAT.cream);
    slab(b, fb, 0, 1, sb > 0 ? ub : ub - lb, sb > 0 ? ub + lb : ub, y, y + 3, MAT.cream);
  }
}

/** Odd stones in the limestone, in two-cell courses: grey and cream, by hash, so the wall reads as laid blocks. */
function ashlar(b: Boxes, f: Face, u0: number, u1: number, y0: number, y1: number, seed: number): void {
  const n = Math.floor((u1 - u0) / 7);
  for (let i = 0; i < n; i++) {
    const length = 3 + Math.floor(hash(i, 3, seed, 41) * 4);
    const u = u0 + 1 + Math.floor(hash(i, 1, seed, 41) * Math.max(1, u1 - u0 - length - 2));
    const y = y0 + 2 * Math.floor(hash(i, 2, seed, 41) * Math.floor((y1 - y0) / 2));
    if (y + 2 > y1) continue;
    slab(b, f, 0, 1, u, u + length, y, y + 2, hash(i, 4, seed, 41) < 0.62 ? MAT.stone : MAT.cream);
  }
}

/**
 * A stone-dressed window on a ground storey face: cream surround a cell proud, a projecting sill and a drip mould,
 * glass two cells in behind cream mullions (one per four-cell light) and a transom, open to the room behind.
 */
function stoneWindow(b: Boxes, f: Face, u0: number, u1: number, y0: number, y1: number): void {
  slab(b, f, -1, 0, u0 - 1, u1 + 1, y0 - 1, y1 + 1, MAT.cream);
  slab(b, f, -1, 6, u0, u1, y0, y1, MAT.air);
  slab(b, f, 2, 3, u0, u1, y0, y1, MAT.glass);
  for (let u = u0 + 4; u + 4 <= u1; u += 5) slab(b, f, 1, 3, u, u + 1, y0, y1, MAT.cream);
  const transom = y0 + Math.round((y1 - y0) * 0.66);
  slab(b, f, 1, 3, u0, u1, transom, transom + 1, MAT.cream);
  slab(b, f, -2, 1, u0 - 2, u1 + 2, y0 - 2, y0, MAT.cream);
  slab(b, f, -2, 0, u0 - 2, u1 + 2, y1 + 1, y1 + 2, MAT.cream);
  slab(b, f, -2, 0, u0 - 2, u0 - 1, y1 - 1, y1 + 1, MAT.cream);
  slab(b, f, -2, 0, u1 + 1, u1 + 2, y1 - 1, y1 + 1, MAT.cream);
}

/**
 * A door in a stone wall: an opening `height` tall carved to the leaf two cells in, a timber case a cell proud with a
 * heavy lintel, and the leaf: planks with dark battens, strap hinges, studs and a brass ring. Returns nothing; the
 * threshold is the floor.
 */
function door(b: Boxes, f: Face, u0: number, u1: number, height: number): void {
  slab(b, f, -1, 0, u0 - 2, u1 + 2, G, G + height + 2, MAT.timber);
  slab(b, f, -1, 4, u0 - 2, u1 + 2, G + height, G + height + 2, MAT.timber);
  slab(b, f, -1, 3, u0, u1, G, G + height, MAT.air);
  slab(b, f, 3, 4, u0, u1, G, G + height, MAT.timber);
  for (let u = u0 + 2; u < u1 - 1; u += 3) slab(b, f, 3, 4, u, u + 1, G, G + height, MAT.bark);
  for (const y of [G + 4, G + height - 5]) slab(b, f, 2, 3, u0, u0 + Math.round((u1 - u0) * 0.7), y, y + 1, MAT.darkStone);
  const mid = Math.round((u0 + u1) / 2);
  slab(b, f, 2, 3, mid + 2, mid + 4, G + 9, G + 11, MAT.brass);
  slab(b, f, 3, 4, u0, u1, G - 1, G, MAT.stone);
}

// ── Upper storey ─────────────────────────────────────────────────────────────────────────────────────────────────

interface UpperWindow { readonly u0: number; readonly u1: number; readonly shutters?: boolean; readonly box?: boolean }

/** Window lights in a timber frame: from the sill rail to the head rail. */
const WIN = { sill: 62, head: 72 } as const;

/**
 * Close timber framing on an upper storey face between u0 and u1: sole and wall plates, two-cell posts at the
 * corners, the window jambs and no more than twelve cells apart, sill and head rails under and over each window, and
 * a pair of braces in every blank panel, rising to its middle or falling from it in turn. The plaster stands a cell
 * back, so every timber is proud of it. Windows are carved through to the room, glazed three cells in.
 */
function framed(b: Boxes, f: Face, u0: number, u1: number, windows: readonly UpperWindow[]): void {
  slab(b, f, 0, 1, u0, u1, U0, U0 + 2, MAT.timber);
  slab(b, f, 0, 1, u0, u1, U1 - 2, U1, MAT.timber);
  const posts = new Set<number>([u0, u1 - 2]);
  for (const w of windows) { posts.add(w.u0 - 2); posts.add(w.u1); }
  const sorted = [...posts].sort((a, c) => a - c), all: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    all.push(sorted[i]!);
    const next = sorted[i + 1];
    if (next === undefined) continue;
    const gap = next - sorted[i]! - 2, inside = windows.some(w => w.u0 >= sorted[i]! + 2 && w.u1 <= next);
    if (inside) continue;
    const parts = Math.ceil(gap / 12);
    for (let k = 1; k < parts; k++) all.push(sorted[i]! + 2 + Math.round((gap * k) / parts) - 1);
  }
  all.sort((a, c) => a - c);
  for (const p of all) slab(b, f, 0, 1, p, p + 2, U0 + 2, U1 - 2, MAT.timber);
  for (let i = 0; i + 1 < all.length; i++) {
    const a = all[i]! + 2, c = all[i + 1]!;
    if (c - a < 4) continue;
    const win = windows.find(w => w.u0 >= a && w.u1 <= c);
    if (win) continue;
    const mid = Math.round((a + c) / 2) - 1;
    if ((i + Math.floor(a / 7)) % 2) {
      line(b, f, 0, 1, a, U0 + 2, mid, U1 - 2, 2, MAT.timber);
      line(b, f, 0, 1, c - 2, U0 + 2, mid, U1 - 2, 2, MAT.timber);
    } else {
      line(b, f, 0, 1, mid, U0 + 2, a, U1 - 2, 2, MAT.timber);
      line(b, f, 0, 1, mid, U0 + 2, c - 2, U1 - 2, 2, MAT.timber);
    }
  }
  for (const w of windows) {
    slab(b, f, 0, 1, w.u0, w.u1, WIN.sill - 2, WIN.sill, MAT.timber);
    slab(b, f, -1, 0, w.u0 - 1, w.u1 + 1, WIN.sill - 1, WIN.sill, MAT.timber);
    slab(b, f, 0, 1, w.u0, w.u1, WIN.head, U1 - 2, MAT.timber);
    slab(b, f, 0, 6, w.u0, w.u1, WIN.sill, WIN.head, MAT.air);
    slab(b, f, 3, 4, w.u0, w.u1, WIN.sill, WIN.head, MAT.glass);
    const mid = Math.round((w.u0 + w.u1) / 2);
    if (w.u1 - w.u0 >= 10) slab(b, f, 1, 3, mid - 1, mid + 1, WIN.sill, WIN.head, MAT.timber);
    slab(b, f, 2, 3, w.u0, w.u1, WIN.sill + 6, WIN.sill + 7, MAT.timber);
    // A short stud under the middle of the sill.
    slab(b, f, 0, 1, mid - 1, mid + 1, U0 + 2, WIN.sill - 2, MAT.timber);
    if (w.shutters) shutters(b, f, w.u0, w.u1);
    if (w.box) windowBox(b, f, w.u0, w.u1, WIN.sill - 1, 23 + w.u0);
  }
}

/** A pair of violet shutters folded back beside a window, a cell proud, with timber ledges and an iron hinge each. */
function shutters(b: Boxes, f: Face, u0: number, u1: number): void {
  const w = Math.min(6, Math.floor((u1 - u0) / 2));
  for (const [s0, s1] of [[u0 - w - 1, u0 - 1], [u1 + 1, u1 + w + 1]] as const) {
    slab(b, f, -1, 0, s0, s1, WIN.sill, WIN.head, MAT.fabricViolet);
    for (const y of [WIN.sill + 2, WIN.head - 3]) slab(b, f, -1, 0, s0, s1, y, y + 1, MAT.timber);
    slab(b, f, -2, -1, s0 === u0 - w - 1 ? s1 - 1 : s0, s0 === u0 - w - 1 ? s1 : s0 + 1, WIN.sill + 4, WIN.sill + 6, MAT.darkStone);
  }
}

/**
 * A window box on two brackets whose top is `top`: a timber trough three cells out, soil, a mound of leaf with rose
 * blooms (mostly pink, the odd violet and cream), and leaf trailing over its front edge in a few places.
 */
function windowBox(b: Boxes, f: Face, u0: number, u1: number, top: number, seed: number): void {
  slab(b, f, -4, 0, u0 - 1, u1 + 1, top - 3, top, MAT.timber);
  slab(b, f, -3, -1, u0, u1, top - 1, top, MAT.earth);
  for (const u of [u0, u1 - 1]) slab(b, f, -2, 0, u, u + 1, top - 5, top - 3, MAT.darkStone);
  for (let u = u0; u < u1; u += 2) {
    const h = 1 + Math.floor(hash(u, top, seed, 61) * 3);
    slab(b, f, -4, -1, u, Math.min(u1, u + 2), top, top + h, MAT.leaf);
    const r = hash(u, top, seed, 62);
    const bloom = r < 0.16 ? MAT.fabricViolet : r < 0.26 ? MAT.cream : MAT.petal;
    if (hash(u, top, seed, 63) < 0.8) slab(b, f, -4 + Math.floor(hash(u, 1, seed, 64) * 2), -2 + Math.floor(hash(u, 1, seed, 64) * 2), u + (r < 0.5 ? 0 : 1), u + (r < 0.5 ? 1 : 2), top + h, top + h + 1, bloom);
    if (hash(u, top, seed, 65) < 0.35) {
      const hang = 2 + Math.floor(hash(u, top, seed, 66) * 3);
      slab(b, f, -5, -4, u, u + 1, top - 1 - hang, top + 1, MAT.leaf);
      if (hash(u, top, seed, 67) < 0.6) slab(b, f, -5, -4, u, u + 1, top - 1 - hang, top - hang, MAT.petal);
    }
  }
}

// ── Lanterns ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A caged lantern five cells square on a brass foot whose underside is `y`: iron corner bars, glass on all four sides
 * round a cream candle, a stepped brass hood and an iron hanger ring at y + 9. The candle's flame is the host's
 * fire; the returned flame base is the air cell over the wick, centred.
 */
function lantern(b: Boxes, cx: number, y: number, cz: number): Vec3 {
  b.add(cx, y - 1, cz, cx + 1, y, cz + 1, MAT.brass);
  b.add(cx - 2, y, cz - 2, cx + 3, y + 1, cz + 3, MAT.brass);
  b.add(cx - 2, y + 1, cz - 2, cx + 3, y + 6, cz + 3, MAT.glass);
  b.add(cx - 1, y + 1, cz - 1, cx + 2, y + 6, cz + 2, MAT.air);
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) b.add(cx + dx, y + 1, cz + dz, cx + dx + 1, y + 6, cz + dz + 1, MAT.darkStone);
  b.add(cx, y + 1, cz, cx + 1, y + 3, cz + 1, MAT.cream);
  b.add(cx - 2, y + 6, cz - 2, cx + 3, y + 7, cz + 3, MAT.brass);
  b.add(cx - 1, y + 7, cz - 1, cx + 2, y + 8, cz + 2, MAT.brass);
  b.add(cx, y + 8, cz, cx + 1, y + 9, cz + 1, MAT.darkStone);
  return [cx + 0.5, y + 3, cz + 0.5];
}

// ── The sign ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The sign's painted field, 16 × 14 cells, top row first. */
const SIGN_W = 16, SIGN_H = 14;

/**
 * The motif: a brass-hooded lantern with cream lights and a flame, hung in front of an oar that crosses the board
 * from its grip at the top right to a broad blade at the bottom left, a cell of field kept clear round the lantern so
 * the two read apart. Letters: k brass, c cream light, o flame, a oar, '.' field.
 */
export function signMotif(): string[] {
  const grid = Array.from({ length: SIGN_H }, () => Array<string>(SIGN_W).fill('.'));
  // The oar: a two-cell shaft along the diagonal, the blade an ellipse along the same line near the lower left.
  for (let r = 0; r < SIGN_H; r++) for (let c = 0; c < SIGN_W; c++) {
    const x = c + 0.5, y = r + 0.5;
    // Distance along and across the line from (15.5, 0.5) to (0.5, 13.5).
    const dx = 0.5 - 15.5, dy = 13.5 - 0.5, len = Math.hypot(dx, dy);
    const t = ((x - 15.5) * dx + (y - 0.5) * dy) / len, n = Math.abs((x - 15.5) * dy - (y - 0.5) * dx) / len;
    const blade = (t - (len - 3.4)) ** 2 / 3.6 ** 2 + n ** 2 / 1.75 ** 2 <= 1;
    if (blade || (n <= 0.85 && t >= -0.2 && t <= len - 3)) grid[r]![c] = 'a';
  }
  const lanternRows = [
    '...k...',
    '..kkk..',
    '.kkkkk.',
    'kccccck',
    'kccocck',
    'kcooock',
    'kcooock',
    'kccccck',
    'kkkkkkk',
    '..kkk..',
  ];
  const top = 2, left = 5;
  // Clear a cell of field round the lantern first, then draw it.
  for (let r = 0; r < lanternRows.length; r++) for (let c = 0; c < 7; c++) {
    if (lanternRows[r]![c] === '.') continue;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = top + r + dr, cc = left + c + dc;
      if (rr >= 0 && rr < SIGN_H && cc >= 0 && cc < SIGN_W && grid[rr]![cc] === 'a') grid[rr]![cc] = '.';
    }
  }
  for (let r = 0; r < lanternRows.length; r++) for (let c = 0; c < 7; c++) {
    const mark = lanternRows[r]![c]!;
    if (mark !== '.') grid[top + r]![left + c] = mark;
  }
  return grid.map(row => row.join(''));
}

const PAINT: Record<string, number> = { k: MAT.brass, c: MAT.cream, o: MAT.fabricOrange, a: MAT.cream };

/**
 * The bracket sign off the west corner of the jetty: an iron arm with a scrolled stay and a back plate on the corner
 * post, two chains, and the board: a timber frame round a violet border round a bark field, the motif standing a
 * cell proud on both faces (mirrored on the back so it reads true from the river). Its lamp hangs from the arm at the
 * wall end. Returns the board's centre and the lamp's flame base.
 */
function sign(b: Boxes): { centre: Vec3; flame: Vec3 } {
  const z0 = 118, z1 = 120, x0 = 0, x1 = x0 + SIGN_W + 4, y0 = 41, y1 = y0 + SIGN_H + 4;
  // The bracket: an iron back plate on the corner post, two bars braced by uprights, a scroll and a brass knob.
  b.add(BX0 - 1, 62, z0 - 1, BX0, 68, z1 + 1, MAT.darkStone);
  b.add(x0, 63, z0, BX0, 64, z1, MAT.darkStone);
  b.add(8, 66, z0, BX0, 67, z1, MAT.darkStone);
  for (const x of [8, 16]) b.add(x, 64, z0, x + 1, 66, z1, MAT.darkStone);
  line(b, { axis: 'z', plane: z1, out: 1 }, 0, 2, 17, 64, 22, 66, 1, MAT.darkStone);
  b.add(x0, 64, z0, x0 + 1, 66, z1, MAT.darkStone);
  b.add(x0 + 1, 65, z0, x0 + 3, 66, z1, MAT.darkStone);
  b.add(7, 66, z0, 8, 67, z1, MAT.brass);
  // The chains, and the board: a timber frame standing a cell proud of both faces round a violet border and the
  // bark field.
  for (const x of [x0 + 3, x1 - 4]) b.add(x, y1, z0, x + 1, 63, z0 + 1, MAT.darkStone);
  b.add(x0, y0, z0 - 1, x1, y1, z1 + 1, MAT.timber);
  b.add(x0 + 1, y0 + 1, z0 - 1, x1 - 1, y1 - 1, z1 + 1, MAT.air);
  b.add(x0 + 1, y0 + 1, z0, x1 - 1, y1 - 1, z1, MAT.fabricViolet);
  b.add(x0 + 2, y0 + 2, z0, x1 - 2, y1 - 2, z1, MAT.bark);
  // The motif on the field, a cell proud of both faces, mirrored on the back so it reads true from behind.
  const motif = signMotif(), fx = x0 + 2, fy = y1 - 3;
  motif.forEach((row, r) => {
    for (let c = 0; c < SIGN_W;) {
      const mark = row[c]!;
      let e = c;
      while (e < SIGN_W && row[e] === mark) e++;
      if (mark !== '.') {
        const m = PAINT[mark]!, y = fy - r;
        b.add(fx + c, y, z1, fx + e, y + 1, z1 + 1, m);
        b.add(fx + SIGN_W - e, y, z0 - 1, fx + SIGN_W - c, y + 1, z0, m);
      }
      c = e;
    }
  });
  // The lamp that lights it, hung from the lower bar against the corner post.
  const flame = lantern(b, 23, 53, 119);
  b.add(23, 62, 119, 24, 63, 120, MAT.darkStone);
  return { centre: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], flame };
}

// ── Roofs ────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The gables' plaster under the main roof, framed: studs every ten cells clipped to the slopes, a collar beam, and on
 * the east gable a small attic window. The west gable rises the full height; the east stops where the half-hip
 * begins.
 */
function gables(b: Boxes): void {
  for (const [f, last] of [[WEST, T.roof.ridgeRow], [EAST, T.roof.hip - 1]] as const) {
    // Two rows a box: the upper row's span, which the lower row's three-cell roof strip still overlaps.
    for (let r = 0; r <= last; r += 2) {
      const top = Math.min(last, r + 1), z0 = Math.max(BZ0 + 1, roofBack(top)), z1 = Math.min(T.jettyFront - 1, roofFront(top));
      if (z1 > z0) slab(b, f, 1, 4, z0, z1, E + r, E + top + 1, MAT.plaster);
    }
    slab(b, f, 0, 1, BZ0, T.jettyFront, E, E + 2, MAT.timber);
    const collar = 14;
    slab(b, f, 0, 1, roofBack(collar) + 1, roofFront(collar) - 1, E + collar, E + collar + 2, MAT.timber);
    for (let u = 40; u < 116; u += 10) {
      let top = 0;
      for (let r = 0; r <= last; r++) if (roofBack(r) + 1 <= u && u + 2 <= roofFront(r) - 1) top = r + 1;
      if (top > 2) slab(b, f, 0, 1, u, u + 2, E + 2, E + top, MAT.timber);
    }
  }
  // The east gable's attic light, under the collar, its plaster opened through to the roof space.
  slab(b, EAST, 0, 1, 72, 82, E + 4, E + 13, MAT.timber);
  slab(b, EAST, -1, 6, 74, 80, E + 5, E + 12, MAT.air);
  slab(b, EAST, 2, 3, 74, 80, E + 5, E + 12, MAT.glass);
  slab(b, EAST, 1, 3, 76, 78, E + 5, E + 12, MAT.timber);
  slab(b, EAST, -1, 1, 73, 81, E + 4, E + 5, MAT.timber);
}

/**
 * The main roof: three-cell terracotta rows climbing a cell a row after a sprocketed kick at the eaves, from the
 * street eaves and the river eaves to a brick ridge that sags a cell over its middle third, its west verge on timber
 * barges past the chimney gable and its east end half-hipped above the gable. Exposed rafter feet under both eaves,
 * a darker eaves course, and a scatter of weathered tiles and moss.
 */
function mainRoof(b: Boxes): void {
  const { west } = T.roof;
  for (let r = 0; r <= T.roof.ridgeRow; r++) {
    const y = E + r, f = roofFront(r), k = roofBack(r), east = roofEast(r);
    b.add(west, y, f - 3, east, y + 1, f, MAT.terracotta);
    b.add(west, y, k, east, y + 1, k + 3, MAT.terracotta);
    if (r >= T.roof.hip) b.add(east - 3, y, k, east, y + 1, f, MAT.terracotta);
    // Barges on the verges: the outermost column of each row in timber.
    b.add(west, y, f - 2, west + 1, y + 1, f, MAT.timber);
    b.add(west, y, k, west + 1, y + 1, k + 2, MAT.timber);
    if (r < T.roof.hip) {
      b.add(east - 1, y, f - 2, east, y + 1, f, MAT.timber);
      b.add(east - 1, y, k, east, y + 1, k + 2, MAT.timber);
    }
  }
  // The eaves course, a shade darker, and the rafter feet under it.
  b.add(west + 1, E, T.roof.front - 1, T.roof.east - 1, E + 1, T.roof.front, MAT.brick);
  b.add(west + 1, E, T.roof.back, T.roof.east - 1, E + 1, T.roof.back + 1, MAT.brick);
  for (let x = BX0 + 2; x < BX1 - 1; x += 6) {
    if (x < WX0 - 3 || x >= WX1 + 3) b.add(x, E - 1, T.jettyFront, x + 1, E, T.roof.front - 1, MAT.timber);
    b.add(x, E - 1, T.roof.back + 1, x + 1, E, BZ0, MAT.timber);
  }
  // The ridge, sagging a cell over its middle third.
  const ridgeEast = roofEast(T.roof.ridgeRow), z0 = roofBack(T.roof.ridgeRow) + 1, z1 = roofFront(T.roof.ridgeRow) - 1;
  const third = Math.round((ridgeEast - west) / 3);
  b.add(west, RIDGE + 1, z0, west + third, RIDGE + 3, z1, MAT.brick);
  b.add(west + third, RIDGE + 1, z0, ridgeEast - third, RIDGE + 2, z1, MAT.brick);
  b.add(ridgeEast - third, RIDGE + 1, z0, ridgeEast, RIDGE + 3, z1, MAT.brick);
  // Weathered tiles: the odd brick-dark tile and a little moss on the river slope, on the outer face of the rows.
  for (let i = 0; i < 36; i++) {
    const r = 3 + Math.floor(hash(i, 1, 0, 51) * (T.roof.ridgeRow - 5)), x = west + 2 + Math.floor(hash(i, 2, 0, 51) * (roofEast(r) - west - 8));
    const w = 2 + Math.floor(hash(i, 3, 0, 51) * 4), river = i % 3 === 0;
    const m = river && hash(i, 4, 0, 51) < 0.5 ? MAT.moss : MAT.brick;
    const z = river ? roofBack(r) : roofFront(r) - 1;
    b.add(x, E + r, z, x + w, E + r + 1, z + 1, m);
  }
}

/**
 * A gabled roof running along Z over [x0, x1) from `zb` to `zf`, whose eaves row sits at `y`: three-cell rows at 45°,
 * a brick ridge, and timber barges on the front verge. Returns the ridge row's height.
 */
function crossRoof(b: Boxes, x0: number, x1: number, y: number, zb: (r: number) => number, zf: number): number {
  let r = 0;
  for (; x1 - r - (x0 + r) >= 6; r++) {
    b.add(x0 + r, y + r, zb(r), x0 + r + 3, y + r + 1, zf, MAT.terracotta);
    b.add(x1 - r - 3, y + r, zb(r), x1 - r, y + r + 1, zf, MAT.terracotta);
    b.add(x0 + r, y + r, zf - 1, x0 + r + 2, y + r + 1, zf, MAT.timber);
    b.add(x1 - r - 2, y + r, zf - 1, x1 - r, y + r + 1, zf, MAT.timber);
  }
  const top = y + r - 1;
  b.add(x0 + r - 1, top + 1, zb(r - 1), x1 - r + 1, top + 2, zf, MAT.brick);
  return top;
}

// ── The cross-wing, bay and oriel ────────────────────────────────────────────────────────────────────────────────

/** The bay's projection from the wing front for column x: canted a cell a column for its first and last three. */
function bayDepth(x: number): number {
  const [b0, b1] = T.bay.x;
  return Math.min(T.bay.depth, 3 + Math.min(x - b0, b1 - 1 - x));
}

/**
 * The canted bay on the wing's ground storey, carried up to the jetty: a limestone stall on the plinth, a cream sill,
 * timber-mullioned glass with a transom in every face, and a carved timber head with a dentil course under the
 * wing's bressummer. The room runs into it.
 */
function bay(b: Boxes): void {
  const [b0, b1] = T.bay.x, zf = T.wing.front;
  const columns: [number, number, number][] = [];
  for (let x = b0; x < b1; x++) {
    const d = bayDepth(x), last = columns[columns.length - 1];
    if (last && last[2] === d) last[1] = x + 1;
    else columns.push([x, x + 1, d]);
  }
  for (const [x0, x1, d] of columns) {
    const z = zf + d;
    b.add(x0, FOUND, zf, x1, G + 7, z, MAT.limestone);
    b.add(x0, FOUND, zf, x1, G + 2, z + 1, MAT.stone);
    b.add(x0, G + 7, zf, x1, G + 8, z + 1, MAT.cream);
    b.add(x0, G + 8, zf - 4, x1, G + 23, z, MAT.air);
    b.add(x0, G + 8, z - 2, x1, G + 23, z - 1, MAT.glass);
    b.add(x0, G + 23, zf, x1, G + 26, z + 1, MAT.timber);
    b.add(x0, G + 18, z - 2, x1, G + 19, z, MAT.timber);
  }
  // Mullions: at both ends, the four angles, and a pair at the middle, so every light is three cells wide.
  for (const x of [b0, b0 + 3, b0 + 7, b0 + 11, b0 + 12, b1 - 8, b1 - 4, b1 - 1]) {
    const z = T.wing.front + bayDepth(x);
    b.add(x, G + 8, z - 2, x + 1, G + 23, z, MAT.timber);
  }
  // The dentils under the head.
  for (let x = b0; x < b1; x += 2) b.add(x, G + 23, T.wing.front + bayDepth(x), x + 1, G + 24, T.wing.front + bayDepth(x) + 1, MAT.bark);
}

/**
 * The oriel on the wing's upper storey: a timber-framed glazed box three cells out on stepped corbels, mullioned,
 * under a little terracotta pent roof that steps back to the wall.
 */
function oriel(b: Boxes): void {
  const x0 = 100, x1 = 120, z = T.wing.upper, y0 = 58, y1 = 72;
  b.add(x0 + 2, y0 - 4, z, x1 - 2, y0 - 2, z + 1, MAT.timber);
  b.add(x0 + 1, y0 - 2, z, x1 - 1, y0, z + 2, MAT.timber);
  b.add(x0, y0, z, x1, y0 + 1, z + 4, MAT.timber);
  b.add(x0 + 1, y0 + 1, z - 4, x1 - 1, y1, z + 3, MAT.air);
  b.add(x0, y0 + 1, z, x0 + 1, y1, z + 3, MAT.timber);
  b.add(x1 - 1, y0 + 1, z, x1, y1, z + 3, MAT.timber);
  b.add(x0 + 1, y0 + 1, z + 1, x1 - 1, y1, z + 2, MAT.glass);
  for (const x of [105, 109, 110, 114]) b.add(x, y0 + 1, z + 2, x + 1, y1, z + 3, MAT.timber);
  b.add(x0 + 1, y0 + 9, z + 1, x1 - 1, y0 + 10, z + 3, MAT.timber);
  b.add(x0, y1, z, x1, y1 + 1, z + 3, MAT.timber);
  b.add(x0 - 1, y1 + 1, z, x1 + 1, y1 + 2, z + 4, MAT.terracotta);
  b.add(x0, y1 + 2, z, x1, y1 + 3, z + 3, MAT.terracotta);
  b.add(x0 + 1, y1 + 3, z, x1 - 1, y1 + 4, z + 2, MAT.terracotta);
}

/**
 * The wing: its stone ground storey with quoins and side lights, the bressummer and jettied upper storey, framed,
 * then its own gable jettied again on a carved beam, framed with a king post and collar round a small light, under
 * its roof with a pendant and a finial at the apex.
 */
function wing(b: Boxes): void {
  const { front, upper, gable } = T.wing;
  b.add(WX0 - 1, FOUND, BZ1, WX1 + 1, G + 2, front + 1, MAT.stone);
  b.add(WX0 - 1, G + 2, BZ1, WX1 + 1, G + 3, front + 1, MAT.cream);
  b.add(WX0, FOUND, BZ1 - 4, WX1, T.storey, front, MAT.limestone);
  ashlar(b, WING_FRONT, WX0, WX1, G + 3, T.storey, 7);
  ashlar(b, WING_WEST, BZ1, front, G + 3, T.storey, 8);
  ashlar(b, WING_EAST, BZ1, front, G + 3, T.storey, 9);
  quoins(b, WING_FRONT, WX0, 1, WING_WEST, front, -1, G + 3, T.storey);
  quoins(b, WING_FRONT, WX1, -1, WING_EAST, front, -1, G + 3, T.storey);
  b.add(WX0 + 4, G, BZ1 - 4, WX1 - 4, T.storey, front - 4, MAT.air);
  stoneWindow(b, WING_WEST, 116, 122, G + 8, G + 21);
  stoneWindow(b, WING_EAST, 116, 122, G + 8, G + 21);
  bay(b);
  // The jetty: the floor beam out to the upper face, a dentil row on its front, joists and two corner brackets.
  b.add(WX0, T.storey, BZ1, WX1, U0, upper + 1, MAT.timber);
  for (let x = WX0 + 1; x < WX1; x += 3) b.add(x, T.storey, upper, x + 1, T.storey + 1, upper + 1, MAT.bark);
  for (let x = WX0 + 2; x < WX1 - 2; x += 4) if (x < T.bay.x[0] - 1 || x >= T.bay.x[1]) b.add(x, T.storey - 2, front, x + 1, T.storey, upper, MAT.timber);
  for (const x of [WX0, WX1 - 3]) {
    b.add(x, T.storey - 8, front, x + 3, T.storey, front + 2, MAT.timber);
    b.add(x, T.storey - 5, front + 2, x + 3, T.storey, front + 4, MAT.timber);
    b.add(x, T.storey - 2, front + 4, x + 3, T.storey, upper, MAT.timber);
  }
  // The upper storey.
  b.add(WX0 + 1, U0, BZ1, WX1 - 1, U1, upper - 1, MAT.plaster);
  b.add(WX0 + 5, U0, BZ1 - 6, WX1 - 5, U1 - 2, upper - 5, MAT.air);
  framed(b, WING_UP, WX0, WX1, [{ u0: 100, u1: 120 }]);
  // The oriel takes the middle window's frame: open the wall behind it.
  b.add(100, WIN.sill - 3, upper - 6, 120, WIN.head, upper, MAT.air);
  oriel(b);
  framed(b, WING_WEST, BZ1, upper, [{ u0: 118, u1: 126, box: false }]);
  framed(b, WING_EAST, BZ1, upper, [{ u0: 118, u1: 126, box: false }]);
  // The gable, jettied two cells on a carved beam with brackets at the corners.
  b.add(WX0, E, upper - 4, WX1, E + 2, gable + 1, MAT.timber);
  for (let x = WX0 + 1; x < WX1; x += 3) b.add(x, E, gable, x + 1, E + 1, gable + 1, MAT.bark);
  for (const x of [WX0, WX1 - 2]) {
    b.add(x, E - 4, upper, x + 2, E, upper + 1, MAT.timber);
    b.add(x, E - 2, upper + 1, x + 2, E, gable, MAT.timber);
  }
  const ox = WX0 - 3, oX = WX1 + 3, mid = (WX0 + WX1) / 2;
  for (let r = 2; oX - r - (ox + r) >= 6; r += 2) b.add(Math.max(WX0, ox + r + 1), E + r, gable - 4, Math.min(WX1, oX - r - 1), E + r + 2, gable - 1, MAT.plaster);
  // Its frame: studs clipped to the slopes, a collar over the light, a king post and raking struts.
  for (const x of [94, 100, 118, 124]) {
    let top = 0;
    for (let r = 0; oX - r - (ox + r) > 6; r++) if (ox + r + 1 <= x && x + 2 <= oX - r - 1) top = r;
    if (top > 2) slab(b, WING_GABLE, 0, 1, x, x + 2, E + 2, E + top, MAT.timber);
  }
  slab(b, WING_GABLE, 0, 1, ox + 15, oX - 15, E + 14, E + 16, MAT.timber);
  slab(b, WING_GABLE, 0, 1, mid - 1, mid + 1, E + 16, E + 22, MAT.timber);
  line(b, WING_GABLE, 0, 1, ox + 15, E + 16, mid - 2, E + 19, 1, MAT.timber);
  line(b, WING_GABLE, 0, 1, oX - 16, E + 16, mid + 1, E + 19, 1, MAT.timber);
  slab(b, WING_GABLE, 0, 1, mid - 6, mid + 6, E + 3, E + 13, MAT.timber);
  slab(b, WING_GABLE, -1, 7, mid - 4, mid + 4, E + 4, E + 12, MAT.air);
  slab(b, WING_GABLE, 2, 3, mid - 4, mid + 4, E + 4, E + 12, MAT.glass);
  slab(b, WING_GABLE, 1, 3, mid - 1, mid + 1, E + 4, E + 12, MAT.timber);
  slab(b, WING_GABLE, -1, 1, mid - 5, mid + 5, E + 3, E + 4, MAT.timber);
  // The roof, running back into the main roof's front slope, its pendant and finial.
  const top = crossRoof(b, ox, oX, E, r => roofFront(r) - 3, gable + 3);
  b.add(mid - 1, top - 4, gable + 1, mid + 1, top + 1, gable + 3, MAT.timber);
  b.add(mid - 1, top - 6, gable + 1, mid + 1, top - 4, gable + 2, MAT.brass);
  b.add(mid - 1, top + 2, gable, mid + 1, top + 6, gable + 2, MAT.timber);
  b.add(mid - 1, top + 6, gable, mid + 1, top + 8, gable + 2, MAT.brass);
}

// ── The porch ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The open porch before the door: flagged flush with the street, two timber posts on stone pads with curved braces to
 * a tie beam, a plastered gable framed with a king post and struts, a gabled roof running back under the jetty, a
 * rose climbing both posts and draped along the beam, and a caged lantern hung from each end of the beam. Returns the
 * two flame bases.
 */
function porch(b: Boxes): Vec3[] {
  const [rx0, rx1] = T.porch.roof, [pz0, pz1] = T.porch.z, tie = T.porch.tie, zf = T.porch.front;
  for (const px of T.porch.posts) {
    b.add(px - 1, FOUND, pz0 - 1, px + 3, G + 2, pz1 + 1, MAT.stone);
    b.add(px, G + 2, pz0, px + 2, tie, pz1, MAT.timber);
  }
  b.add(rx0, tie, pz0, rx1, tie + 2, pz1 + 1, MAT.timber);
  // Curved braces from each post to the beam.
  const [wp, ep] = T.porch.posts;
  for (const [x, s] of [[wp + 2, 1], [ep - 1, -1]] as const) {
    for (let k = 0; k < 3; k++) b.add(x + s * k, tie - 3 + k, pz0, x + s * k + 1, tie, pz1, MAT.timber);
  }
  // The gable: plaster inside the roof's rows, a king post and two struts.
  const half = (rx1 - rx0) / 2, mid = rx0 + half;
  for (let r = 0; r < half - 3; r++) b.add(rx0 + 3 + r, tie + 2 + r, pz0, rx1 - 3 - r, tie + 3 + r, pz1, MAT.plaster);
  b.add(mid - 1, tie + 2, pz1, mid + 1, tie + half - 1, pz1 + 1, MAT.timber);
  line(b, { axis: 'z', plane: pz1 + 1, out: 1 }, 0, 1, rx0 + 5, tie + 2, mid - 2, tie + 7, 1, MAT.timber);
  line(b, { axis: 'z', plane: pz1 + 1, out: 1 }, 0, 1, rx1 - 6, tie + 2, mid + 1, tie + 7, 1, MAT.timber);
  crossRoof(b, rx0, rx1, tie + 2, () => T.jettyFront - 1, zf);
  // The rose: up the front of both posts, leafy and patchy, and along the beam's front, hanging in places.
  const bloomOf = (r: number) => (r < 0.15 ? MAT.fabricViolet : r < 0.24 ? MAT.cream : MAT.petal);
  for (const px of T.porch.posts) {
    for (let y = G + 2; y < tie; y += 2) {
      const w = 1 + Math.floor(hash(px, y, 1, 71) * 2), x = px + Math.floor(hash(px, y, 2, 71) * 2);
      if (hash(px, y, 3, 71) < 0.18) continue;
      b.add(x, y, pz1, Math.min(px + 2, x + w), y + 2, pz1 + 1, MAT.leaf);
      if (hash(px, y, 4, 71) < 0.5) b.add(x, y + 1, pz1 + 1, x + 1, y + 2, pz1 + 2, bloomOf(hash(px, y, 5, 71)));
    }
  }
  for (let x = rx0 + 1; x < rx1 - 1; x += 2) {
    if (hash(x, 1, 1, 72) < 0.2) continue;
    // Over the doorway the rose keeps to the beam, so the way in stays clear; it hangs lower toward the posts.
    const hang = x + 2 > T.door.x[0] - 2 && x < T.door.x[1] + 2 ? 0 : Math.floor(hash(x, 2, 1, 72) * 4);
    b.add(x, tie - hang, pz1 + 1, x + 2, tie + 2, pz1 + 2, MAT.leaf);
    if (hash(x, 3, 1, 72) < 0.65) b.add(x + (hash(x, 4, 1, 72) < 0.5 ? 0 : 1), tie - hang, pz1 + 2, x + (hash(x, 4, 1, 72) < 0.5 ? 1 : 2), tie - hang + 1, pz1 + 3, bloomOf(hash(x, 5, 1, 72)));
  }
  // The lanterns, hung from iron arms off the beam's ends.
  const fires: Vec3[] = [];
  for (const [cx, arm0, arm1] of [[rx0 - 2, rx0 - 2, rx0], [rx1 + 1, rx1, rx1 + 2]] as const) {
    fires.push(lantern(b, cx, tie - 8, 128));
    b.add(arm0, tie + 1, 128, arm1, tie + 2, 129, MAT.darkStone);
    b.add(cx, tie, 128, cx + 1, tie + 1, 129, MAT.darkStone);
  }
  return fires;
}

// ── Chimneys ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The great stack on the west gable: a broad breast on the plinth, set back twice on cream weatherings, cream quoins
 * up its outer corners, the shaft climbing beside the gable and through the verge, then a brick head a cell askew
 * under a dark cap with two pots of different heights.
 */
function westChimney(b: Boxes): void {
  b.add(11, FOUND, 63, BX0, G + 2, 87, MAT.stone);
  b.add(12, FOUND, 64, BX0, 54, 86, MAT.limestone);
  b.add(12, 54, 64, BX0, 55, 86, MAT.cream);
  b.add(13, 55, 65, BX0, 56, 85, MAT.cream);
  b.add(15, 56, 67, BX0 + 1, 92, 83, MAT.limestone);
  b.add(15, 92, 67, BX0 + 1, 93, 83, MAT.cream);
  b.add(16, 93, 68, BX0 + 1, 94, 82, MAT.cream);
  b.add(17, 94, 70, BX0 + 2, 124, 80, MAT.limestone);
  for (let y = G + 3, k = 0; y + 3 <= 54; y += 3, k++) {
    const l = k % 2 ? 2 : 4;
    b.add(12, y, 64, 12 + l, y + 3, 65, MAT.cream); b.add(12, y, 85, 12 + l, y + 3, 86, MAT.cream);
    b.add(12, y, 64, 13, y + 3, 64 + 6 - l, MAT.cream); b.add(12, y, 86 - 6 + l, 13, y + 3, 86, MAT.cream);
  }
  for (let y = 57, k = 0; y + 3 <= 92; y += 3, k++) {
    const l = k % 2 ? 2 : 3;
    b.add(15, y, 67, 16, y + 3, 67 + l, MAT.cream); b.add(15, y, 83 - l, 16, y + 3, 83, MAT.cream);
  }
  ashlar(b, { axis: 'x', plane: 12, out: -1 }, 65, 85, G + 3, 54, 11);
  // The head, a cell askew toward the street.
  b.add(17, 124, 71, BX0 + 2, 132, 81, MAT.brick);
  b.add(17, 127, 71, BX0 + 2, 128, 81, MAT.darkStone);
  b.add(16, 132, 70, BX0 + 3, 134, 82, MAT.darkStone);
  for (const [x, z, h] of [[19, 73, 5], [23, 76, 4]] as const) {
    b.add(x, 134, z, x + 3, 134 + h, z + 3, MAT.terracotta);
    b.add(x, 134 + h - 1, z, x + 3, 134 + h, z + 3, MAT.brick);
    b.add(x + 1, 135, z + 1, x + 2, 134 + h, z + 2, MAT.air);
  }
}

/** The kitchen chimney on the river slope near the east end: limestone up from the ceiling, a brick head and a pot. */
function kitchenChimney(b: Boxes): void {
  const x0 = 112, x1 = 120, z0 = 50, z1 = 58;
  b.add(x0, U1 - 2, z0, x1, 118, z1, MAT.limestone);
  b.add(x0, 118, z0, x1, 124, z1, MAT.brick);
  b.add(x0 - 1, 124, z0 - 1, x1 + 1, 126, z1 + 1, MAT.darkStone);
  b.add(x0 + 2, 126, z0 + 2, x0 + 5, 130, z0 + 5, MAT.terracotta);
  b.add(x0 + 3, 127, z0 + 3, x0 + 4, 130, z0 + 4, MAT.air);
}

// ── The dormer ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A gabled dormer on the main roof's front slope over the west window: framed plaster, a light, its own roof. */
function dormer(b: Boxes): void {
  const x0 = 36, x1 = 52, zf = 117, y0 = E + 1, y1 = 94;
  const f: Face = { axis: 'z', plane: zf, out: 1 };
  b.add(x0, y0, 98, x1, y1, zf, MAT.plaster);
  b.add(x0 + 2, y0 + 2, 98, x1 - 2, y1 - 2, zf - 4, MAT.air);
  slab(b, f, 0, 1, x0, x1, y0, y0 + 2, MAT.timber);
  slab(b, f, 0, 1, x0, x1, y1 - 2, y1, MAT.timber);
  for (const x of [x0, x1 - 2]) slab(b, f, 0, 1, x, x + 2, y0, y1, MAT.timber);
  slab(b, f, 0, 6, x0 + 4, x1 - 4, y0 + 4, y1 - 4, MAT.air);
  slab(b, f, 3, 4, x0 + 4, x1 - 4, y0 + 4, y1 - 4, MAT.glass);
  slab(b, f, 1, 3, (x0 + x1) / 2 - 1, (x0 + x1) / 2 + 1, y0 + 4, y1 - 4, MAT.timber);
  slab(b, f, 2, 3, x0 + 4, x1 - 4, y0 + 9, y0 + 10, MAT.timber);
  slab(b, f, -1, 1, x0 + 3, x1 - 3, y0 + 3, y0 + 4, MAT.timber);
  slab(b, f, 0, 1, x0 + 2, x0 + 4, y0 + 2, y1 - 2, MAT.timber);
  slab(b, f, 0, 1, x1 - 4, x1 - 2, y0 + 2, y1 - 2, MAT.timber);
  const top = crossRoof(b, x0 - 2, x1 + 2, y1, r => roofFront(y1 + r - E) - 3, zf + 2);
  b.add((x0 + x1) / 2 - 1, top + 2, zf, (x0 + x1) / 2 + 1, top + 5, zf + 2, MAT.timber);
}

// ── Yard, bench and jetty ────────────────────────────────────────────────────────────────────────────────────────

/** A flag pattern along Z over a paved strip a cell thick whose top is y + 1: mostly paving, the odd grey and buff. */
function flags(b: Boxes, x0: number, x1: number, y: number, z0: number, z1: number, seed: number): void {
  for (let x = x0; x < x1; x += 4) {
    let z = z0 - Math.floor(hash(x, y, z0, seed) * 5);
    for (let i = 0; z < z1; i++) {
      const length = 4 + Math.floor(hash(x, i, y, seed + 1) * 5), pick = hash(x, i, y, seed + 2);
      const m = pick < 0.6 ? MAT.paving : pick < 0.84 ? MAT.stone : MAT.limestone;
      if (m !== MAT.paving) b.add(x, y, Math.max(z0, z), Math.min(x1, x + 4), y + 1, Math.min(z1, z + length), m);
      z += length;
    }
  }
}

/**
 * A barrel lying along X from x0 for `length` cells, its round face in the YZ plane centred on (yc, zc) with its
 * underside at y: staves bellied in the middle third, iron hoops near both ends, a darker head and a brass tap on
 * the east head.
 */
function lyingBarrel(b: Boxes, x0: number, length: number, y: number, zc: number): void {
  const x1 = x0 + length, belly = [x0 + 3, x1 - 3] as const;
  b.add(x0, y, zc - 2, x1, y + 7, zc + 2, MAT.timber);
  b.add(x0, y + 1, zc - 3, x1, y + 6, zc + 3, MAT.timber);
  b.add(belly[0], y, zc - 3, belly[1], y + 7, zc + 3, MAT.timber);
  for (const x of [x0 + 1, x1 - 2]) {
    b.add(x, y, zc - 2, x + 1, y + 7, zc + 2, MAT.darkStone);
    b.add(x, y + 1, zc - 3, x + 1, y + 6, zc + 3, MAT.darkStone);
  }
  b.add(x1 - 1, y + 1, zc - 2, x1, y + 6, zc + 2, MAT.bark);
  b.add(x1, y + 2, zc - 1, x1 + 1, y + 3, zc, MAT.brass);
}

/** An ale barrel on its end, six across: staves bellied by the middle course, two iron hoops, a lid, a bung. */
function uprightBarrel(b: Boxes, x0: number, y: number, z0: number): Vec3 {
  b.add(x0 + 1, y, z0, x0 + 5, y + 8, z0 + 6, MAT.timber);
  b.add(x0, y, z0 + 1, x0 + 6, y + 8, z0 + 5, MAT.timber);
  b.add(x0, y + 3, z0, x0 + 6, y + 5, z0 + 6, MAT.timber);
  for (const h of [y + 1, y + 6]) {
    b.add(x0, h, z0 + 1, x0 + 6, h + 1, z0 + 5, MAT.darkStone);
    b.add(x0 + 1, h, z0, x0 + 5, h + 1, z0 + 6, MAT.darkStone);
  }
  b.add(x0 + 1, y + 7, z0 + 1, x0 + 5, y + 8, z0 + 5, MAT.bark);
  b.add(x0 + 2, y + 4, z0 + 6, x0 + 3, y + 5, z0 + 7, MAT.brass);
  return [x0 + 3, y + 8, z0 + 3];
}

/**
 * The east yard: flagged flush with the street on a footing, a kerb at its edge, a stillage of five barrels lying
 * racked against the wall, two barrels standing at its front end (one with a stave-and-lid crate beside it), and
 * the cellar flaps leaning on the wall: two timber leaves on a stone curb with iron straps and a ring. Returns the
 * top of the front standing barrel.
 */
function yard(b: Boxes): Vec3 {
  const [x0, x1] = T.yard.x, [z0, z1] = T.yard.z;
  b.add(x0, FOUND, z0, x1, G, z1, MAT.limestone);
  b.add(x0, G - 1, z0, x1, G, z1, MAT.paving);
  flags(b, x0, x1 - 1, G - 1, z0, z1, 91);
  b.add(x1 - 1, G - 1, z0, x1, G, z1, MAT.darkStone);
  // The stillage: two rails on stone blocks, three barrels below and two above.
  for (const [rx, rz] of [[141, 0], [149, 0]] as const) {
    b.add(rx, G, 80 + rz, rx + 2, G + 1, 104, MAT.timber);
    for (const z of [81, 92, 102]) b.add(rx, G - 1, z, rx + 2, G, z + 2, MAT.stone);
  }
  for (const zc of [84, 92, 100]) lyingBarrel(b, 140, 11, G + 1, zc);
  for (const zc of [88, 96]) lyingBarrel(b, 140, 11, G + 7, zc);
  const top = uprightBarrel(b, 140, G, 106);
  uprightBarrel(b, 147, G, 110);
  // A crate by the barrels.
  b.add(147, G, 103, 153, G + 5, 108, MAT.timber);
  b.add(147, G + 1, 103, 153, G + 2, 108, MAT.bark);
  b.add(147, G + 3, 103, 153, G + 4, 108, MAT.bark);
  b.add(148, G + 5, 104, 152, G + 6, 107, MAT.timber);
  // The cellar flaps against the wall, sloping down to the yard.
  b.add(BX1, G - 1, 61, BX1 + 10, G + 1, 77, MAT.stone);
  for (let k = 0; k < 4; k++) b.add(BX1, G + 1, 62, BX1 + 9 - 2 * k, G + 2 + k, 76, MAT.timber);
  for (let k = 0; k < 4; k++) b.add(BX1 + 9 - 2 * k - 2, G + 1 + k, 69, BX1 + 9 - 2 * k, G + 2 + k, 70, MAT.bark);
  for (const z of [64, 73]) for (let k = 0; k < 4; k++) b.add(BX1 + 9 - 2 * k - 2, G + 1 + k, z, BX1 + 9 - 2 * k, G + 2 + k, z + 1, MAT.darkStone);
  b.add(BX1 + 6, G + 3, 66, BX1 + 7, G + 4, 68, MAT.brass);
  b.add(BX1 + 6, G + 3, 71, BX1 + 7, G + 4, 73, MAT.brass);
  return top;
}

/** The bench under the front window: a thick timber seat on two stone legs, on the plinth. Returns the seat centre. */
function bench(b: Boxes): Vec3 {
  const x0 = 36, x1 = 52, z0 = BZ1 + 1, z1 = BZ1 + 5;
  for (const x of [x0 + 1, x1 - 3]) b.add(x, G, z0 + 1, x + 2, G + 3, z1 - 1, MAT.stone);
  b.add(x0, G + 3, z0, x1, G + 4, z1, MAT.timber);
  b.add(x0, G + 2, z1 - 1, x1, G + 3, z1, MAT.timber);
  return [(x0 + x1) / 2, G + 4, (z0 + z1) / 2];
}

/**
 * The jetty stub on the river: a plank deck at street height bearing on three bearers and nine piles down to the
 * bed, the planks laid across with a darker one every fourth, a kerb along both sides, an iron ladder at the river
 * end, a coil of rope, and the two mooring posts at its outer corners: square timber bollards rising from the bed,
 * a rope collar and an iron ring each. Returns their top centres.
 */
function jettyStub(b: Boxes): Vec3[] {
  const [x0, x1] = T.deck.x, [z0, z1] = T.deck.z;
  for (const x of [x0 + 2, (x0 + x1) / 2 - 1, x1 - 4]) for (const z of [z0 + 1, 15, z1 - 3]) b.add(x, 0, z, x + 2, G - 2, z + 2, MAT.timber);
  for (const x of [x0 + 2, (x0 + x1) / 2 - 1, x1 - 4]) b.add(x, G - 4, z0, x + 2, G - 2, z1, MAT.timber);
  b.add(x0, G - 2, z0, x1, G, z1, MAT.timber);
  for (let z = z0 + 3; z < z1; z += 4) b.add(x0, G - 1, z, x1, G, z + 1, MAT.bark);
  for (const x of [x0, x1 - 1]) b.add(x, G, z0 + 6, x + 1, G + 1, z1, MAT.timber);
  // Walings along both sides, tying the piles at the low-water line.
  for (const x of [x0 + 1, x1 - 2]) b.add(x, 8, z0 + 1, x + 1, 10, z1 - 1, MAT.timber);
  // The ladder down to the water at the river end.
  const lx = (x0 + x1) / 2 - 3;
  for (const x of [lx, lx + 5]) b.add(x, 4, z0 - 2, x + 1, G + 2, z0 - 1, MAT.darkStone);
  for (let y = 6; y < G; y += 3) b.add(lx + 1, y, z0 - 2, lx + 5, y + 1, z0 - 1, MAT.darkStone);
  b.add(lx, G - 1, z0 - 1, lx + 6, G, z0, MAT.darkStone);
  // A coil of rope.
  b.octagon(x1 - 10, 12, 3, 1, G, G + 2, MAT.thatch);
  b.add(x1 - 11, G, 11, x1 - 9, G + 2, 13, MAT.air);
  const tops: Vec3[] = [];
  for (const x of [x0 + 1, x1 - 5]) {
    b.add(x, 0, z0, x + 4, G + 6, z0 + 4, MAT.timber);
    b.add(x, G + 6, z0 + 1, x + 4, G + 7, z0 + 3, MAT.timber);
    b.add(x + 1, G + 6, z0, x + 3, G + 7, z0 + 4, MAT.timber);
    b.add(x + 1, G + 7, z0 + 1, x + 3, G + 8, z0 + 3, MAT.bark);
    b.add(x - 1, G + 3, z0, x + 5, G + 4, z0 + 4, MAT.thatch);
    b.add(x, G + 3, z0 - 1, x + 4, G + 4, z0 + 5, MAT.thatch);
    b.add(x + 1, G + 1, z0 - 1, x + 3, G + 2, z0, MAT.darkStone);
    b.add(x + 1, G, z0 - 1, x + 2, G + 1, z0, MAT.darkStone);
    tops.push([x + 2, G + 8, z0 + 2]);
  }
  return tops;
}

// ── The inn ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The Lantern and Oar. See `LANTERN_AND_OAR` for the frame. */
export function createLanternAndOar(): LanternAndOar {
  const size: Vec3 = [...T.size];
  const b = new Clipped(size);

  // The quay along the river face, founded on the bed, its coping flush with the street.
  const [qx0, qx1] = T.quay.x, [qz0, qz1] = T.quay.z;
  b.add(qx0, 0, qz0, qx1, G - 1, qz1, MAT.stone);
  b.add(qx0, G - 1, qz0, qx1, G, qz1, MAT.darkStone);
  for (let x = qx0 + 3; x < qx1 - 3; x += 7) b.add(x, 2 + Math.floor(hash(x, 1, 1, 31) * 12), qz0, x + 3 + Math.floor(hash(x, 2, 1, 31) * 3), 0 + 4 + Math.floor(hash(x, 1, 1, 31) * 12), qz0 + 1, MAT.darkStone);
  for (let x = qx0 + 1; x < qx1 - 1; x += 4) if (hash(x, 3, 1, 31) < 0.5) b.add(x, 3, qz0, x + 2, 5 + Math.floor(hash(x, 4, 1, 31) * 3), qz0 + 1, MAT.moss);

  // The ground storey: a grey plinth with a cream weathering, solid limestone, odd stones and quoins.
  b.add(BX0 - 1, FOUND, BZ0 - 1, BX1 + 1, G + 2, BZ1 + 1, MAT.stone);
  b.add(BX0 - 1, G + 2, BZ0 - 1, BX1 + 1, G + 3, BZ1 + 1, MAT.cream);
  b.add(BX0, FOUND, BZ0, BX1, T.storey, BZ1, MAT.limestone);
  ashlar(b, FRONT, BX0, WX0, G + 3, T.storey, 1);
  ashlar(b, BACK, BX0, BX1, G + 3, T.storey, 2);
  ashlar(b, WEST, BZ0, BZ1, G + 3, T.storey, 3);
  ashlar(b, EAST, BZ0, BZ1, G + 3, T.storey, 4);
  quoins(b, FRONT, BX0, 1, WEST, BZ1, -1, G + 3, T.storey);
  quoins(b, FRONT, BX1, -1, EAST, BZ1, -1, G + 3, T.storey);
  quoins(b, BACK, BX0, 1, WEST, BZ0, 1, G + 3, T.storey);
  quoins(b, BACK, BX1, -1, EAST, BZ0, 1, G + 3, T.storey);
  b.add(BX0 + 4, G, BZ0 + 4, BX1 - 4, T.storey, BZ1 - 4, MAT.air);

  // The ground storey's openings: the front door and window, the river door, and side and back lights.
  door(b, FRONT, T.door.x[0], T.door.x[1], T.door.height);
  stoneWindow(b, FRONT, 37, 51, G + 8, G + 21);
  door(b, BACK, 98, 110, T.door.height);
  for (const [u0, u1] of [[42, 52], [66, 76], [122, 130]] as const) stoneWindow(b, BACK, u0, u1, G + 8, G + 20);
  for (const [u0, u1] of [[44, 54], [96, 106]] as const) stoneWindow(b, WEST, u0, u1, G + 8, G + 20);
  stoneWindow(b, EAST, 44, 54, G + 8, G + 20);

  // The floor beam all round, proud along the front as the jetty's bressummer, with its dentil course, joists and
  // brackets under the jetty.
  b.add(BX0, T.storey, BZ0, BX1, U0, T.jettyFront + 1, MAT.timber);
  for (let x = BX0 + 1; x < BX1; x += 3) b.add(x, T.storey, T.jettyFront, x + 1, T.storey + 1, T.jettyFront + 1, MAT.bark);
  for (let x = BX0 + 2; x < BX1 - 1; x += 4) if (x < WX0 || x >= WX1) b.add(x, T.storey - 2, BZ1, x + 1, T.storey, T.jettyFront, MAT.timber);
  for (const x of [BX0, 52, 84, BX1 - 3]) {
    b.add(x, T.storey - 8, BZ1, x + 3, T.storey, BZ1 + 2, MAT.timber);
    b.add(x, T.storey - 5, BZ1 + 2, x + 3, T.storey, BZ1 + 4, MAT.timber);
    b.add(x, T.storey - 2, BZ1 + 4, x + 3, T.storey, T.jettyFront, MAT.timber);
  }

  // The upper storey: plaster a cell back from the timber faces, the rooms hollow behind, then the framing.
  b.add(BX0 + 1, U0, BZ0 + 1, BX1 - 1, U1, T.jettyFront - 1, MAT.plaster);
  b.add(BX0 + 5, U0, BZ0 + 5, BX1 - 5, U1 - 2, T.jettyFront - 5, MAT.air);
  framed(b, FRONT_UP, BX0, WX0, [{ u0: 38, u1: 50, shutters: true, box: true }, { u0: 64, u1: 76, shutters: true, box: true }]);
  framed(b, FRONT_UP, WX1, BX1, []);
  framed(b, BACK, BX0, BX1, [{ u0: 40, u1: 50 }, { u0: 64, u1: 74 }, { u0: 99, u1: 109 }, { u0: 120, u1: 130 }]);
  framed(b, WEST, BZ0, T.jettyFront, [{ u0: 44, u1: 54 }, { u0: 96, u1: 106 }]);
  framed(b, EAST, BZ0, T.jettyFront, [{ u0: 44, u1: 54, shutters: true }, { u0: 72, u1: 82 }, { u0: 96, u1: 106, shutters: true }]);
  gables(b);

  mainRoof(b);
  wing(b);
  dormer(b);
  westChimney(b);
  kitchenChimney(b);

  // A flagged apron under the jetty, founded, where the bench stands and the street meets the wall.
  for (const [x0, x1] of [[BX0, WX0], [WX1, BX1]] as const) {
    b.add(x0, FOUND, BZ1 + 1, x1, G, T.jettyFront + 1, MAT.limestone);
    b.add(x0, G - 1, BZ1 + 1, x1, G, T.jettyFront + 1, MAT.paving);
    flags(b, x0, x1, G - 1, BZ1 + 1, T.jettyFront, 85 + x0);
    b.add(x0, G - 1, T.jettyFront, x1, G, T.jettyFront + 1, MAT.darkStone);
  }
  // The porch's footing, flagged flush with the street and kerbed, then the porch itself.
  const [rx0, rx1] = T.porch.roof;
  b.add(rx0 - 2, FOUND, BZ1 + 1, rx1 + 2, G, T.porch.front, MAT.limestone);
  b.add(rx0 - 2, G - 1, BZ1 + 1, rx1 + 2, G, T.porch.front, MAT.paving);
  flags(b, rx0 - 2, rx1 + 2, G - 1, BZ1 + 1, T.porch.front - 1, 81);
  b.add(rx0 - 2, G - 1, T.porch.front - 1, rx1 + 2, G, T.porch.front, MAT.darkStone);
  const porchFires = porch(b);

  const seat = bench(b);
  const barrel = yard(b);
  const moorings = jettyStub(b);
  const { centre, flame: signFlame } = sign(b);
  // The river door's lamp, on an arm out of the back wall over the deck.
  const riverFlame = lantern(b, 92, 35, 30);
  b.add(92, 44, 30, 93, 45, BZ0, MAT.darkStone);

  const blueprint: VoxelBlueprint = {
    version: 1, id: 'genesis-pinkkitty-tavern-lantern-and-oar', styleId: StyleIdSchema.parse(STYLES.hearth.id), kind: 'civic', lattice: 'build',
    size: [...size], boxes: b.list, windows: [],
  };
  const doorCentre = (T.door.x[0] + T.door.x[1]) / 2;
  return {
    blueprint, size, ground: G,
    door: [doorCentre, G, BZ1 + 3],
    sign: centre,
    fires: [...porchFires, signFlame, riverFlame],
    barrel, bench: seat, moorings,
    footprint: [11, qz0, T.yard.x[1], T.wing.front + T.bay.depth],
    jetty: [T.deck.x[0], 0, T.deck.x[1], T.deck.z[1]],
  };
}
