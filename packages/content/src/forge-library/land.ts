import type { StyleKey } from '../materials';
import { CARVE_PALETTES, Carving, LIBRARY_ENVELOPE, SUBJECT_ACCENTS, type Cell, type LibraryMotif } from './carve';

export type LandMotif = 'sleeping-cat' | 'rabbit' | 'frog' | 'bear' | 'stag' | 'hedgehog' | 'snail' | 'bee';

const [W, H, D] = LIBRARY_ENVELOPE;
type Rows = readonly string[];

/**
 * A dense carving grid. Art is drawn as front elevations: row 0 sits at `top`, column 0 at x 0, one character per
 * build cell (b body, s shade, l light, d dark, g gold, a the motif's accent, anything else is empty). A `dome`
 * swells a silhouette toward the viewer and away from it by its distance from the outline, so bodies read round
 * from three-quarters; `face` paints the nearest (and farthest) surface, for eyes, bellies and stripes.
 */
class Sculpt {
  private readonly cells = new Uint16Array(W * H * D);
  private readonly tone: Record<string, number>;
  constructor(readonly family: StyleKey, accent?: number) {
    const p = CARVE_PALETTES[family];
    this.tone = { b: p.body, s: p.shade, l: p.light, d: p.dark, g: p.gold, ...(accent === undefined ? {} : { a: accent }) };
  }
  private at(x: number, y: number, z: number) { return x + W * (y + H * z); }
  private each(art: Rows, top: number, visit: (x: number, y: number, material: number, c: string) => void) {
    art.forEach((row, i) => { for (let x = 0; x < row.length; x++) { const m = this.tone[row[x]!]; if (m !== undefined) visit(x, top - i, m, row[x]!); } });
  }
  set(x: number, y: number, z: number, m: number) {
    if (x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= D) throw new Error(`cell ${x},${y},${z} leaves the envelope`);
    this.cells[this.at(x, y, z)] = m;
  }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: string) {
    for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.set(x, y, z, this.tone[c]!);
    return this;
  }
  /** Every drawn cell, straight through z0..z1. */
  extrude(art: Rows, top: number, z0: number, z1: number) {
    this.each(art, top, (x, y, m) => { for (let z = z0; z < z1; z++) this.set(x, y, z, m); });
    return this;
  }
  /**
   * The silhouette swollen about the plane between z centre-1 and centre: an outline cell is `min` cells deep on
   * each side, each step inward adds `step`, up to `max`. A `flat` base sits on the ground at full depth.
   */
  dome(art: Rows, top: number, o: { centre?: number; min?: number; max?: number; step?: number; flat?: boolean } = {}) {
    const { centre = 9, min = 1, max = 4, step = 1, flat = true } = o;
    const inside = new Set<number>(), key = (x: number, y: number) => x + 64 * (y + 8);
    let bottom = H;
    this.each(art, top, (x, y) => { inside.add(key(x, y)); bottom = Math.min(bottom, y); });
    const distance = new Map<number, number>(), queue: [number, number][] = [];
    for (const k of inside) {
      const x = ((k % 64) + 64) % 64, y = Math.floor(k / 64) - 8;
      const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !inside.has(key(x + dx!, y + dy!)) && !(flat && y + dy! < bottom));
      if (open) { distance.set(k, 1); queue.push([x, y]); }
    }
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i]!, d = distance.get(key(x, y))!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = key(x + dx!, y + dy!);
        if (inside.has(k) && !distance.has(k)) { distance.set(k, d + 1); queue.push([x + dx!, y + dy!]); }
      }
    }
    this.each(art, top, (x, y, m) => {
      const half = Math.min(max, Math.floor(min + ((distance.get(key(x, y)) ?? 99) - 1) * step));
      for (let z = centre - half; z < centre + half; z++) this.set(x, y, z, m);
    });
    return this;
  }
  /** Paints the nearest solid cell of each drawn column; `both` also paints the far side. */
  face(art: Rows, top: number, both = true) {
    this.each(art, top, (x, y, m) => {
      for (let z = D - 1; z >= 0; z--) if (this.cells[this.at(x, y, z)]) { this.set(x, y, z, m); break; }
      if (both) for (let z = 0; z < D; z++) if (this.cells[this.at(x, y, z)]) { this.set(x, y, z, m); break; }
    });
    return this;
  }
  /** Raises drawn cells one step proud of the nearest surface (and the far one), e.g. a tail laid over a flank. */
  proud(art: Rows, top: number, both = true) {
    this.each(art, top, (x, y, m) => {
      for (let z = D - 1; z >= 0; z--) if (this.cells[this.at(x, y, z)]) { if (z + 1 < D) this.set(x, y, z + 1, m); break; }
      if (both) for (let z = 0; z < D; z++) if (this.cells[this.at(x, y, z)]) { if (z > 0) this.set(x, y, z - 1, m); break; }
    });
    return this;
  }
  /** Greedy boxes: runs along x, stacked along y, then identical rectangles merged along z. */
  carve(id: string, emitter: Cell): LibraryMotif {
    const out = new Carving(id);
    const open = new Map<string, [number, number, number, number, number, number]>();
    const flush = (keep: Map<string, unknown>) => { for (const [k, [x0, y0, x1, y1, m, z0]] of open) if (!keep.has(k)) { out.box(x0, y0, z0, x1, y1, zNow, m); open.delete(k); } };
    let zNow = 0;
    for (let z = 0; z <= D; z++) {
      zNow = z;
      const slice = new Map<string, [number, number, number, number, number]>();
      if (z < D) {
        const used = new Uint8Array(W * H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const m = this.cells[this.at(x, y, z)]!;
          if (!m || used[x + W * y]) continue;
          let x1 = x + 1;
          while (x1 < W && this.cells[this.at(x1, y, z)] === m && !used[x1 + W * y]) x1++;
          let y1 = y + 1;
          grow: while (y1 < H) { for (let X = x; X < x1; X++) if (this.cells[this.at(X, y1, z)] !== m || used[X + W * y1]) break grow; y1++; }
          for (let Y = y; Y < y1; Y++) for (let X = x; X < x1; X++) used[X + W * Y] = 1;
          slice.set(`${x},${y},${x1},${y1},${m}`, [x, y, x1, y1, m]);
        }
      }
      flush(slice);
      for (const [k, r] of slice) if (!open.has(k)) open.set(k, [...r, z]);
    }
    return out.done(emitter);
  }
}

