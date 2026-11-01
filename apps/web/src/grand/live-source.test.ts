import { describe, expect, it } from 'vitest';
import { grandLiveSelection } from './live-source';

const select = (query: string) => grandLiveSelection(new URLSearchParams(query));

describe('grand public identity', () => {
  it('only selects the adopted kingdom, including its canonical channel alias', () => {
    for (const query of ['', 'channel=TOBI4S_', 'kingdom=129634568', 'channel=tobi4s_&kingdom=129634568']) {
      const result = select(query);
      expect(result?.kingdomId).toBe('129634568');
      expect(result?.recipe.seed.kingdomId).toBe('129634568');
    }
    for (const query of ['channel=other', 'kingdom=123', 'channel=tobi4s_&kingdom=123', 'channel=&kingdom=129634568']) {
      expect(select(query)).toBeNull();
    }
  });

  it('bounds hour input and ignores seed, simulated and benchmark overrides', () => {
    for (const value of ['', 'NaN', 'Infinity', '-0.1', '24.1', 'abc']) {
      expect(select(`hour=${encodeURIComponent(value)}`)?.hour).toBe(17.5);
    }
    for (const value of [0, 12.25, 24]) expect(select(`hour=${value}`)?.hour).toBe(value);
    expect(select('seed=other&source=simulated&bench=1')).toEqual(select(''));
  });
});
