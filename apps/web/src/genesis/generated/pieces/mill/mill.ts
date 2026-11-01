import type { Vec3 } from '@chatdom/shared';
import { MAT } from '@chatdom/content/materials';
import { Grid, SOFT, checkOptions, finish, hash, lanternPost, stream, variantTag, type PieceKit, type Stream } from '../kit';
import type { GeneratedPiece, PieceOptions } from '../types';

/**
 * The windmill on the rise above the town, the silhouette you remember from the road in. Two seeded forms:
 *
 * - a `tower` mill: a tapering round or octagonal body in the kit's plaster or stone on a footing course, small
 *   windows climbing it, a reefing gallery round its middle on raking brackets, and a boat-shaped cap with a fantail
 *   or a domed cap with a braced tail pole down to the gallery, both in the kit's roof;
 * - a `post` mill: a weatherboarded timber body under a gabled or curved roof, standing on its great post and the
 *   trestle's crosstrees and quarter bars, on a stone roundhouse with a conical roof or on four brick piers beside a
 *   little meal store, a tail pole and a ladder down the back to a landing at its back door.
 *
 * Both carry four lattice sails on a windshaft at the front (+Z): stocks, whips, sail bars, hemlaths and a middle
 * lath, some bays clothed in cream or the kingdom's field cloth, others bare with the cloth rolled on the whip, set at
 * a seeded angle (sometimes square at rest, sometimes a saltire). At the foot: a door painted in the field cloth with
 * a lit lamp over it, one lit window, sacks of flour, a cart or a spare millstone at the wall, a lamp post by a worn
 * path, and a fenced vegetable patch or wildflowers. The kingdom's pennant flies from the cap or the ridge.
 * Static: the sails never turn. Front is +Z; the sails may sweep wider in x than the ground the mill stands on.
 */
export type MillForm = 'tower' | 'post';
export type SailReef = 'full' | 'half' | 'point' | 'bare';

export interface WindmillLayout {
  readonly form: MillForm;
  /** Blueprint width and depth in cells; the height is trimmed to what stands. */
  readonly width: number;
  readonly depth: number;
  /** The mill's vertical axis (x, z), on a cell boundary. */
  readonly centre: readonly [number, number];
  /** The ground the mill and its yard stand on, in cells: [x0, z0, x1, z1), never more than 10 m a side. */
  readonly ground: readonly [number, number, number, number];
  readonly plan: 'round' | 'octagon' | 'box';
  readonly body: 'wall' | 'stone' | 'timber' | 'painted';
  readonly cap: 'boat' | 'dome' | 'gable' | 'curved';
  readonly base: 'plinth' | 'roundhouse' | 'piers';
  readonly winding: 'fantail' | 'tailpole';
  /** Tower: masonry height; post: the body box's height. In cells. */
  readonly bodyHeight: number;
  /** The y the body box stands at (0 for a tower). */
  readonly bodyBase: number;
  /** Tower: radius at the foot and at the curb. Post: half the body's width and depth. */
  readonly radii: readonly [number, number];
  /** Tower: the reefing gallery's deck level. Post: the roundhouse's wall height (0 on piers). */
  readonly gallery: number;
  /** Post on a roundhouse: its radius (0 otherwise). */
  readonly roundhouse: number;
  /** Where the stocks cross: x and y on a cell boundary, z the sail plane's back layer. */
  readonly hub: Vec3;
  readonly sails: {
    readonly radius: number;
    /** The first stock's angle from +X, radians, in [0, pi/2). */
    readonly angle: number;
    readonly heel: number;
    readonly width: number;
    readonly cloth: 'cream' | 'field';
    readonly reef: readonly [SailReef, SailReef, SailReef, SailReef];
  };
  readonly foot: 'cart' | 'millstone';
  readonly garden: 'fenced' | 'wildflowers';
  /** Which side (+1 east, -1 west) the garden takes; the sacks and the cart or millstone take the other. */
  readonly side: 1 | -1;
}

const GROUND = 80;
const LEAD = 3;
const MIN_TOP = 114;
const MAX_TOP = 150;
const MIN_CLEAR = 12;

/** The highest and lowest reach of the four sails above and below the hub, and the widest across, in cells. */
function sailReach(R: number, angle: number, heel: number, width: number): { up: number; down: number; across: number } {
  let up = -Infinity, down = Infinity, across = 0;
  for (let k = 0; k < 4; k++) {
    const t = angle + (k * Math.PI) / 2, c = Math.cos(t), s = Math.sin(t);
    for (const [u, v] of [[R, -LEAD], [R, width], [heel, width], [R, 1.2], [R, -1.2]] as const) {
      const x = u * c - v * s, y = u * s + v * c;
      up = Math.max(up, y); down = Math.min(down, y); across = Math.max(across, Math.abs(x));
    }
  }
  return { up, down, across };
}

function chooseSails(r: Stream, hubY: number): { radius: number; angle: number; heel: number; width: number } {
  for (let attempt = 0; attempt < 24; attempt++) {
    // At rest a miller sets the sails square (the short rest) or as a saltire (the long rest); else where they stopped.
    const angle = attempt < 20 && r.chance(0.3) ? r.pick([0, Math.PI / 4]) : r.range(0.12, Math.PI / 2 - 0.12);
    const fit: number[] = [];
    for (let R = 48; R <= 64; R++) {
      const heel = Math.round(R * 0.2), width = Math.round(R * 0.19), e = sailReach(R, angle, heel, width);
      if (hubY + e.down >= MIN_CLEAR && hubY + e.up >= MIN_TOP && hubY + e.up <= MAX_TOP) fit.push(R);
    }
    if (fit.length) {
      const radius = fit[Math.floor(r.next() * fit.length)]!;
      return { radius, angle, heel: Math.round(radius * 0.2), width: Math.round(radius * 0.19) };
    }
  }
  throw new Error(`No sail fits a hub at ${hubY}.`);
}

