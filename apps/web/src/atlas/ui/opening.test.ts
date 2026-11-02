// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { OPENING_LINE, OPENING_SEEN_KEY, takeOpening, WAY_IN_LABEL } from './opening';

function memory(): Pick<Storage, 'getItem' | 'setItem'> & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) };
}

describe('the map’s invitation into Chatdom', () => {
  it('reads the opening caption on a first visit only', () => {
    const storage = memory();
    expect(takeOpening(storage)).toBe(true);
    expect(storage.values.get(OPENING_SEEN_KEY)).toBe('1');
    expect(takeOpening(storage)).toBe(false);
  });

  it('stays quiet without storage or when storage refuses', () => {
    expect(takeOpening(null)).toBe(false);
    const refusing = { getItem: () => { throw new Error('denied'); }, setItem: () => undefined };
    expect(takeOpening(refusing)).toBe(false);
  });

  it('says what the map is and where to go, in the founder’s words', () => {
    expect(OPENING_LINE).toBe('Every Twitch channel is a kingdom on this map. Step into one.');
    expect(WAY_IN_LABEL).toBe('Walk into a kingdom');
  });
});
