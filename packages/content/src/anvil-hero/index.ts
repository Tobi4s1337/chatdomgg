import type { VoxelBlueprint } from '@chatdom/shared';
import type { MotifGeometry } from '../forge-motifs';
import { MAT, type StyleKey } from '../materials';

type Box = VoxelBlueprint['boxes'][number];
type Cell = [number, number, number];

/** The sleeping dragon's frozen envelope, mount and smoke anchor, in build cells (0.125 m). */
export const DRAGON_SIZE: Cell = [24, 16, 18];
export const DRAGON_MOUNT: Cell = [12, 0, 9];
export const DRAGON_EMITTER: Cell = [7, 3, 17];
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
  const blob = (x: number, y: number, z: number, rx: number, ry: number, rz: number, m = kit.back) => g.ellipsoid(x, y, z, rx, ry, rz, m);

  // The small, working stack sits behind the animal, below the horns and wing.
  g.box(12, 0, 4, 17, 6, 9, kit.stack);
  g.box(13, 6, 4, 17, 8, 8, kit.stack);
  g.box(12, 8, 3, 18, 9, 9, kit.lip);

  // A plump haunch wraps the chimney, with a rounded shoulder joining the skull.
  blob(13, 3, 4, 5, 3, 3.7);
  blob(18, 3.5, 7, 5, 3.5, 4.4);
  blob(19, 2.6, 11, 4, 2.6, 3.5);
  blob(11, 3, 9, 4.5, 3, 3.5);
  // The head is the largest single shape: low cheeks and a long, forward snout.
  blob(7, 5, 11.5, 4.5, 3.7, 4.2);
  blob(7, 2.6, 14.8, 3.5, 1.7, 2.8, kit.belly);
  blob(7, 3.5, 15, 3.3, 1.5, 2.5);

  // Paired paws stretch toward the street, under the wide jaw. Each joins a shoulder.
  blob(4, 1.2, 12.8, 2.1, 1.2, 3.2);
  blob(10.3, 1.2, 12.8, 2.1, 1.2, 3.2);
  blob(4.5, 1, 15.3, 2.2, 1, 2.5, kit.horn);
  blob(9.5, 1, 15.3, 2.2, 1, 2.5, kit.horn);

  // Closed, horizontal creases on the front-facing cheeks, shaded by their brows.
  g.box(3, 5, 14, 6, 6, 15, kit.lid);
  g.box(8, 5, 14, 11, 6, 15, kit.lid);
  // Heavy horn roots grow out of the skull; their tips sweep outward and back.
  g.box(3, 7, 10, 6, 9, 12, kit.horn);
  g.box(2, 8, 8, 5, 10, 11, kit.horn);
  g.box(1, 9, 7, 4, 11, 9, kit.horn);
  g.box(0, 10, 6, 2, 11, 8, kit.horn);
  g.box(8, 7, 10, 11, 9, 12, kit.horn);
  g.box(9, 8, 8, 12, 10, 11, kit.horn);
  g.box(10, 9, 7, 13, 11, 9, kit.horn);
  g.box(12, 10, 6, 14, 11, 8, kit.horn);
  // Small sideways ears, kept below the horns.
  g.box(1, 6, 11, 4, 7, 13, kit.back);
  g.box(10, 6, 11, 13, 7, 13, kit.back);

  // A slender tail curves around the haunch, stopping short of the forward paws.
  blob(21, 1.3, 11, 2.5, 1.3, 3);
  blob(21, 1, 14, 2, 1, 2);
  blob(18, 1, 15, 3, 1, 1.5);
  blob(15, 1, 15.5, 2, 1, 1);
  g.box(12, 0, 15, 15, 1, 16, kit.plate);

  // A folded bat wing stands along the outside of the haunch, clear of the flue.
  // Its dark web and three pale fingers are readable anatomical shapes, not roof courses.
  type Point = readonly [number, number, number];
  const shoulder: Point = [17, 5, 8], knuckle: Point = [20, 11, 6];
  const edge: Point[] = [knuckle, [23, 9, 10], [21, 7, 10], [23, 7, 14], [20, 5, 12], [21, 4, 15], [17, 3, 12]];
  const triangle = (a: Point, b: Point, c: Point) => {
    const u = b.map((n, i) => n - a[i]!), v = c.map((n, i) => n - a[i]!);
    const normal = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const axis = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
    for (let i = 0; i <= 32; i++) for (let j = 0; j <= 32 - i; j++) {
      const p = a.map((n, k) => Math.floor(n + u[k]! * i / 32 + v[k]! * j / 32)) as Cell;
      g.set(...p, kit.lid);
      // Two cells through the dominant normal keep the diagonal membrane face-connected.
      p[axis] = p[axis]! - 1; g.set(...p, kit.lid);
    }
  };
  for (let i = 1; i < edge.length; i++) triangle(shoulder, edge[i - 1]!, edge[i]!);
  const bone = (a: Point, b: Point) => {
    for (let t = 0; t <= 32; t++) {
      const p = a.map((n, i) => n + (b[i]! - n) * t / 32);
      g.ellipsoid(p[0]!, p[1]!, p[2]!, .8, .8, .8, kit.horn);
    }
  };
  bone(shoulder, knuckle);
  for (const tip of [edge[1]!, edge[3]!, edge[5]!]) bone(knuckle, tip);
  // Three broad, separate dorsal points follow the back and tail.
  g.box(11, 6, 3, 13, 8, 5, kit.horn);
  g.box(12, 8, 3, 13, 9, 4, kit.horn);
  g.box(18, 6, 4, 20, 8, 6, kit.horn);
  g.box(19, 8, 4, 20, 9, 5, kit.horn);
  g.box(21, 4, 11, 23, 6, 13, kit.horn);
  g.box(22, 6, 11, 23, 7, 12, kit.horn);
  g.box(19, 2, 14, 21, 4, 15, kit.horn);

  // Smoke emerges directly ahead of the snout, with a real nostril behind the anchor.
  g.box(14, 5, 5, 16, 9, 7, MAT.air);
  g.set(7, 3, 17, MAT.air);
  g.set(7, 3, 16, MAT.air);
  return { size: [...DRAGON_SIZE], boxes: g.boxes(), mount: [...DRAGON_MOUNT], emitter: [...DRAGON_EMITTER] };
}
