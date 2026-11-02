import { describe, expect, it } from 'vitest';
import { matchOpenKingdom } from './open-kingdoms';

const willowmere = { kingdomId: '129634568', name: 'Willowmere', login: 'tobi4s_' };

describe('matchOpenKingdom', () => {
  it('finds an open kingdom by its channel login or its kingdom name, however it is typed', () => {
    for (const query of ['tobi4s_', 'TOBI4S_', ' @tobi4s_ ', 'Willowmere', 'willowmere']) expect(matchOpenKingdom([willowmere], query)).toBe(willowmere);
  });
  it('never offers a kingdom for a partial or different name', () => {
    for (const query of ['', '  ', 'tobi', 'tobi4s', 'willow', 'shroud']) expect(matchOpenKingdom([willowmere], query)).toBeNull();
    expect(matchOpenKingdom([], 'tobi4s_')).toBeNull();
  });
});
