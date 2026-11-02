import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RealmRoomServices } from '../ports';
import { createPostgresGatherStore, gatherStoreFor, installGatherStore, MemoryGatherStore, type GatherCommandRecord, type GatherSnapshot, type GatherStore } from './store';

const kingdom = 'kingdom:1';
const snapshot = (version = 1, table = 'dice'): GatherSnapshot => ({ table, version, kind: 'hearth-dice', match: 'match:1',
  players: [{ person: '1', name: 'Juniper', seat: 0 }, { person: '2', name: 'Moss', seat: 1 }],
  state: { seed: 0xabcdef01, cursor: 7, scores: [9, 12], deadline: 31_000 }, at: 1000 });
const command = (id = 'move:1', actor: string | null = '1', payload = '{"action":"roll"}'): GatherCommandRecord => ({ id, actor, payload, at: 1000 });

/** Run the same observable CAS/receipt contract against the real memory implementation and opt-in Postgres. */
function storeContract(make: () => GatherStore) {
  it('requires a null first version and atomically advances exactly one checkpoint version', async () => {
    const store = make();
    expect(await store.load(kingdom)).toEqual([]);
    expect(await store.commit(kingdom, 1, snapshot(2), command())).toBe('conflict');
    expect(await store.commit(kingdom, null, snapshot(), command())).toBe('committed');
    expect(await store.commit(kingdom, null, snapshot(), command('other'))).toBe('conflict');
    expect(await store.commit(kingdom, 1, snapshot(2), command('other'))).toBe('committed');
    expect(await store.load(kingdom)).toEqual([snapshot(2)]);
    expect(await store.commit(kingdom, 1, snapshot(2), command('stale'))).toBe('conflict');
    expect(await store.commit(kingdom, 2, snapshot(3), command('stale'))).toBe('committed');
  });
  it('serializes concurrent identical retries into one accepted move without changing the checkpoint', async () => {
    const store = make();
    const results = await Promise.all(Array.from({ length: 12 }, () => store.commit(kingdom, null, snapshot(), command())));
    expect(results.filter(result => result === 'committed')).toHaveLength(1);
    expect(results.filter(result => result === 'duplicate')).toHaveLength(11);
    expect(await store.load(kingdom)).toEqual([snapshot()]);
    expect(await store.commit(kingdom, 1, snapshot(2), command('later'))).toBe('committed');
    expect(await store.commit(kingdom, null, snapshot(), command())).toBe('duplicate');
    expect(await store.load(kingdom)).toEqual([snapshot(2)]);
  });
  it('binds a command across tables to exact payload and expected version', async () => {
    const store = make();
    expect(await store.commit(kingdom, null, snapshot(), command())).toBe('committed');
    expect(await store.commit(kingdom, 1, snapshot(2), command())).toBe('conflict');
    expect(await store.commit(kingdom, null, snapshot(1, 'east'), command())).toBe('conflict');
    expect(await store.commit(kingdom, null, snapshot(), command('move:1', '1', '{ "action": "roll" }'))).toBe('conflict');
    expect(await store.commit(kingdom, 1, snapshot(2), command('move:1', '1', '{"action":"hold"}'))).toBe('conflict');
    expect(await store.load(kingdom)).toEqual([snapshot()]);
  });
  it('allows only one competing CAS and never consumes a rejected command identity', async () => {
    const store = make();
    expect(await store.commit(kingdom, null, snapshot(), command())).toBe('committed');
    const results = await Promise.all(['a', 'b'].map(id => store.commit(kingdom, 1, snapshot(2), command(id))));
    const rejected = results[0] === 'conflict' ? 'a' : 'b';
    expect([...results].sort()).toEqual(['committed', 'conflict']);
    expect(await store.commit(kingdom, 2, snapshot(3), command(rejected))).toBe('committed');
  });
  it('serializes a reused identity across competing tables without initializing the losing table', async () => {
    const store = make();
    const results = await Promise.all(['east', 'west'].map(table => store.commit(kingdom, null, snapshot(1, table), command())));
    expect([...results].sort()).toEqual(['committed', 'conflict']);
    const winner = results[0] === 'committed' ? 'east' : 'west';
    expect(await store.load(kingdom)).toEqual([snapshot(1, winner)]);
  });
  it('isolates kingdoms and actors, including the system actor and a person literally named system', async () => {
    const store = make();
    expect(await store.commit(kingdom, null, snapshot(), command('same', null))).toBe('committed');
    expect(await store.commit(kingdom, 1, snapshot(2), command('same', 'system'))).toBe('committed');
    expect(await store.commit(kingdom, 2, snapshot(3), command('same', '2'))).toBe('committed');
    expect(await store.commit('kingdom:2', null, snapshot(), command('same', null))).toBe('committed');
    expect(await store.load('kingdom:2')).toEqual([snapshot()]);
    expect(await store.load(kingdom)).toEqual([snapshot(3)]);
  });
  it('takes private copies at commit and load without losing seed, cursor or deadline', async () => {
    const store = make(), next = snapshot(), expected = structuredClone(next), record = command();
    const pending = store.commit(kingdom, null, next, record);
    (next.state as { scores: number[] }).scores[0] = 999;
    (next.players[0] as { name: string }).name = 'Changed';
    (record as { payload: string }).payload = '{}';
    expect(await pending).toBe('committed');
    const loaded = await store.load(kingdom);
    expect(loaded).toEqual([expected]);
    (loaded[0]!.state as { scores: number[] }).scores[0] = -1;
    (loaded[0]!.players[0] as { name: string }).name = 'Changed again';
    expect(await store.load(kingdom)).toEqual([expected]);
    expect(await store.commit(kingdom, null, expected, command())).toBe('duplicate');
  });
}

