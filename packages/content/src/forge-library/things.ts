import type { StyleKey } from '../materials';
import { CARVE_PALETTES, Carving, LIBRARY_ENVELOPE, SUBJECT_ACCENTS, type Cell, type LibraryMotif } from './carve';

export type ThingMotif = 'heart' | 'crown' | 'key' | 'anchor' | 'sailing-ship' | 'teacup' | 'book' | 'candle';

const [W, H, D] = LIBRARY_ENVELOPE;
type Rows = readonly string[];

/** A row drawn from x 0 to the centre line, completed by its mirror (x ↔ 23 - x). */
const sym = (half: string): string => half + [...half].reverse().join('');

/**
 * A dense carving grid, later packed into Carving boxes. Art is drawn as front elevations: row 0 sits at `top`,
 * column 0 at x 0, one character per build cell (b body, s shade, l light, d dark, g gold, a the motif's accent;
 * anything else is empty).
 */
class Grid {
  private readonly cells = new Uint16Array(W * H * D);
  readonly tone: Record<string, number>;
  constructor(readonly family: StyleKey, accent?: number) {
    const p = CARVE_PALETTES[family];
    this.tone = { b: p.body, s: p.shade, l: p.light, d: p.dark, g: p.gold, ...(accent === undefined ? {} : { a: accent }) };
  }
  private at(x: number, y: number, z: number) { return x + W * (y + H * z); }
  get(x: number, y: number, z: number) { return x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= D ? 0 : this.cells[this.at(x, y, z)]!; }
  set(x: number, y: number, z: number, c: string) {
    if (x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= D) throw new Error(`cell ${x},${y},${z} leaves the envelope`);
    const m = this.tone[c];
    if (m === undefined) throw new Error(`no tone ${c}`);
    this.cells[this.at(x, y, z)] = m;
  }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: string) {
    for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.set(x, y, z, c);
    return this;
  }
  private each(art: Rows, top: number, visit: (x: number, y: number, c: string) => void, x0 = 0) {
    art.forEach((row, i) => { for (let x = 0; x < row.length; x++) if (this.tone[row[x]!] !== undefined) visit(x0 + x, top - i, row[x]!); });
  }
  /** Every drawn cell, straight through z0..z1. */
  extrude(art: Rows, top: number, z0: number, z1: number, x0 = 0) {
    this.each(art, top, (x, y, c) => { for (let z = z0; z < z1; z++) this.set(x, y, z, c); }, x0);
    return this;
  }
  /** Paints the nearest solid cell of each drawn column from the front (+Z). */
  face(art: Rows, top: number, x0 = 0) {
    this.each(art, top, (x, y, c) => { for (let z = D - 1; z >= 0; z--) if (this.get(x, y, z)) { this.set(x, y, z, c); break; } }, x0);
    return this;
  }
  /** Raises drawn cells one step proud of the front surface. */
  proud(art: Rows, top: number, x0 = 0) {
    this.each(art, top, (x, y, c) => { for (let z = D - 1; z >= 0; z--) if (this.get(x, y, z)) { this.set(x, y, z + 1, c); break; } }, x0);
    return this;
  }
  /** A horizontal disc (or ring, with `inner`) about (cx, cz) through y0..y1; `squash` flattens it front to back. */
  disc(cx: number, cz: number, r: number, y0: number, y1: number, c: string, inner = 0, squash = 1) {
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      const d = Math.hypot(x + 0.5 - cx, (z + 0.5 - cz) / squash);
      if (d <= r && d > inner) for (let y = y0; y < y1; y++) this.set(x, y, z, c);
    }
    return this;
  }
  /** Packs the grid into boxes: x runs, merged up through y, then through z. */
  carve(id: string, emitter: Cell): LibraryMotif {
    type Rect = { x0: number; x1: number; y0: number; y1: number; m: number; z0: number; z1: number };
    const done: Rect[] = [];
    let open: Rect[] = [];
    for (let z = 0; z < D; z++) {
      const slice: Rect[] = [];
      let rising: Rect[] = [];
      for (let y = 0; y < H; y++) {
        const next: Rect[] = [];
        for (let x = 0; x < W;) {
          const m = this.get(x, y, z);
          let e = x + 1;
          while (e < W && this.get(e, y, z) === m) e++;
          if (m) {
            const prev = rising.find(r => r.x0 === x && r.x1 === e && r.m === m && r.y1 === y);
            if (prev) { prev.y1 = y + 1; next.push(prev); } else { const r = { x0: x, x1: e, y0: y, y1: y + 1, m, z0: z, z1: z + 1 }; slice.push(r); next.push(r); }
          }
          x = e;
        }
        rising = next;
      }
      const carried: Rect[] = [];
      for (const r of slice) {
        const prev = open.find(o => o.z1 === z && o.x0 === r.x0 && o.x1 === r.x1 && o.y0 === r.y0 && o.y1 === r.y1 && o.m === r.m);
        if (prev) { prev.z1 = z + 1; carried.push(prev); } else { done.push(r); carried.push(r); }
      }
      open = carried;
    }
    const c = new Carving(id);
    for (const r of done) c.box(r.x0, r.y0, r.z0, r.x1, r.y1, r.z1, r.m);
    return c.done(emitter);
  }
}

