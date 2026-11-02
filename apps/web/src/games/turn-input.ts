import type { GatherTableView } from '@chatdom/shared';
import type { GameInputLease } from './input';

export interface TurnInputState {
  table: GatherTableView | null;
  playerIndex: number | null;
  physicalSeat: number | null;
  connected: boolean;
}

/** Input requests authoritative actions; only the chosen Stones column is local state. */
export function bindTurnHand(lease: GameInputLease, read: () => TurnInputState, actions: {
  start(table: string): void;
  move(action: 'drop' | 'roll' | 'hold', column?: number): void;
}): { column(): number; frame(dt: number, now: number): void; dispose(): void } {
  const held = new Set<string>();
  let column = 3, pointerColumn = 3, buttons = 0, disposed = false;
  const act = (code: string) => {
    const numeric = /^(?:Digit|Numpad)([1-7])$/.exec(code);
    const { table, playerIndex, physicalSeat, connected } = read();
    if (!connected || !table || table.status === 'saving') return;
    const stones = table.game === 'stones';
    if (!stones && table.game !== 'hearth-dice') return;
    const game = stones ? table.stones : table.dice;
    const confirm = code === 'Enter' || code === 'Space';
    if (!game || game.phase === 'finished') {
      if (confirm && [...table.seats, ...(table.extraSeats ?? [])].filter(Boolean).length >= 2) actions.start(table.table);
      return;
    }
    if (game.phase !== 'playing') return;
    if (stones && (code === 'ArrowLeft' || code === 'ArrowRight')) {
      const direction = (code === 'ArrowLeft' ? -1 : 1) * (physicalSeat === 0 ? -1 : 1);
      column = Math.max(0, Math.min(6, column + direction));
      pointerColumn = column;
      return;
    }
    if (stones && numeric) { column = Number(numeric[1]) - 1; pointerColumn = column; }
    if (playerIndex === null || playerIndex !== game.turn) return;
    if (stones) {
      if ((numeric || confirm) && table.stones?.board[35 + column] === 0) actions.move('drop', column);
    } else if (table.dice?.active[playerIndex]) {
      if (confirm || code === 'KeyR') actions.move('roll');
      else if (code === 'KeyH' && table.dice.pot > 0) actions.move('hold');
    }
  };
  const offKey = lease.onKey((code, down) => {
    if (!down) { held.delete(code); return; }
    if (disposed || !lease.active) { held.clear(); return; }
    if (!/^(?:Digit|Numpad)[1-7]$/.test(code) && !['ArrowLeft', 'ArrowRight', 'Enter', 'Space', 'KeyR', 'KeyH'].includes(code)) return;
    if (held.has(code)) return;
    held.add(code);
    act(code);
  });
  const offPointer = lease.onPointer((dx, _dy, nextButtons) => {
    if (disposed || !lease.active) { buttons = 0; return; }
    const pressed = nextButtons & ~buttons;
    buttons = nextButtons;
    const { table, physicalSeat, connected } = read();
    if (!connected || !table || table.status === 'saving') return;
    if (table.game === 'stones' && table.stones?.phase === 'playing' && Number.isFinite(dx)) {
      pointerColumn = Math.max(0, Math.min(6, pointerColumn + dx / 48 * (physicalSeat === 0 ? -1 : 1)));
      column = Math.round(pointerColumn);
    }
    if (pressed & 1) act('Enter');
    else if (pressed & 2) act('KeyH');
  });
  return {
    column: () => column,
    frame() { if (!lease.active || disposed) { held.clear(); buttons = 0; } },
    dispose() {
      if (disposed) return;
      disposed = true;
      held.clear();
      buttons = 0;
      offKey();
      offPointer();
      lease.release();
    },
  };
}