export function windmillLayout(seed: number): WindmillLayout {
  const r = stream(seed, 0x3111f);
  const form: MillForm = r.chance(0.5) ? 'tower' : 'post';
  const reefPlan = r.pick(['full', 'pairs', 'reefed', 'mixed', 'full'] as const);
  const reefs: SailReef[] = [0, 1, 2, 3].map(k => {
    if (reefPlan === 'full') return 'full';
    if (reefPlan === 'pairs') return k % 2 ? 'bare' : 'full';
    if (reefPlan === 'reefed') return 'point';
    return r.pick(['full', 'half', 'point', 'bare'] as const);
  });
  if (reefs.filter(s => s !== 'bare').length < 2) { reefs[0] = 'full'; reefs[2] = 'half'; }
  const cloth = r.chance(0.55) ? 'cream' as const : 'field' as const;
  const foot = r.chance(0.5) ? 'cart' as const : 'millstone' as const;
  const garden = r.chance(0.55) ? 'fenced' as const : 'wildflowers' as const;
  const side = r.chance(0.5) ? 1 as const : -1 as const;
  const reef = reefs as unknown as WindmillLayout['sails']['reef'];

  if (form === 'tower') {
    const plan = r.chance(0.6) ? 'round' as const : 'octagon' as const;
    const body = r.chance(0.55) ? 'wall' as const : 'stone' as const;
    const cap = r.chance(0.5) ? 'boat' as const : 'dome' as const;
    const rBase = r.int(22, 25), rTop = rBase - r.int(6, 8), bodyHeight = r.int(72, 96);
    const gallery = Math.round(bodyHeight * r.range(0.42, 0.5));
    const hubY = bodyHeight + (cap === 'boat' ? 8 : 7);
    const s = chooseSails(r, hubY);
    const reach = sailReach(s.radius, s.angle, s.heel, s.width);
    const half = Math.max(GROUND / 2, Math.ceil(reach.across) + 3);
    const cz = GROUND / 2, rg = rBase - Math.floor(((rBase - rTop) * gallery) / bodyHeight + 0.5);
    const zs = cz + Math.max(rg + 11, rTop + (cap === 'boat' ? 10 : 6));
    return {
      form, width: 2 * half, depth: Math.max(GROUND, zs + 5), centre: [half, cz], ground: [half - GROUND / 2, 0, half + GROUND / 2, GROUND],
      plan, body, cap, base: 'plinth', winding: cap === 'boat' ? 'fantail' : 'tailpole',
      bodyHeight, bodyBase: 0, radii: [rBase, rTop], gallery, roundhouse: 0,
      hub: [half, hubY, zs], sails: { ...s, cloth, reef }, foot, garden, side,
    };
  }

  const base = r.chance(0.55) ? 'roundhouse' as const : 'piers' as const;
  const body = r.chance(0.65) ? 'timber' as const : 'painted' as const;
  const cap = r.chance(0.6) ? 'gable' as const : 'curved' as const;
  const hw = r.int(17, 20), hd = r.int(21, 23), bodyHeight = r.int(46, 52);
  const roundhouse = base === 'roundhouse' ? r.int(19, 22) : 0;
  const wall = base === 'roundhouse' ? r.int(22, 25) : 0;
  const bodyBase = base === 'roundhouse' ? wall + r.int(10, 12) : r.int(30, 34);
  const hubY = bodyBase + bodyHeight - 7;
  const s = chooseSails(r, hubY);
  const reach = sailReach(s.radius, s.angle, s.heel, s.width);
  const half = Math.max(GROUND / 2, Math.ceil(reach.across) + 3);
  const cz = GROUND - Math.max(roundhouse + 7, hd + 2);
  const zs = cz + hd + 6;
  return {
    form, width: 2 * half, depth: Math.max(GROUND, zs + 5), centre: [half, cz], ground: [half - GROUND / 2, 0, half + GROUND / 2, GROUND],
    plan: 'box', body, cap, base, winding: 'tailpole',
    bodyHeight, bodyBase, radii: [hw, hd], gallery: wall, roundhouse,
    hub: [half, hubY, zs], sails: { ...s, cloth, reef }, foot, garden, side,
  };
}

/** Face directions round a body: +Z, +X, -Z, -X. */
type Dir = 0 | 1 | 2 | 3;
/** The column `k` cells out from the axis along `dir`, `a` cells across it (a in [-w/2, w/2) centres on the axis). */
function column(cx: number, cz: number, dir: Dir, k: number, a: number): readonly [number, number] {
  switch (dir) {
    case 0: return [cx + a, cz + k];
    case 1: return [cx + k, cz - 1 - a];
    case 2: return [cx - 1 - a, cz - 1 - k];
    case 3: return [cx - 1 - k, cz + a];
  }
}

interface Opening {
  readonly dir: Dir;
  /** Across: [a0, a1). Up: [y0, y1). Arched heads spring at y1 minus half the width. */
  readonly a0: number; readonly a1: number; readonly y0: number; readonly y1: number;
  readonly arch: boolean;
  readonly kind: 'door' | 'lit' | 'dark';
}

/**
 * Cuts a window or a door into the outermost cells of a body along a face direction: the glass set back a cell in
 * its reveal with lamplight (or the dark) behind it, or a door two cells deep in the field cloth with ledges and
 * strap hinges, all inside a proud surround and, for windows, a projecting sill.
 */
