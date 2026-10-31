import { describe, expect, it } from 'vitest';
import type { WindowHouse } from '@chatdom/render';
import { StyleIdSchema, type VoxelBlueprint } from '@chatdom/shared';

const VOXEL_FIXTURE: VoxelBlueprint = { version: 1, id: 'fixture:window', styleId: StyleIdSchema.parse('hearth'), kind: 'civic', lattice: 'build', size: [16, 24, 8], boxes: [], windows: [{ id: 'presence', centre: [8, 14, 8], width: 8, height: 12, facing: 'south' }] };
import { REALM_CASTLE_SLOT } from '@chatdom/shared/realm';
import { royalWindow } from './royal-window';
import { composeRoyalCamera } from './royal-camera';
import { windowOccluded } from './visibility';
import { createCastle } from '@chatdom/content';
import { createCastlePlan } from '@chatdom/world';
import { createCastleContent } from './castle-content';

describe('royalWindow', () => {
  it('uses the visible upper western lancet below the beacon, preserving the owned keep geometry', () => {
    const blueprint = createCastle('tide'), before = JSON.stringify(blueprint);
    const keep: WindowHouse = { slot: REALM_CASTLE_SLOT, blueprint, position: [-16, 20, -80], yaw: 0 };
    const result = royalWindow([keep])!;
    expect(result.blueprint.windows).toEqual([{ id: 'monarch-upper-lancet', centre: [117.5, 155, 139.04], width: 5, height: 8, facing: 'south' }]);
    const eye = composeRoyalCamera(keep).eye.toArray() as [number, number, number];
    const pane = result.blueprint.windows[0]!;
    const panePoint: [number, number, number] = [keep.position[0] + pane.centre[0] / 8,
      keep.position[1] + pane.centre[1] / 8, keep.position[2] + pane.centre[2] / 8 + .006];
    expect(windowOccluded(createCastleContent(createCastlePlan()).buildings, eye, panePoint)).toBe(false);
    expect(result.blueprint.boxes).toBe(blueprint.boxes);
    expect(JSON.stringify(blueprint)).toBe(before);
  });
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
