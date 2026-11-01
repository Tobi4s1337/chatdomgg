import { describe, expect, it } from 'vitest';
import { checkEarned, parseLook } from '@chatdom/content/avatar-style';
import { simulatedPassport } from '../../../../packages/ui/src/passport/craft';
import { SITTER, SITTER_LOOK, SITTER_RECORDS, SITTER_WORN } from './sitter';

describe('the SIMULATED sitter', () => {
  it('wears only what their verified records allow, as a look that saves', () => {
    expect(checkEarned(SITTER_LOOK, SITTER_RECORDS)).toEqual([]);
    expect(parseLook(JSON.parse(JSON.stringify(SITTER_LOOK)))).toEqual(SITTER_LOOK);
    expect(SITTER_WORN.map(offer => offer.piece.family).sort()).toEqual(['hood', 'pin', 'ribbons', 'scarf']);
  });

  it('is the passport holder, and the pin is a keepsake in that passport', () => {
    const book = simulatedPassport('many');
    expect(book.holder).toEqual({ personId: SITTER.personId, name: SITTER.name });
    const pin = SITTER_LOOK.earned.pins[0];
    expect(pin?.kind).toBe('keepsake');
    expect(book.keepsakes.items.some(item => pin?.kind === 'keepsake' && item.id === pin.id)).toBe(true);
    expect(SITTER_RECORDS.origin).toBe('simulated');
  });
});
