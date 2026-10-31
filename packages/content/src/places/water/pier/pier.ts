import type { Vec3 } from '@chatdom/shared';
import { Boxes } from '../../../civic/kit';
import { MAT, STYLES, type StyleKey } from '../../../materials';
import { checkStyle, masonry, millBlueprint, runs, stroke, wood } from '../millrace/craft';
import type { EmitterAnchor, Footing, MountPoint, SeatEdge, SoundAnchor, TextPlane, WalkStrip, WaterPiece } from '../place-piece';
import { hash } from '../shore/shape';

/**
 * The lake pier: a dark timber walk on piles running out from the bank to a T-shaped head, built as separate
 * supported modules (a root on the bank, bays along the walk, the head), because the whole would leave the
 * 256-cell blueprint bound. Every module shares the pier's frame, in build cells: local +Z runs out over the water,
 * x 0..20 is the walk's width, the head spans x −22..42 (8 m) over its last 32 cells. A module's corner sits at its
 * `offset`, whose y is measured from the deck top, so the host places module m at
 * `pierFrame · (offset + deckAboveWater)` with the pier's own cardinal turn.
 *
 * Age is drawn, not painted on: plank ends are darker and ragged, the deck sags a cell between some bents, the rail
 * rises and dips from post to post, and one plank is missing from the head's west wing, outside every walk strip.
 * Piles run down to the bed the caller sampled and carry waterweed at the waterline. At the end of the head a seat
 * edge faces open water beside a six-metre bell post whose lantern the host lights only through the shared
 * people-light result. A name board hangs over the pier's foot for the lake name the caller supplies.
 */

const WALK_WIDTH = 20;
const ROOT = 32;
const BAY = 32;
const HEAD_DEPTH = 32;
const HEAD_X: readonly [number, number] = [-22, 42];
/** Planks, joists and caps under the deck top: 1 + 2 + 2 cells. */
const PLANK = 1, JOIST = 2, CAP = 2;
const UNDER = PLANK + JOIST + CAP;
/** Ground this close under the deck top carries the deck on stone, not on piles. */
const ON_STONE = UNDER + 1;
/** The clear strip people walk on, inside the kerb (x 0..2) and the rail (x 18..20). */
const WALK_ACROSS: readonly [number, number] = [3, 17];
const RAIL_X: readonly [number, number] = [18, 20];
const RAIL_HEIGHT = 8;
const HEADROOM = 16;
const PILE = 2;
const POLE_HEIGHT = 48;
/** The name board's underside clears the walk's headroom. */
const GATE_BEAM = HEADROOM + 6;

export const PIER = {
  walkWidth: WALK_WIDTH,
  root: ROOT,
  bay: BAY,
  head: { x: HEAD_X, depth: HEAD_DEPTH },
  walkAcross: WALK_ACROSS,
  railHeight: RAIL_HEIGHT,
  headroom: HEADROOM,
  pole: POLE_HEIGHT,
  /** About four metres of warm pool at the pier end. */
  reach: 32,
  /** The land's 0.6–0.8 m deck height, in cells. */
  freeboard: [4.8, 6.4] as const,
} as const;

/**
 * Where the pier stands, sampled by the host from the land. `depth` is how far the ground or bed lies under the
 * deck top, in cells, at pier-local cell point (x, z) (positive below the deck; the bank may stand up to four
 * cells above it at the root). `freeboard` is the deck top over the lake surface, in cells.
 */
export interface PierSite {
  /** Cells from the root to the head; the land's 24 m walk is 192. Even, 96..224. */
  readonly walk: number;
  readonly freeboard: number;
  readonly depth: (x: number, z: number) => number;
  readonly seed: number;
}

export type PierRole = 'root' | 'bay' | 'head';
export interface PierModule {
  readonly id: string;
  readonly role: PierRole;
  readonly piece: WaterPiece;
  /** The module's corner in pier-local cells; y is measured from the deck top (so it is ≤ 0). */
  readonly offset: Vec3;
}
export interface Pier {
  readonly modules: readonly PierModule[];
  /** Pier-local z of every bent (pile row), for the water's contact foam and the host's checks. */
  readonly bents: readonly number[];
  /** Pier-local cells of every pile's centre at the waterline, y from the deck top. */
  readonly piles: readonly Vec3[];
}

function checkSite(site: PierSite): void {
  if (!Number.isInteger(site.walk) || site.walk % 2 || site.walk < 96 || site.walk > 224) {
    throw new RangeError(`pier: walk must be an even 96..224 cells, not ${site.walk}.`);
  }
  if (!Number.isFinite(site.freeboard) || site.freeboard < PIER.freeboard[0] || site.freeboard > PIER.freeboard[1]) {
    throw new RangeError(`pier: the deck must stand ${PIER.freeboard[0]}..${PIER.freeboard[1]} cells over the water, not ${site.freeboard}.`);
  }
  if (!Number.isSafeInteger(site.seed)) throw new RangeError(`pier: seed must be a whole number, not ${site.seed}.`);
}

