import { describe, expect, it } from 'vitest';
import { benchQuery, parseBench } from './params';

describe('place bench inputs', () => {
  it('defaults to the dusk court arrival with SIMULATED neighbours at home and round-trips its query', () => {
    const state = parseBench('');
    expect(state).toEqual({ place: 'court', view: 'court-arrive', hour: 18.5, time: 30, occupied: true, stones: null, target: null, tier: 'town' });
    expect(parseBench(`?${benchQuery(state)}`)).toEqual(state);
    expect(parseBench('?view=court-town&hour=12&occupied=0&tier=hamlet')).toMatchObject({ view: 'court-town', hour: 12, occupied: false, tier: 'hamlet' });
  });

  it('refuses unknown, repeated, mismatched and unfinished inputs instead of defaulting', () => {
    expect(() => parseBench('?colour=red')).toThrow(/Unknown bench input/);
    expect(() => parseBench('?view=court-town&view=court-arrive')).toThrow(/once/);
    expect(() => parseBench('?view=court-sky')).toThrow(/Unknown view/);
    expect(() => parseBench('?view=hill-summit')).toThrow(/no finished pieces/);
    expect(() => parseBench('?place=forest&view=court-town')).toThrow(/belongs to the court/);
    expect(() => parseBench('?hour=25')).toThrow(/hour/);
    expect(() => parseBench('?time=-1')).toThrow(/time/);
    expect(() => parseBench('?occupied=yes')).toThrow(/occupied/);
    expect(() => parseBench('?stones=4')).toThrow(/lookout/);
    expect(() => parseBench('?target=1')).toThrow(/telescope/);
    expect(() => parseBench('?tier=city')).toThrow(/tier/);
  });
});
