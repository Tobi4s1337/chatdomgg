import type { StyleKey } from '../materials';
import { CARVE_PALETTES, Carving, LIBRARY_ENVELOPE, SUBJECT_ACCENTS, type CarvePalette, type Cell, type LibraryMotif } from './carve';

/**
 * Water and garden motifs, carved in a working grid and emitted as merged boxes. Elevations are ASCII rows:
 * row 0 sits at `top`, column 0 at `x0`, and every character is one build cell (b body, s shade, l light,
 * d dark, g gold, a the motif's one subject accent; '.' is empty).
 */
type Id = 'whale' | 'fish' | 'swan' | 'octopus' | 'turtle' | 'butterfly' | 'mushroom' | 'rose';
type Pick = (c: string) => number | undefined;
const [W, H, D] = LIBRARY_ENVELOPE;

/** Mirror a left half (x 0..11) across the envelope's centre line. */
const sym = (rows: readonly string[]) => rows.map(r => r.padEnd(12, '.') + [...r.padEnd(12, '.')].reverse().join(''));

class Clay {
  private readonly v = new Uint16Array(W * H * D);
  readonly pick: Pick;
  constructor(readonly id: string, p: CarvePalette, accent?: number) {
    const tone: Record<string, number | undefined> = { b: p.body, s: p.shade, l: p.light, d: p.dark, g: p.gold, a: accent };
    this.pick = c => tone[c];
  }
  private at(x: number, y: number, z: number) { return x + W * (y + H * z); }
  private inside(x: number, y: number, z: number) { return x >= 0 && y >= 0 && z >= 0 && x < W && y < H && z < D; }
  get(x: number, y: number, z: number) { return this.inside(x, y, z) ? this.v[this.at(x, y, z)]! : 0; }
  set(x: number, y: number, z: number, m: number) { if (this.inside(x, y, z)) this.v[this.at(x, y, z)] = m; }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: number) {
    for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.set(x, y, z, m);
    return this;
  }
  /** Visit every lettered cell of an elevation as (x, y, char). */
  private each(art: readonly string[], top: number, x0: number, fn: (x: number, y: number, c: string) => void) {
    art.forEach((row, r) => [...row].forEach((c, i) => { if (c !== '.' && c !== ' ') fn(x0 + i, top - r, c); }));
  }
  /** Extrude an elevation between z0 and z1; `shift` slides a column in z (a wing swept back). */
  slab(art: readonly string[], top: number, z0: number, z1: number, x0 = 0, shift: (x: number, y: number) => number = () => 0, pick = this.pick) {
    this.each(art, top, x0, (x, y, c) => { const m = pick(c), s = shift(x, y); if (m !== undefined) for (let z = z0 + s; z < z1 + s; z++) this.set(x, y, z, m); });
    return this;
  }
  /** Extrude an elevation as a rounded pillow: thin at the silhouette, `max` cells either side of zc inside. */
  pillow(art: readonly string[], top: number, min: number, max: number, reach: number, zc = 9, x0 = 0, pick = this.pick) {
    const solid = new Set<string>();
    this.each(art, top, x0, (x, y) => solid.add(`${x},${y}`));
    const dist = (x: number, y: number) => {
      for (let d = 1; d < 12; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
        if (Math.hypot(dx, dy) <= d - 0.5 && !solid.has(`${x + dx},${y + dy}`)) return d;
      }
      return 12;
    };
    this.each(art, top, x0, (x, y, c) => {
      const m = pick(c); if (m === undefined) return;
      const h = Math.round(min + (max - min) * Math.sqrt(Math.min(1, (dist(x, y) - 1) / Math.max(1, reach - 1))));
      for (let z = zc - h; z < zc + h; z++) this.set(x, y, z, m);
    });
    return this;
  }
  /**
   * Loft an elevation into a body: every vertical run of cells in a column becomes an elliptical section,
   * `ratio` times as deep (either side of zc) as it is half-tall, capped at `max`. Bodies come out rounded
   * like a pebble rather than extruded.
   */
  loft(art: readonly string[], top: number, ratio: number, max: number, zc = 9, x0 = 0, pick = this.pick) {
    const width = Math.max(...art.map(r => r.length));
    for (let i = 0; i < width; i++) {
      const col = art.map(r => r[i] ?? '.');
      for (let r = 0; r < col.length;) {
        if (col[r] === '.' || col[r] === ' ') { r++; continue; }
        let e = r; while (e < col.length && col[e] !== '.' && col[e] !== ' ') e++;
        const half = (e - r) / 2, w = Math.min(max, ratio * half);
        for (let j = r; j < e; j++) {
          const m = pick(col[j]!); if (m === undefined) continue;
          const t = (j + 0.5 - (r + half)) / half, h = Math.max(1, Math.round(w * Math.sqrt(Math.max(0, 1 - t * t * 0.85))));
          for (let z = zc - h; z < zc + h; z++) this.set(x0 + i, top - j, z, m);
        }
        r = e;
      }
    }
    return this;
  }
  /** An ellipsoid centred at (cx, cy, cz), kept only at or above yMin (a dome when yMin = cy). */
  ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, m: number, yMin = 0) {
    for (let z = 0; z < D; z++) for (let y = yMin; y < H; y++) for (let x = 0; x < W; x++) {
      if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 + ((z + 0.5 - cz) / rz) ** 2 <= 1) this.set(x, y, z, m);
    }
    return this;
  }
  /** Sweep a ball of radius r along a polyline of points (cell-centre coordinates). */
  tube(points: readonly (readonly [number, number, number])[], r: number, m: number) {
    for (let s = 1; s < points.length; s++) {
      const [a, b] = [points[s - 1]!, points[s]!], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 4);
      for (let k = 0; k <= n; k++) {
        const t = k / Math.max(1, n), c = [0, 1, 2].map(i => a[i]! + (b[i]! - a[i]!) * t) as [number, number, number];
        for (let z = Math.floor(c[2] - r); z <= c[2] + r; z++) for (let y = Math.floor(c[1] - r); y <= c[1] + r; y++) for (let x = Math.floor(c[0] - r); x <= c[0] + r; x++) {
          if (Math.hypot(x + 0.5 - c[0], y + 0.5 - c[1], z + 0.5 - c[2]) <= r) this.set(x, y, z, m);
        }
      }
    }
    return this;
  }
  /** A solid of revolution about (cx, cz): rings are [y, radius], squeezed in z by `squash`. */
  lathe(cx: number, cz: number, rings: readonly (readonly [number, number])[], m: number, squash = 1) {
    for (const [y, r] of rings) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      if (Math.hypot(x + 0.5 - cx, (z + 0.5 - cz) / squash) <= r) this.set(x, y, z, m);
    }
    return this;
  }
  /** Repaint the first solid cell seen from the front (and from the back) under each lettered cell. */
  face(art: readonly string[], top: number, x0 = 0, both = true, pick = this.pick) {
    this.each(art, top, x0, (x, y, c) => {
      const m = pick(c); if (m === undefined) return;
      for (let z = D - 1; z >= 0; z--) if (this.get(x, y, z)) { this.set(x, y, z, m); break; }
      if (both) for (let z = 0; z < D; z++) if (this.get(x, y, z)) { this.set(x, y, z, m); break; }
    });
    return this;
  }
  /** Add one cell proud of the front (and back) surface: fins, plates, an eye's rim. */
  raise(art: readonly string[], top: number, x0 = 0, both = true, pick = this.pick) {
    this.each(art, top, x0, (x, y, c) => {
      const m = pick(c); if (m === undefined) return;
      for (let z = D - 1; z >= 0; z--) if (this.get(x, y, z)) { this.set(x, y, z + 1, m); break; }
      if (both) for (let z = 0; z < D; z++) if (this.get(x, y, z)) { this.set(x, y, z - 1, m); break; }
    });
    return this;
  }
  /** Paint surface cells within `r` of each point: spots on a cap, scutes on a shell. */
  spots(points: readonly (readonly [number, number, number])[], r: number, m: number) {
    for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!this.get(x, y, z)) continue;
      const open = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([a, b, c]) => !this.get(x + a!, y + b!, z + c!));
      if (open && points.some(([px, py, pz]) => Math.hypot(x + 0.5 - px, y + 0.5 - py, z + 0.5 - pz) <= r)) this.set(x, y, z, m);
    }
    return this;
  }
  /** Fill by a field evaluated at cell centres: a material, 0 to clear, or undefined to leave alone. */
  fill(field: (x: number, y: number, z: number) => number | undefined) {
    for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const m = field(x + 0.5, y + 0.5, z + 0.5); if (m !== undefined) this.set(x, y, z, m);
    }
    return this;
  }
  /** Solid balls of radius r at each point: warts and studs that stand proud of a surface. */
  ball(points: readonly (readonly [number, number, number])[], r: number, m: number) {
    for (const [px, py, pz] of points) for (let z = Math.floor(pz - r); z <= pz + r; z++) for (let y = Math.floor(py - r); y <= py + r; y++) for (let x = Math.floor(px - r); x <= px + r; x++) {
      if (Math.hypot(x + 0.5 - px, y + 0.5 - py, z + 0.5 - pz) <= r) this.set(x, y, z, m);
    }
    return this;
  }
  /** Repaint every surface cell (one with an open face) for which `where` holds. */
  surface(where: (x: number, y: number, z: number) => boolean, m: number) {
    const marks: number[] = [];
    for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!this.get(x, y, z) || !where(x, y, z)) continue;
      if ([[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([a, b, c]) => !this.get(x + a!, y + b!, z + c!))) marks.push(x, y, z);
    }
    for (let i = 0; i < marks.length; i += 3) this.set(marks[i]!, marks[i + 1]!, marks[i + 2]!, m);
    return this;
  }
  /** The outermost surface point of a lathe at height y, angle a (radians, 0 = +X, π/2 = front). */
  static rim(cx: number, cz: number, r: number, y: number, a: number, squash = 1): [number, number, number] {
    return [cx + r * Math.cos(a), y + 0.5, cz + r * squash * Math.sin(a)];
  }
  /** Greedy-merge the grid into boxes. */
  done(emitter: Cell): LibraryMotif {
    const carving = new Carving(this.id), used = new Uint8Array(this.v.length);
    const free = (x: number, y: number, z: number, m: number) => this.get(x, y, z) === m && !used[this.at(x, y, z)];
    for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const m = this.get(x, y, z);
      if (!m || used[this.at(x, y, z)]) continue;
      let x1 = x + 1; while (x1 < W && free(x1, y, z, m)) x1++;
      let y1 = y + 1; while (y1 < H && [...Array(x1 - x).keys()].every(i => free(x + i, y1, z, m))) y1++;
      let z1 = z + 1;
      while (z1 < D && [...Array(y1 - y).keys()].every(j => [...Array(x1 - x).keys()].every(i => free(x + i, y + j, z1, m)))) z1++;
      for (let c = z; c < z1; c++) for (let b = y; b < y1; b++) for (let a = x; a < x1; a++) used[this.at(a, b, c)] = 1;
      carving.box(x, y, z, x1, y1, z1, m);
    }
    return carving.done(emitter);
  }
}

