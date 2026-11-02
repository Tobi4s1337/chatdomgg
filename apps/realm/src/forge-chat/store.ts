import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { FORGE_CHAT_LIMITS, ForgeChatWishSchema, type ForgeChatObservation, type ForgeChatWish } from '@chatdom/shared';
import type { RealmDatabase } from '../persistence/database';
import migrationSql from './0014-forge-chat.sql?raw';

export const FORGE_CHAT_MIGRATION = {
  id: '0014-forge-chat', sql: migrationSql, checksum: createHash('sha256').update(migrationSql).digest('hex'),
} as const;
/** Own additive migration ledger: the existing realm registry remains unchanged. */
export async function installForgeChatSchema(db: Pick<RealmDatabase, 'connect'>): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query("select pg_advisory_xact_lock(hashtext('chatdom.forge.chat.migrate'))");
    await client.query(`create table if not exists forge_chat_schema_migrations (
      id text primary key, checksum text not null check (checksum ~ '^[a-f0-9]{64}$'), applied_at timestamptz not null default now())`);
    const applied = await client.query<{ id: string; checksum: string }>('select id,checksum from forge_chat_schema_migrations');
    if (applied.rows.some(row => row.id !== FORGE_CHAT_MIGRATION.id)) throw new Error('The Forge chat schema belongs to a newer build.');
    const previous = applied.rows.find(row => row.id === FORGE_CHAT_MIGRATION.id);
    if (previous && previous.checksum !== FORGE_CHAT_MIGRATION.checksum) throw new Error('The Forge chat migration changed after it was applied.');
    if (!previous) {
      await client.query(FORGE_CHAT_MIGRATION.sql);
      await client.query('insert into forge_chat_schema_migrations (id,checksum) values ($1,$2)', [FORGE_CHAT_MIGRATION.id, FORGE_CHAT_MIGRATION.checksum]);
    }
    await client.query('commit');
  } catch (error) { await client.query('rollback').catch(() => {}); throw error; }
  finally { client.release(); }
}

export interface ChatGrant {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly validatedAt: number;
}
export interface ChatOAuthState {
  readonly hash: string;
  readonly sessionId: string;
  readonly personId: string;
  readonly kingdomId: string;
  readonly expiresAt: number;
  readonly scopes: readonly string[];
}
export interface ChatGrantContext {
  sessionCurrent?(sessionId: string): Promise<boolean>;
  takeState(hash: string, sessionId: string, now: number): Promise<{ kingdomId: string; scopes: readonly string[] } | null>;
}
export interface ForgeChatStore {
  revokeGrant?(personId: string): Promise<ChatGrant | null>;
  withGrantLock<T>(personId: string, action: (grant: ChatGrant | null, save: (grant: ChatGrant | null) => Promise<void>, context?: ChatGrantContext) => Promise<T>): Promise<T>;
  listGrantPeople(): Promise<string[]>;
  putState(state: ChatOAuthState): Promise<void>;
  takeState(hash: string, sessionId: string, personId: string, now: number): Promise<{ kingdomId: string; scopes: readonly string[] } | null>;
  claimWish(personId: string, wish: ForgeChatWish, digest: string, sessionId: string): Promise<{ created: boolean; wish: ForgeChatWish }>;
  getWish(personId: string, kingdomId: string, requestId?: string): Promise<ForgeChatWish | null>;
  setWish(personId: string, wish: ForgeChatWish): Promise<void>;
  bindSent(personId: string, wish: Extract<ForgeChatWish, { status: 'sent' }>, now: number): Promise<ForgeChatWish>;
  observe(observation: ForgeChatObservation, now: number): Promise<void>;
  cleanup(now: number): Promise<void>;
}
export class ForgeChatRequestExpired extends Error {
  constructor() { super('This wish receipt has expired. Check Twitch chat before making another wish.'); this.name = 'ForgeChatRequestExpired'; }
}
export class ForgeChatRequestConflict extends Error {
  constructor() { super('This request conflicts with another wish. Wait for the current send before trying again.'); this.name = 'ForgeChatRequestConflict'; }
}

