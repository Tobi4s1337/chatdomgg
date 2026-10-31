import { expect, it } from 'vitest';
import { VoxelBlueprintSchema } from '@chatdom/shared';
import { rasterizeBlueprint } from '../../voxel/src/index';
import { createMarketSeatLog, createSeatLog, MARKET_SEAT_LOG_GROUND } from './seating';

it('preserves the authored log raster and places both contacts from its cropped ground pivot', () => {
  const source = createSeatLog({ length: 2.25, seatTop: .25, seed: 317 });
  const blueprint = VoxelBlueprintSchema.parse(createMarketSeatLog());
  expect(rasterizeBlueprint(blueprint).voxels).toEqual(source.asset.voxels);
  expect(blueprint.size).toEqual(source.asset.size);
  expect(MARKET_SEAT_LOG_GROUND).toEqual(source.anchor);
  const [x, y, z] = source.anchor;
  expect(blueprint.seats).toEqual([-4, 4].map((offset, i) => ({
    id: i === 0 ? 'left' : 'right', position: [x + offset, y + 2, z],
    approach: [x + offset, y, z + 9], rest: [x + offset, y, z + 2], facing: 0,
  })));
});
