import { describe, expect, it } from 'vitest';
import { NEUTRAL_COLOURS } from '../../../../../packages/content/src/genesis-heraldry';
import { bannerBlueprint, dressKingdom, hangBanner, kingdomLivery, type KingdomLivery } from './dress';
import { loadGrandKingdomContent } from './pieces';

const CELL = 0.125;
const snapped: KingdomLivery = { treatment: 'snapped', colours: { field: 44, charge: 18, border: 12 }, cut: 'forked', charge: 'star' };

describe('the kingdom banners', () => {
  it('cuts the channel’s cloth at half resolution inside its blueprint, border unbroken', () => {
    const banner = bannerBlueprint(snapped, 'tide');
    for (const box of banner.boxes) for (let axis = 0; axis < 3; axis++) {
      expect(box.from[axis]).toBeGreaterThanOrEqual(0);
      expect(box.to[axis]).toBeLessThanOrEqual(banner.size[axis]!);
      expect(box.from[axis]).toBeLessThan(box.to[axis]!);
    }
    const materials = new Set(banner.boxes.map(box => box.material));
    for (const tincture of [44, 18, 12]) expect(materials.has(tincture)).toBe(true);
    // The forked hem leaves a gap in the middle of the bottom row.
    const bottom = banner.boxes.filter(box => box.from[1] === 0);
    expect(bottom.length).toBe(2);
  });

  it('shows no charge on a neutral livery, and claims nothing for a kingdom with no observed colours', () => {
    const livery = kingdomLivery({ recipe: null, landscape: null, style: 'hearth' });
    expect(livery).toEqual({ treatment: 'neutral', colours: NEUTRAL_COLOURS.hearth, cut: 'square', charge: null });
    const banner = bannerBlueprint(livery, 'hearth');
    expect(banner.boxes.some(box => box.material === NEUTRAL_COLOURS.hearth.charge && box.from[1] < 28)).toBe(false);
  });

  it('hangs the bar’s middle at the anchor, a cell proud of it, whichever way it faces', () => {
    const banner = bannerBlueprint(snapped, 'tide');
    for (const facing of [0, Math.PI / 2, 2.3, -1.1]) {
      const anchor = { id: 't', position: [10, 20, -5] as [number, number, number], facing };
      const { position, yaw } = hangBanner(banner, anchor);
      const local = [banner.size[0] * CELL / 2, 0, -CELL];
      // Local → world, three.js rotation about +Y.
      const x = position[0] + local[0]! * Math.cos(yaw) + local[2]! * Math.sin(yaw);
      const z = position[2] - local[0]! * Math.sin(yaw) + local[2]! * Math.cos(yaw);
      expect(x).toBeCloseTo(10, 6);
      expect(z).toBeCloseTo(-5, 6);
      expect(position[1] + (banner.size[1] - 1.5) * CELL).toBeCloseTo(20, 6);
    }
  });
});

describe('a Genesis kingdom’s walls', () => {
  it('raises The_AGGman’s walls on the coast with the channel’s own cloth on them', async () => {
    const kingdom = await loadGrandKingdomContent('the_aggman');
    const dressing = dressKingdom(kingdom);
    expect(dressing.walls.gates.length).toBeGreaterThan(0);
    expect(dressing.walls.spans.some(span => span.kind === 'water' || span.kind === 'open' || span.kind === 'wall')).toBe(true);
    const banners = dressing.placements.filter(placement => placement.id.startsWith('banner:'));
    expect(banners.length).toBe(dressing.walls.bannerAnchors.length);
    expect(banners.length).toBeGreaterThan(0);
    expect(dressing.livery.treatment).toBe(kingdom.recipe?.identity.profileColourTargets.length ? 'snapped' : 'neutral');
  }, 300_000);
});
