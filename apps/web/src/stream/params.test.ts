import { describe, expect, it } from 'vitest';
import { parseKingdomPresentationParams, parseStreamParams } from './params';

describe('public kingdom presentation', () => {
  it('selects the read-only realm source and waits for its approved name', () => {
    expect(parseStreamParams('?source=realm&kingdom=129634568&seed=pretend-name&hour=19.5')).toMatchObject({
      source: 'realm', kingdomId: '129634568', kingdomName: 'Kingdom', hour: 19.5,
    });
  });
  it('preserves the existing demonstration layouts when no coordinates are supplied', () => {
    expect(parseKingdomPresentationParams(new URLSearchParams(), 'hamlet')).toEqual({ firstYear: 2025, year: 2026 });
    expect(parseKingdomPresentationParams(new URLSearchParams(), 'town')).toEqual({ firstYear: 2022, year: 2026 });
  });

  it('matches the real channel layout, numeric kingdom and slot zero in both surfaces', () => {
    const search = '?source=herald&seed=tobi4s_&tier=hamlet&firstYear=2026&year=2026&kingdom=129634568&focusSlot=0';
    expect(parseStreamParams(search)).toMatchObject({ source: 'herald', seed: 'tobi4s_', tier: 'hamlet', firstYear: 2026,
      year: 2026, kingdomId: '129634568', focusSlot: 0, time: null });
    expect(parseKingdomPresentationParams(new URLSearchParams(search), 'hamlet')).toEqual({ firstYear: 2026, year: 2026,
      kingdomId: '129634568', focusSlot: 0 });
  });

  it('does not admit malformed identity, slots or unbounded founding ranges', () => {
    for (const search of ['firstYear=2027&year=2026', 'firstYear=1000&year=9999', 'firstYear=-1&year=NaN']) {
      expect(parseKingdomPresentationParams(new URLSearchParams(search), 'town')).toEqual({ firstYear: 2022, year: 2026 });
    }
    for (const slot of ['-1', '65535', '1.2', '01', 'NaN']) {
      expect(parseKingdomPresentationParams(new URLSearchParams(`kingdom=someone&focusSlot=${slot}`), 'hamlet')).toEqual({ firstYear: 2025, year: 2026 });
    }
  });

  it('allows a real citizen camera on stage while retaining window framing in small formats', () => {
    expect(parseStreamParams('?source=herald&camera=citizen').camera).toBe('citizen');
    expect(parseStreamParams('?source=herald&camera=citizen&layout=strip').camera).toBe('window');
  });
});