/** Every carving stands on the same modest foot, so the point of attachment is part of it. */
const start = (id: Id, family: StyleKey, accent?: number) => {
  const p = CARVE_PALETTES[family], k = new Clay(`library-${id}`, p, accent);
  k.box(10, 0, 7, 15, 1, 12, p.shade);
  return { p, k };
};

// A whale breaches a curl of wave in profile, nose left: big round head, smiling mouth line, ribbed pale
// belly, a flipper on each flank, the body tapering up into a raised two-lobed fluke, and a forked spout.
function whale(family: StyleKey): LibraryMotif {
  const { p, k } = start('whale', family);
  k.slab([
    '...ss.......ssss........', // y3
    '.ssssssssssssssssssss...',
    '..ssssssssssssssssss....', // y1
  ], 3, 5, 13);
  k.pillow([
    '...............bbb...bbb', // y15
    '................bbb.bbb.',
    '.................bbbbb..',
    '..................bbb...',
    '..................bbb...',
    '..bbbbbbb........bbbb...', // y10
    '.bbbbbbbbbbbb...bbbb....',
    'bbbbbbbbbbbbbbbbbbbb....',
    'bbbbbbbbbbbbbbbbbbb.....',
    'bbbbbbbbbbbbbbbbbb......',
    'lbbbbbbbbbbbbbbbb.......', // y5
    '.lllllllllllbbbb........',
    '..llllllllll............', // y3
  ], 15, 1, 4, 4);
  k.slab(['ll...ll', '.ll.ll.', '..lll..', '...l...', '...l...'], 15, 8, 10, 2, () => 0, c => c === 'l' ? (family === 'grove' ? p.gold : p.light) : undefined);
  k.face([
    '.....d..................', // y7
    '.......dd...............',
    '.ddddddd................', // y5
    '..s.s.s.s.s.............',
  ], 7);
  k.raise(['........ss', '........sss', '.........sss'], 6);
  k.face(['...ll......lll.ll.', '..l..l....l...l..l'], 3, 0);
  if (family === 'hearth') k.face(['....g'], 8);
  if (family === 'tide') k.face(['...............l...l', '................l.l.'], 15);
  return k.done([4, 7, 14]);
}

