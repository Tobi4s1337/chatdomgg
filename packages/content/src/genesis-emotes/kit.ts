import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '../materials';

/** The three style families a Genesis recipe can name. */
export type EmoteArtStyle = 'hearth' | 'tide' | 'grove';
export type LandscapeCharacter = 'coastal-harbour' | 'river-valley' | 'mountain-pass';
type Box = VoxelBlueprint['boxes'][number];

/**
 * What the monument, the window frame and the vane mast are built from in one style family. Masonry comes from
 * the frozen style kit; the rest are registered accents. Nothing here is a channel colour.
 */
export interface EmoteArtKit {
  readonly style: EmoteArtStyle;
  /** The die of the pedestal and the window surround. */
  readonly stone: number;
  /** Steps, cornice and hood mould: the courses that catch light. */
  readonly moulding: number;
  /** The bottom course that meets the paving, and the panel recess. */
  readonly footing: number;
  /** Lantern posts. */
  readonly post: number;
}

export const EMOTE_ART_KITS: Readonly<Record<EmoteArtStyle, EmoteArtKit>> = {
  hearth: { style: 'hearth', stone: STYLES.hearth.stone, moulding: MAT.cream, footing: MAT.stone, post: STYLES.hearth.trim },
  tide: { style: 'tide', stone: STYLES.tide.stone, moulding: MAT.limestone, footing: MAT.darkStone, post: MAT.darkStone },
  grove: { style: 'grove', stone: STYLES.grove.stone, moulding: MAT.limestone, footing: MAT.darkStone, post: STYLES.grove.trim },
};

/** Lead came and the iron of glazing bars: the darkest registered solid. */
export const CAME = MAT.hairBlack;

/**
 * Painted stone. A statue keeps the emote's colours, but as pigment on carved stone: earths, muted dyes, skin and
 * hair tones, gilding. The clear festival dyes are left to glass, so a statue never reads as moulded plastic.
 */
export const STATUE_PIGMENTS: readonly number[] = [
  MAT.limestone, MAT.stone, MAT.darkStone, MAT.cream, MAT.plaster, MAT.slate, MAT.terracotta, MAT.brick, MAT.moss, MAT.leaf, MAT.bark,
  MAT.goldLeaf, MAT.brass, MAT.petal, MAT.blueFlower,
  MAT.fabricMutedRed, MAT.fabricMutedOrange, MAT.fabricMutedGold, MAT.fabricMutedGreen, MAT.fabricMutedBlue, MAT.fabricMutedViolet,
  MAT.skin1, MAT.skin2, MAT.skin3, MAT.skin4, MAT.skin5, MAT.skin6, MAT.skin7, MAT.skin8,
  MAT.hairBlack, MAT.hairBrown, MAT.hairChestnut, MAT.hairGold, MAT.hairCopper, MAT.hairSilver,
];

/**
 * Pot-metal glass: the clear dyes and the cool muted ones (brown-golds and ochres stay out: glass is never mud),
 * pale cream and straw glass for whites, gold, rose, flower blue, two greens and a few warm flesh tints. The emote's own near-black outline snaps to came, so its drawing becomes the leading.
 */
export const GLASS_DYES: readonly number[] = [
  MAT.fabricRed, MAT.fabricOrange, MAT.fabricGold, MAT.fabricGreen, MAT.fabricBlue, MAT.fabricViolet,
  MAT.fabricMutedRed, MAT.fabricMutedGreen, MAT.fabricMutedBlue, MAT.fabricMutedViolet,
  MAT.cream, MAT.hairGold, MAT.goldLeaf, MAT.petal, MAT.blueFlower, MAT.leaf, MAT.moss, MAT.skin1, MAT.skin2, MAT.skin3, CAME,
];

/** A vane is cut from sheet metal and gilded: light tones take gold leaf, mid tones brass, darks copper and iron. */
export const VANE_METALS: readonly number[] = [MAT.goldLeaf, MAT.brass, MAT.forgeCopper, CAME];

/** A light source a host wakes at dusk: a build cell inside the lantern's glass, in the piece's local cells. */
export interface EmoteArtLantern {
  readonly id: string;
  readonly position: readonly [number, number, number];
}

/** Ordered half-open boxes: later boxes overwrite earlier ones and material zero carves. */
export class Sculpt {
  readonly list: Box[] = [];
  add(x: number, y: number, z: number, X: number, Y: number, Z: number, material: number): void {
    if (x >= X || y >= Y || z >= Z) return;
    this.list.push({ from: [x, y, z], to: [X, Y, Z], material });
  }
  /** One cell. */
  cell(x: number, y: number, z: number, material: number): void {
    this.add(x, y, z, x + 1, y + 1, z + 1, material);
  }
  /** Every box of another list, moved by an offset. */
  place(boxes: readonly Box[], dx: number, dy: number, dz: number): void {
    for (const box of boxes) this.add(box.from[0] + dx, box.from[1] + dy, box.from[2] + dz, box.to[0] + dx, box.to[1] + dy, box.to[2] + dz, box.material);
  }
}

/**
 * Greedy horizontal runs of one 2D material grid (row-major, y up) as one-cell-deep boxes at `z`, merged down
 * rows when a run repeats exactly. Deterministic, and far fewer boxes than cells.
 */
export function gridBoxes(grid: ArrayLike<number>, width: number, height: number, z0: number, z1: number, ox = 0, oy = 0): Box[] {
  const boxes: Box[] = [];
  const open = new Map<string, Box>();
  for (let y = 0; y < height; y++) {
    const seen = new Set<string>();
    let x = 0;
    while (x < width) {
      const material = grid[x + width * y]!;
      let end = x + 1;
      while (end < width && grid[end + width * y] === material) end++;
      if (material !== 0) {
        const key = `${x}:${end}:${material}`;
        const box = open.get(key);
        if (box && box.to[1] === oy + y) box.to[1] = oy + y + 1;
        else { const fresh: Box = { from: [ox + x, oy + y, z0], to: [ox + end, oy + y + 1, z1], material }; boxes.push(fresh); open.set(key, fresh); }
        seen.add(key);
      }
      x = end;
    }
    for (const key of [...open.keys()]) if (!seen.has(key)) open.delete(key);
  }
  return boxes;
}

/**
 * A brass street lantern on a short post: a square foot, the post, a drip plate, a glass core held by four corner
 * bars, and a pyramid cap with a ring. The anchor is the middle of the glass core. `x, z` is the post's corner.
 */
export function lantern(b: Sculpt, kit: EmoteArtKit, id: string, x: number, y: number, z: number, postHeight: number): EmoteArtLantern {
  b.add(x - 1, y, z - 1, x + 3, y + 1, z + 3, kit.footing);
  b.add(x, y + 1, z, x + 2, y + postHeight, z + 2, kit.post);
  const top = y + postHeight;
  b.add(x - 1, top, z - 1, x + 3, top + 1, z + 3, MAT.brass);
  b.add(x - 1, top + 1, z - 1, x + 3, top + 5, z + 3, MAT.glass);
  for (const [cx, cz] of [[x - 1, z - 1], [x + 2, z - 1], [x - 1, z + 2], [x + 2, z + 2]] as const) b.add(cx, top + 1, cz, cx + 1, top + 5, cz + 1, MAT.brass);
  b.add(x - 1, top + 5, z - 1, x + 3, top + 6, z + 3, MAT.brass);
  b.add(x, top + 6, z, x + 2, top + 7, z + 2, MAT.brass);
  b.cell(x, top + 7, z, MAT.brass);
  return { id, position: [x + 1, top + 3, z + 1] };
}
