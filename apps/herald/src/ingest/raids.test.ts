import { KingdomIdSchema } from '@chatdom/shared';
import type { DeliveryFrame } from '@chatdom/twitch';
import { describe, expect, it, vi } from 'vitest';
import { RaidObservationSchema } from '../../../api/src/raid-gate/observations';
import type { RealmDeliverySink } from '../realm-delivery/sink';
import { MemoryBindingStore } from '../source/bindings';
import { PresenceSource } from '../source/source';
import { IGNORED } from '../twitch-moments/normalizer';
import { ChatIngest, CLOCK_SKEW_MS } from './ingest';
import { raidObservation } from './raids';
import { planSubscriptions } from './subscriptions';

const kingdomId = KingdomIdSchema.parse('123'), other = KingdomIdSchema.parse('555'), now = 1_800_000_000_000;
const plans = planSubscriptions({ broadcasterId: kingdomId, readerId: '456', clientId: 'SIMULATED' });
const incoming = plans.find(plan => plan.type === 'channel.raid' && plan.condition.to_broadcaster_user_id)!;
const outgoing = plans.find(plan => plan.type === 'channel.raid' && plan.condition.from_broadcaster_user_id)!;
const event = (direction: 'incoming' | 'outgoing' = 'incoming') => ({
  from_broadcaster_user_id: direction === 'incoming' ? other : kingdomId,
  from_broadcaster_user_login: 'simulated_source', from_broadcaster_user_name: 'SIMULATED Source',
  to_broadcaster_user_id: direction === 'incoming' ? kingdomId : other,
  to_broadcaster_user_login: 'simulated_destination', to_broadcaster_user_name: 'SIMULATED Destination', viewers: 70_000,
});
const context = (plan = incoming) => ({ plan, kingdomId, id: 'eventsub-exact-id', origin: 'live' as const, occurredAt: now - 100, receivedAt: now });

