import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { createPostgresGatherStore, type GatherSnapshot, type GatherCommandRecord } from './store';

const snapshot: GatherSnapshot = { table: 'table1', version: 1, kind: 'stones', match: 'match1', players: [], state: {}, at: 1 };
const command: GatherCommandRecord = { id: 'move1', actor: 'player1', payload: '{}', at: 1 };
type Scenario = 'commit' | 'duplicate' | 'conflict' | 'append-error' | 'commit-error';

// This boundary fixture models pool reuse and injected driver failures; it is not a SQL database.
function fixture(scenario: Scenario, rollbackError: boolean | 'sync' = false) {
  const original = new Error('original write failure');
  const cleanup = new Error('rollback failure');
  const clients: { releases: (boolean | undefined)[] }[] = [];
  let available: ReturnType<typeof makeClient> | undefined;
  let currentScenario = scenario;
  function makeClient() {
    const state = { releases: [] as (boolean | undefined)[] };
    clients.push(state);
    const client = {
      state,
      query(sql: string) {
        if (sql === 'ROLLBACK' && rollbackError) {
          if (rollbackError === 'sync') throw cleanup;
          return Promise.reject(cleanup);
        }
        if (sql === 'COMMIT' && currentScenario === 'commit-error') return Promise.reject(original);
        if (sql.includes('INSERT INTO gather_table_moves') && currentScenario === 'append-error') return Promise.reject(original);
        if (sql.includes('FROM gather_table_moves')) return Promise.resolve({ rows: currentScenario === 'duplicate' ? [{ table_id: 'table1', expected_version: null, payload: '{}' }] : [], rowCount: 0 });
        if (sql.includes('INSERT INTO gather_table_checkpoints')) return Promise.resolve({ rows: [], rowCount: currentScenario === 'conflict' ? 0 : 1 });
        return Promise.resolve({ rows: [], rowCount: 1 });
      },
      release(discard?: boolean): void { state.releases.push(discard); if (!discard) available = client; },
    };
    return client;
  }
  const pool = { async connect() { const client = available ?? makeClient(); available = undefined; return client; } };
  return { store: createPostgresGatherStore(pool as unknown as Pool), clients, original, setScenario(value: Scenario) { currentScenario = value; } };
}

const commit = (store: ReturnType<typeof createPostgresGatherStore>) => store.commit('kingdom1', null, snapshot, command);

describe('Postgres gather connection cleanup', () => {
  it.each(['append-error', 'commit-error'] as const)('discards after %s and a failed cleanup, preserving the original error', async scenario => {
    const f = fixture(scenario, true);
    await expect(commit(f.store)).rejects.toBe(f.original);
    expect(f.clients[0]!.releases).toEqual([true]);
    f.setScenario('commit');
    await expect(commit(f.store)).resolves.toBe('committed');
    expect(f.clients).toHaveLength(2);
    expect(f.clients[1]!.releases).toHaveLength(1);
    expect(f.clients[1]!.releases[0]).toBeFalsy();
  });

  it.each(['append-error', 'commit-error'] as const)('also preserves %s when cleanup throws synchronously', async scenario => {
    const f = fixture(scenario, 'sync');
    await expect(commit(f.store)).rejects.toBe(f.original);
    expect(f.clients[0]!.releases).toEqual([true]);
  });

  it.each(['append-error', 'commit-error'] as const)('reuses the client after %s and successful rollback', async scenario => {
    const f = fixture(scenario);
    await expect(commit(f.store)).rejects.toBe(f.original);
    expect(f.clients[0]!.releases).toHaveLength(1);
    expect(f.clients[0]!.releases[0]).toBeFalsy();
    f.setScenario('commit');
    await expect(commit(f.store)).resolves.toBe('committed');
    expect(f.clients).toHaveLength(1);
    expect(f.clients[0]!.releases).toHaveLength(2);
  });

  it.each([['commit', 'committed'], ['duplicate', 'duplicate'], ['conflict', 'conflict']] as const)('%s releases a reusable client once', async (scenario, result) => {
    const f = fixture(scenario);
    await expect(commit(f.store)).resolves.toBe(result);
    expect(f.clients[0]!.releases).toHaveLength(1);
    expect(f.clients[0]!.releases[0]).toBeFalsy();
  });

  it('propagates a connection failure without a client to release', async () => {
    const error = new Error('pool unavailable');
    let releases = 0;
    const pool = { async connect() { throw error; }, release() { releases++; } };
    await expect(commit(createPostgresGatherStore(pool as unknown as Pool))).rejects.toBe(error);
    expect(releases).toBe(0);
  });
});
