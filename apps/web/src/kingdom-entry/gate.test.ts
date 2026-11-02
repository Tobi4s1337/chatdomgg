import { describe, expect, it } from 'vitest';
import { gateKingdom, gateWords } from './gate';

describe('the walk-in gate', () => {
  it('reads its kingdom from its own address, and nothing that is not a kingdom', () => {
    expect(gateKingdom('?walk=1&kingdom=129634568')).toBe('129634568');
    expect(gateKingdom('?walk=1&kingdom=129634568&signin=declined')).toBe('129634568');
    for (const search of ['?walk=1', '?walk=1&kingdom=', '?walk=1&kingdom=0', '?walk=1&kingdom=12a', '?walk=1&kingdom=../map']) expect(gateKingdom(search), search).toBeNull();
  });

  it('says what happened and what to do next in every resting state, in the kingdom’s voice', () => {
    for (const state of ['opening', 'waiting', 'lost', 'refused', 'closed'] as const) {
      for (const name of ['Willowmere', null]) {
        const { title, words } = gateWords(state, name);
        expect(title.length, state).toBeGreaterThan(5);
        expect(words.split(/\s+/).length, `${state}: ${words}`).toBeLessThanOrEqual(30);
        expect(`${title} ${words}`).not.toMatch(/SIMULATED|error|undefined|null/i);
      }
    }
    expect(gateWords('waiting', 'Willowmere')).toEqual({ title: 'Your place is waiting.',
      words: 'Sign in with Twitch to walk into Willowmere and find your home. Twitch tells us only your public name.' });
    expect(gateWords('closed', null).title).toBe('The gate could not open.');
    expect(gateWords('closed', null, true).words).toContain('offline');
    expect(gateWords('refused', null).words).toMatch(/^The kingdom did not/);
  });
});