/**
 * The bents along the pier: one in the middle of the root and of each bay, then the head's three rows. Spans
 * between them that sag lose one cell in their middle third, so the deck dips between posts and never at one.
 */
function layout(site: PierSite) {
  const bays = Math.max(1, Math.round((site.walk - ROOT) / BAY));
  const lengths = Array.from({ length: bays }, (_, k) => {
    const base = Math.floor((site.walk - ROOT) / bays / 2) * 2;
    return k === bays - 1 ? site.walk - ROOT - base * (bays - 1) : base;
  });
  const starts: number[] = [];
  lengths.reduce((z, length) => { starts.push(z); return z + length; }, ROOT);
  const head = site.walk;
  const bents = [ROOT / 2 - 1, ...starts.map((z, k) => z + lengths[k]! / 2 - 1), head + 1, head + 15, head + 29];
  const sagging = bents.slice(0, -3).map((z, k) => {
    const next = bents[k + 1]!;
    // The first span leaves the bank level and the last meets the head level; others sag on the seed.
    if (k === 0 || k >= bents.length - 4) return null;
    if (hash(site.seed, 41, k) >= 0.5) return null;
    const third = Math.round((next - z - PILE) / 3 / 2) * 2;
    return [z + PILE + third, next - third] as const;
  }).filter((span): span is readonly [number, number] => span !== null);
  return { bays: lengths.map((length, k) => ({ start: starts[k]!, length })), head, bents, sagging };
}

/** The deck top over pier-local column z, relative to the deck datum: 0, −1 where a span sags, ramped at the root. */
function deckTop(site: PierSite, z: number, sagging: readonly (readonly [number, number])[], ramp: { readonly step: number; readonly run: number }): number {
  if (ramp.step && z < ramp.run) return ramp.step - Math.sign(ramp.step) * Math.floor(z / 3);
  return sagging.some(([a, b]) => z >= a && z < b) ? -1 : 0;
}

/** The ramp from the bank onto the deck: a step of whole cells (bank above the deck positive), one cell per 3. */
function rootRamp(site: PierSite): { step: number; run: number } {
  const ground = -Math.round(site.depth(WALK_WIDTH / 2, 0.5));
  if (ground > 4 || ground < -4) throw new RangeError(`pier: the bank meets the deck with a ${Math.abs(ground)}-cell step; the land allows four.`);
  const step = Math.abs(ground) <= 1 ? 0 : ground;
  return { step, run: Math.abs(step) * 3 };
}

interface Builder {
  readonly b: Boxes;
  /** Converts a pier-local y (from the deck top) into module cells. */
  readonly y: (v: number) => number;
}

/** A pile from its sampled bed up to the cap's underside, with waterweed at the waterline; returns its footing. */
function pile(m: Builder, site: PierSite, size: readonly [number, number], x: number, z: number, worldX: number, worldZ: number, top: number, id: string, seed: number): Footing | null {
  const depth = site.depth(worldX + PILE / 2, worldZ + PILE / 2);
  const bottom = -Math.ceil(depth);
  const capUnder = top - UNDER;
  if (bottom >= capUnder) return null;
  const water = -site.freeboard;
  m.b.add(x, m.y(bottom), z, x + PILE, m.y(capUnder), z + PILE, MAT.bark);
  // The waterline: a band of weed and slime, a strand trailing below, and the pile's foot bedded in silt.
  const line = Math.floor(water);
  if (line > bottom) {
    m.b.add(x, m.y(Math.max(bottom, line - 1)), z, x + PILE, m.y(Math.min(capUnder, line + 1)), z + PILE, MAT.moss);
    const side = Math.floor(hash(seed, 3) * 4);
    const [sx, sz] = ([[x - 1, z], [x + PILE, z + 1], [x + 1, z - 1], [x, z + PILE]] as const)[side]!;
    const strand = Math.max(bottom, line - 2 - Math.floor(hash(seed, 4) * 3));
    if (sx >= 0 && sz >= 0 && sx < size[0] && sz < size[1]) m.b.add(sx, m.y(strand), sz, sx + 1, m.y(line), sz + 1, MAT.leaf);
  }
  if (line - 1 > bottom) m.b.add(x, m.y(bottom), z, x + PILE, m.y(bottom + 1), z + PILE, MAT.earth);
  return { id, box: { from: [x, m.y(bottom), z], to: [x + PILE, m.y(bottom) + 1, z + PILE] } };
}