// A fish leaps from a splash in profile, nose left: leaf-shaped body, big ringed eye, gill arc, rows of
// scales, a fanned dorsal fin, a pectoral fin on each flank and a deeply forked tail.
function fish(family: StyleKey): LibraryMotif {
  const { k } = start('fish', family);
  k.slab(['.........ll.ll..', '......llllllllll', '....ssssssssssssss'], 3, 6, 12, 2);
  k.slab(['ll..', 'llll'], 5, 8, 10, 10);
  k.pillow([
    '.......bbb..............', // y14
    '......bbbbb.............',
    '....bbbbbbbbb.......bbb.',
    '..bbbbbbbbbbbbb....bbbb.',
    '.bbbbbbbbbbbbbbbb.bbbbb.', // y10
    'bbbbbbbbbbbbbbbbbbbbb...',
    'bbbbbbbbbbbbbbbbbbbb....',
    'bbbbbbbbbbbbbbbbbbbbb...',
    '.lllllllllllllllb.bbbbb.',
    '..lllllllllllll....bbbb.', // y5
    '....lllllllll.......bbb.',
  ], 14, 1, 3, 3);
  k.face([
    '.......s.s..............', // y14
    '......s.s.s.............',
    '....................s.s.',
    '...l..d..s.s.s.s...s.s..',
    '..ldl.d.s.s.s.s.s..s.s..', // y10
    '..lll..d.s.s.s.s........',
    'd.....d.s.s.s.s.s.......',
    '......d..s.s.s.s........',
    '...................s.s..', // y6
  ], 14);
  k.raise(['ss', 'sss', '.sss'], 7, 6);
  if (family === 'hearth') k.face(['g'], 13, 8);
  if (family === 'grove') k.face(['.g.g'], 11, 19);
  return k.done([3, 9, 14]);
}

