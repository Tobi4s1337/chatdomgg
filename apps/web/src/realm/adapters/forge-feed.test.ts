import { afterEach, describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema } from '@chatdom/shared';
import type { CommittedForgeAttachment, ForgeActivity } from '@chatdom/shared/realm';
import { createRealmForgeFeed } from './forge-feed';
import type { RealmObserver, RealmObserverListener, RealmObserverSnapshot, RealmObserverStatus } from './observer';

const part = (id: string): CommittedForgeAttachment => ({
  version: 1, id, runId: `run-${id}`, kingdomId: KingdomIdSchema.parse('999000777'), slot: 3, hostId: 'home-3',
  hostFingerprint: 'f'.repeat(64), socketId: 'roof', origin: [0, 4, 0], kitId: 'kit', kitRevision: 1,
  family: 'hearth', committedAt: 1,
  draft: { plan: { version: 2, kind: 'lantern', motif: 'sleeping-dragon', finish: 'native', accent: 'none' }, title: 'Lantern', plaque: 'Made in a SIMULATED room.' },
  provenance: { source: 'simulated', makerName: 'Juniper', kingdomName: 'SIMULATED', designId: `design-${id}`, firstForgedAt: 1 },
});
function observed(parts: readonly CommittedForgeAttachment[] = []) {
  const listeners = new Set<RealmObserverListener>();
  let status: RealmObserverStatus = 'ready';
  const attachments = new Map(parts.map(item => [item.id, item]));
  const current = (): RealmObserverSnapshot => ({ status, attachments, cursor: 1, writerEpoch: 'writer', presence: null, castle: null, homes: new Map() });
  const change = (next: RealmObserverStatus) => { status = next; for (const listener of listeners) listener.status?.(next); };
  const observer: RealmObserver = {
    current, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    resync: () => change('resyncing'), unavailable: () => change('unavailable'), dispose: () => change('disposed'),
  };
  return { observer, change, emit(event: ForgeActivity) {
    if (event.type === 'committed') attachments.set(event.attachment.id, event.attachment);
    for (const listener of listeners) listener.forge?.(event);
  } };
}
const commit = (attachment: CommittedForgeAttachment): Extract<ForgeActivity, { type: 'committed' }> => ({ type: 'committed', activityId: attachment.runId, attachment });

afterEach(() => { vi.useRealTimers(); });

describe('entry-owned live Forge handoff', () => {
  it('keeps observed model waiting and a committed part through an exact-scene remount, then settles once', () => {
    const old = part('old'), fresh = part('fresh'), first = observed([old]), feed = createRealmForgeFeed();
    let unbind = feed.bind(first.observer);
    const activityId = 'opaque-observed-activity';
    first.emit({ type: 'stage', activityId, stage: 'drafting' });
    const stages: string[] = [], rituals: string[] = [], restored: string[][] = [], activities: string[] = [];
    const off = feed.subscribe({ stage: (id, stage) => stages.push(`${id}:${stage}`), committed: (item, id) => { rituals.push(item.id); activities.push(id); } });
    expect(stages).toEqual([`${activityId}:drafting`]);
    first.emit({ ...commit(fresh), activityId });
    expect(rituals).toEqual(['fresh']);
    first.change('mismatch'); off(); unbind(); first.observer.dispose();
    const replacement = observed([old, fresh]); unbind = feed.bind(replacement.observer);
    const nextOff = feed.subscribe({ stage: (id, stage) => stages.push(`${id}:${stage}`), committed: (item, id) => { rituals.push(item.id); activities.push(id); },
      restored: items => restored.push(items.map(item => item.id)) });
    expect(restored).toEqual([['old', 'fresh']]);
    expect(rituals).toEqual(['fresh', 'fresh']); // The unfinished real landing continues in its replacement scene.
    expect(activities).toEqual([activityId, activityId]); // Activity identity is independent of the model's run ID.
    expect(stages).toHaveLength(1);
    feed.settled(fresh.id); nextOff(); unbind();
    unbind = feed.bind(observed([old, fresh]).observer);
    feed.subscribe({ committed: item => rituals.push(item.id) });
    expect(rituals).toHaveLength(2);
    // A different entry UI sees the very same durable checkpoint quietly.
    const visitor = createRealmForgeFeed(); visitor.bind(replacement.observer);
    visitor.subscribe({ committed: item => rituals.push(item.id) });
    expect(rituals).toHaveLength(2);
    unbind(); feed.unavailable(); visitor.unavailable();
  });

  it('cancels pending work on actual unavailability and never promotes the next snapshot to success', () => {
    const room = observed(), feed = createRealmForgeFeed(), events: string[] = [];
    const unbind = feed.bind(room.observer);
    const off = feed.subscribe({ stage: () => events.push('waiting'), committed: () => events.push('committed'), unavailable: () => events.push('unavailable') });
    room.emit({ type: 'stage', activityId: 'run-work', stage: 'judging-words' });
    room.observer.unavailable(); off(); unbind();
    feed.bind(observed([part('work')]).observer);
    feed.subscribe({ stage: () => events.push('stale-waiting'), committed: () => events.push('false-success'), restored: () => events.push('standing') });
    expect(events).toEqual(['waiting', 'unavailable', 'standing']);
    feed.unavailable();
  });

  it('deduplicates activity progress and commit identity across room connections', () => {
    const room = observed(), feed = createRealmForgeFeed(), stages: string[] = [], rituals: string[] = [];
    feed.bind(room.observer);
    feed.subscribe({ stage: (_, stage) => stages.push(stage), committed: item => rituals.push(item.id) });
    const attachment = part('a');
    for (const stage of ['drafting', 'drafting', 'judging-words', 'assembling'] as const) room.emit({ type: 'stage', activityId: attachment.runId, stage });
    room.emit(commit(attachment)); room.emit(commit(attachment));
    room.emit({ type: 'stage', activityId: attachment.runId, stage: 'judging-piece' });
    room.emit({ ...commit(part('duplicate')), activityId: attachment.runId });
    feed.settled(attachment.id);
    expect(stages).toEqual(['drafting', 'assembling']); expect(rituals).toEqual(['a']);
    feed.unavailable();
  });

  it('expires abandoned model waits and unfinished handoffs instead of keeping an activity archive', () => {
    vi.useFakeTimers();
    const room = observed(), feed = createRealmForgeFeed(), cancelled = vi.fn();
    feed.bind(room.observer); const off = feed.subscribe({ unavailable: cancelled });
    room.emit({ type: 'stage', activityId: 'silent-model', stage: 'drafting' });
    vi.advanceTimersByTime(120_000);
    expect(cancelled).toHaveBeenCalledOnce();
    room.emit(commit(part('real'))); off();
    vi.advanceTimersByTime(90_000);
    const late = vi.fn(), restored = vi.fn(); feed.subscribe({ committed: late, restored });
    expect(late).not.toHaveBeenCalled(); expect(restored.mock.calls[0]?.[0]).toEqual([part('real')]);
    feed.unavailable();
  });
});
