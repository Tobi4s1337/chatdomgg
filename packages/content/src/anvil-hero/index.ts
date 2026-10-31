import type { VoxelBlueprint } from '@chatdom/shared';
import type { MotifGeometry } from '../forge-motifs';
import { MAT, type StyleKey } from '../materials';

type Box = VoxelBlueprint['boxes'][number];
type Cell = [number, number, number];

/** The sleeping dragon's frozen envelope, mount and smoke anchor, in build cells (0.125 m). */
export const DRAGON_SIZE: Cell = [24, 16, 18];
export const DRAGON_MOUNT: Cell = [12, 0, 9];
export const DRAGON_EMITTER: Cell = [0, 2, 9];
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

/** A node on the coil's centreline, seen from above: position, ridge height and half-width, in cells. */
type Node = [x: number, z: number, top: number, radius: number];

/**
 * The coil, from the shoulder beside the stack, round the far side to the haunch, then the tail
 * wrapping the near side back toward the sleeping head. One continuous centreline, one even band.
 */
const COIL: Node[] = [
  [12.0, 4.0, 6.0, 1.8],
  [16.0, 3.0, 6.0, 2.0],
  [20.0, 4.0, 6.0, 2.0],
  [21.0, 8.0, 5.5, 2.1],
  [19.8, 12.2, 4.5, 1.8],
  [17.0, 14.5, 3.0, 1.3],
  [13.0, 16.0, 2.0, .8],
  [9.0, 16.0, 1.2, .65],
];
/** The lowered neck extends forward from the shoulder. */
const NECK: Node[] = [[12.0, 4.0, 4.0, 1.7], [9.0, 6.0, 3.5, 1.5], [7.0, 9.0, 3.0, 1.5]];
/** Separate forelegs reach forward beside the muzzle, leaving an open crook below the chin. */
const FAR_ARM: Node[] = [[11.0, 4.5, 2.5, 1.0], [7.0, 6.0, 2.0, .8], [3.0, 6.5, 2.0, .8]];
const NEAR_ARM: Node[] = [[16.0, 13.0, 2.5, 1.0], [10.0, 13.0, 2.0, .8], [3.0, 12.5, 2.0, .8]];

class Lattice {
  readonly cells = new Uint8Array(W * H * D);
  /** Cells that belong to the coil and limbs, so the belly band can be painted on them only. */
  readonly flesh = new Uint8Array(W * H * D);
  index(x: number, y: number, z: number) { return x + W * (y + H * z); }
  inside(x: number, y: number, z: number) { return x >= 0 && y >= 0 && z >= 0 && x < W && y < H && z < D; }
  at(x: number, y: number, z: number) { return this.inside(x, y, z) ? this.cells[this.index(x, y, z)]! : 0; }
  set(x: number, y: number, z: number, material: number, flesh = false) {
    if (!this.inside(x, y, z)) return;
    const i = this.index(x, y, z);
    this.cells[i] = material;
    this.flesh[i] = material && flesh ? 1 : 0;
  }
  box(x: number, y: number, z: number, X: number, Y: number, Z: number, material: number) {
    for (let k = z; k < Z; k++) for (let j = y; j < Y; j++) for (let i = x; i < X; i++) this.set(i, j, k, material);
  }
  /** Highest solid cell in a column, or -1. */
  crest(x: number, z: number) { let y = H - 1; while (y >= 0 && !this.at(x, y, z)) y--; return y; }

  /**
   * A flat-backed tube along the nodes with a one-cell chamfer to upright flanks. Sections are
   * octagons, so straight runs keep big planes and turns cut clean 45° facets instead of stair noise.
   * Sleeping bodies settle: the flat underside meets the roof along its whole length.
   */
  tube(nodes: Node[], material: number) {
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      const px = x + .5, pz = z + .5;
      let height = 0;
      for (let s = 0; s + 1 < nodes.length; s++) {
        const [ax, az, at, ar] = nodes[s]!, [bx, bz, bt, br] = nodes[s + 1]!;
        const dx = bx - ax, dz = bz - az, length2 = dx * dx + dz * dz;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / length2));
        const ox = Math.abs(px - (ax + dx * t)), oz = Math.abs(pz - (az + dz * t));
        const d = Math.max(ox, oz, (ox + oz) * Math.SQRT1_2);
        const top = at + (bt - at) * t, radius = ar + (br - ar) * t;
        if (d > radius) continue;
        const steps = top < 2.5 || d <= radius - 1 ? 0 : 1;
        height = Math.max(height, top - steps);
      }
      for (let y = 0; y + .5 < height && y < H; y++) if (!this.at(x, y, z)) this.set(x, y, z, material, true);
    }
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

/**
 * The Forge's sleeping dragon chimney, curled around its own crooked stack: chin on
 * two paws, wing folded along the flank, tail wrapping the near side, smoke escaping
 * the nose. A carved house part on the build lattice, never a creature. Deterministic per kit.
 */