function cut(g: Grid, kit: PieceKit, cx: number, cz: number, o: Opening, isBody: (m: number) => boolean, surround: number, door: number, reach: number): void {
  const mid = (o.a0 + o.a1) / 2, rad = (o.a1 - o.a0) / 2, spring = o.y1 - rad;
  const inside = (a: number, y: number) => a >= o.a0 && a < o.a1 && y >= o.y0 && y < o.y1
    && (!o.arch || y < spring || Math.hypot(a + 0.5 - mid, y + 0.5 - spring) <= rad);
  const outer = new Map<string, number>();
  for (let y = o.y0 - 2; y < o.y1 + 3; y++) for (let a = o.a0 - 2; a < o.a1 + 2; a++) {
    for (let k = reach; k >= 0; k--) {
      const [x, z] = column(cx, cz, o.dir, k, a);
      if (isBody(g.get(x, y, z))) { outer.set(`${a},${y}`, k); break; }
    }
  }
  const at = (k: number, a: number, y: number, m: number) => { const [x, z] = column(cx, cz, o.dir, k, a); g.set(x, y, z, m); };
  for (let y = o.y0 - 2; y < o.y1 + 3; y++) for (let a = o.a0 - 2; a < o.a1 + 2; a++) {
    const k = outer.get(`${a},${y}`);
    if (k === undefined) continue;
    if (inside(a, y)) {
      if (o.kind === 'door') {
        at(k, a, y, MAT.air); at(k - 1, a, y, MAT.air);
        const ledge = y === o.y0 + 2 || y === o.y0 + Math.floor((o.y1 - o.y0) / 2) || y === spring - 1;
        const hinge = ledge && (a <= o.a0 + 2 || a >= o.a1 - 3);
        at(k - 2, a, y, hinge ? kit.iron : ledge ? kit.wood : door);
      } else {
        at(k, a, y, MAT.air); at(k - 1, a, y, MAT.glass);
        // Glazing bars across the middle, and behind the glass lamplight or the dark of a store.
        if (y === Math.floor((o.y0 + o.y1) / 2) || (o.a1 - o.a0 >= 4 && a === Math.floor(mid))) at(k - 1, a, y, kit.trim);
        at(k - 2, a, y, o.kind === 'lit' ? MAT.goldLeaf : MAT.darkStone);
      }
      continue;
    }
    let near = false;
    for (const [da, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) if (inside(a + da, y + dy)) near = true;
    if (!near) continue;
    at(k, a, y, surround);
    if (o.kind !== 'door' && y === o.y0 - 1) at(k + 1, a, y, surround);
    if (o.kind === 'door' && y >= spring && a > o.a0 - 2 && a < o.a1 + 1) at(k + 1, a, y, surround);
  }
  if (o.kind === 'door') {
    // The knob, and the keystone over the head.
    const kk = outer.get(`${o.a1 - 3},${o.y0 + 8}`);
    if (kk !== undefined) at(kk - 1, o.a1 - 3, o.y0 + 8, kit.metal);
    const kt = outer.get(`${Math.floor(mid)},${o.y1}`);
    if (kt !== undefined) { at(kt + 1, Math.floor(mid) - 1, o.y1, kit.rock); at(kt + 1, Math.floor(mid), o.y1, kit.rock); at(kt + 1, Math.floor(mid), o.y1 + 1, kit.rock); at(kt + 1, Math.floor(mid) - 1, o.y1 + 1, kit.rock); }
  }
}

/**
 * A wall lamp on an iron bracket over a door facing +Z: the arm runs out of the wall at `y`, the lantern hangs
 * under its end with an iron cap, glass, a brass foot and a drip. Returns the flame cell.
 */
function wallLamp(g: Grid, kit: PieceKit, x: number, y: number, zWall: number): Vec3 {
  g.fill(x, y, zWall - 1, x + 2, y + 1, zWall + 5, kit.iron);
  g.fill(x, y + 1, zWall - 1, x + 2, y + 2, zWall + 1, kit.iron);
  // The scroll under the arm.
  g.set(x, y - 1, zWall, kit.iron); g.set(x + 1, y - 1, zWall, kit.iron); g.set(x, y - 2, zWall, kit.iron); g.set(x + 1, y - 2, zWall, kit.iron);
  g.set(x, y - 1, zWall + 1, kit.iron);
  const lz = zWall + 3;
  g.fill(x - 1, y - 1, lz - 1, x + 3, y, lz + 2, kit.iron);
  g.fill(x, y - 4, lz, x + 2, y - 1, lz + 1, MAT.glass);
  for (const dx of [-1, 2]) for (const dz of [-1, 1]) g.fill(x + dx, y - 4, lz + dz, x + dx + 1, y - 1, lz + dz + 1, kit.iron);
  g.fill(x - 1, y - 5, lz - 1, x + 3, y - 4, lz + 2, kit.metal);
  g.set(x, y - 6, lz, kit.metal);
  // The glass hangs from the cap: the iron corner rods carry it to the arm.
  return [x, y - 3, lz];
}

/** The kingdom's pennant on an iron pole from `(x, y, z)` upward, flying toward `fly` (+1 or -1 in x). */
function pennant(g: Grid, kit: PieceKit, x: number, y: number, z: number, fly: 1 | -1, field: number, charge: number, border: number): number {
  const h = 14;
  g.fill(x, y, z, x + 1, y + h, z + 1, kit.iron);
  g.set(x, y + h, z, kit.metal);
  for (let k = 0; k < 11; k++) {
    const tall = k < 7 ? 5 - Math.floor(k / 2.5) : 3;
    for (let dy = 0; dy < tall; dy++) {
      if (k >= 9 && dy === 1) continue;
      const m = dy === tall - 1 || dy === 0 && k < 7 ? border : k === 3 && dy === 2 ? charge : k === 2 && dy === 2 ? charge : field;
      g.set(x + fly * (1 + k), y + h - 1 - dy - (k > 6 ? 1 : 0), z, m);
    }
  }
  return y + h + 1;
}

/** A flour sack standing (or lying along x): cream with a soft shoulder and a thatch-cord tie. */
function sack(g: Grid, kit: PieceKit, x: number, y: number, z: number, lying: boolean): void {
  if (lying) {
    g.fill(x, y, z, x + 5, y + 2, z + 3, MAT.cream);
    g.fill(x + 1, y + 2, z, x + 4, y + 3, z + 3, MAT.cream);
    g.set(x + 5, y + 1, z + 1, kit.cord);
    return;
  }
  g.fill(x, y, z, x + 3, y + 4, z + 3, MAT.cream);
  g.set(x, y + 3, z, MAT.air); g.set(x + 2, y + 3, z + 2, MAT.air);
  g.fill(x + 1, y + 4, z + 1, x + 2, y + 5, z + 2, kit.cord);
  g.set(x + 1, y + 5, z + 1, MAT.cream);
}

export function createWindmill(options: PieceOptions): GeneratedPiece {
  const kit = checkOptions(options);
  const { field, charge, border } = options.colours;
  const L = windmillLayout(options.seed);
  const r = stream(options.seed, 0x4d111);
  const salt = (options.seed ^ 0x51e7) | 0;
  const [cx] = L.centre;
  const g = new Grid(L.width, 168, L.depth);
  const lanterns: Vec3[] = [];
  const [gx0, gz0, gx1, gz1] = L.ground;
  const clothMat = L.sails.cloth === 'cream' ? MAT.cream : field;

  let doorFront: { x: number; z: number; y: number; wall: number };
  let shaftFrom: number;
  if (L.form === 'tower') {
    const t = tower(g, kit, L, salt, r, field);
    doorFront = t.door; shaftFrom = t.shaftFrom;
    const fly = L.side;
    pennant(g, kit, cx - 1 + (L.cap === 'dome' ? 0 : 0), t.top, t.pennantZ, fly, field, charge, border);
  } else {
    const p = postMill(g, kit, L, salt, r, field);
    doorFront = p.door; shaftFrom = p.shaftFrom;
    pennant(g, kit, cx - 1, p.ridgeTop, p.pennantZ, L.side, field, charge, border);
  }

  // ── The windshaft out of the cap or breast, banded in iron, a neck bearing where it leaves, and the poll end.
  const [hx, hy, zs] = L.hub;
  for (let z = shaftFrom; z < zs - 1; z++) for (let y = hy - 3; y <= hy + 3; y++) for (let x = hx - 3; x <= hx + 3; x++) {
    const d = Math.hypot(x + 0.5 - hx, y + 0.5 - hy);
    if (d <= 2.3) g.set(x, y, z, (zs - z) % 5 === 0 ? kit.iron : kit.wood);
  }
  sails(g, kit, L, clothMat);

  // ── The yard: a worn path from the door to the front edge, an earth apron at the foot.
  const { x: doorX, z: doorZ } = doorFront;
  for (let z = doorZ; z < gz1; z++) {
    const wob = Math.round(2.2 * Math.sin(z * 0.17 + salt * 0.001) + (z - doorZ) * 0.12 * -L.side);
    for (let x = doorX - 5 + wob; x < doorX + 5 + wob; x++) if (!g.get(x, 0, z) && hash(x >> 1, 2, z >> 1, salt) > 0.07) g.set(x, 0, z, MAT.earth);
  }
  // The step before the door.
  g.fill(doorX - 7, 0, doorZ - 1, doorX + 7, 1, doorZ + 3, kit.base);

  // ── The lamp post by the path, on the garden's side, behind the sail plane.
  const lpx = doorX + L.side * 14 - (L.side < 0 ? 2 : 0), lpz = Math.min(zs - 4, doorZ + 6);
  lanterns.push(lanternPost(g, kit, lpx, lpz, 20));
  lanterns.unshift(doorFront.y > 0 ? wallLamp(g, kit, doorX - 1, doorFront.y, doorFront.wall) : wallLamp(g, kit, doorX - 1, 26, doorZ));

  // ── Sacks of flour by the door on the other side, and the cart or the spare millstone.
  const sx = doorX - L.side * 11 - (L.side > 0 ? 3 : 0), sz = doorZ - 1;
  sack(g, kit, sx, 0, sz, false); sack(g, kit, sx - L.side * 4, 0, sz + 1, false); sack(g, kit, sx - L.side * 2, 4, sz + 1, false);
  sack(g, kit, sx - (L.side > 0 ? 6 : -2), 0, sz + 5, true);
  if (L.foot === 'cart') cart(g, kit, L, doorX - L.side * 26, doorZ + 4, r);
  else millstone(g, kit, L, doorX - L.side * 22, doorZ - 5);

  // ── The garden: a fenced vegetable patch, or wildflowers in the long grass round the foot.
  if (L.garden === 'fenced') vegPatch(g, kit, L, salt);
  wildflowers(g, L, salt, L.garden === 'fenced' ? 10 : 34);

  // Keep the yard on its ground; the sails alone may sweep beyond it.
  for (let z = 0; z < g.sz; z++) for (let x = 0; x < g.sx; x++) {
    if (x >= gx0 && x < gx1 && z >= gz0 && z < gz1) continue;
    for (let y = 0; y < 12; y++) g.set(x, y, z, MAT.air);
  }
  g.prune(SOFT);

  // Trim the grid to what stands, so the blueprint's height is the mill's.
  let top = 0;
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i]) top = Math.max(top, Math.floor(i / g.sx) % g.sy);
  const out = new Grid(g.sx, top + 1, g.sz);
  for (let z = 0; z < g.sz; z++) for (let y = 0; y <= top; y++) for (let x = 0; x < g.sx; x++) out.set(x, y, z, g.get(x, y, z));
  const id = `genesis-windmill-${kit.style}-${L.form}-${L.cap}-${variantTag(options.seed, options.colours)}`;
  return finish(out, id, kit.style, lanterns);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────── the tower mill

