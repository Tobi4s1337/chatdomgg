import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, PresenceInputSchema, type PresenceInput } from '@chatdom/shared';
import type { DeliveryFrame } from '../../../../packages/twitch/src/index';
import type { RealmDeliverySink } from '../../../herald/src/realm-delivery/sink';
import { ChatIngest, CLOCK_SKEW_MS } from '../../../herald/src/ingest/ingest';
import { planSubscriptions } from '../../../herald/src/ingest/subscriptions';
import { MemoryBindingStore } from '../../../herald/src/source/bindings';
import { toPresenceInput } from '../../../herald/src/source/observations';
import { PresenceSource } from '../../../herald/src/source/source';
import { IngressGate } from '../ingress/gate';
import { migrateRealmSchema } from '../persistence/migrate';
import { RaidGuestAuthority, type RaidGuestChatResult } from './guests';
import { RaidObservationLedger } from './observations';

const host = KingdomIdSchema.parse('900009201'), raider = KingdomIdSchema.parse('900009101');
const heraldKey = 'SIMULATED-private-herald-key-00000001', panelKey = 'SIMULATED-private-panel-key-000000001';
const plans = planSubscriptions({ broadcasterId: host, readerId: '900009301', clientId: 'SIMULATED' });
const plan = plans.find(value => value.type === 'channel.chat.message')!;
const BODY = 'SIMULATED ordinary chat must never become stored evidence';
const chatInput = (observedAt: number) => ({ version: 1, id: 'chat:clock', kingdomId: host, origin: 'simulated',
  kind: 'observe', source: 'chat', coverage: 'activity', observedAt,
  people: [{ personId: '990090001', disclosure: 'named', displayName: 'Visitor' }] });

async function delivery(clock: () => number, consume: (input: PresenceInput) => Promise<void>, command?: RealmDeliverySink['command']) {
  const sink: RealmDeliverySink = { observation: consume, speech: () => {}, clear: () => {}, remove: () => {}, ...(command ? { command } : {}) };
  const source = new PresenceSource({ kingdomId: host, origin: 'simulated', slots: [1, 2, 3, 4],
    store: new MemoryBindingStore(), now: clock, tickMs: 0, realm: sink });
  await source.open(); source.setAvailable(true);
  await source.submit({ version: 1, id: 'stream:provider-time', origin: 'simulated', kingdomId: host,
    kind: 'stream', live: true, sessionId: 'stream-session:provider-time', observedAt: clock() });
  const ingest = new ChatIngest({ source, conduitId: 'SIMULATED', clientId: 'SIMULATED', plans, covered: () => true,
    onAuthorizationRevoked: () => {}, onSubscriptionRevoked: () => {}, now: clock, ...(command ? { realm: sink } : {}) });
  const frame = (id: string, personId: string, at: number, words = BODY): DeliveryFrame => ({ kind: 'notification',
    meta: { messageId: `eventsub:${id}`, at }, subscription: { id: 'SIMULATED', conduitId: 'SIMULATED', status: 'enabled',
      type: plan.type, version: plan.version, condition: plan.condition }, event: {
      broadcaster_user_id: host, broadcaster_user_login: 'destination', broadcaster_user_name: 'Destination',
      chatter_user_id: personId, chatter_user_login: 'visitor', chatter_user_name: 'Visitor', message_id: id,
      message: { text: words, fragments: [{ type: 'text', text: words, cheermote: null, emote: null, mention: null }] },
      color: '', badges: [], message_type: 'text', cheer: null, reply: null, channel_points_custom_reward_id: null,
      source_broadcaster_user_id: null, source_broadcaster_user_login: null, source_broadcaster_user_name: null,
      source_message_id: null, source_badges: null,
    } });
  return { source, ingest, frame, close: async () => { ingest.dispose(); await source.close(); } };
}

