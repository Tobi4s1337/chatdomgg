import { describe, expect, it } from 'vitest';
import { VOXEL_METRES } from '@chatdom/shared';
import { generateSettlementPlan, terrainHeight, transformCardinalPoint } from '@chatdom/world';
import { enrichNativeMarket } from './market-furnishings';
import { createNativeTown, type NativePiece } from './native';

function footprint(piece: NativePiece) {
  const corners = [0, piece.blueprint.size[0] * VOXEL_METRES.build].flatMap(x =>
    [0, piece.blueprint.size[2] * VOXEL_METRES.build].map(z => transformCardinalPoint(piece.position, piece.rotation, [x, 0, z])));
  return { minX: Math.min(...corners.map(p => p[0])), maxX: Math.max(...corners.map(p => p[0])),
    minZ: Math.min(...corners.map(p => p[2])), maxZ: Math.max(...corners.map(p => p[2])) };
}

describe('native market furnishings', () => {
  it('adds reviewed wares to a SIMULATED town while retaining every native identity and clear footprint', () => {
    const plan = generateSettlementPlan({ seed: 'willowmere', tier: 'town', firstYear: 2022, year: 2026 });
    const native = createNativeTown(plan), enriched = enrichNativeMarket(plan, native);
    const additions = enriched.fixtures.slice(native.fixtures.length);
    expect(additions).toHaveLength(2);
    expect(enriched.homes).toBe(native.homes);
    expect(enriched.revision).toBe(native.revision);
    native.fixtures.forEach((fixture, i) => expect(enriched.fixtures[i]).toBe(fixture));
    expect(enrichNativeMarket(plan, enriched)).toBe(enriched);
    expect(enrichNativeMarket(plan, native)).toEqual(enriched);
    const occupied = [...native.homes.values(), ...native.fixtures];
    for (const piece of additions) {
      expect(piece.id).toMatch(/^market:wares:v1:[01]:(gift-cart|market-stores)$/);
      expect(piece.blueprint.id).toMatch(/^civic-hearth-(gift-cart|market-stores)$/);
      const box = footprint(piece), x = (box.minX + box.maxX) / 2, z = (box.minZ + box.maxZ) / 2;
      expect(Math.abs(terrainHeight(plan, x, z) - piece.position[1])).toBeLessThanOrEqual(.125);
      for (const other of occupied) {
        const b = footprint(other);
        expect(box.minX < b.maxX && box.maxX > b.minX && box.minZ < b.maxZ && box.maxZ > b.minZ,
          `${piece.id} overlaps ${other.id}`).toBe(false);
      }
      occupied.push(piece);
    }
    const absent = { ...native, fixtures: native.fixtures.filter(piece => !piece.id.startsWith('market:stall:')) };
    expect(enrichNativeMarket(plan, absent)).toBe(absent);
  }, 15_000);
});
