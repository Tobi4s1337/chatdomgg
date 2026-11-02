import type { StyleKey } from '../materials';
import { CARVE_PALETTES, Carving, LIBRARY_ENVELOPE, SUBJECT_ACCENTS, type Cell, type LibraryMotif } from './carve';

type SkyMotif = 'sun' | 'cloud' | 'rainbow' | 'oak-tree' | 'pumpkin' | 'apple' | 'snowflake' | 'acorn';
const [SX, SY, SZ] = LIBRARY_ENVELOPE;
const A = SUBJECT_ACCENTS;

/**
 * A dense working block in the library envelope. Pieces are painted into it (later paint wins) from row
 * elevations, boxes and shape functions on cell centres, then handed to a `Carving` as merged boxes.
 */
class Block {
  readonly cells = new Uint16Array(SX * SY * SZ);
  at(x: number, y: number, z: number) { return x + SX * (y + SY * z); }
  get(x: number, y: number, z: number) { return x < 0 || y < 0 || z < 0 || x >= SX || y >= SY || z >= SZ ? 0 : this.cells[this.at(x, y, z)]!; }
  set(x: number, y: number, z: number, m: number) { if (x >= 0 && y >= 0 && z >= 0 && x < SX && y < SY && z < SZ) this.cells[this.at(x, y, z)] = m; }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: number): this {
    for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.set(x, y, z, m);
    return this;
  }
  /** Paints every cell whose centre the function claims (a material), leaving the rest untouched. */
  shape(fn: (x: number, y: number, z: number) => number | undefined): this {
    for (let z = 0; z < SZ; z++) for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) {
      const m = fn(x + 0.5, y + 0.5, z + 0.5);
      if (m) this.set(x, y, z, m);
    }
    return this;
  }
  /** Recolours solid cells the function claims; air stays air. */
  tint(fn: (x: number, y: number, z: number, m: number) => number | undefined): this {
    for (let z = 0; z < SZ; z++) for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) {
      const was = this.get(x, y, z);
      if (!was) continue;
      const m = fn(x + 0.5, y + 0.5, z + 0.5, was);
      if (m) this.set(x, y, z, m);
    }
    return this;
  }
  /**
   * A cushion extruded from a front silhouette: each cell stands `base` cells either side of `cz`, plus `slope`
   * per cell of distance from the outline, up to `max`. Rounded subjects get soft, deep middles and thin rims.
   */
  pillow(mask: (x: number, y: number) => boolean, base: number, slope: number, max: number, m: number, cz = 9): this {
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < SX && y < SY && mask(x + 0.5, y + 0.5);
    for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) {
      if (!inside(x, y)) continue;
      let d = 1;
      while (d < 8 && [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, d], [d, -d], [-d, -d]].every(([dx, dy]) => inside(x + Math.sign(dx!) * Math.ceil(Math.abs(dx!) * (dy ? 0.71 : 1)), y + Math.sign(dy!) * Math.ceil(Math.abs(dy!) * (dx ? 0.71 : 1))))) d++;
      const h = Math.min(max, Math.round(base + slope * (d - 1)));
      this.box(x, y, cz - h, x + 1, y + 1, cz + h, m);
    }
    return this;
  }
  /** Row elevation: row 0 sits at `top`, column 0 at x 0; each character is one cell, '.' is left alone. */
  art(rows: readonly string[], top: number, z0: number, z1: number, key: Record<string, number>): this {
    rows.forEach((row, i) => { for (let x = 0; x < row.length; x++) { const m = key[row[x]!]; if (m) this.box(x, top - i, z0, x + 1, top - i + 1, z1, m); } });
    return this;
  }
  /** Greedy x, then y, then z runs of one material: a compact, deterministic carving. */
  carve(id: string, emitter: Cell): LibraryMotif {
    const c = new Carving(id), used = new Uint8Array(this.cells.length);
    const free = (x: number, y: number, z: number, m: number) => this.cells[this.at(x, y, z)] === m && !used[this.at(x, y, z)];
    for (let z = 0; z < SZ; z++) for (let y = 0; y < SY; y++) for (let x = 0; x < SX; x++) {
      const m = this.cells[this.at(x, y, z)]!;
      if (!m || used[this.at(x, y, z)]) continue;
      let x1 = x + 1; while (x1 < SX && free(x1, y, z, m)) x1++;
      let y1 = y + 1;
      rows: while (y1 < SY) { for (let X = x; X < x1; X++) if (!free(X, y1, z, m)) break rows; y1++; }
      let z1 = z + 1;
      slabs: while (z1 < SZ) { for (let Y = y; Y < y1; Y++) for (let X = x; X < x1; X++) if (!free(X, Y, z1, m)) break slabs; z1++; }
      for (let Z = z; Z < z1; Z++) for (let Y = y; Y < y1; Y++) for (let X = x; X < x1; X++) used[this.at(X, Y, Z)] = 1;
      c.box(x, y, z, x1, y1, z1, m);
    }
    return c.done(emitter);
  }
}

