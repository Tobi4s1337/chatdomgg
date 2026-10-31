import { describe, expect, it } from 'vitest';
import { KingdomIdSchema } from '@chatdom/shared';
import type { TwitchMomentFact } from '@chatdom/shared/twitch-moments';
import { observeRealm, type RealmObservedRoom } from './observer';
import { createRoomMomentFeed } from './moments';

const kingdomId = KingdomIdSchema.parse('999000777');
const fact = (seq: number, origin: TwitchMomentFact['origin'] = 'simulated'): TwitchMomentFact => ({
  version: 1, kingdomId, seq, occurredAt: 1000, receivedAt: 1000, committedAt: 1000, origin,
  type: 'twitch.moment', actor: null, cause: { kind: 'external', source: 'twitch', id: `event-${seq}` },
  body: { kind: 'follow', key: 'same', displayUntil: 2000, credit: null, returning: false, homeSlot: null },
});

describe('realm moment feed', () => {
  it('restores quietly, delivers once, and resets after transport loss', () => {
    const handlers = new Map<string, (payload: never) => void>();
    const room: RealmObservedRoom = { onMessage(type, handler) { handlers.set(type, handler); return () => { handlers.delete(type); }; }, send() {} };
    const emit = (type: string, payload: unknown) => handlers.get(type)?.(payload as never);
    const observer = observeRealm(room, { kingdomId, origin: 'simulated', collisionRevision: 1 });
    const events: string[] = [];
    const off = createRoomMomentFeed(observer, 'simulated', () => 5000).subscribe(
      info => events.push(`reset:${info.throughSeq}:${info.current.map(f => f.seq)}`),
      (_epoch, f) => events.push(`fact:${f.seq}`), () => events.push('unavailable'),
    );
    const checkpoint = (cursor: number, seq: number) => ({ version: 1, kingdomId, writerEpoch: 'writer', throughCursor: cursor,
      layoutRevision: 'one', collisionRevision: 1, current: [{ type: 'moments.current', throughSeq: seq, facts: [fact(seq)] }] });
    const delivery = (cursor: number, f: TwitchMomentFact, current = true) => ({ version: 1, kingdomId, writerEpoch: 'writer', cursor,
      eventId: `event-${cursor}`, message: { type: 'moment', fact: f, current } });
    emit('bootstrap', checkpoint(10, 2));
    emit('world', delivery(11, fact(3), false));
    emit('world', delivery(11, fact(3), false));
    emit('world', delivery(12, fact(4, 'live')));
    expect(observer.current().moments?.current.get('follow:same')?.seq).toBe(2);
    observer.unavailable();
    emit('world', delivery(13, fact(5)));
    observer.resync();
    emit('world', delivery(14, fact(6)));
    emit('bootstrap', checkpoint(13, 5));
    expect(events).toEqual(['unavailable', 'reset:2:2', 'fact:3', 'unavailable', 'reset:5:5', 'fact:6']);
    off(); observer.dispose();
    expect(handlers.size).toBe(0);
  });
});
