import { expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import type { RealmChannelSender } from '../room-channels';
import { createPostgresItemStore } from '../items/postgres';
import { createPostgresFishingAdmission } from './entry';

const kingdomId = KingdomIdSchema.parse('200'), personId = PersonIdSchema.parse('100');
function setup() {
  let present = true, held: string | null = null, approved: string | null = 'Juniper', session = true;
  let afterLock = () => {};
  const statements: string[] = [];
  const client = { query: vi.fn(async (sql: string) => {
    statements.push(sql);
    if (sql.includes('FOR SHARE OF p')) { afterLock(); return { rows: [{ public_name: approved }], rowCount: 1 }; }
    if (sql.includes('FOR SHARE OF s')) return { rows: [{ session_id: '123e4567-e89b-42d3-a456-426614174001' }], rowCount: 1 };
    if (sql.includes('FOR SHARE OF e')) return { rows: [{ entry_id: '123e4567-e89b-42d3-a456-426614174000' }], rowCount: 1 };
    if (sql.includes('greatest(now()')) return { rows: session ? [{}] : [], rowCount: session ? 1 : 0 };
    return { rows: [], rowCount: 0 };
  }), release: vi.fn() } as unknown as PoolClient;
  const pool = { connect: vi.fn(async () => client), query: vi.fn(() => { throw new Error('Nested checkout is forbidden'); }) } as unknown as Pool;
  const store = createPostgresItemStore({ pool });
  const from: RealmChannelSender = { principal: { personId, kingdomId, origin: 'simulated', sessionId: '123e4567-e89b-42d3-a456-426614174000',
    expiresAt: Date.now() + 60_000, publicName: 'Stale socket name', look: 'neutral' }, walkerId: 'walker',
    present: () => present, current: vi.fn(async () => { throw new Error('Do not check out the pool through sender.current'); }), pose: () => null };
  const admit = createPostgresFishingAdmission({ pool, origin: 'simulated', readiness: { held: () => held } });
  return { pool, store, from, statements, admit, approved: (name: string | null) => { approved = name; },
    session: (value: boolean) => { session = value; }, present: (value: boolean) => { present = value; },
    held: (value: string | null) => { held = value; }, afterLock: (callback: () => void) => { afterLock = callback; } };
}

it('locks session identity before applying the actual authenticator on the same connection', async () => {
  const s = setup();
  expect(await s.store.transaction(kingdomId, tx => s.admit(s.from, tx))).toEqual({ name: 'Juniper' });
  const lock = s.statements.findIndex(sql => sql.includes('FOR SHARE'));
  const policy = s.statements.findIndex(sql => sql.includes('greatest(now()'));
  expect(lock).toBeGreaterThanOrEqual(0); expect(policy).toBeGreaterThan(lock);
  const locked = s.statements.filter(sql => sql.includes('FOR SHARE'));
  expect(locked).toHaveLength(3);
  expect(locked[0]).toContain('FOR SHARE OF p'); expect(locked[1]).toContain('FOR SHARE OF s'); expect(locked[2]).toContain('FOR SHARE OF e');
  expect(s.pool.query).not.toHaveBeenCalled(); expect(s.from.current).not.toHaveBeenCalled();
  s.approved(null);
  expect(await s.store.transaction(kingdomId, tx => s.admit(s.from, tx))).toEqual({ name: 'a citizen' });
  s.session(false);
  expect(await s.store.transaction(kingdomId, tx => s.admit(s.from, tx))).toBeNull();
});

it('refuses a held, absent, wrong-origin or mistargeted seat before querying private identity', async () => {
  const s = setup();
  const run = (from = s.from) => s.store.transaction(kingdomId, tx => s.admit(from, tx));
  s.held('unavailable'); expect(await run()).toBeNull();
  s.held(null); s.present(false); expect(await run()).toBeNull(); s.present(true);
  expect(await run({ ...s.from, principal: { ...s.from.principal, origin: 'live' } })).toBeNull();
  expect(await run({ ...s.from, principal: { ...s.from.principal, kingdomId: KingdomIdSchema.parse('201') } })).toBeNull();
  expect(await run({ ...s.from, principal: { ...s.from.principal, sessionId: 'forged' } })).toBeNull();
  expect(s.statements.some(sql => sql.includes('realm_entries'))).toBe(false);
});

it('rechecks the actual held method and seat after waiting for identity locks', async () => {
  for (const loss of ['held', 'seat'] as const) {
    const s = setup(); s.afterLock(() => loss === 'held' ? s.held('unavailable') : s.present(false));
    expect(await s.store.transaction(kingdomId, tx => s.admit(s.from, tx))).toBeNull();
    expect(s.statements.some(sql => sql.includes('greatest(now()'))).toBe(false);
  }
});
