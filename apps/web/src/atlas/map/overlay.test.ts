import { describe, expect, it } from 'vitest';
import { DISTANCE_SCALE, MAX_SCALE } from './camera';
import { MARKED_TIERS, markedTiers, STAMP_SCALE, stampPx, stampVisible } from './overlay';
import { decorBand, DECOR_SPACING } from './pyramid';

const HOLDING_RADIUS = [6, 3.4, 1.8, 1.25] as const; // world units, as in a real survey preview

describe('stampPx', () => {
  it('draws a holding about its own diameter wide, within each tier’s limits', () => {
    expect(stampPx(0, 6, 5)).toBeCloseTo(2 * 6 * 5 * 1.05, 9); // 63 px, inside [30, 132]
    expect(stampPx(0, 6, 0.1)).toBe(30);
    expect(stampPx(0, 6, MAX_SCALE)).toBe(132);
    expect(stampPx(3, 1.25, 0.5)).toBe(14);
    expect(stampPx(3, 1.25, MAX_SCALE)).toBe(64);
  });

  it('grows with the zoom and never shrinks', () => {
    for (let tier = 0; tier < 4; tier++) {
      let previous = 0;
      for (let scale = 0.05; scale <= MAX_SCALE; scale *= 1.05) {
        const px = stampPx(tier, HOLDING_RADIUS[tier]!, scale);
        expect(px).toBeGreaterThanOrEqual(previous);
        previous = px;
      }
    }
  });

  it('never draws a smaller tier larger than a bigger one at the same zoom', () => {
    for (let scale = 0.05; scale <= MAX_SCALE; scale *= 1.05) {
      for (let tier = 1; tier < 4; tier++) {
        expect(stampPx(tier, HOLDING_RADIUS[tier]!, scale)).toBeLessThanOrEqual(stampPx(tier - 1, HOLDING_RADIUS[tier - 1]!, scale));
      }
    }
  });
});

describe('stampVisible', () => {
  it('shows capitals always and each smaller tier from its distance on', () => {
    expect(STAMP_SCALE).toEqual([0, DISTANCE_SCALE.continent, DISTANCE_SCALE.realm, DISTANCE_SCALE.kingdom]);
    expect(stampVisible(0, 0.05)).toBe(true);
    expect(stampVisible(1, DISTANCE_SCALE.continent - 1e-9)).toBe(false);
    expect(stampVisible(1, DISTANCE_SCALE.continent)).toBe(true);
    expect(stampVisible(2, DISTANCE_SCALE.realm - 1e-9)).toBe(false);
    expect(stampVisible(2, DISTANCE_SCALE.realm)).toBe(true);
    expect(stampVisible(3, DISTANCE_SCALE.kingdom - 1e-9)).toBe(false);
    expect(stampVisible(3, DISTANCE_SCALE.kingdom)).toBe(true);
    expect(stampVisible(3, MAX_SCALE)).toBe(true);
  });

  it('never shows a smaller tier while hiding a bigger one', () => {
    for (let scale = 0.05; scale <= MAX_SCALE; scale *= 1.03) {
      for (let tier = 1; tier < 4; tier++) if (stampVisible(tier, scale)) expect(stampVisible(tier - 1, scale)).toBe(true);
    }
  });
});

describe('markedTiers', () => {
  it('has one entry per decor band and never marks fewer tiers when zooming in', () => {
    expect(MARKED_TIERS).toHaveLength(DECOR_SPACING.length);
    for (let i = 1; i < MARKED_TIERS.length; i++) expect(MARKED_TIERS[i]).toBeGreaterThanOrEqual(MARKED_TIERS[i - 1]!);
    expect(markedTiers(0.05)).toBe(1);
    expect(markedTiers(MAX_SCALE)).toBe(4);
  });

  it('marks on paper every tier whose stamp is drawn, so decor is kept clear of it', () => {
    for (let scale = 0.05; scale <= MAX_SCALE; scale *= 1.01) {
      const marked = markedTiers(scale);
      expect(marked).toBe(MARKED_TIERS[decorBand(scale)]);
      for (let tier = 0; tier < 4; tier++) if (stampVisible(tier, scale)) expect(tier, `scale ${scale}`).toBeLessThan(marked);
    }
  });
});
