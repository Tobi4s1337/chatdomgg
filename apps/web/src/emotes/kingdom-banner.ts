import { StyleIdSchema, VoxelBlueprintSchema, type VoxelBlueprint } from '@chatdom/shared';
import { BANNER_CLEARANCE_CELLS, type EmoteBannerLayout, type EmoteBannerMaterials } from '../../../../packages/emotes/src/index';

/** One vertical strip of banner cloth, meshed on its own so the wind can swing it about the crossbar. */
export interface ClothStrip {
  /** Strip-local blueprint: x from the strip's left edge, y up from the cloth's lowest cell. */
  readonly blueprint: VoxelBlueprint;
  /** Left edge of the strip in banner cells. */
  readonly x: number;
  readonly width: number;
}

export interface BannerParts {
  /** Foot, pole, crossbar and finial: everything the wind cannot move. */
  readonly frame: VoxelBlueprint;
  readonly strips: readonly ClothStrip[];
  /** Lowest cloth cell and the crossbar row the sleeve hangs from, in banner cells. */
  readonly clothBottom: number;
  readonly clothTop: number;
  /** Depth of the hinge line (the sleeve round the crossbar), in banner cells. */
  readonly hingeZ: number;
  /** Cloth span across, in banner cells: [left, right). */
  readonly span: readonly [number, number];
}

const STYLE = StyleIdSchema.parse('emote');

/**
 * Splits a laid-out banner into its rigid frame and columns of cloth. The cloth is every box that
 * hangs between the clearance line and the crossbar on or in front of the sleeve; the crossbar row
 * is found from the field and trim, which the caller chose apart from the pole and finial. Each
 * column keeps its slice of the charge, so the emote travels with the cloth it is sewn to.
 */
export function splitBannerCloth(layout: EmoteBannerLayout, materials: EmoteBannerMaterials, stripCells: number): BannerParts {
  const { blueprint } = layout;
  if (new Set([materials.field, materials.trim]).has(materials.pole) || new Set([materials.field, materials.trim]).has(materials.finial)) {
    throw new Error('The banner cloth needs its own fabrics, apart from the pole and finial.');
  }
  // The sleeve sits one cell behind the cloth face; the charge stands two cells proud of the sleeve.
  const hingeZ = layout.chargeOrigin[2] - 3;
  const fabric = blueprint.boxes.filter(box => (box.material === materials.field || box.material === materials.trim) && box.from[2] >= hingeZ && box.from[1] >= BANNER_CLEARANCE_CELLS);
  if (!fabric.length) throw new Error('The banner has no cloth to hang.');
  const clothTop = Math.max(...fabric.map(box => box.to[1])), clothBottom = BANNER_CLEARANCE_CELLS;
  const isCloth = (box: VoxelBlueprint['boxes'][number]) => box.from[1] >= clothBottom && box.to[1] <= clothTop && box.from[2] >= hingeZ;
  const cloth = blueprint.boxes.filter(isCloth), rigid = blueprint.boxes.filter(box => !isCloth(box));
  const left = Math.min(...cloth.map(box => box.from[0])), right = Math.max(...cloth.map(box => box.to[0]));
  const depth = blueprint.size[2], height = clothTop - clothBottom;
  const strips: ClothStrip[] = [];
  for (let x = left; x < right; x += stripCells) {
    const end = Math.min(right, x + stripCells), boxes: VoxelBlueprint['boxes'] = [];
    for (const box of cloth) {
      const from = Math.max(x, box.from[0]), to = Math.min(end, box.to[0]);
      if (from >= to) continue;
      boxes.push({ from: [from - x, box.from[1] - clothBottom, box.from[2]], to: [to - x, box.to[1] - clothBottom, box.to[2]], material: box.material });
    }
    if (!boxes.length) continue;
    strips.push({ x, width: end - x, blueprint: VoxelBlueprintSchema.parse({ version: 1, id: `${blueprint.id}.cloth.${x}`, styleId: STYLE, kind: 'prop', lattice: 'build', size: [end - x, height, depth], boxes, windows: [] }) });
  }
  const frame = VoxelBlueprintSchema.parse({ ...blueprint, id: `${blueprint.id}.frame`, boxes: rigid });
  return { frame, strips, clothBottom, clothTop, hingeZ, span: [left, right] };
}

/**
 * How far a column of cloth swings forward about the crossbar, in radians, at a moment in seconds.
 * A steady breeze from behind keeps the cloth off the pole; a wave runs across it and a slower gust
 * swells and settles. `across` is the column's place on the cloth, 0 at the left edge and 1 at the
 * right; `seed` keeps two banners in one square from moving in step.
 */
export function clothSwing(across: number, seconds: number, seed: number): number {
  const gust = .75 + .25 * Math.sin(seconds * .37 + seed * 1.7) * Math.sin(seconds * .23 + seed);
  const wave = Math.sin(seconds * 2.1 - across * 4.4 + seed * 2.3) * .6 + Math.sin(seconds * 3.3 - across * 7.9 + seed) * .4;
  return gust * (.075 + .055 * wave);
}
