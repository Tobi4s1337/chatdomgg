import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runnerImport } from 'vite';
import type { Pool } from 'pg';
import { fishingHash, type FishSpecies, type FishingEnvironment, type KingdomId, type PersonId } from '@chatdom/shared';
import { fishMountId } from '../../../../packages/content/src/keepsakes';
import { createItemCatalogue, createRealmItems } from '../items';
import { createPostgresItemStore } from '../items/postgres';
import { assembleAlmanac, createPostgresPierAlmanacStore } from './almanac';
import { createPostgresChatCatchWriter } from './catches';
import { chatFight, type ChatCatchCandidate } from './chat';
import { common, definition, freshKingdom, pierTestPool, rare, retained, sender } from './catch-test-fixtures';
import { createFishingSpecies } from './species';

const enabled = process.env.REALM_DATABASE_TESTS === '1';
let pool: Pool;
const legend: FishSpecies = { ...rare, id: 'fish:test-legend', name: 'Legend', legend: true };
const mount = (fish: FishSpecies) => ({ id: fishMountId(fish.id), branch: 'kept' as const, title: `${fish.name}, mounted`, lore: fish.lore,
  stack: null, keepsake: true, model: fishMountId(fish.id), places: ['shelf', 'bag', 'away'] as const });
const environment: FishingEnvironment = { water: 'lake', biome: 'meadow', depthM: 2, hour: 'day', mood: 'clear' };

/** A chat line exactly as the realm plays it: seeded roll, the server's own steady hand, a landed fight. */
function chatCandidate(kingdomId: KingdomId, personId: PersonId, fish: FishSpecies, from = 1, water: FishSpecies[] = [fish]): ChatCatchCandidate {
  const species = createFishingSpecies(water);
  for (let castSeed = from; castSeed < from + 500; castSeed++) {
    const rolled = species.roll(environment, fishingHash(`roll:1:${castSeed}`));
    if (!rolled || rolled.speciesId !== fish.id) continue;
    const fightSeed = fishingHash(`fight:1:${castSeed}`), fight = chatFight(fightSeed, rolled.fight);
    if (fight.result.outcome !== 'landed') continue;
    return { version: 1, castId: randomUUID(), personId, kingdomId, at: Date.now() - 1000, float: [0, 0, 30], anchor: [0, 1, 23.4],
      collisionRevision: 7, environment, fish: rolled, castSeed, fightSeed, inputs: fight.inputs, result: fight.result };
  }
  throw new Error('No landed chat line in range.');
}