/** The shared foot: a low plinth through the mount, a little different in each family. */
function foot(g: Grid) {
  g.box(9, 0, 7, 15, 1, 12, 's');
  if (g.family === 'tide') g.box(9, 0, 12, 15, 1, 13, 'l');
  if (g.family === 'grove') { g.box(8, 0, 8, 9, 1, 11, 'd'); g.box(15, 0, 8, 16, 1, 11, 'd'); }
}

/** Drops cells that do not have all four in-plane neighbours: a one-cell bevel of an elevation. */
function inset(art: Rows, times = 1): string[] {
  let rows = art.map(r => r.padEnd(W, '.'));
  for (let t = 0; t < times; t++) {
    const filled = (x: number, y: number) => y >= 0 && y < rows.length && x >= 0 && x < W && rows[y]![x] !== '.';
    rows = rows.map((row, y) => [...row].map((c, x) => c !== '.' && filled(x - 1, y) && filled(x + 1, y) && filled(x, y - 1) && filled(x, y + 1) ? c : '.').join(''));
  }
  return rows;
}

// A plump two-lobed heart, domed front and back, with a bright gloss curving round the left lobe.
function heart(family: StyleKey): LibraryMotif {
  const g = new Grid(family, SUBJECT_ACCENTS.petal);
  foot(g);
  const shape = [
    '.....bbbb...', // y15
    '...bbbbbbb..',
    '..bbbbbbbbb.',
    '.bbbbbbbbbbb',
    '.bbbbbbbbbbb',
    '.bbbbbbbbbbb',
    '..bbbbbbbbbb',
    '..bbbbbbbbbb',
    '...bbbbbbbbb',
    '....bbbbbbbb',
    '.....bbbbbbb',
    '......bbbbbb',
    '........bbbb',
    '.........bbb',
    '..........bb', // y1
  ].map(sym);
  g.extrude(shape, 15, 7, 11);
  g.extrude(inset(shape), 15, 6, 7).extrude(inset(shape), 15, 11, 12);
  g.extrude(inset(shape, 3), 15, 12, 13);
  // The gloss: a curved highlight high on the left lobe (rose-pink on Hearth's terracotta) and a bright speck.
  const gloss = family === 'hearth' ? 'a' : 'l';
  g.proud(['.....' + gloss.repeat(3), '....' + gloss, '....' + gloss], 13, 0).proud(['l'], 13, 9);
  return g.carve('heart', [12, 8, 14]);
}

/** Paints a front elevation onto an upright oval wall about (cx, cz): a crown's band seen all the way round. */
function wrap(g: Grid, art: Rows, top: number, cx: number, cz: number, rx: number, rz: number, wall: number) {
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const out = Math.hypot((x + 0.5 - cx) / rx, (z + 0.5 - cz) / rz), inn = Math.hypot((x + 0.5 - cx) / (rx - wall), (z + 0.5 - cz) / (rz - wall));
    if (out > 1 || inn <= 1) continue;
    art.forEach((row, i) => { const c = row[x]; if (c && g.tone[c] !== undefined) g.set(x, top - i, z, c); });
  }
}