function tower(g: Grid, kit: PieceKit, L: WindmillLayout, salt: number, r: Stream, field: number) {
  const [cx, cz] = L.centre, [rBase, rTop] = L.radii, H = L.bodyHeight;
  const rAt = (y: number) => rBase - Math.floor(((rBase - rTop) * Math.min(y, H)) / H + 0.5);
  const inPlan = (dx: number, dz: number, rad: number) => L.plan === 'round'
    ? dx * dx + dz * dz <= (rad + 0.3) ** 2
    : Math.abs(dx) <= rad && Math.abs(dz) <= rad && (Math.abs(dx) + Math.abs(dz)) * Math.SQRT1_2 <= rad + 0.2;
  // Grove's dark stone reads blue-painted in a whole tower: its stone tower is grey field stone, dark stone footings.
  const stone = kit.style === 'grove' ? MAT.stone : kit.stone;
  const skin = L.body === 'wall' ? kit.wall : stone;
  const fleck = kit.style === 'grove' ? MAT.darkStone : kit.rock === skin ? kit.base : kit.rock;
  const plinth = 6;

  // ── The body: a stepped taper, a flared footing course, and for stone a few coursed blocks and a band.
  for (let y = 0; y < H; y++) {
    const rad = rAt(y) + (y < plinth ? 1 : 0);
    for (let z = cz - rad - 2; z <= cz + rad + 2; z++) for (let x = cx - rad - 2; x <= cx + rad + 2; x++) {
      if (inPlan(x + 0.5 - cx, z + 0.5 - cz, rad)) g.set(x, y, z, y < plinth ? (y === plinth - 1 ? kit.base : stone) : skin);
    }
  }
  const isBody = (m: number) => m === skin || m === stone || m === kit.base || m === fleck || m === MAT.moss;
  for (let y = plinth; y < H; y++) {
    const rad = rAt(y);
    for (let z = cz - rad - 1; z <= cz + rad + 1; z++) for (let x = cx - rad - 1; x <= cx + rad + 1; x++) {
      if (g.get(x, y, z) !== skin || !g.exposed(x, y, z)) continue;
      const ang = Math.atan2(z + 0.5 - cz, x + 0.5 - cx), around = Math.floor(((ang + Math.PI) * rad) / 4);
      if (L.body === 'stone') {
        const course = Math.floor(y / 3), block = hash(around + course * 7, course, 0, salt);
        if (block < 0.1) g.set(x, y, z, fleck);
        else if (y < plinth + 6 && hash(around, y >> 1, 1, salt) < 0.18 && Math.sin(ang) < -0.2) g.set(x, y, z, MAT.moss);
      } else {
        // Plaster fallen away in a few patches, showing the stone beneath.
        const patch = hash(Math.floor(around / 2), Math.floor(y / 6), 2, salt);
        if (patch < 0.035 && hash(around, y >> 1, 3, salt) < 0.75) g.set(x, y, z, stone);
      }
    }
  }
  // A string course under the gallery.
  const gy = L.gallery;
  for (let y = gy - 3; y < gy - 1; y++) {
    const rad = rAt(y) + 1;
    for (let z = cz - rad - 1; z <= cz + rad + 1; z++) for (let x = cx - rad - 1; x <= cx + rad + 1; x++) {
      if (inPlan(x + 0.5 - cx, z + 0.5 - cz, rad) && !inPlan(x + 0.5 - cx, z + 0.5 - cz, rad - 1.5)) g.set(x, y, z, y === gy - 3 ? kit.base : stone);
    }
  }

  // ── The door at the front, painted in the field cloth, and the windows climbing the tower.
  const reach = rBase + 4, surround = L.body === 'wall' ? stone : kit.base;
  cut(g, kit, cx, cz, { dir: 0, a0: -5, a1: 5, y0: 1, y1: 20, arch: true, kind: 'door' }, isBody, surround, field, reach);
  const windows: Opening[] = [
    { dir: 0, a0: -2, a1: 2, y0: 32, y1: 39, arch: false, kind: 'lit' },
    { dir: (L.side > 0 ? 3 : 1) as Dir, a0: -2, a1: 2, y0: 18 + r.int(0, 4), y1: 25 + r.int(0, 4), arch: false, kind: 'dark' },
    { dir: (L.side > 0 ? 1 : 3) as Dir, a0: -2, a1: 2, y0: gy + 14, y1: gy + 21, arch: true, kind: 'dark' },
    { dir: 2, a0: -2, a1: 2, y0: gy - 16, y1: gy - 10, arch: false, kind: 'dark' },
  ];
  if (H - gy > 34) windows.push({ dir: 0, a0: -2, a1: 2, y0: H - 14, y1: H - 7, arch: true, kind: 'dark' });
  for (const w of windows) cut(g, kit, cx, cz, w, isBody, L.body === 'wall' ? kit.trim : kit.base, field, reach);
  // The gallery door, on the side the lamp post stands, under a little hood.
  cut(g, kit, cx, cz, { dir: (L.side > 0 ? 1 : 3) as Dir, a0: -3, a1: 3, y0: gy + 1, y1: gy + 14, arch: true, kind: 'door' }, isBody, surround, kit.trim, reach);

  // ── The reefing gallery: a plank deck on raking brackets, a fascia, posts and a top rail.
  const rg = rAt(gy), deck = rg + 9;
  for (let z = cz - deck - 2; z <= cz + deck + 2; z++) for (let x = cx - deck - 2; x <= cx + deck + 2; x++) {
    const dx = x + 0.5 - cx, dz = z + 0.5 - cz, d = Math.hypot(dx, dz);
    if (!inPlan(dx, dz, deck) || inPlan(dx, dz, rg - 0.5)) continue;
    const rim = !inPlan(dx, dz, deck - 1.2);
    g.set(x, gy, z, rim ? kit.wood : kit.trim);
    if (rim) g.set(x, gy - 1, z, kit.wood);
    // The rail: posts every few cells round the rim and a cap rail at elbow height.
    const ang = Math.atan2(dz, dx), post = Math.abs(((ang * deck) / 5) % 1) < 0.22 || Math.abs(((ang * deck) / 5) % 1) > 0.78;
    if (rim && post && d > 0) g.fill(x, gy + 1, z, x + 1, gy + 7, z + 1, kit.wood);
    if (rim) g.set(x, gy + 7, z, kit.trim);
  }
  const brackets = L.plan === 'octagon' ? 8 : 12;
  for (let k = 0; k < brackets; k++) {
    const ang = (k / brackets) * Math.PI * 2 + Math.PI / brackets, sn = Math.sin(ang), cs = Math.cos(ang);
    const foot = gy - 10, rf = rAt(foot) - 1, rt = rg + 7;
    const a: [number, number, number] = [Math.floor(cx + sn * rf), foot, Math.floor(cz + cs * rf)];
    const b: [number, number, number] = [Math.floor(cx + sn * rt), gy - 1, Math.floor(cz + cs * rt)];
    g.line(a, b, kit.wood);
    g.line([a[0], a[1] + 1, a[2]], [b[0], b[1], b[2]], kit.wood);
  }

  // ── The curb, and the cap: a boat-shaped cap reaching forward over the windshaft, or a domed cap.
  const curb = H;
  for (let y = curb; y < curb + 3; y++) {
    const rad = rTop + 1;
    for (let z = cz - rad - 1; z <= cz + rad + 1; z++) for (let x = cx - rad - 1; x <= cx + rad + 1; x++) {
      if (inPlan(x + 0.5 - cx, z + 0.5 - cz, rad)) g.set(x, y, z, y === curb + 2 ? kit.wood : kit.trim);
    }
  }
  const capY = curb + 3;
  const roofBand = kit.style === 'hearth' ? MAT.brick : kit.style === 'tide' ? MAT.darkStone : MAT.moss;
  let top: number, shaftFrom: number, pennantZ: number;
  if (L.cap === 'boat') {
    const a = rTop + 3, b = rTop + 7, czc = cz + 3, capH = Math.round(rTop * 0.85) + 3;
    for (let z = czc - b - 1; z <= czc + b + 1; z++) for (let x = cx - a - 1; x <= cx + a + 1; x++) {
      const dx = (x + 0.5 - cx) / a, dz = (z + 0.5 - czc) / b;
      const w = 1 - Math.abs(dz) ** 4;
      if (w <= 0 || Math.abs(dx) >= Math.sqrt(w)) continue;
      const hgt = capH * (1 - (dx * dx) / w) ** 0.55 * w ** 0.25;
      for (let y = 0; y < Math.round(hgt); y++) {
        const ridge = Math.abs(x + 0.5 - cx) < 1.1 && y === Math.round(hgt) - 1;
        g.set(x, capY + y, z, ridge ? kit.wood : y === 0 ? kit.trim : kit.roof);
      }
    }
    // Courses of the roof's second tone and the hood's barge board over the shaft.
    for (let y = capY + 3; y < capY + capH; y += 5) g.over(cx - a - 1, y, czc - b - 1, cx + a + 2, y + 1, czc + b + 2, kit.roof === MAT.thatch ? kit.roof : roofBand);
    g.over(cx - a - 1, capY, czc - b - 1, cx + a + 2, capY + capH, czc - b + 3, kit.roof);
    for (let y = capY; y < capY + capH; y++) for (let x = cx - a; x <= cx + a; x++) {
      let zf = czc + b + 1;
      while (zf > czc && g.get(x, y, zf) === 0) zf--;
      if (zf > czc && g.get(x, y, zf) !== 0 && g.get(x, y + 1, zf) === 0) g.set(x, y, zf, kit.trim);
    }
    top = capY + capH;
    // Ball finials at either end of the ridge.
    for (const zEnd of [czc + b - 3, czc - b + 3]) {
      let y = capY + capH;
      while (y > capY && !g.get(cx, y - 1, zEnd)) y--;
      g.fill(cx - 1, y, zEnd - 1, cx + 1, y + 2, zEnd + 1, kit.metal);
    }
    shaftFrom = czc;
    pennantZ = czc - 2;
    // ── The fantail on its raked frame behind the cap, its vanes square to the sails.
    const fy = capY + capH - 1, fz = czc - b - 8, fr = 9;
    for (const s of [-1, 1]) {
      g.line([cx + s * 5 - (s < 0 ? 1 : 0), capY + 1, czc - b + 4], [cx + s * 2 - (s < 0 ? 1 : 0), fy, fz], kit.wood);
      g.line([cx + s * 4 - (s < 0 ? 1 : 0), capY + capH - 3, czc - b + 3], [cx + s * 2 - (s < 0 ? 1 : 0), fy, fz], kit.wood);
    }
    g.fill(cx - 3, fy - 1, fz - 1, cx + 3, fy + 1, fz + 1, kit.iron);
    const vanes = 6, tilt = r.range(0, Math.PI / 3);
    for (let y = fy - fr - 1; y <= fy + fr + 1; y++) for (let z = fz - fr - 1; z <= fz + fr + 1; z++) {
      const dy = y + 0.5 - fy - 0.0, dz = z + 0.5 - fz;
      for (let k = 0; k < vanes; k++) {
        const t = tilt + (k * Math.PI * 2) / vanes, u = dz * Math.cos(t) + dy * Math.sin(t), v = -dz * Math.sin(t) + dy * Math.cos(t);
        if (u >= 0 && u <= fr && Math.abs(v) <= (u < 3 ? 0.8 : 1.7)) { g.set(cx - 1, y, z, u < 3 ? kit.wood : kit.trim); g.set(cx, y, z, u < 3 ? kit.wood : kit.trim); }
      }
    }
    g.fill(cx - 1, fy - 1, fz - 1, cx + 1, fy + 1, fz + 1, kit.metal);
  } else {
    const capH = Math.round(rTop * 0.95) + 2, rd = rTop + 2;
    // An eave ring that flares a cell past the curb, then the dome.
    for (let z = cz - rd - 2; z <= cz + rd + 2; z++) for (let x = cx - rd - 2; x <= cx + rd + 2; x++) {
      const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
      if (inPlan(dx, dz, rd + 1)) g.set(x, capY, z, kit.roof);
    }
    for (let y = 1; y < capH; y++) {
      const t = y / capH, rad = rd * Math.sqrt(Math.max(0, 1 - t ** 2.2)) ;
      for (let z = cz - rd - 1; z <= cz + rd + 1; z++) for (let x = cx - rd - 1; x <= cx + rd + 1; x++) {
        const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
        if (!(L.plan === 'round' ? dx * dx + dz * dz <= rad * rad : inPlan(dx, dz, rad))) continue;
        g.set(x, capY + y, z, y % 6 === 3 ? (kit.roof === MAT.thatch ? kit.cord : roofBand) : kit.roof);
      }
    }
    // A hood over the windshaft on the dome's front, and the finial.
    const hy = L.hub[1];
    g.fill(cx - 5, hy - 4, cz + rd - 3, cx + 5, hy + 5, cz + rd + 2, kit.roof);
    g.fill(cx - 5, hy + 4, cz + rd - 3, cx + 5, hy + 5, cz + rd + 3, kit.trim);
    g.fill(cx - 4, hy - 4, cz + rd + 1, cx + 4, hy + 4, cz + rd + 3, kit.trim);
    top = capY + capH;
    g.fill(cx - 2, top - 1, cz - 2, cx + 2, top + 1, cz + 2, kit.trim);
    g.fill(cx - 1, top + 1, cz - 1, cx + 1, top + 3, cz + 1, kit.metal);
    top += 3;
    shaftFrom = cz;
    pennantZ = cz - 1;
    // ── The tail pole, braced from the cap's sides, down the back to the gallery rail, and its winch wheel.
    const poleTop: [number, number, number] = [cx - 1, capY + 2, cz - rd + 1];
    const poleFoot: [number, number, number] = [cx - 1, gy + 8, cz - rg - 7];
    g.line(poleTop, poleFoot, kit.wood); g.line([cx, poleTop[1], poleTop[2]], [cx, poleFoot[1], poleFoot[2]], kit.wood);
    g.line([poleTop[0], poleTop[1] + 1, poleTop[2]], [poleFoot[0], poleFoot[1] + 1, poleFoot[2]], kit.wood);
    const mid: [number, number, number] = [cx, Math.round((poleTop[1] * 2 + poleFoot[1]) / 3), Math.round((poleTop[2] * 2 + poleFoot[2]) / 3)];
    for (const s of [-1, 1]) g.line([cx + s * (rd - 1) - (s < 0 ? 1 : 0), capY + 1, cz - 2], mid, kit.wood);
    const wy = poleFoot[1] + 6, wz = poleFoot[2] - 1;
    for (let y = wy - 6; y <= wy + 6; y++) for (let x = cx - 7; x <= cx + 7; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - wy), ang = Math.atan2(y + 0.5 - wy, x + 0.5 - cx);
      const spoke = d < 5 && Math.abs(Math.sin(ang * 3)) < 0.6 / Math.max(1, d);
      if ((d >= 4.4 && d <= 5.9) || spoke || d < 1.2) g.set(x, y, wz, d < 1.2 ? kit.iron : kit.wood);
    }
    g.fill(cx - 1, poleFoot[1], wz, cx + 1, wy, wz + 2, kit.wood);
  }
  const zDoor = cz + rAt(0) + 1;
  return { door: { x: cx, z: zDoor + 1, y: 28, wall: zDoor }, top, shaftFrom, pennantZ };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────── the post mill

