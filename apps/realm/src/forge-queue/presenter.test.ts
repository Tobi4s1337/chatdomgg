import { describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, type ForgeQueueView } from '@chatdom/shared';
import type { ForgeTransientActivity } from '@chatdom/shared/realm';
import { ForgeRitualPresenter } from './presenter';
import { forgeQueueView } from './http';

const kingdomId = KingdomIdSchema.parse('5001');
const wish = (n: number) => ({ kingdomId, key: `key-${n}`, attemptId: `attempt-${n}`, personId: `${8000 + n}`, sequence: n });

function presenter(minimumMs = 1_000, revealMs = 0) {
  let now = 10_000;
  const events: ForgeTransientActivity[] = [];
  const shown = new ForgeRitualPresenter({ publish: (_k, event) => events.push(event), now: () => now, minimumMs, revealMs });
  return { shown, events, advance: (ms: number) => { now += ms; } };
}

describe('one ritual at a time, in order', () => {
  it('shows only the head, keeps later stages for their turn, and ends a ritual that did not land', () => {
    const p = presenter();
    p.shown.track(wish(1)); p.shown.track(wish(2));
    expect(p.events).toEqual([{ type: 'stage', activityId: 'attempt-1', stage: 'judging-words' }]);
    p.shown.offer(kingdomId, { type: 'stage', activityId: 'attempt-2', stage: 'drafting' });
    expect(p.events).toHaveLength(1);
    p.shown.offer(kingdomId, { type: 'stage', activityId: 'attempt-1', stage: 'drafting' });
    p.shown.finish(kingdomId, 'key-1', false);
    expect(p.events.slice(1)).toEqual([
      { type: 'stage', activityId: 'attempt-1', stage: 'drafting' },
      { type: 'ended', activityId: 'attempt-1' },
      { type: 'stage', activityId: 'attempt-2', stage: 'drafting' },
    ]);
  });

  it('lets the head land only after its ritual has been seen, and never a later wish first', () => {
    const p = presenter(1_000);
    p.shown.track(wish(2)); p.shown.track(wish(1));
    expect(p.shown.ready(kingdomId, 'attempt-2')).toBe(false);
    expect(p.shown.ready(kingdomId, 'attempt-1')).toBe(false);
    p.advance(999); expect(p.shown.ready(kingdomId, 'attempt-1')).toBe(false);
    p.advance(1); expect(p.shown.ready(kingdomId, 'attempt-1')).toBe(true);
  });

  it('gives a landed piece its reveal before the next ritual begins', () => {
    vi.useFakeTimers();
    try {
      const p = presenter(0, 5_000);
      p.shown.track(wish(1)); p.shown.track(wish(2));
      p.shown.finish(kingdomId, 'key-1', true);
      expect(p.events.filter(event => event.type === 'ended')).toHaveLength(0);
      expect(p.shown.ready(kingdomId, 'attempt-2')).toBe(false);
      expect(p.events.some(event => event.activityId === 'attempt-2')).toBe(false);
      vi.advanceTimersByTime(5_000);
      expect(p.events.at(-1)).toEqual({ type: 'stage', activityId: 'attempt-2', stage: 'judging-words' });
      expect(p.shown.ready(kingdomId, 'attempt-2')).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});

describe('the anvil line', () => {
  it('tells everyone the count, the maker their place, and only the broadcaster the names', () => {
    const p = presenter();
    [1, 2, 3].forEach(n => p.shown.track(wish(n)));
    const source = { line: p.shown.line.bind(p.shown), name: (_k: string, personId: string) => `Name ${personId}` };
    const anyone = forgeQueueView(source, kingdomId, null, 20_000);
    expect(anyone).toEqual({ version: 1, kingdomId, total: 3, waiting: 2, forgingSince: 10_000, at: 20_000 } satisfies ForgeQueueView);
    expect(forgeQueueView(source, kingdomId, '8002', 20_000).yours).toEqual({ position: 1, state: 'waiting' });
    expect(forgeQueueView(source, kingdomId, '8002', 20_000).makers).toBeUndefined();
    expect(forgeQueueView(source, kingdomId, kingdomId, 20_000).makers).toEqual([
      { position: 0, name: 'Name 8001', state: 'forging' }, { position: 1, name: 'Name 8002', state: 'waiting' }, { position: 2, name: 'Name 8003', state: 'waiting' }]);
    expect(forgeQueueView(source, KingdomIdSchema.parse('5002'), null, 20_000)).toMatchObject({ total: 0, waiting: 0, forgingSince: null });
  });
});
