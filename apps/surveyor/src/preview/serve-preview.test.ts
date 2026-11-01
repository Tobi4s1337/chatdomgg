import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import type { ImportConfig } from '../config';
import { runImport, type ImportOutcome } from '../import';
import { WITHHELD_FILE } from '../policy/visibility';
import { createAtlasService, type AtlasServiceOptions } from '../serve';
import { readLedger } from '../store/revisions';
import { FixtureSource, RECENT, clock, configFor, fakeSurveyor, sweepAt, tempDataDir } from '../test/fixture-source';
import { previewIdFor } from './build';
import { PREVIEW_LABEL, PreviewChunkSchema, PreviewWorldSchema, ServedNamesSchema } from './schema';
import { previewDir, previewsRoot, readPreviewManifest, verifyPreviewDir } from './store';
import { allowRealImports } from '../test/timeouts';

allowRealImports();

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

async function start(dataDir: string, options: AtlasServiceOptions = {}): Promise<number> {
  const service = createAtlasService(dataDir, () => {}, options);
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => service.close());
  return (service.server.address() as AddressInfo).port;
}

interface Reply { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer; text: string }

/** Raw request with a binary body, so traversal paths reach the server unnormalised and gzip can be checked. */
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

function published(outcome: ImportOutcome) {
  if (!outcome.ok) throw new Error(`import failed: ${outcome.error.code} ${outcome.error.message}`);
  return outcome;
}

async function imported(overrides: Partial<ImportConfig> = {}) {
  const source = FixtureSource.standard();
  const dataDir = tempDataDir();
  cleanup.push(() => source.close(), () => rmSync(dataDir, { recursive: true, force: true }));
  const importAt = async (at: number) => published(await runImport(configFor(source, dataDir, overrides), {
    fetchImpl: fakeSurveyor({ status: source.status(), 'raids/recent': RECENT }).fetchImpl, now: clock(at),
  }));
  /** A later sweep: a new observation revision with its own preview. */
  const nextRevision = async (at: number) => {
    source.addSweeps(1);
    source.db.prepare('UPDATE channels SET last_live = ? WHERE live = 1').run(sweepAt(source.sweeps - 1));
    return importAt(at);
  };
  const first = await importAt(sweepAt(10));
  return { source, dataDir, first, importAt, nextRevision };
}

interface Pointer { version: number; id: string; revision: string; asOf: number; world: { url: string; sha256: string; bytes: number } }

const NOT_FOUND = '{"error":"not-found"}';
const IMMUTABLE = 'public, max-age=31536000, immutable';

