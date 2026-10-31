import type { VoxelBlueprint } from '@chatdom/shared';
import { STYLES, type StyleKey } from '../../materials';
import { cloverPebbles, cuttingBed, meadowTufts, seedlingBed, wildflowers } from './cover';
import { backFence, fieldWall, railFence } from './field';
import { barrels, crates, gardenBed, handcart, woodpile } from './garden';
import { steppingStones } from './path';

/** Every living and garden form of the collection, in spec 28's R1 table order. */
export const DRESSING_FORMS = [
  'meadow-tufts', 'wildflowers-petal', 'wildflowers-blue', 'wildflowers-gold', 'wildflowers-cream', 'clover-pebbles',
  'seedling-bed', 'cutting-bed', 'heather-drift', 'fern-bank',
  'garden-bed', 'woodpile', 'barrels', 'crates', 'handcart',
  'field-wall', 'rail-fence', 'back-fence',
  'stepping-stones', 'edge-stones',
  'oak-old-a', 'oak-old-b', 'beech', 'elder-oak', 'pine-windbent', 'fir', 'birch', 'alder', 'sapling-staked',
  'bramble-hedge', 'pear-espalier',
  'woodland-clump',
] as const;
export type DressingForm = typeof DRESSING_FORMS[number];
export const DRESSING_STYLES = ['hearth', 'tide', 'grove'] as const satisfies readonly StyleKey[];

export interface DressingRole {
  /** 70/20/10 composition band: the land and woods, the trees and vignettes, or the sprinkle of cover. */
  band: 'big' | 'medium' | 'small';
  /** Solid pieces occupy the world and are listed for collision; cover is passive scenery. */
  solid: boolean;
  /** How the one kingdom wind moves it. */
  sway: 'none' | 'cover' | 'canopy';
  /** Kit forms are built once per home kit and resolve stone/trim through STYLES. */
  kit: boolean;
}

const cover: DressingRole = { band: 'small', solid: false, sway: 'cover', kit: false };
const piece: DressingRole = { band: 'medium', solid: true, sway: 'none', kit: false };
const kitPiece: DressingRole = { ...piece, kit: true };
const tree: DressingRole = { band: 'medium', solid: true, sway: 'canopy', kit: false };

export const DRESSING_ROLES: Readonly<Record<DressingForm, DressingRole>> = {
  'meadow-tufts': cover, 'wildflowers-petal': cover, 'wildflowers-blue': cover, 'wildflowers-gold': cover,
  'wildflowers-cream': cover, 'clover-pebbles': cover, 'seedling-bed': cover, 'cutting-bed': cover, 'heather-drift': cover, 'fern-bank': cover,
  'garden-bed': kitPiece, woodpile: piece, barrels: piece, crates: piece, handcart: piece,
  'field-wall': kitPiece, 'rail-fence': kitPiece, 'back-fence': kitPiece,
  // Stepping stones lie flush with the turf and are walked over; kerb stones edge a path.
  'stepping-stones': { ...kitPiece, solid: false }, 'edge-stones': kitPiece,
  'oak-old-a': tree, 'oak-old-b': tree, beech: tree, 'elder-oak': tree, 'pine-windbent': tree, fir: tree, birch: tree,
  alder: tree, 'sapling-staked': tree, 'bramble-hedge': tree, 'pear-espalier': { ...tree, sway: 'none' },
  'woodland-clump': { band: 'big', solid: false, sway: 'canopy', kit: false },
};

