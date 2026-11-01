import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type PresenceInput } from '@chatdom/shared';
import { generateSettlementPlan } from '@chatdom/world';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import { AllocationService, TenureEvidenceVerifier } from '../allocation';
import { createRealmCitizens } from '../evening/citizens';
import { PostgresOutboxStore } from '../outbox/store';
import { createRealmPool, RealmStorageUnavailableError, RealmWriterFencedError } from '../persistence/database';
import { createDurableRealmServices, type DurableKingdomHold } from '../persistence/kingdom';
import { migrateRealmSchema } from '../persistence/migrate';
import { PostgresRealmRepository } from '../persistence/postgres-repository';
import { decodeIngressCheckpoint, presencePerson } from './codec';
import { RealmIngress } from './service';
import { presenceTransition } from './transition';

// Actual allocation, ingress inbox/receipts, checkpoint reducer, moment records and outbox in a throwaway schema.
// No server, browser, Twitch request, managed schema or fake receipt is involved.
describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('committed homecoming (isolated SIMULATED Postgres)', () => {
  it('names the first fresh chat after source loss and writer restart, once, after its checkpoint commits', async () => {
    const f = await fixture();
    let unblock = () => {};
    try {
      await f.seedHome();
      const lost = f.loss(await f.at());
      await f.send(lost); await until(async () => await f.settled(lost));
      expect(presencePerson(decodeIngressCheckpoint((await f.hold.kingdom.loadIngress())!, f.kingdomId, 'simulated').presence, f.personId)?.publicName).toBeNull();
      await f.restart();
      await f.night();
      const input = f.chat(await f.at());
      const pause = new Promise<void>(resolve => { unblock = resolve; });
      const homecoming = f.ingress.moments.homecoming.bind(f.ingress.moments);
      let entered = false;
      const call = vi.spyOn(f.ingress.moments, 'homecoming').mockImplementation(async (kingdom, observation) => {
        if (observation.id === input.id) {
          const checkpoint = decodeIngressCheckpoint((await kingdom.loadIngress())!, f.kingdomId, 'simulated');
          expect(presencePerson(checkpoint.presence, f.personId)?.publicName).toBe('SIMULATED Wren');
          entered = true;
          await pause;
        }
        return homecoming(kingdom, observation);
      });
      await f.send(input);
      await until(() => entered);
      expect(await f.welcomes()).toEqual([]);
      expect(await f.record()).toBeUndefined(); // No quiet receipt is consumed before the committed name is read.
      expect(await f.settled(input)).toBe(false);
      // A concurrent, gate-admitted prerequisite can persist a later provider name before its own inbox write.
      // The old committed welcome must still use the actual committed checkpoint, not that future disclosure.
      await f.citizens.observe({ ...f.chat(await f.at()), kind: 'observe', source: 'chat', coverage: 'activity',
        people: [{ personId: f.personId, disclosure: 'named', displayName: 'SIMULATED Later Name' }] });
      unblock();
      await until(async () => await f.settled(input));
      expect(await f.welcomes()).toMatchObject([{ body: { kind: 'homecoming', credit: { displayName: 'SIMULATED Wren', slot: f.slot() } }, cause: { id: input.id } }]);
      expect((await f.send(input)).body.status).toBe('duplicate');
      const next = f.chat(await f.at());
      await f.send(next); await until(async () => await f.settled(next));
      expect(await f.welcomes()).toHaveLength(1);
      expect(call.mock.calls.filter(([, observation]) => observation.id === input.id)).toHaveLength(1);
    } finally { unblock(); await f.close(); }
  }, 60_000);

  for (const failure of ['storage', 'fenced'] as const) it(`retries a committed chat after ${failure} interrupts its welcome, without a second ingress or public beat`, async () => {
    const f = await fixture();
    try {
      await f.seedHome(); await f.send(f.loss(await f.at())); await f.restart(); await f.night();
      const input = f.chat(await f.at());
      const original = f.ingress.moments.homecoming.bind(f.ingress.moments);
      let failed = false;
      vi.spyOn(f.ingress.moments, 'homecoming').mockImplementation(async (kingdom, observation) => {
        if (observation.id === input.id) {
          if (failure === 'fenced') {
            await f.expireWriter();
            try { return await original(kingdom, observation); }
            catch (error) { expect(error).toBeInstanceOf(RealmWriterFencedError); failed = true; throw error; }
          }
          failed = true;
          throw new RealmStorageUnavailableError('SIMULATED interrupted moment store');
        }
        return original(kingdom, observation);
      });
      await f.send(input); await until(() => failed);
      expect(await f.settled(input)).toBe(false);
      expect(await f.record()).toBeUndefined();
      const before = await f.receipts(input);
      expect(before).toHaveLength(1);
      const epoch = f.hold.kingdom.writerEpoch;
      await f.restart();
      expect(f.hold.kingdom.writerEpoch).not.toBe(epoch);
      await until(async () => await f.settled(input));
      expect(await f.welcomes()).toHaveLength(1);
      expect(await f.receipts(input)).toEqual(before);
      expect((await f.send(input)).body.status).toBe('duplicate');
      expect(await f.welcomes()).toHaveLength(1);
    } finally { await f.close(); }
  }, 60_000);

  it('does not consume a quiet welcome for chat invalidated by later source loss, and remembers a new home through restart', async () => {
    const f = await fixture();
    try {
      await f.night();
      const newCitizen = f.chat(await f.at());
      // Allocate before acceptance, then restart before the observation is drained: no process-local `fresh` flag.
      await f.citizens.observe(newCitizen);
      await f.restart(); await f.send(newCitizen); await until(async () => await f.settled(newCitizen));
      expect(await f.welcomes()).toEqual([]);
      expect(await f.record()).toMatchObject({ nightKey: 'night.1' });
      await f.night();
      const input = f.chat(await f.at());
      const original = f.ingress.moments.homecoming.bind(f.ingress.moments);
      vi.spyOn(f.ingress.moments, 'homecoming').mockImplementation(async (kingdom, observation) => {
        if (observation.id === input.id) {
          const lost = f.loss(await f.at());
          const admission = f.ingress.gate.observe('herald', lost);
          if (!admission.ok || admission.admitted.kind !== 'observation') throw new Error('SIMULATED loss must be admitted');
          await kingdom.ingest({ source: 'herald', digest: admission.admitted.digest, observation: lost, receivedAt: lost.observedAt },
            presenceTransition({ service: 'herald', observation: lost, writerEpoch: kingdom.writerEpoch }));
        }
        return original(kingdom, observation);
      });
      await f.send(input); await until(async () => await f.settled(input));
      expect(await f.welcomes()).toEqual([]);
      expect(await f.record()).toMatchObject({ nightKey: 'night.1' }); // It did not claim night.2 anonymously.
      const recovered = f.chat(await f.at());
      await f.send(recovered); await until(async () => await f.settled(recovered));
      expect(await f.welcomes()).toHaveLength(1);
    } finally { await f.close(); }
  }, 60_000);
});

