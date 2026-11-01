import { describe, expect, it } from 'vitest';
import type { VoxelBlueprint } from '@chatdom/shared';
import { assetHashOf } from '../../../../../packages/world/src/founded-world/codec';
import { identify } from './identity';

const blueprint = (id: string, material: number): VoxelBlueprint => ({ version: 1, id, styleId: 'hearth' as VoxelBlueprint['styleId'], kind: 'civic', lattice: 'build', size: [2, 2, 2], boxes: [{ from: [0, 0, 0], to: [2, 2, 2], material }], windows: [] });

describe('kingdom asset identity', () => {
  it('keys pieces by their bytes, never their ids, and keeps a producer’s own hash', async () => {
    const a = blueprint('same-id', 3), b = blueprint('same-id', 4), twin = blueprint('same-id', 3);
    const [first, second, third, founded] = await identify([
      { blueprint: a }, { blueprint: b }, { blueprint: twin }, { blueprint: a, assetHash: 'producer-hash' },
    ], new Map());
    expect(first!.assetHash).toBe(await assetHashOf(a));
    expect(second!.assetHash).not.toBe(first!.assetHash);
    expect(third!.assetHash).toBe(first!.assetHash);
    expect(founded!.assetHash).toBe('producer-hash');
  });
});