// A swan glides in profile, beak left: an S-curved neck rising from a full rounded breast to a small head
// with a gold beak and dark knob, a folded wing of layered feathers arching up to tips at the back, on a
// ripple ring.
function swan(family: StyleKey): LibraryMotif {
  const { p, k } = start('swan', family);
  k.ellipsoid(13, 0.5, 9, 10.5, 2.2, 6.5, p.shade, 1);
  k.loft([
    '..................bbb...', // y10
    '.............bbbbbbbb...',
    '.......bbbbbbbbbbbbbbb..',
    '......bbbbbbbbbbbbbbbbb.',
    '.....bbbbbbbbbbbbbbbbbb.',
    '.....bbbbbbbbbbbbbbbbb..', // y5
    '......bbbbbbbbbbbbbbb...',
    '........bbbbbbbbbbb.....', // y3
  ], 10, 1.4, 4.5);
  k.pillow([
    '...bbbb..', // y15
    '...bbbbb.',
    '...bb.bbb',
    '.......bb',
    '........bb',
    '........bb', // y10
    '.......bb',
    '......bbb',
    '......bbb', // y7
  ], 15, 1, 1, 1);
  k.slab(['ggg'], 13, 8, 10, 0).slab(['d'], 14, 8, 10, 2);
  k.face(['.....d'], 14);
  k.raise([
    '........lll', // y10
    '...lllllsll',
    '.llllllsllll',
    'lllllsslllll',
    '.lllsllllll.',
    '...ssllll...', // y5
  ], 10, 10);
  if (family === 'tide') k.face(['...l...l...l...l...l'], 2, 2);
  if (family === 'grove') k.face(['g'], 15, 5);
  return k.done([4, 13, 12]);
}

