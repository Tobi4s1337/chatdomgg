import { describe, expect, it } from 'vitest';
import { matchFoundedChannel, matchOpenKingdom } from './open-kingdoms';

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

describe('matchFoundedChannel', () => {
  it("finds a channel's own kingdom by its login", () => {
    for (const login of ['tobi4s_', 'TOBI4S_', '@tobi4s_']) expect(matchFoundedChannel([willowmere], login)).toBe(willowmere);
  });
  it("never gives a channel a kingdom that only shares its name", () => {
    for (const login of ['willowmere', 'Willowmere', '', 'tobi4s']) expect(matchFoundedChannel([willowmere], login)).toBeNull();
  });
});
