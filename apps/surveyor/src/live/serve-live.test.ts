import { createHash } from 'node:crypto';
import { request, type ClientRequest, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAtlasService, type AtlasService, type AtlasServiceOptions } from '../serve';
import { runLive } from './run';
import { readLiveManifest } from './store';
import type { LiveTarget } from './target';
import { IDS, LANDLESS, copyLand, fixtureLand, iso, liveAt, liveSnapshot, type Land } from './fixtures.test-support';

let base: Land;
beforeAll(async () => {
  base = await fixtureLand();
});
afterAll(() => base.cleanup());

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
  vi.useRealTimers();
});

function land(): Land {
  const copy = copyLand(base);
  cleanup.push(copy.cleanup);
  return copy;
}

async function start(dataDir: string, options: AtlasServiceOptions = {}): Promise<{ service: AtlasService; port: number }> {
  const service = createAtlasService(dataDir, () => {}, options);
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => service.close());
  return { service, port: (service.server.address() as AddressInfo).port };
}

interface Reply { status: number; headers: IncomingHttpHeaders; body: Buffer; text: string }

/** Raw request, so traversal paths reach the server unnormalised. */
function get(port: number, path: string, init: { method?: string; headers?: Record<string, string> } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: init.method ?? 'GET', headers: init.headers ?? {} }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (chunk: Buffer) => parts.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(parts);
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body, text: body.toString('utf8') });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

interface Stream { status: number; headers: IncomingHttpHeaders; raw: () => string; events: () => LivePointer[]; ended: Promise<void>; req: ClientRequest }

/** Opens an event stream and collects every `live` event's pointer. */
function events(port: number, path: string): Promise<Stream> {
  return new Promise((resolve, reject) => {
    let text = '';
    const req = request({ host: '127.0.0.1', port, path, headers: { accept: 'text/event-stream' } }, (res) => {
      let end!: () => void;
      const ended = new Promise<void>((done) => {
        end = done;
      });
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        text += chunk;
      });
      res.on('end', () => end());
      res.on('close', () => end());
      const parse = () => text.split('\n\n').filter((block) => block.includes('event: live'))
        .map((block) => JSON.parse(block.split('\n').find((line) => line.startsWith('data: '))!.slice(6)) as LivePointer);
      resolve({ status: res.statusCode ?? 0, headers: res.headers, raw: () => text, events: parse, ended, req });
    });
    req.on('error', reject);
    req.end();
  });
}

