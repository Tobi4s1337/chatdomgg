import { describe, expect, it } from 'vitest';
import type { WindowHouse } from '@chatdom/render';
import { StyleIdSchema, type VoxelBlueprint } from '@chatdom/shared';

const VOXEL_FIXTURE: VoxelBlueprint = { version: 1, id: 'fixture:window', styleId: StyleIdSchema.parse('hearth'), kind: 'civic', lattice: 'build', size: [16, 24, 8], boxes: [], windows: [{ id: 'presence', centre: [8, 14, 8], width: 8, height: 12, facing: 'south' }] };
import { REALM_CASTLE_SLOT } from '@chatdom/shared/realm';
import { royalWindow } from './royal-window';

describe('royalWindow', () => {
  it('selects one lowest world-south authored pane without altering the keep', () => {
    const north = { ...VOXEL_FIXTURE.windows[0]!, id: 'north', facing: 'north' as const };
    const upper = { ...VOXEL_FIXTURE.windows[0]!, id: 'upper', centre: [8, 18, 8] as [number, number, number] };
    const low = { ...VOXEL_FIXTURE.windows[0]!, id: 'low' };
    const blueprint = { ...VOXEL_FIXTURE, windows: [north, upper, low] };
    const keep: WindowHouse = { slot: REALM_CASTLE_SLOT, blueprint, position: [2, 0, 4], yaw: 0 };
    const result = royalWindow([keep]);
    expect(result?.blueprint.windows).toEqual([low]);
    expect(result?.blueprint.windows[0]).toBe(low);
    expect(keep.blueprint.windows).toEqual([north, upper, low]);
    expect(result?.blueprint.boxes).toBe(blueprint.boxes);
    expect(result?.position).toBe(keep.position);
    expect(royalWindow([])).toBeUndefined();
    expect(royalWindow([{ ...keep, yaw: Math.PI / 2 }])).toBeUndefined();
    expect(royalWindow([{ ...keep, yaw: Math.PI }])?.blueprint.windows).toEqual([north]);
  });
});
