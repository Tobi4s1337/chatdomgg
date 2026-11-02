import type { CampfireSelf } from '@chatdom/shared';
import type { GameInputLease } from '../games/input';

/*
 * The fire's hand while you sit: the same input lease every seated game uses (play's `requestInput`), never the
 * walking controller. A tap or a vote rests on one lantern at a time: arrows or A/D (or sliding the mouse) move it
 * round the circle, a number taps that seat at once, Enter, Space or a click confirms. With no choice open, Enter asks
 * the fire for a round, or calls the next phase from the Magistrate's chair. E and Escape stay with the interaction
 * owner, so standing up always works.
 */

export type FireFocus = number | 'rest' | null;

export interface FireHandState {
  readonly choice: CampfireSelf['choice'];
  readonly canAsk: boolean;
  readonly canCall: boolean;
  readonly connected: boolean;
}
export interface FireHandActions {
  choose(seat: number | null): void;
  ask(): void;
  call(): void;
}

/** Pixels of mouse travel per step round the circle. */
export const POINTER_STEP = 60;

const options = (choice: CampfireSelf['choice']): FireFocus[] => choice ? [...choice.targets, 'rest'] : [];
const DIGIT = /^(?:Digit|Numpad)(\d)$/;

export function bindFireHand(lease: GameInputLease, read: () => FireHandState, actions: FireHandActions) {
  const held = new Set<string>();
  let focus: FireFocus = null, key = '', travel = 0, buttons = 0, disposed = false;
  const listeners = new Set<(focus: FireFocus) => void>();
  const set = (next: FireFocus) => { if (next === focus) return; focus = next; for (const listener of [...listeners]) listener(focus); };
  /** Keeps the focus on something that can still be chosen, starting from what you already chose. */
  const sync = () => {
    const { choice } = read(), list = options(choice);
    const nextKey = choice ? `${choice.kind}:${choice.deadline}:${choice.targets.join(',')}` : '';
    if (nextKey !== key) { key = nextKey; travel = 0; set(choice ? choice.chosen ?? list[0] ?? null : null); return list; }
    if (focus !== null && !list.includes(focus)) set(list[0] ?? null);
    return list;
  };
  const step = (by: number) => {
    const list = sync();
    if (!list.length) return;
    const at = Math.max(0, list.indexOf(focus));
    set(list[(at + by + list.length) % list.length]!);
  };
  const confirm = () => {
    const state = read();
    if (!state.connected) return;
    const list = sync();
    if (state.choice && focus !== null && list.includes(focus)) actions.choose(focus === 'rest' ? null : focus);
    else if (!state.choice && state.canCall) actions.call();
    else if (!state.choice && state.canAsk) actions.ask();
  };
  const offKey = lease.onKey((code, down) => {
    if (!down) { held.delete(code); return; }
    if (disposed || !lease.active) { held.clear(); return; }
    if (held.has(code)) return;
    const digit = DIGIT.exec(code);
    if (digit) {
      held.add(code);
      const seat = Number(digit[1]) || 10, state = read();
      if (state.connected && state.choice?.targets.includes(seat)) { sync(); set(seat); actions.choose(seat); }
      return;
    }
    if (code === 'ArrowLeft' || code === 'KeyA') { held.add(code); step(-1); }
    else if (code === 'ArrowRight' || code === 'KeyD') { held.add(code); step(1); }
    else if (code === 'Enter' || code === 'Space') { held.add(code); confirm(); }
  });
  const offPointer = lease.onPointer((dx, _dy, next) => {
    if (disposed || !lease.active) { buttons = 0; travel = 0; return; }
    const pressed = next & ~buttons;
    buttons = next;
    if (Number.isFinite(dx) && dx) {
      travel += dx;
      while (Math.abs(travel) >= POINTER_STEP) { step(Math.sign(travel)); travel -= Math.sign(travel) * POINTER_STEP; }
    }
    if (pressed & 1) confirm();
  });
  sync();
  return {
    focus(): FireFocus { sync(); return focus; },
    /** A name or lantern tapped on screen: it takes the focus and is chosen. */
    tap(seat: FireFocus) {
      const list = sync(), state = read();
      if (seat === null || !list.includes(seat) || !state.connected) return;
      set(seat);
      actions.choose(seat === 'rest' ? null : seat);
    },
    onFocus(listener: (focus: FireFocus) => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },
    frame() { if (!lease.active || disposed) { held.clear(); buttons = 0; travel = 0; } sync(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      held.clear(); listeners.clear();
      offKey(); offPointer();
      lease.release();
    },
  };
}

export type FireHand = ReturnType<typeof bindFireHand>;
