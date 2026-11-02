import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT, type StyleKey } from '../materials';

export type Cell = [number, number, number];
export type Box = VoxelBlueprint['boxes'][number];
/** One authored library sculpture. Same frame as the kit's ornaments: 24 × 16 × 18 cells, bottom contact at the mount. */
export interface LibraryMotif { size: Cell; boxes: Box[]; mount: Cell; emitter: Cell }

/** Every library motif is carved inside this envelope so any slot's carrier can hold any motif. */
export const LIBRARY_ENVELOPE: Cell = [24, 16, 18];
export const LIBRARY_MOUNT: Cell = [12, 0, 9];

/**
 * The kingdom's carving palette, as the kit's ornaments use it. `body` is the broad surface a copper or ceramic
 * finish recolours; `gold` is the metal accent (brass, or gold leaf in Grove), which finishes also recolour.
 */
export interface CarvePalette { body: number; shade: number; light: number; dark: number; gold: number }
export const CARVE_PALETTES: Readonly<Record<StyleKey, CarvePalette>> = {
  hearth: { body: MAT.terracotta, shade: MAT.brick, light: MAT.limestone, dark: MAT.timber, gold: MAT.brass },
  tide: { body: MAT.slate, shade: MAT.darkStone, light: MAT.cream, dark: MAT.timber, gold: MAT.brass },
  grove: { body: MAT.moss, shade: MAT.bark, light: MAT.thatch, dark: MAT.bark, gold: MAT.goldLeaf },
};
/**
 * The few subject accents a carving may add to its kingdom palette, sparingly, where colour carries the subject
 * (a rose's petals, a frog's leaf-green back, a candle's flame glass). Never skin, hair or fabric swatches.
 */
export const SUBJECT_ACCENTS = {
  leaf: MAT.leaf, petal: MAT.petal, blueFlower: MAT.blueFlower, glass: MAT.glass, cream: MAT.cream,
  stone: MAT.stone, darkStone: MAT.darkStone, limestone: MAT.limestone, timber: MAT.timber, copper: MAT.forgeCopper,
  brass: MAT.brass, goldLeaf: MAT.goldLeaf, thatch: MAT.thatch, plaster: MAT.plaster,
} as const;

/** A bounds-checked box list in the library envelope. Half-open boxes, later boxes paint over earlier ones. */
export class Carving {
  readonly boxes: Box[] = [];
  constructor(readonly id: string) {}
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: number): this {
    const from: Cell = [x0, y0, z0], to: Cell = [x1, y1, z1];
    if (from.some((v, i) => !Number.isInteger(v) || !Number.isInteger(to[i]) || v < 0 || v >= to[i]! || to[i]! > LIBRARY_ENVELOPE[i]!)) {
      throw new Error(`${this.id}: box ${[...from, ...to].join(',')} leaves the ${LIBRARY_ENVELOPE.join('×')} envelope.`);
    }
    if (material === MAT.air) throw new Error(`${this.id}: library carvings add material only.`);
    this.boxes.push({ from, to, material });
    return this;
  }
  /** The same box and its mirror across x = 12 (the envelope's centre line). */
  pair(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: number): this {
    this.box(x0, y0, z0, x1, y1, z1, material);
    return this.box(24 - x1, y0, z0, 24 - x0, y1, z1, material);
  }
  done(emitter: Cell): LibraryMotif {
    return { size: [...LIBRARY_ENVELOPE], boxes: this.boxes.map(b => ({ from: [...b.from], to: [...b.to], material: b.material })), mount: [...LIBRARY_MOUNT], emitter };
  }
}
