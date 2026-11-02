import type { VoxelAsset } from '@chatdom/shared';

export interface ItemModelDefinition {
  readonly id: string;
  /** A fresh CPU-owned voxel asset. No texture approximation or cached transferable buffer. */
  readonly create: () => VoxelAsset;
}

export function createItemModelCatalogue() {
  const entries = new Map<string, ItemModelDefinition>();
  const register = (models: readonly ItemModelDefinition[]) => {
    const ids = new Set<string>();
    const parsed = models.map(model => {
      if (!/^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9._-]{0,63}$/.test(model.id) || typeof model.create !== 'function'
        || ids.has(model.id) || entries.has(model.id)) throw new Error('Item models need unique registered ids and factories.');
      ids.add(model.id);
      return Object.freeze({ id: model.id, create: model.create });
    });
    for (const model of parsed) entries.set(model.id, model);
    return () => { for (const model of parsed) if (entries.get(model.id) === model) entries.delete(model.id); };
  };
  return {
    register,
    has: (id: string) => entries.has(id),
    create(id: string): VoxelAsset | undefined {
      const model = entries.get(id);
      if (!model) return undefined;
      const asset = model.create();
      if (asset.id !== id) throw new Error('The item model factory returned a different model.');
      return asset;
    },
  };
}

export const itemModels = createItemModelCatalogue();
export const registerItemModels = itemModels.register;
