import { describe, expect, it } from 'vitest';
import { TavernPortalSchema, createThresholdWatch, insideTavernThreshold, KingdomIdSchema, type Vec3 } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import { createGrowthCivicForm } from '../growth-civic';
import { TAVERN_INTERIOR_ENTRY, TAVERN_INTERIOR_EXIT, exteriorTavernDoorway, foundedTavernPortal, yawByteFacing, TAVERN_EXTERIOR_PLACEMENT } from './portal';

const turnPoint = (origin: Vec3, turn: 0 | 1 | 2 | 3, [x, y, z]: Vec3): Vec3 => {
  const [rx, rz] = turn === 0 ? [x, z] : turn === 1 ? [z, -x] : turn === 2 ? [-x, -z] : [-z, x];
  return [origin[0] + rx, origin[1] + y, origin[2] + rz];
};
const facing = (yaw: number) => [Math.sin(yaw * Math.PI / 128), Math.cos(yaw * Math.PI / 128)] as const;

describe('the tavern door portal', () => {
  it('finds the carved public doorway at every growth level and turn, crossed inward and returned facing out', () => {
    for (const level of [1, 2, 3, 4]) for (const style of ['hearth', 'tide'] as const) for (const rotation of [0, 1, 2, 3] as const) {
      const form = createGrowthCivicForm('tavern', style, level), position: Vec3 = [12.5, 3, -40];
      const doorway = exteriorTavernDoorway({ position, rotation }, form)!;
      const label = `${style} level ${level} turn ${rotation}`;
      expect(doorway, label).not.toBeNull();
      // The authored 1 m doorway is local x 3.5..4.5 m on the +Z face, its sill .375 m above the site.
      expect(doorway.centre, label).toEqual([4, .375, 3]);
      const outward = turnPoint([0, 0, 0], rotation, [0, 0, 1]);
      expect(doorway.threshold.through[0], label).toBeCloseTo(-outward[0]);
      expect(doorway.threshold.through[1], label).toBeCloseTo(-outward[2]);
      const [fx, fz] = facing(doorway.yaw);
      expect(fx * outward[0] + fz * outward[2], label).toBeGreaterThan(.999);
      // A body in the opening is on the threshold; the street outside and the hollow beyond it are not.
      expect(insideTavernThreshold(doorway.threshold, turnPoint(position, rotation, [4, .375, 2.875])), label).toBe(true);
      expect(insideTavernThreshold(doorway.threshold, turnPoint(position, rotation, [4, .375, 3.625])), label).toBe(false);
      expect(insideTavernThreshold(doorway.threshold, turnPoint(position, rotation, [4, .375, 1])), label).toBe(false);
      expect(insideTavernThreshold(doorway.threshold, turnPoint(position, rotation, [2.5, .375, 2.875])), label).toBe(false);
      for (const candidate of doorway.outside) expect(insideTavernThreshold(doorway.threshold, candidate), label).toBe(false);
    }
  });

  it('places the interior arrival a step in from the exit, facing the room, never on the threshold', () => {
    expect(insideTavernThreshold(TAVERN_INTERIOR_EXIT, TAVERN_INTERIOR_ENTRY.feet)).toBe(false);
    expect(TAVERN_INTERIOR_EXIT.through).toEqual([0, 1]);
    expect(facing(TAVERN_INTERIOR_ENTRY.yaw)[1]).toBeCloseTo(-1);
    expect(insideTavernThreshold(TAVERN_INTERIOR_EXIT, [7, .125, 9.6])).toBe(true);
    expect(yawByteFacing(1, 0)).toBe(64);
    expect(yawByteFacing(0, -1)).toBe(128);
    expect(yawByteFacing(-1, 0)).toBe(192);
  });

  it('fires once per crossing, never for a body that arrives on the threshold', () => {
    const watch = createThresholdWatch(TAVERN_INTERIOR_EXIT);
    expect(watch([7, .125, 9.6])).toBe(false);
    expect(watch([7, .125, 9.65])).toBe(false);
    expect(watch([7, .125, 8.8])).toBe(false);
    expect(watch([7, .125, 9.5])).toBe(true);
    expect(watch([7, .125, 9.6])).toBe(false);
    expect(watch([7, .125, 9.0])).toBe(false);
    expect(watch([7, .125, 9.4])).toBe(true);
    expect(watch([Number.NaN, .125, 9.4])).toBe(false);
  });

  it('offers no door for an absent tavern or a blocked forecourt, and refuses a stale collision revision', () => {
    const kingdomId = KingdomIdSchema.parse('900000004'), form = createGrowthCivicForm('tavern', 'hearth', 1);
    const open: CollisionWorld = { revision: 3, query: () => [] };
    const scene = { collisionRevision: 3, assets: [{ assetHash: 'a'.repeat(64), blueprint: form }],
      placements: [{ id: TAVERN_EXTERIOR_PLACEMENT, assetHash: 'a'.repeat(64), position: [0, 1, 0] as Vec3, rotation: 2 as const }] };
    const portal = foundedTavernPortal({ kingdomId, scene, world: open, standingClear: () => true })!;
    expect(TavernPortalSchema.parse(portal)).toEqual(portal);
    expect(portal.returnAnchor).toEqual({ feet: [-4, 1.375, -3.625], yaw: 128 });
    expect(portal.source).toEqual({ placement: TAVERN_EXTERIOR_PLACEMENT, collisionRevision: 3 });
    expect(foundedTavernPortal({ kingdomId, scene, world: open, standingClear: () => false })).toBeNull();
    expect(foundedTavernPortal({ kingdomId, scene: { ...scene, placements: [] }, world: open, standingClear: () => true })).toBeNull();
    expect(() => foundedTavernPortal({ kingdomId, scene, world: { ...open, revision: 4 }, standingClear: () => true })).toThrow();
  });
});
