import type { VoxelAsset } from '@chatdom/shared';
import { MAT, MATERIALS } from '../materials';
import { mix } from '../places/water/critters/rig';

/**
 * A carved trophy plaque for one fish, on the avatar lattice. Front faces +Z, up is +Y, the back of the board is
 * z=0 and a low moulded plinth lets it stand on a shelf. The fish is turned in exact quarter turns only:
 * - 'flank': nose to +X, back up, its right flank to the viewer (most fish);
 * - 'face':  nose to +X, its back to the viewer (flat fish such as rays and flounders, which read from above).
 */
export type MountPose = 'flank' | 'face';

/** Board depth layers, in cells from the back: field 0..2, rim 0..3, nameplate 3..4, fish from 5. */
const FIELD = 3, RIM = 4, FISH_Z = 5;
/** Rings from the outer edge: 0 bevel, 1..2 raised rim, 3 gilded bead, then the field. */
const RIM_RINGS = 4;
/** How far inside the outer edge every cell of the fish's silhouette must stay. */
const FIN_CLEAR = 2;
/** Below this board area the rim's fixed width dominates, so a small fish always gets room to breathe. */
const SMALL_BOARD = 640;
const PLATE_H = 3, PLATE_GAP = 1, PLINTH_H = 2;
const LIMIT = 47;

interface Grid { readonly sx: number; readonly sy: number; readonly sz: number; readonly v: Uint16Array }
const grid = (sx: number, sy: number, sz: number): Grid => ({ sx, sy, sz, v: new Uint16Array(sx * sy * sz) });
const at = (g: Grid, x: number, y: number, z: number) =>
  x < 0 || y < 0 || z < 0 || x >= g.sx || y >= g.sy || z >= g.sz ? 0 : g.v[x + g.sx * (y + g.sy * z)]!;
function put(g: Grid, x: number, y: number, z: number, m: number): void {
  if (x < 0 || y < 0 || z < 0 || x >= g.sx || y >= g.sy || z >= g.sz) throw new Error(`Mount cell ${x},${y},${z} is outside the ${g.sx}x${g.sy}x${g.sz} block.`);
  g.v[x + g.sx * (y + g.sy * z)] = m;
}

/** The fish cropped to its occupied cells, then turned into the mount's axes. */
function orient(fish: VoxelAsset, pose: MountPose | 'auto'): { g: Grid; pose: MountPose } {
  const [sx, sy, sz] = fish.size;
  const min = [Infinity, Infinity, Infinity], max = [-1, -1, -1];
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    if (!fish.voxels[x + sx * (y + sy * z)]) continue;
    [x, y, z].forEach((c, d) => { min[d] = Math.min(min[d]!, c); max[d] = Math.max(max[d]!, c); });
  }
  if (max[0]! < 0) throw new Error(`The fish model ${fish.id} has no cells to mount.`);
  const [fx, fy, fz] = [0, 1, 2].map(d => max[d]! - min[d]! + 1) as [number, number, number];
  // A fish twice as wide as it is tall is a flat fish: it is shown back to the viewer, as it lies on the seabed.
  const chosen: MountPose = pose === 'auto' ? (fx >= 2 * fy ? 'face' : 'flank') : pose;
  const g = chosen === 'flank' ? grid(fz, fy, fx) : grid(fz, fx, fy);
  for (let z = 0; z < fz; z++) for (let y = 0; y < fy; y++) for (let x = 0; x < fx; x++) {
    const m = fish.voxels[(x + min[0]!) + sx * ((y + min[1]!) + sy * (z + min[2]!))]!;
    if (!m) continue;
    // flank: (x, y, z) -> (z, y, -x), a quarter turn about +Y. face: (x, y, z) -> (z, x, y), a cyclic turn.
    if (chosen === 'flank') put(g, z, y, fx - 1 - x, m); else put(g, z, x, y, m);
  }
  return { g, pose: chosen };
}