async function until(check: () => boolean, ms = 3_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

interface LivePointer {
  version: number;
  kind: string;
  preview: string;
  manifest: { evidence: { asOf: number }; live: { path: string; sha256: string }; starts: { path: string; sha256: string }; dabs: { path: string; sha256: string } } | null;
  source: Record<string, unknown>;
}

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const IMMUTABLE = 'public, max-age=31536000, immutable';
const NOT_FOUND = '{"error":"not-found"}';

const snapshot = (index: number, options: { streams?: number } = {}) => {
  const at = liveAt(index);
  return liveSnapshot(at, [
    { id: IDS.capital, average: 6_000 },
    { id: IDS.small, average: 8, startedAt: iso(at - 600_000) },
    { id: LANDLESS[0], average: 12, startedAt: iso(at - 60_000) },
  ], options.streams === undefined ? {} : { streams: options.streams, history: Array.from({ length: 10 }, () => 1_000) });
};

const cache = new Map<string, LiveTarget>();
async function produce(l: Land, index: number, options: { streams?: number } = {}) {
  return runLive(l.dataDir, null, cache, { now: () => liveAt(index) + 15_000, readSource: () => snapshot(index, options) });
}

describe('live pointer', () => {
  it('serves the current manifest and the source state, uncached and without the producer\'s reasons', async () => {
    const l = land();
    const { port } = await start(l.dataDir);
    const url = `/map-data/v1/live/${l.previewId}`;

    const empty = await get(port, url);
    expect(empty.status).toBe(200);
    expect(JSON.parse(empty.text)).toEqual({
      version: 1, kind: 'chatdom-atlas-live-pointer', preview: l.previewId, manifest: null,
      source: { state: 'unavailable', checkedAt: null, sweepAt: null, completeAt: null, gapBefore: false, rule: null },
    });

    await produce(l, 1);
    const published = await get(port, url);
    expect(published.status).toBe(200);
    expect(published.headers['cache-control']).toBe('no-cache');
    expect(published.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(JSON.parse(published.text)).toEqual({
      version: 1, kind: 'chatdom-atlas-live-pointer', preview: l.previewId, manifest: readLiveManifest(l.dataDir, l.previewId),
      source: { state: 'complete', checkedAt: liveAt(1) + 15_000, sweepAt: liveAt(1), completeAt: liveAt(1), gapBefore: false, rule: 'sweep-complete-1' },
    });
    const etag = published.headers.etag as string;
    expect(etag).toMatch(/^"[a-f0-9]{32}"$/);
    expect((await get(port, url, { headers: { 'if-none-match': etag } })).status).toBe(304);

    const refused = await produce(l, 2, { streams: 20 });
    expect(refused.state.reason).toEqual(expect.any(String));
    const partial = await get(port, url);
    const body = JSON.parse(partial.text) as LivePointer;
    expect(body.source).toMatchObject({ state: 'partial', sweepAt: liveAt(2), completeAt: liveAt(1) });
    expect(body.manifest!.evidence.asOf).toBe(liveAt(1));
    expect(Object.keys(body.source)).not.toContain('reason');
    expect(partial.text).not.toContain(refused.state.reason!.slice(0, 30));
    expect(partial.headers.etag).not.toBe(etag);
    for (const login of ['fixture_capital', 'fixture_small']) expect(partial.text).not.toContain(login);
  });

  it('serves every frame file as immutable, byte for byte what the manifest pins', async () => {
    const l = land();
    await produce(l, 1);
    const { port } = await start(l.dataDir);
    const manifest = (JSON.parse((await get(port, `/map-data/v1/live/${l.previewId}`)).text) as LivePointer).manifest!;
    for (const [asset, type] of [[manifest.live, 'application/octet-stream'], [manifest.starts, 'application/json; charset=utf-8'], [manifest.dabs, 'application/octet-stream']] as const) {
      const reply = await get(port, `/map-data${asset.path}`);
      expect(reply.status).toBe(200);
      expect(reply.headers['cache-control']).toBe(IMMUTABLE);
      expect(reply.headers['content-type']).toBe(type);
      expect(sha(reply.body)).toBe(asset.sha256);
      expect((await get(port, `/map-data${asset.path}`, { headers: { 'if-none-match': reply.headers.etag as string } })).status).toBe(304);
      const head = await get(port, `/map-data${asset.path}`, { method: 'HEAD' });
      expect([head.status, head.body.length]).toEqual([200, 0]);
    }
    const zipped = await get(port, `/map-data${manifest.live.path}`, { headers: { 'accept-encoding': 'gzip' } });
    expect(zipped.headers['content-encoding']).toBe('gzip');
    expect(sha(gunzipSync(zipped.body))).toBe(manifest.live.sha256);
    // Dabs are hashes and times: nothing to gain from compression.
    const dabs = await get(port, `/map-data${manifest.dabs.path}`, { headers: { 'accept-encoding': 'gzip' } });
    expect(dabs.headers['content-encoding']).toBeUndefined();
  });

  it('answers 404 for unknown previews and frames, and refuses traversal and writes', async () => {
    const l = land();
    await produce(l, 1);
    const { port } = await start(l.dataDir);
    const manifest = readLiveManifest(l.dataDir, l.previewId)!;
    const frame = manifest.live.path.split('/')[4]!;
    const unknownPreview = 'pv-20200101T000000Z-aaaaaaaaaaaa';
    const notFound = [
      `/map-data/v1/live/${unknownPreview}`,
      `/map-data/v1/live/${unknownPreview}/events`,
      `/map-data/v1/live/${unknownPreview}/${frame}/live.bin`,
      `/map-data/v1/live/${l.previewId}/lf-20200101T000000Z-aaaaaaaaaaaa/live.bin`,
      `/map-data/v1/live/${l.previewId}/${frame}/manifest.json`,
      `/map-data/v1/live/${l.previewId}/manifest.json`,
      `/map-data/v1/live/state.json`,
      `/map-data/v1/live/pv-nope`,
      `/map-data/v1/live/${l.previewId}/../state.json`,
      `/map-data/v1/live/${l.previewId}/${frame}/../manifest.json`,
      `/map-data/v1/live/${l.previewId}/${frame}/..%2f..%2fstate.json`,
      `/map-data/v1/live/${l.previewId}/%2e%2e/${frame}/live.bin`,
      `/map-data/v1/live/../../live/${l.previewId}`,
      `/map-data/v1/live/${l.previewId}/${frame}/live.bin/`,
    ];
    for (const path of notFound) {
      const reply = await get(port, path);
      expect([path, reply.status, reply.text]).toEqual([path, 404, NOT_FOUND]);
    }
    expect((await get(port, `/map-data/v1/live/${l.previewId}`, { method: 'POST' })).status).toBe(405);
  });
});

describe('live event stream', () => {
  it('sends the pointer at once, again when the manifest changes, and ends when the service closes', async () => {
    const l = land();
    await produce(l, 1);
    const { service, port } = await start(l.dataDir, { liveWatchMs: 20 });
    const stream = await events(port, `/map-data/v1/live/${l.previewId}/events`);
    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(stream.headers['cache-control']).toBe('no-cache, no-transform');
    await until(() => stream.events().length === 1);
    expect(stream.raw().startsWith('retry: 15000\n')).toBe(true);
    expect(stream.events()[0]!.manifest!.evidence.asOf).toBe(liveAt(1));

    // An unchanged pointer is not sent again.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(stream.events()).toHaveLength(1);

    await produce(l, 2);
    await until(() => stream.events().length === 2);
    const second = stream.events()[1]!;
    expect(second).toMatchObject({ kind: 'chatdom-atlas-live-pointer', preview: l.previewId, source: { state: 'complete', sweepAt: liveAt(2) } });
    expect(second.manifest).toEqual(readLiveManifest(l.dataDir, l.previewId));

    // A refused sweep changes only the source state; readers still hear about it, with the same frame.
    await produce(l, 3, { streams: 20 });
    await until(() => stream.events().length === 3);
    expect(stream.events()[2]).toMatchObject({ manifest: second.manifest, source: { state: 'partial', completeAt: liveAt(2) } });
    expect(stream.raw()).not.toContain('reason');

    const closing = service.close();
    await stream.ended;
    await closing;
    cleanup.pop();
  });

  it('tells an open stream about a new frame even when another reader connects right after it', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const l = land();
    await produce(l, 1);
    const { port } = await start(l.dataDir, { liveWatchMs: 1_000 });
    const first = await events(port, `/map-data/v1/live/${l.previewId}/events`);
    await until(() => first.events().length === 1);
    await produce(l, 2);
    const second = await events(port, `/map-data/v1/live/${l.previewId}/events`);
    await until(() => second.events().length === 1);
    expect(second.events()[0]!.manifest!.evidence.asOf).toBe(liveAt(2));
    vi.advanceTimersByTime(1_000);
    await until(() => first.events().length === 2, 500);
    expect(first.events()[1]!.manifest!.evidence.asOf).toBe(liveAt(2));
  });
});