/** A left half mirrored across x = 12 into a full 24-cell row. */
const sym = (rows: readonly string[]) => rows.map(half => half.padEnd(12, '.').slice(0, 12) + [...half.padEnd(12, '.').slice(0, 12)].reverse().join(''));
/** A front silhouette from row art: row 0 sits at `top`, column 0 at x 0, any non-'.' character is inside. */
const silhouette = (rows: readonly string[], top: number) => (x: number, y: number) => {
  const row = rows[top - Math.floor(y)], c = row?.[Math.floor(x)];
  return c !== undefined && c !== '.';
};
/** The modest foot every library piece stands on; it holds the mount cell (12,0,9). */
const foot = (b: Block, m: number) => b.box(9, 0, 7, 15, 1, 12, m);
const ell = (x: number, y: number, z: number, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number) =>
  ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;

// Sun: a round sleepy-smiling face disc ringed by long cardinal and short diagonal rays, on a short post.
function sun(family: StyleKey): LibraryMotif {
  const p = CARVE_PALETTES[family], b = new Block();
  foot(b, p.shade);
  const short = family === 'tide' ? p.light : p.gold;
  const disc = sym([
    '...........g', // y15
    '...........g',
    '.......h..gg',
    '.......hh.bb',
    '........hbbb',
    '.......gbbbb', // y10
    '....ggggbbbb',
    '....ggggbbbb',
    '.......gbbbb',
    '........hbbb',
    '.......hh.bb', // y5
    '.......h..gg',
    '...........g',
    '...........g',
    '...........s', // y1
  ]);
  b.art(disc, 15, 8, 10, { g: p.gold, h: short, s: p.shade });
  // Grove's sun is a honey disc; the others carry the kingdom's glaze.
  const face = family === 'grove' ? p.light : p.body;
  b.art(disc, 15, 7, 11, { b: face });
  // The raised face, sleepy lids and a wide smile.
  b.art(sym([
    '..........bb', // y11
    '.........ddb',
    '.........bbb',
    '.........dbb',
    '.........bdd',
    '..........bb', // y6
  ]), 11, 11, 12, { b: face, d: p.dark });
  // Ray tips stand a little proud of the ring.
  b.art(sym(['...........g', '', '', '', '', '', '....g', '....g']), 15, 10, 11, { g: p.gold });
  return b.carve('sun', [12, 9, 13]);
}

// Cloud: a big pale crown with a lower lobe either side and a small end puff, resting on its flat underside.
function cloud(family: StyleKey): LibraryMotif {
  const p = CARVE_PALETTES[family], b = new Block();
  foot(b, p.shade);
  const lobes = [[10.6, 8.6, 4.7], [16.9, 7.1, 3.7], [4.9, 5.9, 3.1], [21, 4.7, 2.3]] as const;
  b.shape((x, y, z) => y > 1 && (lobes.some(([cx, cy, r]) => ell(x, y, z, cx, cy, 9, r, r, r * 0.95) <= 1) || ell(x, y, z, 12, 3.2, 9, 10, 2.4, 3.2) <= 1) ? p.light : undefined);
  // A bright crescent rims each lobe's upper left; a shaded flat underside.
  const glow = family === 'tide' ? A.limestone : A.cream;
  b.tint((x, y, z) => z > 9 && lobes.some(([cx, cy, r]) => Math.hypot(x - cx, y - cy) <= r && Math.hypot(x - cx - 0.9, y - cy + 0.9) > r - 0.5) && y > 3 ? glow : undefined);
  b.tint((x, y) => y < 2 ? p.shade : undefined);
  return b.carve('cloud', [12, 8, 14]);
}

