import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runnerImport } from 'vite';
import type { Pool } from 'pg';
import { createItemCatalogue, createRealmItems } from '../items';
import { createPostgresItemStore } from '../items/postgres';
import { createPostgresFishingAdmission } from './entry';
import { createPostgresFishingCatchWriter } from './catches';
import { createFishingSpecies } from './species';
import { readRodHistory } from './rod-history';
import { common, definitions, freshKingdom, pierTestPool, rare, retained, sender, wonCast } from './catch-test-fixtures';

const enabled = process.env.REALM_DATABASE_TESTS === '1';
let pool: Pool;
const legend = { ...rare, id: 'fish:test-legend', name: 'Test legend', legend: true as const };

describe.runIf(enabled)('the rod’s history on isolated Postgres', () => {
  beforeAll(async () => {
    if (process.env.REALM_DATABASE_SCHEMA !== 'pier' || !process.env.DATABASE_URL) throw new Error('Set REALM_DATABASE_SCHEMA=pier and DATABASE_URL for this suite.');
    pool = pierTestPool(process.env.DATABASE_URL, 2);
    const { module } = await runnerImport<typeof import('../persistence/migrate')>(resolve('apps/realm/src/persistence/migrate.ts'), { configFile: false });
    await module.migrateRealmSchema(pool, 'pier');
  });
  afterAll(async () => { if (pool) await pool.end(); });

  it('counts the person’s own pier catches and remembers the first legend', async () => {
    const kingdomId = freshKingdom(), hold = await retained(pool, kingdomId);
    try {
      const owner = await sender(pool, kingdomId), other = await sender(pool, kingdomId), store = createPostgresItemStore({ pool });
      const catalogue = createItemCatalogue(definitions(common, legend)), items = createRealmItems({ store, catalogue, clock: Date.now });
      const admit = createPostgresFishingAdmission({ pool, origin: 'simulated', readiness: { held: () => null } });
      const all = createFishingSpecies([common, legend]);
      const keep = async (who: typeof owner, fish: typeof common) => {
        const cast = wonCast(kingdomId, who.personId, fish);
        const kept = await createPostgresFishingCatchWriter({ kingdomId, origin: 'simulated', store, items, catalogue, species: createFishingSpecies([fish]),
          where: 'pier', authority: () => hold.kingdom, candidate: cast.casts.candidate, finish: cast.casts.finish, admit }).keep(who.from, cast.id);
        expect(kept.status).toBe('kept');
      };
      const read = (who: typeof owner) => readRodHistory(pool, { kingdomId, origin: 'simulated', ownerId: who.personId, species: all });
      expect(await read(owner)).toEqual({ catches: 0, notches: 0, legend: null, reachM: 0 });
      await keep(owner, common); await keep(owner, legend); await keep(owner, common); await keep(other, common);
      const history = await read(owner);
      expect(history).toMatchObject({ catches: 3, notches: 0, reachM: 0, legend: { speciesId: legend.id } });
      expect(Number.isSafeInteger(history.legend!.at)).toBe(true);
      expect(await read(other)).toMatchObject({ catches: 1, legend: null });
    } finally { await hold.release(); }
  }, 60_000);
});
