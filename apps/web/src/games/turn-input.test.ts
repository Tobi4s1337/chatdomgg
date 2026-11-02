import { describe, expect, it, vi } from 'vitest';
import type { DiceView, GatherTableView, StonesView } from '@chatdom/shared';
import type { GameInputLease } from './input';
import { bindTurnHand, type TurnInputState } from './turn-input';

function stones(overrides: Partial<StonesView> = {}): StonesView {
  return { match: 'stones-one', phase: 'playing', revision: 1, board: Array<number>(42).fill(0), turn: 0,
    deadline: 1000, winner: null, reason: null, last: null, winning: [], ...overrides };
}
function dice(overrides: Partial<DiceView> = {}): DiceView {
  return { match: 'dice-one', phase: 'playing', revision: 1, scores: [0, 0], active: [true, true], turn: 0,
    pot: 4, die: 4, deadline: 1000, winner: null, reason: null, last: 'roll', ...overrides };
}
function table(overrides: Partial<GatherTableView> = {}): GatherTableView {
  return { table: 'stones-table', revision: 1, seats: ['A', 'B'], pong: null, game: 'stones', stones: stones(), ...overrides };
}
function setup(overrides: Partial<TurnInputState> = {}) {
  const listeners = new Set<(code: string, down: boolean) => void>();
  const pointers = new Set<(dx: number, dy: number, buttons: number) => void>();
  const offKey = vi.fn(), offPointer = vi.fn(), release = vi.fn();
  const onPointer = vi.fn((listener: (dx: number, dy: number, buttons: number) => void) => {
    pointers.add(listener); return () => { pointers.delete(listener); offPointer(); };
  });
  const lease: GameInputLease & { active: boolean } = {
    active: true, release, onPointer,
    onKey(listener) { listeners.add(listener); return () => { listeners.delete(listener); offKey(); }; },
  };
  let state: TurnInputState = { table: table(), playerIndex: 0, physicalSeat: 1, connected: true, ...overrides };
  const actions = { start: vi.fn(), move: vi.fn() };
  const hand = bindTurnHand(lease, () => state, actions);
  const key = (code: string, down = true) => { for (const listener of listeners) listener(code, down); };
  const press = (code: string) => { key(code); key(code, false); };
  const pointer = (dx = 0, buttons = 0) => { for (const listener of pointers) listener(dx, 0, buttons); };
  return { hand, lease, actions, key, press, pointer, offKey, offPointer, onPointer, set: (next: Partial<TurnInputState>) => { state = { ...state, ...next }; } };
}