function postMill(g: Grid, kit: PieceKit, L: WindmillLayout, salt: number, r: Stream, field: number) {
  const [cx, cz] = L.centre, [hw, hd] = L.radii, by = L.bodyBase, H = L.bodyHeight;
  const bx0 = cx - hw, bx1 = cx + hw, bz0 = cz - hd, bz1 = cz + hd;
  const boards = L.body === 'painted' ? kit.wall : kit.trim, lip = L.body === 'painted' ? kit.trim : kit.wood;
  const stone = kit.style === 'grove' ? MAT.stone : kit.stone;
  let door: { x: number; z: number; y: number; wall: number };

  // ── The great post, and the trestle: crosstrees, quarter bars, crown tree.
  g.fill(cx - 2, 8, cz - 2, cx + 2, by, cz + 2, kit.wood);
  const ct = 19;
  g.fill(cx - ct, 8, cz - 2, cx + ct, 12, cz + 2, kit.wood);
  g.fill(cx - 2, 8, cz - ct, cx + 2, 12, cz + ct, kit.wood);
  for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const a: [number, number, number] = [cx + sx * (ct - 3) - (sx < 0 ? 1 : 0), 12, cz + sz * (ct - 3) - (sz < 0 ? 1 : 0)];
    const b: [number, number, number] = [cx + sx * 2 - (sx < 0 ? 1 : 0), by - 12, cz + sz * 2 - (sz < 0 ? 1 : 0)];
    g.line(a, b, kit.wood); g.line([a[0] + Math.abs(sz), a[1], a[2] + Math.abs(sx)], [b[0] + Math.abs(sz), b[1], b[2] + Math.abs(sx)], kit.wood);
    g.line([a[0], a[1] + 1, a[2]], [b[0], b[1] + 1, b[2]], kit.wood);
  }
  g.fill(bx0 + 3, by - 3, cz - 2, bx1 - 3, by, cz + 2, kit.wood);
  g.fill(cx - 3, by - 6, cz - 3, cx + 3, by - 3, cz + 3, kit.iron);

  if (L.base === 'roundhouse') {
    // ── The roundhouse: a round stone wall, a door at the front, and a shallow conical roof up to the body.
    const R = L.roundhouse, wall = L.gallery;
    for (let y = 0; y < wall; y++) {
      const rad = R + (y < 3 ? 1 : 0);
      for (let z = cz - rad - 1; z <= cz + rad + 1; z++) for (let x = cx - rad - 1; x <= cx + rad + 1; x++) {
        const dx = x + 0.5 - cx, dz = z + 0.5 - cz, d = Math.hypot(dx, dz);
        if (d > rad + 0.3) continue;
        if (d < rad - 3 && y > 0) continue;
        let m = y < 3 ? kit.base : stone;
        if (y >= 3) {
          const around = Math.floor(((Math.atan2(dz, dx) + Math.PI) * R) / 3), course = Math.floor(y / 2);
          if (hash(around + course * 5, course, 4, salt) < 0.12) m = kit.style === 'grove' ? MAT.darkStone : kit.rock === stone ? kit.base : kit.rock;
        }
        g.set(x, y, z, m);
      }
    }
    // Fill the hollow so the floor reads solid through the door's reveal only.
    for (let z = cz - R; z <= cz + R; z++) for (let x = cx - R; x <= cx + R; x++) if (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) < R - 2.5) g.fill(x, 0, z, x + 1, wall, z + 1, MAT.darkStone);
    const cone = by - 2 - wall, top = 4;
    for (let k = 0; k <= cone; k++) {
      const rad = R + 2 - ((R + 2 - top) * k) / cone;
      for (let z = cz - R - 3; z <= cz + R + 3; z++) for (let x = cx - R - 3; x <= cx + R + 3; x++) {
        const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
        if (d <= rad) g.set(x, wall + k, z, k === 0 && d > rad - 2 ? kit.trim : kit.roof);
      }
    }
    const isBody = (m: number) => m === stone || m === kit.base || m === kit.rock || m === MAT.darkStone;
    cut(g, kit, cx, cz, { dir: 0, a0: -4, a1: 4, y0: 1, y1: 16, arch: true, kind: 'door' }, isBody, kit.base, field, R + 3);
    cut(g, kit, cx, cz, { dir: (L.side > 0 ? 1 : 3) as Dir, a0: -2, a1: 2, y0: 7, y1: 13, arch: false, kind: 'lit' }, isBody, kit.trim, field, R + 3);
    const zw = cz + R + 1;
    door = { x: cx, z: zw + 1, y: Math.min(wall - 1, 22), wall: zw };
  } else {
    // ── Four brick piers under the crosstrees' ends, footed in stone, capped in the kit's stone.
    for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const px = cx + sx * (ct - 3) - 3, pz = cz + sz * (ct - 3) - 3;
      g.fill(px - 1, 0, pz - 1, px + 7, 2, pz + 7, stone);
      g.fill(px, 2, pz, px + 6, 7, pz + 6, MAT.brick);
      g.fill(px - 1, 7, pz - 1, px + 7, 8, pz + 7, stone);
    }
    // ── The meal store beside the mill: a little lean-to house whose door faces the path.
    const s = L.side, hx0 = s > 0 ? cx + 22 : cx - 40, hx1 = hx0 + 18, hz0 = cz + 6, hz1 = Math.min(L.ground[3] - 3, cz + 22);
    g.fill(hx0 - 1, 0, hz0 - 1, hx1 + 1, 1, hz1 + 1, stone);
    g.fill(hx0, 1, hz0, hx1, 15, hz1, kit.wall);
    for (const x of [hx0, hx1 - 2]) g.fill(x, 1, hz0, x + 2, 15, hz1, kit.trim);
    g.fill(hx0, 14, hz0, hx1, 15, hz1, kit.trim);
    // A roof pitched across x, its ridge running front to back.
    const half = (hx1 - hx0) / 2 + 2;
    for (let k = 0; k < half; k++) {
      const x0 = hx0 - 2 + k, x1 = hx1 + 2 - k;
      g.fill(x0, 15 + k, hz0 - 2, x1, 16 + k, hz1 + 2, kit.roof);
      if (x1 - x0 > 6) g.fill(x0 + 3, 15 + k, hz0, x1 - 3, 16 + k, hz1, kit.wall);
    }
    const isBody = (m: number) => m === kit.wall || m === kit.trim;
    const mx = (hx0 + hx1) / 2;
    cut(g, kit, mx, (hz0 + hz1) / 2, { dir: 0, a0: -4, a1: 4, y0: 1, y1: 14, arch: false, kind: 'door' }, isBody, kit.wood, field, (hz1 - hz0) / 2 + 2);
    // Its door lamp under the eaves.
    door = { x: mx, z: hz1 + 1, y: 0, wall: hz1 };
  }

  // ── The body: boards on a timber frame, darker corner posts, a sill beam and a wall plate.
  g.fill(bx0, by, bz0, bx1, by + H, bz1, boards);
  for (let y = by + 2; y < by + H; y += 3) {
    g.over(bx0, y, bz0, bx1, y + 1, bz0 + 1, lip); g.over(bx0, y, bz1 - 1, bx1, y + 1, bz1, lip);
    g.over(bx0, y, bz0, bx0 + 1, y + 1, bz1, lip); g.over(bx1 - 1, y, bz0, bx1, y + 1, bz1, lip);
  }
  for (const [x, z] of [[bx0 - 1, bz0 - 1], [bx1 - 1, bz0 - 1], [bx0 - 1, bz1 - 1], [bx1 - 1, bz1 - 1]] as const) g.fill(x, by, z, x + 2, by + H, z + 2, kit.wood);
  g.fill(bx0 - 1, by, bz0 - 1, bx1 + 1, by + 2, bz1 + 1, kit.wood);
  g.fill(bx0 - 1, by + H - 2, bz0 - 1, bx1 + 1, by + H, bz1 + 1, kit.wood);
  // Windows on the sides, one lit; and the back door at the head of the ladder.
  const isBoard = (m: number) => m === boards || m === lip || m === kit.wood;
  cut(g, kit, cx, cz, { dir: (L.side > 0 ? 1 : 3) as Dir, a0: -2 + r.int(-6, 6), a1: 2, y0: by + 22, y1: by + 29, arch: false, kind: 'lit' }, isBoard, kit.wood, field, hw + 3);
  cut(g, kit, cx, cz, { dir: (L.side > 0 ? 3 : 1) as Dir, a0: -2, a1: 2, y0: by + 30, y1: by + 36, arch: false, kind: 'dark' }, isBoard, kit.wood, field, hw + 3);
  cut(g, kit, cx, cz, { dir: 0, a0: 6, a1: 9, y0: by + 14, y1: by + 19, arch: false, kind: 'dark' }, isBoard, kit.wood, field, hd + 3);
  cut(g, kit, cx, cz, { dir: 2, a0: -4, a1: 4, y0: by + 2, y1: by + 18, arch: false, kind: 'door' }, isBoard, kit.wood, kit.trim, hd + 3);

  // ── The roof, ridge front to back: a steep gable or a curved roof, overhanging the breast as a hood.
  const eave = by + H, rz0 = bz0 - 2, rz1 = bz1 + 3, span = hw + 2;
  let ridgeTop = eave;
  for (let x = bx0 - 2; x < bx1 + 2; x++) {
    const dx = Math.abs(x + 0.5 - cx);
    const h = L.cap === 'gable' ? Math.round((span - dx) * 1.15) : Math.round(span * 0.78 * Math.sqrt(Math.max(0, 1 - (dx / span) ** 2)));
    for (let y = 0; y <= h; y++) {
      const shell = y > h - 3;
      if (shell) g.fill(x, eave + y, rz0, x + 1, eave + y + 1, rz1, y === h && dx < 1.1 ? kit.wood : kit.roof);
      else g.fill(x, eave + y, bz0, x + 1, eave + y + 1, bz1, boards);
    }
    ridgeTop = Math.max(ridgeTop, eave + h + 1);
  }
  // Barge boards on both gables.
  for (let x = bx0 - 2; x < bx1 + 2; x++) for (let y = eave; y < ridgeTop; y++) for (const z of [rz0, rz1 - 1]) {
    if (g.get(x, y, z) === kit.roof && !g.get(x, y + 1, z)) g.set(x, y, z, kit.trim);
  }
  // A ridge course in the roof's second tone (thatch keeps its own).
  const roofBand = kit.style === 'hearth' ? MAT.brick : kit.style === 'tide' ? MAT.darkStone : MAT.moss;
  for (let x = bx0 - 2; x < bx1 + 2; x++) for (let y = eave + 4; y < ridgeTop; y += 6) for (let z = rz0; z < rz1; z++) {
    if (g.get(x, y, z) === kit.roof && !g.get(x, y + 1, z) && kit.roof !== MAT.thatch) g.set(x, y, z, roofBand);
  }

  // ── The landing at the back door, the ladder down to the yard, and the tail pole beside it to its wheel.
  const run = Math.round(by * 0.7), zFoot = bz0 - 5 - run;
  g.fill(cx - 7, by - 2, bz0 - 5, cx + 6, by, bz0, kit.trim);
  g.fill(cx - 7, by, bz0 - 5, cx - 6, by + 8, bz0, kit.wood); g.fill(cx + 5, by, bz0 - 5, cx + 6, by + 8, bz0, kit.wood);
  g.fill(cx - 7, by + 8, bz0 - 5, cx + 6, by + 9, bz0 - 4, kit.wood);
  // The hood over the back door.
  g.fill(cx - 6, by + 19, bz0 - 4, cx + 5, by + 20, bz0, kit.roof);
  g.fill(cx - 6, by + 18, bz0 - 1, cx + 5, by + 19, bz0, kit.trim);
  for (const x of [cx - 7, cx + 5]) {
    g.line([x, by - 2, bz0 - 5], [x, 0, zFoot], kit.wood);
    g.line([x, by - 1, bz0 - 5], [x, 1, zFoot], kit.wood);
    g.line([x, by + 8, bz0 - 5], [x, 8, zFoot], kit.wood);
    g.fill(x, 0, zFoot, x + 1, 9, zFoot + 1, kit.wood);
  }
  for (let k = 2; k < run; k += 3) {
    const z = bz0 - 5 - k, y = Math.round(by - 2 - ((by - 2) * k) / run);
    g.fill(cx - 6, y, z, cx + 5, y + 1, z + 2, kit.trim);
  }
  const tx = cx + 9 * L.side - (L.side < 0 ? 1 : 0), tailEnd = Math.max(3, zFoot - 2);
  g.line([tx, by - 2, bz0 + 4], [tx, 5, tailEnd], kit.wood);
  g.line([tx, by - 3, bz0 + 4], [tx, 4, tailEnd], kit.wood);
  for (let y = 0; y <= 10; y++) for (let z = tailEnd - 5; z <= tailEnd + 5; z++) {
    const d = Math.hypot(y + 0.5 - 5, z + 0.5 - tailEnd);
    if ((d >= 3.6 && d <= 5) || (d < 3.6 && (Math.abs(y + 0.5 - 5) < 0.6 || Math.abs(z + 0.5 - tailEnd) < 0.6))) g.set(tx + L.side, y, z, d < 1.2 ? kit.iron : kit.wood);
  }
  // A brace from the tail pole up to the body's back corner.
  g.line([tx, Math.round(by * 0.55), Math.round(bz0 - run * 0.45)], [tx, by - 1, bz0 - 1], kit.wood);

  return { door, shaftFrom: bz1 - 6, ridgeTop, pennantZ: rz0 + 3 };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────── the sails

