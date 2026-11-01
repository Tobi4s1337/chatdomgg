import type { Vec3 } from '@chatdom/shared';
import { MAT } from '@chatdom/content/materials';
import { Grid, SOFT, blob, checkOptions, finish, hash, lanternPost, stream, variantTag, type PieceKit } from '../kit';
import type { GeneratedPiece, PieceOptions } from '../types';
import { contrast, emblem, type EmblemFigure } from '../emblem';

/**
 * The lighthouse on the kingdom's shore: a tapering round or octagonal tower on a stepped stone plinth, banded or
 * spiral-striped in the kingdom's cloth (or plain dressed stone under a coloured lantern room), small windows up the
 * shaft, an arched door at +Z under the kingdom's roundel with stairs down the plinth, a stone gallery on corbels with
 * an iron railing, a glazed lantern room with mullions round a brass-and-glass lens (the light), and a domed or conical
 * cap with a ball, a finial and a weather vane. At its foot the keeper's cottage leans on the tower with a crooked
 * chimney, a lit window and a lamp post at its door, and the yard has a dry-stone wall, barrels, a rope coil and
 * lobster pots. The seed picks every proportion and variant; the style picks the kit.
 */
export type LighthouseShape = 'round' | 'octagonal';
export type LighthousePattern = 'bands' | 'spiral' | 'plain';
export type LighthouseCap = 'dome' | 'cone';

export interface LighthouseWindow {
  /** The window's sill row. */
  readonly y: number;
  /** `front` faces +Z; `flank` faces away from the cottage (−X when the cottage is on the right). */
  readonly face: 'front' | 'flank';
  readonly lit: boolean;
}

export interface LighthouseLayout {
  readonly size: Vec3;
  /** The tower's axis (x, z), on a cell corner. */
  readonly centre: readonly [number, number];
  /** Cells from the ground to the vane's tip (the blueprint's height). */
  readonly height: number;
  readonly shape: LighthouseShape;
  readonly pattern: LighthousePattern;
  /** Bands of cloth (for `bands`) or helical stripes (for `spiral`); 0 for `plain`. */
  readonly stripes: number;
  /** Full turns the spiral makes up the shaft (for `spiral`). */
  readonly turns: number;
  readonly cap: LighthouseCap;
  readonly cottage: 'left' | 'right';
  readonly baseRadius: number;
  readonly topRadius: number;
  readonly lanternRadius: number;
  /** Top of the plinth, where the shaft starts. */
  readonly plinth: number;
  /** The gallery deck's lowest row (the shaft ends under it). */
  readonly gallery: number;
  /** The eave row over the glazing. */
  readonly roomTop: number;
  /** The row above the cap's last layer, where the finial starts. */
  readonly capTop: number;
  readonly windows: readonly LighthouseWindow[];
  readonly figure: EmblemFigure;
}

const TAU = Math.PI * 2;
const SX = 88, SZ = 84;
/** Gallery deck (2) + parapet (3) + glazing (14); the finial, ball and vane above the cap. */
const DECK = 2, PARAPET = 3, GLAZING = 14, FINIAL = 11;
const ROOF_ALT: Readonly<Record<PieceKit['style'], number>> = { hearth: MAT.brick, tide: MAT.darkStone, grove: MAT.moss };

export function lighthouseLayout(seed: number): LighthouseLayout {
  const r = stream(seed, 0x11647);
  const height = r.int(128, 176);
  const shape: LighthouseShape = r.chance(0.5) ? 'round' : 'octagonal';
  const pattern = r.pick(['bands', 'spiral', 'plain'] as const);
  const stripes = pattern === 'bands' ? r.int(3, 5) : pattern === 'spiral' ? r.int(1, 2) : 0;
  const turns = r.range(1.4, 2.2);
  const cap: LighthouseCap = r.chance(0.5) ? 'dome' : 'cone';
  const cottage = r.chance(0.5) ? 'left' : 'right';
  const baseRadius = r.int(17, 19);
  const topRadius = baseRadius - r.int(6, 7);
  const lanternRadius = topRadius - 1;
  const capHeight = cap === 'dome' ? Math.round((lanternRadius + 2) * 0.8) : Math.round((lanternRadius + 2) * 1.35);
  const capTop = height - FINIAL;
  const roomTop = capTop - capHeight - 1;
  const gallery = roomTop - GLAZING - PARAPET - DECK;
  const plinth = 7;
  const count = r.int(2, 3);
  const lo = plinth + 36, hi = gallery - 14;
  const windows: LighthouseWindow[] = [];
  for (let i = 0; i < count; i++) {
    const y = Math.round(lo + ((hi - lo) * i) / Math.max(1, count - 1) + (i > 0 && i < count - 1 ? r.range(-4, 4) : 0));
    const top = i === count - 1;
    windows.push({ y, face: top || i % 2 === 1 ? 'front' : 'flank', lit: top || r.chance(0.5) });
  }
  return {
    size: [SX, height, SZ], centre: [cottage === 'right' ? 31 : SX - 31, 34], height, shape, pattern, stripes, turns, cap, cottage,
    baseRadius, topRadius, lanternRadius, plinth, gallery, roomTop, capTop, windows,
    figure: r.pick(['heart', 'star', 'diamond', 'note'] as const),
  };
}

