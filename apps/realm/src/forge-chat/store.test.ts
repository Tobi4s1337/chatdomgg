import { describe, expect, it, vi } from 'vitest';
import type { RealmDatabase } from '../persistence/database';
import type { ForgeChatObservation, ForgeChatWish } from '@chatdom/shared';
import { FORGE_CHAT_MIGRATION, ForgeChatCipher, ForgeChatRequestConflict, ForgeChatRequestExpired, PostgresForgeChatStore, installForgeChatSchema } from './store';

const key = new Uint8Array(32).fill(7);
const grant = { accessToken: 'SIMULATED-access-secret', refreshToken: 'SIMULATED-refresh-secret', expiresAt: 10_000, validatedAt: 100 };
const requestId = '11111111-1111-4111-8111-111111111111';
const kingdomId = '42' as ForgeChatWish['kingdomId'];
const sending = { requestId, kingdomId, updatedAt: 100, status: 'sending' as const };
const sent = { ...sending, status: 'sent' as const, messageId: 'message:one', receiptId: 'forge:exact' };

function database(handler: (sql: string, values: unknown[]) => unknown = () => ({ rows: [] })) {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => handler(sql, values));
  const release = vi.fn();
  const db = { query, connect: vi.fn(async () => ({ query, release })) } as unknown as RealmDatabase;
  return { db, query, release };
}

