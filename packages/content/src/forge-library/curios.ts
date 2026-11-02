import { CARVE_PALETTES, Carving, LIBRARY_ENVELOPE, SUBJECT_ACCENTS, type Cell, type LibraryMotif } from './carve';
import type { StyleKey } from '../materials';

export type CurioMotif = 'bell' | 'music-note' | 'gem' | 'castle-tower' | 'skull' | 'ghost' | 'cake' | 'potion';

const [SX, SY, SZ] = LIBRARY_ENVELOPE;
type Legend = Record<string, number>;

/**
 * A working block of the envelope. Curios are round, so they are modelled as solids (turned discs, puffed
 * elevations) and then carved into (dug eye sockets, painted facets); `emit` merges the cells into Carving boxes.
 * Elevation rows are written top-down: row 0 sits at `top`, column 0 at x 0, one character per build cell.
 */
class Block {
  private readonly v = new Uint16Array(SX * SY * SZ);
  private at(x: number, y: number, z: number) { return x + SX * (y + SY * z); }
  private inside(x: number, y: number, z: number) { return x >= 0 && y >= 0 && z >= 0 && x < SX && y < SY && z < SZ; }
  get(x: number, y: number, z: number) { return this.inside(x, y, z) ? this.v[this.at(x, y, z)]! : 0; }
  set(x: number, y: number, z: number, m: number) { if (this.inside(x, y, z)) this.v[this.at(x, y, z)] = m; }
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: number) {
    for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.set(x, y, z, m);
    return this;
  }
  /** A turned layer from y0 to y1 about the centre line (12, 9): superellipse of power n (or an octagon), half-widths rx and rz. */
  disc(y0: number, y1: number, rx: number, rz: number, m: number, n: number | 'oct' = 2, keep: (x: number, z: number) => boolean = () => true) {
    for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) {
      const u = Math.abs((x + 0.5 - 12) / rx), v = Math.abs((z + 0.5 - 9) / rz);
      const d = n === 'oct' ? Math.max(u, v, (u + v) / 1.35) : u ** n + v ** n;
      if (d <= 1.0001 && keep(x, z)) for (let y = y0; y < y1; y++) this.set(x, y, z, m);
    }
    return this;
  }
  /** The outer `wall` cells of a turned layer, filtered by their angle about the centre line (0 faces the viewer). */
  ring(y0: number, y1: number, rx: number, rz: number, wall: number, m: number, keep: (angle: number, x: number, z: number) => boolean = () => true) {
    return this.disc(y0, y1, rx, rz, m, 2, (x, z) => {
      const dx = (x + 0.5 - 12) / rx, dz = (z + 0.5 - 9) / rz;
      return Math.hypot(dx, dz) > 1 - wall / Math.max(rx, rz) && keep(Math.atan2(dx, dz), x, z);
    });
  }
  /** An ellipsoid (or, with n above 2, a fuller superellipsoid) about a cell-space centre. */
  ball(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, m: number, n = 2) {
    for (let z = 0; z < SZ; z++) for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) {
      const d = Math.abs((x + 0.5 - cx) / rx) ** n + Math.abs((y + 0.5 - cy) / ry) ** n + Math.abs((z + 0.5 - cz) / rz) ** n;
      if (d <= 1.0001) this.set(x, y, z, m);
    }
    return this;
  }
  /** Extrudes an elevation from z0 to z1; characters outside the legend are left alone. */
  slab(art: readonly string[], top: number, z0: number, z1: number, legend: Legend) {
    art.forEach((row, i) => [...row].forEach((c, x) => { if (legend[c] !== undefined) this.fill(x, top - i, z0, x + 1, top - i + 1, z1, legend[c]!); }));
    return this;
  }
  /** A pillowed elevation: the core from z0 to z1, then `layers` successively eroded skins on the front and back. */
  puff(art: readonly string[], top: number, z0: number, z1: number, layers: number, legend: Legend, back = layers) {
    this.slab(art, top, z0, z1, legend);
    let skin = art;
    for (let k = 1; k <= Math.max(layers, back); k++) {
      skin = erode(skin);
      if (k <= layers) this.slab(skin, top, z1 + k - 1, z1 + k, legend);
      if (k <= back) this.slab(skin, top, z0 - k, z0 - k + 1, legend);
    }
    return this;
  }
  /** Paints a straight line onto the front surface, and its mirror across x = 12. */
  stroke(x0: number, y0: number, x1: number, y1: number, m: number) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / steps), y = Math.round(y0 + ((y1 - y0) * i) / steps);
      for (const u of [x, 23 - x]) { const z = this.front(u, y); if (z >= 0) this.set(u, y, z, m); }
    }
    return this;
  }
  /** The first solid z met looking in from the front, or -1. */
  front(x: number, y: number) { for (let z = SZ - 1; z >= 0; z--) if (this.get(x, y, z)) return z; return -1; }
  /**
   * Works an elevation into the front surface: `paint` recolours the visible cell, `raise` stands `depth` cells
   * proud of it, `dig` cuts `depth` cells in and lines the floor of the cut.
   */
  face(art: readonly string[], top: number, legend: Legend, mode: 'paint' | 'raise' | 'dig' = 'paint', depth = 1) {
    art.forEach((row, i) => [...row].forEach((c, x) => {
      const m = legend[c], y = top - i;
      if (m === undefined) return;
      const z = this.front(x, y);
      if (z < 0) return;
      if (mode === 'paint') this.set(x, y, z, m);
      else if (mode === 'raise') for (let k = 1; k <= depth; k++) this.set(x, y, z + k, m);
      else { for (let k = 0; k < depth; k++) this.set(x, y, z - k, 0); this.set(x, y, z - depth, m); }
    }));
    return this;
  }
  /** Recolours every solid cell the test picks. */
  recolour(pick: (x: number, y: number, z: number, m: number) => boolean, m: number) {
    for (let z = 0; z < SZ; z++) for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) {
      const was = this.get(x, y, z);
      if (was && pick(x, y, z, was)) this.set(x, y, z, m);
    }
    return this;
  }
  /** Greedy-merges the cells into boxes of one material each. */
  emit(id: string, emitter: Cell): LibraryMotif {
    const carving = new Carving(id), seen = new Uint8Array(this.v.length);
    const free = (x: number, y: number, z: number, m: number) => !seen[this.at(x, y, z)] && this.v[this.at(x, y, z)] === m;
    for (let z = 0; z < SZ; z++) for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) {
      const m = this.v[this.at(x, y, z)]!;
      if (!m || seen[this.at(x, y, z)]) continue;
      let x1 = x + 1; while (x1 < SX && free(x1, y, z, m)) x1++;
      let y1 = y + 1; while (y1 < SY && range(x, x1).every(i => free(i, y1, z, m))) y1++;
      let z1 = z + 1; while (z1 < SZ && range(y, y1).every(j => range(x, x1).every(i => free(i, j, z1, m)))) z1++;
      for (let k = z; k < z1; k++) for (let j = y; j < y1; j++) for (let i = x; i < x1; i++) seen[this.at(i, j, k)] = 1;
      carving.box(x, y, z, x1, y1, z1, m);
    }
    return carving.done(emitter);
  }
}