// A royal crown: a band set with gems (the kingdom's own colour) all the way round, five pearl-tipped points and a velvet cap.
function crown(family: StyleKey): LibraryMotif {
  const g = new Grid(family, SUBJECT_ACCENTS.cream);
  foot(g);
  g.box(8, 1, 6, 16, 3, 13, 's');
  // The velvet cap swells up between the points.
  [[8.6, 3, 9], [7.5, 9, 10], [6, 10, 11], [4, 11, 12], [2.2, 12, 13]].forEach(([r, y0, y1]) => g.disc(12, 9.5, r!, y0!, y1!, 'b', 0, 0.45));
  const band = [
    '...........a', // y15 centre pearl
    '......aa...a',
    '..aa..aa...g',
    '..aa..gg...g',
    '..gg..gg..gg', // y11
    '..gg.gggg.gg',
    '..gggggggggg', // y9
    '..gggggggggg',
    '..gggggggggg',
    '..gbbggbbggb', // y6 gems
    '..gbbggbbggb',
    '..gggggggggg',
    '..gggggggggg', // y3
  ].map(sym);
  wrap(g, band, 15, 12, 9.5, 10, 5, 1.6);
  // Raised rims above and below the gems, and the gems themselves standing proud.
  g.proud([sym('..gggggggggg')], 7).proud([sym('..gggggggggg')], 3);
  g.proud([sym('...bb..bb..b'), sym('...bb..bb..b')], 6);
  return g.carve('crown', [12, 9, 16]);
}

// An old ornate key in profile: a big ringed bow with three knobs, a collar, a long shaft and a toothed bit.
function key(family: StyleKey): LibraryMotif {
  const g = new Grid(family);
  foot(g);
  g.box(11, 1, 8, 13, 8, 11, 'd');
  const knob = family === 'hearth' ? 'l' : family === 'tide' ? 'b' : 'g';
  const shape = [
    '....kk..................', // y15
    '...gggg.................',
    '..gggggg................',
    '.gg....gg...............',
    '.gg....gg..gg...........', // y11
    'kgg....ggggggggggggggggg',
    'kgg....ggggggggggggggggg',
    '.gg....gg..gg.....gggggg',
    '.gg....gg.........gggggg', // y7
    '..gggggg..........gg.g.g',
    '...gggg...........gg.g..',
    '....kk..................', // y4
  ].map(r => r.replaceAll('k', knob));
  g.extrude(shape, 15, 8, 11);
  // The bow's ring and the collar stand proud; a bright line runs along the top of the shaft.
  g.proud(['..gggg', '.g....g', 'g......g', 'g......g', 'g......g', 'g......g', 'g......g', 'g......g', '.g....g', '..gggg'], 14, 1);
  g.proud(['gg', 'gg', 'gg', 'gg'], 11, 11);
  g.face(['..lllllll.lllll'], 10, 9);
  return g.carve('key', [4, 9, 12]);
}

// A ship's anchor: a ring on top, a wooden stock, the shank and two curved arms ending in barbed flukes.
function anchor(family: StyleKey): LibraryMotif {
  const g = new Grid(family);
  foot(g);
  const shape = [
    '.........ggg', // y15 ring
    '........gg..',
    '........gg..',
    '.........ggg', // y12
    '.ggddddddddd', // y11 stock
    '.ggddddddddd',
    '..........gg', // y9 shank
    '..g.......gg', // y8 fluke tips
    '.ggg......gg',
    'ggggg.....gg', // y6 fluke barbs
    '..gg......gg', // y5 arms
    '..ggg.....gg',
    '...ggg...ggg', // y3
    '....gggggggg',
    '......gggggg', // y1 crown
  ].map(sym);
  g.extrude(shape, 15, 8, 11);
  g.extrude([sym('...ddddddddd'), sym('...ddddddddd')], 11, 7, 12);
  g.proud(inset(shape), 15);
  g.proud([sym('.gg'), sym('.gg')], 11);
  // Each fluke is a raised arrowhead.
  g.proud([sym('..g'), sym('.ggg')], 8);
  if (family === 'tide') g.face([sym('.....l....l.')], 11);
  if (family === 'grove') g.face([sym('.....g....g.')], 11);
  return g.carve('anchor', [12, 6, 13]);
}