describe('Forge chat encrypted persistence', () => {
  it('authenticates ciphertext to the exact person, origin, key and bytes without leaking token text in errors', () => {
    const cipher = new ForgeChatCipher(key, 'SIMULATED-client'), encrypted = cipher.encrypt('live', '42', grant);
    expect(encrypted).not.toContain(grant.accessToken);
    expect(encrypted).not.toContain(grant.refreshToken);
    expect(cipher.decrypt('live', '42', encrypted)).toEqual(grant);
    expect(cipher.encrypt('live', '42', grant)).not.toBe(encrypted);
    for (const attempt of [() => cipher.decrypt('live', '43', encrypted), () => cipher.decrypt('simulated', '42', encrypted),
      () => new ForgeChatCipher(new Uint8Array(32).fill(9), 'SIMULATED-client').decrypt('live', '42', encrypted),
      () => new ForgeChatCipher(key, 'SIMULATED-other-client').decrypt('live', '42', encrypted),
      () => cipher.decrypt('live', '42', `${encrypted.slice(0, -5)}AAAAA`)]) {
      expect(attempt).toThrow('The Forge chat grant cannot be decrypted.');
    }
    expect(() => new ForgeChatCipher(new Uint8Array(8), 'SIMULATED-client')).toThrow('32-byte');
  });

  it('serializes refresh and revoke even when the grant row is absent, and saves rotated tokens in the same transaction', async () => {
    const { db, query, release } = database();
    const store = new PostgresForgeChatStore(db, 'live', new ForgeChatCipher(key, 'SIMULATED-client'));
    await store.withGrantLock('42', async (current, save) => { expect(current).toBeNull(); await save(grant); });
    const calls = query.mock.calls;
    expect(calls[0]?.[0]).toBe('begin');
    expect(calls[1]?.[0]).toContain('pg_advisory_xact_lock');
    expect(calls[2]?.[0]).toContain('for update');
    expect(calls[3]?.[0]).toContain('on conflict');
    expect(calls[3]?.[1]?.[4]).not.toContain(grant.accessToken);
    expect(calls[3]?.[1]?.slice(0, 4)).toEqual(['live', '42', 'SIMULATED-client', 1]);
    expect(calls.at(-1)?.[0]).toBe('commit');
    expect(release).toHaveBeenCalledOnce();
  });

  it('binds encrypted tokens to the durable generation and keeps revocation tombstones', async () => {
    const cipher = new ForgeChatCipher(key, 'SIMULATED-client');
    const ciphertext = cipher.encrypt('live', '42', grant, 8);
    expect(() => cipher.decrypt('live', '42', ciphertext, 7)).toThrow('cannot be decrypted');
    const { db, query } = database(sql => ({ rows: sql.startsWith('select ciphertext,generation') ? [{ ciphertext, generation: '8' }] : [] }));
    const store = new PostgresForgeChatStore(db, 'live', cipher);
    await store.withGrantLock('42', async (current, save) => { expect(current).toEqual(grant); await save(null); });
    const updated = query.mock.calls.find(([sql]) => sql.startsWith('insert into forge_chat_grants'));
    expect(updated?.[1]).toEqual(['live', '42', 'SIMULATED-client', 9, null]);
    expect(query.mock.calls.some(([sql]) => sql.startsWith('delete from forge_chat_states'))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.startsWith('delete from forge_chat_grants'))).toBe(false);
  });

  it('durably revokes corrupt encrypted grants without requiring their plaintext', async () => {
    const { db, query } = database(sql => ({ rows: sql.startsWith('select ciphertext,generation') ? [{ ciphertext: 'SIMULATED-damaged-ciphertext', generation: '8' }] : [] }));
    const store = new PostgresForgeChatStore(db, 'live', new ForgeChatCipher(key, 'SIMULATED-client'));
    expect(await store.revokeGrant('42')).toBeNull();
    const tombstone = query.mock.calls.find(([sql]) => sql.startsWith('insert into forge_chat_grants'));
    expect(tombstone?.[1]).toEqual(['live', '42', 'SIMULATED-client', '9']);
    expect(tombstone?.[0]).toContain('set ciphertext=null,generation=excluded.generation');
    expect(query.mock.calls.find(([sql]) => sql.startsWith('delete from forge_chat_states'))?.[1]).toEqual(['live', '42', 'SIMULATED-client']);
    expect(query.mock.calls.at(-1)?.[0]).toBe('commit');
    expect(JSON.stringify(query.mock.calls)).not.toContain('SIMULATED-damaged-ciphertext');
  });

  it('preserves pending authorization generation on validation updates and skips identical saves', async () => {
    const cipher = new ForgeChatCipher(key, 'SIMULATED-client');
    const ciphertext = cipher.encrypt('live', '42', grant, 8);
    const { db, query } = database(sql => ({ rows: sql.startsWith('select ciphertext,generation') ? [{ ciphertext, generation: '8' }] : [] }));
    const store = new PostgresForgeChatStore(db, 'live', cipher);
    await store.withGrantLock('42', async (_current, save) => {
      await save(grant);
      await save({ ...grant, validatedAt: 101 });
      await save({ ...grant, validatedAt: 101 });
    });
    const writes = query.mock.calls.filter(([sql]) => sql.startsWith('insert into forge_chat_grants'));
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[1]?.[3]).toBe(8);
    expect(query.mock.calls.some(([sql]) => sql.startsWith('delete from forge_chat_states'))).toBe(false);
  });

  it('consumes callback state through the locked connection without taking another pool client', async () => {
    const { db, query } = database(sql => ({ rows: sql.startsWith('delete from forge_chat_states state') ? [{ kingdom_id: kingdomId, expected_scopes: ['user:write:chat'] }] : [] }));
    const store = new PostgresForgeChatStore(db, 'live', new ForgeChatCipher(key, 'SIMULATED-client'));
    await store.withGrantLock('42', async (_grant, _save, context) => {
      expect(await context!.takeState('a'.repeat(64), 'session-one', 100)).toEqual({ kingdomId, scopes: ['user:write:chat'] });
    });
    expect(db.connect).toHaveBeenCalledOnce();
    expect(query.mock.calls.find(([sql]) => sql.startsWith('delete from forge_chat_states state'))?.[0]).toContain('grant_row.generation=state.grant_generation');
  });

  it('rechecks the exact session on the locked connection immediately before an outbound action', async () => {
    const { db, query } = database(sql => ({ rows: sql.startsWith('select 1 from realm_sessions') ? [{ exists: 1 }] : [] }));
    const store = new PostgresForgeChatStore(db, 'live', new ForgeChatCipher(key, 'SIMULATED-client'));
    const sessionId = '22222222-2222-4222-8222-222222222222';
    await store.withGrantLock('42', async (_grant, _save, context) => { expect(await context!.sessionCurrent!(sessionId)).toBe(true); });
    expect(db.connect).toHaveBeenCalledOnce();
    const lookup = query.mock.calls.find(([sql]) => sql.startsWith('select 1 from realm_sessions'));
    expect(lookup?.[1]).toEqual([sessionId, '42', 'live']);
    expect(lookup?.[0]).toContain('revoked_at is null');
    expect(lookup?.[0]).toContain('expires_at>clock_timestamp()');
  });

  it('keeps private request metadata readable while cryptographic grant use is disabled', async () => {
    const { db } = database(sql => ({ rows: sql.startsWith('select projection') ? [{ projection: sent, kingdom_id: kingdomId }] : [] }));
    const store = new PostgresForgeChatStore(db, 'live', null);
    expect(await store.getWish('42', kingdomId, requestId)).toEqual(sent);
    await expect(store.withGrantLock('42', async () => null)).rejects.toThrow('encryption key is unavailable');
  });

  it('rolls back rotated grant bytes when the callback fails', async () => {
    const { db, query } = database();
    const store = new PostgresForgeChatStore(db, 'live', new ForgeChatCipher(key, 'SIMULATED-client'));
    await expect(store.withGrantLock('42', async (_current, save) => { await save(grant); throw new Error('SIMULATED interrupted refresh'); })).rejects.toThrow('SIMULATED interrupted');
    expect(query.mock.calls.at(-1)?.[0]).toBe('rollback');
    expect(query.mock.calls.some(([sql]) => sql === 'commit')).toBe(false);
  });

  it('consumes OAuth state with exact session, person, origin and expiry in one statement', async () => {
    const { db, query } = database(() => ({ rows: [{ kingdom_id: kingdomId, expected_scopes: ['user:write:chat'] }] }));
    const store = new PostgresForgeChatStore(db, 'live', new ForgeChatCipher(key, 'SIMULATED-client'));
    expect(await store.takeState('a'.repeat(64), 'session-one', '42', 123)).toEqual({ kingdomId, scopes: ['user:write:chat'] });
    expect(query.mock.calls[0]?.[0]).toContain('delete from forge_chat_states');
    expect(query.mock.calls[0]?.[0]).toContain('expires_ms>$5');
    expect(query.mock.calls[0]?.[1]).toEqual(['live', 'a'.repeat(64), 'session-one', '42', 123, 'SIMULATED-client']);
  });

  it('returns the durable claim on repeats and rejects a changed kingdom without persisting words', async () => {
    const { db, query } = database(sql => ({ rows: sql.startsWith('select projection') ? [{ projection: sending, kingdom_id: kingdomId, body_digest: 'a'.repeat(64) }] : [] }));
    const store = new PostgresForgeChatStore(db, 'live', new ForgeChatCipher(key, 'SIMULATED-client'), () => 120);
    expect(await store.claimWish('42', sending, 'a'.repeat(64), 'session-one')).toEqual({ created: false, wish: sending });
    await expect(store.claimWish('42', { ...sending, kingdomId: '43' as typeof kingdomId }, 'a'.repeat(64), 'session-one')).rejects.toBeInstanceOf(ForgeChatRequestConflict);
    expect(query.mock.calls.some(([sql]) => sql.startsWith('insert into forge_chat_requests'))).toBe(false);
    await expect(store.claimWish('42', { ...sending, words: 'SIMULATED private wish' } as unknown as ForgeChatWish, 'a'.repeat(64), 'session-one')).rejects.toThrow();
    expect(JSON.stringify(query.mock.calls)).not.toContain('SIMULATED private wish');
  });

  it('rejects changed words and keeps an irreversible tombstone after receipt pruning', async () => {
    const conflict = database(sql => ({ rows: sql.startsWith('select projection') ? [{ projection: sending, kingdom_id: kingdomId, body_digest: 'b'.repeat(64) }] : [] }));
    await expect(new PostgresForgeChatStore(conflict.db, 'live', new ForgeChatCipher(key, 'SIMULATED-client'))
      .claimWish('42', sending, 'a'.repeat(64), 'session-one')).rejects.toBeInstanceOf(ForgeChatRequestConflict);
    const tombstone = database(sql => ({ rows: sql.startsWith('select projection') ? [{ projection: null, kingdom_id: kingdomId, body_digest: 'a'.repeat(64) }] : [] }));
    const store = new PostgresForgeChatStore(tombstone.db, 'live', new ForgeChatCipher(key, 'SIMULATED-client'));
    await expect(store.claimWish('42', sending, 'a'.repeat(64), 'session-one')).rejects.toBeInstanceOf(ForgeChatRequestExpired);
    await expect(store.getWish('42', kingdomId, requestId)).rejects.toBeInstanceOf(ForgeChatRequestExpired);
    await store.cleanup(90_000_000);
    expect(tombstone.query.mock.calls.some(([sql]) => sql.startsWith('delete from forge_chat_requests'))).toBe(false);
    expect(tombstone.query.mock.calls.some(([sql]) => sql.startsWith('update forge_chat_requests set projection=null'))).toBe(true);
  });

  it('prevents overlapping new send IDs for the same owner and kingdom while allowing completed sends', async () => {
    const { db, query } = database(sql => ({ rows: sql.startsWith('select 1 from forge_chat_requests') ? [{ exists: 1 }] : [] }));
    const store = new PostgresForgeChatStore(db, 'live', new ForgeChatCipher(key, 'SIMULATED-client'), () => 120);
    await expect(store.claimWish('42', sending, 'a'.repeat(64), 'session-one')).rejects.toBeInstanceOf(ForgeChatRequestConflict);
    const active = query.mock.calls.find(([sql]) => sql.startsWith('select 1 from forge_chat_requests'));
    expect(active?.[0]).toContain("projection->>'status'='sending'");
    expect(active?.[1]).toEqual(['live', '42', kingdomId, -29_880]);
    expect(query.mock.calls.some(([sql]) => sql.startsWith('insert into forge_chat_requests'))).toBe(false);
  });

  it('projects an interrupted send as unknown while preserving the durable reservation', async () => {
    const { db, query } = database(() => ({ rows: [{ projection: sending, kingdom_id: kingdomId, body_digest: 'a'.repeat(64) }] }));
    const store = new PostgresForgeChatStore(db, 'live', new ForgeChatCipher(key, 'SIMULATED-client'), () => 31_000);
    expect(await store.getWish('42', kingdomId, requestId)).toMatchObject({ status: 'unknown', requestId });
    expect(query.mock.calls).toHaveLength(1);
    expect(query.mock.calls[0]?.[1]).toEqual(['live', '42', kingdomId, requestId]);
  });

  it('consumes an exact early observation when the send binds and never overwrites a terminal result', async () => {
    const early = { origin: 'live', personId: '42', kingdomId, messageId: sent.messageId, at: 150,
      status: 'delivered', attachmentId: 'attachment:one', committedAt: 149 } as ForgeChatObservation;
    const { db, query } = database(sql => {
      if (sql.startsWith('select projection')) return { rows: [{ projection: sending, kingdom_id: kingdomId, body_digest: 'a'.repeat(64) }] };
      if (sql.startsWith('delete from forge_chat_observations')) return { rows: [{ observation: early }] };
      return { rows: [] };
    });
    const store = new PostgresForgeChatStore(db, 'live', new ForgeChatCipher(key, 'SIMULATED-client'));
    expect(await store.bindSent('42', sent, 160)).toMatchObject({ status: 'delivered', attachmentId: 'attachment:one' });
    const consumed = query.mock.calls.find(([sql]) => sql.startsWith('delete from forge_chat_observations'));
    expect(consumed?.[1]).toEqual(['live', '42', kingdomId, sent.messageId, 160]);
    const stored = query.mock.calls.find(([sql]) => sql.startsWith('update forge_chat_requests'));
    expect(JSON.parse(stored?.[1]?.[4] as string)).toMatchObject({ status: 'delivered' });
    const terminal = { ...sent, status: 'held', message: 'The Watch is considering this wish.' };
    const other = database(sql => ({ rows: sql.startsWith('select projection') ? [{ projection: terminal, kingdom_id: kingdomId, body_digest: 'a'.repeat(64) }] : [] }));
    await new PostgresForgeChatStore(other.db, 'live', new ForgeChatCipher(key, 'SIMULATED-client')).observe({ ...early, status: 'working' }, 170);
    const updated = other.query.mock.calls.find(([sql]) => sql.startsWith('update forge_chat_requests'));
    expect(JSON.parse(updated?.[1]?.[4] as string)).toEqual(terminal);
  });

  it('bounds the race buffer, ignores another origin and strips extra observation fields', async () => {
    const { db, query } = database(sql => ({ rows: sql.startsWith('select 1 from forge_chat_requests') ? [{ exists: 1 }] : [] }));
    const store = new PostgresForgeChatStore(db, 'live', new ForgeChatCipher(key, 'SIMULATED-client'));
    const observation = { origin: 'live', personId: '42', kingdomId, messageId: 'message:early', at: 150,
      status: 'working', words: 'SIMULATED secret words' } as unknown as ForgeChatObservation;
    await store.observe(observation, 200);
    const inserted = query.mock.calls.find(([sql]) => sql.startsWith('insert into forge_chat_observations'));
    expect(inserted?.[1]?.slice(0, 5)).toEqual(['live', '42', kingdomId, 'message:early', 600_200]);
    expect(inserted?.[1]?.[5]).not.toContain('words');
    expect(query.mock.calls.find(([sql]) => sql.includes('offset $4'))?.[1]).toEqual(['live', '42', kingdomId, 32]);
    query.mockClear();
    await store.observe({ ...observation, origin: 'simulated' }, 200);
    expect(query).not.toHaveBeenCalled();
  });

  it('installs only its own additive migration and refuses checksum drift', async () => {
    const { db, query } = database();
    await installForgeChatSchema(db);
    expect(query.mock.calls.some(([sql]) => sql.includes('create table if not exists forge_chat_schema_migrations'))).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql === FORGE_CHAT_MIGRATION.sql)).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.includes('realm_schema_migrations'))).toBe(false);
    const stale = database(sql => ({ rows: sql.startsWith('select id,checksum') ? [{ id: FORGE_CHAT_MIGRATION.id, checksum: 'wrong' }] : [] }));
    await expect(installForgeChatSchema(stale.db)).rejects.toThrow('changed after');
    expect(stale.query.mock.calls.at(-1)?.[0]).toBe('rollback');
  });
});