// Rainbow: a thick three-band arc whose feet rest in two small puffy clouds.
function rainbow(family: StyleKey): LibraryMotif {
  const p = CARVE_PALETTES[family], b = new Block();
  const bands = family === 'hearth' ? [p.body, p.gold, A.leaf] : family === 'tide' ? [A.petal, p.gold, p.body] : [p.gold, p.body, p.shade];
  const cloud = family === 'grove' ? A.cream : p.light;
  b.box(4, 0, 8, 20, 1, 11, p.shade);
  foot(b, p.shade);
  const band = (x: number, y: number) => {
    if (y < 2.5) return -1;
    const r = Math.hypot(x - 12, y - 2.5);
    return r >= 11.8 ? -1 : r >= 9.6 ? 0 : r >= 7.5 ? 1 : r >= 5.4 ? 2 : -1;
  };
  b.shape((x, y, z) => { const i = band(x, y); return i >= 0 && z > 7 && z < 11 ? bands[i] : undefined; });
  // The middle band stands proud on the front so the arc reads carved.
  b.shape((x, y, z) => band(x, y) === 1 && z > 10 && z < 12 ? bands[1] : undefined);
  // Each foot sinks into a small two-bumped cloud that stands proud of the arc.
  const puff = sym([
    '....ccc...', // y6
    '.cc.ccccc.',
    'cccccccccc',
    'cccccccccc',
    '.cccccccc.', // y2
  ]);
  b.pillow(silhouette(puff, 6), 1, 1, 3, cloud, 10);
  b.box(1, 1, 8, 9, 2, 12, p.shade).box(15, 1, 8, 23, 2, 12, p.shade);
  return b.carve('rainbow', [12, 8, 13]);
}

// Oak tree: a rooted chunky trunk forking into a broad, scalloped crown of leaf clumps dotted with acorns.
function oakTree(family: StyleKey): LibraryMotif {
  const p = CARVE_PALETTES[family], b = new Block();
  foot(b, p.body);
  const bark = p.dark, cx = 12, cy = 10.4;
  // A broad core with leaf clumps bulging around its rim and across its front and back faces.
  const clumps: [number, number, number, number][] = [];
  for (const deg of [0, 42, 90, 138, 180, 215, 325]) {
    const a = deg * Math.PI / 180;
    clumps.push([cx + Math.cos(a) * 6.6, cy + Math.sin(a) * 2.6, 9, deg === 90 ? 2.6 : 2.5]);
  }
  for (const [x, y] of [[8.4, 11.6], [15.6, 11.6], [12, 9.4], [5.4, 9.4], [18.6, 9.4]]) { clumps.push([x!, y!, 12.2, 2.3]); clumps.push([x!, y!, 5.8, 2.3]); }
  b.shape((x, y, z) => y > 6.4 && (ell(x, y, z, cx, cy, 9, 6.6, 2.8, 4) <= 1 || clumps.some(([X, Y, Z, r]) => ell(x, y, z, X, Y, Z, r, r, r) <= 1)) ? A.leaf : undefined);
  if (family === 'grove') b.tint((x, y, z) => clumps.some(([X, Y, Z, r]) => ell(x, y, z, X - 0.6, Y + 0.8, Z + 0.8, r * 0.6, r * 0.6, r * 0.6) <= 1) ? p.body : undefined);
  // Trunk, root flare and two forking limbs into the crown.
  b.box(10, 1, 7, 14, 9, 11, bark);
  b.box(8, 1, 6, 16, 2, 12, bark).box(9, 2, 7, 15, 3, 11, bark);
  b.box(11, 1, 5, 13, 2, 13, bark);
  b.box(8, 6, 8, 10, 8, 10, bark).box(14, 6, 8, 16, 8, 10, bark).box(7, 7, 8, 9, 9, 10, bark).box(15, 7, 8, 17, 9, 10, bark);
  // Acorns peek out of the leaves on the front.
  const nut = family === 'tide' ? p.light : p.gold;
  for (const [x, y] of [[6, 10], [17, 11], [11, 13], [14, 9], [3, 8], [20, 8], [9, 8]] as const) {
    let z = SZ - 1; while (z > 0 && !b.get(x, y, z)) z--;
    if (b.get(x, y, z)) b.set(x, y, z, nut);
  }
  return b.carve('oak-tree', [12, 10, 15]);
}