// A two-masted sailing ship in profile: a high stern, a rising bow with a bowsprit, stacked billowing sails, a jib and a pennant.
function sailingShip(family: StyleKey): LibraryMotif {
  const g = new Grid(family, SUBJECT_ACCENTS.cream);
  foot(g);
  const hull = [
    'bbbbb..............bbb..', // y6 stern castle and rising bow
    'bbbbbbbbbbbbbbbbbbbbbb..', // y5
    '.bbbbbbbbbbbbbbbbbbbbb..',
    '.bbbbbbbbbbbbbbbbbbbb...', // y3
    '..sssssssssssssssssss...',
    '....ssssssssssssss......', // y1
  ];
  // The hull is widest amidships and narrows to the bow and down to the keel.
  hull.forEach((row, i) => {
    const y = 6 - i;
    for (let x = 0; x < W; x++) {
      const c = row[x]!;
      if (c === '.') continue;
      const half = Math.max(1, (x >= 18 ? 22 - x : x <= 1 ? 3 : 4) - Math.max(0, 3 - y));
      for (let z = 9 - half; z < 9 + half; z++) g.set(x, y, z, c);
    }
  });
  // A dark rail round the deck, portholes along the side, a stern lantern.
  for (let x = 0; x < 22; x++) for (let z = 0; z < D; z++) {
    const top = g.get(x, 6, z) ? 6 : 5;
    if (g.get(x, top, z) && (!g.get(x, top, z - 1) || !g.get(x, top, z + 1))) g.set(x, top, z, 'd');
  }
  g.face(['.....g...g...g...g'], 3);
  g.box(0, 7, 9, 1, 8, 10, 'g');
  // Masts, yards, the bowsprit and the forestay.
  g.box(6, 6, 8, 7, 16, 10, 'd').box(16, 6, 8, 17, 15, 10, 'd');
  g.box(1, 10, 8, 12, 11, 11, 'd').box(2, 13, 8, 11, 14, 11, 'd');
  g.box(13, 11, 8, 20, 12, 11, 'd').box(14, 13, 8, 19, 14, 11, 'd');
  g.box(22, 6, 8, 23, 7, 10, 'd').box(22, 7, 8, 24, 8, 10, 'd').box(19, 12, 9, 22, 13, 10, 'd');
  const sail = (x0: number, x1: number, y0: number, y1: number) => {
    g.box(x0, y0, 10, x1, y1, 11, 'a');
    if (y1 - y0 > 2) g.box(x0 + 1, y0 + 1, 11, x1 - 1, y1 - 1, 12, 'a'); else g.box(x0 + 1, y0, 11, x1 - 1, y1, 12, 'a');
  };
  sail(1, 12, 7, 10); sail(2, 11, 11, 13); sail(13, 20, 7, 11); sail(14, 19, 12, 13);
  g.extrude(['a', 'aa', 'aaa', 'aaa'], 11, 9, 10, 21);
  const flag = family === 'tide' ? 'g' : 'b';
  g.extrude([flag.repeat(4), flag.repeat(2)], 15, 8, 10, 7);
  return g.carve('sailing-ship', [12, 9, 14]);
}

// A teacup on its saucer: gilt rim, a dark pool of tea, a loop handle and a curl of steam.
function teacup(family: StyleKey): LibraryMotif {
  const g = new Grid(family, SUBJECT_ACCENTS.cream);
  foot(g);
  g.disc(12, 9, 5, 1, 2, 's').disc(12, 9, 8.6, 2, 3, 'b').disc(12, 9, 8.6, 3, 4, 'l', 7.4);
  g.disc(12, 9, 4.6, 3, 4, 'b').disc(12, 9, 5.6, 4, 5, 'b').disc(12, 9, 6.2, 5, 10, 'b');
  g.disc(12, 9, 6.2, 7, 8, family === 'grove' ? 'g' : 'l');
  g.disc(12, 9, 5.2, 9, 10, 'd').disc(12, 9, 6.2, 10, 11, 'g', 5.2);
  g.extrude(['bbbb', '...bb', '....b', '...bb', 'bbbb'], 9, 8, 10, 17);
  g.extrude(['..aa', '.aa', 'aa', '.aa', '..aa', '.aa'], 15, 8, 10, 10);
  return g.carve('teacup', [12, 7, 16]);
}