/** Mirrors a row about the envelope's centre line, for symmetric front-facing subjects. */
const sym = (half: string) => half.padEnd(12, '.').slice(0, 12) + [...half.padEnd(12, '.').slice(0, 12)].reverse().join('');
const plinth = (s: Sculpt) => s.box(10, 0, 7, 15, 1, 12, 's');

function sleepingCat(family: StyleKey): LibraryMotif {
  // A loaf-curled cat dozing with its face turned to the street: two tall pointed ears, closed eyes, a long tail
  // wrapped around the front of its body with the tip under its chin.
  const s = new Sculpt(family);
  plinth(s);
  s.dome([
    '......bbbbbbbbbbbbb.....', // y7
    '.....bbbbbbbbbbbbbbbb...',
    '.....bbbbbbbbbbbbbbbbb..',
    '.....bbbbbbbbbbbbbbbbbb.',
    '.....bbbbbbbbbbbbbbbbbb.',
    '.....bbbbbbbbbbbbbbbbbb.',
    '.....bbbbbbbbbbbbbbbbbb.',
    '......ssssssssssssssss..', // y0
  ], 7, { max: 4, min: 2 });
  s.dome([
    '.b.......b.', // y13
    '.bb.....bb.',
    '.bdb...bdb.',
    'bbbbbbbbbbb',
    'bbbbbbbbbbb',
    'bbbbbbbbbbb',
    'bbbbbbbbbbb',
    'bbbbbbbbbbb',
    'bbbbbbbbbbb',
    '.bbbbbbbbb.',
    '..bbbbbbb..', // y3
  ], 13, { centre: 10, min: 2, max: 4, flat: false });
  s.face([
    '.d.d...d.d.', // y7
    '..d.....d..',
    '....ldl....',
    '....lll....', // y4
  ], 7, false);
  // The tail band, lying proud of the flank along the ground, tip curled up under the chin.
  s.box(19, 1, 9, 23, 4, 15, 's');
  s.extrude(['.ll...................ss', '.lllbbssbbssbbssbbssbbs.', '..llbbssbbssbbssbbssbbs.'], 3, 13, 15);
  if (family === 'hearth') s.box(5, 3, 14, 7, 4, 15, 'g');
  else if (family === 'tide') s.face(['............s..s..s.....', '...........s..s..s......', '...........s..s..s......'], 7);
  else s.face(['..l.....l..'], 11, false);
  return s.carve('sleeping-cat', [5, 6, 15]);
}