describe('turn input lease', () => {
  it('uses screen arrows from each physical chair and bounds the selection without wrapping', () => {
    const f = setup();
    expect(f.hand.column()).toBe(3);
    f.press('ArrowLeft');
    expect(f.hand.column()).toBe(2);
    f.set({ physicalSeat: 0 });
    f.press('ArrowLeft');
    expect(f.hand.column()).toBe(3);
    for (let i = 0; i < 8; i++) f.press('ArrowLeft');
    expect(f.hand.column()).toBe(6);
    for (let i = 0; i < 8; i++) f.press('ArrowRight');
    expect(f.hand.column()).toBe(0);
    expect(f.actions.move).not.toHaveBeenCalled();
  });

  it('submits numeric logical columns independently of orientation, and confirms the selection', () => {
    const f = setup({ physicalSeat: 0 });
    f.press('Digit1'); f.press('Numpad7'); f.press('ArrowRight'); f.press('Enter'); f.press('Space');
    expect(f.actions.move.mock.calls).toEqual([['drop', 0], ['drop', 6], ['drop', 5], ['drop', 5]]);
    expect(f.hand.column()).toBe(5);
    f.press('Digit0'); f.press('Digit8'); f.press('Numpad9');
    expect(f.actions.move).toHaveBeenCalledTimes(4);
  });

  it('allows selecting full columns but never submits them or a full board', () => {
    const board = Array<number>(42).fill(0); board[37] = 1;
    const f = setup({ table: table({ stones: stones({ board }) }) });
    f.press('ArrowLeft'); f.press('Enter'); f.press('Digit3');
    expect(f.hand.column()).toBe(2);
    expect(f.actions.move).not.toHaveBeenCalled();
    f.set({ table: table({ stones: stones({ board: Array<number>(42).fill(2) }) }) });
    for (let i = 1; i <= 7; i++) f.press(`Digit${i}`);
    f.press('Space');
    expect(f.actions.move).not.toHaveBeenCalled();
  });

  it.each(['inactive', 'disconnected', 'saving', 'no table'] as const)('ignores input while %s', reason => {
    const f = setup();
    if (reason === 'inactive') f.lease.active = false;
    if (reason === 'disconnected') f.set({ connected: false });
    if (reason === 'saving') f.set({ table: table({ status: 'saving' }) });
    if (reason === 'no table') f.set({ table: null });
    for (const code of ['ArrowLeft', 'Digit1', 'Enter', 'Space', 'KeyR', 'KeyH']) f.press(code);
    expect(f.hand.column()).toBe(3);
    expect(f.actions.start).not.toHaveBeenCalled();
    expect(f.actions.move).not.toHaveBeenCalled();
  });

  it.each([1, null])('allows cosmetic selection without submitting when logical player is %s', playerIndex => {
    const f = setup({ playerIndex });
    f.press('ArrowLeft');
    expect(f.hand.column()).toBe(2);
    f.press('Numpad7');
    expect(f.hand.column()).toBe(6);
    f.press('Enter'); f.press('Space');
    expect(f.actions.move).not.toHaveBeenCalled();
    expect(f.actions.start).not.toHaveBeenCalled();
  });

  it('starts only absent or terminal games with two occupied physical chairs', () => {
    const f = setup({ playerIndex: null, table: table({ stones: null, seats: ['A', null] }) });
    f.press('Enter');
    expect(f.actions.start).not.toHaveBeenCalled();
    f.set({ table: table({ stones: null, seats: ['A', null], extraSeats: [null, 'B'] }) });
    f.press('Digit2'); f.press('KeyR'); f.press('KeyH');
    expect(f.actions.start).not.toHaveBeenCalled();
    f.press('Space');
    f.set({ table: table({ table: 'another-table', stones: stones({ phase: 'finished', winner: 1, reason: 'four' }) }) });
    f.press('Enter');
    expect(f.actions.start.mock.calls).toEqual([['stones-table'], ['another-table']]);
    expect(f.actions.move).not.toHaveBeenCalled();
  });

  it('rolls Dice with confirm or R and holds only a positive pot for an active participant', () => {
    const f = setup({ table: table({ game: 'hearth-dice', dice: dice() }) });
    f.press('Enter'); f.press('Space'); f.press('KeyR'); f.press('KeyH');
    expect(f.actions.move.mock.calls).toEqual([['roll'], ['roll'], ['roll'], ['hold']]);
    f.press('Digit2'); f.press('ArrowLeft');
    expect(f.hand.column()).toBe(3);
    f.set({ table: table({ game: 'hearth-dice', dice: dice({ pot: 0 }) }) });
    f.press('KeyH');
    f.set({ table: table({ game: 'hearth-dice', dice: dice({ active: [false, true] }) }) });
    f.press('KeyR'); f.press('KeyH');
    f.set({ playerIndex: 1, table: table({ game: 'hearth-dice', dice: dice() }) });
    f.press('KeyR'); f.press('KeyH');
    expect(f.actions.move).toHaveBeenCalledTimes(4);
  });

  it('starts Dice independently of old participant membership and permits an unavailable save retry', () => {
    const f = setup({ playerIndex: null, table: table({ game: 'hearth-dice', status: 'unavailable', dice: dice({ phase: 'finished' }) }) });
    f.press('Space');
    expect(f.actions.start).toHaveBeenCalledWith('stones-table');
    f.set({ playerIndex: 0, table: table({ game: 'hearth-dice', status: 'unavailable', dice: dice() }) });
    f.press('KeyR');
    expect(f.actions.move).toHaveBeenCalledWith('roll');
    f.set({ table: table({ game: 'hearth-dice', status: 'saving', dice: null }) });
    f.press('Enter');
    expect(f.actions.start).toHaveBeenCalledTimes(1);
  });

  it('deduplicates held keys until keyup and clears them on an inactive frame', () => {
    const f = setup();
    f.key('ArrowLeft'); f.key('ArrowLeft');
    expect(f.hand.column()).toBe(2);
    f.key('Enter'); f.key('Enter');
    expect(f.actions.move.mock.calls).toEqual([['drop', 2]]);
    f.key('Enter', false); f.key('Enter');
    expect(f.actions.move).toHaveBeenCalledTimes(2);
    f.lease.active = false; f.hand.frame(.016, 100);
    f.lease.active = true; f.key('Enter');
    expect(f.actions.move).toHaveBeenCalledTimes(3);
    f.hand.frame(1, 200);
    expect(f.actions.move).toHaveBeenCalledTimes(3);
  });

  it('reads a new match, turn and board on each key edge without changing server state', () => {
    const initial = table(), snapshot = structuredClone(initial);
    const f = setup({ table: initial });
    f.press('Enter');
    expect(initial).toEqual(snapshot);
    f.set({ table: table({ stones: stones({ match: 'stones-two', turn: 1 }) }) });
    f.press('Enter');
    expect(f.actions.move).toHaveBeenCalledTimes(1);
    f.set({ playerIndex: 1, table: table({ game: 'hearth-dice', dice: dice({ match: 'dice-two', turn: 1 }) }) });
    f.press('Enter');
    expect(f.actions.move.mock.calls).toEqual([['drop', 3], ['roll']]);
  });

  it('moves Stones selection with accumulated pointer motion, mirrors the chair and clamps the ends', () => {
    const f = setup();
    f.pointer(12); f.pointer(36);
    expect(f.hand.column()).toBe(4);
    f.set({ physicalSeat: 0 });
    f.pointer(48);
    expect(f.hand.column()).toBe(3);
    f.pointer(-1000);
    expect(f.hand.column()).toBe(6);
    f.pointer(1000);
    expect(f.hand.column()).toBe(0);
    f.pointer(-48);
    expect(f.hand.column()).toBe(1);
    f.press('Numpad4'); f.pointer(-48);
    expect(f.hand.column()).toBe(4);
    f.press('ArrowLeft'); f.pointer(-48);
    expect(f.hand.column()).toBe(6);
    expect(f.actions.move.mock.calls).toEqual([['drop', 3]]);
  });

  it('submits Stones only on left button edges and reads the current board and participant', () => {
    const f = setup();
    f.pointer(0, 1); f.pointer(48, 1); f.pointer(0, 1);
    expect(f.actions.move.mock.calls).toEqual([['drop', 3]]);
    f.pointer(); f.pointer(0, 1);
    expect(f.actions.move.mock.calls).toEqual([['drop', 3], ['drop', 4]]);
    f.pointer();
    f.set({ playerIndex: 1 });
    f.pointer(48, 1);
    expect(f.hand.column()).toBe(5);
    f.pointer();
    f.set({ playerIndex: 0, table: table({ stones: stones({ board: Array<number>(42).fill(1) }) }) });
    f.pointer(0, 1); f.pointer(); f.pointer(0, 2);
    expect(f.actions.move).toHaveBeenCalledTimes(2);
  });

  it('rolls and holds Dice on button edges without repeating during mouse movement', () => {
    const f = setup({ table: table({ game: 'hearth-dice', dice: dice() }) });
    f.pointer(0, 1); f.pointer(48, 1); f.pointer(48, 1);
    f.pointer(); f.pointer(0, 2); f.pointer(-48, 2);
    expect(f.actions.move.mock.calls).toEqual([['roll'], ['hold']]);
    f.pointer();
    f.set({ table: table({ game: 'hearth-dice', dice: dice({ pot: 0 }) }) });
    f.pointer(0, 2); f.pointer();
    f.set({ table: table({ game: 'hearth-dice', dice: dice({ active: [false, true] }) }) });
    f.pointer(0, 1); f.pointer(); f.pointer(0, 2); f.pointer();
    f.set({ playerIndex: null, table: table({ game: 'hearth-dice', dice: dice() }) });
    f.pointer(0, 1); f.pointer(); f.pointer(0, 2);
    expect(f.actions.move).toHaveBeenCalledTimes(2);
    expect(f.hand.column()).toBe(3);
  });

  it.each(['stones', 'hearth-dice'] as const)('starts absent and terminal %s games only with a left edge and two physical names', game => {
    const f = setup({ playerIndex: null, table: table({ game, stones: null, dice: null, seats: ['A', null] }) });
    f.pointer(0, 1); f.pointer();
    expect(f.actions.start).not.toHaveBeenCalled();
    f.set({ table: table({ game, stones: null, dice: null, seats: ['A', null], extraSeats: ['B', null] }) });
    f.pointer(0, 2); f.pointer();
    expect(f.actions.start).not.toHaveBeenCalled();
    f.pointer(0, 1); f.pointer(48, 1);
    expect(f.actions.start).toHaveBeenCalledTimes(1);
    f.pointer();
    f.set({ table: table({ game, stones: stones({ phase: 'finished' }), dice: dice({ phase: 'finished' }) }) });
    f.pointer(0, 1);
    expect(f.actions.start.mock.calls).toEqual([['stones-table'], ['stones-table']]);
    expect(f.actions.move).not.toHaveBeenCalled();
  });

  it.each(['inactive', 'disconnected', 'saving', 'no table'] as const)('ignores mouse actions and motion while %s', reason => {
    const f = setup();
    if (reason === 'inactive') f.lease.active = false;
    if (reason === 'disconnected') f.set({ connected: false });
    if (reason === 'saving') f.set({ table: table({ status: 'saving' }) });
    if (reason === 'no table') f.set({ table: null });
    f.pointer(48, 1); f.pointer(); f.pointer(-48, 2);
    expect(f.hand.column()).toBe(3);
    expect(f.actions.start).not.toHaveBeenCalled();
    expect(f.actions.move).not.toHaveBeenCalled();
  });

  it('clears mouse button edges on an inactive frame and permits a new click after resuming', () => {
    const f = setup();
    f.pointer(0, 1);
    f.lease.active = false; f.hand.frame(.016, 100);
    f.lease.active = true; f.pointer(0, 1);
    expect(f.actions.move.mock.calls).toEqual([['drop', 3], ['drop', 3]]);
    f.hand.frame(.016, 101); f.pointer(48, 1);
    expect(f.actions.move).toHaveBeenCalledTimes(2);
  });

  it('does not consume walking or leave keys, and removes both subscriptions and releases exactly once', () => {
    const f = setup();
    for (const code of ['KeyE', 'Escape', 'KeyW', 'KeyA', 'KeyS', 'KeyD']) f.press(code);
    expect(f.actions.start).not.toHaveBeenCalled();
    expect(f.actions.move).not.toHaveBeenCalled();
    expect(f.hand.column()).toBe(3);
    expect(f.onPointer).toHaveBeenCalledTimes(1);
    f.key('Enter');
    f.hand.dispose(); f.hand.dispose();
    f.press('Digit1'); f.pointer(48, 1); f.hand.frame(.016, 100);
    expect(f.actions.move.mock.calls).toEqual([['drop', 3]]);
    expect(f.offKey).toHaveBeenCalledTimes(1);
    expect(f.offPointer).toHaveBeenCalledTimes(1);
    expect(f.lease.release).toHaveBeenCalledTimes(1);
  });
});