const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);
/** Keeps the cells of an elevation whose four neighbours are all filled: one bevel step in. */
function erode(art: readonly string[]): string[] {
  const on = (x: number, y: number) => { const c = art[y]?.[x]; return c !== undefined && c !== '.'; };
  return art.map((row, y) => [...row].map((c, x) => on(x, y) && on(x - 1, y) && on(x + 1, y) && on(x, y - 1) && on(x, y + 1) ? c : '.').join(''));
}
/** Every curio stands on the same modest foot, which holds the mount cell. */
const foot = (b: Block, m: number) => b.fill(10, 0, 7, 15, 1, 12, m);

/** Turns a profile: one disc per row, `widths[y]` cells across, `deep` times as deep, as a superellipse of power n. */
const turn = (b: Block, widths: Record<number, number>, m: number, deep = 1, n: number | 'oct' = 2) => {
  for (const [y, w] of Object.entries(widths)) b.disc(+y, +y + 1, w / 2, Math.max(1, (w / 2) * deep), m, n);
};
/** A full elevation row from its left half, mirrored across x = 12. */
const sym = (half: string) => half.padEnd(12, '.') + [...half.padEnd(12, '.')].reverse().join('');
/** The x-cells of a 12-wide parapet (x 6..17) that carry merlons: two at each end, four in the middle. */
const merlon = (u: number) => [6, 7, 10, 11, 12, 13, 16, 17].includes(u);
/** A highlight that shows against a pale accent: the palette's light, or brass where light is that same cream. */
const glint = (p: { light: number; gold: number }, against: number) => (p.light === against ? p.gold : p.light);
const angleOf = (x: number, z: number, squash = 1) => Math.atan2(x + 0.5 - 12, (z + 0.5 - 9) / squash);