function rabbit(family: StyleKey): LibraryMotif {
  // A rabbit sits up in profile, nose to the left: two very long upright ears, a round haunch and a round pale tail.
  const s = new Sculpt(family);
  plinth(s);
  s.dome([
    '...........bbbb.........', // y7
    '.........bbbbbbbb.......',
    '........bbbbbbbbbbb.....',
    '.......bbbbbbbbbbbbb....',
    '......bbbbbbbbbbbbbbb...',
    '......bbbbbbbbbbbbbbb...',
    '......bbbbbbbbbbbbbbb...',
    '....bbbb.bbbbbbbbbbbbb..', // y0
  ], 7, { max: 4, min: 2 });
  s.dome([
    '...bbbbb..', // y8
    '..bbbbbbb.',
    '.bbbbbbbbb',
    '.bbbbbbbbb',
    '..bbbbbbbb',
    '....bbbbb.', // y3
  ], 8, { min: 2, max: 3, flat: false });
  // Near ear upright in front, far ear behind and leaning back: both tall, narrow and rounded at the tip.
  s.extrude(['....bb.', '...bbb.', '...blb.', '...blb.', '...blb.', '...bbb.', '....bb.'], 15, 9, 11);
  s.extrude(['........bb', '.......bbb', '.......bbb', '......bbb.', '......bbb.', '.....bbb..', '.....bb...'], 15, 7, 9);
  s.face(['....dd', '', 'd'], 6);
  s.face(['.l', 'll'], 5, false);
  s.box(20, 2, 7, 22, 6, 12, 'l').box(22, 3, 8, 23, 5, 11, 'l');
  if (family === 'tide') s.face(['.......l', '......ll', '......ll'], 3);
  if (family === 'grove') s.face(['....g'], 8);
  return s.carve('rabbit', [1, 5, 13]);
}

function frog(family: StyleKey): LibraryMotif {
  // A squat frog faces the street: a wide flat body, two big eye bumps on top, a wide smiling mouth, splayed feet.
  const s = new Sculpt(family);
  plinth(s);
  s.dome([
    sym('....bbbb'), // y12
    sym('...bbbbbb'),
    sym('...bbbbbb'),
    sym('..bbbbbbbbbb'),
    sym('..bbbbbbbbbb'),
    sym('..bbbbbbbbbb'),
    sym('..bbbbbbbbbb'),
    sym('..bbbbbbbbbb'),
    sym('...bbbbbbbbb'),
    sym('.bbbbbbbbbbb'),
    sym('bbbbbbbbbbbb'),
    sym('bbbb.bbbbbbb'), // y1
  ], 12, { max: 6, min: 2 });
  s.face([sym('....ll'), sym('...lldd'), sym('...lldd'), sym('....ll')], 12, false);
  s.face([sym('..d'), sym('...ddddddddd'), sym(''), sym('....llllllll'), sym('.....lllllll')], 6, false);
  s.extrude([sym('..ss'), sym('.sss'), sym('ssss')], 2, 11, 15).extrude([sym('l.l')], 0, 14, 15); // splayed front feet
  if (family === 'tide') s.face([sym('......s'), sym('.....s..s')], 9, false);
  if (family === 'grove') s.face([sym('...........g')], 12);
  return s.carve('frog', [12, 4, 16]);
}