describe('raid observations', () => {
  it('keeps exact identity, both complete channels, direction, count and timestamps with no inferred riders', () => {
    for (const [direction, plan] of [['incoming', incoming], ['outgoing', outgoing]] as const) {
      const observation = raidObservation({ ...event(direction), private_words: 'discarded', riders: ['not evidence'] }, context(plan));
      expect(observation).toEqual({ version: 1, id: 'eventsub-exact-id', origin: 'live', kingdomId, direction,
        occurredAt: now - 100, receivedAt: now, viewers: 70_000,
        from: { kingdomId: direction === 'incoming' ? other : kingdomId, login: 'simulated_source', name: 'SIMULATED Source' },
        to: { kingdomId: direction === 'incoming' ? kingdomId : other, login: 'simulated_destination', name: 'SIMULATED Destination' } });
      expect(RaidObservationSchema.safeParse(observation).success).toBe(true);
    }
    expect(raidObservation({ ...event(), viewers: 0 }, context())).toBe(IGNORED);
  });

  it('refuses malformed channels/counts, wrong direction, same pair and ambiguous conditions', () => {
    for (const patch of [{ from_broadcaster_user_name: undefined }, { to_broadcaster_user_login: 'UPPER' }, { viewers: -1 },
      { viewers: 1.5 }, { viewers: Number.MAX_SAFE_INTEGER + 1 }, { to_broadcaster_user_id: other },
      { from_broadcaster_user_id: kingdomId }]) {
      expect(raidObservation({ ...event(), ...patch }, context())).toBeNull();
    }
    expect(raidObservation(event(), context(outgoing))).toBeNull();
    expect(raidObservation(event(), context({ ...incoming, condition: { from_broadcaster_user_id: kingdomId, to_broadcaster_user_id: kingdomId } }))).toBeNull();
  });

  it('routes verified outgoing deliveries only through raid, dedupes, preserves permitted clock skew and counts refusals', async () => {
    const raid = vi.fn<NonNullable<RealmDeliverySink['raid']>>().mockResolvedValue(undefined), moment = vi.fn().mockResolvedValue(undefined);
    const source = new PresenceSource({ kingdomId, origin: 'live', slots: [], store: new MemoryBindingStore(), now: () => now, tickMs: 0 });
    const sink: RealmDeliverySink = { raid, moment, observation: async () => {}, speech: () => {}, clear: () => {}, remove: () => {} };
    const ingest = new ChatIngest({ source, conduitId: 'SIMULATED', clientId: 'SIMULATED', plans, covered: () => false,
      onAuthorizationRevoked: () => {}, onSubscriptionRevoked: () => {}, realm: sink, now: () => now });
    const frame = (id: string, raw = event('outgoing'), at = now - 100): DeliveryFrame => ({ kind: 'notification', meta: { messageId: id, at },
      subscription: { id: 'SIMULATED', conduitId: 'SIMULATED', status: 'enabled', type: outgoing.type,
        version: outgoing.version, condition: outgoing.condition }, event: raw });
    try {
      const first = ingest.handle(frame('exact-id')), duplicate = ingest.handle(frame('exact-id'));
      expect(duplicate).toBe(first);
      await first;
      ingest.handle(frame('wrong-pair', event()));
      ingest.handle({ ...frame('wrong-conduit'), subscription: { ...frame('wrong-conduit').subscription, conduitId: 'untrusted' } });
      ingest.handle(frame('small-skew', event('outgoing'), now + CLOCK_SKEW_MS));
      ingest.handle(frame('future', event('outgoing'), now + CLOCK_SKEW_MS + 1));
      await vi.waitFor(() => expect(ingest.health().counters.raids).toBe(2));
      expect(raid).toHaveBeenCalledTimes(2); expect(moment).not.toHaveBeenCalled();
      expect(raid.mock.calls[0]![0]).toMatchObject({ id: 'exact-id', direction: 'outgoing', occurredAt: now - 100, receivedAt: now });
      expect(raid.mock.calls[1]![0]).toMatchObject({ id: 'small-skew', occurredAt: now + CLOCK_SKEW_MS, receivedAt: now });
      raid.mockRejectedValueOnce(new Error('SIMULATED capacity refusal'));
      await expect(ingest.handle(frame('refused'))).rejects.toThrow('capacity refusal');
      await vi.waitFor(() => expect(ingest.health().counters.raidRefused).toBe(1));
      expect(ingest.health().counters).toMatchObject({ raids: 2, duplicateDeliveries: 1, malformed: 1, unverified: 1, future: 1, spectacles: 0 });
      await ingest.handle(frame('refused'));
      await ingest.handle(frame('refused'));
      expect(raid).toHaveBeenCalledTimes(4);
      expect(ingest.health().counters).toMatchObject({ raids: 3, raidRefused: 1, duplicateDeliveries: 2 });
    } finally { ingest.dispose(); }
  });

  it('retains the provider timestamp across a fresh ingest after a slightly future event is redelivered', async () => {
    const raid = vi.fn<NonNullable<RealmDeliverySink['raid']>>().mockResolvedValue(undefined);
    const providerAt = now + 2000;
    for (const receivedAt of [now, now + 3000]) {
      const source = new PresenceSource({ kingdomId, origin: 'live', slots: [], store: new MemoryBindingStore(), now: () => receivedAt, tickMs: 0 });
      const ingest = new ChatIngest({ source, conduitId: 'SIMULATED', clientId: 'SIMULATED', plans, covered: () => false,
        onAuthorizationRevoked: () => {}, onSubscriptionRevoked: () => {}, now: () => receivedAt,
        realm: { raid, observation: async () => {}, speech: () => {}, remove: () => {}, clear: () => {} } });
      try {
        await ingest.handle({ kind: 'notification', meta: { messageId: 'redelivered-exact-id', at: providerAt },
          subscription: { id: 'SIMULATED', conduitId: 'SIMULATED', status: 'enabled', type: outgoing.type,
            version: outgoing.version, condition: outgoing.condition }, event: event('outgoing') });
      } finally { ingest.dispose(); }
    }
    expect(raid.mock.calls.map(call => ({ id: call[0].id, occurredAt: call[0].occurredAt, viewers: call[0].viewers })))
      .toEqual([{ id: 'redelivered-exact-id', occurredAt: providerAt, viewers: 70_000 }, { id: 'redelivered-exact-id', occurredAt: providerAt, viewers: 70_000 }]);
    expect(raid.mock.calls.map(call => call[0].receivedAt)).toEqual([now, now + 3000]);
  });

  it('keeps the incoming legacy spectacle path for sinks with no raid port', () => {
    const moment = vi.fn().mockResolvedValue(undefined);
    const source = new PresenceSource({ kingdomId, origin: 'simulated', slots: [], store: new MemoryBindingStore(), now: () => now, tickMs: 0 });
    const ingest = new ChatIngest({ source, conduitId: 'SIMULATED', clientId: 'SIMULATED', plans, covered: () => false,
      onAuthorizationRevoked: () => {}, onSubscriptionRevoked: () => {}, now: () => now,
      realm: { moment, observation: async () => {}, speech: () => {}, clear: () => {}, remove: () => {} } });
    try {
      ingest.handle({ kind: 'notification', meta: { messageId: 'legacy', at: now }, subscription: { id: 'SIMULATED', conduitId: 'SIMULATED',
        status: 'enabled', type: incoming.type, version: incoming.version, condition: incoming.condition }, event: event() });
      expect(moment).toHaveBeenCalledOnce();
      expect(moment.mock.calls[0]![0]).toMatchObject({ id: 'legacy', origin: 'simulated', notice: { kind: 'raid', viewers: 70_000 } });
    } finally { ingest.dispose(); }
  });
});