export function createLighthouse(options: PieceOptions): GeneratedPiece {
  const kit = checkOptions(options);
  const { field, charge, border } = options.colours;
  const L = lighthouseLayout(options.seed);
  const r = stream(options.seed, 0x7a3c1);
  const salt = (options.seed ^ 0x5ea1) | 0;
  const [sx, sy, sz] = L.size, [cx, cz] = L.centre;
  const g = new Grid(sx, sy, sz);
  const lanterns: Vec3[] = [];
  const oct = L.shape === 'octagonal';
  const P = L.plinth, rb = L.baseRadius, rt = L.topRadius, Rl = L.lanternRadius;
  const deckTop = L.gallery + DECK, glassFrom = deckTop + PARAPET;
  const side = L.cottage === 'right' ? 1 : -1;

  // The tower's own metric: a circle, or an octagon with its flats square to the axes (so the door sits on a flat).
  const dist = (x: number, z: number) => {
    const dx = Math.abs(x + 0.5 - cx), dz = Math.abs(z + 0.5 - cz);
    return oct ? Math.max(dx, dz, (dx + dz) / Math.SQRT2) : Math.hypot(dx, dz);
  };
  /** Angle round the axis, 0 at +Z, growing toward +X. */
  const angle = (x: number, z: number) => Math.atan2(x + 0.5 - cx, z + 0.5 - cz);
  const near = (a: number, b: number) => Math.abs(((a - b + Math.PI * 3) % TAU) - Math.PI);
  /** Paints the tower-shaped ring inner < d <= outer over rows y0..y1, `m` decided per cell. */
  const ring = (y0: number, y1: number, outer: number, inner: number, m: number | ((x: number, y: number, z: number, d: number) => number)) => {
    const reach = Math.ceil(outer) + 1;
    for (let z = cz - reach; z < cz + reach; z++) for (let x = cx - reach; x < cx + reach; x++) {
      const d = dist(x, z);
      if (d > outer || d <= inner) continue;
      if (typeof m === 'number') g.fill(x, y0, z, x + 1, y1, z + 1, m);
      else for (let y = y0; y < y1; y++) g.set(x, y, z, m(x, y, z, d));
    }
  };

  // ── Colours. The light ground of the stripes is cream or the kit's wall, never the cloth itself; the plain tower is
  // dressed stone (Grove's dark stone would read blue-painted from the shore, so its tower is grey field stone).
  const light = contrast(r.chance(0.5) ? [MAT.cream, kit.wall, MAT.limestone] : [kit.wall, MAT.cream, MAT.limestone], [field]);
  const towerStone = kit.style === 'grove' ? MAT.stone : kit.stone;
  const plain = L.pattern === 'plain';
  const capMat = plain ? r.pick([border, field]) : r.pick([border, kit.roof, MAT.forgeCopper]);
  const capRib = contrast([kit.metal, kit.iron, MAT.cream], [capMat]);
  const frameMat = plain ? field : kit.iron;

  // ── The path: flagstones from the foot of the stairs to the front edge, with grass between them.
  const stairEnd = cz + rb + 2 + 2 * P;
  for (let z = stairEnd - 2; z < sz - 1; z += 4) {
    const wob = Math.round(1.5 * Math.sin(z * 0.23 + salt));
    for (const [a, b] of [[-5, -1], [0, 4]] as const) {
      const h = hash(a, z, 3, salt);
      g.fill(cx + a + wob + (h < 0.3 ? 1 : 0), 0, z, cx + b + wob + (h > 0.7 ? 0 : 1) , 1, z + 3, h < 0.15 ? kit.rock : MAT.paving);
    }
  }

  // ── The stepped plinth, in the tower's own shape: a heavy footing course and two dressed courses.
  ring(0, 2, rb + 8, -1, kit.base);
  ring(2, 4, rb + 5, -1, kit.stone);
  ring(4, P, rb + 2, -1, kit.stone);
  // Coursed blocks of the second stone in the dressed tiers' faces.
  for (let z = cz - rb - 9; z < cz + rb + 9; z++) for (let x = cx - rb - 9; x < cx + rb + 9; x++) for (let y = 0; y < P; y++) {
    const m = g.get(x, y, z);
    if ((m !== kit.stone && m !== kit.base) || !g.exposed(x, y, z)) continue;
    const course = y >> 1, blk = hash(Math.floor((angle(x, z) + 4) * (rb + 6) / (course % 2 ? 4 : 5)), course, 0, salt);
    if (blk < 0.12) g.set(x, y, z, m === kit.stone ? kit.rock === kit.stone ? kit.base : kit.rock : kit.stone);
  }
  // Stairs down the plinth's front, between two cheek walls, to the flagstones.
  for (let k = 0; k < P; k++) g.fill(cx - 6, 0, cz + rb, cx + 6, k + 1, stairEnd - 2 * k, kit.stone);
  for (const x of [cx - 8, cx + 6]) for (let k = 0; k < P; k++) g.fill(x, 0, cz + rb, x + 2, k + 2, stairEnd - 2 * k - 1, kit.base);
  for (let k = 0; k < P; k++) g.fill(cx - 6, k, stairEnd - 2 * k - 1, cx + 6, k + 1, stairEnd - 2 * k, kit.base);

  // ── The keeper's cottage, leaning on the tower: footing, walls, a steep roof, a crooked chimney.
  const W = r.int(34, 38), D = r.int(30, 34), wallH = r.int(19, 22);
  const xi = cx + side * 9, xo = cx + side * (9 + W);
  const x0 = Math.min(xi, xo), x1 = Math.max(xi, xo), z1 = cz + 26, z0 = z1 - D, mid = (x0 + x1) / 2;
  g.fill(x0 - (side < 0 ? 1 : 0), 0, z0 - 1, x1 + (side > 0 ? 1 : 0), 3, z1 + 1, kit.stone);
  g.fill(x0, 3, z0, x1, wallH, z1, kit.wall);
  // Timber corner posts and a wall plate along both eaves.
  const xOuter = side > 0 ? x1 - 2 : x0;
  for (const z of [z0, z1 - 2]) g.fill(xOuter, 3, z, xOuter + 2, wallH, z + 2, kit.trim);
  g.fill(x0, wallH - 2, z1 - 1, x1, wallH, z1, kit.trim);
  g.fill(x0, wallH - 2, z0, x1, wallH, z0 + 1, kit.trim);
  // The roof: steep, its ridge along x, the eaves out over both long walls and past the outer gable.
  const half = D / 2 + 2, slope = 1.25;
  const rx0 = side > 0 ? x0 : x0 - 3, rx1 = side > 0 ? x1 + 3 : x1;
  const roofTop = (z: number) => wallH - 1 + Math.floor(Math.min(z - (z0 - 2), z1 + 1 - z) * slope);
  let ridge = 0;
  for (let z = z0 - 2; z < z1 + 2; z++) {
    const t = roofTop(z), e = Math.min(z - (z0 - 2), z1 + 1 - z);
    ridge = Math.max(ridge, t);
    if (z >= z0 && z < z1) g.fill(x0, wallH, z, x1, t - 1, z + 1, kit.wall);
    // Courses of tiles: every fourth course is the darker tile.
    g.fill(rx0, Math.max(wallH - 1, t - 2), z, rx1, t + 1, z + 1, e % 4 === 3 ? ROOF_ALT[kit.style] : kit.roof);
  }
  // A ridge cap that sags a voxel in the middle, and a bargeboard on the outer gable.
  const zr = Math.floor(z0 - 2 + half - 0.5);
  for (let x = rx0; x < rx1; x++) {
    const sag = Math.abs(x + 0.5 - mid) < W * 0.22 ? 1 : 0;
    g.fill(x, ridge + 1 - sag, zr, x + 1, ridge + 2 - sag, zr + 2, ROOF_ALT[kit.style]);
  }
  const xb = side > 0 ? rx1 - 1 : rx0;
  for (let z = z0 - 2; z < z1 + 2; z++) g.over(xb, wallH - 2, z, xb + 1, ridge + 2, z + 1, kit.trim);
  // The front: a door in the kingdom's cloth toward the outer end, a lit window toward the tower, a window box.
  const doorX = Math.round(mid + side * 7) - 3, wz = z1 - 1;
  g.fill(doorX - 1, 3, wz, doorX + 8, 18, wz + 1, kit.trim);
  g.fill(doorX, 3, wz - 1, doorX + 7, 17, wz + 1, MAT.air);
  g.fill(doorX, 3, wz - 1, doorX + 7, 17, wz, field);
  g.fill(doorX, 6, wz - 1, doorX + 7, 7, wz, kit.iron); g.fill(doorX, 13, wz - 1, doorX + 7, 14, wz, kit.iron);
  g.set(side > 0 ? doorX + 1 : doorX + 5, 10, wz, kit.metal);
  g.fill(doorX - 2, 0, z1, doorX + 9, 2, z1 + 4, kit.stone);
  g.fill(doorX - 1, 2, z1, doorX + 8, 3, z1 + 2, kit.stone);
  const winX = Math.round(mid - side * 8) - 3;
  g.fill(winX - 1, 7, wz, winX + 8, 17, wz + 1, kit.trim);
  g.fill(winX, 8, wz - 1, winX + 7, 16, wz + 1, MAT.air);
  g.fill(winX, 8, wz - 1, winX + 7, 16, wz, MAT.glass);
  g.fill(winX + 3, 8, wz, winX + 4, 16, wz + 1, kit.trim); g.fill(winX, 12, wz, winX + 7, 13, wz + 1, kit.trim);
  lanterns.push([winX + 1, 10, wz - 1]);
  // Shutters folded back either side, and a window box of flowers under the sill.
  for (const sx0 of [winX - 4, winX + 8]) { g.fill(sx0, 8, wz + 1, sx0 + 3, 16, wz + 2, kit.wood); g.fill(sx0, 11, wz + 1, sx0 + 3, 12, wz + 2, kit.trim); }
  g.fill(winX - 1, 5, wz + 1, winX + 8, 7, wz + 3, kit.trim);
  for (let x = winX - 1; x < winX + 8; x++) {
    const h = hash(x, 7, wz, salt);
    g.fill(x, 7, wz + 1, x + 1, h < 0.5 ? 9 : 8, wz + 3, MAT.leaf);
    if (h < 0.55) g.set(x, h < 0.5 ? 9 : 8, wz + 1 + (x % 2), h < 0.3 ? MAT.petal : MAT.cream);
  }
  // A round window high in the outer gable.
  const gx = side > 0 ? x1 - 1 : x0, gy = wallH + 7, gzc = (z0 + z1) / 2;
  for (let z = Math.floor(gzc) - 3; z < gzc + 3; z++) for (let y = gy - 3; y < gy + 3; y++) {
    const d = Math.hypot(z + 0.5 - gzc, y + 0.5 - gy);
    if (d < 3.1) g.set(gx + side, y, z, d < 2 ? MAT.glass : kit.trim);
  }
  // The chimney on the outer gable, stepping in once and leaning a voxel toward the tower above the roof.
  const chim = kit.style === 'hearth' ? MAT.brick : towerStone;
  const chx = side > 0 ? x1 - 1 : x0 - 5, chz = Math.round(gzc) + 4 + r.int(0, 3);
  g.fill(chx, 0, chz - 3, chx + 6, wallH - 2, chz + 3, chim);
  g.fill(chx + (side > 0 ? 0 : 1), wallH - 2, chz - 2, chx + (side > 0 ? 5 : 6), ridge - 2, chz + 2, chim);
  const lean = -side;
  g.fill(chx + (side > 0 ? 0 : 1) + lean, ridge - 2, chz - 2, chx + (side > 0 ? 5 : 6) + lean, ridge + 6, chz + 2, chim);
  g.fill(chx + (side > 0 ? 0 : 1) + lean - 1 + (side > 0 ? 1 : 0), ridge + 6, chz - 3, chx + (side > 0 ? 5 : 6) + lean + (side > 0 ? 0 : 1) - 1 + 1, ridge + 7, chz + 3, kit.base);
  g.fill(chx + 2 + lean + (side > 0 ? 0 : 1), ridge + 7, chz - 1, chx + 4 + lean + (side > 0 ? 0 : 1), ridge + 9, chz + 1, kit.iron);
  for (let z = chz - 3; z < chz + 3; z++) for (let y = 0; y < wallH - 2; y++) {
    if (hash(z >> 1, y >> 1, 11, salt) < 0.14) g.over(side > 0 ? chx + 5 : chx, y, z, (side > 0 ? chx + 5 : chx) + 1, y + 1, z + 1, kit.base);
  }

  // ── The shaft: per-row radius stepping in a cell at a time from base to top, painted in its pattern.
  const shaftH = L.gallery - P;
  const radiusAt = (y: number) => rb - Math.round((rb - rt) * ((y - P) / shaftH) ** 1.15);
  const bandH = shaftH / (2 * Math.max(1, L.stripes));
  const pitch = shaftH / L.turns, sectors = 16, spiralStep = Math.max(2, Math.round((pitch * Math.max(1, L.stripes)) / sectors));
  const paint = (x: number, y: number, z: number, d: number): number => {
    const rad = radiusAt(y);
    if (L.pattern === 'bands') return Math.floor((y - P) / bandH) % 2 === 1 ? field : light;
    if (L.pattern === 'spiral') {
      if (d <= rad - 2.2) return light;
      const q = Math.floor(((angle(x, z) / TAU) + 0.5) * sectors) / sectors;
      const yq = Math.floor((y - P) / spiralStep) * spiralStep;
      const phase = q * L.stripes + yq / pitch;
      return phase - Math.floor(phase) < 0.5 ? field : light;
    }
    if (d <= rad - 1.2) return towerStone;
    // Dressed ashlar: courses of blocks, a few a shade warmer or weathered, never a camouflage of greys.
    const course = Math.floor((y - P) / 6), blk = hash(Math.floor((angle(x, z) + 4) * rad / (course % 2 ? 6 : 7)), course, 1, salt);
    return blk < 0.12 ? MAT.paving : blk > 0.985 ? kit.base : towerStone;
  };
  for (let y = P; y < L.gallery; y++) ring(y, y + 1, radiusAt(y), -1, paint);
  // A collar of the charge cloth just under the gallery, and a salt-stained footing course above the plinth.
  ring(L.gallery - 2, L.gallery - 1, rt, -1, charge);
  ring(P, P + 1, rb, -1, kit.base);

  /** The outermost solid cell along a face's outward axis, at tangent offset u and row y. */
  const surface = (face: 'front' | 'flank', u: number, y: number): readonly [number, number] | null => {
    if (face === 'front') { for (let z = sz - 1; z > cz; z--) if (g.get(cx + u, y, z)) return [cx + u, z]; return null; }
    const dir = -side;
    for (let k = sx; k > 0; k--) { const x = cx + dir * k - (dir < 0 ? 1 : 0); if (g.get(x, y, cz + u)) return [x, cz + u]; }
    return null;
  };
  const put = (p: Vec3, m: number) => g.set(p[0], p[1], p[2], m);
  /** The cell `inward` cells behind a face's surface cell `s` (negative: proud of it). */
  const behind = (face: 'front' | 'flank', s: readonly [number, number], y: number, inward: number): Vec3 =>
    face === 'front' ? [s[0], y, s[1] - inward] : [s[0] + side * inward, y, s[1]];

  // ── The door at +Z: an arched opening two cells deep, plank leaves on iron straps, a dressed surround, and a
  // doorstep laid on the plinth.
  const doorW = 4, sill = P + 1, doorTop = sill + 15;
  const inDoor = (u: number, y: number) => y >= sill && y < doorTop && u >= -doorW && u < doorW && !(y >= doorTop - 2 && (u < -doorW + (doorTop - y === 1 ? 2 : 1) || u >= doorW - (doorTop - y === 1 ? 2 : 1)));
  const frontZ = (u: number, y: number) => surface('front', u, y)?.[1] ?? cz;
  const doorFace = frontZ(0, sill + 4);
  for (let y = sill; y <= doorTop + 1; y++) for (let u = -doorW - 2; u < doorW + 2; u++) {
    if (inDoor(u, y)) continue;
    const touches = inDoor(u - 1, y) || inDoor(u + 1, y) || inDoor(u, y - 1) || inDoor(u - 1, y - 1) || inDoor(u + 1, y - 1);
    if (touches) { const z = frontZ(u, y); g.set(cx + u, y, z + 1, (u + y) % 3 === 0 ? kit.base : kit.stone); }
  }
  for (let y = sill; y < doorTop; y++) for (let u = -doorW; u < doorW; u++) {
    if (!inDoor(u, y)) continue;
    g.fill(cx + u, y, doorFace - 1, cx + u + 1, y + 1, doorFace + 3, MAT.air);
    g.set(cx + u, y, doorFace - 2, y === sill + 3 || y === sill + 10 ? kit.iron : u % 2 === 0 ? kit.trim : kit.wood);
  }
  g.set(cx + 2, sill + 7, doorFace - 1, kit.metal);
  g.fill(cx - doorW - 1, P, doorFace - 1, cx + doorW + 1, sill, doorFace + 3, kit.base);
  // The kingdom's roundel over the door, proud of the curve and backed to it.
  const ey = doorTop + 7, ez = frontZ(0, ey) + 2;
  for (let y = ey - 4; y <= ey + 4; y++) for (let u = -4; u <= 4; u++) {
    if (Math.hypot(u, y - ey) > 4.35) continue;
    for (let z = ez - 1; z > cz && !g.get(cx + u, y, z); z--) g.set(cx + u, y, z, border);
  }
  emblem(g, L.figure, cx, ey, ez, 4, charge, border, contrast([field, MAT.cream, MAT.darkStone], [charge, border]), 'z');

  // ── Windows up the shaft: deep reveals, a sill and a hood stone; lit ones glow, dark ones show a shutter.
  for (const w of L.windows) {
    const ww = 3, wh = 9;
    // The face is read once per column before any carving, so every reveal follows the curve it was cut into.
    const faces = new Map<string, readonly [number, number]>();
    for (let y = w.y - 1; y <= w.y + wh; y++) for (let u = -ww - 1; u < ww + 1; u++) { const s = surface(w.face, u, y); if (s) faces.set(`${u},${y}`, s); }
    for (let y = w.y; y < w.y + wh; y++) for (let u = -ww; u < ww; u++) {
      if (y === w.y + wh - 1 && (u === -ww || u === ww - 1)) continue;
      const s = faces.get(`${u},${y}`);
      if (!s) continue;
      put(behind(w.face, s, y, 0), MAT.air);
      put(behind(w.face, s, y, 1), w.lit ? (y === w.y + 5 ? kit.trim : MAT.glass) : u === -1 || u === 0 ? kit.trim : kit.wood);
    }
    const heart = faces.get(`0,${w.y + 3}`);
    if (w.lit && heart) lanterns.push(behind(w.face, heart, w.y + 3, 1));
    // A dressed surround: a sill and hood proud of the wall, and jambs either side.
    for (let u = -ww - 1; u < ww + 1; u++) {
      const s0 = faces.get(`${u},${w.y - 1}`), s1 = faces.get(`${u},${w.y + wh}`);
      if (s0) put(behind(w.face, s0, w.y - 1, -1), kit.stone);
      if (s1 && u > -ww - 1 && u < ww) put(behind(w.face, s1, w.y + wh, -1), kit.stone);
    }
    for (let y = w.y; y < w.y + wh - 1; y++) for (const u of [-ww - 1, ww]) {
      const s = faces.get(`${u},${y}`);
      if (s) put(behind(w.face, s, y, 0), (y - w.y) % 3 === 2 ? kit.base : kit.stone);
    }
  }

  // ── The gallery: corbels stepping out under a stone deck, an iron railing on it.
  const deckR = rt + 4, corbels = oct ? 16 : 14;
  for (let k = 1; k <= 3; k++) {
    const y = L.gallery - k;
    ring(y, y + 1, rt + 4 - k, radiusAt(y), (x, _y, z) => {
      const a = angle(x, z), n = Math.round((a / TAU) * corbels);
      return near(a, (n / corbels) * TAU) * (rt + 3) < 1.1 ? kit.stone : g.get(x, y, z);
    });
  }
  ring(L.gallery, deckTop, deckR, -1, kit.stone);
  ring(L.gallery, L.gallery + 1, deckR, deckR - 1.2, kit.base);
  const posts = oct ? 24 : 26, railR = deckR - 0.6;
  ring(deckTop, deckTop + 5, railR + 0.6, railR - 0.6, (x, y, z) => {
    const a = angle(x, z), n = Math.round((a / TAU) * posts);
    return near(a, (n / posts) * TAU) * railR < 0.75 ? kit.iron : g.get(x, y, z);
  });
  ring(deckTop + 5, deckTop + 6, railR + 0.7, railR - 0.7, kit.iron);
  ring(deckTop + 2, deckTop + 3, railR + 0.7, railR - 0.7, kit.iron);

  // ── The lantern room: a parapet, glazing between mullions, a transom, and the lens at its heart.
  ring(deckTop, glassFrom, Rl, Rl - 2, frameMat);
  const mullions = 8, mOff = oct ? Math.PI / 8 : 0;
  ring(glassFrom, L.roomTop, Rl, Rl - 1.25, (x, y, z) => {
    const a = angle(x, z), n = Math.round(((a - mOff) / TAU) * mullions);
    if (near(a, mOff + (n / mullions) * TAU) * Rl < 0.8) return frameMat;
    return y === glassFrom + 7 ? frameMat : MAT.glass;
  });
  const lensY = glassFrom + 5;
  g.fill(cx - 1, deckTop, cz - 1, cx + 1, lensY - 3, cz + 1, kit.metal);
  g.fill(cx - 2, deckTop, cz - 2, cx + 2, deckTop + 1, cz + 2, kit.iron);
  const lens = [1.6, 2.5, 3.0, 3.1, 3.0, 2.5, 1.6];
  lens.forEach((rad, k) => {
    const y = lensY - 3 + k;
    for (let z = cz - 4; z < cz + 4; z++) for (let x = cx - 4; x < cx + 4; x++) {
      if (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) <= rad) g.set(x, y, z, k === 0 || k === lens.length - 1 ? kit.metal : MAT.glass);
    }
  });
  lanterns.push([cx, lensY, cz], [cx - 1, lensY, cz - 1]);

  // ── The cap: an eave ring, a dome or cone (ribbed), a brass ball, an iron finial and the vane.
  ring(L.roomTop, L.roomTop + 1, Rl + 2, -1, capMat);
  ring(L.roomTop, L.roomTop + 1, Rl + 2, Rl + 0.8, capRib);
  const capH = L.capTop - L.roomTop - 1;
  for (let k = 0; k < capH; k++) {
    const f = k / capH, rad = L.cap === 'dome' ? (Rl + 1) * Math.sqrt(1 - f * f) + 0.35 : (Rl + 1) * (1 - f) + 0.6;
    ring(L.roomTop + 1 + k, L.roomTop + 2 + k, rad, -1, (x, _y, z) => {
      const a = angle(x, z), n = Math.round(((a - mOff) / TAU) * mullions);
      return L.cap === 'dome' && near(a, mOff + (n / mullions) * TAU) * rad < 0.7 && k < capH - 1 ? capRib : capMat;
    });
  }
  const top = L.capTop;
  g.fill(cx - 1, top, cz - 1, cx + 1, top + 1, cz + 1, capRib);
  blob(g, cx, top + 3, cz, 2.3, 2.3, 2.3, kit.metal);
  g.fill(cx, top + 5, cz, cx + 1, sy, cz + 1, kit.iron);
  g.set(cx, sy - 1, cz, kit.metal);
  // The vane: an arrow along x with a swallow-tailed pennant in the cloth.
  const vy = sy - 4;
  g.fill(cx - 6, vy, cz, cx + 7, vy + 1, cz + 1, kit.iron);
  g.set(cx - 5, vy + 1, cz, kit.iron); g.set(cx - 5, vy - 1, cz, kit.iron); g.set(cx - 7, vy, cz, kit.metal);
  for (let k = 0; k < 5; k++) for (let dy = 1; dy <= 3; dy++) {
    if (k === 4 && dy === 2) continue;
    g.set(cx + 3 + k, vy + dy, cz, dy === 2 && k < 3 ? charge : field);
  }
  // Cardinal arms under the vane.
  g.fill(cx - 3, vy - 3, cz, cx + 4, vy - 2, cz + 1, kit.iron);
  g.fill(cx, vy - 3, cz - 3, cx + 1, vy - 2, cz + 4, kit.iron);

  // ── The yard.
  const lampX = doorX + (side > 0 ? 11 : -6), lampZ = z1 + 3;
  lanterns.push(lanternPost(g, kit, lampX, lampZ, 18));
  // Barrels on the free side of the stairs.
  const free = -side, bx0 = cx + free * 16;
  const barrel = (bx: number, bz: number, h: number) => {
    for (let z = bz - 3; z < bz + 3; z++) for (let x = bx - 3; x < bx + 3; x++) {
      const d = Math.hypot(x + 0.5 - bx, z + 0.5 - bz);
      if (d > 3.1) continue;
      for (let y = 0; y < h; y++) {
        const bulge = y > 1 && y < h - 2;
        if (!bulge && d > 2.6) continue;
        g.set(x, y, z, y === 1 || y === h - 2 ? kit.iron : y === h - 1 ? kit.wood : (Math.floor(Math.atan2(z - bz, x - bx) * 3) & 1) ? kit.trim : kit.wood);
      }
    }
  };
  const bz0 = cz + rb + 13;
  barrel(bx0, bz0, 8);
  barrel(bx0 + free * 7, bz0 - 2, 7);
  if (r.chance(0.6)) barrel(bx0 + free * 2, bz0 + 7, 8);
  // A coil of rope beside them.
  const rpx = bx0 + free * 8, rpz = bz0 + 7;
  for (let z = rpz - 4; z < rpz + 4; z++) for (let x = rpx - 4; x < rpx + 4; x++) {
    const d = Math.hypot(x + 0.5 - rpx, z + 0.5 - rpz);
    if (d < 3.6 && d > 1.2) g.fill(x, 0, z, x + 1, d > 2.4 ? 2 : 1, z + 1, kit.cord);
  }
  // Lobster pots stacked by the cottage's outer corner, a buoy in the cloth on top.
  const pz = z1 + 4;
  const pot = (x: number, y: number, z: number) => {
    g.fill(x, y, z, x + 7, y + 1, z + 5, kit.wood);
    for (let k = 0; k < 7; k += 2) g.fill(x + k, y + 1, z, x + k + 1, y + 4, z + 5, kit.trim);
    for (let k = 1; k < 7; k += 2) { g.fill(x + k, y + 1, z + 1, x + k + 1, y + 3, z + 4, kit.cord); g.fill(x + k, y + 3, z + 1, x + k + 1, y + 4, z + 4, kit.cord); }
    g.fill(x, y + 4, z + 1, x + 7, y + 5, z + 4, kit.trim);
  };
  const potX = side > 0 ? Math.min(sx - 8, x1 + 1) : Math.max(1, x0 - 8);
  pot(potX, 0, pz);
  pot(potX + (side > 0 ? -1 : 1), 0, pz + 6);
  pot(potX, 5, pz + 2);
  g.fill(potX + 2, 10, pz + 3, potX + 5, 13, pz + 6, field);
  g.fill(potX + 2, 11, pz + 3, potX + 5, 12, pz + 6, MAT.cream === field ? border : MAT.cream);
  g.set(potX + 3, 13, pz + 4, kit.iron);
  // A dry-stone wall round the free side of the yard, meandering, with a cope of laid stones.
  const wallZ = cz + rb + 15;
  const xa = free > 0 ? cx + 12 : 1, xb2 = free > 0 ? sx - 1 : cx - 12;
  for (let x = xa; x < xb2; x += 3) {
    const zz = wallZ + Math.round(1.6 * Math.sin(x * 0.17 + (salt & 0xff)));
    const h = 4 + (hash(x, 2, 0, salt) < 0.35 ? 1 : 0), w = Math.min(3, xb2 - x);
    g.fill(x, 0, zz, x + w, h, zz + 3, hash(x, 1, 0, salt) < 0.3 ? kit.rock : kit.stone);
    g.fill(x, h, zz, x + w, h + 1, zz + 3, hash(x, 3, 0, salt) < 0.25 ? MAT.moss : kit.base);
  }
  // Boulders at the back corners, mossed on top, and sea-thrift in the turf round the plinth.
  for (const [bx, bz, s] of [[cx - free * 22, 5, 1], [cx + free * 24, 9, 0.8]] as const) {
    blob(g, bx, 0, bz, 5 * s, 4 * s, 4 * s, kit.rock === kit.stone ? kit.base : kit.rock);
    for (let z = bz - 5; z < bz + 5; z++) for (let x = bx - 6; x < bx + 6; x++) {
      let y = 6; while (y > 0 && !g.get(x, y, z)) y--;
      if (y > 1 && hash(x >> 1, 4, z >> 1, salt) < 0.5 && (g.get(x, y, z) === kit.rock || g.get(x, y, z) === kit.base)) g.set(x, y, z, MAT.moss);
    }
  }
  for (let k = 0; k < 26; k++) {
    const a = hash(k, 5, 0, salt) * TAU, d = rb + 9 + hash(k, 6, 0, salt) * 3;
    const x = Math.round(cx + Math.sin(a) * d), z = Math.round(cz + Math.cos(a) * d);
    if (g.get(x, 0, z) || g.get(x, 1, z)) continue;
    g.fill(x, 0, z, x + 2, 1, z + 2, MAT.leaf);
    if (hash(k, 7, 0, salt) < 0.6) g.set(x, 1, z, MAT.petal);
  }

  g.prune(SOFT);
  const id = `genesis-lighthouse-${kit.style}-${L.shape}-${L.pattern}-${variantTag(options.seed, options.colours)}`;
  return finish(g, id, kit.style, lanterns);
}
