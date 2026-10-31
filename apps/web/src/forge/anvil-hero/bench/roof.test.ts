import { describe, expect, it } from 'vitest';
import { createHearthHome, createHome, createTideHome } from '@chatdom/content';
import { rasterizeBlueprint } from '@chatdom/voxel';
import { placeRoofDragon } from './dragon-scene';
import { checkMountedDragon, mountSleepingDragon } from './roof';

const homes = { hearth: (v: 0 | 1 | 2) => createHearthHome('house', v), tide: (v: 0 | 1 | 2) => createTideHome('house', v), grove: (v: 0 | 1 | 2) => createHome('house', 'grove', v) };

describe('the sleeping dragon on real roofs', () => {
  for (const style of ['hearth', 'tide', 'grove'] as const) for (const variant of [0, 1, 2] as const) it(`${style} home ${variant} takes the dragon through the real chimney assembly`, () => {
    const home = homes[style](variant), mounted = mountSleepingDragon(home, style);
    const { solidCells, palette } = checkMountedDragon(mounted, home);
    expect(solidCells).toBeGreaterThan(900);
    expect(palette.length).toBeLessThanOrEqual(9);
    // The landed smoke starts in open air just outside the nose, in the host's own frame.
    const asset = rasterizeBlueprint(mounted.blueprint), [sx, sy] = asset.size, local = mounted.emitter.map((n, i) => n - mounted.socket.origin[i]!);
    const at = (x: number, y: number, z: number) => asset.voxels[x + sx * (y + sy * z)]!;
    expect(at(local[0]!, local[1]!, local[2]!)).toBe(0);
    expect(at(local[0]! + 1, local[1]!, local[2]!)).toBe(0);
    expect(at(local[0]! + 1, local[1]! + 1, local[2]!)).not.toBe(0);
  });

  it('names honestly which side of the ridge each kit\'s socket puts the dragon', () => {
    const side = (style: 'hearth' | 'tide' | 'grove') => placeRoofDragon(style, { blueprint: homes[style](1), position: [0, 0, 0], yaw: 0 }).side;
    // Hearth sockets sit on the rear slope today: the street cannot see that dragon (reported to main).
    expect(side('hearth')).toBe('lane');
    expect(side('tide')).toBe('street');
    expect(side('grove')).toBe('street');
  });
});
