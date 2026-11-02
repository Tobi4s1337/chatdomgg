import { expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { KingdomIdSchema } from '@chatdom/shared';
import { createPostgresItemStore, postgresItemClient, postgresItemCommitGuard } from './postgres';

const kingdom = KingdomIdSchema.parse('200');
function fixture() {
  const queries: string[] = [];
  const client = { query: async (sql: string) => { queries.push(sql); return { rows: [], rowCount: 0 }; }, release: vi.fn() } as unknown as PoolClient;
  return { queries, store: createPostgresItemStore({ pool: { connect: async () => client, query: vi.fn() } }), client };
}

it('closes transaction and escaped query capabilities before a local commit guard runs', async () => {
  const f = fixture(), guard = vi.fn();
  await f.store.transaction(kingdom, async tx => {
    const escaped = postgresItemClient(tx).query;
    postgresItemCommitGuard(tx, () => {
      guard();
      expect(() => escaped('SELECT 2')).toThrow('not active');
      expect(() => postgresItemClient(tx)).toThrow('not active');
      expect(() => tx.afterCommit(() => {})).toThrow('not active');
      expect(() => postgresItemCommitGuard(tx, () => true)).toThrow('not active');
      return true;
    });
  });
  expect(guard).toHaveBeenCalledOnce(); expect(f.queries.at(-1)).toBe('COMMIT');
  expect(f.queries).not.toContain('SELECT 2');
});

it('rolls back without notifications when authority ends after the work callback completes', async () => {
  const f = fixture(), notified = vi.fn();
  let current = true;
  await expect(f.store.transaction(kingdom, async tx => {
    postgresItemCommitGuard(tx, () => current);
    tx.afterCommit(notified);
    queueMicrotask(() => { current = false; });
  })).rejects.toThrow('guard refused');
  expect(f.queries.at(-1)).toBe('ROLLBACK'); expect(f.queries).not.toContain('COMMIT');
  expect(notified).not.toHaveBeenCalled();
});

it('bounds registered guards and propagates a guard failure as a rollback', async () => {
  const f = fixture();
  await expect(f.store.transaction(kingdom, async tx => {
    for (let i = 0; i < 16; i++) postgresItemCommitGuard(tx, () => true);
    postgresItemCommitGuard(tx, () => true);
  })).rejects.toThrow('Too many');
  expect(f.queries.at(-1)).toBe('ROLLBACK');
  await expect(f.store.transaction(kingdom, async tx => {
    postgresItemCommitGuard(tx, () => { throw new Error('authority ended'); });
  })).rejects.toThrow('authority ended');
  expect(f.queries).not.toContain('COMMIT');
});