/**
 * Lays one span of deck across x 0..width over the module's columns: planks (two cells along z, darker ragged ends,
 * an odd darker board), and under them joists or, where the bank comes up close, stone. `tops[z]` is relative to
 * the deck datum; `zOffset` is the module's first pier-local z.
 */
function deck(m: Builder, style: StyleKey, site: PierSite, opts: {
  readonly width: number; readonly length: number; readonly zOffset: number; readonly xOffset: number; readonly tops: readonly number[];
  readonly joists: readonly number[]; readonly missing?: { readonly x: readonly [number, number]; readonly z: readonly [number, number] };
  readonly joints?: readonly number[];
}): (number | null)[] {
  const w = wood(style), stone = masonry(style);
  const { width, length, zOffset, xOffset, tops } = opts;
  const stoneUnder: (number | null)[] = [];
  for (let z = 0; z < length; z++) {
    stoneUnder.push(null);
    const top = tops[z]!, plank = Math.floor((z + zOffset) / 2), r = hash(site.seed, 7, plank);
    const face = r < 0.18 ? w.end : r > 0.9 ? MAT.bark : w.plank;
    const y0 = m.y(top - PLANK), y1 = m.y(top);
    // Ragged ends: a plank stops a cell short at either edge now and then, and its end grain is dark.
    const left = hash(site.seed, 8, plank) < 0.3 ? 1 : 0, right = width - (hash(site.seed, 9, plank) < 0.3 ? 1 : 0);
    const joints = opts.joints?.map(j => j + (hash(site.seed, 10, plank, j) < 0.5 ? 0 : 3)) ?? [];
    const missing = opts.missing && z >= opts.missing.z[0] && z < opts.missing.z[1] ? opts.missing.x : null;
    const segments: [number, number][] = [];
    let a = left;
    for (const j of [...joints, right]) { if (j > a) segments.push([a, j]); a = j; }
    for (const [s0, s1] of segments) {
      const [c0, c1] = missing && s0 < missing[1] && s1 > missing[0] ? [Math.max(s0, missing[0]), Math.min(s1, missing[1])] : [0, 0];
      if (c1 > c0) {
        // The missing board: its neighbours' ends stay dark where it broke away.
        if (c0 > s0) { m.b.add(s0, y0, z, c0, y1, z + 1, face); m.b.add(c0 - 1, y0, z, c0, y1, z + 1, w.end); }
        if (s1 > c1) { m.b.add(c1, y0, z, s1, y1, z + 1, face); m.b.add(c1, y0, z, c1 + 1, y1, z + 1, w.end); }
        continue;
      }
      m.b.add(s0, y0, z, s1, y1, z + 1, face);
      m.b.add(s0, y0, z, s0 + 1, y1, z + 1, w.end);
      m.b.add(s1 - 1, y0, z, s1, y1, z + 1, w.end);
    }
    // Under the planks: stone where the bank is within reach of the deck, otherwise joists.
    let ground = -Infinity;
    for (let x = 0; x < width; x += 4) ground = Math.max(ground, -site.depth(x + xOffset + 0.5, z + zOffset + 0.5));
    if (ground > top - ON_STONE) {
      let low = Infinity;
      for (let x = 0; x < width; x += 2) low = Math.min(low, -site.depth(x + xOffset + 0.5, z + zOffset + 0.5));
      const bottom = Math.floor(low);
      if (bottom < top - PLANK) {
        stoneUnder[z] = bottom;
        const course = Math.floor((z + zOffset) / 4) % 2;
        m.b.add(0, m.y(bottom), z, width, m.y(top - PLANK), z + 1, stone.stone);
        // Coursed joints on the outer faces, and the damp foot.
        if ((z + zOffset) % 4 === 3) for (const x of [0, width - 1]) m.b.add(x, m.y(bottom), z, x + 1, m.y(top - PLANK), z + 1, stone.band);
        for (let y = top - PLANK - 2 - course * 2; y > bottom; y -= 4) for (const x of [0, width - 1]) m.b.add(x, m.y(y), z, x + 1, m.y(y) + 1, z + 1, stone.wet);
        m.b.add(0, m.y(bottom), z, width, m.y(Math.min(top - PLANK, bottom + 1)), z + 1, stone.wet);
      }
    } else {
      for (const jx of opts.joists) m.b.add(jx, m.y(top - PLANK - JOIST), z, jx + 2, m.y(top - PLANK), z + 1, MAT.bark);
    }
  }
  return stoneUnder;
}

/** Caps (bent beams) across the module at each bent column, under the joists. */
function caps(m: Builder, width: number, bents: readonly number[], tops: (z: number) => number): void {
  for (const z of bents) m.b.add(0, m.y(tops(z) - UNDER), z, width, m.y(tops(z) - PLANK - JOIST), z + PILE, MAT.bark);
}

