import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT, MATERIALS, STYLES, type StyleKey } from '../materials';

type Box = VoxelBlueprint['boxes'][number];

/**
 * One landmark treatment per style kit. Structure resolves through the kit's own wall, roof, trim and stone;
 * the rest are the few registered accents a landmark may carry. Hearth is warm limestone over a grey footing,
 * plaster and tile; Tide is grey stone on a dark base under cream render and slate; Grove is dark stone, moss
 * and plaster under thatch.
 */
export interface LandmarkKit {
  readonly style: StyleKey;
  readonly wall: number;
  readonly roof: number;
  readonly trim: number;
  readonly stone: number;
  /** The heavy footing and the battered plinth. */
  readonly base: number;
  /** String courses, door case, quoins and voussoirs. */
  readonly band: number;
  /** Rope and lashing. */
  readonly cord: number;
  /** Ironwork: strap hinges, studs, the anchor, lantern cages. */
  readonly iron: number;
  /** Bright metal: finial, brazier bowl, door ring, lantern caps. */
  readonly metal: number;
  /** The second boulder colour at the foot. */
  readonly rock: number;
  /** Field and charge used when the recipe supplies no colour target. */
  readonly field: number;
  readonly charge: number;
}

export const LANDMARK_KITS: Readonly<Record<StyleKey, LandmarkKit>> = {
  hearth: {
    style: 'hearth', ...pick('hearth'), base: MAT.stone, band: MAT.cream, cord: MAT.thatch, iron: MAT.darkStone,
    metal: MAT.brass, rock: MAT.stone, field: MAT.cloth, charge: MAT.cream,
  },
  tide: {
    style: 'tide', ...pick('tide'), base: MAT.darkStone, band: MAT.cream, cord: MAT.thatch, iron: MAT.darkStone,
    metal: MAT.brass, rock: MAT.darkStone, field: MAT.slate, charge: MAT.cream,
  },
  grove: {
    style: 'grove', ...pick('grove'), base: MAT.darkStone, band: MAT.limestone, cord: MAT.thatch, iron: MAT.darkStone,
    metal: MAT.goldLeaf, rock: MAT.stone, field: MAT.fabricGreen, charge: MAT.cream,
  },
};

function pick(style: StyleKey) {
  const { wall, roof, trim, stone } = STYLES[style];
  return { wall, roof, trim, stone };
}

/** The registered materials a colour target may snap to: dyed cloth, never structure. */
export const CLOTH_SWATCHES = [
  MAT.cloth, MAT.fabricRed, MAT.fabricOrange, MAT.fabricGold, MAT.fabricGreen, MAT.fabricBlue, MAT.fabricViolet,
  MAT.cream, MAT.slate,
] as const;

/** Every material a landmark of this kit may use: its structure, its accents, the cloth swatches and nature. */
export function landmarkPalette(style: StyleKey): ReadonlySet<number> {
  const kit = LANDMARK_KITS[style];
  return new Set([
    MAT.air, MAT.glass, kit.wall, kit.roof, kit.trim, kit.stone, kit.base, kit.band, kit.cord, kit.iron, kit.metal,
    kit.rock, kit.field, kit.charge, MAT.bark, MAT.moss, MAT.leaf, MAT.earth, ...CLOTH_SWATCHES,
  ]);
}

const rgb = (hex: string): readonly [number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * Snaps a `#rrggbb` colour target to the nearest registered cloth swatch (a weighted RGB distance), so a
 * channel's colours arrive as kit materials rather than authored literals. Returns the material id.
 */
export function snapToCloth(target: string): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(target)) throw new Error(`Colour target ${target} is not #rrggbb.`);
  const [r, g, b] = rgb(target);
  let best: number = CLOTH_SWATCHES[0], bestDistance = Infinity;
  for (const id of CLOTH_SWATCHES) {
    const colour = MATERIALS.materials.find(m => m.id === id)!.colour;
    const [R, G, B] = rgb(colour);
    const mean = (r + R) / 2;
    const distance = (2 + mean / 256) * (r - R) ** 2 + 4 * (g - G) ** 2 + (2 + (255 - mean) / 256) * (b - B) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = id; }
  }
  return best;
}

/** Ordered half-open boxes: later boxes overwrite earlier ones and material zero carves. */
export class Boxes {
  readonly list: Box[] = [];
  add(x: number, y: number, z: number, X: number, Y: number, Z: number, material: number): void {
    if (x >= X || y >= Y || z >= Z) return;
    this.list.push({ from: [x, y, z], to: [X, Y, Z], material });
  }
  /**
   * A chamfered square slab centred on (cx, cz): half width `half`, corners cut on the diagonal by `chamfer`
   * cells in one-cell steps. The octagon every round thing in the tower is built from.
   */
  octagon(cx: number, cz: number, half: number, chamfer: number, y: number, Y: number, material: number): void {
    const c = Math.max(0, Math.min(chamfer, half - 1));
    this.add(cx - half, y, cz - half + c, cx + half, Y, cz + half - c, material);
    for (let i = 0; i < c; i++) {
      const inset = c - i;
      this.add(cx - half + inset, y, cz - half + i, cx + half - inset, Y, cz - half + i + 1, material);
      this.add(cx - half + inset, y, cz + half - 1 - i, cx + half - inset, Y, cz + half - i, material);
    }
  }
}

/** An integer hash of a lattice point into [0, 1): the hand's variation, never global randomness. */
export function hash(x: number, y: number, z: number, seed: number): number {
  let h = (Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f) ^ Math.imul(seed | 0, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