/** Engraved "lettering" on the nameplate: one mark per two letters of each word, a space between words. */
function lettering(name: string, room: number): number[] {
  const words = name.split(/\s+/).filter(Boolean).map(w => w.replace(/[^\p{L}]/gu, '').length).filter(n => n > 0);
  for (const per of [2, 3, 4]) {
    const marks = words.map(n => Math.max(1, Math.round(n / per)));
    const width = marks.reduce((s, n) => s + n, 0) + marks.length - 1;
    if (width <= room) return marks;
  }
  return [Math.max(1, room)];
}

/** Superellipse cartouche: an oval dome over a squarer foot, so it reads as carved and stands on its plinth. */
function outline(w: number, h: number): boolean[] {
  const cells: boolean[] = new Array(w * h).fill(false);
  const a = w / 2, b = h / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = Math.abs(x + .5 - a) / a, v = (y + .5 - b) / b;
    const p = v > 0 ? 3 : 4.2;
    cells[x + w * y] = u ** p + Math.abs(v) ** p <= 1;
  }
  return cells;
}

/** Chessboard distance from outside the shape, so every carved ring has an even width round the curve. */
function rings(shape: readonly boolean[], w: number, h: number): Int32Array {
  const d = new Int32Array(w * h).fill(-1);
  let frontier: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!shape[x + w * y]) continue;
    let edge = false;
    for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || !shape[nx + w * ny]) { edge = true; break; }
    }
    if (edge) { d[x + w * y] = 0; frontier.push(x + w * y); }
  }
  for (let r = 1; frontier.length; r++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, j = nx + w * ny;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && shape[j] && d[j] === -1) { d[j] = r; next.push(j); }
      }
    }
    frontier = next;
  }
  return d;
}

const COLOURS = new Map(MATERIALS.materials.map(m => [m.id, [1, 3, 5].map(i => parseInt(m.colour.slice(i, i + 2), 16))]));
/** Two woods: dark timber is the house look; honey oak backs a fish whose colours would sink into timber. */
const WOODS = [{ field: MAT.timber, grain: MAT.bark }, { field: MAT.hairChestnut, grain: MAT.fabricMutedOrange }] as const;
function fieldWood(f: Grid): (typeof WOODS)[number] {
  const distance = WOODS.map(() => 0);
  let n = 0;
  for (let y = 0; y < f.sy; y++) for (let x = 0; x < f.sx; x++) for (let z = 0; z < f.sz; z++) {
    const m = at(f, x, y, z);
    if (!m) continue;
    const c = COLOURS.get(m)!;
    WOODS.forEach((wood, i) => { const w = COLOURS.get(wood.field)!; distance[i]! += Math.hypot(c[0]! - w[0]!, c[1]! - w[1]!, c[2]! - w[2]!); });
    n++; break;                                     // the cell the viewer sees in this column
  }
  return distance[1]! > distance[0]! * 1.35 && n ? WOODS[1] : WOODS[0];
}

export interface MountOptions { readonly pose?: MountPose | 'auto' }

/**
 * Composes a fish onto its plaque. Deterministic: the same fish and name give the same cells, in a fresh buffer.
 * The fish is the hero: it stands two cells proud of the field on a brass peg, inside a dark carved rim.
 */
