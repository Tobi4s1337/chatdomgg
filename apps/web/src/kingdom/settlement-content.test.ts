import { describe, expect, it } from 'vitest';
import { generateKingdom, homeFrame, transformCardinalPoint } from '@chatdom/world';
import { HOME_DEPTH_METRES, HomeTierSchema } from '@chatdom/shared';
import { HOME_REVIEW } from '../../../../packages/content/src/homes/hearth';
import { createSettlementContent, placeSettlementContent } from './settlement-content';

describe('installed kingdom content', () => {
  it('leaves a 1.5 metre route directly outside every authored front door', () => {
    for (const style of ['hearth', 'tide'] as const) for (const tier of HomeTierSchema.options) for (const variant of [0, 1, 2] as const) for (const rotation of [0, 1, 2, 3] as const) {
      const plot = { slot: 7, ordinal: 0, position: [10,0,20] as const, rotation, tier, style, variant };
      const { houses, props } = placeSettlementContent([plot], () => 0);
      const home = houses[0]!;
      const door = style === 'hearth' ? HOME_REVIEW[home.blueprint.id]!.entrance[0] / 8 : (variant === 1 ? 18 : variant === 2 ? 39 : 29) / 8;
      for (const prop of props) {
        const relative = transformCardinalPoint([0,0,0], ((4 - rotation) % 4) as 0 | 1 | 2 | 3,
          [prop.position[0] - home.position[0], prop.position[1] - home.position[1], prop.position[2] - home.position[2]]);
        for (const box of prop.blueprint.boxes) {
          if (!box.material) continue;
          const x0 = relative[0] + box.from[0] / 8, x1 = relative[0] + box.to[0] / 8;
          const z0 = relative[2] + box.from[2] / 8, z1 = relative[2] + box.to[2] / 8;
          expect(x0 < door + .75 && x1 > door - .75 && z0 < home.blueprint.size[2] / 8 + 3 && z1 > home.blueprint.size[2] / 8,
            `${style}/${tier}/${variant}/${rotation}: ${prop.blueprint.id} obstructs the entrance`).toBe(false);
        }
      }
    }
  });
  it('aligns actual home fronts and grounds garden props for all four cardinal turns', () => {
    for (const rotation of [0, 1, 2, 3] as const) {
      const plot = { slot: 7, ordinal: 0, position: [10,8,20] as const, rotation, tier: 'house' as const, style: 'hearth' as const, variant: 0 };
      const ground = (x: number, z: number) => 0.1 * x + 0.2 * z;
      const { houses, props } = placeSettlementContent([plot], ground);
      const house = houses[0]!;
      const front = transformCardinalPoint(house.position, rotation, [4, 0, house.blueprint.size[2] * .125]);
      expect(front).toEqual(homeFrame(plot).front);
      expect(house.slot).toBe(7);
      expect(props.length).toBeGreaterThan(0);
      for (const prop of props) {
        const centre = transformCardinalPoint(prop.position, rotation, [prop.blueprint.size[0] / 16, 0, prop.blueprint.size[2] / 16]);
        expect(prop.position[1]).toBeCloseTo(ground(centre[0], centre[2]));
      }
    }
  });
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
      if (plot.style === 'hearth') expect(h.blueprint.id).toMatch(/^home-hearth-(emberfold|bramblecross|heatherstead)-/);
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
  it('uses the completed Hearth family for every growth tier, retaining its address and first window', () => {
    const layout = generateKingdom({ seed: 'lanternmere', tier: 'hamlet', firstYear: 2025, year: 2026 });
    const plot = layout.homes.find(home => home.style === 'hearth')!;
    const anchors = HomeTierSchema.options.map(tier => {
      const { houses } = createSettlementContent({ ...layout, homes: [{ ...plot, tier, allowedDepth: HOME_DEPTH_METRES[tier] }] });
      const house = houses[0]!;
      expect(house.slot).toBe(plot.slot);
      expect(house.blueprint.id).toMatch(new RegExp(`^home-hearth-(emberfold|bramblecross|heatherstead)-${tier}$`));
      return { position: house.position, yaw: house.yaw, window: house.blueprint.windows[0] };
    });
    expect(anchors.every(anchor => JSON.stringify(anchor) === JSON.stringify(anchors[0]))).toBe(true);
  });
});