/**
 * Four lattice sails in the x–y plane at the hub: each a stock out from the canister, its whip carrying the sail
 * frame (a narrow leading board, the wide driving side, sail bars across every few cells, a middle lath, the hemlath
 * at the outer edge and bars at the heel and the tip), bays clothed by the sail's reef, a bare sail's cloth rolled
 * along its whip. The lattice sits in the back layer, the stocks stand a cell proud in front of it.
 */
function sails(g: Grid, kit: PieceKit, L: WindmillLayout, cloth: number): void {
  const [hx, hy, zs] = L.hub, { radius: R, angle, heel, width: W, reef } = L.sails;
  const spacing = 6, reach = R + W + 2;
  for (let y = hy - reach; y <= hy + reach; y++) for (let x = hx - reach; x <= hx + reach; x++) {
    const dx = x + 0.5 - hx, dy = y + 0.5 - hy;
    for (let k = 0; k < 4; k++) {
      const t = angle + (k * Math.PI) / 2, c = Math.cos(t), s = Math.sin(t);
      const u = dx * c + dy * s, v = -dx * s + dy * c;
      if (u < -0.5 || u > R + 0.6) continue;
      if (Math.abs(v) <= 1.2) {
        g.set(x, y, zs, kit.wood);
        if (u < R - 4) g.set(x, y, zs + 1, kit.wood);
        continue;
      }
      if (u < heel || v < -LEAD || v > W) continue;
      const f = (u - heel) / (R - heel);
      const member = v <= -LEAD + 1.5 || v >= W - 1.5 || u >= R - 1.5 || u <= heel + 1.5 || (u - heel) % spacing < 1.5 || Math.abs(v - W * 0.55) <= 0.75;
      const plan = reef[k]!;
      const clothed = plan === 'full' || (plan === 'half' && f < 0.52) || (plan === 'point' && (v + LEAD) / (W + LEAD) < 1 - f * 0.92);
      if (member) g.set(x, y, zs, kit.trim);
      else if (clothed) g.set(x, y, zs, cloth);
      // A furled sail's cloth rolled up along the whip and tied.
      if ((plan === 'bare' || (plan === 'half' && f >= 0.52)) && v > 1.2 && v <= 3.1 && u > heel + 1 && u < R - 2) {
        g.set(x, y, zs + 1, (Math.floor(u) % 9 === 0) ? kit.cord : cloth);
      }
    }
  }
  // The canister the stocks pass through, and the poll end's boss.
  for (let y = hy - 4; y <= hy + 4; y++) for (let x = hx - 4; x <= hx + 4; x++) {
    const d = Math.hypot(x + 0.5 - hx, y + 0.5 - hy);
    if (d <= 3.6) g.fill(x, y, zs - 2, x + 1, y + 1, zs + 2, kit.iron);
    if (d <= 2.2) g.set(x, y, zs + 2, kit.metal);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────── the foot

function cart(g: Grid, kit: PieceKit, L: WindmillLayout, x: number, z: number, r: Stream): void {
  // A two-wheeled hand cart, its shafts resting on the ground, two sacks aboard.
  const x0 = x - 5, x1 = x + 5, z0 = z - 7, z1 = z + 6;
  g.fill(x0, 5, z0, x1, 6, z1, kit.trim);
  g.fill(x0, 6, z0, x0 + 1, 8, z1, kit.wood); g.fill(x1 - 1, 6, z0, x1, 8, z1, kit.wood);
  g.fill(x0, 6, z0, x1, 8, z0 + 1, kit.wood);
  for (const wx of [x0 - 1, x1]) for (let y = 0; y <= 8; y++) for (let zz = z - 5; zz <= z + 5; zz++) {
    const d = Math.hypot(y + 0.5 - 4.5, zz + 0.5 - z);
    if ((d >= 3.3 && d <= 4.6) || d < 1.1 || (d < 3.3 && (Math.abs(y + 0.5 - 4.5) < 0.55 || Math.abs(zz + 0.5 - z) < 0.55))) g.set(wx, y, zz, d < 1.1 ? kit.iron : kit.wood);
  }
  g.fill(x0 - 1, 4, z - 1, x1 + 1, 5, z + 1, kit.iron);
  for (const sx of [x0 + 1, x1 - 2]) g.line([sx, 5, z1], [sx, 0, z1 + 9], kit.wood);
  sack(g, kit, x0 + 1, 6, z0 + 2, false);
  if (r.chance(0.7)) sack(g, kit, x0 + 2, 6, z0 + 7, true);
}

function millstone(g: Grid, kit: PieceKit, L: WindmillLayout, x: number, z: number): void {
  // A spare millstone stood on edge against the wall, leaning back, its dressing furrows dark and its eye open.
  const rad = 6.5, cy = 6.5;
  for (let y = 0; y <= 13; y++) for (let xx = x - 7; xx <= x + 7; xx++) {
    const dx = xx + 0.5 - x, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
    if (d > rad) continue;
    const lean = y >= 8 ? 1 : 0;
    if (d < 1.4) { g.set(xx, y, z - lean, kit.iron); continue; }
    const ang = Math.atan2(dy, dx), furrow = Math.abs(Math.sin(ang * 5 + d * 0.25)) < 0.14 && d > 2;
    g.fill(xx, y, z - lean - 1, xx + 1, y + 1, z - lean + 1, furrow ? kit.base : d > rad - 1 ? kit.rock : kit.stone === MAT.darkStone ? MAT.stone : kit.stone);
  }
  // A wedge stone at its foot.
  g.fill(x - 3, 0, z + 1, x + 3, 1, z + 3, kit.base);
}

function vegPatch(g: Grid, kit: PieceKit, L: WindmillLayout, salt: number): void {
  const [gx0, , gx1, gz1] = L.ground;
  const w = 20, d = 16, x0 = L.side > 0 ? gx1 - w - 2 : gx0 + 2, z0 = gz1 - d - 4;
  for (let z = z0 + 2; z < z0 + d - 2; z++) for (let x = x0 + 2; x < x0 + w - 2; x++) {
    g.set(x, 0, z, MAT.earth);
    if ((z - z0) % 4 === 0 || hash(x, 1, z, salt) < 0.5) continue;
    // Rows of greens, a few in flower.
    const h = 1 + Math.floor(hash(x >> 1, 2, z >> 1, salt) * 2);
    g.fill(x, 1, z, x + 1, 1 + h, z + 1, MAT.leaf);
    const b = hash(x, 3, z, salt);
    if (b < 0.18) g.set(x, 1 + h, z, b < 0.06 ? MAT.petal : b < 0.12 ? MAT.cream : MAT.blueFlower);
  }
  // The fence: posts every few cells and two rails, a gap for the gate on the path's side.
  const gateX = L.side > 0 ? x0 + 2 : x0 + w - 6;
  for (let x = x0; x < x0 + w; x++) for (const z of [z0, z0 + d - 1]) {
    if (z === z0 + d - 1 && x >= gateX && x < gateX + 4) continue;
    const post = (x - x0) % 4 === 0 || x === x0 + w - 1;
    if (post) g.fill(x, 0, z, x + 1, 7, z + 1, kit.trim);
    g.set(x, 3, z, kit.wood); g.set(x, 5, z, kit.wood);
  }
  for (let z = z0; z < z0 + d; z++) for (const x of [x0, x0 + w - 1]) {
    const post = (z - z0) % 4 === 0 || z === z0 + d - 1;
    if (post) g.fill(x, 0, z, x + 1, 7, z + 1, kit.trim);
    g.set(x, 3, z, kit.wood); g.set(x, 5, z, kit.wood);
  }
  // A gate post either side of the gap.
  for (const x of [gateX - 1, gateX + 4]) g.fill(x, 0, z0 + d - 1, x + 1, 8, z0 + d, kit.trim);
}

function wildflowers(g: Grid, L: WindmillLayout, salt: number, count: number): void {
  const [gx0, gz0, gx1, gz1] = L.ground, [cx, cz] = L.centre;
  for (let k = 0; k < count * 3 && count > 0; k++) {
    const x = Math.floor(gx0 + 2 + hash(k, 1, 0, salt) * (gx1 - gx0 - 4)), z = Math.floor(gz0 + 2 + hash(k, 2, 0, salt) * (gz1 - gz0 - 4));
    if (Math.abs(x - cx) < 7 && z > cz) continue;
    let near = false;
    for (let dz = -1; dz <= 1 && !near; dz++) for (let dx = -1; dx <= 1; dx++) if (g.get(x + dx, 0, z + dz) || g.get(x + dx, 1, z + dz)) near = true;
    if (near) continue;
    const h = 1 + Math.floor(hash(k, 3, 0, salt) * 3);
    g.fill(x, 0, z, x + 1, h, z + 1, MAT.leaf);
    if (hash(k, 6, 0, salt) < 0.5) g.set(x + 1, 0, z, MAT.leaf);
    const b = hash(k, 4, 0, salt);
    g.set(x, h, z, b < 0.4 ? MAT.petal : b < 0.7 ? MAT.blueFlower : MAT.cream);
    if (--count <= 0) break;
  }
}