describe.runIf(enabled)('chat catches, firsts, mounts and the Almanac on isolated Postgres', () => {
  beforeAll(async () => {
    if (process.env.REALM_DATABASE_SCHEMA !== 'pier' || !process.env.DATABASE_URL) throw new Error('Set REALM_DATABASE_SCHEMA=pier and DATABASE_URL for this suite.');
    const url = new URL(process.env.DATABASE_URL);
    if (url.hostname !== '127.0.0.1' || url.port !== '5410') throw new Error('Pier tests require Postgres at 127.0.0.1:5410.');
    pool = pierTestPool(process.env.DATABASE_URL, 6);
    expect((await pool.query('SELECT current_schema() AS schema')).rows[0]?.schema).toBe('pier');
    const { module } = await runnerImport<typeof import('../persistence/migrate')>(resolve('apps/realm/src/persistence/migrate.ts'), { configFile: false });
    await module.migrateRealmSchema(pool, 'pier');
  }, 120_000);
  afterAll(async () => { if (pool) await pool.end(); });

  const setup = (kingdomId: KingdomId, fish: FishSpecies[], authority: () => unknown) => {
    const store = createPostgresItemStore({ pool }), catalogue = createItemCatalogue([...fish.map(definition), ...fish.map(mount)]);
    const items = createRealmItems({ store, catalogue, clock: Date.now });
    const writer = () => createPostgresChatCatchWriter({ kingdomId, origin: 'simulated', store, items, catalogue,
      species: createFishingSpecies(fish), where: 'Willowmere pier', authority: authority as never });
    return { store, items, writer };
  };

  it('keeps a chat catch with its fish, mount and record, and replays it once', async () => {
    const kingdomId = freshKingdom(), hold = await retained(pool, kingdomId);
    try {
      const person = await sender(pool, kingdomId), { items, writer } = setup(kingdomId, [common, legend], () => hold.kingdom);
      const candidate = chatCandidate(kingdomId, person.personId, common);
      const kept = await writer().keep(candidate, 'saoirse_k');
      expect(kept).toMatchObject({ status: 'kept', replayed: false, catch: { kingdomFirst: true, personalFirst: true, via: 'chat', name: 'saoirse_k' },
        item: { ownerId: person.personId, story: { by: { name: 'saoirse_k' } } }, keepsake: { defId: fishMountId(common.id), number: 1, place: 'shelf' } });
      expect(await writer().keep(candidate, 'saoirse_k')).toMatchObject({ status: 'kept', replayed: true });
      expect((await items.list(person.personId, kingdomId)).map(item => item.defId).sort()).toEqual([common.id, fishMountId(common.id)].sort());
      // A legend never comes off a chat line, and a forged fight never replays.
      expect(await writer().keep(chatCandidate(kingdomId, person.personId, legend), 'saoirse_k')).toEqual({ status: 'refused' });
      const forged = chatCandidate(kingdomId, person.personId, common, 600);
      expect(await writer().keep({ ...forged, inputs: [] }, 'saoirse_k')).toEqual({ status: 'refused' });
      expect(await writer().keep({ ...forged, kingdomId: freshKingdom() }, 'saoirse_k')).toEqual({ status: 'refused' });
    } finally { await hold.release(); }
  }, 60_000);

  it('gives exactly one first per kingdom and species under a race', async () => {
    const kingdomId = freshKingdom(), hold = await retained(pool, kingdomId);
    try {
      const people = await Promise.all(Array.from({ length: 6 }, () => sender(pool, kingdomId)));
      const { writer } = setup(kingdomId, [common], () => hold.kingdom);
      const results = await Promise.all(people.map((person, n) => writer().keep(chatCandidate(kingdomId, person.personId, common, 1 + n * 40), `p${n}`)));
      expect(results.every(result => result.status === 'kept')).toBe(true);
      const firsts = results.filter(result => result.status === 'kept' && result.catch.kingdomFirst);
      expect(firsts).toHaveLength(1);
      expect(results.filter(result => result.status === 'kept' && result.keepsake)).toHaveLength(1);
      expect((await pool.query('SELECT count(*)::int AS n FROM realm_fishing_catches WHERE kingdom_id=$1 AND kingdom_first', [kingdomId])).rows[0]?.n).toBe(1);
    } finally { await hold.release(); }
  }, 60_000);

  it('numbers rare mounts gaplessly and uniquely under concurrency', async () => {
    const kingdomId = freshKingdom(), hold = await retained(pool, kingdomId);
    try {
      const people = await Promise.all(Array.from({ length: 4 }, () => sender(pool, kingdomId)));
      const { writer } = setup(kingdomId, [rare], () => hold.kingdom);
      const candidates = Array.from({ length: 10 }, (_, n) => chatCandidate(kingdomId, people[n % 4]!.personId, rare, 1 + n * 40));
      // Each catch is sent twice at once: retries must never mint a second number.
      const results = await Promise.all([...candidates, ...candidates].map(candidate => writer().keep(candidate, 'angler')));
      expect(results.every(result => result.status === 'kept')).toBe(true);
      const numbers = new Map<string, number>();
      for (const result of results) if (result.status === 'kept') {
        const previous = numbers.get(result.catch.id);
        if (previous !== undefined) expect(result.keepsake?.number).toBe(previous);
        numbers.set(result.catch.id, result.keepsake!.number!);
      }
      expect([...numbers.values()].sort((a, b) => a - b)).toEqual(Array.from({ length: 10 }, (_, n) => n + 1));
    } finally { await hold.release(); }
  }, 90_000);

  it('refuses a chat catch once another writer holds the kingdom', async () => {
    const kingdomId = freshKingdom(), hold = await retained(pool, kingdomId);
    const person = await sender(pool, kingdomId);
    const stale = hold.kingdom;
    await hold.release();
    const { writer } = setup(kingdomId, [common], () => stale);
    expect((await writer().keep(chatCandidate(kingdomId, person.personId, common), 'x')).status).toBe('refused');
  }, 60_000);

  it('reads the Almanac from the ledger: approved names, hidden names after moderation, no person ids', async () => {
    const kingdomId = freshKingdom(), hold = await retained(pool, kingdomId);
    try {
      const [shown, hidden] = await Promise.all([sender(pool, kingdomId), sender(pool, kingdomId)]);
      const { writer } = setup(kingdomId, [common, rare], () => hold.kingdom);
      expect((await writer().keep(chatCandidate(kingdomId, hidden.personId, common, 1, [common, rare]), 'quiet_one')).status).toBe('kept');
      expect((await writer().keep(chatCandidate(kingdomId, shown.personId, common, 300, [common, rare]), 'saoirse_k')).status).toBe('kept');
      expect((await writer().keep(chatCandidate(kingdomId, shown.personId, rare, 1, [common, rare]), 'saoirse_k')).status).toBe('kept');
      const almanacs = createPostgresPierAlmanacStore({ pool, origin: 'simulated' });
      await almanacs.hide(kingdomId, hidden.personId, Date.now());
      await almanacs.hide(kingdomId, hidden.personId, Date.now());
      expect(await almanacs.hidden(kingdomId, hidden.personId)).toBe(true);
      expect(await almanacs.hidden(kingdomId, shown.personId)).toBe(false);
      const almanac = assembleAlmanac({ kingdomId, kingdom: 'Willowmere', asOf: Date.now(), species: createFishingSpecies([common, rare]),
        water: { water: 'lake', biome: 'meadow' }, rows: await almanacs.rows(kingdomId) });
      const json = JSON.stringify(almanac);
      expect(json).not.toContain(shown.personId); expect(json).not.toContain(hidden.personId); expect(json).not.toContain('quiet_one');
      expect(almanac.entries.find(entry => entry.speciesId === common.id)).toMatchObject({ status: 'caught', count: 2, first: { name: null, via: 'chat' }, mounts: 1 });
      expect(almanac.entries.find(entry => entry.speciesId === rare.id)).toMatchObject({ status: 'caught', count: 1, first: { name: 'saoirse_k' }, mounts: 1 });
      const marks = await almanacs.marks(kingdomId, shown.personId);
      expect(marks.map(mark => [mark.speciesId, mark.count, mark.kingdomFirst])).toEqual([[common.id, 1, false], [rare.id, 1, true]]);
    } finally { await hold.release(); }
  }, 60_000);
});
