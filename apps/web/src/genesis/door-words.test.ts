import { describe, expect, it } from 'vitest';
import { DoorRefusal, doorFailureWords, foundedDoor } from './door-words';

describe('the door into a land', () => {
  it('shows a refusal in its own words and logs nothing', () => {
    expect(doorFailureWords(new DoorRefusal('This channel has no holding on the current survey of the Atlas.')))
      .toEqual({ words: 'This channel has no holding on the current survey of the Atlas.', log: false });
  });

  it('never shows a transport or parser cause', () => {
    for (const cause of [
      new Error('Reading the kingdom’s adopted land returned HTTP 502 no content type; expected JSON.'),
      new TypeError('Failed to fetch'),
      new Error('The adopted-land read answered HTTP 503.'),
      'a string',
      undefined,
    ]) {
      const failure = doorFailureWords(cause);
      expect(failure.log).toBe(true);
      expect(failure.words).toBe('The road into this land could not be opened just now. Try again in a moment.');
      expect(failure.words).not.toMatch(/HTTP|JSON|fetch|undefined/);
    }
  });

  it('names a founded kingdom on its door', () => {
    expect(foundedDoor({ name: 'Willowmere', login: 'tobi4s_' }))
      .toEqual({ name: 'Willowmere', subtitle: 'tobi4s_’s kingdom', eyebrow: 'Founded kingdom' });
  });
});
