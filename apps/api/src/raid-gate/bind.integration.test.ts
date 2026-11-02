import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KingdomIdSchema, type KingdomId } from '../../../../packages/shared/src/identity';
import { migrateRealmSchema } from '../../../realm/src/persistence/migrate';
import { RaidObservationLedger } from '../../../realm/src/raid-gate/observations';
import type { RealmAuthConfig } from '../realm-auth/config';
import { sha256 } from '../realm-auth/secrets';
import { SIMULATED_OIDC_PATH } from '../realm-auth/simulated-provider';
import { bindRaidGate, type RaidGateBinding } from './bind';
import { readGateReply, type GateReply } from './contracts';
import { RaidObservationSchema } from './observations';
import { RAID_AUTHORITY_ROUTE, RaidAuthorityRequestSchema, type RaidAuthorityOutcome } from './raid-authority-contracts';

/**
 * The Raid Gate as `apps/api/src/main.ts` binds it, on real Postgres in a random schema dropped afterwards. Herald is
 * a recording stand-in on a loopback port speaking the real private route; nothing reaches Twitch. The realm's
 * landing is committed by a separate ledger object on the same schema, as the realm process does.
 *   REALM_DATABASE_TESTS=1 node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run --no-fsModuleCache apps/api/src/raid-gate/bind.integration.test.ts
 */
const ORIGIN = 'http://localhost:5190';
const COOKIE = 'chatdom_session';
const SECRET = randomBytes(24).toString('hex');
const SOURCE = KingdomIdSchema.parse('990300101');
const TARGET = KingdomIdSchema.parse('990300201');

type Recorded = { op: string; key: string; outcome: RaidAuthorityOutcome };