async function fixture() {
  if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 requires DATABASE_URL.');
  const schema = `winddown_round_homecoming_${randomBytes(6).toString('hex')}`;
  const db = createRealmPool({ connectionString: process.env.DATABASE_URL, schema });
  await migrateRealmSchema(db, schema);
  const kingdomId = KingdomIdSchema.parse('900008031'), personId = PersonIdSchema.parse('900008032');
  const key = randomBytes(32), secret = randomBytes(32).toString('hex'), origin = 'simulated' as const;
  const plan = generateSettlementPlan({ seed: 'SIMULATED-castle-seat', tier: 'hamlet', firstYear: 2026, year: 2026 });
  let ingress: RealmIngress, citizens: ReturnType<typeof createRealmCitizens>, services: ReturnType<typeof createDurableRealmServices>, hold: DurableKingdomHold;
  let lastAt = 0, counter = 0;
  const at = async () => {
    let now: number;
    do {
      now = Number((await db.query('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now')).rows[0].now);
      if (now <= lastAt) await new Promise(resolve => setTimeout(resolve, 2));
    } while (now <= lastAt);
    lastAt = now;
    return now;
  };
  const common = (observedAt: number) => ({ version: 1 as const, kingdomId, origin, observedAt, id: `SIMULATED:${++counter}` });
  const chat = (observedAt: number): PresenceInput => ({ ...common(observedAt), kind: 'observe', source: 'chat', coverage: 'activity',
    people: [{ personId, disclosure: 'named', displayName: 'SIMULATED Wren' }] });
  const loss = (observedAt: number): PresenceInput => ({ ...common(observedAt), kind: 'source-lost', sources: ['chat'], reason: 'unavailable' });
  const start = async () => {
    ingress = new RealmIngress(db, origin, { herald: secret });
    citizens = createRealmCitizens({ db, origin, kingdomNames: new Map([[kingdomId, 'SIMULATED Emberwick']]) });
    const allocation = new AllocationService(db, { origin, verifier: new TenureEvidenceVerifier(origin, key), furnish: citizens.furnish });
    expect(['founded', 'unchanged']).toContain((await allocation.adoptLayout(kingdomId, plan)).status);
    services = createDurableRealmServices({ repository: new PostgresRealmRepository(db, { origin }), outbox: new PostgresOutboxStore(db),
      auth: { authenticate: async () => { throw new Error('SIMULATED no sign-in'); }, current: async () => false },
      kingdom: () => ({ world: REFERENCE_WORLD, layoutRevision: plan.revision, spawn: () => [0, 0, 6] }), attach: kingdom => ingress.attach(kingdom) });
    ingress.use(services); citizens.use(allocation, services);
    hold = await services.retain(kingdomId);
  };
  const stop = async () => {
    await ingress.stop(); await hold.release();
    await Promise.all([...services.kingdoms.values()].map(kingdom => kingdom.dispose()));
  };
  const send = async (observation: PresenceInput) => {
    // The production bridge runs this prerequisite only after authenticating the provider; names and the installed
    // home must exist before presence binds its window. No homecoming is emitted by this prerequisite anymore.
    await citizens.observe(observation);
    return ingress.accept(`Bearer ${secret}`, { version: 1, observation });
  };
  const settled = async (input: PresenceInput) => (await db.query('SELECT settled_ms IS NOT NULL AS done FROM realm_ingress_inbox WHERE observation_id = $1', [input.id])).rows[0]?.done === true;
  await start();
  return {
    kingdomId, personId, at, chat, loss, send, settled,
    get ingress() { return ingress; }, get citizens() { return citizens; }, get hold() { return hold; },
    slot: () => Object.values(hold.kingdom.privateState.homes)[0]!.slot,
    expireWriter: async () => { await db.query('UPDATE realm_kingdoms SET lease_expires_ms = 0 WHERE kingdom_id = $1', [kingdomId]); },
    receipts: async (input: PresenceInput) => (await db.query('SELECT observation_id, checkpoint_revision, writer_epoch FROM realm_ingress_receipts WHERE observation_id = $1', [input.id])).rows,
    record: async () => {
      const row = (await db.query('SELECT value FROM realm_moment_values WHERE record_key = $1', [`twitch-moments:homecoming:${personId}`])).rows[0];
      return row ? JSON.parse(row.value) : undefined;
    },
    welcomes: async () => (await db.query("SELECT fact FROM realm_moment_facts WHERE fact::jsonb->'body'->>'kind' = 'homecoming' ORDER BY seq")).rows.map(row => JSON.parse(row.fact)),
    seedHome: async () => { const input = chat(await at()); await send(input); await until(async () => await settled(input)); },
    night: async () => {
      const now = await at();
      expect((await ingress.accept(`Bearer ${secret}`, { version: 1, moment: { version: 1, id: `SIMULATED:night:${++counter}`, kingdomId,
        origin, occurredAt: now, receivedAt: now, notice: { kind: 'stream', phase: 'online', streamId: `SIMULATED:stream:${counter}`, startedAt: now } } })).http).toBe(202);
    },
    restart: async () => { await stop(); await start(); },
    close: async () => { try { await stop(); } finally { await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await db.end(); } },
  };
}

async function until(test: () => boolean | Promise<boolean>) {
  const deadline = performance.now() + 10_000;
  while (!await test()) {
    if (performance.now() >= deadline) throw new Error('SIMULATED committed homecoming did not settle');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
