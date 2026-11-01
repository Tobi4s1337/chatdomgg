import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, type GrowthSceneFrame } from '@chatdom/shared';
import { observeRealm, type RealmObservedRoom } from './observer';
import { createRoomGrowthFeed } from './growth';

const kingdomId = KingdomIdSchema.parse('999000777');
const frame = (sequence: number): GrowthSceneFrame => ({ version: 1, kingdomId, origin: 'simulated', sequence, asOf: 100,
  homes: [{ plotId: 'plot-3', stage: 'cottage', qualifiedDays: 7, qualifiedMinutes: 70, currentStreak: 3, bestStreak: 5, nextGoal: null }],
  civic: { tavern: 1, forge: 1, market: 1, bridge: 1, 'castle-court': 1 },
  beats: [{ kind: 'home-grown', plotId: 'plot-3', from: 'hut', to: 'cottage', qualifiedDays: 7, sourceSeq: sequence, at: 100 }] });
function setup() {
  const handlers = new Map<string, (payload: never) => void>();
  const room: RealmObservedRoom = { onMessage(type, callback) { handlers.set(type, callback); return () => handlers.delete(type); }, send() {} };
  const emit = (type: string, payload: unknown) => handlers.get(type)?.(payload as never);
  const observer = observeRealm(room, { kingdomId, origin: 'simulated', collisionRevision: 1 });
  const bootstrap = (current: unknown[]) => emit('bootstrap', { version: 1, kingdomId, writerEpoch: 'w', throughCursor: 1, layoutRevision: 'layout', collisionRevision: 1, current });
  const delivery = (cursor: number, value: unknown) => emit('world', { version: 1, kingdomId, writerEpoch: 'w', cursor, eventId: `event-${cursor}`, message: { type: 'growth', frame: value } });
  return { observer, bootstrap, delivery };
}
describe('room growth feed', () => {
  it('restores quietly, celebrates committed growth once, and gives late subscribers a quiet current frame', () => {
    const { observer, bootstrap, delivery } = setup(), seen: GrowthSceneFrame[] = [];
    const feed = createRoomGrowthFeed(observer, 'simulated');
    expect(feed.label).toBe('SIMULATED');
    feed.subscribe(value => seen.push(value), () => {});
    bootstrap([{ type: 'growth', frame: frame(1) }]);
    expect(seen.map(value => value.beats.length)).toEqual([0]);
    delivery(2, frame(2)); delivery(3, frame(2));
    expect(seen.map(value => value.beats.length)).toEqual([0, 1]);
    const late: GrowthSceneFrame[] = [];
    feed.subscribe(value => late.push(value), () => {});
    expect(late[0]?.beats).toEqual([]);
    observer.dispose();
  });
  it('rejects foreign, malformed and private frames and reports missing or unavailable state', () => {
    const { observer, bootstrap, delivery } = setup(), seen: GrowthSceneFrame[] = [];
    let unavailable = 0;
    createRoomGrowthFeed(observer, 'simulated').subscribe(value => seen.push(value), () => unavailable++);
    bootstrap([]);
    expect(unavailable).toBe(1);
    delivery(2, { ...frame(1), kingdomId: '123' });
    delivery(3, { ...frame(1), origin: 'live' });
    delivery(4, { ...frame(1), homes: [{ ...frame(1).homes[0], personId: 'private' }] });
    expect(seen).toEqual([]);
    delivery(5, frame(1));
    expect(seen).toHaveLength(1);
    observer.unavailable();
    expect(observer.current().growth).toBeNull();
    expect(unavailable).toBe(2);
    observer.dispose();
  });
});
