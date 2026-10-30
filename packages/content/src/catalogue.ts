import { HomeTierSchema, type VoxelBlueprint } from '@chatdom/shared';
import { createCastle, createHome, createTree } from './core';
import { STYLES, type StyleKey } from './materials';

export const COLLECTIONS = ['core', 'homes-hearth', 'homes-tide', 'street-props'] as const;
export type ContentCollection = typeof COLLECTIONS[number];

type CollectionModule = { BLUEPRINTS?: readonly VoxelBlueprint[] };
// A glob permits lanes to arrive independently without unresolved static imports or fake fallback assets.
const entries = import.meta.glob<CollectionModule>(['./homes/*/index.ts', './props/*/index.ts']);
const paths = { 'homes-hearth': './homes/hearth/index.ts', 'homes-tide': './homes/tide/index.ts', 'street-props': './props/street/index.ts' } as const;

export async function loadContentCollection(name: string): Promise<readonly VoxelBlueprint[]> {
  if (name === 'core') {
    return (Object.keys(STYLES) as StyleKey[]).flatMap(style => [
      ...HomeTierSchema.options.flatMap(tier => [0, 1, 2].map(variant => createHome(tier, style, variant))),
      createCastle(style),
    ]).concat([0, 1, 2].map(createTree));
  }
  if (!(name in paths)) throw new Error(`Unknown content collection: ${name}. Choose ${COLLECTIONS.join(', ')}.`);
  const path = paths[name as keyof typeof paths];
  const load = entries[path];
  if (!load) throw new Error(`Collection ${name} is not installed. Expected ${path} exporting BLUEPRINTS.`);
  const module = await load();
  if (!Array.isArray(module.BLUEPRINTS) || module.BLUEPRINTS.length === 0) throw new Error(`Collection ${name} must export a nonempty BLUEPRINTS array.`);
  return module.BLUEPRINTS;
}

/** Baseline smoke renders cover each style, a civic piece and flora; lane collections render every asset. */
export function coreRenderAssets(assets: readonly VoxelBlueprint[]): readonly VoxelBlueprint[] {
  const wanted = ['home-hut-hearth-0', 'home-cottage-tide-1', 'home-house-grove-2', 'castle-hearth', 'tree-0'];
  return wanted.map(id => {
    const asset = assets.find(asset => asset.id === id);
    if (!asset) throw new Error(`Missing core render fixture ${id}.`);
    return asset;
  });
}