export const MOTIFS: Record<CurioMotif, (family: StyleKey) => LibraryMotif> = {
  // A flared brass bell (dome, waist, flared pale lip, dark clapper below) hung by its crown loop from a timber yoke.
  bell: family => {
    const p = CARVE_PALETTES[family], b = new Block();
    b.fill(1, 0, 7, 23, 1, 12, p.shade);
    foot(b, p.shade);
    b.fill(2, 1, 8, 4, 14, 11, p.dark).fill(20, 1, 8, 22, 14, 11, p.dark);
    b.fill(1, 14, 7, 23, 16, 11, p.dark);
    b.fill(10, 13, 8, 11, 14, 10, p.gold).fill(13, 13, 8, 14, 14, 10, p.gold);
    turn(b, { 12: 6, 11: 8, 10: 8, 9: 8, 8: 10, 7: 10, 6: 10, 5: 12, 4: 14 }, p.gold);
    b.ring(4, 5, 7, 7, 1, p.light);
    b.ring(8, 9, 5, 5, 1, family === 'tide' ? p.light : p.shade);
    if (family === 'tide') b.ring(10, 11, 4, 4, 1, p.light);
    b.face(['', '.........l', '.........l', '.........l', '', '.........l', '........l'], 12, { l: p.light });
    b.fill(10, 2, 8, 14, 4, 10, p.dark).fill(11, 2, 7, 13, 4, 11, p.dark);
    if (family === 'grove') b.fill(0, 14, 7, 2, 16, 11, p.gold).fill(22, 14, 7, 24, 16, 11, p.gold);
    else if (family === 'hearth') b.fill(1, 14, 11, 3, 16, 12, p.gold).fill(21, 14, 11, 23, 16, 12, p.gold);
    return b.emit('curio-bell', [12, 7, 17]);
  },
  // Two beamed eighth notes: two tilted heads, two stems and one slanted beam, pillowed so the heads are round.
  'music-note': family => {
    const p = CARVE_PALETTES[family], b = new Block();
    b.fill(4, 0, 7, 20, 1, 12, p.shade);
    foot(b, p.shade);
    const note = [
      '.................bbbb...', // y15
      '.............bbbbbbbb...',
      '.........bbbbbbbbbbbb...',
      '.........bbbbbbbb..bb...',
      '.........bbbb......bb...',
      '.........bb........bb...', // y10
      '.........bb........bb...',
      '.........bb........bb...',
      '.........bb........bb...',
      '......bbbbb.....bbbbb...', // y6
      '....bbbbbbb...bbbbbbb...',
      '...bbbbbbbb..bbbbbbbb...',
      '...bbbbbbbb..bbbbbbbb...',
      '...bbbbbbb...bbbbbbb....',
      '....bbbbb.....bbbbb.....', // y1
    ];
    b.puff(note, 15, 7, 11, 2, { b: p.body });
    b.face(['.....ll........ll', '....l.........l'], 5, { l: family === 'grove' ? p.gold : p.light });
    return b.emit('curio-music-note', [12, 8, 14]);
  },
  // A cut jewel (pale table rim, sloped crown, pale girdle, long pavilion to a point) with facet lines, seated in a brass cup.
  gem: family => {
    const p = CARVE_PALETTES[family], b = new Block(), gem = SUBJECT_ACCENTS.blueFlower;
    foot(b, p.shade);
    turn(b, { 15: 12, 14: 16, 13: 20, 12: 22, 11: 20, 10: 18, 9: 16, 8: 14, 7: 12, 6: 10, 5: 8, 4: 6, 3: 4, 2: 2 }, gem, 0.75, 'oct');
    // The table rim and girdle run all the way round; the crown zigzags and the pavilion edges meet at the point.
    b.recolour((_, y) => y === 12, p.light);
    b.recolour((x, y, z) => y === 15 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !b.get(x + dx!, y, z + dz!)), p.light);
    b.stroke(8, 15, 4, 12, p.light).stroke(8, 15, 11, 12, p.light);
    b.stroke(4, 11, 11, 3, p.light).stroke(8, 11, 11, 5, p.light);
    b.disc(1, 2, 2, 2, p.gold).disc(2, 4, 3, 3, p.gold);
    // A raised four-point glint on the crown; each family catches the light in a different place.
    const at = { hearth: 5, tide: 15, grove: 8 }[family], high = family === 'grove' ? 10 : 14;
    b.face(['.'.repeat(at + 1) + 's', '.'.repeat(at) + 'sss', '.'.repeat(at + 1) + 's'], high, { s: p.light }, 'raise');
    return b.emit('curio-gem', [12, 10, 16]);
  },
  // A round stone tower: footing, arched door, slit windows, a corbelled crenellated parapet and a pennant on a pole.
  'castle-tower': family => {
    const p = CARVE_PALETTES[family], b = new Block(), flag = SUBJECT_ACCENTS.petal;
    foot(b, p.shade);
    b.disc(1, 2, 5.6, 5.6, p.shade);
    b.disc(2, 9, 5, 5, p.body);
    b.recolour((x, y, z) => y >= 2 && y < 9 && (x * 7 + z * 3 + y * 5) % 9 === 0, p.shade);
    b.disc(9, 10, 5.6, 5.6, p.shade);
    b.disc(10, 11, 5.6, 5.6, p.light);
    b.ring(11, 13, 5.6, 5.6, 1.6, p.light, (_, x, z) => Math.abs(z + 0.5 - 9) >= Math.abs(x + 0.5 - 12) ? merlon(x) : merlon(z + 3));
    b.face([sym('..........ll'), sym('.........l'), sym('.........l'), sym('.........l'), sym('.........l')], 6, { l: p.light }, 'raise');
    b.face([sym('...........d'), sym('..........dd'), sym('..........dd'), sym('..........dd')], 5, { d: p.dark });
    b.face([sym('........d'), sym('........d..d'), sym('........d..d')], 8, { d: p.dark }, 'dig');
    b.fill(11, 10, 8, 13, 15, 10, p.dark).fill(11, 15, 8, 13, 16, 10, p.gold);
    b.slab(['.............fffffff', '.............fffff', '.............fff'], 15, 8, 10, { f: flag });
    if (family === 'grove') b.face([sym('.......l')], 3, { l: p.light });
    else if (family === 'tide') b.ring(5, 6, 5, 5, 1, p.shade);
    return b.emit('curio-castle-tower', [12, 6, 15]);
  },
  // A friendly bone-pale skull: round cranium, two big round sockets with a glint, a little nose and a stitched toothy grin.
  skull: family => {
    const p = CARVE_PALETTES[family], b = new Block(), bone = SUBJECT_ACCENTS.cream;
    foot(b, p.shade);
    const skull = [
      '........bbbbbbbb', '......bbbbbbbbbbbb', '.....bbbbbbbbbbbbbb', // y15..13
      '....bbbbbbbbbbbbbbbb', '....bbbbbbbbbbbbbbbb', '....bbbbbbbbbbbbbbbb', '....bbbbbbbbbbbbbbbb', '....bbbbbbbbbbbbbbbb',
      '.....bbbbbbbbbbbbbb', '......bbbbbbbbbbbb', '.......bbbbbbbbbb', // y7..5
      '........bbbbbbbb', '........bbbbbbbb', '.........bbbbbb', '..........bbbb', // y4..1
    ];
    b.puff(skull, 15, 6, 11, 2, { b: bone });
    b.ball(12, 11, 8, 7.5, 5, 4.6, bone);
    b.face([sym('.......ddd'), sym('......ddddd'), sym('......ddddd'), sym('.......ddd')], 10, { d: p.dark }, 'dig', 2);
    b.face(['.......l......l'], 9, { l: glint(p, bone) });
    b.face([sym('...........d'), sym('...........d')], 6, { d: p.dark }, 'dig', 1);
    b.face([sym('........d.d'), sym('.........ddd'), sym('..........d')], 4, { d: p.dark }, 'dig', 1);
    if (family === 'hearth') b.face([sym('.....b')], 6, { b: p.body });
    else if (family === 'grove') b.face(['................mmm', '.................mm'], 14, { m: p.body }, 'raise');
    return b.emit('curio-skull', [12, 9, 15]);
  },
  // A cheerful sheet ghost: domed head, waving arm, wavy three-lobed hem trailing to a wisp, dark eyes and an "oo" mouth.
  ghost: family => {
    const p = CARVE_PALETTES[family], b = new Block(), sheet = SUBJECT_ACCENTS.cream;
    const ghost = [
      '.........cccccc.........', // y15
      '.......cccccccccc.......',
      '......cccccccccccc..cc..',
      '.....cccccccccccccc.cc..',
      '.....ccccccccccccccccc..',
      '.....cccccccccccccccc...', // y10
      '..cc.cccccccccccccc.....',
      '..ccccccccccccccccc.....',
      '...cccccccccccccccc.....',
      '.....cccccccccccccc.....', // y6
      '.....cccccccccccccc.....',
      '.....cccccccccccccc.....',
      '.....cccc..cccc..ccc....',
      '......cc....cccc..cc....', // y2
      '.............cc.........',
    ];
    b.puff(ghost, 15, 6, 11, 2, { c: sheet });
    b.ball(12, 11, 8.5, 7, 4.5, 4.5, sheet);
    b.face([sym('........dd'), sym('........dd'), sym('........dd')], 12, { d: p.dark }, 'dig', 2);
    b.face(['........l.....l'], 12, { l: glint(p, sheet) });
    b.face([sym('...........d'), sym('..........dd'), sym('..........dd'), sym('...........d')], 8, { d: p.dark }, 'dig', 2);
    b.recolour((_, y) => y < 2, glint(p, sheet));
    foot(b, p.shade);
    if (family === 'hearth') b.face([sym('......b')], 7, { b: p.body });
    return b.emit('curio-ghost', [12, 9, 16]);
  },
  // A two-tier cake on a plate: sponge tiers, cream icing with tidy drips all round, piped beads and one lit candle.
  cake: family => {
    const p = CARVE_PALETTES[family], b = new Block(), icing = SUBJECT_ACCENTS.cream;
    foot(b, p.shade);
    b.disc(1, 2, 10.5, 7.5, p.light);
    b.disc(2, 6, 8.5, 6.5, p.body);
    b.disc(6, 7, 8.7, 6.7, icing);
    b.disc(7, 10, 5.5, 4.5, p.body);
    b.disc(10, 11, 5.7, 4.7, icing);
    const drips = (top: number, rx: number, rz: number, bins: number, lengths: number[]) => b.recolour((x, y, z) => {
      if (Math.hypot((x + 0.5 - 12) / rx, (z + 0.5 - 9) / rz) < 0.75) return false;
      const bin = Math.floor(((angleOf(x, z, rz / rx) + Math.PI) / (2 * Math.PI)) * bins) % bins;
      return y < top && y >= top - lengths[bin % lengths.length]!;
    }, icing);
    drips(6, 8.5, 6.5, 28, [2, 0, 1, 0]);
    drips(10, 5.5, 4.5, 18, [1, 0, 1, 0, 2, 0]);
    b.ring(7, 8, 8.4, 6.4, 1.2, icing, a => Math.floor(((a + Math.PI) / (2 * Math.PI)) * 22) % 2 === 0);
    b.fill(11, 11, 8, 13, 13, 10, p.light).fill(11, 12, 8, 13, 13, 10, p.shade);
    b.fill(11, 13, 8, 13, 15, 10, p.gold).fill(12, 15, 9, 13, 16, 10, p.gold);
    if (family === 'tide') b.recolour((x, y) => y === 1 && Math.abs(x + 0.5 - 12) > 9, p.gold);
    else if (family === 'grove') b.face([sym('......g')], 4, { g: p.gold });
    return b.emit('curio-cake', [12, 8, 17]);
  },
  // A round-bottomed potion flask: pale glass bulb half full of the family's brew with bubbles, long neck, brass collar, cork.
  potion: family => {
    const p = CARVE_PALETTES[family], b = new Block(), flask = SUBJECT_ACCENTS.cream;
    b.ball(12, 6, 9, 6, 5.6, 6, flask, 2.4);
    b.recolour((_, y) => y <= 6, p.body);
    b.disc(11, 14, 2, 2, flask);
    b.disc(13, 14, 2.8, 2.8, p.gold);
    b.disc(14, 16, 1.6, 1.6, p.dark);
    b.face(['', '.........l', '.............ll', '.............ll', '..........l'], 6, { l: glint(p, flask) });
    foot(b, p.shade);
    return b.emit('curio-potion', [12, 6, 16]);
  },
};
