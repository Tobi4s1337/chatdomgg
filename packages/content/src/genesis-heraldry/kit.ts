import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT, MATERIALS, STYLES } from '../materials';
import { CIVIC_KITS } from '../civic/kit';

/** The three style families a Genesis recipe can name. Civic kits cover Hearth and Tide; Grove is read from its style. */
export type HeraldicStyle = 'hearth' | 'tide' | 'grove';
export type LandscapeCharacter = 'coastal-harbour' | 'river-valley' | 'mountain-pass';
type Box = VoxelBlueprint['boxes'][number];

/**
 * What the standard and crest are built from in one style family. Masonry and wood come from the frozen style kit;
 * the cord and the binding are the civic kit's hand materials. Nothing here is a channel colour.
 */
export interface HeraldicKit {
  readonly style: HeraldicStyle;
  /** The die, the shield slab and the pillars. */
  readonly stone: number;
  /** Footings, cornices and the oversailing courses. */
  readonly base: number;
  /** Quoins and alternate courses, so corners read as laid stones. */
  readonly band: number;
  /** The pole and the crossbar. */
  readonly trim: number;
  /** Where wood is bound: a brass collar, or a rope lashing by the sea. */
  readonly binding: number;
  /** The hanging cords. */
  readonly cord: number;
}

export const HERALDIC_KITS: Readonly<Record<HeraldicStyle, HeraldicKit>> = {
  hearth: { style: 'hearth', stone: STYLES.hearth.stone, base: MAT.stone, band: CIVIC_KITS.hearth.band, trim: STYLES.hearth.trim, binding: MAT.brass, cord: MAT.cream },
  tide: { style: 'tide', stone: STYLES.tide.stone, base: CIVIC_KITS.tide.base, band: CIVIC_KITS.tide.band, trim: STYLES.tide.trim, binding: MAT.thatch, cord: CIVIC_KITS.tide.cord },
  grove: { style: 'grove', stone: STYLES.grove.stone, base: STYLES.grove.stone, band: MAT.limestone, trim: STYLES.grove.trim, binding: MAT.brass, cord: MAT.thatch },
};

/**
 * The neutral proposal's colours: undyed linen for the field, the land's own roof (or leaf, where the roof is pale
 * thatch) for the charge, and a brass border. They say "this land, not yet anyone's"; they never stand in for a
 * channel's colours, which only arrive as snapped targets.
 */
export interface HeraldicColours {
  readonly field: number;
  readonly charge: number;
  readonly border: number;
}

export const NEUTRAL_COLOURS: Readonly<Record<HeraldicStyle, HeraldicColours>> = {
  hearth: { field: MAT.cream, charge: STYLES.hearth.roof, border: MAT.brass },
  tide: { field: MAT.cream, charge: STYLES.tide.roof, border: MAT.brass },
  grove: { field: MAT.cream, charge: MAT.leaf, border: MAT.brass },
};

const colourOf = new Map(MATERIALS.materials.map(material => [material.id, material.colour]));

/** WCAG relative luminance of a registered material's authored colour. */
export function luminance(material: number): number {
  const hex = colourOf.get(material);
  if (!hex) throw new Error(`Material ${material} is not registered.`);
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two registered materials. */
export function contrast(a: number, b: number): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Ordered half-open boxes: later boxes overwrite earlier ones and material zero carves. */
export class Sculpt {
  readonly list: Box[] = [];
  add(x: number, y: number, z: number, X: number, Y: number, Z: number, material: number): void {
    if (x >= X || y >= Y || z >= Z) return;
    this.list.push({ from: [x, y, z], to: [X, Y, Z], material });
  }
  /**
   * A block whose vertical edges are cut back in a stair of `cut` cells, so a square footing reads as an octagon.
   * A cut of one is the civic kit's faceted column.
   */
  chamfer(x: number, y: number, z: number, X: number, Y: number, Z: number, cut: number, material: number): void {
    for (let i = 0; i <= cut; i++) this.add(x + i, y, z + cut - i, X - i, Y, Z - cut + i, material);
  }
}

/** Calls `emit` once for every maximal run of indices in [0, length) where `key` is equal and not null. */
export function runs<T>(length: number, key: (i: number) => T | null, emit: (from: number, to: number, value: T) => void): void {
  let start = 0;
  for (let i = 1; i <= length; i++) {
    if (i < length && key(i) === key(start)) continue;
    const value = key(start);
    if (value !== null) emit(start, i, value);
    start = i;
  }
}

/** A warm light the kingdom's light field may kindle: a point in build cells inside lantern glass, which passes light. */
export interface LanternAnchor {
  readonly id: string;
  readonly position: readonly [number, number, number];
}

/**
 * A brass lantern four cells square and seven tall, standing on (x, y, z): a foot plate, four corner posts round a
 * glass core two cells square, a cap and a crown. Returns the anchor at the heart of the glass.
 */
export function lantern(b: Sculpt, id: string, x: number, y: number, z: number): LanternAnchor {
  b.add(x, y, z, x + 4, y + 1, z + 4, MAT.brass);
  b.add(x + 1, y + 1, z + 1, x + 3, y + 5, z + 3, MAT.glass);
  for (const [px, pz] of [[x, z], [x + 3, z], [x, z + 3], [x + 3, z + 3]] as const) b.add(px, y + 1, pz, px + 1, y + 5, pz + 1, MAT.brass);
  b.add(x, y + 5, z, x + 4, y + 6, z + 4, MAT.brass);
  b.add(x + 1, y + 6, z + 1, x + 3, y + 7, z + 3, MAT.brass);
  return { id, position: [x + 2, y + 3, z + 2] };
}