describe('survey preview routes', () => {
  it('points at the current revision\'s preview, pinned by the hash of its world file', async () => {
    const { dataDir, first } = await imported();
    const port = await start(dataDir);
    const id = previewIdFor(first.revision, first.manifest.asOf);
    expect(first.preview).toEqual({ id, outcome: 'written' });

    const response = await get(port, '/map-data/v1/preview');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.headers.etag).toBe(`"${first.revision}"`);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    const worldPath = join(previewDir(dataDir, id), 'world.json');
    const worldBytes = readFileSync(worldPath);
    expect(JSON.parse(response.text) as Pointer).toEqual({
      version: 1, id, revision: first.revision, asOf: sweepAt(4),
      world: { url: `/map-data/v1/preview/${id}/world.json`, sha256: sha(worldBytes), bytes: statSync(worldPath).size },
    });
    expect(readPreviewManifest(dataDir, id).world.sha256).toBe(sha(worldBytes));
    expect(response.text).not.toContain(dataDir);
    expect(verifyPreviewDir(previewDir(dataDir, id), { id, revision: first.revision })).toEqual([]);

    // The fixture's three candidates are drawn; its small stream and its source paths are not.
    const world = PreviewWorldSchema.parse(JSON.parse(worldBytes.toString('utf8')));
    expect(world).toMatchObject({ label: PREVIEW_LABEL, status: 'preview', revision: first.revision, counts: { channelsObserved: 4, mapped: 3, capital: 1, town: 1, village: 1 } });
    expect(world.regions.map((r) => [r.language, r.kind, r.name])).toEqual(
      expect.arrayContaining([['en', 'isle', 'English'], ['ja', 'isle', '日本語'], ['de', 'isle', 'Deutsch']]),
    );
    expect(world.head.ids).toEqual(['900000000000000001']);
    // The immutable files carry no raw names at all; those come only from the names projection.
    const all = readFileSync(join(previewDir(dataDir, id), 'world.json'), 'utf8') +
      world.regions.map((r) => readFileSync(join(previewDir(dataDir, id), r.chunk.path), 'utf8')).join('');
    for (const absent of ['fixture_', 'Fixture', 'フィクスチャ', 'surveyor.db', 'surveyor.test', dataDir]) expect(all).not.toContain(absent);
  });

  it('records the preview in the import outcome and the ledger, and keeps it on an unchanged re-import', async () => {
    const { dataDir, first, importAt } = await imported();
    const id = first.preview.id;
    expect(readLedger(dataDir).at(-1)).toMatchObject({ outcome: 'published', revision: first.revision, details: [`preview ${id} written`] });
    const before = readFileSync(join(previewDir(dataDir, id), 'world.json'));

    const again = await importAt(sweepAt(40));
    expect(again).toMatchObject({ outcome: 'unchanged', revision: first.revision, preview: { id, outcome: 'existing' } });
    expect(readLedger(dataDir).at(-1)).toMatchObject({ outcome: 'unchanged', details: [`preview ${id} existing`] });
    expect(readFileSync(join(previewDir(dataDir, id), 'world.json')).equals(before)).toBe(true);
  });

  it('serves world.json and region files immutably, with ETag revalidation and gzip that unpacks to the pinned bytes', async () => {
    const { dataDir } = await imported();
    const port = await start(dataDir);
    const pointer = JSON.parse((await get(port, '/map-data/v1/preview')).text) as Pointer;

    const plain = await get(port, pointer.world.url);
    expect(plain.status).toBe(200);
    expect(plain.headers).toMatchObject({
      'content-type': 'application/json; charset=utf-8', 'cache-control': IMMUTABLE, vary: 'accept-encoding',
      'x-content-type-options': 'nosniff', 'content-length': String(pointer.world.bytes),
    });
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(sha(plain.body)).toBe(pointer.world.sha256);
    expect(plain.body.byteLength).toBe(pointer.world.bytes);
    const etag = plain.headers.etag as string;
    expect(etag).toMatch(/^"[a-f0-9]{32}"$/);
    expect(pointer.world.sha256.startsWith(etag.slice(1, -1))).toBe(true);

    const revalidated = await get(port, pointer.world.url, { headers: { 'if-none-match': etag } });
    expect(revalidated).toMatchObject({ status: 304, text: '' });
    expect(revalidated.headers).toMatchObject({ etag, 'cache-control': IMMUTABLE });
    expect((await get(port, pointer.world.url, { headers: { 'if-none-match': '"stale"' } })).status).toBe(200);

    const gzipped = await get(port, pointer.world.url, { headers: { 'accept-encoding': 'gzip, deflate, br' } });
    expect(gzipped.status).toBe(200);
    expect(gzipped.headers['content-encoding']).toBe('gzip');
    expect(gzipped.headers['content-length']).toBe(String(gzipped.body.byteLength));
    expect(gzipped.body.byteLength).toBeLessThan(pointer.world.bytes);
    expect(sha(gunzipSync(gzipped.body))).toBe(pointer.world.sha256);

    const head = await get(port, pointer.world.url, { method: 'HEAD' });
    expect(head).toMatchObject({ status: 200, text: '' });
    expect(head.headers['content-length']).toBe(String(pointer.world.bytes));

    const world = PreviewWorldSchema.parse(JSON.parse(plain.text));
    // Three languages, plus the six empty Outer Isles kept for overflow.
    expect(world.regions.filter((region) => region.language !== null)).toHaveLength(3);
    expect(world.regions.filter((region) => region.kind === 'outer')).toHaveLength(6);
    for (const region of world.regions) {
      const url = `/map-data/v1/preview/${world.id}/${region.chunk.path}`;
      const chunk = await get(port, url, { headers: { 'accept-encoding': 'gzip' } });
      expect(chunk.status, url).toBe(200);
      expect(chunk.headers['cache-control']).toBe(IMMUTABLE);
      const body = gunzipSync(chunk.body);
      expect(sha(body), url).toBe(region.chunk.sha256);
      expect(body.byteLength).toBe(region.chunk.bytes);
      expect(PreviewChunkSchema.parse(JSON.parse(body.toString('utf8')))).toMatchObject({ preview: world.id, region: region.index });
      const etag = chunk.headers.etag as string;
      expect((await get(port, url, { headers: { 'if-none-match': etag } })).status).toBe(304);
    }
  });

  it('answers 404 for unknown previews and regions, unlisted files and every traversal attempt', async () => {
    const { dataDir, first } = await imported();
    const port = await start(dataDir);
    const id = first.preview.id;
    const base = `/map-data/v1/preview/${id}`;
    expect((await get(port, `${base}/world.json`)).status).toBe(200);
    const paths = [
      `${base}/region-99.json`,
      `${base}/region--1.json`,
      `${base}/region-0.json.gz`,
      '/map-data/v1/preview/pv-20200101T000000Z-000000000000/world.json',
      `/map-data/v1/preview/${id.toUpperCase()}/world.json`,
      `${base}/manifest.json`,
      `${base}/`,
      base,
      `${base}/world.json/`,
      `${base}/../../current.json`,
      `${base}/../${id}/world.json`,
      `${base}/..%2f..%2fcurrent.json`,
      `${base}/%2e%2e/%2e%2e/current.json`,
      `${base}%2fworld.json`,
      `${base}/world%2ejson`,
      `${base}/world.json%00`,
      `/map-data/v1/preview/..%2f..%2frevisions/world.json`,
      `/map-data/v1/preview/../../ledger/imports.ndjson`,
      `/map-data/v1/preview/${id}/region-0.json/../../../current.json`,
    ];
    for (const path of paths) {
      const response = await get(port, path);
      expect(response.status, path).toBe(404);
      expect(response.text, path).toBe(NOT_FOUND);
    }
    expect((await get(port, `${base}/world.json`, { method: 'POST' })).status).toBe(405);
    expect((await get(port, '/map-data/v1/preview', { method: 'PUT' })).status).toBe(405);
  });

  it('keeps serving a kept older preview to a tab that pinned it, and 404s a preview pruned with its revision', async () => {
    const { dataDir, first, nextRevision } = await imported({ keepRevisions: 2 });
    const second = await nextRevision(sweepAt(30));
    expect(second.preview.id).not.toBe(first.preview.id);
    const third = await nextRevision(sweepAt(50));
    // Retention keeps two revisions: the first is pruned and its preview, which carries display names, goes with it.
    expect(existsSync(previewDir(dataDir, first.preview.id))).toBe(false);
    expect(existsSync(previewDir(dataDir, second.preview.id))).toBe(true);

    const port = await start(dataDir);
    const pointer = JSON.parse((await get(port, '/map-data/v1/preview')).text) as Pointer;
    expect(pointer).toMatchObject({ id: third.preview.id, revision: third.revision });
    expect((await get(port, `/map-data/v1/preview/${second.preview.id}/world.json`)).status).toBe(200);
    const pruned = await get(port, `/map-data/v1/preview/${first.preview.id}/world.json`);
    expect(pruned).toMatchObject({ status: 404, text: NOT_FOUND });
    expect((await get(port, `/map-data/v1/preview/${first.preview.id}/region-0.json`)).status).toBe(404);
  });

  it('stops serving a preview from memory once a running service sees it pruned', async () => {
    const { dataDir, first, nextRevision } = await imported({ keepRevisions: 2 });
    const port = await start(dataDir);
    expect((await get(port, `/map-data/v1/preview/${first.preview.id}/world.json`)).status).toBe(200);
    await nextRevision(sweepAt(30));
    await nextRevision(sweepAt(50));
    expect(existsSync(previewDir(dataDir, first.preview.id))).toBe(false);
    expect(await get(port, `/map-data/v1/preview/${first.preview.id}/world.json`)).toMatchObject({ status: 404, text: NOT_FOUND });
  });

  it('answers 503 no-preview before any import, and when the current revision has no preview', async () => {
    const empty = tempDataDir();
    cleanup.push(() => rmSync(empty, { recursive: true, force: true }));
    const emptyPort = await start(empty);
    const none = await get(emptyPort, '/map-data/v1/preview');
    expect(none).toMatchObject({ status: 503, text: '{"error":"no-preview"}' });
    expect(none.headers['retry-after']).toBe('60');

    const { dataDir, first } = await imported();
    rmSync(previewsRoot(dataDir), { recursive: true, force: true });
    const port = await start(dataDir);
    expect(await get(port, '/map-data/v1/preview')).toMatchObject({ status: 503, text: '{"error":"no-preview"}' });
    expect((await get(port, `/map-data/v1/preview/${first.preview.id}/world.json`)).status).toBe(404);
    // The survey itself is still served; only the land is missing.
    expect((await get(port, '/map-data/v1/survey')).status).toBe(200);
  });

  it('refuses to serve preview files that no longer match their pinned hashes', async () => {
    const { dataDir, first } = await imported();
    const dir = previewDir(dataDir, first.preview.id);
    const chunk = join(dir, 'region-0.json');
    const bytes = Buffer.from(readFileSync(chunk));
    bytes[30] = bytes[30]! ^ 0x01;
    writeFileSync(chunk, bytes);
    const port = await start(dataDir);
    expect((await get(port, `/map-data/v1/preview/${first.preview.id}/region-0.json`)).status).toBe(404);
    expect((await get(port, `/map-data/v1/preview/${first.preview.id}/world.json`)).status).toBe(404);
  });
});

