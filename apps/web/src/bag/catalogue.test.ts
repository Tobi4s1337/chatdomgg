import { expect, it, vi } from 'vitest';
import type { VoxelAsset } from '@chatdom/shared';
import '../../../realm/src/items/providers';
import { itemCatalogue } from '../../../realm/src/items/catalogue';
import { FISH_ITEM_DEFINITIONS } from '../../../../packages/content/src/fish';
import { FISH_MOUNT_DEFINITIONS } from '../../../../packages/content/src/keepsakes';
import { WILLOW_ROD_DEFINITION } from '../../../../packages/content/src/pier/rod';
import { createItemModelCatalogue, itemModels } from './index';

const asset = (id: string): VoxelAsset => ({ id, revision: 1, lattice: 'avatar', size: [1, 1, 1], voxels: new Uint16Array([1]) });

it('resolves every real server definition through browser providers with independent voxel buffers', () => {
  const definitions = [...FISH_ITEM_DEFINITIONS, ...FISH_MOUNT_DEFINITIONS, WILLOW_ROD_DEFINITION];
  expect(FISH_MOUNT_DEFINITIONS).toHaveLength(FISH_ITEM_DEFINITIONS.length);
  expect(definitions).toHaveLength(FISH_ITEM_DEFINITIONS.length * 2 + 1);
  expect(new Set(definitions.map(def => def.id)).size).toBe(definitions.length);
  for (const expected of definitions) {
    const server = itemCatalogue.get(expected.id);
    expect(server).toEqual(expected);
    expect(itemModels.has(server!.model), server!.model).toBe(true);
    const first = itemModels.create(server!.model)!, second = itemModels.create(server!.model)!;
    expect(first.id).toBe(server!.model);
    expect(first.voxels.length).toBeGreaterThan(0);
    expect(first.voxels.some(cell => cell !== 0)).toBe(true);
    expect(first.voxels).toEqual(second.voxels);
    expect(first.voxels.buffer).not.toBe(second.voxels.buffer);
    const previous = second.voxels[0]; first.voxels[0] = 0xffff;
    expect(second.voxels[0]).toBe(previous);
    expect(itemModels.create(server!.model)!.voxels[0]).toBe(previous);
  }
  expect(itemModels.has('fish:missing')).toBe(false);
  expect(itemModels.create('fish:missing')).toBeUndefined();
}, 60_000);

it('registers factories lazily, rejects a conflicting batch atomically, and safely unregisters', () => {
  const models = createItemModelCatalogue(), first = vi.fn(() => asset('tool:first'));
  const remove = models.register([{ id: 'tool:first', create: first }]);
  expect(first).not.toHaveBeenCalled(); expect(models.has('tool:first')).toBe(true);
  expect(() => models.register([{ id: 'tool:new', create: () => asset('tool:new') }, { id: 'tool:first', create: first }])).toThrow();
  expect(models.has('tool:new')).toBe(false); expect(models.has('tool:first')).toBe(true);
  expect(() => models.register([{ id: 'tool:duplicate', create: first }, { id: 'tool:duplicate', create: first }])).toThrow();
  expect(models.has('tool:duplicate')).toBe(false);
  expect(models.create('tool:first')?.id).toBe('tool:first'); expect(first).toHaveBeenCalledTimes(1);
  remove(); expect(models.create('tool:first')).toBeUndefined();
  const replacement = models.register([{ id: 'tool:first', create: first }]);
  remove(); expect(models.has('tool:first')).toBe(true);
  replacement(); expect(models.has('tool:first')).toBe(false);
});

it('rejects a factory that returns a different model identity', () => {
  const models = createItemModelCatalogue();
  models.register([{ id: 'tool:first', create: () => asset('tool:other') }]);
  expect(() => models.create('tool:first')).toThrow('different model');
  expect(models.create('tool:other')).toBeUndefined();
});
