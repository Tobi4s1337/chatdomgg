import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type VoxelBlueprint } from '@chatdom/shared';
import { WALK_BODY } from '@chatdom/shared/realm';
import { standingClear, withinReach } from '../../../world/src/interactions';
import { createTavernInterior, TAVERN_ENTRY } from '../../../../apps/realm/src/games/interior';
import { MAT, MATERIALS, STYLES } from '../materials';
import { createTavernKit, TAVERN_DOOR, TAVERN_FLOOR, TAVERN_ROOM_BOUNDS, type TavernSolid } from './index';

const ids = new Set(MATERIALS.materials.map(material => material.id));
const step = 0.125, radius = WALK_BODY.radius;
function blocked(x: number, z: number, solids: readonly TavernSolid[]): boolean {
  return solids.some(({ min, max }) => x + radius > min[0] && x - radius < max[0] && z + radius > min[2] && z - radius < max[2]);
}
/** Flood a walker's footprint from outside the door to each chair approach and the bar. */
function reachable(solids: readonly TavernSolid[]): Set<string> {
  const start = [56, 79] as const, queue: [number, number][] = [[...start]], seen = new Set<string>();
  for (let head = 0; head < queue.length; head++) {
    const [x, z] = queue[head]!, key = `${x},${z}`;
    if (seen.has(key) || x < 0 || x > 112 || z < 0 || z > 80 || blocked(x * step, z * step, solids)) continue;
    seen.add(key);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) queue.push([x + dx, z + dz]);
  }
  return seen;
}

function voxelAt(blueprint: VoxelBlueprint, x: number, y: number, z: number): number {
  let value = 0;
  for (const box of blueprint.boxes) {
    if (x >= box.from[0] && x < box.to[0] && y >= box.from[1] && y < box.to[1] && z >= box.from[2] && z < box.to[2]) value = box.material;
  }
  return value;
}

describe('authored tavern', () => {
  it('keeps each layer valid, deterministic and in its civic palette', () => {
    const legal = new Set<number>([STYLES.hearth.wall, STYLES.hearth.roof, STYLES.hearth.trim, STYLES.hearth.stone,
      STYLES.tide.wall, STYLES.tide.roof, STYLES.tide.trim, STYLES.tide.stone]);
    // Registered common wood, stone, fabric and furnishing accents used in the civic kit.
    for (const id of [MAT.air, MAT.brass, MAT.cloth, MAT.glass, MAT.darkStone, MAT.cream, MAT.bark, MAT.fabricMutedRed, MAT.fabricMutedBlue, MAT.fabricMutedGold]) legal.add(id);
    for (const style of ['hearth', 'tide'] as const) {
      const kit = createTavernKit(style);
      expect(kit).toEqual(createTavernKit(style));
      expect(Object.values(kit.pieces)).toHaveLength(5);
      for (const piece of Object.values(kit.pieces)) {
        expect(VoxelBlueprintSchema.safeParse(piece).success).toBe(true);
        expect(piece.boxes.length).toBeGreaterThan(0);
        for (const box of piece.boxes) {
          expect(ids.has(box.material)).toBe(true);
          expect(legal.has(box.material)).toBe(true);
        }
      }
    }
  });

  it('installs twelve reachable seats in the actual interior collision and interaction registry', () => {
    const { kit, registry, world } = createTavernInterior();
    expect(kit.tables.map(table => [table.id, table.seats.length])).toEqual([
      ['west', 2], ['hearth', 4], ['middle', 2], ['east', 2], ['corner', 2],
    ]);
    expect(registry.disabled).toEqual([]);
    expect(registry.targets()).toHaveLength(12);
    const key = (x: number, z: number) => `${x},${z}`;
    const start: [number, number] = [Math.round(TAVERN_ENTRY.feet[0] / step), Math.round(TAVERN_ENTRY.feet[2] / step)];
    const queue: [number, number][] = [start], seen = new Set([key(...start)]);
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
      expect(standingClear(world, target.approach), target.id).toBe(true);
      expect(withinReach(world, target.approach, target), target.id).toBe(true);
      expect(seen.has(key(Math.round(target.approach[0] / step), Math.round(target.approach[2] / step))), target.id).toBe(true);
    }
  });

  it('leaves a walkable doorway, each unique chair approach and the bar accessible', () => {
    const { tables, solids, pieces } = createTavernKit('hearth');
    expect(TAVERN_ROOM_BOUNDS).toEqual([14, 10]);
    expect(TAVERN_DOOR.width).toBeGreaterThan(2 * radius);
    expect(tables).toHaveLength(5);
    expect(tables.filter(table => table.corner)).toHaveLength(1);
    const seats = tables.flatMap(table => table.seats);
    expect(new Set(seats.map(seat => seat.key)).size).toBe(12);
    const seen = reachable(solids);
    for (const seat of seats) {
      const [x, y, z] = seat.approach;
      expect(y).toBe(TAVERN_FLOOR);
      expect(voxelAt(pieces.room, seat.position[0] / step, 4, seat.position[2] / step), seat.key).not.toBe(0);
      expect(voxelAt(pieces.room, x / step, 1, z / step), seat.key).toBe(0);
      expect(blocked(x, z, solids), seat.key).toBe(false);
      expect(seen.has(`${x / step},${z / step}`), seat.key).toBe(true);
    }
    for (let y = 1; y < 23; y++) for (let z = 75; z < 78; z++)
      expect(voxelAt(pieces.front, 56, y, z)).toBe(0);
    expect(seen.has('25,19')).toBe(true); // In front of the bar.
  });
});