/**
 * The uneven rail on the walk's east side: posts every bent and twice between, each a little taller or shorter,
 * and a top rail that follows them from post to post. Returns nothing; posts at bents stand on the pile below.
 */
function rail(m: Builder, style: StyleKey, site: PierSite, zOffset: number, length: number, posts: readonly number[], tops: (z: number) => number): void {
  const w = wood(style);
  const heights = posts.map(z => RAIL_HEIGHT + [-1, 0, 0, 1][Math.floor(hash(site.seed, 13, z + zOffset) * 4)]!);
  posts.forEach((z, i) => {
    m.b.add(RAIL_X[0], m.y(tops(z) - PLANK), z, RAIL_X[1], m.y(tops(z) + heights[i]!), z + 2, w.plank);
    m.b.add(RAIL_X[0], m.y(tops(z) + heights[i]! - 1), z, RAIL_X[1], m.y(tops(z) + heights[i]!), z + 2, w.end);
  });
  for (let i = 0; i + 1 < posts.length; i++) {
    const a = posts[i]!, c = posts[i + 1]!;
    // One section of rail on the pier has split and hangs a cell lower at its far end.
    const droop = hash(site.seed, 14, a + zOffset) < 0.12 ? 2 : 0;
    const cells = stroke([a + 1, tops(a) + heights[i]! - 1.5], [c + 1, tops(c) + heights[i + 1]! - 1.5 - droop], 0.6);
    runs(cells.map(([u, v]) => [u, v] as [number, number]).filter(([u]) => u >= 0 && u < length), (z0, z1, y) =>
      m.b.add(RAIL_X[0], m.y(y), z0, RAIL_X[1], m.y(y) + 1, z1, w.plank));
  }
}

/** The rail is continuous across modules: it runs on from the first and last posts to the module's edges. */
function railToEdges(m: Builder, style: StyleKey, length: number, posts: readonly number[], tops: (z: number) => number, ends: { readonly start: boolean; readonly end: boolean }): void {
  const w = wood(style);
  const spans: (readonly [number, number, number])[] = [];
  if (ends.start) spans.push([0, posts[0]!, posts[0]!]);
  if (ends.end) spans.push([posts.at(-1)! + 2, length, posts.at(-1)!]);
  for (const [z0, z1, post] of spans) {
    if (z1 <= z0) continue;
    const y = tops(post) + RAIL_HEIGHT - 1;
    m.b.add(RAIL_X[0], m.y(y - 1), z0, RAIL_X[1], m.y(y), z1, w.plank);
  }
}

/** A kerb along the open west edge, a board laid on the planks. */
function kerb(m: Builder, style: StyleKey, length: number, tops: (z: number) => number): void {
  const w = wood(style);
  runs(Array.from({ length }, (_, z) => [z, tops(z)] as [number, number]), (z0, z1, top) => m.b.add(0, m.y(top), z0, 2, m.y(top + 1), z1, w.end));
}

/** Modules are drawn relative to the deck top, lifted by this, then settled so the lowest solid cell is y = 0. */
const LIFT = 512;

function moduleBuilder(): Builder {
  return { b: new Boxes(), y: v => v + LIFT };
}

const columnsOf = (length: number) => Array.from({ length }, (_, z) => z);

/**
 * Settles a module: drops every box so its deepest bearing lands on y = 0, and carries its metadata with it. Returns
 * the piece and the module's corner y relative to the deck top.
 */
function settleModule(id: string, style: StyleKey, size: readonly [number, number], m: Builder, meta: Omit<WaterPiece, 'blueprint'>): { piece: WaterPiece; bottom: number } {
  const solid = m.b.list.filter(box => box.material !== MAT.air);
  const low = Math.min(...solid.map(box => box.from[1]!)), high = Math.max(...solid.map(box => box.to[1]!));
  const shifted = new Boxes();
  for (const box of m.b.list) {
    const y0 = Math.max(box.from[1]!, low), y1 = Math.min(box.to[1]!, high);
    shifted.add(box.from[0]!, y0 - low, box.from[2]!, box.to[0]!, y1 - low, box.to[2]!, box.material);
  }
  const down = (p: Vec3): Vec3 => [p[0], p[1] - low, p[2]];
  const boxDown = <T extends { readonly box: { readonly from: Vec3; readonly to: Vec3 } }>(item: T): T => ({ ...item, box: { from: down(item.box.from), to: down(item.box.to) } });
  const piece: WaterPiece = {
    blueprint: millBlueprint(id, style, 'civic', [size[0], high - low, size[1]], shifted),
    footings: meta.footings.map(boxDown),
    walks: meta.walks.map(walk => ({ ...walk, tops: walk.tops.map(t => t - low) })),
    seats: meta.seats.map(boxDown),
    emitters: meta.emitters.map(e => ({ ...e, position: down(e.position) })),
    sounds: meta.sounds.map(s => ({ ...s, position: down(s.position) })),
    texts: meta.texts.map(t => ({ ...t, centre: down(t.centre) })),
    mounts: meta.mounts.map(mount => ({ ...mount, position: down(mount.position) })),
    clear: meta.clear.map(boxDown),
  };
  return { piece, bottom: low - LIFT };
}

