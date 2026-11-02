import { describe, expect, it } from 'vitest';
import { waitingWords } from './waiting';

const willowmere = { kingdomId: '129634568', name: 'Willowmere', login: 'tobi4s_' };

describe('waitingWords', () => {
  it('gives a founded kingdom the survey has not drawn its name, a true note and the way in', () => {
    const words = waitingWords(willowmere, false);
    expect(words.status).toBe('Founded · Willowmere');
    expect(words.note).toBe("Willowmere is founded and open to visit. The map draws its land with the Atlas's next edition.");
    expect(words.enter).toEqual({ label: 'Enter Willowmere', href: '/kingdom/129634568' });
    expect(`${words.status} ${words.note}`).not.toMatch(/no land|pencilled/i);
  });
  it('says a founded kingdom is on air while its channel streams', () => {
    expect(waitingWords(willowmere, true).status).toBe('On air · Willowmere');
    expect(waitingWords(willowmere, true).enter?.href).toBe('/kingdom/129634568');
  });
  it('keeps the pencil note and offers no way in for a channel without a kingdom, or while the list is read', () => {
    for (const founded of [null, undefined]) {
      expect(waitingWords(founded, false)).toEqual({
        status: 'Waiting · no land of its own',
        note: 'Pencilled into the realm of its language and game. This place stays the same until the channel claims land.',
        enter: null,
      });
      expect(waitingWords(founded, true).status).toBe('On air · no land of its own');
    }
  });
});