describe('MemoryGatherStore (explicit test adapter)', () => {
  storeContract(() => new MemoryGatherStore());
  it('rejects invalid records before publishing either a checkpoint or a receipt', async () => {
    const store = new MemoryGatherStore(), good = snapshot();
    for (const next of [
      { ...good, version: 2 }, { ...good, version: 0 }, { ...good, version: Number.MAX_SAFE_INTEGER + 1 },
      { ...good, at: NaN }, { ...good, extra: 'not permitted' }, { ...good, table: '' },
      { ...good, players: [good.players[0]!, good.players[0]!] },
      { ...good, players: [{ person: '1', name: 'Juniper', seat: 4 }] },
      { ...good, state: { number: Infinity } }, { ...good, state: { missing: undefined } },
      { ...good, state: new Date() }, { ...good, state: { toJSON: () => ({ seed: 0 }) } },
      { ...good, state: Array(2) }, { ...good, state: { text: '🕯'.repeat(20_000) } },
    ]) {
      await expect(store.commit(kingdom, null, next, command())).rejects.toThrow('Invalid gather storage record.');
      expect(await store.load(kingdom)).toEqual([]);
    }
    const cycle: { self?: unknown } = {}; cycle.self = cycle;
    await expect(store.commit(kingdom, null, { ...good, state: cycle }, command())).rejects.toThrow('Invalid gather storage record.');
    for (const payload of ['not json', '{"n":1e999}', JSON.stringify('🕯'.repeat(20_000))]) {
      await expect(store.commit(kingdom, null, good, command('move:1', '1', payload))).rejects.toThrow('Invalid gather storage record.');
    }
    expect(await store.commit(kingdom, null, good, command())).toBe('committed');
    await expect(store.commit(kingdom, 0, good, command('bad-version'))).rejects.toThrow();
    await expect(store.commit(kingdom, 1, { ...snapshot(2), state: { seed: NaN } }, command('retryable'))).rejects.toThrow();
    expect(await store.load(kingdom)).toEqual([good]);
    expect(await store.commit(kingdom, 1, snapshot(2), command('retryable'))).toBe('committed');
  });
  it('attaches a store to exactly the services object that owns it', () => {
    const first = {} as RealmRoomServices, second = {} as RealmRoomServices, store = new MemoryGatherStore();
    expect(gatherStoreFor(first)).toBeUndefined();
    installGatherStore(first, store);
    expect(gatherStoreFor(first)).toBe(store);
    expect(gatherStoreFor(second)).toBeUndefined();
  });
});

/** Genuine Postgres coverage only: opt in with GATHER_DATABASE_TESTS=1 and DATABASE_URL. No SQL mocks. */
describe.runIf(process.env.GATHER_DATABASE_TESTS === '1')('Postgres gather store (requires opt-in DATABASE_URL; otherwise skipped)', () => {
  const schema = `gather_test_${randomBytes(6).toString('hex')}`;
  let pool: pg.Pool;
  let counter = 0;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('GATHER_DATABASE_TESTS=1 requires DATABASE_URL.');
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}`, max: 4 });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(await readFile(new URL('../persistence/migrations/0016_realm_gather.sql', import.meta.url), 'utf8'));
  });
  afterAll(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  });
  storeContract(() => {
    // A private kingdom prefix isolates each shared-contract test without mutating immutable history.
    const prefix = `case:${++counter}:`, store = createPostgresGatherStore(pool);
    return { load: id => store.load(prefix + id), commit: (id, expected, next, record) => store.commit(prefix + id, expected, next, record) };
  });
  it('restores private state through another store and rolls back checkpoint changes if append fails', async () => {
    const store = createPostgresGatherStore(pool), id = 'atomic:1';
    expect(await store.commit(id, null, snapshot(), command())).toBe('committed');
    expect(await createPostgresGatherStore(pool).load(id)).toEqual([snapshot()]);
    await pool.query("ALTER TABLE gather_table_moves ADD CONSTRAINT gather_test_failure CHECK (command_id <> 'fail-write')");
    await expect(store.commit(id, 1, snapshot(2), command('fail-write'))).rejects.toThrow();
    expect(await store.load(id)).toEqual([snapshot()]);
    await pool.query('ALTER TABLE gather_table_moves DROP CONSTRAINT gather_test_failure');
    expect(await store.commit(id, 1, snapshot(2), command('fail-write'))).toBe('committed');
    const moves = await pool.query<{ snapshot: string }>('SELECT snapshot FROM gather_table_moves WHERE kingdom_id = $1 ORDER BY version', [id]);
    expect(moves.rows.map(row => JSON.parse(row.snapshot))).toEqual([snapshot(), snapshot(2)]);
    await expect(pool.query('UPDATE gather_table_moves SET payload = $1 WHERE kingdom_id = $2', ['{}', id])).rejects.toThrow();
    await expect(pool.query('DELETE FROM gather_table_moves WHERE kingdom_id = $1', [id])).rejects.toThrow();
    expect((await pool.query('SELECT 1 AS alive')).rows).toEqual([{ alive: 1 }]);
  });
});
