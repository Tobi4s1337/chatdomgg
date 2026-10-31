import { describe, expect, it } from 'vitest';
import { geographyOf, type GeoRealm } from '../data/model';
import { makeWorld } from '../data/fixtures.test-support';
import { DISTANCE_SCALE, MAX_SCALE } from './camera';
import {
  clusterLabelFade, clusterLabelPx, labelledRealms, MARKED_TIERS, markedTiers, REALM_LABEL_FROM, realmLabelFade, realmLabelPx, realmLines, regionLabelFade,
  STAMP_SCALE, stampPx, stampVisible,
} from './overlay';
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

const scales = (step = 1.02) => {
  const out: number[] = [];
  for (let scale = 0.05; scale <= MAX_SCALE; scale *= step) out.push(scale);
  return out;
};

describe('label fades across the four distances', () => {
  it('writes no realm name at world distance, where the continents are named', () => {
    for (const scale of scales()) if (scale <= REALM_LABEL_FROM) expect(realmLabelFade(scale), `scale ${scale}`).toBe(0);
    expect(regionLabelFade(DISTANCE_SCALE.continent)).toBe(1);
  });

  it('names realms fully across the continent distance and lets them go before kingdom distance', () => {
    expect(realmLabelFade(REALM_LABEL_FROM * 1.5)).toBe(1);
    expect(realmLabelFade(DISTANCE_SCALE.continent)).toBe(1);
    expect(realmLabelFade(DISTANCE_SCALE.realm)).toBe(1);
    expect(realmLabelFade(DISTANCE_SCALE.realm * 2)).toBeGreaterThan(0);
    expect(realmLabelFade(DISTANCE_SCALE.realm * 2)).toBeLessThan(1);
    expect(realmLabelFade(DISTANCE_SCALE.kingdom)).toBe(0);
    expect(realmLabelFade(MAX_SCALE)).toBe(0);
  });

  it('keeps game patches unnamed until realm distance, then names them until well into kingdom distance', () => {
    for (const scale of scales()) if (scale < DISTANCE_SCALE.realm * 0.85) expect(clusterLabelFade(scale), `scale ${scale}`).toBe(0);
    expect(clusterLabelFade(DISTANCE_SCALE.realm * 1.15)).toBe(1);
    expect(clusterLabelFade(DISTANCE_SCALE.kingdom)).toBe(1);
    expect(clusterLabelFade(DISTANCE_SCALE.kingdom + 8)).toBe(0);
  });

  it('never fades a label in and out again: each rises once and falls once', () => {
    for (const fade of [regionLabelFade, realmLabelFade, clusterLabelFade]) {
      let turns = 0;
      let previous = fade(0.05);
      let rising = true;
      for (const scale of scales(1.01)) {
        const value = fade(scale);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
        if (rising && value < previous - 1e-12) {
          rising = false;
          turns++;
        } else if (!rising && value > previous + 1e-12) turns++;
        previous = value;
      }
      expect(turns, fade.name).toBeLessThanOrEqual(1);
    }
  });

  it('sets a patch name smaller than any realm name, whatever their size on screen', () => {
    let largestPatch = 0;
    let smallestRealm = Infinity;
    for (let r = 0; r <= 2000; r += 5) {
      largestPatch = Math.max(largestPatch, clusterLabelPx(r));
      smallestRealm = Math.min(smallestRealm, realmLabelPx(r));
    }
    expect(largestPatch).toBeLessThan(smallestRealm);
    expect(realmLabelPx(50)).toBeLessThanOrEqual(realmLabelPx(400));
  });
});

describe('labelledRealms', () => {
  it('names the family realms, the Crossroads and the Wilds, never an isle or the Outer Isles', () => {
    const names = labelledRealms(geographyOf(makeWorld()).realms).map((realm) => realm.name);
    expect(names).toEqual(['Just Chatting & IRL', 'The Crossroads', 'Arenas & MOBAs', 'The Wilds']);
  });

  it('places the biggest first and breaks ties by index, whatever order they arrive in', () => {
    const realm = (index: number, members: number): GeoRealm => ({ index, region: 0, kind: 'family', family: index, name: `R${index}`, x: 0, y: 0, r: 1, members });
    const realms = [realm(0, 5), realm(1, 9), realm(2, 5), realm(3, 9), realm(4, 1)];
    const order = labelledRealms(realms).map((r) => r.index);
    expect(order).toEqual([1, 3, 0, 2, 4]);
    expect(labelledRealms([...realms].reverse()).map((r) => r.index)).toEqual(order);
  });
});

describe('realmLines', () => {
  it('breaks a long name near its middle, before the ampersand where it can', () => {
    expect(realmLines('Sports, Racing & Simulators')).toBe('Sports, Racing\n& Simulators');
    expect(realmLines('Roleplay & Open Worlds')).toBe('Roleplay\n& Open Worlds');
    expect(realmLines('Online Worlds')).toBe('Online\nWorlds');
  });

  it('leaves a single word whole', () => {
    expect(realmLines('Shooters')).toBe('Shooters');
  });
});
