import { describe, expect, it } from 'vitest';
import { makeWorld } from '../data/fixtures.test-support';
import { geographyOf } from '../data/model';
import { MAX_SCALE } from '../map/camera';
import * as overlay from '../map/overlay';
import * as wash from '../map/wash';
import * as still from './compose';

/**
 * The still restates the overlay's and the wash's rules so its chunk carries no Pixi. This holds both copies to the
 * same numbers: a rule changed on the moving map fails here until the still follows it.
 */
const scales = Array.from({ length: 160 }, (_, i) => 0.02 * 1.045 ** i).filter((scale) => scale <= MAX_SCALE);

describe('the still draws by the moving map’s rules', () => {
  it('uses the same faces and limits', () => {
    expect(still.FACE_TEXT).toBe(overlay.FACE_TEXT);
    expect(still.FACE_CAPS).toBe(overlay.FACE_CAPS);
    expect(still.FACE_ITALIC).toBe(overlay.FACE_ITALIC);
    expect(still.SHIELD_LIMIT).toBe(overlay.SHIELD_LIMIT);
    expect(still.STAMP_SCALE).toEqual(overlay.STAMP_SCALE);
    expect(still.MARKED_TIERS).toEqual(overlay.MARKED_TIERS);
    expect(still.REALM_LABEL_FROM).toBe(overlay.REALM_LABEL_FROM);
  });

  it('marks, stamps and letters at the same distances', () => {
    for (const scale of scales) {
      expect(still.markedTiers(scale)).toBe(overlay.markedTiers(scale));
      expect(still.regionLabelFade(scale)).toBe(overlay.regionLabelFade(scale));
      expect(still.realmLabelFade(scale)).toBe(overlay.realmLabelFade(scale));
      for (let tier = 0; tier < 4; tier++) {
        expect(still.stampVisible(tier, scale)).toBe(overlay.stampVisible(tier, scale));
        expect(still.stampPx(tier, 6, scale)).toBe(overlay.stampPx(tier, 6, scale));
      }
    }
    for (const r of [10, 100, 300]) expect(still.realmLabelPx(r)).toBe(overlay.realmLabelPx(r));
    const realms = geographyOf(makeWorld()).realms;
    expect(still.labelledRealms(realms)).toEqual(overlay.labelledRealms(realms));
    for (const name of ['Just Chatting & IRL', 'The Crossroads', 'Shooters']) expect(still.realmLines(name)).toBe(overlay.realmLines(name));
  });

  it('washes with the same pigment', () => {
    expect(still.WASH_RADIUS).toEqual(wash.WASH_RADIUS);
    expect(still.WASH_PX).toEqual(wash.WASH_PX);
    expect(still.WASH_ALPHA).toEqual(wash.WASH_ALPHA);
    expect(still.DENSITY_ALPHA).toEqual(wash.DENSITY_ALPHA);
    expect(still.DENSITY_CAP).toBe(wash.DENSITY_CAP);
    expect(still.CLOSE_WASH_LIMIT).toEqual(wash.CLOSE_WASH_LIMIT);
    for (const scale of scales) {
      expect(still.washDetail(scale)).toBe(wash.washDetail(scale));
      expect(still.washSoftening(scale)).toBe(wash.washSoftening(scale));
      for (let liveClass = 1; liveClass <= 5; liveClass++) expect(still.washPx(liveClass, scale)).toBe(wash.washPx(liveClass, scale));
    }
  });
});
