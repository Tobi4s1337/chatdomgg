import type { VoxelBlueprint } from '@chatdom/shared';
import { STYLES, type StyleKey } from '../materials';
import { GROWERS } from './species';
import { rng } from './sculpt';

/**
 * The picture trees (spec 47): oak, pine, birch, willow and the rare gnarled elder, each in every home kit, each a
 * handful of seeded variants. Blueprints are strict `VoxelBlueprint`s; how a crown moves in the wind travels beside
 * the blueprint as `CanopyMotion`, never inside it.
 */
export const TREE_SPECIES = ['oak', 'pine', 'birch', 'willow', 'elder'] as const;
export type TreeSpecies = typeof TREE_SPECIES[number];
/** The kingdom's home kit: Hearth, Tide or Grove. */
export type StyleFamily = StyleKey;
export const TREE_STYLES = ['hearth', 'tide', 'grove'] as const satisfies readonly StyleFamily[];

/** Distinct grown forms per species. A site picks one by its seed; its yaw turns it into its own silhouette. */
export const TREE_VARIANTS: Readonly<Record<TreeSpecies, number>> = { oak: 4, pine: 4, birch: 4, willow: 3, elder: 2 };

/** Largest blueprint, in build cells, each species may grow to. */
export const TREE_LIMITS: Readonly<Record<TreeSpecies, readonly [number, number, number]>> = {
  oak: [96, 112, 96], pine: [72, 88, 72], birch: [48, 80, 48], willow: [96, 88, 96], elder: [128, 128, 128],
};

/**
 * How one tree's crown moves in the kingdom wind, in metres and seconds, measured from the root point.
 * Below `pivot` nothing moves: roots and bole are fixed. Above it a point's weight rises with its height toward
 * `top` and, by `hang`, with its distance from the trunk axis toward `reach` (willow curtains move as one with
 * the rim of the dome they hang from). Displacement is a smooth function of position, so connected wood and
 * leaves stay connected.
 */
export interface CanopyMotion {
  /** Height above the root where the crown begins to move. */
  pivot: number;
  /** Height of the crown's top. */
  top: number;
  /** Crown radius from the trunk axis. */
  reach: number;
  /** Peak sway at full weight in a steady breeze. */
  sway: number;
  /** Small, faster leaf shimmer at full weight, varying across the crown. */
  flutter: number;
  /** Seconds per main sway. */
  period: number;
  /** 0: weight follows height only. 1: weight follows distance from the trunk. */
  hang: number;
}

export interface PictureTree {
  id: string;
  species: TreeSpecies;
  style: StyleFamily;
  variant: number;
  blueprint: VoxelBlueprint;
  canopy: CanopyMotion;
  /** The trunk's root point in the blueprint, build cells: the centre of the footprint at y=0. */
  root: readonly [number, number, number];
}

const MOTION: Readonly<Record<TreeSpecies, Pick<CanopyMotion, 'sway' | 'flutter' | 'period' | 'hang'>>> = {
  oak: { sway: 0.08, flutter: 0.025, period: 4.6, hang: 0.15 },
  pine: { sway: 0.05, flutter: 0.012, period: 5.8, hang: 0.05 },
  birch: { sway: 0.11, flutter: 0.04, period: 3.4, hang: 0.1 },
  willow: { sway: 0.12, flutter: 0.03, period: 5.2, hang: 0.85 },
  elder: { sway: 0.05, flutter: 0.02, period: 6.5, hang: 0.15 },
};
const CELL = 0.125;

export function treeId(species: TreeSpecies, style: StyleFamily, variant: number): string {
  return `tree-${species}-${style}-${variant}`;
}

const grown = new Map<string, PictureTree>();

/** One grown tree. The same species, kit and variant always return the identical blueprint and motion. */
export function createPictureTree(species: TreeSpecies, style: StyleFamily, variant: number): PictureTree {
  if (!(TREE_SPECIES as readonly string[]).includes(species)) throw new Error(`Unknown tree species "${String(species)}". Choose ${TREE_SPECIES.join(', ')}.`);
  if (!(TREE_STYLES as readonly string[]).includes(style)) throw new Error(`Unknown home kit "${String(style)}". Choose hearth, tide or grove.`);
  if (!Number.isInteger(variant) || variant < 0 || variant >= TREE_VARIANTS[species]) throw new Error(`A ${species} has variants 0–${TREE_VARIANTS[species] - 1}.`);
  const id = treeId(species, style, variant), known = grown.get(id);
  if (known) return known;
  const seedText = `picture-tree:${species}:${style}:${variant}`, r = rng(seedText);
  const { sculpt, crown } = GROWERS[species](r, style, variant, Math.floor(r() * 9973));
  const { size, boxes } = sculpt.toBlueprint();
  const max = TREE_LIMITS[species];
  if (size.some((value, axis) => value > max[axis]!)) throw new Error(`${id} grew to ${size.join('×')}, beyond its ${max.join('×')} cell limit.`);
  const { half, top } = sculpt.extent();
  const blueprint: VoxelBlueprint = { version: 1, id, styleId: STYLES[style].id, kind: 'flora', lattice: 'build', size, boxes, windows: [] };
  const tree: PictureTree = {
    id, species, style, variant, blueprint, root: [size[0] / 2, 0, size[2] / 2],
    canopy: { pivot: crown.base * CELL, top: top * CELL, reach: half * CELL, ...MOTION[species] },
  };
  grown.set(id, tree);
  return tree;
}

/** A stable 32-bit hash of a seed. */
function hash(seed: string | number): number {
  let h = 2166136261;
  const text = String(seed);
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13;
  return h >>> 0;
}

/** The species selection: a kit, a species and a seed name one variant, the same one every time. */
export function selectTree(style: StyleFamily, species: TreeSpecies, seed: string | number): PictureTree {
  if (!(TREE_SPECIES as readonly string[]).includes(species)) throw new Error(`Unknown tree species "${String(species)}".`);
  return createPictureTree(species, style, hash(`${species}:${seed}`) % TREE_VARIANTS[species]);
}

/** Every picture tree: kit, then species, then variant. */
export function allPictureTrees(): readonly PictureTree[] {
  return TREE_STYLES.flatMap(style => TREE_SPECIES.flatMap(species => Array.from({ length: TREE_VARIANTS[species] }, (_, v) => createPictureTree(species, style, v))));
}

/** The collection's blueprints, in `allPictureTrees` order. Built on first use, not at import. */
export function treeBlueprints(): readonly VoxelBlueprint[] { return allPictureTrees().map(tree => tree.blueprint); }
