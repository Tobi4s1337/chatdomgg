import type { VoxelBlueprint } from '@chatdom/shared';
import { assetHashOf } from '../../../../../packages/world/src/founded-world/codec';

/** Every piece keyed by its blueprint's canonical bytes; founded pieces keep the producer's own hash. */
export async function identify<T extends { readonly blueprint: VoxelBlueprint; readonly assetHash?: string }>(items: readonly T[], memo: Map<VoxelBlueprint, Promise<string>>): Promise<(T & { readonly assetHash: string })[]> {
  return Promise.all(items.map(async item => {
    if (item.assetHash) return item as T & { readonly assetHash: string };
    let hash = memo.get(item.blueprint);
    if (!hash) memo.set(item.blueprint, hash = assetHashOf(item.blueprint));
    return { ...item, assetHash: await hash };
  }));
}
