import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { KingdomIdSchema } from '@chatdom/shared';
import type { TwitchMomentFact } from '@chatdom/shared/twitch-moments';
import { RealmSupportObservationSchema } from '@chatdom/shared/realm';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import { channelChatNotification } from '../../../herald/src/twitch-moments/notices';
import { createRoomMomentFeed } from '../../../web/src/realm/adapters/moments';
import { observeRealm, type RealmObservedRoom } from '../../../web/src/realm/adapters/observer';
import { RealmIngress } from '../ingress/service';
import { PostgresOutboxStore } from '../outbox/store';
import { createRealmPool } from '../persistence/database';
import { createDurableRealmServices, type DurableKingdom, type DurableKingdomHold } from '../persistence/kingdom';
import { migrateRealmSchema } from '../persistence/migrate';
import { PostgresRealmRepository } from '../persistence/postgres-repository';

// Real normalized ingress, writer, Postgres transactions, dispatcher and browser observers. Only the room
// transport is an in-process bridge: this test makes no HTTP/WebSocket, Twitch or rendered-scene claim.
describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('durable support ingress and observers (SIMULATED)', () => {
  it('delivers one anonymous gift to two observers and restores current state quietly after reopening', async () => {
    if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 requires DATABASE_URL.');
    const schema = `support_test_${randomBytes(6).toString('hex')}`;
    const db = createRealmPool({ connectionString: process.env.DATABASE_URL, schema });
    const kingdomId = KingdomIdSchema.parse('900009601');
    const secret = randomBytes(32).toString('hex');
    const logs: string[] = [];
    const ingress = new RealmIngress(db, 'simulated', { herald: secret }, line => logs.push(line));
    const services = createDurableRealmServices({
      repository: new PostgresRealmRepository(db, { origin: 'simulated' }), outbox: new PostgresOutboxStore(db),
      auth: { authenticate: async () => { throw new Error('No room authentication in this transport-only test'); }, current: async () => false },
      kingdom: () => ({ world: REFERENCE_WORLD, layoutRevision: 'SIMULATED-support', spawn: () => [0, 0, 6] }),
    });
    ingress.use(services);
    let hold: DurableKingdomHold | undefined;
    const clients: ReturnType<typeof observerBridge>[] = [];
    try {
      await migrateRealmSchema(db, schema);
      hold = await services.retain(kingdomId);
      const kingdom = hold.kingdom;
      const first = observerBridge(kingdom), second = observerBridge(kingdom);
      clients.push(first, second);
      await until(() => first.observer.current().status === 'ready' && second.observer.current().status === 'ready');
      expect(first.resets).toEqual([{ throughSeq: 0, current: [] }]);

      // The provider parser sees a real-shaped anonymous aggregate. The raw account, names, chat words and
      // provider metadata must disappear before the authenticated, normalized service evidence is sent.
      const raw = {
        broadcaster_user_id: kingdomId, chatter_user_id: '1234567890123', chatter_user_name: 'PRIVATE_ANONYMOUS_ACCOUNT',
        chatter_is_anonymous: true, message_id: 'SIMULATED-gift-notice', notice_type: 'community_sub_gift',
        message: { text: 'PRIVATE_PROVIDER_WORDS' }, system_message: 'PRIVATE_PROVIDER_SYSTEM',
        community_sub_gift: { id: 'SIMULATED-group', total: 7, sub_tier: '1000' },
      };
      const notice = channelChatNotification.parse(raw, kingdomId);
      expect(notice).toMatchObject({ kind: 'aggregate', gifter: { personId: null, name: null }, total: 7 });
      const now = Number((await db.query('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now')).rows[0].now);
      const support = RealmSupportObservationSchema.parse({ version: 1, id: 'SIMULATED-support-delivery', kingdomId,
        origin: 'simulated', occurredAt: now, receivedAt: now, notice });
      const envelope = { version: 1, support };
      expect(await ingress.accept(`Bearer ${secret}`, envelope)).toEqual({ http: 202, body: { version: 1, status: 'accepted' } });
      await until(() => first.facts.length === 1 && second.facts.length === 1 && kingdom.delivery.delivered > 0);
      expect(first.facts).toEqual(second.facts);
      const fact = first.facts[0]!;
      expect(fact).toMatchObject({ kingdomId, seq: 1, actor: null, origin: 'simulated', type: 'twitch.moment',
        body: { kind: 'gifts', giver: null, forwardedFrom: null, total: 7, recipients: [] } });
      expect(kingdom.sequence).toBe(0);

      expect(await ingress.accept(`Bearer ${secret}`, envelope)).toEqual({ http: 202, body: { version: 1, status: 'duplicate' } });
      const outbox = (await db.query('SELECT message FROM realm_outbox WHERE kingdom_id = $1 ORDER BY id', [kingdomId])).rows;
      expect(outbox).toHaveLength(1);
      expect(first.facts).toHaveLength(1); expect(second.facts).toHaveLength(1);
      expect(JSON.parse(outbox[0].message)).toEqual({ type: 'moment', fact, current: true });
      const storedPublic = JSON.stringify(outbox);
      for (const privateValue of ['1234567890123', 'PRIVATE_ANONYMOUS_ACCOUNT', 'PRIVATE_PROVIDER_WORDS', 'PRIVATE_PROVIDER_SYSTEM', 'personId', 'chatter_user_id']) {
        expect(storedPublic).not.toContain(privateValue);
      }
      expect(Number((await db.query('SELECT count(*) AS n FROM realm_moment_facts')).rows[0].n)).toBe(1);

      const previousEpoch = kingdom.writerEpoch;
      first.dispose(); second.dispose();
      await hold.release(); hold = undefined;
      expect(services.kingdoms.size).toBe(0);
      hold = await services.retain(kingdomId);
      expect(hold.kingdom.writerEpoch).not.toBe(previousEpoch);
      const returning = observerBridge(hold.kingdom);
      clients.push(returning);
      await until(() => returning.observer.current().status === 'ready');
      expect(returning.resets).toEqual([{ throughSeq: 1, current: [fact] }]);
      expect(returning.facts).toEqual([]);
      expect([...returning.observer.current().moments!.current.values()]).toEqual([fact]);
      expect(returning.observer.current().cursor).toBe(kingdom.delivery.delivered);
      expect(logs).toEqual([]);
    } finally {
      for (const client of clients) client.dispose();
      await ingress.stop(); await hold?.release();
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await db.end();
    }
  }, 15_000);
});

