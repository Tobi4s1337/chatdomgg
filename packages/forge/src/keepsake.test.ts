import { describe, expect, it } from 'vitest';
import { FORGE_MOTIFS, VoxelBlueprintSchema } from '@chatdom/shared';
import { rasterizeBlueprint } from '@chatdom/voxel';
import { assembleForgeKeepsake, forgeKeepsakeBounds } from './keepsake';

const kinds = ['chimney', 'lantern', 'weathervane'] as const;
const families = ['hearth', 'tide', 'grove'] as const;

describe('a remembered piece on its own', () => {
  it.each(families.flatMap(family => [1, 2].map(kitRevision => [family, kitRevision] as const)))('assembles every slot and motif in %s, kit %i', (family, kitRevision) => {
    for (const kind of kinds) for (const motif of FORGE_MOTIFS) {
      const blueprint = VoxelBlueprintSchema.parse(assembleForgeKeepsake({ version: 2, kind, motif, finish: 'copper', accent: 'stars' }, family, kitRevision));
      const { min, max } = forgeKeepsakeBounds(blueprint);
      // It stands on its footing (or hangs flat on its bracket) and stays a small object.
      expect(kind === 'lantern' ? min[2] : min[1]).toBe(0);
      expect(max.every((n, axis) => n - min[axis]! <= 48)).toBe(true);
      const asset = rasterizeBlueprint(blueprint);
      expect(asset.voxels.some(Boolean)).toBe(true);
    }
  });

  it('is the same piece every time', () => {
    const plan = { version: 2, kind: 'weathervane', motif: 'watchful-owl', finish: 'native', accent: 'none' } as const;
    expect(assembleForgeKeepsake(plan, 'tide', 2)).toEqual(assembleForgeKeepsake(plan, 'tide', 2));
  });
});