export function createAnvilHeroDragon(style: StyleKey): MotifGeometry {
  const kit = KITS[style];
  if (!kit) throw new Error(`Unknown style kit ${String(style)}.`);
  const g = new Lattice();

  // The crooked stack: a lower shaft holding the mount, a corbel course, an upper shaft
  // stepped one cell toward the haunch, and a lipped crown with a dark open mouth.
  g.box(12, 0, 7, 16, 8, 11, kit.stack);
  g.box(11, 8, 6, 17, 9, 12, kit.lip);
  g.box(13, 9, 7, 17, 12, 11, kit.stack);
  g.box(12, 12, 6, 18, 14, 12, kit.lip);
  g.box(14, 9, 8, 16, 14, 10, MAT.air);
  g.box(13, 13, 7, 17, 14, 11, MAT.air);

  // The body: one band round the stack, the low neck and the resting forearms.
  g.tube(COIL, kit.back);
  g.tube(NECK, kit.back);
  g.tube(FAR_ARM, kit.back);
  g.tube(NEAR_ARM, kit.back);
  // The neck and coil meet the chimney shaft under its near corner.
  g.box(9, 0, 6, 13, 3, 8, kit.back);

  // A large, chamfered skull and long low muzzle carry the sleeping expression.
  // The jaw actually meets both forepaws; the open space between them remains visible.
  g.box(1, 2, 7, 5, 5, 12, kit.back);
  g.box(4, 2, 5, 10, 7, 13, kit.back);
  g.box(5, 7, 6, 10, 8, 12, kit.back);
  g.box(6, 8, 7, 9, 9, 11, kit.back);
  for (let x = 1; x < 5; x++) for (const z of [7, 11]) g.set(x, 2, z, kit.belly);
  // Heavy brows and long, closed eyes give the head its sleeping pose from both sides.
  for (const z of [5, 12]) {
    g.box(5, 5, z, 8, 6, z + 1, kit.lid);
    g.box(5, 6, z, 9, 7, z + 1, kit.back);
  }
  // Two individually separated paws rest beside the muzzle and support the jaw.
  for (const z of [5, 11]) {
    g.box(2, 0, z, 6, 2, z + 2, kit.back);
    g.set(2, 0, z, kit.horn);
    g.set(2, 0, z + 1, kit.horn);
  }
  // Back-swept horns rise above the skull on either side, stopping short of
  // the chimney. Their bold silhouette stays legible at the size of a roof part.
  for (const z of [5, 12]) {
    const out = z < 9 ? z - 1 : z + 1;
    g.box(7, 7, z, 9, 9, z + 1, kit.horn);
    g.box(8, 8, out, 10, 10, out + 1, kit.horn);
    g.box(9, 9, out, 11, 11, out + 1, kit.horn);
    g.box(10, 10, out, 12, 12, out + 1, kit.horn);
  }

  // The wings lie folded low along the haunch. Their swept triangular outlines
  // support the larger head and horns instead of rising like walls around it.
  const wingOutline: [number, number][] = [
    [13, 4], [14, 5], [15, 6], [16, 7], [17, 8], [18, 8],
    [19, 7], [20, 6], [21, 5], [22, 4],
  ];
  for (const [x, top] of wingOutline) {
    for (let y = 2; y < top; y++) {
      const spread = Math.max(0, 2 - Math.floor((y - 2) / 2));
      for (let z = 14 - spread; z <= 14 + spread; z++) g.set(x, y, z, y === top - 1 ? kit.back : kit.plate);
      const farTop = Math.max(3, top - 1);
      const farSpread = Math.max(0, spread - 1);
      if (y < farTop) for (let z = 3 - farSpread; z <= 3 + farSpread; z++) g.set(x, y, z, y === farTop - 1 ? kit.back : kit.plate);
    }
  }

  // Five spine plates shrinking toward the tail, sawteeth standing on the ridge where they fall.
  // Each runs along the coil there; tide's lean back toward the tail, grove's split like leaves.
  const plates: [x: number, z: number, height: number, alongZ: boolean][] = [[12, 4, 2, false], [16, 3, 2, false], [20, 5, 2, true], [21, 9, 1, true], [19, 12, 1, true]];
  plates.forEach(([x, z, height, alongZ], i) => {
    const base = g.crest(x, z) + 1, step = (n: number): [number, number] => alongZ ? [x, z + n] : [x + n, z];
    const lean = style === 'tide' ? 1 : 0;
    for (const n of i < 3 ? [-1, 0, 1] : [0]) { const [px, pz] = step(n); g.set(px, base, pz, kit.plate); }
    if (height > 1) { const [px, pz] = step(lean); g.set(px, base + 1, pz, kit.plate); }
    if (style === 'grove' && i < 3) { const [px, pz] = step(0); g.set(px, base, pz, kit.horn); }
  });

  // A tapered spade at the end of the coil, kept low behind the forepaws.
  g.box(7, 0, 15, 10, 1, 17, kit.back);
  g.box(6, 0, 16, 9, 1, 17, kit.back);
  g.set(7, 1, 16, kit.plate);

  // The light belly band where the coil and limbs meet the roof, and the claws. The thin tail
  // stays one colour, so it reads as a tail and never as a kerb.
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const i = g.index(x, 0, z);
    if (!g.flesh[i] || g.crest(x, z) < 2) continue;
    if (!g.at(x - 1, 0, z) || !g.at(x + 1, 0, z) || !g.at(x, 0, z - 1) || !g.at(x, 0, z + 1)) g.cells[i] = kit.belly;
  }
  for (let z = 6; z < 13; z++) if (g.flesh[g.index(2, 0, z)]) g.set(2, 0, z, kit.belly);

  // The flue opens out of the nose: the anchor and the nostril behind it are air.
  g.set(DRAGON_EMITTER[0], DRAGON_EMITTER[1], DRAGON_EMITTER[2], MAT.air);
  g.set(1, 2, 9, MAT.air);
  g.set(2, 2, 9, MAT.air);

  return { size: [...DRAGON_SIZE], boxes: g.boxes(), mount: [...DRAGON_MOUNT], emitter: [...DRAGON_EMITTER] };
}