function walkStrip(m: Builder, id: string, length: number, tops: readonly number[]): WalkStrip {
  return { id, axis: 'z', along: [0, length], across: WALK_ACROSS, tops: tops.map(t => m.y(t)) };
}

function rootModule(style: StyleKey, site: PierSite, plan: ReturnType<typeof layout>): PierModule {
  const ramp = rootRamp(site), length = ROOT;
  const tops = columnsOf(length).map(z => deckTop(site, z, plan.sagging, ramp));
  const m = moduleBuilder(), w = wood(style);
  const bent = plan.bents[0]!;
  const top = (z: number) => tops[Math.max(0, Math.min(length - 1, z))]!;
  const stone = deck(m, style, site, { width: WALK_WIDTH, length, zOffset: 0, xOffset: 0, tops, joists: [2, 9, 16] });
  const footings: Footing[] = [];
  // The root's bent stands where the bank has fallen away; nearer the bank the deck rests on stone.
  if (stone[bent] === null && stone[bent + 1] === null) {
    for (const x of [0, WALK_WIDTH - PILE]) {
      const f = pile(m, site, [WALK_WIDTH, length], x, bent, x, bent, top(bent), `pile-${x ? 'east' : 'west'}-${bent}`, hash(site.seed, 21, x));
      if (f) footings.push(f);
    }
    if (footings.length) caps(m, WALK_WIDTH, [bent], top);
  }
  // The stone landing bears on the bank row by row: one footing for each run of rows bedded at the same course.
  for (let z = 0; z < length;) {
    const base = stone[z];
    let end = z + 1;
    while (end < length && stone[end] === base) end++;
    if (base !== null && base !== undefined) footings.push({ id: `landing-${z}`, box: { from: [0, m.y(base), z], to: [WALK_WIDTH, m.y(base) + 1, end] } });
    z = end;
  }

  // The gateway at the pier's foot: two posts, a beam with knee braces, and the name board hung under it.
  const gateZ = 2, gateTop = top(gateZ) + GATE_BEAM + 2;
  for (const x of [0, WALK_WIDTH - 2]) {
    m.b.add(x, m.y(top(gateZ) - PLANK), gateZ, x + 2, m.y(gateTop), gateZ + 2, w.plank);
    m.b.add(x, m.y(gateTop), gateZ, x + 2, m.y(gateTop + 1), gateZ + 2, w.end);
  }
  m.b.add(0, m.y(gateTop - 2), gateZ, WALK_WIDTH, m.y(gateTop), gateZ + 2, w.plank);
  for (const [x0, dir] of [[2, 1], [WALK_WIDTH - 3, -1]] as const) {
    for (let k = 0; k < 3; k++) m.b.add(x0 + dir * k, m.y(gateTop - 5 + k), gateZ, x0 + dir * k + 1, m.y(gateTop - 3 + k), gateZ + 2, w.plank);
  }
  const board = { x: [4, 16] as const, y: [top(gateZ) + HEADROOM + 1, top(gateZ) + HEADROOM + 4] as const };
  m.b.add(board.x[0] - 1, m.y(board.y[0] - 1), gateZ, board.x[1] + 1, m.y(board.y[1] + 1), gateZ + 1, w.end);
  m.b.add(board.x[0], m.y(board.y[0]), gateZ, board.x[1], m.y(board.y[1]), gateZ + 1, STYLES[style].wall);
  // Short hangers from the beam to the board.
  for (const x of [board.x[0] + 1, board.x[1] - 2]) m.b.add(x, m.y(board.y[1] + 1), gateZ, x + 1, m.y(gateTop - 2), gateZ + 1, MAT.darkStone);
  const text: TextPlane = {
    id: 'lake-name', centre: [(board.x[0] + board.x[1]) / 2, m.y((board.y[0] + board.y[1]) / 2), gateZ], facing: 'north',
    width: board.x[1] - board.x[0], height: board.y[1] - board.y[0],
  };

  kerb(m, style, length, top);
  const posts = [gateZ, bent, length - 6];
  rail(m, style, site, 0, length, posts, top);
  railToEdges(m, style, length, posts, top, { start: false, end: true });

  const { piece, bottom } = settleModule(`water-pier-root-${style}`, style, [WALK_WIDTH, length], m, {
    footings, walks: [walkStrip(m, 'root', length, tops)], seats: [], emitters: [],
    sounds: [{ id: 'creak-root', kind: 'creak', position: [WALK_WIDTH / 2, m.y(0), length - 4] }],
    texts: [text], mounts: [], clear: [],
  });
  return { id: piece.blueprint.id, role: 'root', piece, offset: [0, bottom, 0] };
}

