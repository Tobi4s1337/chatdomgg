import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import { generateSettlementPlan } from '@chatdom/world';
import { TenureEvidenceVerifier } from '../allocation';
import { encodeFoundedScene } from '../founded';
import { createRealmPool, migrateRealmSchema } from '../persistence';
import { createDurableRealmBoot } from './durable';

// SIMULATED test community and identity, isolated random Postgres schema. No production data or Twitch call.
describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('actual durable founded boot (SIMULATED)', () => {
  it('cold-serves exact adopted bytes through the one retained writer, enforces access/origin, and survives restart', async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('REALM_DATABASE_TESTS=1 requires DATABASE_URL.');
    const schema = `realm_boot_test_${randomBytes(6).toString('hex')}`;
    const pool = createRealmPool({ connectionString, schema });
    const directory = await mkdtemp(join(tmpdir(), 'chatdom-realm-boot-'));
    const verifier = new TenureEvidenceVerifier('simulated', randomBytes(32));
    const kingdomId = KingdomIdSchema.parse('900007001'), absent = KingdomIdSchema.parse('900007002');
    const request = { authorization: '', cookie: '', origin: '' };
    let allowed = true;
    const options = { pool, origin: 'simulated' as const, foundedDirectory: directory, verifier,
      foundedAccess: () => allowed, ingressCredentials: {} };
    const boot = createDurableRealmBoot(options);
    let restarted: ReturnType<typeof createDurableRealmBoot> | undefined;
    try {
      await migrateRealmSchema(pool, schema);
      await expect(boot.founded.manifest(absent, request)).rejects.toMatchObject({ status: 404 });
      expect((await pool.query('SELECT 1 FROM realm_kingdoms WHERE kingdom_id = $1', [absent])).rowCount).toBe(0);
      const plan = generateSettlementPlan({ seed: 'SIMULATED-durable-boot', tier: 'hamlet', firstYear: 2026, year: 2026 });
      expect(await boot.allocation.adoptLayout(kingdomId, plan)).toMatchObject({ status: 'founded' });

      allowed = false;
      await expect(boot.founded.manifest(kingdomId, request)).rejects.toMatchObject({ status: 403 });
      expect(boot.services.kingdoms.size).toBe(0);
      allowed = true;
      // Cold read has no walker, session, synthetic bootstrap principal or prior retained writer.
      const manifest = await boot.founded.manifest(kingdomId, request);
      expect(manifest).toMatchObject({ kingdomId, origin: 'simulated', layoutRevision: plan.revision });
      expect(boot.services.kingdoms.size).toBe(0);
      const bytes = await boot.founded.scene(manifest.sceneHash, request);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.sceneHash);
      expect(JSON.parse(new TextDecoder().decode(bytes)).plan).toEqual(plan);
      // Merely valid persisted bytes are not public authority: the pinned native baseline has no adopted revision.
      const baseline = await encodeFoundedScene({ ...JSON.parse(new TextDecoder().decode(bytes)), collisionRevision: 0 });
      await boot.store.put(baseline.bytes, baseline.manifest);
      await expect(boot.founded.scene(baseline.manifest.sceneHash, request)).rejects.toMatchObject({ status: 404 });

      const hold = await boot.services.retain(kingdomId);
      try {
        expect(await boot.founded.manifest(kingdomId, request)).toEqual(manifest);
        expect(boot.services.kingdoms.get(kingdomId)).toBe(hold.kingdom);
        expect(hold.kingdom.current).toBe(true);
        expect(hold.kingdom.world).toBe(boot.loader.current(kingdomId)?.world);
        const rows = await pool.query('SELECT writer_epoch FROM realm_kingdoms WHERE kingdom_id = $1', [kingdomId]);
        expect(rows.rows[0].writer_epoch).toBe(hold.kingdom.writerEpoch);
      } finally { await hold.release(); }

      allowed = false;
      await expect(boot.founded.scene(manifest.sceneHash, request)).rejects.toMatchObject({ status: 403 });
      allowed = true;
      // The real database authenticator refuses a foreign-origin ticket; it never uses reference/session issuance.
      const person = PersonIdSchema.parse('900007003'), session = randomUUID(), ticket = randomUUID();
      await pool.query('INSERT INTO realm_persons (person_id, origin, identity_issuer) VALUES ($1, $2, $3)', [person, 'live', 'SIMULATED-test-issuer']);
      await pool.query(`INSERT INTO realm_sessions (session_id, handle_hash, person_id, origin, resume_scope, expires_at)
        VALUES ($1, $2, $3, 'live', $4, now() + interval '1 hour')`, [session, randomBytes(32), person, randomUUID()]);
      await pool.query(`INSERT INTO realm_tickets (ticket_hash, session_id, person_id, kingdom_id, protocol, origin, requested_by, expires_at)
        VALUES ($1, $2, $3, $4, 1, 'live', 'SIMULATED-test', now() + interval '1 minute')`,
      [createHash('sha256').update(ticket).digest(), session, person, kingdomId]);
      await expect(boot.services.auth.authenticate({ protocol: 1, kingdomId, ticket })).rejects.toMatchObject({ code: 403 });
      expect((await pool.query('SELECT 1 FROM realm_entries')).rowCount).toBe(0);

      await boot.stop();
      restarted = createDurableRealmBoot(options);
      expect(await restarted.founded.manifest(kingdomId, request)).toEqual(manifest);
      expect(await restarted.founded.scene(manifest.sceneHash, request)).toEqual(bytes);
      await writeFile(join(directory, 'scenes', `${manifest.sceneHash}.json`), 'SIMULATED corrupt bytes');
      await expect(restarted.founded.scene(manifest.sceneHash, request)).rejects.toThrow('corrupt');
    } finally {
      await boot.stop(); await restarted?.stop();
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end(); await rm(directory, { recursive: true, force: true });
    }
  }, 60_000);
});