function bear(family: StyleKey): LibraryMotif {
  // A round bear sits facing the street: round ears, a pale muzzle with a dark nose, a pale belly, feet forward.
  const s = new Sculpt(family);
  plinth(s);
  s.dome([
    sym('.......bbbbb'), // y9
    sym('......bbbbbb'),
    sym('.....bbbbbbb'),
    sym('....bbbbbbbb'),
    sym('...bbbbbbbbb'),
    sym('...bbbbbbbbb'),
    sym('...bbbbbbbbb'),
    sym('....bbbbbbbb'),
    sym('.....bbbbbbb'),
    sym('......ssssss'), // y0
  ], 9, { max: 4, min: 2 });
  s.dome([
    sym('....bbb'), // y15
    sym('...bbbbb'),
    sym('...bbbbbbbbb'),
    sym('....bbbbbbbb'),
    sym('....bbbbbbbb'),
    sym('....bbbbbbbb'),
    sym('.....bbbbbbb'),
    sym('......bbbbbb'), // y8
  ], 15, { centre: 10, min: 2, max: 4, flat: false });
  s.face([sym('....dd')], 14, false);
  s.face([sym('........d')], 11, false);
  s.extrude([sym('.........lll'), sym('.........lll'), sym('..........ll')], 10, 14, 16);
  s.face([sym('..........d'), sym('...........d')], 10, false);
  s.face([sym('..........ll'), sym('.........lll'), sym('.........lll'), sym('..........ll')], 6, false);
  s.extrude([sym('......bbb'), sym('......bbb'), sym('......lll')], 2, 12, 16); // feet
  s.extrude([sym('.....bb'), sym('.....bbb'), sym('.....bbb'), sym('......bb')], 7, 11, 15); // forepaws
  if (family === 'hearth') s.face([sym('.........ggg')], 8, false);
  if (family === 'grove') s.face([sym('.....g')], 13, false);
  return s.carve('bear', [12, 9, 16]);
}

function stag(family: StyleKey): LibraryMotif {
  // A stag lies at rest in profile with its head turned to the street, crowned by wide branching antlers.
  const s = new Sculpt(family);
  plinth(s);
  s.dome([
    '...........bbbbbbbb.....', // y6
    '.........bbbbbbbbbbbb...',
    '........bbbbbbbbbbbbbb..',
    '.......bbbbbbbbbbbbbbbb.',
    '.......bbbbbbbbbbbbbbbb.',
    '.......bbbbbbbbbbbbbbbb.',
    '...dbbbbbbbbbbbbbbbbbbb.', // y0
  ], 6, { max: 4, min: 2 });
  s.dome(['......bbbb', '......bbbbb', '.....bbbbbb', '.....bbbbb', '......bbbb'], 8, { min: 2, max: 3, flat: false }); // neck
  s.dome([
    '..bbbbbbbbbb..', // y10
    '...bbbbbbbb...',
    '.....bbbbb....',
    '.....bbbbbb...',
    '......bbbb....',
    '......bbbb....',
    '.......ll.....', // y4
  ], 10, { centre: 10, min: 2, max: 3, flat: false });
  s.face(['.....d..d.....'], 8, false);
  s.face(['......dll.....', '.......d......'], 5, false);
  s.extrude([
    'l...l.....l...l', // y15
    'l...l.....l...l',
    'll.ll.....ll.ll',
    '.lll.l...l.lll.',
    '..lllll.lllll..',
    '.....ll.ll.....', // y10
  ], 15, 9, 11);
  s.box(21, 4, 8, 23, 6, 10, 'l');
  if (family === 'grove') s.face(['.......g', '......g'], 15);
  return s.carve('stag', [7, 6, 14]);
}

function hedgehog(family: StyleKey): LibraryMotif {
  // A hedgehog trundles left: a high back of spines raked toward its tail and a small pale pointed snout.
  const s = new Sculpt(family);
  plinth(s);
  s.dome([
    '..........b...b...b.....', // y11
    '.......b..bb..bb..bb....',
    '......bb.bbb.bbb.bbbb.b.',
    '.....bbbbbbbbbbbbbbbbbb.',
    '....bbbbbbbbbbbbbbbbbbbb',
    '...bbbbbbbbbbbbbbbbbbbbb',
    '...bbbbbbbbbbbbbbbbbbbb.',
    '....bbbbbbbbbbbbbbbbbbb.',
    '....bbbbbbbbbbbbbbbbbbb.',
    '.....bbbbbbbbbbbbbbbbb..',
    '......sssssssssssssss...', // y1
  ], 11, { max: 4, min: 2 });
  s.dome(['....llll', '..llllll', 'llllllll', '.lllllll', '...lllll'], 6, { min: 1, max: 3, flat: false });
  s.face(['d', ''], 4);
  s.face(['.....d'], 5);
  s.face([
    '..........d...d...d.....', // y10
    '.........d...d...d...d..',
    '........d...d...d...d...',
    '.......d...d...d...d....',
    '..........d...d...d...d.',
    '.........d...d...d...d..',
    '........d...d...d...d...', // y4
  ], 10);
  s.extrude(['.....ss.........ss......', '.....ss.........ss......'], 1, 7, 11);
  if (family === 'grove') s.box(20, 9, 8, 21, 10, 10, 'g');
  return s.carve('hedgehog', [0, 4, 11]);
}

