import { describe, expect, it } from 'vitest';
import { generateKingdom } from '@chatdom/world';
import { createSettlementContent } from './settlement-content';

describe('installed kingdom content', () => {
  it.each(['hamlet', 'town'] as const)('places reviewed Hearth homes and passive garden edges in the %s', tier => {
    const layout = generateKingdom({ seed: 'willowmere', tier, firstYear: tier === 'town' ? 2022 : 2025, year: 2026 });
    const { houses, props } = createSettlementContent(layout);
    expect(houses).toHaveLength(layout.homes.length);
    expect(houses.some(h => h.blueprint.id.startsWith('home-hearth-'))).toBe(true);
    expect(props.length).toBeGreaterThan(0);
    for (const h of houses) {
      const plot = layout.homes.find(p => p.slot === h.slot)!;
      const turn = plot.rotation === 0 ? 1 : -1;
      const front = h.position[2] + turn * h.blueprint.size[2] * .125;
      expect(Math.abs(front - (plot.rotation === 0 ? plot.lot.maxZ : plot.lot.minZ))).toBeLessThan(1e-8);
      expect(h.blueprint.windows.length).toBeGreaterThan(0);
      if (plot.style === 'hearth' && plot.tier !== 'manor' && plot.tier !== 'hall') expect(h.blueprint.id).toMatch(/^home-hearth-(emberfold|bramblecross|heatherstead)-/);
    }
    for (const p of props) {
      expect(p.blueprint.kind).toBe('prop');
      expect(p.blueprint.windows).toEqual([]);
      const turn = p.yaw === 0 ? 1 : -1;
      const x1 = p.position[0], x2 = x1 + turn * p.blueprint.size[0] * .125;
      const z1 = p.position[2], z2 = z1 + turn * p.blueprint.size[2] * .125;
      const minX = Math.min(x1, x2), maxX = Math.max(x1, x2), minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);
      // Every reserved lot (including the not-yet-built rear) remains free.
      expect(layout.homes.some(h => minX < h.lot.maxX && maxX > h.lot.minX && minZ < h.lot.maxZ && maxZ > h.lot.minZ)).toBe(false);
      const q = layout.quarters.find(q => minZ < q.streetZ + 4 && maxZ > q.streetZ - 4)!;
      expect(q).toBeDefined();
      expect(Math.min(Math.abs(minZ - q.streetZ), Math.abs(maxZ - q.streetZ))).toBeGreaterThanOrEqual(1.75);
    }
  });
});
