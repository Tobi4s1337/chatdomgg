import { describe, expect, it } from 'vitest';
import { standingClear, withinReach } from '@chatdom/world/interactions';
import { TAVERN_FLOOR } from '../../../../packages/content/src/tavern';
import { createTavernInterior, TAVERN_ENTRY } from './interior';

describe('tavern destination', () => {
  it('installs all ten chairs with safe approaches and a reachable interaction', () => {
    const { kit, registry, world } = createTavernInterior();
    expect(kit.tables).toHaveLength(5);
    expect(registry.disabled).toEqual([]);
    expect(registry.targets()).toHaveLength(12);
    for (const { id, approach, position, reach, kind } of registry.targets()) {
      expect(kind, id).toBe('tavern-seat');
      expect(standingClear(world, approach), id).toBe(true);
      expect(withinReach(world, approach, { position, reach }), id).toBe(true);
      expect(registry.get(id)?.zone, id).toBe('tavern:main');
    }
  });

  it('spawns on a clear supported floor and stops bodies at walls and furniture', () => {
    const { kit, world } = createTavernInterior();
    expect(standingClear(world, TAVERN_ENTRY.feet)).toBe(true);
    for (const feet of [[.3, TAVERN_FLOOR, 5], [13.7, TAVERN_FLOOR, 5], [7, TAVERN_FLOOR, .3]] as const) {
      expect(standingClear(world, feet)).toBe(false);
    }
    for (const table of kit.tables) {
      expect(standingClear(world, [table.centre[0], TAVERN_FLOOR, table.centre[2]]), table.id).toBe(false);
    }
  });

  it('has a walkable floor route from the entry to every authored chair approach', () => {
    const { registry, world } = createTavernInterior();
    const step = .125;
    const key = (x: number, z: number) => `${x},${z}`;
    const startX = Math.round(TAVERN_ENTRY.feet[0] / step), startZ = Math.round(TAVERN_ENTRY.feet[2] / step);
    const queue: [number, number][] = [[startX, startZ]], seen = new Set([key(startX, startZ)]);
    for (let i = 0; i < queue.length; i++) {
      const [x, z] = queue[i]!;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, nz = z + dz, id = key(nx, nz);
        if (nx < 0 || nx > 112 || nz < 0 || nz > 80 || seen.has(id)) continue;
        if (!standingClear(world, [nx * step, TAVERN_FLOOR, nz * step])) continue;
        seen.add(id); queue.push([nx, nz]);
      }
    }
    for (const target of registry.targets()) {
      const [x, , z] = target.approach;
      expect(seen.has(key(Math.round(x / step), Math.round(z / step))), target.id).toBe(true);
    }
  });
});
