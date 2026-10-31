import type { PersonId } from '@chatdom/shared';
import { RealmSupportObservationSchema } from '@chatdom/shared/realm';
import { IGNORED } from '../../../herald/src/twitch-moments/normalizer';
import { channelChatNotification } from '../../../herald/src/twitch-moments/notices';
import type { CitizenDisclosure } from '../../../herald/src/twitch-moments/ports';
import { createRoomMomentFeed } from '../realm/adapters/moments';
import { observeRealm } from '../realm/adapters/observer';
import type { TwitchMomentFeed } from '../twitch-moments';
import { createSimulatedRealmRelay, type RelayFault } from './relay';
import { BENCH_KINGDOM, type BenchCitizen } from './simulation';

const NULLS = Object.fromEntries(['sub', 'resub', 'sub_gift', 'community_sub_gift', 'gift_paid_upgrade', 'prime_paid_upgrade', 'pay_it_forward'].map(k => [k, null]));

/**
 * The bench's composed path, SIMULATED end to end: a `channel.chat.notification` body is parsed by the same
 * normalizer Herald's ingest calls, wrapped as `RealmSupportObservation`, committed by the SIMULATED realm relay and
 * observed through main's actual browser observer and room feed. Delivery is Herald's contract: the same evidence ID
 * is sent again until the realm answers accepted or duplicate. Each step is reported to the bench log.
 */
export function createRelayPath(citizens: readonly BenchCitizen[], clock: { now(): number }, report: (line: string, tone: 'source' | 'public' | 'refused') => void) {
  const people = new Map<PersonId, CitizenDisclosure>(citizens.map(c => [c.id, c.disclosure === 'named'
    ? { disclosure: 'named', displayName: c.name, homeSlot: c.slot } : { disclosure: 'anonymous' }]));
  const relay = createSimulatedRealmRelay({ kingdomId: BENCH_KINGDOM, origin: 'simulated', clock, layoutRevision: 'SIMULATED-bench', collisionRevision: 1,
    directory: { resolve: async (kingdom, id) => (kingdom === BENCH_KINGDOM ? people.get(id) ?? null : null) } });
  const room = relay.room();
  const observer = observeRealm(room, { kingdomId: BENCH_KINGDOM, origin: 'simulated', collisionRevision: 1, layoutRevision: 'SIMULATED-bench' });
  const feed: TwitchMomentFeed = createRoomMomentFeed(observer, 'simulated', clock.now);
  const ready = new Promise<void>(resolve => {
    if (observer.current().status === 'ready') { resolve(); return; }
    const off = observer.subscribe({ status: status => { if (status === 'ready') { off(); resolve(); } } });
  });
  let messages = 0;

  function notice(chatter: BenchCitizen, type: string, detail: object) {
    return { broadcaster_user_id: BENCH_KINGDOM, broadcaster_user_login: 'willowmere', broadcaster_user_name: 'Willowmere',
      chatter_user_id: chatter.id, chatter_user_login: `citizen${chatter.id}`, chatter_user_name: chatter.name, chatter_is_anonymous: false,
      color: '#c9a96a', badges: [], system_message: '', message_id: `relay-notice-${++messages}`, message: { text: '', fragments: [] },
      notice_type: type, ...NULLS, [type]: detail, source_broadcaster_user_id: null, source_message_id: null, source_badges: null };
  }

  /** One EventSub delivery into the realm, resent with its own ID until the realm has it. */
  async function deliver(deliveryId: string, event: object, faults: readonly RelayFault[] = []): Promise<void> {
    const parsed = channelChatNotification.parse(event, BENCH_KINGDOM);
    if (parsed === IGNORED || parsed === null) { report(`Herald · ${deliveryId} is not support; nothing is sent`, 'refused'); return; }
    const now = clock.now();
    const evidence = RealmSupportObservationSchema.parse({ version: 1, id: deliveryId, kingdomId: BENCH_KINGDOM, origin: 'simulated', occurredAt: now, receivedAt: now, notice: parsed });
    relay.fail(...faults);
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        const reply = await relay.accept(evidence);
        if (reply.http === 202) { report(`Realm · ${deliveryId} ${reply.body.status === 'duplicate' ? 'already committed: applied once' : 'committed'}`, 'public'); return; }
        report(`Realm unavailable · Herald keeps ${deliveryId} and retries`, 'refused');
      } catch {
        report(`Realm committed ${deliveryId} · the reply was lost, Herald sends it again`, 'refused');
      }
    }
    report(`Herald still holds ${deliveryId} · the realm has not answered`, 'refused');
  }

  return {
    feed,
    ready,
    /** A community gift and the recipients Twitch disclosed, under one provider group ID. */
    async giftGroup(giver: BenchCitizen, total: number, recipients: readonly BenchCitizen[]): Promise<void> {
      const group = `relay-group-${++messages}`;
      report(`Herald · ${giver.name} gifts ${total} subs (SIMULATED notice) → realm`, 'source');
      await deliver(`relay-delivery-${messages}`, notice(giver, 'community_sub_gift', { id: group, total, sub_tier: '1000', cumulative_total: null }), ['down', 'lose-reply']);
      for (const recipient of recipients) {
        await deliver(`relay-delivery-${++messages}`, notice(giver, 'sub_gift', { duration_months: 1, cumulative_total: 1, recipient_user_id: recipient.id,
          recipient_user_name: recipient.name, recipient_user_login: `citizen${recipient.id}`, sub_tier: '1000', community_gift_id: group }));
      }
      const snapshot = observer.current();
      report(`Observer · ${relay.rows().length} realm rows through cursor ${snapshot.cursor}, writer ${snapshot.writerEpoch}`, 'source');
    },
    dispose() { observer.dispose(); room.close(); },
  };
}
export type RelayPath = ReturnType<typeof createRelayPath>;
