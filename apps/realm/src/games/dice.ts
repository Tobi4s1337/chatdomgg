import type { DiceView } from '@chatdom/shared';

export const HEARTH_DICE = Object.freeze({ winningScore: 50, turnMs: 30_000 });
export interface DiceState {
  match: string; phase: DiceView['phase']; revision: number;
  scores: number[]; active: boolean[]; turn: number; pot: number;
  die: DiceView['die']; deadline: number; winner: number | null;
  reason: DiceView['reason']; last: DiceView['last'];
  /** Server-only randomness, persisted together and never included in a view. */
  seed: number; cursor: number;
}
const MAX_TIME = 8_640_000_000_000_000 - HEARTH_DICE.turnMs;
const validTime = (now: number) => Number.isSafeInteger(now) && now >= 0 && now <= MAX_TIME;
const validSeat = (state: DiceState, seat: number) => Number.isInteger(seat) && seat >= 0 && seat < state.active.length;

/** Counter mixing is a permutation of uint32 values; rejection removes modulo bias. */
function roll(state: DiceState): 1 | 2 | 3 | 4 | 5 | 6 {
  let draw: number;
  do {
    state.cursor = (state.cursor + 1) >>> 0;
    let n = (state.seed + Math.imul(state.cursor, 0x9e3779b9)) | 0;
    n = Math.imul(n ^ n >>> 16, 0x21f0aaad);
    n = Math.imul(n ^ n >>> 15, 0x735a2d97);
    draw = (n ^ n >>> 15) >>> 0;
    // Only four uint32 values are rejected, so consecutive draws take at most five attempts.
  } while (draw >= 0xffff_fffc);
  return (draw % 6 + 1) as 1 | 2 | 3 | 4 | 5 | 6;
}

export function startDice(match: string, seed: number, now: number, players: number): DiceState {
  if (typeof match !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(match)
    || !Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff || !validTime(now)
    || !Number.isInteger(players) || players < 2 || players > 4) throw new RangeError('Invalid Hearth Dice start');
  return { match, phase: 'playing', revision: 0, scores: Array<number>(players).fill(0),
    active: Array<boolean>(players).fill(true), turn: 0, pot: 0, die: null,
    deadline: now + HEARTH_DICE.turnMs, winner: null, reason: null, last: null, seed, cursor: 0 };
}

function advanceTurn(state: DiceState): void {
  for (let offset = 1; offset <= state.active.length; offset++) {
    const next = (state.turn + offset) % state.active.length;
    if (state.active[next]) { state.turn = next; return; }
  }
}

function bank(state: DiceState): void {
  state.scores[state.turn] = state.scores[state.turn]! + state.pot;
  state.pot = 0;
  if (state.scores[state.turn]! >= HEARTH_DICE.winningScore) {
    state.phase = 'finished'; state.winner = state.turn; state.reason = 'fifty';
  } else advanceTurn(state);
}

/** The host resolves seats and deduplicates command receipts before calling the rules. */
export function actDice(state: DiceState, seat: number, revision: number, action: 'roll' | 'hold', now: number): boolean {
  if (state.phase !== 'playing' || !validSeat(state, seat) || !state.active[seat] || seat !== state.turn
    || !Number.isSafeInteger(revision) || revision < 0 || revision !== state.revision
    || !validTime(now) || now < state.deadline - HEARTH_DICE.turnMs || now >= state.deadline
    || (action !== 'roll' && action !== 'hold') || (action === 'hold' && state.pot === 0)) return false;
  if (action === 'hold') {
    bank(state); state.last = 'hold';
  } else {
    state.die = roll(state);
    if (state.die === 1) {
      state.pot = 0; advanceTurn(state); state.last = 'bust';
    } else {
      state.pot += state.die; state.last = 'roll';
    }
  }
  state.deadline = now + HEARTH_DICE.turnMs; state.revision++;
  return true;
}

/** Expired turns bank or pass. Catch-up keeps the persisted cadence and bounds work per room tick. */
export function tickDice(state: DiceState, now: number): boolean {
  if (state.phase !== 'playing' || !validTime(now) || now < state.deadline) return false;
  for (let turns = 0; state.phase === 'playing' && state.deadline <= now && turns < 256; turns++) {
    bank(state); state.last = 'timeout'; state.revision++;
    state.deadline += HEARTH_DICE.turnMs;
  }
  return true;
}

export function concedeDice(state: DiceState, seat: number, now: number): boolean {
  if (state.phase !== 'playing' || !validSeat(state, seat) || !state.active[seat]
    || !validTime(now) || now < state.deadline - HEARTH_DICE.turnMs) return false;
  state.active[seat] = false; state.last = 'conceded'; state.revision++;
  if (seat === state.turn) { state.pot = 0; advanceTurn(state); state.deadline = now + HEARTH_DICE.turnMs; }
  const remaining = state.active.flatMap((active, index) => active ? [index] : []);
  if (remaining.length <= 1) {
    state.phase = 'finished'; state.winner = remaining[0] ?? null;
    state.reason = remaining.length ? 'conceded' : 'draw'; state.pot = 0;
  }
  return true;
}

/** Explicit projection prevents present or future RNG state from reaching clients or public logs. */
export function diceView(state: DiceState): DiceView {
  return { match: state.match, phase: state.phase, revision: state.revision, scores: [...state.scores],
    active: [...state.active], turn: state.turn, pot: state.pot, die: state.die, deadline: state.deadline,
    winner: state.winner, reason: state.reason, last: state.last };
}
