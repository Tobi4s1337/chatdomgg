import { describe, expect, it } from 'vitest';
import type { CampfireSelf } from '@chatdom/shared';
import { bindFireHand, POINTER_STEP, type FireHandState } from './input';

function fakeLease() {
  const keys = new Set<(code: string, down: boolean) => void>(), pointers = new Set<(dx: number, dy: number, buttons: number) => void>();
  const lease = {
    active: true, released: false,
    onKey(listener: (code: string, down: boolean) => void) { keys.add(listener); return () => { keys.delete(listener); }; },
    onPointer(listener: (dx: number, dy: number, buttons: number) => void) { pointers.add(listener); return () => { pointers.delete(listener); }; },
    release() { lease.released = true; },
  };
  const press = (code: string) => { for (const k of [...keys]) k(code, true); for (const k of [...keys]) k(code, false); };
  const move = (dx: number, buttons = 0) => { for (const p of [...pointers]) p(dx, 0, buttons); };
  return { lease, press, move, listening: () => keys.size + pointers.size };
}

const choice = (kind: 'snuff' | 'watch' | 'vote', targets: number[], chosen: number | null = null): CampfireSelf['choice'] => ({ kind, targets, chosen, deadline: 1 });

function hand(initial: Partial<FireHandState> = {}) {
  const state: { current: FireHandState } = { current: { choice: null, canAsk: false, canCall: false, connected: true, ...initial } };
  const sent: unknown[] = [];
  const l = fakeLease();
  const h = bindFireHand(l.lease, () => state.current, { choose: seat => sent.push(['choose', seat]), ask: () => sent.push(['ask']), call: () => sent.push(['call']) });
  return { ...l, h, state, sent };
}

describe('the fire hand', () => {
  it('moves round the open targets and the rest, and confirms', () => {
    const t = hand({ choice: choice('snuff', [2, 4, 5]) });
    expect(t.h.focus()).toBe(2);
    t.press('ArrowRight'); expect(t.h.focus()).toBe(4);
    t.press('KeyD'); t.press('KeyD'); expect(t.h.focus()).toBe('rest');
    t.press('Enter');
    t.press('ArrowRight'); expect(t.h.focus()).toBe(2);
    t.press('ArrowLeft'); expect(t.h.focus()).toBe('rest');
    t.press('ArrowLeft'); t.press('Space');
    expect(t.sent).toEqual([['choose', null], ['choose', 5]]);
  });

  it('taps a seat by its number, never one that is not a target', () => {
    const t = hand({ choice: choice('vote', [1, 3, 10]) });
    t.press('Digit3'); t.press('Digit2'); t.press('Digit0');
    expect(t.sent).toEqual([['choose', 3], ['choose', 10]]);
    expect(t.h.focus()).toBe(10);
  });

  it('starts from what you already chose, and follows a new choice', () => {
    const t = hand({ choice: choice('vote', [1, 3, 4], 4) });
    expect(t.h.focus()).toBe(4);
    t.state.current = { ...t.state.current, choice: choice('watch', [2, 6]) };
    t.h.frame();
    expect(t.h.focus()).toBe(2);
    t.state.current = { ...t.state.current, choice: null };
    expect(t.h.focus()).toBeNull();
  });

  it('slides with the mouse and confirms with a click', () => {
    const t = hand({ choice: choice('snuff', [2, 4, 5]) });
    t.move(POINTER_STEP * .6); expect(t.h.focus()).toBe(2);
    t.move(POINTER_STEP * .6); expect(t.h.focus()).toBe(4);
    t.move(0, 1); t.move(0, 1); t.move(0, 0);
    expect(t.sent).toEqual([['choose', 4]]);
  });

  it('asks for a round, or calls the phase from the chair, when no choice is open', () => {
    const asker = hand({ canAsk: true });
    asker.press('Enter');
    expect(asker.sent).toEqual([['ask']]);
    const magistrate = hand({ canAsk: true, canCall: true });
    magistrate.press('Enter');
    expect(magistrate.sent).toEqual([['call']]);
  });

  it('does nothing while the lease is lent elsewhere or the room is gone, and gives the lease back', () => {
    const t = hand({ choice: choice('vote', [1, 2]), canAsk: true });
    t.lease.active = false; t.press('Enter'); t.press('Digit1');
    t.lease.active = true; t.state.current = { ...t.state.current, connected: false }; t.press('Enter'); t.press('Digit1');
    expect(t.sent).toEqual([]);
    t.h.dispose();
    expect(t.lease.released).toBe(true);
    expect(t.listening()).toBe(0);
  });

  it('takes a tapped name from the screen', () => {
    const t = hand({ choice: choice('vote', [1, 2]) });
    t.h.tap(2); t.h.tap(7); t.h.tap('rest');
    expect(t.sent).toEqual([['choose', 2], ['choose', null]]);
  });
});
