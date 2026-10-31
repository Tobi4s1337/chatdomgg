import type { VoxelBlueprint } from '@chatdom/shared';
import type { MotifGeometry } from '../forge-motifs';
import { MAT, type StyleKey } from '../materials';

type Box = VoxelBlueprint['boxes'][number];
type Cell = [number, number, number];

/** The sleeping dragon's frozen envelope, mount and smoke anchor, in build cells (0.125 m). */
export const DRAGON_SIZE: Cell = [24, 16, 18];
export const DRAGON_MOUNT: Cell = [12, 0, 9];
export const DRAGON_EMITTER: Cell = [0, 3, 12];
const [W, H, D] = DRAGON_SIZE;

interface Kit {
  /** The coil's back, two value steps off the kit's roof. */
  back: number;
  /** The belly band where the coil meets the roof, jaw line and claws. */
  belly: number;
  /** Spine plates and the folded wing's membrane. */
  plate: number;
  horn: number;
  lid: number;
  /** The masonry stack and its corbelled lip: grey stone in every kit, so the horns stay the brightest small shape. */
  stack: number;
  lip: number;
}

/** Registered materials only: the back sits two value steps off its kit's roof, never on it. */
const KITS: Record<StyleKey, Kit> = {
  hearth: { back: MAT.brick, belly: MAT.limestone, plate: MAT.terracotta, horn: MAT.limestone, lid: MAT.timber, stack: MAT.stone, lip: MAT.darkStone },
  tide: { back: MAT.darkStone, belly: MAT.cream, plate: MAT.slate, horn: MAT.cream, lid: MAT.timber, stack: MAT.stone, lip: MAT.slate },
  grove: { back: MAT.moss, belly: MAT.cream, plate: MAT.bark, horn: MAT.goldLeaf, lid: MAT.bark, stack: MAT.stone, lip: MAT.darkStone },
};

/**
 * The broad surface a composed Forge finish (copper, ceramic) recolours: the coil and head.
 * Never the roof material, so a finish keyed on `STYLES[style].roof` misses this dragon's body. The belly
 * band, horns, lids, plates, stack and lip keep their kit colours, so a cast dragon keeps its anatomy and
 * its chimney stays masonry.
 */
export const ANVIL_HERO_DRAGON_SURFACE: Readonly<Record<StyleKey, number>> = {
  hearth: KITS.hearth.back, tide: KITS.tide.back, grove: KITS.grove.back,
};

const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;