function snail(family: StyleKey): LibraryMotif {
  // A snail glides left: a big spiral shell on a soft pale body, its head raised on two eye stalks.
  const s = new Sculpt(family);
  plinth(s);
  // The shell: a round disc with an Archimedean groove spiralling in on both faces.
  const shell: string[] = [], groove: string[] = [];
  const cx = 13.5, cy = 9, r0 = 6.6;
  for (let y = 15; y >= 3; y--) {
    let row = '', g = '';
    for (let x = 0; x < W; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy);
      const t = r / 2.6 - (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI);
      row += r <= r0 ? 'b' : '.';
      g += r <= r0 - 0.6 && r > 0.8 && t - Math.floor(t) < 0.36 ? 'd' : '.';
    }
    shell.push(row); groove.push(g);
  }
  s.dome([
    '..lll...................', // y4
    '.llll...................',
    'llllllllllllllllllllll..',
    'lllllllllllllllllllllll.',
    '.lllllllllllllllllllllll', // y0
  ], 4, { max: 3, min: 2 });
  s.dome(shell, 15, { min: 2, max: 4, step: 1, flat: false });
  s.face(groove, 15);
  s.extrude(['dd..dd', '.l...l', '.l..ll', '.ll.l.', '..lll.'], 9, 8, 10);
  s.face(['', '..d'], 4);
  if (family === 'hearth') s.face(['gg'], 9);
  return s.carve('snail', [1, 3, 12]);
}

function bee(family: StyleKey): LibraryMotif {
  // A bumblebee hovers in profile, head to the left: a round body in bold bands, two raised wings, a sharp sting.
  // Yellow bands are gold leaf in every family; Grove's light is honey-thatch, so its wings take cream instead.
  const s = new Sculpt(family, family === 'grove' ? SUBJECT_ACCENTS.cream : SUBJECT_ACCENTS.goldLeaf);
  const band = family === 'grove' ? 'g' : 'a', wing = family === 'grove' ? 'a' : 'l';
  plinth(s);
  s.dome([
    '.........yddyyddyyd.....', // y10
    '.......yyyddyyddyydd....',
    '......yyyyddyyddyyddd...',
    '......yyyyddyyddyydddd..',
    '......yyyyddyyddyydddddd',
    '......yyyyddyyddyydddd..',
    '.......yyyddyyddyyddd...',
    '........yyddyyddyyd.....', // y3
  ].map(r => r.replaceAll('y', band)), 10, { max: 4, min: 2 });
  s.dome(['...dddd', '..dddddd', '.ddddddd', '.ddddddd', '..dddddd', '...dddd'], 9, { min: 2, max: 3, flat: false });
  s.extrude(['........ww......', '.......wwww.....', '......wwwwww....', '......wwwww.....', '.......www......'].map(r => r.replaceAll('w', wing)), 15, 9, 10);
  s.extrude(['.............ww.', '............wwww', '...........wwwww', '............www.'].map(r => r.replaceAll('w', wing)), 14, 8, 9);
  s.extrude(['dd..', '.d..', '.dd.', '..d.'], 12, 9, 10);
  s.face(['', '..ll'], 8);
  s.extrude(['.........d..d..d', '.........d..d..d'], 2, 9, 10);
  s.box(9, 1, 7, 17, 2, 12, 's');
  return s.carve('bee', [3, 7, 13]);
}

export const MOTIFS: Record<LandMotif, (family: StyleKey) => LibraryMotif> = {
  'sleeping-cat': sleepingCat, rabbit, frog, bear, stag, hedgehog, snail, bee,
};