export function composeFishMount(id: string, fish: VoxelAsset, name: string, options: MountOptions = {}): VoxelAsset {
  const { g: f } = orient(fish, options.pose ?? 'auto');
  // Silhouette of the fish as seen from the front, and the nearest cell along each column.
  const front = new Int32Array(f.sx * f.sy).fill(-1);
  for (let y = 0; y < f.sy; y++) for (let x = 0; x < f.sx; x++)
    for (let z = 0; z < f.sz; z++) if (at(f, x, y, z)) { front[x + f.sx * y] = z; break; }

  // Nameplate: lettering, one brass cell either side, a clipped-corner border.
  const marks = lettering(name, Math.max(3, f.sx - 4));
  const letters = marks.reduce((s, n) => s + n, 0) + marks.length - 1;
  let pw = Math.max(letters + 4, 7);
  if ((pw - f.sx) % 2) pw++;                       // fish and plate share a centre line exactly
  const cw = Math.max(f.sx, pw), ch = PLATE_H + PLATE_GAP + f.sy;

  // Fin tips may cross the rim (the fish stands proud of it), never the bevel; the brass plate is a tag that
  // rides proud over the bottom rim, breaking the frame like a maker's label. A legend too broad for that (the
  // Moonwake Ray's wings) may lay its wingtips over the bevel, but never past the board.
  const fit = (finClear: number) => {
    const content: [number, number, number][] = [];
    for (let y = 0; y < f.sy; y++) for (let x = 0; x < f.sx; x++)
      if (front[x + f.sx * y]! >= 0) content.push([(cw - f.sx) / 2 + x, PLATE_H + PLATE_GAP + y, finClear]);
    for (let y = 0; y < PLATE_H; y++) for (let x = 0; x < pw; x++) content.push([(cw - pw) / 2 + x, y, 1]);
    // The smallest board (by area, then by its longer side) that holds the fish and plate.
    let best: { mx: number; my: number; w: number; h: number; area: number } | null = null;
    for (let ty = 0; ty <= 22; ty++) for (let tx = 0; tx <= 22; tx++) {
      const tw = cw + 2 * tx, th = ch + 2 * ty;
      if (tw > LIMIT - 2 || th + PLINTH_H + 4 > LIMIT) continue;
      const area = tw * th + .01 * Math.max(tw, th);
      if (best && area >= best.area) continue;
      const d = rings(outline(tw, th), tw, th);
      if (content.every(([x, y, clear]) => d[(x + tx) + tw * (y + ty)]! >= clear)) best = { mx: tx, my: ty, w: tw, h: th, area };
    }
    return best;
  };
  // A fish wholly inside the bead reads proudest: always for a small board, else for up to a third more board.
  const proud = fit(RIM_RINGS), crossing = fit(FIN_CLEAR);
  const chosen = proud && (!crossing || proud.area <= Math.max(crossing.area * 1.3, SMALL_BOARD)) ? proud : crossing ?? fit(1) ?? fit(0);
  const { mx = 0, my = 0, w = 0, h = 0 } = chosen ?? {};
  if (!w) throw new Error(`The ${name} is too large for a keepsake plaque.`);
  const shape = outline(w, h);

  // A crest rises from the top centre: a little arched cap with a brass boss, carved like the rim.
  const crest = Math.max(2, Math.min(4, Math.round(w / 9)));
  const bh = h + crest - 1;
  const board: boolean[] = new Array(w * bh).fill(false);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) board[x + w * y] = shape[x + w * y]!;
  const ccx = w / 2, ccy = h - 1;
  for (let y = 0; y < bh; y++) for (let x = 0; x < w; x++)
    if (y >= ccy - crest && Math.hypot(x + .5 - ccx, (y + .5 - ccy) * 1.1) <= crest + .5) board[x + w * y] = true;
  const ring = rings(board, w, bh);

  const depth = Math.max(FISH_Z + f.sz, RIM + 3);
  const out = grid(w + 2, PLINTH_H + bh, depth);
  const X = 1, Y = PLINTH_H;
  const wood = fieldWood(f);
  const seed = [...id].reduce((s, c) => Math.imul(s ^ c.charCodeAt(0), 16777619), 2166136261);

  // Board: bevel, raised rim, gilded bead, and a field with long horizontal grain.
  for (let y = 0; y < bh; y++) for (let x = 0; x < w; x++) {
    if (!board[x + w * y]) continue;
    const r = ring[x + w * y]!;
    const top = r === 0 ? FIELD : r < RIM_RINGS - 1 ? RIM : FIELD;
    for (let z = 0; z < top; z++) {
      let m: number = wood.field;
      if (r === 0) m = MAT.bark;
      else if (r < RIM_RINGS - 1) m = r === 1 ? MAT.bark : (z === top - 1 ? MAT.timber : MAT.bark);
      else if (r === RIM_RINGS - 1) m = z === top - 1 ? MAT.goldLeaf : wood.field;
      else if (z === top - 1) {
        // Grain runs along the board: a few long darker streaks, each row its own.
        const streak = mix(seed, y, Math.floor((x + Math.floor(mix(seed, y, 7) * 9)) / 9));
        if (streak < .1 || (mix(seed, y, x) < .03)) m = wood.grain;
      }
      put(out, X + x, Y + y, z, m);
    }
  }
  // Crest boss, proud of the field.
  const bossY = h - 1 + Math.floor(crest / 2);
  for (const x of w % 2 ? [(w - 1) / 2] : [w / 2 - 1, w / 2]) put(out, X + x, Y + bossY, FIELD, MAT.brass);

  // Plinth: a stepped, moulded foot under the flat of the board, deeper than the board so it stands.
  let left = w, right = -1;
  for (let x = 0; x < w; x++) if (board[x]) { left = Math.min(left, x); right = Math.max(right, x); }
  for (let x = left - 1; x <= right + 1; x++) for (let z = 0; z < RIM + 3; z++) put(out, X + x, 0, z, MAT.bark);
  for (let x = left; x <= right; x++) for (let z = 0; z < RIM + 2; z++) put(out, X + x, 1, z, MAT.timber);

  // Nameplate with clipped corners and engraved marks on its middle row.
  const bx = mx, by = my;
  const px0 = X + bx + (cw - pw) / 2, py0 = Y + by;
  for (let y = 0; y < PLATE_H; y++) for (let x = 0; x < pw; x++) {
    const corner = (x === 0 || x === pw - 1) && (y === 0 || y === PLATE_H - 1);
    if (!corner) for (let z = FIELD; z <= RIM; z++) put(out, px0 + x, py0 + y, z, MAT.brass);
  }
  let lx = px0 + Math.floor((pw - letters) / 2);
  for (const [i, n] of marks.entries()) {
    for (let k = 0; k < n; k++) put(out, lx + k, py0 + 1, RIM, MAT.hairBlack);
    lx += n + (i < marks.length - 1 ? 1 : 0);
  }

  // The fish, two cells proud of the field.
  const fx0 = X + bx + (cw - f.sx) / 2, fy0 = Y + by + PLATE_H + PLATE_GAP;
  for (let z = 0; z < f.sz; z++) for (let y = 0; y < f.sy; y++) for (let x = 0; x < f.sx; x++) {
    const m = at(f, x, y, z);
    if (m) put(out, fx0 + x, fy0 + y, FISH_Z + z, m);
  }

  // Brass peg behind the body: the 2x2 column block nearest the body's centre whose four columns all meet fish.
  let cxSum = 0, cySum = 0, n = 0;
  for (let y = 0; y < f.sy; y++) for (let x = 0; x < f.sx; x++) {
    const z = front[x + f.sx * y]!;
    if (z < 0) continue;
    let thick = 0;
    for (let k = z; k < f.sz; k++) if (at(f, x, y, k)) thick++;
    cxSum += x * thick; cySum += y * thick; n += thick;
  }
  const cx = cxSum / n, cy = cySum / n;
  let best: [number, number] | null = null, bestScore = Infinity;
  for (let y = 0; y + 1 < f.sy; y++) for (let x = 0; x + 1 < f.sx; x++) {
    const cols = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]] as const;
    if (!cols.every(([a, b]) => front[a + f.sx * b]! >= 0)) continue;
    const score = Math.hypot(x + .5 - cx, y + .5 - cy) + .25 * Math.max(...cols.map(([a, b]) => front[a + f.sx * b]!));
    if (score < bestScore) { bestScore = score; best = [x, y]; }
  }
  if (!best) {
    // A fish thinner than two cells everywhere still gets one peg through its densest column.
    for (let i = 0; i < front.length; i++) if (front[i]! >= 0) { best = [i % f.sx, Math.floor(i / f.sx)]; break; }
  }
  const [pxs, pys] = best!;
  for (const [a, b] of [[pxs, pys], [pxs + 1, pys], [pxs, pys + 1], [pxs + 1, pys + 1]] as const) {
    const z = a < f.sx && b < f.sy ? front[a + f.sx * b]! : -1;
    if (z < 0) continue;
    for (let k = FIELD; k < FISH_Z + z; k++) put(out, fx0 + a, fy0 + b, k, MAT.brass);
  }

  return { id, revision: 1, lattice: 'avatar', size: [out.sx, out.sy, out.sz], voxels: out.v };
}

/** Which way a fish will be mounted, for callers that frame the keepsake. */
export function mountPoseOf(fish: VoxelAsset): MountPose { return orient(fish, 'auto').pose; }