// An octopus faces the viewer: a tall round head with two big eyes and a few speckles, and eight arms
// splaying out all round it from a webbed skirt, each sweeping low and curling its pale tip back up.
function octopus(family: StyleKey): LibraryMotif {
  const { p, k } = start('octopus', family);
  k.lathe(12, 9, [[1, 2.4], [2, 2.6], [3, 3], [4, 3.4], [5, 3.8]], p.body, 0.85);
  k.lathe(12, 9, [[6, 4.2], [7, 4.8], [8, 5.3], [9, 5.6], [10, 5.8], [11, 5.8], [12, 5.6], [13, 5.1], [14, 4.3], [15, 3]], p.body, 0.85);
  const path: [number, number][] = [[2.5, 5.5], [4.5, 4.5], [6.5, 3], [8, 2], [9.3, 2], [10.2, 3], [10.2, 4.2], [9.2, 4.8]];
  const tips: [number, number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, squeeze = 0.78;
    const at = ([r, y]: [number, number]) => [12 + r * Math.cos(a), y, 9 + r * squeeze * Math.sin(a)] as [number, number, number];
    k.tube(path.map(at), 1.05, p.body);
    tips.push(at([9.4, 4.6]));
  }
  k.spots(tips, 1.1, p.light);
  k.raise(['ll..ll', 'ld..dl'], 9, 9);
  const speck = family === 'hearth' ? p.gold : p.shade;
  k.spots([Clay.rim(12, 9, 5.6, 12, 1.2, 0.85), Clay.rim(12, 9, 5.1, 13, 1.95, 0.85), Clay.rim(12, 9, 5.8, 11, 2.4, 0.85), Clay.rim(12, 9, 4.3, 14, 1.5, 0.85)], 0.8, speck);
  return k.done([12, 9, 15]);
}

// A turtle walks on a rock in profile, head left: a high dome shell of grooved plates over a flared rim,
// a pale blunt head raised on its neck with a dark eye, a big pale front flipper and a smaller hind
// flipper on each side, and a stub of tail.
function turtle(family: StyleKey): LibraryMotif {
  const { p, k } = start('turtle', family);
  k.ellipsoid(12, 0.5, 9, 5, 3.6, 4, p.shade, 1);
  k.ellipsoid(12.5, 5.5, 9, 8, 1.4, 5.8, p.shade, 4);
  const flip = ['....llll', '..llllll', '.lllll..', 'llll....'];
  const hind = ['llll..', '.lllll', '...lll'];
  k.slab(flip, 5, 12, 15, 1).slab(flip, 5, 3, 6, 1).slab(hind, 5, 12, 14, 16).slab(hind, 5, 4, 6, 16);
  k.box(20, 5, 8, 23, 7, 10, p.light);
  k.ellipsoid(12.5, 6.5, 9, 8.8, 1, 6.8, p.body, 6);
  k.ellipsoid(12.5, 6, 9, 7.8, 8.6, 5.9, p.body, 7);
  k.pillow(['.lll....', 'lllll...', 'llllll..', '..lllll.', '...lllll'], 11, 1, 2, 2, 9, 0);
  k.face(['....', '.d..', '....', '..d.'], 11, 0);
  // Scutes: one ring of grooves round the dome, staggered meridians below and above it, a cap plate.
  k.surface((x, y, z) => {
    if (y < 7) return false;
    const a = Math.atan2((z + 0.5 - 9) / 5.9, (x + 0.5 - 12.5) / 7.8) / (2 * Math.PI) + 1;
    if (y === 10 || y === 13) return true;
    const n = y < 10 ? 8 : y < 13 ? 5 : 0, f = (a * n + (y < 10 ? 0.06 : 0.5)) % 1;
    return n > 0 && (f < 0.1 || f > 0.93);
  }, p.dark);
  k.surface((x, y) => y === 6 && x % 3 === 0, family === 'hearth' ? p.gold : p.light);
  return k.done([1, 9, 12]);
}