// Pumpkin: a wide squat ribbed gourd with a dimpled top, a curled stem and one broad leaf.
function pumpkin(family: StyleKey): LibraryMotif {
  const p = CARVE_PALETTES[family], b = new Block();
  foot(b, p.shade);
  const cx = 12, cy = 5.9, cz = 9, ribs = 10;
  const groove = (x: number, z: number) => (1 - Math.cos(ribs * (Math.atan2(z - cz, x - cx) - Math.PI / 2))) / 2;
  const inside = (x: number, y: number, z: number) => {
    const g = groove(x, z) ** 2, h = Math.hypot(x - cx, z - cz);
    const dip = y > cy ? 1.6 * Math.exp(-(h * h) / 5) : 0;
    return ell(x, y + dip, z, cx, cy, cz, 8.6 * (1 - 0.09 * g), 5, 6.6 * (1 - 0.09 * g)) <= 1;
  };
  b.shape((x, y, z) => y > 1 && inside(x, y, z) ? p.body : undefined);
  b.tint((x, y, z) => groove(x, z) > 0.8 ? p.shade : undefined);
  b.tint((x, y, z) => ell(x, y, z, 9, 8, 14, 1.4, 1.6, 2.6) <= 1 && groove(x, z) < 0.5 ? p.light : undefined);
  b.box(10, 1, 7, 14, 2, 11, p.body);
  // The stem rises from the dimple and curls over to the right.
  b.art([
    '.............ddd', // y14
    '............dd.d',
    '...........dd...',
    '...........dd...', // y11
    '...........dd...',
    '...........dd...',
    '...........dd...', // y8
  ], 14, 8, 10, { d: p.dark });
  // A broad leaf lying on the left shoulder.
  b.art(['......lll', '....lllll..', '...lllllll.', '.....lll'], 12, 9, 12, { l: A.leaf });
  return b.carve('pumpkin', [12, 7, 16]);
}

// Apple: a round fruit with a dipped top, short stem, one leaf and a bright highlight.
function apple(family: StyleKey): LibraryMotif {
  const p = CARVE_PALETTES[family], b = new Block();
  foot(b, p.shade);
  const cx = 12, cy = 7.2, cz = 9;
  b.shape((x, y, z) => {
    const h2 = (x - cx) ** 2 + (z - cz) ** 2;
    const dip = y > cy ? 2.4 * Math.exp(-h2 / 4.5) : -0.9 * Math.exp(-h2 / 3);
    const widen = 1 + 0.07 * (y - cy) / 6;
    return y > 1 && ell(x, y + dip, z, cx, cy, cz, 6.3 * widen, 6.1, 5.6 * widen) <= 1 ? p.body : undefined;
  });
  b.box(10, 1, 7, 14, 2, 11, p.body);
  b.tint((x, y, z) => ell(x, y, z, 8.6, 9.6, 13.6, 1.5, 1.9, 2.4) <= 1 ? p.light : undefined);
  b.tint((_x, y) => y < 3.5 ? p.shade : undefined);
  b.art([
    '............dd', // y15
    '............d.',
    '...........dd.',
    '...........dd.', // y12
    '...........dd.',
    '...........dd.', // y10
  ], 15, 8, 10, { d: p.dark });
  b.art([
    '..............ll', // y15
    '.............llll.',
    '..............lll',
  ], 15, 8, 11, { l: A.leaf });
  return b.carve('apple', [12, 8, 15]);
}