/** AES-GCM authenticates both the encrypted bytes and their exact realm origin/person owner. */
export class ForgeChatCipher {
  private readonly key: Buffer;
  constructor(key: Uint8Array, readonly clientId: string) {
    if (key.byteLength !== 32) throw new Error('Forge chat requires its own 32-byte encryption key.');
    this.key = Buffer.from(key);
  }
  encrypt(origin: string, personId: string, grant: ChatGrant, generation = 0): string {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify(['chatdom.forge.chat.v1', origin, personId, this.clientId, generation])));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(grant), 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
  }
  decrypt(origin: string, personId: string, value: string, generation = 0): ChatGrant {
    try {
      const parts = value.split('.');
      if (parts.length !== 4 || parts[0] !== 'v1') throw new Error();
      const iv = Buffer.from(parts[1]!, 'base64url'), tag = Buffer.from(parts[2]!, 'base64url');
      if (iv.length !== 12 || tag.length !== 16) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAAD(Buffer.from(JSON.stringify(['chatdom.forge.chat.v1', origin, personId, this.clientId, generation])));
      decipher.setAuthTag(tag);
      const grant: unknown = JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[3]!, 'base64url')), decipher.final()]).toString('utf8'));
      if (!grant || typeof grant !== 'object' || !('accessToken' in grant) || !('refreshToken' in grant)
        || !('expiresAt' in grant) || !('validatedAt' in grant) || typeof grant.accessToken !== 'string' || !grant.accessToken
        || typeof grant.refreshToken !== 'string' || !grant.refreshToken || typeof grant.expiresAt !== 'number'
        || !Number.isSafeInteger(grant.expiresAt) || typeof grant.validatedAt !== 'number' || !Number.isSafeInteger(grant.validatedAt)) throw new Error();
      return { accessToken: grant.accessToken, refreshToken: grant.refreshToken, expiresAt: grant.expiresAt, validatedAt: grant.validatedAt };
    } catch { throw new Error('The Forge chat grant cannot be decrypted.'); }
  }
}

const TERMINAL = new Set(['delivered', 'held', 'refused', 'cold', 'canceled', 'not-sent']);
const OBSERVATION_TTL_MS = FORGE_CHAT_LIMITS.stateTtlMs;
const OBSERVATIONS_PER_PERSON = 32;
type Query = Pick<PoolClient, 'query'>;
type WishRow = { projection: unknown; kingdom_id: string; body_digest?: string };
function parseWish(value: unknown): ForgeChatWish { return ForgeChatWishSchema.parse(value); }
function interrupted(wish: ForgeChatWish, now: number): ForgeChatWish {
  return wish.status === 'sending' && wish.updatedAt + 30_000 <= now
    ? { requestId: wish.requestId, kingdomId: wish.kingdomId, updatedAt: now, status: 'unknown',
      message: 'Twitch has not confirmed this wish. Check chat before sending another.' } : wish;
}
function outcome(wish: ForgeChatWish, observation: ForgeChatObservation): ForgeChatWish {
  if (!('messageId' in wish) || wish.status === 'delivered'
    || (TERMINAL.has(wish.status) && observation.status !== 'delivered')) return wish;
  const base = { requestId: wish.requestId, kingdomId: wish.kingdomId, messageId: wish.messageId,
    receiptId: wish.receiptId, updatedAt: Math.max(wish.updatedAt, observation.at) };
  if (observation.status === 'working') return { ...base, status: 'working' };
  if (observation.status === 'delivered') return parseWish({ ...base, status: 'delivered', attachmentId: observation.attachmentId,
    committedAt: observation.committedAt, ...(observation.message ? { message: observation.message } : {}) });
  return parseWish({ ...base, status: observation.status, message: observation.message });
}
/** Explicit field projection strips runtime extras, including accidental words/provider payloads. */
function safeObservation(value: ForgeChatObservation): ForgeChatObservation {
  const base = { origin: value.origin, personId: value.personId, kingdomId: value.kingdomId, messageId: value.messageId, at: value.at };
  if (value.status === 'working') return { ...base, status: 'working' };
  if (value.status === 'delivered') return { ...base, status: 'delivered', attachmentId: value.attachmentId,
    committedAt: value.committedAt, ...(value.message ? { message: value.message } : {}) };
  return { ...base, status: value.status, message: value.message };
}