/** Maximum build-cell dimensions per form (R1). Each authored blueprint fits inside its box. */
export const DRESSING_SIZES: Readonly<Record<DressingForm, readonly [number, number, number]>> = {
  'meadow-tufts': [16, 5, 16], 'wildflowers-petal': [16, 6, 16], 'wildflowers-blue': [16, 6, 16],
  'wildflowers-gold': [16, 6, 16], 'wildflowers-cream': [16, 6, 16], 'clover-pebbles': [16, 2, 16],
  'seedling-bed': [24, 3, 8], 'cutting-bed': [24, 4, 10], 'heather-drift': [24, 6, 24], 'fern-bank': [24, 10, 24],
  'garden-bed': [24, 6, 12], woodpile: [20, 12, 10], barrels: [14, 10, 8], crates: [12, 12, 10], handcart: [24, 14, 12],
  'field-wall': [32, 7, 5], 'rail-fence': [32, 10, 4], 'back-fence': [64, 9, 3],
  'stepping-stones': [24, 2, 8], 'edge-stones': [16, 3, 4],
  'oak-old-a': [96, 112, 96], 'oak-old-b': [96, 112, 96], beech: [96, 112, 96], 'elder-oak': [128, 144, 128],
  'pine-windbent': [72, 88, 72], fir: [56, 96, 56], birch: [48, 80, 48], alder: [56, 72, 56],
  'sapling-staked': [16, 28, 16], 'bramble-hedge': [32, 12, 10], 'pear-espalier': [48, 40, 6],
  'woodland-clump': [192, 120, 192],
};

type Kit = (typeof STYLES)[StyleKey];
type Builder = (kit: Kit) => Pick<VoxelBlueprint, 'size' | 'boxes'>;

/** Finished forms only. A form joins this map, and so the collection, once it is authored and reviewed. */
const BUILDERS: Partial<Record<DressingForm, Builder>> = {
  'meadow-tufts': meadowTufts,
  'wildflowers-petal': () => wildflowers('petal'),
  'wildflowers-blue': () => wildflowers('blue'),
  'wildflowers-gold': () => wildflowers('gold'),
  'wildflowers-cream': () => wildflowers('cream'),
  'clover-pebbles': cloverPebbles,
  'seedling-bed': seedlingBed,
  'cutting-bed': cuttingBed,
  'garden-bed': gardenBed,
  woodpile,
  barrels,
  crates,
  handcart,
  'field-wall': fieldWall,
  'rail-fence': railFence,
  'back-fence': backFence,
  'stepping-stones': steppingStones,
};

export function isFinishedDressing(form: DressingForm): boolean { return BUILDERS[form] !== undefined; }

/** Builds one form. Kit forms need a home kit and are named `dressing-<style>-<form>`; the rest are `dressing-<form>`. */
export function createDressing(form: DressingForm, style?: StyleKey): VoxelBlueprint {
  if (!(DRESSING_FORMS as readonly string[]).includes(form)) throw new Error(`Unknown dressing form "${String(form)}". Choose ${DRESSING_FORMS.join(', ')}.`);
  const { kit } = DRESSING_ROLES[form];
  if (kit && !(DRESSING_STYLES as readonly string[]).includes(style ?? '')) throw new Error(`"${form}" is a kit form: choose hearth, tide or grove.`);
  if (!kit && style !== undefined) throw new Error(`"${form}" is not a kit form and takes no style.`);
  const builder = BUILDERS[form];
  if (!builder) throw new Error(`"${form}" is not part of the finished ground-dressing collection.`);
  const styleKey: StyleKey = kit ? style! : 'grove';
  const { size, boxes } = builder(STYLES[styleKey]);
  const max = DRESSING_SIZES[form];
  if (size.some((value, axis) => value > max[axis]!)) throw new Error(`"${form}" exceeds its ${max.join('×')} cell box.`);
  return {
    version: 1, id: kit ? `dressing-${styleKey}-${form}` : `dressing-${form}`, styleId: STYLES[styleKey].id,
    kind: DRESSING_ROLES[form].band === 'small' || DRESSING_ROLES[form].sway === 'canopy' ? 'flora' : 'prop',
    lattice: 'build', size: [...size], boxes, windows: [],
  };
}

/** Every finished form in R1 order; kit forms Hearth, Tide, Grove. */
export const BLUEPRINTS: readonly VoxelBlueprint[] = DRESSING_FORMS.filter(isFinishedDressing).flatMap(form =>
  DRESSING_ROLES[form].kit ? DRESSING_STYLES.map(style => createDressing(form, style)) : [createDressing(form)]);
