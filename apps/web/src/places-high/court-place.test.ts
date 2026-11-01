import { describe, expect, it } from 'vitest';
import { foundKingdomGeography, transformCardinalPoint } from '@chatdom/world';
import { createCastleContent } from '../kingdom/castle-content';
// Relative source import until the integrator registers the collection's package export (spec 30, Contracts).
import { createCastleCourtPlace } from '../../../../packages/content/src/places-high/index';

/** The actual founded land (spec 27) and the castle modules the kingdom builds from it. */
const land = foundKingdomGeography({ seed: 'chatdom', tier: 'town', firstYear: 2022, year: 2026 });
const { buildings } = createCastleContent(land.castle, 'tide');
const footprint = (position: readonly number[], turn: number, size: readonly number[]) => {
  const a = transformCardinalPoint(position as [number, number, number], turn as 0 | 1 | 2 | 3, [0, 0, 0]);
  const b = transformCardinalPoint(position as [number, number, number], turn as 0 | 1 | 2 | 3, [size[0]!, 0, size[2]!]);
  return { minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minZ: Math.min(a[2], b[2]), maxZ: Math.max(a[2], b[2]) };
};
const modules = land.castle.modules.map(m => ({ id: m.id, ...footprint(m.position, m.rotation, m.size) }));
const overlaps = (a: ReturnType<typeof footprint>, b: ReturnType<typeof footprint>) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const inside = (p: readonly number[], b: ReturnType<typeof footprint>) => p[0]! > b.minX && p[0]! < b.maxX && p[2]! > b.minZ && p[2]! < b.maxZ;

describe('the court on the founded land', () => {
  const court = createCastleCourtPlace(land.places.court, 'tide');

  it('floors exactly the supplied court at its elevation, edge to edge with the keep', () => {
    const [west, east] = court.placements;
    const covered = [west!, east!].map(p => footprint(p.position, p.turn, p.blueprint.size.map(n => n / 8)));
    expect({ minX: covered[0]!.minX, maxX: covered[1]!.maxX, minZ: covered[0]!.minZ, maxZ: covered[0]!.maxZ }).toEqual(court.bounds);
    expect(court.floorTop - land.places.court.elevation).toBe(.125);
    const keep = modules.find(m => m.id === land.castle.beaconModuleId)!;
    expect(keep.maxZ).toBe(court.bounds.minZ);
  });

  it('stands the well and crest on open court, clear of every castle module, gate passage and the keep landing', () => {
    expect(buildings).toHaveLength(land.castle.modules.length);
    for (const piece of court.placements.filter(p => p.blocker)) {
      const area = footprint(piece.position, piece.turn, piece.blueprint.size.map(n => n / 8));
      expect(area.minX >= court.bounds.minX && area.maxX <= court.bounds.maxX && area.minZ >= court.bounds.minZ && area.maxZ <= court.bounds.maxZ, piece.id).toBe(true);
      for (const module of modules) expect(overlaps(area, module), `${piece.id} × ${module.id}`).toBe(false);
    }
  });

  it('puts every place to stand on the flags, outside the walls and the pieces themselves', () => {
    expect(court.interactions.map(a => a.id)).toEqual(['draw-water', 'read-crest']);
    for (const anchor of court.interactions) {
      expect(anchor.stand[1]).toBe(court.floorTop);
      expect(inside(anchor.stand, court.bounds), anchor.id).toBe(true);
      for (const module of modules) expect(inside(anchor.stand, module), `${anchor.id} in ${module.id}`).toBe(false);
      for (const piece of court.placements.filter(p => p.blocker)) {
        expect(inside(anchor.stand, footprint(piece.position, piece.turn, piece.blueprint.size.map(n => n / 8))), `${anchor.id} in ${piece.id}`).toBe(false);
      }
    }
  });

  it('keeps the way from the gate to the keep door open down the court axis', () => {
    const way = court.keepClear.find(c => c.id === 'processional-way')!;
    const { gate, keepDoor } = land.places.court;
    expect(way.minX < gate[0] && way.maxX > gate[0] && way.minX < keepDoor[0] && way.maxX > keepDoor[0]).toBe(true);
    expect([way.minZ, way.maxZ]).toEqual([court.bounds.minZ, court.bounds.maxZ]);
  });
});