class Lattice {
  readonly cells = new Uint8Array(W * H * D);
  index(x: number, y: number, z: number) { return x + W * (y + H * z); }
  inside(x: number, y: number, z: number) { return x >= 0 && y >= 0 && z >= 0 && x < W && y < H && z < D; }
  at(x: number, y: number, z: number) { return this.inside(x, y, z) ? this.cells[this.index(x, y, z)]! : 0; }
  set(x: number, y: number, z: number, material: number) {
    if (!this.inside(x, y, z)) return;
    const i = this.index(x, y, z);
    this.cells[i] = material;
  }
  box(x: number, y: number, z: number, X: number, Y: number, Z: number, material: number) {
    for (let k = z; k < Z; k++) for (let j = y; j < Y; j++) for (let i = x; i < X; i++) this.set(i, j, k, material);
  }
  /** Voxelise a faceted ellipsoid in all three dimensions. */
  ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, material: number) {
    for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = (x + .5 - cx) / rx, dy = (y + .5 - cy) / ry, dz = (z + .5 - cz) / rz;
      if (dx * dx + dy * dy + dz * dz <= 1) this.set(x, y, z, material);
    }
  }

  /**
   * A tube swept along a path of [x, y, z, radius] knots (cell-centre space), its radius eased
   * between knots. `squash` scales the radius per axis, so a body can be broader than it is tall.
   */
  tube(knots: readonly (readonly [number, number, number, number])[], material: number, squash: readonly [number, number, number] = [1, 1, 1]) {
    const samples: [number, number, number, number][] = [];
    for (let k = 1; k < knots.length; k++) {
      const a = knots[k - 1]!, b = knots[k]!, n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 4));
      for (let i = 0; i <= n; i++) { const t = i / n, e = t * t * (3 - 2 * t); samples.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * e]); }
    }
    for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      for (const [cx, cy, cz, r] of samples) {
        const dx = (x + .5 - cx) / (r * squash[0]), dy = (y + .5 - cy) / (r * squash[1]), dz = (z + .5 - cz) / (r * squash[2]);
        if (dx * dx + dy * dy + dz * dz <= 1) { this.set(x, y, z, material); break; }
      }
    }
  }
  /** Recolour the cells of one material that satisfy a test. */
  paint(from: number, to: number, test: (x: number, y: number, z: number) => boolean) {
    for (let z = 0; z < D; z++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (this.at(x, y, z) === from && test(x, y, z)) this.set(x, y, z, to);
  }
  /** Does this cell touch air on one of the given sides? */
  open(x: number, y: number, z: number, sides: readonly (readonly [number, number, number])[] = SIDES) {
    return sides.some(([dx, dy, dz]) => !this.at(x + dx, y + dy, z + dz) && this.inside(x + dx, y + dy, z + dz));
  }

  /** Greedy merge into half-open boxes: x runs, then z rows, then y slabs. No overlaps, so order is free. */
  boxes(): Box[] {
    const used = new Uint8Array(this.cells.length), out: Box[] = [];
    const free = (x: number, y: number, z: number, m: number) => this.inside(x, y, z) && !used[this.index(x, y, z)] && this.cells[this.index(x, y, z)] === m;
    for (let y = 0; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      const m = this.at(x, y, z);
      if (!m || used[this.index(x, y, z)]) continue;
      let X = x + 1; while (free(X, y, z, m)) X++;
      const row = (k: number, j: number) => { for (let i = x; i < X; i++) if (!free(i, j, k, m)) return false; return true; };
      let Z = z + 1; while (Z < D && row(Z, y)) Z++;
      const slab = (j: number) => { for (let k = z; k < Z; k++) if (!row(k, j)) return false; return true; };
      let Y = y + 1; while (Y < H && slab(Y)) Y++;
      for (let k = z; k < Z; k++) for (let j = y; j < Y; j++) for (let i = x; i < X; i++) used[this.index(i, j, k)] = 1;
      out.push({ from: [x, y, z], to: [X, Y, Z], material: m });
    }
    return out;
  }
}


type Knot = readonly [number, number, number, number];

/**
 * The Forge's sleeping dragon chimney, curled like a cat in front of its own crooked stack.
 *
 * At dusk the street sees it against the sky, so it is drawn as a skyline first: at the left a
 * long wedge of a head lies low on two forepaws, its muzzle turned toward the street and the
 * smoke escaping its nose; horns sweep back over the dip of the neck; the shoulder rises and the
 * back runs right under five spine plates that shrink toward the haunch; the far wing folds flat
 * along the back as one triangle; the tail wraps the front of the roof, lifting off it before its
 * spade curls up. The grey stack, the tallest shape, stands behind. Air shows under the chin,
 * between the paws and inside the tail's loop. A carved house part on the build lattice, never a
 * creature. Deterministic per kit; every call returns fresh boxes.
 */
