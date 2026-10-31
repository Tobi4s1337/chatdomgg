import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import { REALM_CASTLE_SLOT } from '@chatdom/shared/realm';
import { generateSettlementPlan } from '@chatdom/world';
import { TenureEvidenceVerifier } from '../allocation';
import { createDurableRealmBoot } from '../bootstrap';
import { createRealmPool, migrateRealmSchema } from '../persistence';
import { createRealmCastle } from './castle';
import { createRealmCitizens } from './citizens';

describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('native monarch seat (isolated SIMULATED Postgres)', () => {
  it('installs only the pinned adopted keep through the actual writer and guard, without a deed or free coal', async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('REALM_DATABASE_TESTS requires DATABASE_URL.');
    const schema = `realm_castle_test_${randomBytes(6).toString('hex')}`;
    const pool = createRealmPool({ connectionString, schema }), directory = await mkdtemp(join(tmpdir(), 'chatdom-castle-'));
    const origin = 'simulated' as const, kingdomId = KingdomIdSchema.parse('900008001'), monarch = PersonIdSchema.parse(kingdomId);
    const names = new Map([[kingdomId, 'SIMULATED Emberwick']]), key = randomBytes(32);
    const castle = createRealmCastle({ origin, kingdomNames: names, safetyKey: key });
    const citizens = createRealmCitizens({ db: pool, origin, kingdomNames: names, castle: castle.observe });
    const boot = createDurableRealmBoot({ pool, origin, foundedDirectory: directory,
      verifier: new TenureEvidenceVerifier(origin, key), foundedAccess: () => true, ingressCredentials: {},
      furnish: citizens.furnish, repositoryOptions: { guards: [castle.guard] } });
    citizens.use(boot.allocation, boot.services); castle.use(boot.allocation, boot.store);
    try {
      const migrated = await migrateRealmSchema(pool, schema);
      expect(migrated).toContain('0007_realm_castle_outbox');
      expect((await pool.query<{ definition: string }>(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conrelid = 'realm_outbox'::regclass AND conname = 'realm_outbox_kind_check'`)).rows[0]?.definition).toContain('castle');
      const plan = generateSettlementPlan({ seed: 'SIMULATED-castle-seat', tier: 'hamlet', firstYear: 2026, year: 2026 });
      await boot.allocation.adoptLayout(kingdomId, plan);
      const hold = await boot.services.retain(kingdomId);
      try {
        await hold.kingdom.execute('SIMULATED-prior-hold', { type: 'citizen.rights', personId: monarch,
          rights: { revision: 1, forge: false, build: false, blocked: true, safetyIdentifier: 'SIMULATED-old-safety' } }, 'moderation');
        const input = { version: 1 as const, id: 'SIMULATED-monarch-chat', kingdomId, origin,
          observedAt: hold.kingdom.databaseNow(), kind: 'observe' as const, source: 'chat' as const, coverage: 'activity' as const,
          people: [{ personId: monarch, disclosure: 'named' as const, displayName: 'SIMULATED Monarch' }] };
        await citizens.observe(input);
        const state = hold.kingdom.privateState, seat = state.castle!;
        expect(seat).toMatchObject({ ownerId: monarch, moduleId: plan.castle.beaconModuleId, slot: REALM_CASTLE_SLOT });
        expect(seat).not.toHaveProperty('allocationReceipt');
        const native = await boot.store.native(kingdomId, plan, origin);
        expect(seat.blueprint).toEqual(native.fixtures.find(p => p.id === seat.id)!.blueprint);
        expect(state.homes).toEqual({}); expect(state.coals).toEqual({});
        expect(state.rights[monarch]).toMatchObject({ revision: 2, forge: true, build: false, blocked: true });
        expect((await pool.query('SELECT 1 FROM realm_deeds')).rowCount).toBe(0);
        const manifest = await boot.founded.manifest(kingdomId, { authorization: '', cookie: '', origin: '' });
        expect(manifest).toMatchObject({ kingdomId, layoutRevision: plan.revision });
        // Provider chat is not an OIDC authentication, a follow date, or a reason to clear moderation.
        expect((await pool.query('SELECT 1 FROM realm_persons')).rowCount).toBe(0);
        await citizens.observe({ ...input, id: 'SIMULATED-chat-again', observedAt: hold.kingdom.databaseNow() });
        expect(hold.kingdom.privateState.sequence).toBe(state.sequence);
        // Even allocation capability cannot install different bytes under the adopted native keep identity.
        const forged = { ...seat, revision: 'SIMULATED-tampered', blueprint: { ...seat.blueprint, windows: [] } };
        expect(await castle.guard({ query: async () => { throw new Error('Must reject before SQL'); } } as never,
          { kingdomId, origin, body: { type: 'castle.installNative', castle: forged } } as never, state)).toBe('conflict');
      } finally { await hold.release(); }
      const reopened = await boot.services.retain(kingdomId);
      try { expect(reopened.kingdom.privateState.castle?.ownerId).toBe(monarch); }
      finally { await reopened.release(); }
    } finally {
      await boot.stop(); await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end(); await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