describe('verified chat provider time', () => {
  it('bounds optional metadata to one chat and preserves existing inputs and normal payloads', () => {
    const input = chatInput(1_000);
    expect(PresenceInputSchema.parse(input)).toEqual(input);
    for (const providerAt of [1_000, 1_001, 6_000]) expect(PresenceInputSchema.safeParse({ ...input, providerAt }).success).toBe(true);
    for (const providerAt of [999, 6_001, -1, NaN, Infinity, 1_001.5]) expect(PresenceInputSchema.safeParse({ ...input, providerAt }).success).toBe(false);
    for (const source of ['panel', 'walker', 'chatters']) expect(PresenceInputSchema.safeParse({ ...input, source, providerAt: 1_001 }).success).toBe(false);
    expect(PresenceInputSchema.safeParse({ ...input, providerAt: 1_001, people: [] }).success).toBe(false);
    expect(PresenceInputSchema.safeParse({ ...input, providerAt: 1_001, people: [...input.people,
      { personId: '990090002', disclosure: 'anonymous' }] }).success).toBe(false);
    expect(PresenceInputSchema.safeParse({ version: 1, id: 'stream:invalid', kingdomId: host, origin: 'simulated',
      kind: 'stream', live: false, sessionId: null, observedAt: 1_000, providerAt: 1_001 }).success).toBe(false);
    const normal = toPresenceInput({ kind: 'chat', messageId: 'normal', at: 1_000, providerAt: 1_000,
      author: { id: '990090001', displayName: 'Visitor' } }, host, 'simulated');
    expect(normal).not.toHaveProperty('providerAt');
  });

  it('admits retained time only through the authenticated Herald observation door', () => {
    const gate = new IngressGate({ herald: heraldKey, panel: panelKey }, 'simulated');
    const input = { ...chatInput(1_000), providerAt: 1_001 }, body = { version: 1, observation: input };
    expect(gate.admit(undefined, body)).toMatchObject({ ok: false, status: 'unauthenticated' });
    expect(gate.admit(`Bearer ${panelKey}`, body)).toMatchObject({ ok: false, status: 'refused' });
    expect(gate.admit(`Bearer ${heraldKey}`, body)).toMatchObject({ ok: true, admitted: { service: 'herald', observation: input } });
    expect(gate.admit(`Bearer ${heraldKey}`, { version: 1, observation: { ...input, source: 'panel' } })).toMatchObject({ ok: false });
    expect(gate.admit(`Bearer ${heraldKey}`, { version: 1, observation: { ...input, origin: 'live' } })).toMatchObject({ ok: false });
    expect(gate.admit(`Bearer ${heraldKey}`, { version: 1, observation: { ...input, providerAt: 6_001 } })).toMatchObject({ ok: false });
  });

  it('keeps normalized presence time while retaining only tolerated provider skew after subscription verification', async () => {
    const now = 1_800_000_000_000, forwarded: PresenceInput[] = [];
    const path = await delivery(() => now, async input => { if (input.kind === 'observe') forwarded.push(input); });
    try {
      path.ingest.handle(path.frame('exact', '990090001', now));
      path.ingest.handle(path.frame('skew', '990090002', now + CLOCK_SKEW_MS));
      path.ingest.handle(path.frame('too-future', '990090003', now + CLOCK_SKEW_MS + 1));
      const foreign = path.frame('unverified', '990090004', now + 1);
      path.ingest.handle({ ...foreign, subscription: { ...foreign.subscription, conduitId: 'another-conduit' } });
      await vi.waitFor(() => expect(path.ingest.health().pending).toBe(0));
      expect(forwarded).toHaveLength(2);
      expect(forwarded[0]).toMatchObject({ id: 'chat:exact', observedAt: now });
      expect(forwarded[0]).not.toHaveProperty('providerAt');
      expect(forwarded[1]).toMatchObject({ id: 'chat:skew', observedAt: now, providerAt: now + CLOCK_SKEW_MS });
      expect(path.ingest.health().counters).toMatchObject({ future: 1, unverified: 1, chatSubmitted: 2 });
      expect(JSON.stringify(forwarded)).not.toContain(BODY);
      expect(JSON.stringify(path.source.current)).not.toContain('providerAt');
    } finally { await path.close(); }
  });

  it('preserves the same original provider timestamp on the generic command evidence path', async () => {
    const now = 1_800_000_000_000;
    const command = vi.fn<NonNullable<RealmDeliverySink['command']>>().mockResolvedValue(undefined);
    const path = await delivery(() => now, async () => {}, command);
    try {
      await path.ingest.handle(path.frame('future-command', '990090001', now + 4_000, '!fish'));
      await path.ingest.handle(path.frame('beyond-command', '990090001', now + CLOCK_SKEW_MS + 1, '!fish'));
      expect(command).toHaveBeenCalledOnce();
      expect(command.mock.calls[0]![0]).toMatchObject({ kind: 'command', messageId: 'future-command',
        at: now + 4_000, command: 'fish', arg: null });
      expect(path.ingest.health().counters.future).toBe(1);
      for (const type of ['channel.chat.message_delete', 'channel.chat.clear', 'channel.chat.clear_user_messages']) {
        const cleanup = plans.find(value => value.type === type)!;
        await path.ingest.handle({ kind: 'notification', meta: { messageId: `cleanup:${type}`, at: now + CLOCK_SKEW_MS },
          subscription: { id: 'SIMULATED', conduitId: 'SIMULATED', status: 'enabled', type, version: cleanup.version, condition: cleanup.condition },
          event: { broadcaster_user_id: host, broadcaster_user_login: 'destination', broadcaster_user_name: 'Destination',
            ...(type === 'channel.chat.clear' ? {} : { target_user_id: '990090001', target_user_login: 'visitor', target_user_name: 'Visitor' }),
            ...(type === 'channel.chat.message_delete' ? { message_id: 'future-command' } : {}) } });
      }
      expect(command).toHaveBeenCalledTimes(4);
      expect(command.mock.calls.slice(1).map(call => call[0])).toMatchObject([
        { kind: 'cleanup', reason: 'delete', at: now + CLOCK_SKEW_MS },
        { kind: 'cleanup', reason: 'clear', at: now + CLOCK_SKEW_MS },
        { kind: 'cleanup', reason: 'clear', at: now + CLOCK_SKEW_MS },
      ]);
      expect(command.mock.calls.slice(1).every(call => call[0].at > command.mock.calls[0]![0].at)).toBe(true);
    } finally { await path.close(); }
  });
});

describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('provider-time raid boundary on isolated Postgres', () => {
  const schema = `realm_test_provider_time_${randomBytes(6).toString('hex')}`;
  let admin: pg.Pool, pool: pg.Pool;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 requires DATABASE_URL');
    admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await migrateRealmSchema(admin, schema);
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path="${schema}"` });
  });
  afterAll(async () => { await pool?.end(); if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); } });

  it('never stamps a provider chat at raidEnd or raidEnd+1 when its normalized presence time is still inside', async () => {
    const raidAt = Date.now(), raidEnd = raidAt + 600_000;
    let now = raidAt;
    const people = ['990090011', '990090012', '990090013'];
    const setup = await pool.connect();
    try {
      await setup.query('BEGIN'); await setup.query('SET CONSTRAINTS ALL DEFERRED');
      for (const kingdom of [raider, host]) {
        await setup.query(`INSERT INTO realm_layout_heads VALUES ($1, 'simulated', 'r1', 'seed', 2020, $2, $2)`, [kingdom, raidAt]);
        await setup.query(`INSERT INTO realm_layouts VALUES ($1, 'r1', null, '{}', $2, $3)`, [kingdom, 'a'.repeat(64), raidAt]);
      }
      for (const [slot, personId] of people.entries()) {
        await setup.query(`INSERT INTO realm_persons (person_id, origin, identity_issuer, created_at) VALUES ($1, 'simulated', 'test-oidc', $2)`, [personId, new Date(raidAt - 1_000)]);
        await setup.query(`INSERT INTO realm_layout_plots VALUES ($1, 'r1', $2, $3, 2020, 'row', 0, '{}')`, [raider, personId, slot]);
        await setup.query(`INSERT INTO realm_layout_plots VALUES ($1, 'r1', $2, $3, 2020, 'row', 0, '{}')`, [host, personId, slot]);
        await setup.query(`INSERT INTO realm_deed_holders VALUES ($1, 'simulated', 1, $2)`, [personId, raidAt]);
        await setup.query(`INSERT INTO realm_deeds (deed_id, receipt, person_id, kingdom_id, origin, layout_revision, plot_id, slot,
          placement, tenure, evidence, status, allocated_ms) VALUES ($1,$2,$3,$4,'simulated','r1',$3,$5,'{}','{}','{}','pending',$6)`,
        [randomBytes(16).toString('hex'), `deed:${randomBytes(32).toString('hex')}`, personId, raider, slot, raidAt]);
      }
      await setup.query('COMMIT');
    } catch (error) { await setup.query('ROLLBACK'); throw error; } finally { setup.release(); }
    const authority = new RaidGuestAuthority({ pool, origin: 'simulated', clock: () => now });
    const ledger = new RaidObservationLedger({ pool, origin: 'simulated', clock: () => now,
      moment: async () => ({ http: 202, body: { status: 'accepted' } }) });
    await ledger.record({ version: 1, id: 'provider-time-raid', origin: 'simulated', kingdomId: host, direction: 'incoming',
      occurredAt: raidAt, receivedAt: raidAt, viewers: 3,
      from: { kingdomId: raider, login: 'raider', name: 'Raider' }, to: { kingdomId: host, login: 'destination', name: 'Destination' } });
    const gate = new IngressGate({ herald: heraldKey }, 'simulated');
    const forwarded: PresenceInput[] = [], results: Array<RaidGuestChatResult | null> = [], errors: unknown[] = [];
    const path = await delivery(() => now, async input => {
      if (input.kind !== 'observe') return;
      forwarded.push(input);
      const admission = gate.admit(`Bearer ${heraldKey}`, { version: 1, observation: input });
      if (!admission.ok || admission.admitted.kind !== 'observation') throw new Error('Expected verified Herald observation');
      try { results.push(await authority.observePresence(admission.admitted.observation)); } catch (error) { errors.push(error); }
    });
    try {
      now = raidEnd - 2;
      path.ingest.handle(path.frame('just-inside', people[0]!, raidEnd - 1));
      await vi.waitFor(() => expect(path.ingest.health().pending).toBe(0));
      // Allocation uses the normalized authority clock, one millisecond before the legitimate provider chat.
      // Its bounded skew may withhold a home, but must never move the passport's exact timestamp/window.
      await expect(pool.query(`INSERT INTO realm_deeds (deed_id, receipt, person_id, kingdom_id, origin, layout_revision, plot_id, slot,
        placement, tenure, evidence, status, allocated_ms) VALUES ($1,$2,$3,$4,'simulated','r1',$3,0,'{}','{}','{}','pending',$5)`,
      [randomBytes(16).toString('hex'), `deed:${randomBytes(32).toString('hex')}`, people[0], host, now])).rejects.toMatchObject({ code: 'RG001' });
      expect((await pool.query('SELECT deed_id FROM realm_deeds WHERE person_id = $1 AND kingdom_id = $2', [people[0], host])).rows).toEqual([]);
      now = raidEnd - 1;
      path.ingest.handle(path.frame('at-end', people[1]!, raidEnd));
      path.ingest.handle(path.frame('just-outside', people[2]!, raidEnd + 1));
      await vi.waitFor(() => expect(path.ingest.health().pending).toBe(0));
      expect(errors).toEqual([]);
      expect(results.map(result => result?.status)).toEqual(['accepted', 'ignored', 'ignored']);
      expect(forwarded).toMatchObject([
        { id: 'chat:just-inside', observedAt: raidEnd - 2, providerAt: raidEnd - 1 },
        { id: 'chat:at-end', observedAt: raidEnd - 1, providerAt: raidEnd },
        { id: 'chat:just-outside', observedAt: raidEnd - 1, providerAt: raidEnd + 1 },
      ]);
      expect((await authority.history(people[0]!)).items).toMatchObject([{ kind: 'raid', occurredAt: raidEnd - 1 }]);
      expect((await authority.history(people[1]!)).items).toEqual([]);
      expect((await authority.history(people[2]!)).items).toEqual([]);
      expect((await pool.query('SELECT count(*)::integer AS n FROM realm_raid_guest_chat')).rows[0].n).toBe(1);
      expect(JSON.stringify(forwarded)).not.toContain(BODY);
    } finally { await path.close(); }
  });
});