export class PostgresForgeChatStore implements ForgeChatStore {
  constructor(private readonly db: RealmDatabase, private readonly origin: 'live' | 'simulated', private readonly cipher: ForgeChatCipher | null,
    private readonly now: () => number = Date.now) {}
  private async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try { await client.query('begin'); const result = await action(client); await client.query('commit'); return result; }
    catch (error) { await client.query('rollback').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  private async lock(client: Query, key: readonly string[]): Promise<void> {
    // The transaction lock covers absent rows too, so revoke, callback and refresh cannot race resurrection.
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify(['forge-chat', this.origin, ...key])]);
  }
  async withGrantLock<T>(personId: string, action: (grant: ChatGrant | null, save: (grant: ChatGrant | null) => Promise<void>, context?: ChatGrantContext) => Promise<T>): Promise<T> {
    const cipher = this.cipher;
    if (!cipher) throw new Error('The Forge chat encryption key is unavailable.');
    return this.transaction(async client => {
      await this.lock(client, ['grant', personId, cipher.clientId]);
      const row = await client.query<{ ciphertext: string | null; generation: string | number }>(
        'select ciphertext,generation from forge_chat_grants where origin=$1 and person_id=$2 and client_id=$3 for update', [this.origin, personId, cipher.clientId]);
      let generation = Number(row.rows[0]?.generation ?? 0);
      if (!Number.isSafeInteger(generation) || generation < 0) throw new Error('The Forge chat grant generation is unavailable.');
      const grant = row.rows[0]?.ciphertext ? cipher.decrypt(this.origin, personId, row.rows[0].ciphertext, generation) : null;
      let currentGrant = grant;
      return action(grant, async next => {
        if (next && currentGrant && next.accessToken === currentGrant.accessToken && next.refreshToken === currentGrant.refreshToken
          && next.expiresAt === currentGrant.expiresAt && next.validatedAt === currentGrant.validatedAt) return;
        if (!next || !currentGrant || next.accessToken !== currentGrant.accessToken || next.refreshToken !== currentGrant.refreshToken) generation += 1;
        await client.query(`insert into forge_chat_grants (origin,person_id,client_id,generation,ciphertext) values ($1,$2,$3,$4,$5)
          on conflict (origin,person_id,client_id) do update set ciphertext=excluded.ciphertext,generation=excluded.generation`,
          [this.origin, personId, cipher.clientId, generation, next ? cipher.encrypt(this.origin, personId, next, generation) : null]);
        currentGrant = next;
        if (!next) await client.query('delete from forge_chat_states where origin=$1 and person_id=$2 and client_id=$3', [this.origin, personId, cipher.clientId]);
      }, {
        takeState: (hash, sessionId, now) => this.consumeState(client, hash, sessionId, personId, now),
        sessionCurrent: async sessionId => {
          const session = await client.query(`select 1 from realm_sessions where session_id=$1::uuid and person_id=$2 and origin=$3
            and revoked_at is null and expires_at>clock_timestamp()`, [sessionId, personId, this.origin]);
          return session.rows.length === 1;
        },
      });
    });
  }
  async revokeGrant(personId: string): Promise<ChatGrant | null> {
    const cipher = this.cipher;
    if (!cipher) throw new Error('The Forge chat encryption key is unavailable.');
    return this.transaction(async client => {
      await this.lock(client, ['grant', personId, cipher.clientId]);
      const row = await client.query<{ ciphertext: string | null; generation: string | number }>(
        'select ciphertext,generation from forge_chat_grants where origin=$1 and person_id=$2 and client_id=$3 for update', [this.origin, personId, cipher.clientId]);
      let recovered: ChatGrant | null = null;
      if (row.rows[0]?.ciphertext) {
        try { recovered = cipher.decrypt(this.origin, personId, row.rows[0].ciphertext, Number(row.rows[0].generation)); }
        catch { /* Local revocation remains possible after encryption key rotation or damaged bytes. */ }
      }
      const generation = (BigInt(String(row.rows[0]?.generation ?? 0)) + 1n).toString();
      await client.query(`insert into forge_chat_grants (origin,person_id,client_id,generation,ciphertext) values ($1,$2,$3,$4,null)
        on conflict (origin,person_id,client_id) do update set ciphertext=null,generation=excluded.generation`,
        [this.origin, personId, cipher.clientId, generation]);
      await client.query('delete from forge_chat_states where origin=$1 and person_id=$2 and client_id=$3', [this.origin, personId, cipher.clientId]);
      return recovered;
    });
  }
  async listGrantPeople(): Promise<string[]> {
    if (!this.cipher) return [];
    return (await this.db.query<{ person_id: string }>('select person_id from forge_chat_grants where origin=$1 and client_id=$2 and ciphertext is not null',
      [this.origin, this.cipher.clientId])).rows.map(row => row.person_id);
  }
  async putState(state: ChatOAuthState): Promise<void> {
    const cipher = this.cipher;
    if (!cipher) throw new Error('The Forge chat encryption key is unavailable.');
    await this.transaction(async client => {
      await this.lock(client, ['grant', state.personId, cipher.clientId]);
      await client.query(`insert into forge_chat_grants (origin,person_id,client_id,generation,ciphertext) values ($1,$2,$3,0,null)
        on conflict (origin,person_id,client_id) do nothing`, [this.origin, state.personId, cipher.clientId]);
      const current = await client.query<{ generation: string | number }>('select generation from forge_chat_grants where origin=$1 and person_id=$2 and client_id=$3',
        [this.origin, state.personId, cipher.clientId]);
      const generation = Number(current.rows[0]?.generation);
      if (!Number.isSafeInteger(generation) || generation < 0) throw new Error('The Forge chat grant generation is unavailable.');
      await client.query('delete from forge_chat_states where origin=$1 and client_id=$2 and (expires_ms<=$3 or person_id=$4)', [this.origin, cipher.clientId, this.now(), state.personId]);
      await client.query('insert into forge_chat_states (origin,state_hash,session_id,person_id,kingdom_id,expires_ms,expected_scopes,client_id,grant_generation) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)',
        [this.origin, state.hash, state.sessionId, state.personId, state.kingdomId, state.expiresAt, JSON.stringify(state.scopes), cipher.clientId, generation]);
    });
  }
  private async consumeState(client: Query, hash: string, sessionId: string, personId: string, now: number): Promise<{ kingdomId: string; scopes: readonly string[] } | null> {
    if (!this.cipher) return null;
    const rows = await client.query<{ kingdom_id: string; expected_scopes: string[] }>(`delete from forge_chat_states state where state.origin=$1 and state.state_hash=$2
      and state.session_id=$3 and state.person_id=$4 and state.expires_ms>$5 and state.client_id=$6
      and exists (select 1 from forge_chat_grants grant_row where grant_row.origin=state.origin and grant_row.person_id=state.person_id
        and grant_row.client_id=state.client_id and grant_row.generation=state.grant_generation) returning state.kingdom_id,state.expected_scopes`,
      [this.origin, hash, sessionId, personId, now, this.cipher.clientId]);
    return rows.rows[0] ? { kingdomId: rows.rows[0].kingdom_id, scopes: rows.rows[0].expected_scopes } : null;
  }
  async takeState(hash: string, sessionId: string, personId: string, now: number): Promise<{ kingdomId: string; scopes: readonly string[] } | null> {
    return this.consumeState(this.db, hash, sessionId, personId, now);
  }
  async claimWish(personId: string, raw: ForgeChatWish, digest: string, sessionId: string): Promise<{ created: boolean; wish: ForgeChatWish }> {
    const wish = parseWish(raw);
    return this.transaction(async client => {
      await this.lock(client, ['request', personId, wish.requestId]);
      const existing = await client.query<WishRow>('select projection,kingdom_id,body_digest from forge_chat_requests where origin=$1 and person_id=$2 and request_id=$3 for update', [this.origin, personId, wish.requestId]);
      if (existing.rows[0]) {
        if (existing.rows[0].kingdom_id !== wish.kingdomId || existing.rows[0].body_digest !== digest) throw new ForgeChatRequestConflict();
        if (existing.rows[0].projection === null) throw new ForgeChatRequestExpired();
        return { created: false, wish: interrupted(parseWish(existing.rows[0].projection), this.now()) };
      }
      await this.lock(client, ['sending', personId, wish.kingdomId]);
      const active = await client.query(`select 1 from forge_chat_requests where origin=$1 and person_id=$2 and kingdom_id=$3
        and projection->>'status'='sending' and updated_ms>$4 limit 1`, [this.origin, personId, wish.kingdomId, this.now() - 30_000]);
      if (active.rows.length) throw new ForgeChatRequestConflict();
      await client.query('insert into forge_chat_requests (origin,person_id,request_id,kingdom_id,created_ms,updated_ms,projection,body_digest,session_id) values ($1,$2,$3,$4,$5,$5,$6::jsonb,$7,$8)',
        [this.origin, personId, wish.requestId, wish.kingdomId, wish.updatedAt, JSON.stringify(wish), digest, sessionId]);
      return { created: true, wish };
    });
  }
  async getWish(personId: string, kingdomId: string, requestId?: string): Promise<ForgeChatWish | null> {
    const rows = requestId
      ? await this.db.query<WishRow>('select projection,kingdom_id from forge_chat_requests where origin=$1 and person_id=$2 and kingdom_id=$3 and request_id=$4', [this.origin, personId, kingdomId, requestId])
      : await this.db.query<WishRow>('select projection,kingdom_id from forge_chat_requests where origin=$1 and person_id=$2 and kingdom_id=$3 order by created_ms desc, request_id desc limit 1', [this.origin, personId, kingdomId]);
    if (rows.rows[0]?.projection === null) { if (requestId) throw new ForgeChatRequestExpired(); return null; }
    return rows.rows[0] ? interrupted(parseWish(rows.rows[0].projection), this.now()) : null;
  }
  private async writeWish(client: Query, personId: string, wish: ForgeChatWish): Promise<void> {
    await client.query('update forge_chat_requests set projection=$5::jsonb,updated_ms=$6,message_id=$7 where origin=$1 and person_id=$2 and request_id=$3 and kingdom_id=$4',
      [this.origin, personId, wish.requestId, wish.kingdomId, JSON.stringify(wish), wish.updatedAt, 'messageId' in wish ? wish.messageId : null]);
  }
  async setWish(personId: string, raw: ForgeChatWish): Promise<void> {
    const wish = parseWish(raw);
    await this.transaction(async client => {
      const row = await client.query<WishRow>('select projection,kingdom_id from forge_chat_requests where origin=$1 and person_id=$2 and request_id=$3 for update', [this.origin, personId, wish.requestId]);
      if (!row.rows[0]) throw new Error('The Forge chat request is not reserved.');
      if (row.rows[0].kingdom_id !== wish.kingdomId) throw new ForgeChatRequestConflict();
      if (row.rows[0].projection === null) throw new ForgeChatRequestExpired();
      const previous = parseWish(row.rows[0].projection);
      if (TERMINAL.has(previous.status) || 'messageId' in previous) return;
      await this.writeWish(client, personId, wish);
    });
  }
  async bindSent(personId: string, raw: Extract<ForgeChatWish, { status: 'sent' }>, now: number): Promise<ForgeChatWish> {
    const wish = parseWish(raw) as Extract<ForgeChatWish, { status: 'sent' }>;
    return this.transaction(async client => {
      await this.lock(client, ['message', personId, wish.kingdomId, wish.messageId]);
      const existing = await client.query<WishRow>('select projection,kingdom_id from forge_chat_requests where origin=$1 and person_id=$2 and request_id=$3 for update', [this.origin, personId, wish.requestId]);
      if (!existing.rows[0]) throw new Error('The Forge chat request is not reserved.');
      if (existing.rows[0].kingdom_id !== wish.kingdomId) throw new ForgeChatRequestConflict();
      if (existing.rows[0].projection === null) throw new ForgeChatRequestExpired();
      const previous = parseWish(existing.rows[0].projection);
      if ('messageId' in previous || TERMINAL.has(previous.status)) return previous;
      const pending = await client.query<{ observation: ForgeChatObservation }>('delete from forge_chat_observations where origin=$1 and person_id=$2 and kingdom_id=$3 and message_id=$4 and expires_ms>$5 returning observation',
        [this.origin, personId, wish.kingdomId, wish.messageId, now]);
      const bound = pending.rows[0] ? outcome(wish, pending.rows[0].observation) : wish;
      await this.writeWish(client, personId, bound);
      return bound;
    });
  }
  async observe(raw: ForgeChatObservation, now: number): Promise<void> {
    if (raw.origin !== this.origin) return;
    const observation = safeObservation(raw);
    await this.transaction(async client => {
      await this.lock(client, ['message', observation.personId, observation.kingdomId, observation.messageId]);
      const existing = await client.query<WishRow>('select projection,kingdom_id from forge_chat_requests where origin=$1 and person_id=$2 and kingdom_id=$3 and message_id=$4 for update',
        [this.origin, observation.personId, observation.kingdomId, observation.messageId]);
      if (existing.rows[0]) { if (existing.rows[0].projection !== null) await this.writeWish(client, observation.personId, outcome(parseWish(existing.rows[0].projection), observation)); return; }
      const pending = await client.query(`select 1 from forge_chat_requests where origin=$1 and person_id=$2 and kingdom_id=$3
        and projection->>'status' in ('sending','unknown') limit 1`, [this.origin, observation.personId, observation.kingdomId]);
      if (!pending.rows.length) return;
      await this.lock(client, ['observations', observation.personId, observation.kingdomId]);
      await client.query('delete from forge_chat_observations where origin=$1 and person_id=$2 and expires_ms<=$3', [this.origin, observation.personId, now]);
      await client.query(`insert into forge_chat_observations (origin,person_id,kingdom_id,message_id,expires_ms,observation) values ($1,$2,$3,$4,$5,$6::jsonb)
        on conflict (origin,person_id,kingdom_id,message_id) do update set observation=excluded.observation,expires_ms=excluded.expires_ms
        where forge_chat_observations.observation->>'status'='working'
          or (excluded.observation->>'status'='delivered' and forge_chat_observations.observation->>'status'<>'delivered')`,
        [this.origin, observation.personId, observation.kingdomId, observation.messageId, now + OBSERVATION_TTL_MS, JSON.stringify(observation)]);
      await client.query(`delete from forge_chat_observations where origin=$1 and person_id=$2 and kingdom_id=$3 and message_id in
        (select message_id from forge_chat_observations where origin=$1 and person_id=$2 and kingdom_id=$3 order by expires_ms desc,message_id offset $4)`,
        [this.origin, observation.personId, observation.kingdomId, OBSERVATIONS_PER_PERSON]);
    });
  }
  async cleanup(now: number): Promise<void> {
    await this.db.query('delete from forge_chat_states where origin=$1 and expires_ms<=$2', [this.origin, now]);
    await this.db.query('delete from forge_chat_observations where origin=$1 and expires_ms<=$2', [this.origin, now]);
    await this.db.query('update forge_chat_requests set projection=null where origin=$1 and created_ms<=$2 and projection is not null', [this.origin, now - FORGE_CHAT_LIMITS.requestRetentionMs]);
  }
}
