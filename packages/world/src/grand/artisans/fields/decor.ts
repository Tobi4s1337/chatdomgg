import { hash2 } from '../../noise';
import { M } from '../../palette';
import { Cover, type FieldPlot, type GrandLand } from '../../types';

/** Land data used strictly for presentation sampling; no array is changed. */
export type FieldDecorLand = Pick<GrandLand, 'size' | 'seed' | 'ground' | 'water' | 'cover' | 'plot' | 'plots'>;
/** -1 means let the producer use its existing rules. Nonnegative values pack up to three material IDs. */
export const FIELD_DECOR_FALLBACK = -1;

const seedOf = (key: string): number => {
  let seed = 2166136261;
  for (let i = 0; i < key.length; i++) seed = Math.imul(seed ^ key.charCodeAt(i), 16777619);
  return seed >>> 0;
};
const pack = (bottom: number, middle = 0, top = 0) => bottom | middle << 8 | top << 16;
/** Number of contiguous above-ground cells; all supported profiles have no interior air. */
export const fieldDecorHeight = (profile: number): number => profile <= 0 ? 0 : (profile >>> 16) !== 0 ? 3 : (profile >>> 8) !== 0 ? 2 : 1;
/** A palette ID at an above-ground zero-based step, or air outside that column. */
export const fieldDecorMaterial = (profile: number, step: number): number => profile > 0 && step >= 0 && step < 3 ? (profile >>> (step * 8)) & 255 : 0;

/** Plot-relative unplanted row for the supported grain/flower crops; null preserves native soil for other crops. */
export function fieldDecorFurrow(plot: FieldPlot, x: number, z: number): boolean | null {
  if (plot.crop !== M.crop.wheat && plot.crop !== M.crop.wheatPale && plot.crop !== M.crop.lavender && plot.crop !== M.crop.lavenderDark) return null;
  const row = plot.rows === 0 ? z - plot.z0 : x - plot.x0;
  return ((row % 3) + 3) % 3 === 2;
}

/**
 * Sample the EXISTING field/plot/height/water decision at integer terrain coordinates.
 * Returns contiguous 0.5 m cells above the local ground only, never a foundation or edit.
 * Wheat, lavender, cabbage and their row rhythm are world-aligned to the plot bounds;
 * short coherent planting runs keep their gaps when adjacent chunks request the same cell.
 * Existing hedge cells receive a continuous low green mass; absent hedge/gate cells stay empty.
 * Every other crop and every other cover returns FIELD_DECOR_FALLBACK.
 */
export function createFieldDecorSampler(land: FieldDecorLand): (x: number, z: number) => number {
  const seed = seedOf(`grand-field-decor/${land.seed.seedKey}`);
  return (x, z) => {
    if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || z < 0 || x >= land.size || z >= land.size) return FIELD_DECOR_FALLBACK;
    const i = x + z * land.size;
    const cover = land.cover[i];
    if (cover !== Cover.field && cover !== Cover.hedge) return FIELD_DECOR_FALLBACK;
    if (land.water[i]! > land.ground[i]!) return 0;
    if (cover === Cover.hedge) {
      const tall = hash2(Math.floor(x / 5), Math.floor(z / 5), seed ^ 0x3f19) > 0.65;
      return tall ? pack(M.leaf.hedge, M.leaf.hedge + 1, M.leaf.hedge + 2) : pack(M.leaf.hedge, M.leaf.hedge + 2);
    }
    const p = land.plots[land.plot[i]! - 1];
    if (!p || x < p.x0 || x >= p.x1 || z < p.z0 || z >= p.z1) return 0;
    const along = p.rows === 0 ? x - p.x0 : z - p.z0;
    const row = p.rows === 0 ? z - p.z0 : x - p.x0;
    const c = p.crop;
    if (c === M.crop.cabbage) {
      // A cross of broad green leaves around a smaller lighter head, with soil between plants.
      const ax = along % 4, rz = row % 4;
      const centre = ax === 1 && rz === 1;
      const leaf = (ax === 1 && (rz === 0 || rz === 2)) || (rz === 1 && (ax === 0 || ax === 2));
      return centre ? pack(M.crop.cabbage, M.meadow[0]) : leaf ? pack(M.crop.cabbage) : 0;
    }
    if (c !== M.crop.wheat && c !== M.crop.wheatPale && c !== M.crop.lavender && c !== M.crop.lavenderDark) return FIELD_DECOR_FALLBACK;
    // Two cells of foliage per three-cell row; an empty fourth cell separates clumps.
    const band = row % 3, part = along % 4;
    if (part === 3 || band === 2) return 0;
    const variation = hash2(Math.floor((p.x0 + p.x1) / 2) + Math.floor(along / 4), Math.floor((p.z0 + p.z1) / 2) + Math.floor(row / 3), seed);
    if (c === M.crop.lavender || c === M.crop.lavenderDark) {
      const green = M.leaf.hedge + 1;
      return band === 0 ? pack(green, variation < 0.5 ? M.crop.lavender : M.crop.lavenderDark) : pack(green);
    }
    const head = variation < 0.34 ? M.crop.wheatPale : M.crop.wheat;
    return band === 0 && part === 1 && variation > 0.72 ? pack(M.crop.barley, head, head) : pack(M.crop.barley, head);
  };
}