// Snowflake: a six-armed crystal with forked side branches, standing upright on a little stalk.
function snowflake(family: StyleKey): LibraryMotif {
  const p = CARVE_PALETTES[family], b = new Block();
  foot(b, p.shade);
  const C = [12, 9.2] as const, L = 6.7, wide = 1.15;
  const seg = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - ax - t * dx, y - ay - t * dy);
  };
  const arms: [number, number, number, number][] = [], twigs: [number, number, number, number][] = [];
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 2 + k * Math.PI / 3, ux = Math.cos(a), uy = Math.sin(a);
    arms.push([C[0], C[1], C[0] + ux * L, C[1] + uy * L]);
    const at = 0.58 * L, px = C[0] + ux * at, py = C[1] + uy * at;
    for (const s of [-1, 1]) twigs.push([px, py, px + Math.cos(a + s * Math.PI / 3) * 2, py + Math.sin(a + s * Math.PI / 3) * 2]);
  }
  // Shapes are judged in an x-stretched frame so the flake uses the envelope's width.
  const near = (x: number, y: number, list: [number, number, number, number][], w: number) => list.some(([ax, ay, bx, by]) => seg(C[0] + (x - C[0]) / wide, y, ax, ay, bx, by) < w);
  const crystal = (x: number, y: number) => y > 2.5 && (Math.hypot((x - C[0]) / wide, y - C[1]) < 2 || near(x, y, arms, 0.9) || near(x, y, twigs, 0.6));
  const ice = p.light;
  b.shape((x, y, z) => z > 8 && z < 10 && crystal(x, y) ? p.body : undefined);
  b.shape((x, y, z) => z > 10 && z < 11 && crystal(x, y) ? ice : undefined);
  // A raised spine down every arm, and a gold heart.
  b.shape((x, y, z) => z > 11 && z < 12 && y > 2.5 && near(x, y, arms, 0.45) ? ice : undefined);
  b.shape((x, y, z) => z > 11 && z < 13 && Math.hypot((x - C[0]) / wide, y - C[1]) < 1.3 ? p.gold : undefined);
  b.box(11, 1, 8, 13, 3, 11, p.shade);
  return b.carve('snowflake', [12, 9, 14]);
}

// Acorn: a smooth egg-shaped nut with a pointed tip under a domed crosshatched cup, a stalk and an oak leaf.
function acorn(family: StyleKey): LibraryMotif {
  const p = CARVE_PALETTES[family], b = new Block();
  foot(b, p.shade);
  const cx = 12, cz = 9, cy = 6.4, rx = 4.4;
  // An egg-round nut, widest just under the cup, closing to a small point on the foot.
  b.shape((x, y, z) => {
    const r = y >= cy ? rx * Math.sqrt(Math.max(0, 1 - ((y - cy) / 3.4) ** 2)) : rx * Math.sqrt(Math.max(0, 1 - ((cy - y) / (cy - 1.2)) ** 2));
    return y > 1.2 && Math.hypot(x - cx, z - cz) <= r ? p.body : undefined;
  });
  b.box(11, 1, 8, 13, 2, 10, p.body);
  b.tint((x, y, z) => ell(x, y, z, 10, 6.4, 12.6, 1.1, 2.2, 1.6) <= 1 ? p.light : undefined);
  const line = family === 'grove' ? p.gold : p.dark;
  const hatch = (x: number, y: number) => (Math.floor(x) + Math.floor(y)) % 3 === 0 || (Math.floor(x) - Math.floor(y) + 30) % 3 === 0;
  b.shape((x, y, z) => y > 8 && ell(x, y, z, cx, 8.4, cz, 5.4, 4.2, 5.4) <= 1 ? (hatch(x, y) ? line : p.shade) : undefined);
  b.shape((x, y, z) => y > 8 && y < 9 && ell(x, 9, z, cx, 9, cz, 5.9, 1, 5.9) <= 1 ? p.shade : undefined);
  b.art(['.............dd', '............dd.', '...........dd..', '...........dd..'], 15, 8, 10, { d: p.dark });
  b.art(['...............ll', '..............llll', '...............ll'], 15, 8, 10, { l: A.leaf });
  return b.carve('acorn', [12, 7, 15]);
}

export const MOTIFS: Record<SkyMotif, (family: StyleKey) => LibraryMotif> = {
  sun, cloud, rainbow, 'oak-tree': oakTree, pumpkin, apple, snowflake, acorn,
};