// A butterfly rests face-on on a bud: two pairs of big wings swept gently back, dark borders, pale spots
// and a gold eyespot on each wing, a dark segmented body, a round head and two clubbed antennae.
function butterfly(family: StyleKey): LibraryMotif {
  const { p, k } = start('butterfly', family);
  const wings = sym([
    '............', // y15
    'bbb.........',
    'bbbbbb......',
    'bbbbbbbb....',
    'bbbbbbbbbb..',
    'bbbbbbbbbb..', // y10
    '.bbbbbbbbbb.',
    '..bbbbbbbbb.',
    '....bbbbbbb.',
    '...bbbbbbbb.',
    '..bbbbbbbbb.', // y5
    '..bbbbbbbbb.',
    '...bbbbbbb..',
    '....bbbb....', // y2
  ]);
  k.slab(wings, 15, 8, 10, 0, x => -Math.floor(Math.abs(x - 11.5) / 4));
  k.slab(sym(['......gg....', '.......dd...', '........dd..', '.........dd.']), 15, 8, 10);
  k.box(11, 1, 7, 13, 10, 11, p.dark).box(10, 10, 7, 14, 12, 11, p.dark).box(10, 1, 7, 14, 2, 11, p.light);
  k.face(sym([
    'ddd.........', // y14
    'dlddd.......',
    'd.l..dd.....',
    'd...gg...d..',
    'dl.gdg....s.', // y10
    '.d..g.....s.',
    '..d.......s.',
    '....d......',
    '...d.......', // y6
    '..d..l.....',
    '..d.ldl...s.',
    '...d.l....s.',
    '....dddd....', // y2
  ]), 14, 0, true);
  k.face(['g', '.', 'g', '.', 'g'], 8, 11).face(['g', '.', 'g', '.', 'g'], 8, 12);
  if (family === 'tide') k.face(sym(['.l..........']), 13);
  return k.done([12, 11, 13]);
}

// A toadstool on a mossy hummock: a broad domed cap scattered with big cream spots over a gill skirt, a
// thick pale stalk with a ring, and a small second toadstool at its foot in front.
function mushroom(family: StyleKey): LibraryMotif {
  const { p, k } = start('mushroom', family, SUBJECT_ACCENTS.cream);
  const spot = SUBJECT_ACCENTS.cream, cx = 10.5, cz = 8.5;
  k.lathe(12, 10, [[1, 7.6]], p.shade, 0.85);
  k.lathe(cx, cz, [[1, 3.6], [2, 3.1], [3, 2.8], [4, 2.7], [5, 2.7], [6, 2.7], [7, 2.8], [8, 2.9]], p.light);
  k.lathe(cx, cz, [[6, 3.4]], family === 'grove' ? p.gold : p.light);
  k.lathe(cx, cz, [[9, 7.4]], p.shade, 0.95);
  const cap: [number, number][] = [[10, 8.6], [11, 8.8], [12, 8.4], [13, 7.4], [14, 5.8], [15, 3.6]];
  k.lathe(cx, cz, cap, p.body, 0.95);
  k.lathe(18.5, 13.5, [[1, 1.6], [2, 1.5], [3, 1.5], [4, 1.5]], p.light);
  k.lathe(18.5, 13.5, [[5, 3]], p.shade).lathe(18.5, 13.5, [[6, 3.4], [7, 3], [8, 1.8]], p.body);
  const r = (y: number) => cap.find(([h]) => h === Math.floor(y))![1];
  const big: [number, number, number][] = [[cx, 16.2, cz]];
  for (const [y, n, off] of [[11, 6, Math.PI / 3], [13.5, 5, Math.PI / 2]] as const) {
    for (let i = 0; i < n; i++) big.push(Clay.rim(cx, cz, r(y) + 0.2, y, off + (i * 2 * Math.PI) / n, 0.95));
  }
  k.ball(big, 1.35, spot);
  k.ball([Clay.rim(18.5, 13.5, 3.5, 6, Math.PI / 2), Clay.rim(18.5, 13.5, 3.5, 6, -0.4), [18.5, 8.6, 13.5]], 1.1, spot);
  return k.done([10, 11, 17]);
}

