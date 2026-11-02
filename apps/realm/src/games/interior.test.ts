import { describe, expect, it } from 'vitest';
import { standingClear, withinReach } from '@chatdom/world/interactions';
import { TAVERN_FLOOR } from '../../../../packages/content/src/tavern';
import { ARRIVAL_SPACING, createTavernInterior, tavernArrival, TAVERN_ENTRY, TAVERN_EXIT } from './interior';
import { seatApproachDriver } from '../../../web/src/games/walker';

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

  it('gives each new arrival its own clear spot inside the door, away from the threshold, with a way to every chair', () => {
    const { world, registry } = createTavernInterior();
    expect(tavernArrival(world, [])).toEqual([...TAVERN_ENTRY.feet]);
    const standing: { x: number; z: number }[] = [];
    for (let n = 0; n < 11; n++) {
      const feet = tavernArrival(world, standing);
      expect(standingClear(world, feet), `arrival ${n}`).toBe(true);
      for (const other of standing) expect(Math.hypot(other.x - feet[0], other.z - feet[2]), `arrival ${n}`).toBeGreaterThanOrEqual(ARRIVAL_SPACING);
      expect(feet[2] < TAVERN_EXIT.min[2] || feet[0] < TAVERN_EXIT.min[0] || feet[0] > TAVERN_EXIT.max[0], `arrival ${n} is clear of the way out`).toBe(true);
      for (const target of registry.targets()) expect(() => seatApproachDriver(world, feet, target.approach, [14, 10]), `${n} → ${target.id}`).not.toThrow();
      standing.push({ x: feet[0], z: feet[2] });
    }
    // Someone who has walked on frees the entry for the next person.
    expect(tavernArrival(world, [{ x: 3, z: 6 }])).toEqual([...TAVERN_ENTRY.feet]);
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

  it('reaches every chair approach along a real aisle, never a one- or two-cell squeeze', () => {
    // Feet positions are already inset by the body's radius. Each step keeps three clear feet positions across the
    // direction of travel (a quarter metre, about 0.85 m wall to wall), so a person, not only an exact test walker,
    // gets there. The old hearth bench left one position behind the east table and the streamer's chair two.
    const { registry, world } = createTavernInterior();
    const step = .125, band = [-1, 0, 1];
    const clear = (x: number, z: number) => standingClear(world, [x * step, TAVERN_FLOOR, z * step]);
    const across = (x: number, z: number, dx: number) => dx ? band.every(dz => clear(x, z + dz)) : band.every(d => clear(x + d, z));
    const key = (x: number, z: number) => `${x},${z}`;
    const startX = Math.round(TAVERN_ENTRY.feet[0] / step), startZ = Math.round(TAVERN_ENTRY.feet[2] / step);
    const queue: [number, number][] = [[startX, startZ]], seen = new Set([key(startX, startZ)]);
    for (let i = 0; i < queue.length; i++) {
      const [x, z] = queue[i]!;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, nz = z + dz, id = key(nx, nz);
        if (nx < 0 || nx > 112 || nz < 0 || nz > 80 || seen.has(id) || !across(nx, nz, dx)) continue;
        seen.add(id); queue.push([nx, nz]);
      }
    }
    const squeezed = registry.targets().filter(target => {
      const x = Math.round(target.approach[0] / step), z = Math.round(target.approach[2] / step);
      // The approach itself may sit against its chair; the aisle must reach within a step of it.
      return ![[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => seen.has(key(x + dx!, z + dz!)));
    }).map(target => target.id);
    expect(squeezed).toEqual([]);
  });
});