/** Exercise production observers/feed with actual dispatcher deliveries and actual public checkpoints. */
function observerBridge(kingdom: DurableKingdom) {
  const handlers = new Map<string, (payload: never) => void>();
  const emit = (type: string, payload: unknown) => handlers.get(type)?.(payload as never);
  const room: RealmObservedRoom = {
    onMessage(type, callback) { handlers.set(type, callback); return () => { handlers.delete(type); }; },
    send(type) { if (type === 'bootstrap') queueMicrotask(() => emit('bootstrap', kingdom.publicCheckpoint())); },
  };
  const offDelivery = kingdom.subscribe(delivery => emit('world', delivery));
  const observer = observeRealm(room, { kingdomId: kingdom.kingdomId, origin: 'simulated', collisionRevision: kingdom.world.revision, layoutRevision: kingdom.layoutRevision });
  const facts: TwitchMomentFact[] = [], resets: { throughSeq: number; current: readonly TwitchMomentFact[] }[] = [];
  const offFeed = createRoomMomentFeed(observer, 'simulated').subscribe(
    info => resets.push({ throughSeq: info.throughSeq, current: info.current }), (_epoch, fact) => facts.push(fact), () => {},
  );
  return { observer, facts, resets, dispose() { offFeed(); observer.dispose(); offDelivery(); } };
}

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Support delivery or observer checkpoint did not arrive');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