// A rose on a thorned stem in side view: a deep cup of outer petals whose pale overlapping edges wrap up
// and round it, their corners curling out at the rim; a second ring and a spiral-grooved bud rise inside;
// gold sepals hold the cup, and two gold leaves with dark midribs spring from the stem at staggered heights.
function rose(family: StyleKey): LibraryMotif {
  const { p, k } = start('rose', family, SUBJECT_ACCENTS.petal);
  const petal = SUBJECT_ACCENTS.petal, [cx, cz] = [12.5, 9], sq = 0.9;
  const cup = [0, 0, 0, 0, 0, 0, 0, 2.9, 4, 4.6, 4.9, 5.1, 5.1, 5.1];
  k.box(12, 1, 8, 13, 8, 10, p.dark).box(13, 2, 9, 14, 3, 10, p.dark).box(11, 6, 8, 12, 7, 9, p.dark);
  k.fill((x, y, z) => {
    const Y = Math.floor(y), u = x - cx, w = (z - cz) / sq, r = Math.hypot(u, w), t = Math.atan2(w, u);
    // The bud, with a spiral groove winding into its crown.
    if (Y >= 11 && r <= 2.1) {
      const d = (r / 2.1 - ((t + Math.PI) / (2 * Math.PI) + 0.3) % 1 + 1) % 1;
      return Y === 15 ? (r < 1.8 ? (d < 0.3 ? p.shade : petal) : undefined) : petal;
    }
    // The inner ring of petals, its tips staggered against the outer ones.
    if (Y >= 11 && r > 2.1 && r <= 3.5) {
      if (Y <= 13) return r < 2.8 ? p.shade : petal;
      return Y === 14 && Math.cos(5 * t) > -0.3 ? petal : undefined;
    }
    if (Y >= 7 && Y <= 13 && r <= cup[Y]!) {
      if (Y >= 11 && r < cup[Y]! - 1.3) return undefined;
      // Overlapping petal edges slant up and round the cup.
      const lean = t - 0.2 * (Y - 7);
      const edge = [0, 1, 2, 3, 4].some(i => Math.abs(Math.atan2(Math.sin(lean - i * 1.2566 - 0.4), Math.cos(lean - i * 1.2566 - 0.4))) * r < 0.75);
      return edge && r > cup[Y]! - 1 ? p.light : petal;
    }
    // Petal corners curl out over the rim at either side.
    if (Y === 14 && r > 3.7 && r <= 5.9 && Math.abs(Math.cos(t)) > 0.8) return petal;
    if (Y === 13 && r > cup[13]! && r <= 6.1 && Math.abs(Math.cos(t)) > 0.85) return petal;
    // Gold sepals hug the base of the cup.
    if (Y >= 7 && Y <= 8 && r > cup[Y]! && r <= cup[Y]! + 0.9 && Math.cos(5 * t + 0.6) > 0.7) return p.gold;
    return undefined;
  });
  const left = ['ggg.....', 'gggggg..', '.ggggggg', '...ggggg'];
  k.slab(left, 5, 8, 10, 4).face(['........', '.ddd....', '....ddd.', '........'], 5, 4);
  const right = ['.....ggg', '..gggggg', 'ggggggg.', 'ggggg...'];
  k.slab(right, 6, 8, 10, 13).face(['........', '....ddd.', '.ddd....', '........'], 6, 13);
  if (family === 'hearth') k.box(12, 1, 10, 13, 2, 11, p.gold);
  return k.done([12, 11, 16]);
}

export const MOTIFS: Record<Id, (family: StyleKey) => LibraryMotif> = { whale, fish, swan, octopus, turtle, butterfly, mushroom, rose };
