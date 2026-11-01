import { describe, expect, it } from 'vitest';
import { actDice, concedeDice, diceView, HEARTH_DICE, startDice, tickDice, type DiceState } from './dice';

const START = 10_000;
function withOpening(wanted: readonly number[]): DiceState {
  for (let seed = 0; seed < 10_000; seed++) {
    const state = startDice('hearth', seed, START, 4), probe = structuredClone(state);
    if (wanted.every(die => {
      actDice(probe, probe.turn, probe.revision, 'roll', START);
      return probe.die === die;
    })) return state;
  }
  throw new Error('No opening found');
}

describe('authoritative Hearth Dice', () => {
  it('starts exactly two to four seats and rejects invalid start parameters', () => {
    for (const players of [2, 3, 4]) {
      expect(diceView(startDice('hearth', 0xffff_ffff, START, players))).toMatchObject({
        phase: 'playing', scores: Array(players).fill(0), active: Array(players).fill(true),
        revision: 0, turn: 0, pot: 0, die: null, deadline: START + 30_000, winner: null, reason: null, last: null,
      });
    }
    for (const players of [-1, 0, 1, 5, 2.5, NaN, Infinity]) expect(() => startDice('hearth', 1, START, players)).toThrow();
    for (const seed of [-1, NaN, Infinity, .5, 0x1_0000_0000]) expect(() => startDice('hearth', seed, START, 2)).toThrow();
    for (const now of [-1, NaN, Infinity, .5, Number.MAX_SAFE_INTEGER]) expect(() => startDice('hearth', 1, now, 2)).toThrow();
    for (const match of ['', 'a b', 'x'.repeat(129)]) expect(() => startDice(match, 1, START, 2)).toThrow();
  });

  it('lets a player push their luck and only banks the pot on hold', () => {
    const state = withOpening([4, 6]);
    expect(actDice(state, 0, 0, 'hold', START)).toBe(false);
    expect(actDice(state, 0, 0, 'roll', START + 100)).toBe(true);
    expect(state).toMatchObject({ turn: 0, scores: [0, 0, 0, 0], die: 4, pot: 4, last: 'roll', deadline: START + 30_100 });
    expect(actDice(state, 0, 1, 'roll', START + 200)).toBe(true);
    expect(state).toMatchObject({ turn: 0, scores: [0, 0, 0, 0], die: 6, pot: 10 });
    expect(actDice(state, 0, 2, 'hold', START + 300)).toBe(true);
    expect(state).toMatchObject({ turn: 1, scores: [10, 0, 0, 0], pot: 0, last: 'hold', revision: 3, deadline: START + 30_300 });
  });

  it('loses only the current pot on a one and passes to the next active seat', () => {
    const state = withOpening([5, 1]);
    state.scores[0] = 12;
    expect(concedeDice(state, 1, START)).toBe(true);
    expect(actDice(state, 0, state.revision, 'roll', START)).toBe(true);
    expect(state.pot).toBe(5);
    expect(actDice(state, 0, state.revision, 'roll', START)).toBe(true);
    expect(state).toMatchObject({ turn: 2, scores: [12, 0, 0, 0], pot: 0, die: 1, last: 'bust' });
  });

  it('completes legal two, three and four player games at fifty, never just on a roll', () => {
    for (const players of [2, 3, 4]) for (const seed of [0, 1, 12345, 0xffff_ffff]) {
      const state = startDice('hearth', seed, START, players);
      for (let moves = 0; moves < 10_000 && state.phase === 'playing'; moves++) {
        const action = state.pot >= 12 ? 'hold' : 'roll';
        const before = structuredClone(state);
        expect(actDice(state, state.turn, state.revision, action, START + moves)).toBe(true);
        if (action === 'roll') expect(state.scores).toEqual(before.scores);
      }
      expect(state.phase).toBe('finished');
      expect(state.reason).toBe('fifty');
      expect(state.winner).not.toBeNull();
      expect(state.scores[state.winner!]).toBeGreaterThanOrEqual(50);
      expect(state.scores.filter((_, seat) => seat !== state.winner).every(score => score < 50)).toBe(true);
      const final = structuredClone(state);
      expect(actDice(state, state.turn, state.revision, 'roll', START + 20_000)).toBe(false);
      expect(tickDice(state, state.deadline)).toBe(false);
      expect(concedeDice(state, state.turn, START + 20_000)).toBe(false);
      expect(state).toEqual(final);
    }
  });

  it('rejects stale, out-of-turn, inactive, malformed and late actions without mutation', () => {
    const state = withOpening([4]);
    actDice(state, 0, state.revision, 'roll', START + 10);
    concedeDice(state, 2, START + 10);
    const before = structuredClone(state);
    const rejected: [number, number, 'roll' | 'hold', number][] = [
      [1, state.revision, 'roll', START + 10], [2, state.revision, 'roll', START + 10],
      [-1, state.revision, 'roll', START + 10], [4, state.revision, 'roll', START + 10],
      [.5, state.revision, 'roll', START + 10], [NaN, state.revision, 'roll', START + 10],
      [0, state.revision - 1, 'roll', START + 10], [0, state.revision + 1, 'roll', START + 10],
      [0, NaN, 'roll', START + 10], [0, Infinity, 'roll', START + 10], [0, .5, 'roll', START + 10],
      [0, state.revision, 'invalid' as 'roll', START + 10],
      ...[NaN, Infinity, -1, START, START + .5, state.deadline, state.deadline + 1].map(now => [0, state.revision, 'roll', now] as [number, number, 'roll', number]),
    ];
    for (const args of rejected) {
      expect(actDice(state, ...args)).toBe(false);
      expect(state).toEqual(before);
    }
  });

  it('passes empty expired turns on their original cadence with bounded no-input work', () => {
    const state = startDice('hearth', 1, START, 3);
    expect(tickDice(state, state.deadline - 1)).toBe(false);
    for (const now of [NaN, Infinity, -1, .5]) expect(tickDice(state, now)).toBe(false);
    expect(tickDice(state, START + 3 * HEARTH_DICE.turnMs)).toBe(true);
    expect(state).toMatchObject({ turn: 0, revision: 3, deadline: START + 4 * HEARTH_DICE.turnMs,
      scores: [0, 0, 0], phase: 'playing', cursor: 0, last: 'timeout' });
    const distant = START + 1000 * HEARTH_DICE.turnMs;
    expect(tickDice(state, distant)).toBe(true);
    expect(state.revision).toBe(259);
    expect(state.deadline).toBe(START + 260 * HEARTH_DICE.turnMs);
    while (state.deadline <= distant) tickDice(state, distant);
    expect(state).toMatchObject({ revision: 1000, turn: 1, phase: 'playing', winner: null, reason: null, cursor: 0 });
    expect(state.deadline).toBe(distant + HEARTH_DICE.turnMs);
    expect(tickDice(state, distant)).toBe(false);
  });

  it('auto-holds the pot at the exact deadline and can win with an honest timeout bank', () => {
    const state = withOpening([4]);
    actDice(state, 0, 0, 'roll', START + 100);
    const deadline = state.deadline;
    expect(tickDice(state, deadline)).toBe(true);
    expect(state).toMatchObject({ scores: [4, 0, 0, 0], pot: 0, turn: 1, last: 'timeout', deadline: deadline + 30_000 });
    const winning = withOpening([4]);
    winning.scores[0] = 47;
    actDice(winning, 0, 0, 'roll', START);
    expect(winning.phase).toBe('playing');
    tickDice(winning, winning.deadline + 90_000);
    expect(winning).toMatchObject({ scores: [51, 0, 0, 0], phase: 'finished', winner: 0, reason: 'fifty', last: 'timeout', revision: 2 });
  });

  it('concedes once, preserves another player’s clock and pot, then skips departed seats', () => {
    const state = withOpening([4]);
    actDice(state, 0, 0, 'roll', START);
    const deadline = state.deadline;
    expect(concedeDice(state, 1, START + 100)).toBe(true);
    expect(state).toMatchObject({ turn: 0, pot: 4, deadline, active: [true, false, true, true] });
    const before = structuredClone(state);
    for (const seat of [1, -1, 4, .5, NaN]) expect(concedeDice(state, seat, START + 100)).toBe(false);
    for (const now of [NaN, Infinity, -1, .5]) expect(concedeDice(state, 0, now)).toBe(false);
    expect(state).toEqual(before);
    expect(concedeDice(state, 0, START + 200)).toBe(true);
    expect(state).toMatchObject({ turn: 2, pot: 0, scores: [0, 0, 0, 0], deadline: START + 30_200 });
    expect(concedeDice(state, 3, START + 300)).toBe(true);
    expect(state).toMatchObject({ phase: 'finished', active: [false, false, true, false], winner: 2, reason: 'conceded', last: 'conceded' });
    const final = structuredClone(state);
    expect(concedeDice(state, 2, START + 400)).toBe(false);
    expect(state).toEqual(final);
  });

  it('restores seed, cursor, revision and absolute clock exactly from a serialized snapshot', () => {
    const original = withOpening([4, 6]);
    actDice(original, 0, 0, 'roll', START + 123);
    const restored = JSON.parse(JSON.stringify(original)) as DiceState;
    expect(restored.deadline).toBe(START + 30_123);
    expect(tickDice(restored, restored.deadline - 1)).toBe(false);
    for (let moves = 0; moves < 100 && original.phase === 'playing'; moves++) {
      const action = original.pot >= 15 ? 'hold' : 'roll';
      const now = START + 124 + moves;
      expect(actDice(original, original.turn, original.revision, action, now)).toBe(true);
      expect(actDice(restored, restored.turn, restored.revision, action, now)).toBe(true);
      expect(restored).toEqual(original);
    }
    expect(tickDice(restored, restored.deadline)).toBe(tickDice(original, original.deadline));
    expect(restored).toEqual(original);
    // This seed's first mixed uint32 is 0xffffffff: rejection consumes it before rolling a legal face.
    const rejectedDraw = startDice('hearth', 938589107, START, 2);
    actDice(rejectedDraw, 0, 0, 'roll', START);
    expect(rejectedDraw.cursor).toBe(2);
    expect(rejectedDraw.die).toBe(2);
  });

  it('projects only public fields and copies every mutable array', () => {
    const state = startDice('hearth', 12345, START, 2);
    expect(diceView(state)).toEqual(diceView(startDice('hearth', 98765, START, 2)));
    actDice(state, 0, 0, 'roll', START);
    const view = diceView(state), before = structuredClone(state);
    expect(Object.keys(view).sort()).toEqual(['match', 'phase', 'revision', 'scores', 'active', 'turn', 'pot', 'die', 'deadline', 'winner', 'reason', 'last'].sort());
    expect(view).not.toHaveProperty('seed');
    expect(view).not.toHaveProperty('cursor');
    (view.scores as number[])[0] = 100;
    (view.active as boolean[])[0] = false;
    expect(state).toEqual(before);
  });
});
