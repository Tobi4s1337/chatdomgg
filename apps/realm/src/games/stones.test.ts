import { describe, expect, it } from 'vitest';
import { STONES, actStones, concedeStones, startStones, stonesView, tickStones, type StonesState } from './stones';

function play(columns: readonly number[], state = startStones('hearth', 12345, 1_000)): StonesState {
  for (const column of columns) {
    expect(actStones(state, state.turn, state.revision, column, state.deadline - 1)).toBe(true);
  }
  return state;
}
const draw = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 4, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 5];

describe('authoritative Stones', () => {
  it('starts seat zero on an empty bottom-up frame with an absolute deadline', () => {
    const state = startStones('hearth', 12345, 1_000);
    expect(stonesView(state)).toEqual({ match: 'hearth', phase: 'playing', revision: 0,
      board: Array(42).fill(0), turn: 0, deadline: 31_000, winner: null, reason: null, last: null, winning: [] });
    expect(actStones(state, 0, 0, 4, 2_000)).toBe(true);
    expect(state).toMatchObject({ revision: 1, turn: 1, deadline: 32_000, last: { column: 4, row: 0, seat: 0 } });
    expect(state.board[4]).toBe(1);
    expect(actStones(state, 1, 1, 4, 3_000)).toBe(true);
    expect(state.board[11]).toBe(2);
    expect(state.last).toEqual({ column: 4, row: 1, seat: 1 });
  });

  it.each([
    { name: 'horizontal through a gap', columns: [0, 6, 1, 6, 3, 5, 2], winner: 0, winning: [0, 1, 2, 3] },
    { name: 'seat one horizontal', columns: [6, 0, 6, 1, 5, 2, 5, 3], winner: 1, winning: [0, 1, 2, 3] },
    { name: 'vertical', columns: [0, 1, 0, 1, 0, 1, 0], winner: 0, winning: [0, 7, 14, 21] },
    { name: 'rising diagonal', columns: [0, 1, 1, 2, 4, 2, 2, 3, 4, 3, 5, 3, 3], winner: 0, winning: [0, 8, 16, 24] },
    { name: 'falling diagonal', columns: [6, 5, 5, 4, 2, 4, 4, 3, 2, 3, 1, 3, 3], winner: 0, winning: [6, 12, 18, 24] },
    { name: 'five joined by the last stone', columns: [0, 6, 1, 6, 3, 5, 4, 5, 2], winner: 0, winning: [0, 1, 2, 3, 4] },
  ])('finishes a $name', ({ columns, winner, winning }) => {
    const state = play(columns);
    expect(state).toMatchObject({ phase: 'finished', reason: 'four', winner, revision: columns.length, winning });
    expect(winning.every(cell => state.board[cell] === winner + 1)).toBe(true);
    const final = structuredClone(state);
    expect(actStones(state, state.turn, state.revision, 0, state.deadline - 1)).toBe(false);
    expect(tickStones(state, state.deadline + 100_000)).toBe(false);
    expect(concedeStones(state, 0)).toBe(false);
    expect(state).toEqual(final);
  });

  it('does not wrap a horizontal line across row boundaries', () => {
    const state = play([5, 0, 6, 1, 0, 4, 1]);
    expect([5, 6, 7, 8].map(cell => state.board[cell])).toEqual([1, 1, 1, 1]);
    expect(state).toMatchObject({ phase: 'playing', reason: null, winner: null, winning: [] });
  });

  it('draws only when the full frame has no four', () => {
    const state = play(draw.slice(0, -1));
    expect(state.phase).toBe('playing');
    expect(state.board.filter(cell => cell === 0)).toHaveLength(1);
    play(draw.slice(-1), state);
    expect(state).toMatchObject({ phase: 'finished', reason: 'draw', winner: null, revision: 42, winning: [] });
    expect(state.board.every(cell => cell === 1 || cell === 2)).toBe(true);
    expect(state.board.filter(cell => cell === 1)).toHaveLength(21);
    expect(state.board.filter(cell => cell === 2)).toHaveLength(21);
  });

  it('refuses full columns, wrong seats, stale, repeated, and malformed moves without mutation', () => {
    const state = play([3, 3, 3, 3, 3, 3]);
    const before = structuredClone(state);
    const now = state.deadline - 1;
    for (const column of [3, -1, 7, .5, NaN, Infinity]) {
      expect(actStones(state, state.turn, state.revision, column, now)).toBe(false);
      expect(state).toEqual(before);
    }
    for (const revision of [state.revision - 1, state.revision + 1, .5, NaN, Infinity]) {
      expect(actStones(state, state.turn, revision, 0, now)).toBe(false);
      expect(state).toEqual(before);
    }
    expect(actStones(state, 1, state.revision, 0, now)).toBe(false);
    expect(state).toEqual(before);
    for (const badClock of [NaN, Infinity, now + .5]) {
      expect(actStones(state, state.turn, state.revision, 0, badClock)).toBe(false);
      expect(tickStones(state, badClock)).toBe(false);
      expect(state).toEqual(before);
    }
    const revision = state.revision;
    expect(actStones(state, 0, revision, 0, now)).toBe(true);
    const accepted = structuredClone(state);
    expect(actStones(state, 1, revision, 1, now)).toBe(false);
    expect(state).toEqual(accepted);
  });

  it('accepts a move just before the deadline, but refuses it at or after the deadline', () => {
    const state = startStones('hearth', 1, 1_000), before = structuredClone(state);
    for (const now of [state.deadline, state.deadline + 1]) {
      expect(actStones(state, 0, 0, 0, now)).toBe(false);
      expect(state).toEqual(before);
    }
    expect(tickStones(state, state.deadline - 1)).toBe(false);
    expect(state).toEqual(before);
    expect(actStones(state, 0, 0, 0, state.deadline - 1)).toBe(true);
    expect(state.deadline).toBe(before.deadline - 1 + STONES.turnMs);
  });

  it('uses nearest-centre legal columns, breaking equal distance toward the lower column', () => {
    const state = startStones('hearth', 1, 1_000);
    for (const column of [3, 2, 4]) {
      for (let row = 0; row < 6; row++) {
        const deadline = state.deadline;
        expect(tickStones(state, deadline)).toBe(true);
        expect(state.last).toEqual({ column, row, seat: row % 2 });
        expect(state.deadline).toBe(deadline + STONES.turnMs);
        const before = structuredClone(state);
        expect(tickStones(state, deadline)).toBe(false);
        expect(state).toEqual(before);
      }
    }
    expect(state.revision).toBe(18);
    expect(tickStones(state, state.deadline)).toBe(true);
    expect(state.last).toEqual({ column: 1, row: 0, seat: 0 });
    expect(state).toMatchObject({ phase: 'finished', reason: 'four', winner: 0, winning: [1, 2, 3, 4] });
  });

  it('catches up missed deadlines without resetting the schedule and finishes with no input', () => {
    const state = startStones('hearth', 1, 1_000);
    expect(tickStones(state, 1_000 + 3 * STONES.turnMs + 500)).toBe(true);
    expect(state).toMatchObject({ revision: 3, deadline: 1_000 + 4 * STONES.turnMs,
      last: { column: 3, row: 2, seat: 0 } });
    const oneAtATime = startStones('hearth', 1, 1_000);
    while (oneAtATime.phase === 'playing') tickStones(oneAtATime, oneAtATime.deadline);
    expect(tickStones(state, Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(state).toEqual(oneAtATime);
    expect(state).toMatchObject({ phase: 'finished', revision: 19, reason: 'four', winner: 0,
      deadline: 1_000 + 20 * STONES.turnMs });
  });

  it('serializes and reloads the exact move, revision, turn, and remaining absolute clock', () => {
    const original = play([2, 4, 2]);
    const restored: StonesState = JSON.parse(JSON.stringify(original));
    const deadline = original.deadline;
    expect(stonesView(restored)).toEqual(stonesView(original));
    expect(tickStones(restored, deadline - 1)).toBe(false);
    expect(restored).toEqual(original);
    for (const state of [original, restored]) {
      expect(tickStones(state, deadline + 2 * STONES.turnMs + 123)).toBe(true);
      expect(state.deadline).toBe(deadline + 3 * STONES.turnMs);
      expect(actStones(state, state.turn, state.revision, 5, state.deadline - 10)).toBe(true);
      tickStones(state, Number.MAX_SAFE_INTEGER);
    }
    expect(restored).toEqual(original);
    expect(restored.phase).toBe('finished');
    expect(startStones('hearth', 1, 1_000)).toEqual(startStones('hearth', 999, 1_000));
  });

  it.each([0, 1] as const)('concedes seat %s once without dropping another stone', seat => {
    const state = play([3]);
    const before = structuredClone(state);
    expect(concedeStones(state, seat)).toBe(true);
    expect(state).toMatchObject({ phase: 'finished', reason: 'conceded', winner: seat === 0 ? 1 : 0,
      revision: before.revision + 1, deadline: before.deadline, board: before.board, last: before.last, winning: [] });
    const final = structuredClone(state);
    expect(concedeStones(state, seat === 0 ? 1 : 0)).toBe(false);
    expect(tickStones(state, Number.MAX_SAFE_INTEGER)).toBe(false);
    expect(state).toEqual(final);
  });

  it('copies all public arrays and the last move, and whitelists view fields', () => {
    const state = play([0, 6, 1, 6, 3, 5, 2]);
    Object.assign(state, { seed: 12345, cursor: 4, privateValue: 'server only' });
    const before = structuredClone(state), view = stonesView(state);
    expect(view).not.toHaveProperty('seed');
    expect(view).not.toHaveProperty('cursor');
    expect(view).not.toHaveProperty('privateValue');
    (view.board as number[])[0] = 99;
    (view.winning as number[]).push(99);
    (view.last as { row: number }).row = 99;
    expect(state).toEqual(before);
    expect(stonesView(startStones('empty', 1, 0)).last).toBeNull();
  });
});