const HOUR = 3_600_000;
const CAPITAL = '900000000000000001';
const TOWN = '900000000000000002';
const VILLAGE = '900000000000000003';

function withhold(dataDir: string, ids: string[]): void {
  mkdirSync(join(dataDir, 'moderation'), { recursive: true });
  const path = join(dataDir, WITHHELD_FILE);
  writeFileSync(`${path}.tmp`, JSON.stringify({ version: 1, updatedAt: sweepAt(20), kingdomIds: ids }));
  renameSync(`${path}.tmp`, path);
}

describe('names projection (R16)', () => {
  it('serves each drawn holding\'s login and name with its freshness, revalidated on every use', async () => {
    const { dataDir, first } = await imported();
    const port = await start(dataDir, { now: () => sweepAt(12) });
    const url = `/map-data/v1/preview/${first.preview.id}/names`;
    const response = await get(port, url);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-cache');
    const names = ServedNamesSchema.parse(JSON.parse(response.text));
    expect(names).toEqual({
      version: 1, kind: 'chatdom-atlas-survey-preview-served-names', preview: first.preview.id, servedAt: sweepAt(12), withheld: [],
      ids: [CAPITAL, TOWN, VILLAGE], logins: ['fixture_capital', 'fixture_town', 'fixture_village'],
      names: ['Fixture Capital', 'フィクスチャ町', 'Fixture Village'],
      freshUntil: Array(3).fill(sweepAt(12) + 24 * HOUR),
    });
    expect(response.text).not.toContain('fixture_small');
    const etag = response.headers.etag as string;
    expect((await get(port, url, { headers: { 'if-none-match': etag } })).status).toBe(304);
    const gzipped = await get(port, url, { headers: { 'accept-encoding': 'gzip' } });
    expect(gunzipSync(gzipped.body).toString('utf8')).toBe(response.text);
  });

  it('continues serving names when the survey facts are more than a day old', async () => {
    const { dataDir, first } = await imported();
    // The town was last confirmed at sweep 2, the others at sweep 4.
    const port = await start(dataDir, { now: () => sweepAt(3) + 24 * HOUR });
    const names = ServedNamesSchema.parse(JSON.parse((await get(port, `/map-data/v1/preview/${first.preview.id}/names`)).text));
    expect(names.ids).toEqual([CAPITAL, TOWN, VILLAGE]);
    expect(names.withheld).toEqual([]);
    expect(names.logins).toContain('fixture_town');
    expect(names.freshUntil).toEqual(Array(3).fill(sweepAt(3) + 48 * HOUR));

    const later = await start(dataDir, { now: () => sweepAt(5) + 24 * HOUR });
    expect(ServedNamesSchema.parse(JSON.parse((await get(later, `/map-data/v1/preview/${first.preview.id}/names`)).text)).ids).toEqual([CAPITAL, TOWN, VILLAGE]);
  });

  it('withholds a hidden channel at the next request, without reasons, and restores it when lifted', async () => {
    const { dataDir, first } = await imported();
    const port = await start(dataDir, { now: () => sweepAt(12) });
    const url = `/map-data/v1/preview/${first.preview.id}/names`;
    const before = await get(port, url);
    expect(ServedNamesSchema.parse(JSON.parse(before.text)).ids).toContain(VILLAGE);

    withhold(dataDir, [VILLAGE]);
    const after = await get(port, url, { headers: { 'if-none-match': before.headers.etag as string } });
    expect(after.status).toBe(200);
    const names = ServedNamesSchema.parse(JSON.parse(after.text));
    expect(names.withheld).toEqual([VILLAGE]);
    expect(names.ids).toEqual([CAPITAL, TOWN]);
    expect(after.text).not.toMatch(/fixture_village|Fixture Village|hidden|banned|reason/);
    // Immutable geometry is untouched: the land stays where it was, drawn bare.
    expect((await get(port, `/map-data/v1/preview/${first.preview.id}/world.json`)).status).toBe(200);

    withhold(dataDir, []);
    expect(ServedNamesSchema.parse(JSON.parse((await get(port, url)).text)).ids).toEqual([CAPITAL, TOWN, VILLAGE]);
  });

  it('refuses every name while the withheld list is unreadable, rather than reviving a withheld channel', async () => {
    const { dataDir, first } = await imported();
    const port = await start(dataDir, { now: () => sweepAt(12) });
    const url = `/map-data/v1/preview/${first.preview.id}/names`;
    withhold(dataDir, [VILLAGE]);
    expect((await get(port, url)).status).toBe(200);
    writeFileSync(join(dataDir, WITHHELD_FILE), '{"version":1,"kingdomIds":[');
    const refused = await get(port, url);
    expect(refused).toMatchObject({ status: 503, text: '{"error":"names-unavailable"}' });
    expect(refused.headers['retry-after']).toBe('60');
    withhold(dataDir, [VILLAGE]);
    expect(ServedNamesSchema.parse(JSON.parse((await get(port, url)).text)).withheld).toEqual([VILLAGE]);
  });

  it('serves no names for a pruned or unknown preview, nor for names.json that fails its hash', async () => {
    const { dataDir, first, nextRevision } = await imported({ keepRevisions: 2 });
    const port = await start(dataDir, { now: () => sweepAt(60) });
    const firstUrl = `/map-data/v1/preview/${first.preview.id}/names`;
    expect((await get(port, firstUrl)).status).toBe(200);
    await nextRevision(sweepAt(30));
    const third = await nextRevision(sweepAt(50));
    expect(await get(port, firstUrl)).toMatchObject({ status: 404, text: NOT_FOUND });
    expect((await get(port, '/map-data/v1/preview/pv-20200101T000000Z-000000000000/names')).status).toBe(404);
    expect((await get(port, `/map-data/v1/preview/${third.preview.id}/names.json`)).status).toBe(404);

    const path = join(previewDir(dataDir, third.preview.id), 'names.json');
    writeFileSync(path, readFileSync(path, 'utf8').replace('Fixture Capital', 'Fixture Capitol'));
    const fresh = await start(dataDir, { now: () => sweepAt(60) });
    expect((await get(fresh, `/map-data/v1/preview/${third.preview.id}/names`)).status).toBe(404);
  });

  it('keeps a gambling channel off the land and out of the names, however large its audience', async () => {
    const source = FixtureSource.standard();
    source.addChannel({ id: '900000000000000005', login: 'fixture_slots', name: 'Fixture Slots', firstSweep: 0, lastSweep: 4, live: true, liveMin: 15, viewerMin: 300_000, game: ['498566', 'Slots'] });
    const dataDir = tempDataDir();
    cleanup.push(() => source.close(), () => rmSync(dataDir, { recursive: true, force: true }));
    const outcome = published(await runImport(configFor(source, dataDir), {
      fetchImpl: fakeSurveyor({ status: source.status(), 'raids/recent': RECENT }).fetchImpl, now: clock(sweepAt(10)),
    }));
    const port = await start(dataDir, { now: () => sweepAt(12) });
    const pointer = JSON.parse((await get(port, '/map-data/v1/preview')).text) as Pointer;
    const world = PreviewWorldSchema.parse(JSON.parse((await get(port, pointer.world.url)).text));
    expect(world.counts).toMatchObject({ mapped: 3, capital: 1 });
    expect(world.policy).toEqual({ gambling: 'gambling-categories-1', excludedGambling: 1 });
    expect(world.games.map((g) => g.gameId)).not.toContain('498566');
    const names = await get(port, `/map-data/v1/preview/${outcome.preview.id}/names`);
    expect(names.text).not.toMatch(/fixture_slots|900000000000000005/);
  });
});