function bayModule(style: StyleKey, site: PierSite, plan: ReturnType<typeof layout>, k: number): PierModule {
  const { start, length } = plan.bays[k]!, bent = plan.bents[k + 1]! - start;
  const tops = columnsOf(length).map(z => deckTop(site, z + start, plan.sagging, { step: 0, run: 0 }));
  const m = moduleBuilder();
  const top = (z: number) => tops[Math.max(0, Math.min(length - 1, z))]!;
  deck(m, style, site, { width: WALK_WIDTH, length, zOffset: start, xOffset: 0, tops, joists: [2, 9, 16] });
  const footings: Footing[] = [];
  for (const x of [0, WALK_WIDTH - PILE]) {
    const f = pile(m, site, [WALK_WIDTH, length], x, bent, x, bent + start, top(bent), `pile-${x ? 'east' : 'west'}`, hash(site.seed, 22, k, x));
    if (f) footings.push(f);
  }
  caps(m, WALK_WIDTH, [bent], top);
  kerb(m, style, length, top);
  // The bent's east pile carries on up through the deck as a rail post; two more posts stand on the planks.
  // The last bay ends its rail on a post where the head begins.
  const last = k === plan.bays.length - 1;
  const posts = [Math.max(0, bent - 11), bent, last ? length - 2 : Math.min(length - 2, bent + 11)];
  rail(m, style, site, start, length, posts, top);
  railToEdges(m, style, length, posts, top, { start: true, end: !last });
  const { piece, bottom } = settleModule(`water-pier-bay-${style}-${k}`, style, [WALK_WIDTH, length], m, {
    footings, walks: [walkStrip(m, `bay-${k}`, length, tops)], seats: [], emitters: [],
    sounds: [{ id: `creak-bay-${k}`, kind: 'creak', position: [WALK_WIDTH / 2, m.y(top(length / 2)), length / 2] }],
    texts: [], mounts: [], clear: [],
  });
  return { id: piece.blueprint.id, role: 'bay', piece, offset: [0, bottom, start] };
}

/** Head layout in head-local cells (x 0..64 is pier x −22..42; z 0..32 follows the walk's end). */
const HEAD = {
  width: HEAD_X[1] - HEAD_X[0],
  rows: [1, 15, 29],
  columns: [0, 20, 42, 62],
  joists: [2, 10, 18, 26, 34, 42, 50, 58],
  walkX: [WALK_ACROSS[0] - HEAD_X[0], WALK_ACROSS[1] - HEAD_X[0]] as const,
  missing: { x: [3, 14] as const, z: [4, 6] as const },
  pole: [58, 26] as const,
  bollards: { west: [1, 13] as const, east: [61, 13] as const },
  ladder: { x: 63, z: [4, 8] as const },
  seat: [4, 56] as const,
  end: [18, 30] as const,
  endAlong: [4, 52] as const,
};

