import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { raidWelcomePath } from '../../../api/src/raid-gate/guest-contracts';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { KingdomIdSchema } from '@chatdom/shared';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { startMockDoor } from '../../../herald/src/mock/door';
import { createMockRaidCrier } from '../../../herald/src/mock/crier';
import { RealmDelivery } from '../../../herald/src/realm-delivery/delivery';
import { migrateRealmSchema } from '../persistence/migrate';
import { RaidCrierAuthority } from './crier';
import { createRaidCrierService } from './crier-http';
import { createRaidShowService } from './http';

const exec = promisify(execFile);
const kingdomId = KingdomIdSchema.parse('129634568');
const serviceSecret = 'simulated-service-secret-0000000000000000', doorSecret = 'simulated-eventsub-secret';

async function nodeRequest(input: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) chunks.push(Buffer.from(chunk));
  const headers = new Headers();
  for (const [key, value] of Object.entries(input.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  const body = Buffer.concat(chunks);
  return new Request(`http://127.0.0.1${input.url}`, { method: input.method ?? 'GET', headers, ...(body.length ? { body } : {}) });
}

describe.runIf(process.env.REALM_DATABASE_TESTS === '1')('simulated Twitch CLI to durable raid crier', () => {
  it('sends one witnessed welcome and retains the road and pennant across service restart', async () => {
    if (!process.env.DATABASE_URL) throw new Error('REALM_DATABASE_TESTS=1 requires DATABASE_URL');
    const schema = `realm_test_${randomBytes(6).toString('hex')}`, dir = await mkdtemp(join(tmpdir(), 'crier-flow-'));
    const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    let pool: pg.Pool | undefined;
    let show: ReturnType<typeof createRaidShowService> | undefined;
    let crier: ReturnType<typeof createRaidCrierService> | undefined;
    let realm: RealmDelivery | undefined;
    let door: Awaited<ReturnType<typeof startMockDoor>> | undefined;
    let mock: ReturnType<typeof createMockRaidCrier> | undefined;
    const server = createServer((req, res) => { void (async () => {
      const request = await nodeRequest(req);
      const response = new URL(request.url).pathname.includes('/crier/') ? await crier!.handle(request) : await show!.handle(request);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    })().catch(() => { res.statusCode = 500; res.end(); }); });
    try {
      expect(await migrateRealmSchema(admin, schema)).toContain('0011c_realm_raid_crier');
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8, options: `-c search_path="${schema}"` });
      const openServices = () => {
        show = createRaidShowService({ pool: pool!, origin: 'simulated', clock: Date.now, credentials: { herald: serviceSecret }, recoverEveryMs: 0,
          moment: async () => ({ http: 202, body: { status: 'accepted' } }) });
        crier = createRaidCrierService({ authority: new RaidCrierAuthority({ pool: pool!, origin: 'simulated', clock: Date.now, publicOrigin: url }),
          origin: 'simulated', credentials: { herald: serviceSecret }, recoverEveryMs: 0 });
      };
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('No HTTP listener');
      const url = `http://127.0.0.1:${address.port}`;
      openServices();
      realm = await RealmDelivery.open({ url, secret: serviceSecret, directory: join(dir, 'outbox'), origin: 'simulated' });
      mock = createMockRaidCrier({ kingdomId, realm });
      door = await startMockDoor({ kingdomId, secret: doorSecret, realm, port: 0, crier: () => mock!.health() });
      const transport = mock.transport;
      await exec('/root/.local/bin/twitch', ['event', 'trigger', 'channel.raid', '-F', `http://127.0.0.1:${door.port}/eventsub`, '-s', doorSecret,
        '-t', kingdomId, '-f', '111'], { timeout: 10_000, env: { ...process.env, XDG_CONFIG_HOME: dir, TWITCH_DISABLE_UPDATE_CHECKS: 'true' } });
      await realm.flush();
      const observed = await pool.query('select observation, raid_id from realm_raid_observations');
      expect(observed.rows, JSON.stringify({ door: door.ingest.health(), outbox: realm.health() })).toHaveLength(1);
      const observation = JSON.parse(observed.rows[0].observation);
      expect(observation).toMatchObject({ origin: 'simulated', direction: 'incoming', kingdomId, from: { kingdomId: '111' } });
      expect(observation.viewers).toBeGreaterThanOrEqual(3);
      await mock.worker.poll();
      expect(transport.records).toHaveLength(1);
      expect(transport.records[0]!.text).toContain(observation.from.name);
      expect(transport.records[0]!.text).toContain(raidWelcomePath('129634568', observed.rows[0].raid_id));
      expect((await pool.query('select state from realm_raid_crier_jobs')).rows).toEqual([{ state: 'sent' }]);
      const beforeRoads = await (await fetch(`${url}/realm/raid-roads`)).json();
      const beforePennants = await (await fetch(`${url}/realm/raid-pennants/${kingdomId}`)).json();
      expect(beforeRoads.items).toHaveLength(1); expect(beforePennants.items).toHaveLength(1);
      const health = await (await fetch(`http://127.0.0.1:${door.port}/health`)).json();
      expect(health.crier.recorded).toEqual(transport.records);
      await mock.worker.close(); await show!.close(); await crier!.close(); openServices();
      mock = createMockRaidCrier({ kingdomId, realm }); await mock.worker.poll();
      expect(mock.transport.records).toHaveLength(0);
      expect(transport.records).toHaveLength(1);
      expect(await (await fetch(`${url}/realm/raid-roads`)).json()).toEqual(beforeRoads);
      const afterPennants = await (await fetch(`${url}/realm/raid-pennants/${kingdomId}`)).json();
      expect(afterPennants).toMatchObject({ version: 1, origin: 'simulated', kingdomId, items: beforePennants.items });
      expect(afterPennants.asOf).toBeGreaterThanOrEqual(beforePennants.asOf);
    } finally {
      await mock?.worker.close(); await door?.stop(); await realm?.close();
      await show?.close(); await crier?.close();
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await pool?.end(); await admin.query(`drop schema if exists "${schema}" cascade`); await admin.end();
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
