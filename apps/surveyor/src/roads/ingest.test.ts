import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AtlasRaid } from '@chatdom/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fault = vi.hoisted(() => ({ failFsync: false }));
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return {
    ...fs,
    fsyncSync(fd: number) {
      if (fault.failFsync) throw new Error('injected fsync failure');
      return fs.fsyncSync(fd);
    },
  };
});

import { createAtlasService, INGEST_MAX_BYTES, type AtlasService, type AtlasServiceOptions } from '../serve';
import { RoadLedger } from './ledger';
import { AtlasRoadIngressError, createAtlasRoadIngress } from './client';

const NOW = 1_793_300_000_000;
const dirs: string[] = [];
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  fault.failFsync = false;
  while (cleanup.length) await cleanup.pop()!();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function directory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'chatdom-road-ingest-'));
  dirs.push(dir);
  return dir;
}

async function start(dataDir: string, options: AtlasServiceOptions = {}): Promise<{ service: AtlasService; port: number; publicPort: number }> {
  const service = createAtlasService(dataDir, () => {}, {
    now: () => NOW, twitchLookup: null, ingestToken: null, ...options, roads: { feedUrl: null, surveyorBase: null, recorderPath: null },
  });
  await new Promise<void>((resolve) => service.ingest.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => service.close());
  return { service, port: (service.ingest.address() as AddressInfo).port, publicPort: (service.server.address() as AddressInfo).port };
}

function raid(id: string, overrides: Partial<AtlasRaid> = {}): AtlasRaid {
  return {
    version: 1, id, fromKingdomId: '100' as AtlasRaid['fromKingdomId'], toKingdomId: '200' as AtlasRaid['toKingdomId'], viewers: 25,
    observedAt: NOW, occurredAt: NOW - 400, evidence: { kind: 'observed', asOf: NOW }, delivery: 'resumable', source: 'herald', ...overrides,
  };
}