/** Herald's private raid route with its own key ledger; `loseNext` records a write and drops the connection. */
async function recordingHerald() {
  const writes: Recorded[] = [];
  const ledger = new Map<string, RaidAuthorityOutcome>();
  let loseNext = false;
  let pending = false;
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(chunk as Buffer));
    request.on('end', () => {
      if (request.url !== RAID_AUTHORITY_ROUTE || request.headers.authorization !== `Bearer ${SECRET}`) { response.writeHead(401).end(); return; }
      const parsed = RaidAuthorityRequestSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (!parsed.success) { response.writeHead(400).end(); return; }
      const body = parsed.data;
      const reply = (value: unknown) => response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value));
      if (body.op === 'standing') return reply({ version: 1, origin: body.origin, kingdomId: body.kingdomId, grant: 'granted', consent: 'enabled' });
      if (body.op === 'live') return reply({ version: 1, origin: body.origin, live: Object.fromEntries(body.kingdomIds.map(id => [id, true])) });
      const { key } = body.write;
      let outcome = ledger.get(key);
      if (body.op !== 'reconcile' && !outcome) {
        outcome = body.op === 'start'
          ? (pending ? { kind: 'rejected', code: 'already-raiding' } : { kind: 'accepted', createdAt: Date.now() })
          : (pending ? { kind: 'accepted', createdAt: Date.now() } : { kind: 'rejected', code: 'nothing-pending' });
        if (outcome.kind === 'accepted') pending = body.op === 'start';
        ledger.set(key, outcome);
        writes.push({ op: body.op, key, outcome });
      }
      if (loseNext && body.op !== 'reconcile') { loseNext = false; response.destroy(); return; }
      reply({ version: 1, origin: body.origin, key, outcome: outcome ?? { kind: 'unknown' } });
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    writes, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    loseNextAnswer() { loseNext = true; },
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('Raid Gate bound as main binds it (Postgres, recording Herald)', () => {
  const schema = `realm_test_${randomBytes(6).toString('hex')}`;
  let admin: pg.Pool, pool: pg.Pool, herald: Awaited<ReturnType<typeof recordingHerald>>;
  const bindings: RaidGateBinding[] = [];
  let monarch = '';
  const config = { mode: 'simulated', publicOrigin: ORIGIN, secureCookies: false } as RealmAuthConfig;

  const bind = () => {
    const binding = bindRaidGate({ pool, config, issuer: `${ORIGIN}${SIMULATED_OIDC_PATH}`,
      env: { HERALD_RAID_GATE_URL: herald.url, HERALD_RAID_GATE_SECRET: SECRET, RAID_GATE_RECOVER_MS: '0' } });
    bindings.push(binding);
    return binding;
  };
  const send = (binding: RaidGateBinding) => async (command: unknown): Promise<GateReply> => {
    const response = await binding.service.http.handle(new Request(`${ORIGIN}/api/raid-gate/${SOURCE}`, {
      method: 'POST', body: JSON.stringify(command),
      headers: { cookie: `${COOKIE}=${monarch}`, 'content-type': 'application/json', origin: ORIGIN },
    }));
    const reply = readGateReply(await response.json());
    if (!reply) throw new Error(`The gate sent a reply its own reader refuses (${response.status}).`);
    return reply;
  };
  async function found(kingdomId: KingdomId): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query("insert into realm_kingdoms (kingdom_id, origin, created_ms) values ($1, 'simulated', $2)", [kingdomId, Date.now()]);
      await client.query(`insert into realm_layout_heads (kingdom_id, origin, revision, seed, first_year, adopted_ms, founded_ms)
        values ($1, 'simulated', 'SIMULATED-r1', 'SIMULATED-seed', 2026, $2, $2)`, [kingdomId, Date.now()]);
      await client.query(`insert into realm_layouts (kingdom_id, revision, parent_revision, plan, digest, adopted_ms)
        values ($1, 'SIMULATED-r1', null, '{}', $2, $3)`, [kingdomId, 'b'.repeat(64), Date.now()]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 needs DATABASE_URL; load it with --env-file-if-exists=.env');
    admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    await migrateRealmSchema(admin, schema);
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8, options: `-c search_path="${schema}"` });
    herald = await recordingHerald();
    await found(SOURCE);
    await found(TARGET);
    monarch = randomBytes(32).toString('base64url');
    await pool.query('insert into realm_persons (person_id, origin, identity_issuer) values ($1, $2, $3)', [SOURCE, 'simulated', `${ORIGIN}${SIMULATED_OIDC_PATH}`]);
    await pool.query(`insert into realm_sessions (session_id, handle_hash, person_id, origin, resume_scope, expires_at)
      values ($1, $2, $3, 'simulated', $4, now() + interval '1 hour')`, [randomUUID(), sha256(monarch), SOURCE, randomBytes(24).toString('base64url')]);
  });
  afterAll(async () => {
    for (const each of bindings) each.service.close();
    await herald?.close();
    await pool?.end();
    if (admin) { await admin.query(`drop schema if exists "${schema}" cascade`); await admin.end(); }
  });

  it('starts once through Herald across a lost answer and a restart, cancels once, and hears a landing the realm committed', async () => {
    const first = bind();
    const asMonarch = send(first);
    const gate = await asMonarch({ op: 'gate' });
    expect(gate).toMatchObject({ kind: 'gate', value: { viewer: 'monarch', authority: 'ready' } });

    // One press; Herald records the start and the answer is lost on the way back.
    const preview = await asMonarch({ op: 'preview', requestId: 'bound.one', target: TARGET });
    if (preview.kind !== 'preview') throw new Error(`Expected a preview, got ${JSON.stringify(preview)}`);
    herald.loseNextAnswer();
    const started = await asMonarch({ op: 'start', requestId: 'bound.one', previewToken: preview.value.token });
    expect(started).toMatchObject({ kind: 'action', value: { state: 'unknown' } });
    expect(herald.writes).toEqual([{ op: 'start', key: 'bound.one/start', outcome: { kind: 'accepted', createdAt: expect.any(Number) } }]);

    // A restarted API reconciles from Herald's ledger without a second write.
    first.service.close();
    const second = bind();
    await second.service.recover();
    const asAgain = send(second);
    expect(await asAgain({ op: 'read-action', requestId: 'bound.one' })).toMatchObject({ kind: 'action', value: { state: 'pending' } });
    expect(herald.writes.filter(write => write.op === 'start')).toHaveLength(1);

    // Cancel goes once; the pending raid is withdrawn.
    expect(await asAgain({ op: 'cancel', requestId: 'bound.one' })).toMatchObject({ kind: 'action', value: { state: 'cancelled' } });
    expect(herald.writes.map(write => write.op)).toEqual(['start', 'cancel']);

    // A second request starts, and the realm (another process) lands it on Twitch's word.
    const next = await asAgain({ op: 'preview', requestId: 'bound.two', target: TARGET });
    if (next.kind !== 'preview') throw new Error('Expected a second preview.');
    expect(await asAgain({ op: 'start', requestId: 'bound.two', previewToken: next.value.token })).toMatchObject({ kind: 'action', value: { state: 'pending' } });
    const stream = await second.service.http.handle(new Request(`${ORIGIN}/api/raid-gate/${SOURCE}?request=bound.two`, {
      headers: { cookie: `${COOKIE}=${monarch}`, accept: 'text/event-stream' },
    }));
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const states: string[] = [];
    const read = async (until: (state: string) => boolean, ms: number) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const chunk = await Promise.race([reader.read(), new Promise<null>(resolve => setTimeout(() => resolve(null), deadline - Date.now()))]);
        if (!chunk || chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
        for (;;) {
          const end = text.indexOf('\n\n');
          if (end < 0) break;
          const event = text.slice(0, end);
          text = text.slice(end + 2);
          const data = event.split('\n').find(line => line.startsWith('data: '));
          if (!data) continue;
          const reply = readGateReply(JSON.parse(data.slice(6)));
          if (reply?.kind === 'action') {
            states.push(reply.value.state);
            if (until(reply.value.state)) return true;
          }
        }
      }
      return false;
    };
    expect(await read(state => state === 'pending', 5_000)).toBe(true);
    const realm = new RaidObservationLedger({ pool, origin: 'simulated', clock: Date.now, moment: async () => ({ http: 202, body: { status: 'accepted' } }) });
    const now = Date.now();
    const landed = await realm.record(RaidObservationSchema.parse({ version: 1, id: `bound-event-${randomBytes(4).toString('hex')}`, origin: 'simulated',
      kingdomId: SOURCE, direction: 'outgoing', occurredAt: now, receivedAt: now,
      from: { kingdomId: SOURCE, login: 'source_kingdom', name: 'Source Kingdom' }, to: { kingdomId: TARGET, login: 'destination', name: 'Destination' }, viewers: 12 }));
    expect(landed).toMatchObject({ status: 'accepted', gate: { kind: 'landed', requestId: 'bound.two' } });
    expect(await read(state => state === 'landed', 8_000)).toBe(true);
    await reader.cancel();
    expect(herald.writes.map(write => write.op)).toEqual(['start', 'cancel', 'start']);
  }, 30_000);
});
