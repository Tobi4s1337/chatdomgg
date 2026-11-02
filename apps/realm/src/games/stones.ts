import type { StonesView } from '@chatdom/shared';

export const STONES = Object.freeze({ columns: 7, rows: 6, turnMs: 30_000 });
type Seat = 0 | 1;
export interface StonesState {
  match: string; phase: StonesView['phase']; revision: number;
  /** Row-major, with row zero at the bottom: zero is empty; seat plus one is a stone. */
  board: number[]; turn: Seat; deadline: number;
  winner: Seat | null; reason: StonesView['reason'];
  last: { column: number; row: number; seat: Seat } | null; winning: number[];
}
const centreFirst = [3, 2, 4, 1, 5, 0, 6] as const;
const index = (column: number, row: number) => row * STONES.columns + column;
const inside = (column: number, row: number) => column >= 0 && column < STONES.columns && row >= 0 && row < STONES.rows;

export function startStones(match: string, seed: number, now: number): StonesState {
  // Stones has no random choices; the common start signature needs no persisted seed or cursor.
  void seed;
  return { match, phase: 'playing', revision: 0, board: Array<number>(STONES.columns * STONES.rows).fill(0),
    turn: 0, deadline: now + STONES.turnMs, winner: null, reason: null, last: null, winning: [] };
}
function freeRow(state: StonesState, column: number): number {
  for (let row = 0; row < STONES.rows; row++) if (state.board[index(column, row)] === 0) return row;
  return -1;
}
function winningCells(state: StonesState, column: number, row: number): number[] {
  const winning = new Set<number>(), stone = state.turn + 1;
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]] as const) {
    const line = [index(column, row)];
    for (const sign of [-1, 1]) {
      let x = column + dx * sign, y = row + dy * sign;
      while (inside(x, y) && state.board[index(x, y)] === stone) {
        line.push(index(x, y)); x += dx * sign; y += dy * sign;
      }
    }
    if (line.length >= 4) for (const cell of line) winning.add(cell);
  }
  return [...winning].sort((a, b) => a - b);
}
function drop(state: StonesState, column: number, row: number, at: number): void {
  state.board[index(column, row)] = state.turn + 1;
  state.last = { column, row, seat: state.turn };
  state.revision++; state.deadline = at + STONES.turnMs;
  state.winning = winningCells(state, column, row);
  if (state.winning.length) {
    state.phase = 'finished'; state.winner = state.turn; state.reason = 'four';
  } else if (state.board.every(cell => cell !== 0)) {
    state.phase = 'finished'; state.reason = 'draw';
  } else state.turn = state.turn === 0 ? 1 : 0;
}
/** The host resolves seat ownership and runs timeouts; a late user move never overtakes the clock. */
export function actStones(state: StonesState, seat: Seat, revision: number, column: number, now: number): boolean {
  if (state.phase !== 'playing' || seat !== state.turn || revision !== state.revision
    || !Number.isInteger(revision) || !Number.isInteger(column) || column < 0 || column >= STONES.columns
    || !Number.isSafeInteger(now) || now >= state.deadline) return false;
  const row = freeRow(state, column);
  if (row < 0) return false;
  drop(state, column, row, now); return true;
}
/** Catch up on absolute persisted deadlines, at most one drop for each cell in the frame. */
export function tickStones(state: StonesState, now: number): boolean {
  if (!Number.isSafeInteger(now)) return false;
  let changed = false;
  for (let moves = 0; moves < STONES.columns * STONES.rows && state.phase === 'playing' && now >= state.deadline; moves++) {
    const column = centreFirst.find(candidate => freeRow(state, candidate) >= 0);
    if (column === undefined) break;
    drop(state, column, freeRow(state, column), state.deadline); changed = true;
  }
  return changed;
}
export function concedeStones(state: StonesState, seat: Seat): boolean {
  if (state.phase !== 'playing' || (seat !== 0 && seat !== 1)) return false;
  state.phase = 'finished'; state.winner = seat === 0 ? 1 : 0; state.reason = 'conceded'; state.revision++;
  return true;
}
/** Project named public fields only, copying every mutable reference. */
export function stonesView(state: StonesState): StonesView {
  return { match: state.match, phase: state.phase, revision: state.revision, board: [...state.board],
    turn: state.turn, deadline: state.deadline, winner: state.winner, reason: state.reason,
    last: state.last ? { ...state.last } : null, winning: [...state.winning] };
}