interface Reply { status: number; headers: Record<string, string | string[] | undefined>; body: string; json: () => Record<string, unknown> }
function send(port: number, body: string | Buffer, init: { method?: string; path?: string; headers?: Record<string, string> } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1', port, path: init.path ?? '/v1/roads/observe', method: init.method ?? 'POST',
      headers: { 'content-type': 'application/json', ...init.headers },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
const post = (port: number, value: unknown, headers: Record<string, string> = {}) => send(port, JSON.stringify(value), { headers });

function journal(dataDir: string): { body: { kind: string; raid?: AtlasRaid } }[] {
  return readFileSync(join(dataDir, 'roads', 'ledger.ndjson'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

describe('the private road ingest', () => {
  it('stores a witnessed herald raid durably and answers a repeat as a duplicate', async () => {
    const dataDir = directory();
    const { port } = await start(dataDir);
    const started = performance.now();
    const first = await post(port, raid('eventsub-1'));
    const elapsed = performance.now() - started;
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.json()).toEqual({ kind: 'stored', raidId: 'eventsub-1', road: '100~200', raids: 1 });
    expect(elapsed).toBeLessThan(200);
    // The 200 follows the durable write: the record is already in the journal.
    expect(journal(dataDir).map((line) => line.body.raid?.id)).toEqual(['eventsub-1']);
    expect((await post(port, raid('eventsub-1'))).json()).toEqual({ kind: 'duplicate', raidId: 'eventsub-1', road: '100~200', raids: 1 });
    expect((await post(port, raid('eventsub-2', { occurredAt: NOW - 90_000 }))).json()).toMatchObject({ kind: 'stored', raids: 2 });
    expect((await post(port, raid('eventsub-3', { fromKingdomId: '200' as AtlasRaid['fromKingdomId'], toKingdomId: '100' as AtlasRaid['toKingdomId'] }))).json()).toMatchObject({ kind: 'stored', road: '100~200', raids: 3 });
    expect(journal(dataDir)).toHaveLength(3);
  });

  it('answers a raid the survey already witnessed within the window as a duplicate across sources', async () => {
    const dataDir = directory();
    const seed = new RoadLedger(dataDir);
    seed.observe(raid('surveyor:recorded', { source: 'surveyor-recorder', occurredAt: null, observedAt: NOW - 10_000, evidence: { kind: 'observed', asOf: NOW - 10_000 } }));
    seed.close();
    const { port } = await start(dataDir);
    expect((await post(port, raid('eventsub-late', { occurredAt: NOW - 5_000 }))).json()).toEqual({ kind: 'duplicate', raidId: 'eventsub-late', road: '100~200', raids: 1 });
    expect((await post(port, raid('eventsub-other', { occurredAt: NOW + 60_000 }))).json()).toMatchObject({ kind: 'stored', raids: 2 });
  });

  it('refuses bodies it cannot store with a fixed reason, never echoing the payload', async () => {
    const { port } = await start(directory());
    const cases: [string | Buffer, Record<string, string>, number, unknown][] = [
      ['{"version":1,', {}, 422, { kind: 'invalid', reason: 'json' }],
      [Buffer.from([0xff, 0xfe, 0x7b]), {}, 422, { kind: 'invalid', reason: 'json' }],
      [JSON.stringify(raid('eventsub-x')), { 'content-type': 'text/plain' }, 422, { kind: 'invalid', reason: 'content-type' }],
      [JSON.stringify({ ...raid('eventsub-x'), viewers: 0 }), {}, 422, { kind: 'invalid', reason: 'schema' }],
      [JSON.stringify({ ...raid('eventsub-x'), version: 2 }), {}, 422, { kind: 'invalid', reason: 'schema' }],
      [JSON.stringify([raid('eventsub-x')]), {}, 422, { kind: 'invalid', reason: 'schema' }],
      [JSON.stringify(raid('sim-x', { source: 'simulation', evidence: { kind: 'simulated', asOf: NOW } as never })), {}, 422, { kind: 'invalid', reason: 'simulation' }],
      [JSON.stringify(raid('sim-y', { evidence: { kind: 'simulated', asOf: NOW } as never })), {}, 422, { kind: 'invalid', reason: 'simulation' }],
      [JSON.stringify(raid('surveyor:x', { source: 'surveyor-recorder' })), {}, 422, { kind: 'invalid', reason: 'source' }],
      [JSON.stringify({ ...raid('eventsub-x'), note: 'x'.repeat(INGEST_MAX_BYTES) }), {}, 413, { kind: 'too-large' }],
    ];
    for (const [body, headers, status, reply] of cases) {
      const response = await send(port, body, { headers });
      expect(response.status, String(body).slice(0, 60)).toBe(status);
      expect(response.json()).toEqual(reply);
    }
    // The same ID with other facts is a conflict, not a second raid.
    expect((await post(port, raid('eventsub-c'))).status).toBe(200);
    expect((await post(port, raid('eventsub-c', { viewers: 26 }))).json()).toEqual({ kind: 'invalid', reason: 'conflict' });
    expect((await send(port, '', { method: 'GET' })).status).toBe(405);
    expect((await send(port, '', { method: 'PUT' })).headers.allow).toBe('POST');
    expect((await send(port, JSON.stringify(raid('eventsub-p')), { path: '/v1/roads/observe/../x' })).status).toBe(404);
    expect((await send(port, JSON.stringify(raid('eventsub-p')), { path: '/map-data/v1/survey', method: 'GET' })).status).toBe(404);
  });

  it('is unreachable through the public server', async () => {
    const { publicPort } = await start(directory());
    const response = await send(publicPort, JSON.stringify(raid('eventsub-public')));
    expect(response.status).toBe(405);
    expect((await send(publicPort, '', { method: 'GET' })).status).toBe(404);
  });

  it('requires the configured bearer token', async () => {
    const { port } = await start(directory(), { ingestToken: 'a-long-ingest-token' });
    expect((await post(port, raid('eventsub-t'))).json()).toEqual({ kind: 'unauthorized' });
    expect((await post(port, raid('eventsub-t'), { authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await post(port, raid('eventsub-t'), { authorization: 'Bearer a-long-ingest-token-and-more' })).status).toBe(401);
    expect((await post(port, raid('eventsub-t'), { authorization: 'a-long-ingest-token' })).status).toBe(401);
    expect((await post(port, raid('eventsub-t'), { authorization: 'Bearer a-long-ingest-token' })).json()).toMatchObject({ kind: 'stored' });
  });

  it('stores twenty concurrent identical posts exactly once', async () => {
    const dataDir = directory();
    const { port } = await start(dataDir);
    const replies = await Promise.all(Array.from({ length: 20 }, () => post(port, raid('eventsub-burst'))));
    expect(replies.every((reply) => reply.status === 200)).toBe(true);
    const kinds = replies.map((reply) => reply.json().kind);
    expect(kinds.filter((kind) => kind === 'stored')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'duplicate')).toHaveLength(19);
    expect(replies.every((reply) => reply.json().raids === 1)).toBe(true);
    expect(journal(dataDir)).toHaveLength(1);
  });

  it('answers unavailable after an uncertain write and keeps refusing until restart', async () => {
    const dataDir = directory();
    const { port, service } = await start(dataDir);
    fault.failFsync = true;
    expect((await post(port, raid('eventsub-u'))).json()).toEqual({ kind: 'unavailable' });
    fault.failFsync = false;
    const again = await post(port, raid('eventsub-u'));
    expect(again.status).toBe(503);
    expect(again.headers['retry-after']).toBe('30');
    await service.close();
    // Reopening resolves the uncertain record from the journal; the producer's retry is then a safe duplicate.
    const { port: reopened } = await start(dataDir);
    expect((await post(reopened, raid('eventsub-u'))).json()).toMatchObject({ kind: 'duplicate', raids: 1 });
  });
});

describe('the road ingest client', () => {
  it('resolves on stored and duplicate against the real ingest and rejects what it cannot vouch for', async () => {
    const { port } = await start(directory(), { ingestToken: 'client-token' });
    const client = createAtlasRoadIngress({ url: `http://127.0.0.1:${port}`, token: 'client-token' });
    expect(client.origin).toBe('live');
    const signal = new AbortController().signal;
    await expect(client.observe(raid('eventsub-client'), signal)).resolves.toBeUndefined();
    await expect(client.observe(raid('eventsub-client'), signal)).resolves.toBeUndefined();
    await expect(createAtlasRoadIngress({ url: `http://127.0.0.1:${port}/v1/roads/observe`, token: 'client-token' }).observe(raid('eventsub-full'), signal)).resolves.toBeUndefined();
    await expect(createAtlasRoadIngress({ url: `http://127.0.0.1:${port}` }).observe(raid('eventsub-anon'), signal)).rejects.toMatchObject({ reason: 'unauthorized', status: 401 });
    await expect(client.observe(raid('eventsub-client', { viewers: 99 }), signal)).rejects.toMatchObject({ reason: 'invalid', status: 422, detail: 'conflict' });
    await expect(client.observe(raid('sim', { source: 'simulation', evidence: { kind: 'simulated', asOf: NOW } as never }), signal)).rejects.toBeInstanceOf(AtlasRoadIngressError);
    await expect(createAtlasRoadIngress({ url: 'http://127.0.0.1:1' }).observe(raid('eventsub-n'), signal)).rejects.toMatchObject({ reason: 'network' });
  });

  it('rejects unavailable, unexpected replies, timeouts and an aborted signal', async () => {
    const reply = (status: number, body: unknown): typeof fetch => async () => Response.json(body, { status });
    const signal = new AbortController().signal;
    const observe = (fetchImpl: typeof fetch, timeoutMs?: number, given = signal) =>
      createAtlasRoadIngress({ url: 'http://ingest.test', fetch: fetchImpl, ...(timeoutMs ? { timeoutMs } : {}) }).observe(raid('eventsub-m'), given);
    await expect(observe(reply(200, { kind: 'stored', raidId: 'eventsub-m', road: '100~200', raids: 1 }))).resolves.toBeUndefined();
    await expect(observe(reply(503, { kind: 'unavailable' }))).rejects.toMatchObject({ reason: 'unavailable' });
    await expect(observe(reply(200, { kind: 'stored', raidId: 'another', road: '100~200', raids: 1 }))).rejects.toMatchObject({ reason: 'unexpected' });
    await expect(observe(reply(200, { kind: 'accepted' }))).rejects.toMatchObject({ reason: 'unexpected' });
    await expect(observe(async () => new Response('<html>', { status: 502 }))).rejects.toMatchObject({ reason: 'unexpected', status: 502 });
    const hang: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    });
    await expect(observe(hang, 30)).rejects.toMatchObject({ reason: 'timeout' });
    const controller = new AbortController();
    const pending = observe(hang, 5_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ reason: 'aborted' });
    await expect(observe(hang, 5_000, AbortSignal.abort())).rejects.toMatchObject({ reason: 'aborted' });
    let sent: { url: string; init: RequestInit } | undefined;
    await createAtlasRoadIngress({ url: 'http://ingest.test/', token: 't0ken', fetch: async (input, init) => {
      sent = { url: String(input), init: init! };
      return Response.json({ kind: 'duplicate', raidId: 'eventsub-m', road: '100~200', raids: 1 });
    } }).observe(raid('eventsub-m'), signal);
    expect(sent!.url).toBe('http://ingest.test/v1/roads/observe');
    expect(sent!.init).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer t0ken', 'content-type': 'application/json' } });
    expect(JSON.parse(String(sent!.init.body))).toEqual(raid('eventsub-m'));
    expect(() => createAtlasRoadIngress({ url: 'http://user:pass@ingest.test' })).toThrow();
  });
});