export function createAnvilHeroDragon(style: StyleKey): MotifGeometry {
  const kit = KITS[style];
  if (!kit) throw new Error(`Unknown style kit ${String(style)}.`);
  const g = new Lattice();

  // The body lies across the roof in front of the stack: the shoulder hump behind the head, a
  // long back dipping a little, and the haunch rising on the right before it turns forward.
  const body: Knot[] = [
    [10.4, 4.0, 7.6, 3.0],
    [13.0, 3.4, 7.6, 2.8],
    [15.5, 3.2, 8.0, 2.7],
    [18.4, 3.5, 8.8, 3.0],
    [20.2, 3.0, 11.0, 2.6],
  ];
  g.tube(body, kit.back, [1, 1.05, 1.05]);
  // Its weight settles it flat onto the roof: wherever the body stands, it reaches down to rest.
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) if (g.at(x, 2, z) === kit.back && !g.at(x, 0, z)) g.box(x, 0, z, x + 1, 2, z + 1, kit.back);
  // The tail leaves the haunch, runs low along the front, lifts off the roof and curls up,
  // tapering all the way: air shows inside its loop.
  const tail: Knot[] = [
    [20.2, 1.8, 13.4, 1.9],
    [18.2, 1.3, 15.5, 1.5],
    [15.8, 1.0, 16.3, 1.15],
    [13.6, 1.6, 16.3, .95],
    [12.2, 2.8, 15.8, .8],
  ];
  g.tube(tail, kit.back);
  // A small spade at the tip.
  g.box(11, 3, 15, 13, 4, 17, kit.plate);
  g.box(11, 4, 15, 12, 5, 16, kit.plate);

  // The crooked stack rises out of the coil: a coursed base, an upper flue leaning one cell toward
  // the haunch, a corbelled course and a dark lip. Quiet grey masonry in every kit, laid after the
  // body so the coil wraps its foot.
  g.box(13, 0, 3, 17, 7, 8, kit.stack);
  g.box(14, 7, 3, 18, 10, 8, kit.stack);
  g.box(13, 10, 2, 19, 11, 9, kit.stack);
  g.box(13, 11, 2, 19, 12, 9, kit.lip);

  // The neck dips from the shoulder to the back of the skull, below both.
  g.tube([[11.2, 3.8, 9.0, 2.2], [9.6, 3.6, 11.4, 2.1]], kit.back);

  // Two forepaws reach from the chest toward the street's left under the head; the chin rests on
  // their inner edges, with air between them.
  for (const z of [10, 14]) {
    g.tube([[9.0, 1.3, z, 1.45], [1.6, 1.0, z, 1.2]], kit.back, [1, .9, 1]);
    // Claws: light knuckles at the end of each paw.
    g.box(0, 0, z - 1, 1, 1, z + 1, kit.belly);
  }

  // The head is the largest single shape, lying in profile to the street: a skull with heavy
  // cheeks, a two-cell step down at the closed eyes, then a long, narrower muzzle to the nose.
  // Slices along x: [half-width about z 12, top row (exclusive)], all resting on the paws at row 2.
  const HEAD_Z = 12;
  const head: Record<number, readonly [number, number]> = { 1: [2, 5], 2: [2, 5], 3: [2, 5], 4: [2, 6], 5: [2, 6], 6: [3, 8], 7: [3, 8], 8: [3, 8], 9: [3, 7] };
  for (const [xText, [half, top]] of Object.entries(head)) {
    const x = Number(xText), z0 = HEAD_Z - half, z1 = HEAD_Z + half;
    g.box(x, 2, z0, x + 1, top, z1, kit.back);
    // The outer top cells fall away so the crown and the snout are rounded wedges, not crates.
    g.set(x, top - 1, z0, MAT.air); g.set(x, top - 1, z1 - 1, MAT.air);
    // The jaw: the light underside the chin rests on.
    g.box(x, 2, z0, x + 1, 3, z1, kit.belly);
    // A dark mouth line parts the jaw from the muzzle along each side.
    if (x <= 5) { g.set(x, 3, z0, kit.lid); g.set(x, 3, z1 - 1, kit.lid); }
  }
  // The nose rises a little at its tip; one nostril is dark, the other the chimney's breath.
  g.box(1, 5, 11, 2, 6, 13, kit.back);
  g.set(1, 3, HEAD_Z - 1, kit.lid);
  // Heavy cheeks either side of the jaw hinge.
  g.box(7, 2, HEAD_Z - 4, 9, 4, HEAD_Z - 3, kit.back);
  g.box(7, 2, HEAD_Z + 3, 9, 4, HEAD_Z + 4, kit.back);
  // Closed lids: a long dark slit on each side of the skull behind the step, under a brow that
  // juts out over it.
  for (const [z, out] of [[HEAD_Z - 3, -1], [HEAD_Z + 2, 1]] as const) {
    g.box(6, 6, z, 8, 7, z + 1, kit.lid);
    g.box(5, 7, z + out, 8, 8, z + out + 1, kit.back);
  }

  // Horns sweep back from the crown over the dip of the neck, short and low so they never cross the
  // stack behind them: two cells at the root, ending a cell above the skull.
  for (const side of [-1, 1]) {
    const z = (d: number) => HEAD_Z + side * d;
    g.tube([[7.4, 7.4, z(1.8), .95], [8.9, 8.3, z(2.4), .8], [10.3, 8.9, z(2.8), .62]], kit.horn);
  }

  // The far wing, folded flat along the back: a triangle peaking at 9 over the shoulder and
  // running down to the haunch, with a heavy leading edge and a claw at its peak. It lies against
  // the body, never up like a fin.
  const wing: Record<number, readonly [number, number]> = { 5: [18, 23], 6: [18, 23], 7: [18, 22], 8: [19, 22], 9: [19, 21] };
  for (const [yText, [x0, x1]] of Object.entries(wing)) {
    const y = Number(yText);
    for (let x = x0; x < x1; x++) for (const z of [6, 7]) if (!g.at(x, y, z)) g.set(x, y, z, kit.plate);
    g.box(x0, y, 6, x0 + 1, y + 1, 8, kit.back);
  }
  g.set(19, 10, 7, kit.horn);
  // Each kit's native wing edge: hearth's membrane is scalloped between its fingers, tide's is one
  // long sweep, grove's carries a goldLeaf vein from the claw down to the haunch.
  if (style === 'hearth') for (const x of [20, 22]) for (const z of [6, 7]) if (g.at(x, 5, z) === kit.plate) g.set(x, 5, z, MAT.air);
  if (style === 'grove') for (let i = 0; i <= 4; i++) { const x = 19 + i, y = 9 - i; if (g.at(x, y, 7) === kit.plate) g.set(x, y, 7, kit.horn); }

  // Five spine plates down the back toward the haunch, shrinking as they go: a serrated edge
  // broadside to the street, raked toward the tail.
  const plates: [number, number, number][] = [[11, 8, 3], [13, 9, 3], [17, 9, 2], [19, 10, 2], [20, 12, 1]];
  for (const [x, z, h] of plates) {
    let top = H - 1;
    while (top > 0 && g.at(x, top, z) !== kit.back) top--;
    // Each kit cuts its own plates: tide's are raked triangles, back edge upright and front edge
    // sloping toward the head; hearth's stay broad to the tip; grove's split at the top like a leaf.
    for (let k = 0; k < h; k++) {
      const from = style === 'hearth' ? x - Math.max(1, h - 1 - k) : style === 'grove' ? x - Math.max(h - 1, 1) : x - (h - 1 - k);
      g.box(from, top + 1 + k, z, x + 1, top + 2 + k, z + 1, kit.plate);
      if (style === 'grove' && k === h - 1 && x - from >= 2) g.set(x - 1, top + 1 + k, z, MAT.air);
    }
  }

  // The light belly band where the coil meets the roof.
  g.paint(kit.back, kit.belly, (x, y, z) => y <= 1 && z >= 7 && x > 8 && g.open(x, y, z, [[0, 0, 1], [1, 0, 0], [-1, 0, 0]]));

  // The flue stays open to its mouth, and the nose breathes through a real nostril.
  g.box(14, 3, 4, 16, 7, 7, MAT.air);
  g.box(15, 7, 4, 17, H, 7, MAT.air);
  const [ex, ey, ez] = DRAGON_EMITTER;
  for (let y = ey; y < H; y++) g.set(ex, y, ez, MAT.air);
  g.set(ex + 1, ey, ez, MAT.air);
  g.set(ex, ey, ez, MAT.air);
  return { size: [...DRAGON_SIZE], boxes: g.boxes(), mount: [...DRAGON_MOUNT], emitter: [...DRAGON_EMITTER] };
}