function headModule(style: StyleKey, site: PierSite, plan: ReturnType<typeof layout>): PierModule {
  const start = plan.head, width = HEAD.width, length = HEAD_DEPTH, dx = HEAD_X[0];
  const tops = columnsOf(length).map(() => 0);
  const m = moduleBuilder(), w = wood(style);
  const top = () => 0;
  deck(m, style, site, { width, length, zOffset: start, xOffset: dx, tops, joists: HEAD.joists, missing: HEAD.missing, joints: [19, 41] });
  const footings: Footing[] = [];
  for (const r of HEAD.rows) for (const c of HEAD.columns) {
    const f = pile(m, site, [width, length], c, r, c + dx, r + start, 0, `pile-${c}-${r}`, hash(site.seed, 23, c, r));
    if (f) footings.push(f);
  }
  caps(m, width, HEAD.rows, top);
  // A fender along both wing ends and the far edge, where boats rub.
  for (const x of [0, width - 1]) m.b.add(x, m.y(-PLANK - JOIST), 0, x + 1, m.y(-PLANK), length, w.end);
  m.b.add(0, m.y(-PLANK - JOIST), length - 1, width, m.y(-PLANK), length, w.end);

  // The bell post: a pile carried up six metres with knee braces at its foot, a lantern on a bracket over the deck
  // and a bell under a little cap at the top, its rope down the post.
  const [px, pz] = HEAD.pole;
  const poleFooting = pile(m, site, [width, length], px, pz, px + dx, pz + start, 0, 'pile-pole', hash(site.seed, 24));
  if (poleFooting) footings.push(poleFooting);
  m.b.add(px, m.y(-UNDER), pz, px + PILE, m.y(POLE_HEIGHT), pz + PILE, MAT.bark);
  for (const [dxk, dzk] of [[-1, 0], [1, 0], [0, -1]] as const) for (let k = 0; k < 3; k++) {
    const x = dxk < 0 ? px - 1 - k : dxk > 0 ? px + PILE + k : px, z = dzk < 0 ? pz - 1 - k : pz;
    if (x >= 0 && x < width && z >= 0) m.b.add(x, m.y(2 - k), z, x + (dxk ? 1 : PILE), m.y(4 - k), z + (dzk ? 1 : PILE), w.plank);
  }
  // Lantern bracket toward the walk, at a little over head height, and the lantern hung from it.
  const arm = 26, lx = px - 7;
  m.b.add(lx, m.y(arm), pz, px, m.y(arm + 1), pz + PILE, w.plank);
  for (let k = 0; k < 3; k++) m.b.add(px - 1 - k, m.y(arm - 3 + k), pz, px - k, m.y(arm - 1 + k), pz + PILE, w.plank);
  const lantern = { x: [lx - 1, lx + 3] as const, z: [pz - 1, pz + 3] as const, y: [arm - 7, arm - 1] as const };
  m.b.add(lx + 1, m.y(arm - 1), pz, lx + 2, m.y(arm), pz + 1, MAT.darkStone);
  m.b.add(lantern.x[0], m.y(lantern.y[1] - 1), lantern.z[0], lantern.x[1], m.y(lantern.y[1]), lantern.z[1], MAT.brass);
  m.b.add(lantern.x[0] + 1, m.y(lantern.y[1]), lantern.z[0] + 1, lantern.x[1] - 1, m.y(lantern.y[1] + 1), lantern.z[1] - 1, MAT.brass);
  m.b.add(lantern.x[0], m.y(lantern.y[0] + 1), lantern.z[0], lantern.x[1], m.y(lantern.y[1] - 1), lantern.z[1], MAT.glass);
  for (const x of [lantern.x[0], lantern.x[1] - 1]) for (const z of [lantern.z[0], lantern.z[1] - 1]) {
    m.b.add(x, m.y(lantern.y[0] + 1), z, x + 1, m.y(lantern.y[1] - 1), z + 1, MAT.brass);
  }
  m.b.add(lantern.x[0], m.y(lantern.y[0]), lantern.z[0], lantern.x[1], m.y(lantern.y[0] + 1), lantern.z[1], MAT.brass);
  m.b.add(lx + 1, m.y(lantern.y[0] - 1), pz, lx + 2, m.y(lantern.y[0]), pz + 1, MAT.brass);
  const emitter: EmitterAnchor = { id: 'lantern-head', position: [lx + 1, m.y((lantern.y[0] + lantern.y[1]) / 2), pz + 1], reach: PIER.reach };
  // The bell: a crosstree near the top, the bell hung from it on the water side, its rope down to a cleat.
  const tree = POLE_HEIGHT - 6;
  m.b.add(px - 4, m.y(tree), pz, px + PILE + 1, m.y(tree + 1), pz + PILE, w.plank);
  m.b.add(px - 4, m.y(tree + 1), pz, px - 3, m.y(tree + 2), pz + PILE, w.end);
  const bell = [px - 4, tree - 4] as const;
  m.b.add(bell[0], m.y(tree - 1), pz, bell[0] + 2, m.y(tree), pz + PILE, MAT.brass);
  m.b.add(bell[0] - 1, m.y(bell[1]), pz - 1, bell[0] + 3, m.y(tree - 1), pz + PILE + 1, MAT.brass);
  m.b.add(bell[0], m.y(bell[1]), pz, bell[0] + 2, m.y(bell[1] + 2), pz + PILE, MAT.air);
  m.b.add(bell[0], m.y(bell[1] - 1), pz, bell[0] + 1, m.y(tree - 1), pz + 1, MAT.darkStone);
  m.b.add(px + PILE, m.y(4), pz, px + PILE + 1, m.y(tree), pz + 1, MAT.cream);
  m.b.add(px + PILE, m.y(3), pz, px + PILE + 2, m.y(4), pz + 1, MAT.darkStone);
  // A gilded finial caps the post, the one bright accent on the pier's silhouette.
  m.b.add(px, m.y(POLE_HEIGHT), pz, px + PILE, m.y(POLE_HEIGHT + 1), pz + PILE, w.end);
  m.b.add(px, m.y(POLE_HEIGHT + 1), pz, px + 1, m.y(POLE_HEIGHT + 3), pz + 1, MAT.goldLeaf);

  // Bollards at both wing ends (piles carried up through the deck), with mooring rings for the boats.
  const mounts: MountPoint[] = [];
  for (const [side, [bx, bz]] of Object.entries(HEAD.bollards) as [string, readonly [number, number]][]) {
    const f = pile(m, site, [width, length], bx, bz, bx + dx, bz + start, 0, `bollard-${side}`, hash(site.seed, 25, bx));
    if (f) footings.push(f);
    m.b.add(bx, m.y(-UNDER), bz, bx + PILE, m.y(4), bz + PILE, MAT.bark);
    m.b.add(bx, m.y(4), bz, bx + PILE, m.y(5), bz + PILE, w.end);
    const ring = side === 'west' ? bx - 1 : bx + PILE;
    m.b.add(Math.max(0, ring), m.y(2), bz, Math.max(0, ring) + 1, m.y(3), bz + PILE, MAT.brass);
    mounts.push({ id: `mooring-${side}`, position: [side === 'west' ? Math.max(0, ring) : ring + 1, m.y(2.5), bz + 1], axis: [0, 1, 0] });
  }
  // A swimming ladder down the east wing's face into the water.
  const { x: lxL, z: [lz0, lz1] } = HEAD.ladder;
  const ladderFoot = Math.max(Math.floor(-site.freeboard) - 4, -Math.floor(site.depth(lxL + dx + 0.5, (lz0 + lz1) / 2 + start)) + 1);
  for (const z of [lz0, lz1 - 1]) m.b.add(lxL, m.y(ladderFoot), z, lxL + 1, m.y(4), z + 1, w.plank);
  for (let y = ladderFoot + 1; y < -PLANK; y += 2) m.b.add(lxL, m.y(y), lz0 + 1, lxL + 1, m.y(y) + 1, lz1 - 1, w.end);
  // A coil of rope by the west bollard and a fisher's creel in the east wing: small stories, outside the walks.
  const coil = [4, 9] as const;
  m.b.add(coil[0], m.y(0), coil[1], coil[0] + 4, m.y(1), coil[1] + 4, MAT.cream);
  m.b.add(coil[0] + 1, m.y(0), coil[1] + 1, coil[0] + 3, m.y(1), coil[1] + 3, MAT.air);
  m.b.add(coil[0] + 1, m.y(1), coil[1], coil[0] + 4, m.y(2), coil[1] + 1, MAT.cream);
  const creel = [55, 8] as const;
  m.b.add(creel[0], m.y(0), creel[1], creel[0] + 4, m.y(3), creel[1] + 3, MAT.thatch);
  m.b.add(creel[0] + 1, m.y(2), creel[1] + 1, creel[0] + 3, m.y(3), creel[1] + 2, MAT.air);
  m.b.add(creel[0], m.y(3), creel[1] + 1, creel[0] + 4, m.y(4), creel[1] + 2, w.end);

  const seat: SeatEdge = { id: 'end', box: { from: [HEAD.seat[0], m.y(-PLANK), length - 2], to: [HEAD.seat[1], m.y(0), length] }, facing: 'south' };
  const walks: WalkStrip[] = [
    { id: 'head-in', axis: 'z', along: [0, length - 2], across: HEAD.walkX, tops: columnsOf(length - 2).map(() => m.y(0)) },
    { id: 'head-end', axis: 'x', along: HEAD.endAlong, across: HEAD.end, tops: columnsOf(HEAD.endAlong[1] - HEAD.endAlong[0]).map(() => m.y(0)) },
  ];
  const sounds: SoundAnchor[] = [
    { id: 'creak-head', kind: 'creak', position: [width / 2, m.y(0), length / 2] },
    { id: 'bell', kind: 'creak', position: [bell[0] + 1, m.y(bell[1] + 2), pz + 1] },
  ];
  const { piece, bottom } = settleModule(`water-pier-head-${style}`, style, [width, length], m, {
    footings, walks, seats: [seat], emitters: [emitter], sounds, texts: [], mounts, clear: [],
  });
  return { id: piece.blueprint.id, role: 'head', piece, offset: [dx, bottom, start] };
}

/** Builds every module of the pier on the caller's site. */
export function createPier(style: StyleKey, site: PierSite): Pier {
  checkStyle('pier', style);
  checkSite(site);
  const plan = layout(site);
  const modules = [rootModule(style, site, plan), ...plan.bays.map((_, k) => bayModule(style, site, plan, k)), headModule(style, site, plan)];
  const piles: Vec3[] = [];
  for (const module of modules) for (const f of module.piece.footings) {
    if (f.id.startsWith('landing')) continue;
    piles.push([module.offset[0] + (f.box.from[0] + f.box.to[0]) / 2, -site.freeboard, module.offset[2] + (f.box.from[2] + f.box.to[2]) / 2]);
  }
  return { modules, bents: plan.bents, piles };
}