// An open book standing on a little lectern: two fanned page blocks, lined pages, a crease and a ribbon bookmark.
function book(family: StyleKey): LibraryMotif {
  const g = new Grid(family, SUBJECT_ACCENTS.cream);
  foot(g);
  g.box(9, 1, 7, 15, 3, 10, 's');
  const cover = [
    'bbbbbbbbb...', // y13
    'bbbbbbbbbbb.',
    'bbbbbbbbbbbb', 'bbbbbbbbbbbb', 'bbbbbbbbbbbb', 'bbbbbbbbbbbb', 'bbbbbbbbbbbb', 'bbbbbbbbbbbb', 'bbbbbbbbbbbb',
    'bbbbbbbbbbbb', // y4
    'bbbbbbbbbbbb',
    '..bbbbbbbbbb', // y2
  ].map(sym);
  const pages = [
    '..aaaaa.....', // y14
    '.aaaaaaaaa..',
    '.aaaaaaaaaa.',
    '.aaaaaaaaaaa', '.aaaaaaaaaaa', '.aaaaaaaaaaa', '.aaaaaaaaaaa', '.aaaaaaaaaaa', '.aaaaaaaaaaa', '.aaaaaaaaaaa',
    '..aaaaaaaaaa', // y4
    '.....aaaaaaa', // y3
  ].map(sym);
  g.extrude(cover, 13, 7, 9);
  g.extrude(pages, 14, 9, 11);
  // The outer halves of each page block stand thicker, falling into the crease.
  g.extrude(pages.map(r => r.slice(0, 9).padEnd(15, '.') + r.slice(15)), 14, 11, 12);
  g.box(11, 3, 9, 13, 12, 11, 'd');
  g.face([
    '...ddddd.........dddddd.',
    '........................',
    '...dddddd.......dddddd..',
    '........................',
    '...ddddddd.......ddddd..',
    '........................',
    '...dddd........dddddd...',
  ], 11);
  // The ribbon bookmark falls out of the crease and hangs below with a forked tail.
  g.extrude(['gg', 'gg', 'ggg', 'g.g'], 4, 11, 12, 12);
  if (family === 'tide') g.face([sym('l...........')], 13);
  if (family === 'grove') g.face([sym('gg..........')], 3);
  return g.carve('book', [12, 9, 13]);
}

// A pillar candle with pale running drips, standing in a chamberstick with a finger ring, crowned by a tall flame.
function candle(family: StyleKey): LibraryMotif {
  const g = new Grid(family, SUBJECT_ACCENTS.cream);
  foot(g);
  const metal = family === 'grove' ? 'd' : 'g';
  g.disc(12, 9, 6.8, 1, 2, metal).disc(12, 9, 6.8, 2, 3, metal, 5.6).disc(12, 9, 4.2, 2, 3, metal);
  g.extrude([metal.repeat(4), metal + '..' + metal, metal + '..' + metal, metal.repeat(4)], 5, 8, 10, 18);
  g.disc(12, 9, 3.3, 3, 9, 'b').disc(12, 9, 3.7, 8, 9, 'l');
  // Drips run down the front and the sides, each a different length.
  g.box(10, 5, 12, 11, 8, 13, 'l').box(13, 3, 12, 14, 8, 13, 'l').box(11, 6, 12, 12, 8, 13, 'l');
  g.box(15, 4, 9, 16, 8, 10, 'l').box(8, 6, 7, 9, 8, 8, 'l').box(11, 5, 5, 13, 8, 6, 'l');
  g.box(11, 9, 9, 13, 10, 10, 'd');
  // The flame: a tall teardrop with a pale glowing heart and a tip that flickers to one side.
  g.extrude(['..g', '..gg', '.ggg', 'ggggg', 'ggggg', '.ggg'], 15, 8, 10, 10);
  g.extrude(['ggggg', 'ggggg'], 12, 7, 11, 10).extrude(['.ggg'], 13, 7, 11, 10);
  g.extrude(['.aa', '.aaa', '.aa'], 13, 11, 12, 10);
  return g.carve('candle', [12, 12, 12]);
}

export const MOTIFS: Record<ThingMotif, (family: StyleKey) => LibraryMotif> = {
  heart, crown, key, anchor, 'sailing-ship': sailingShip, teacup, book, candle,
};
