import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KingdomIdSchema, type AtlasRaid } from '@chatdom/shared';
import { RoadLedger } from './ledger';
import { ROAD_PAGE_MAX_BYTES, pullRoadPage, roadFeedSource, roadFeedUrl } from './pull';
import { backfillRoads } from './backfill';
import { createRoadRuntime } from './runtime';
import { runImport } from '../import';
import { sha256 } from '../export/project';
import { layout, readCurrent, revisionDir } from '../store/revisions';
import { FixtureSource, RECENT, clock, configFor, fakeSurveyor } from '../test/fixture-source';

const dirs: string[] = [];
const ledgers: RoadLedger[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), 'road-sources-')); dirs.push(d); return d; };
const open = (d: string) => { const l = new RoadLedger(d); ledgers.push(l); return l; };
const close = (l: RoadLedger) => { l.close(); ledgers.splice(ledgers.indexOf(l), 1); };
const endpoint = roadFeedUrl('https://example.test/realm/raid-roads');
const signal = () => new AbortController().signal;
const time = 1_700_000_000_000;
const raid = (id: string, extra: Partial<AtlasRaid> = {}): AtlasRaid => ({ version: 1, id, fromKingdomId: KingdomIdSchema.parse('100'), toKingdomId: KingdomIdSchema.parse('200'), viewers: 25, observedAt: time, occurredAt: time, evidence: { kind: 'observed', asOf: time }, source: 'herald', delivery: 'resumable', ...extra });
const page = (items: unknown[], next: string | null) => ({ version: 1, items, next });
const response = (value: unknown): typeof fetch => async () => Response.json(value);
afterEach(() => { for (const l of ledgers.splice(0)) l.close(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('road source ingestion', () => {
  it('validates the entire page before storing any item', async () => {
    const l = open(dir());
    for (const bad of [raid('bad', { source: 'surveyor-recorder' }), raid('bad', { source: 'simulation', evidence: { kind: 'simulated', asOf: time, label: 'SIMULATED' } }), { ...raid('bad'), extra: true }]) {
      await expect(pullRoadPage(l, endpoint, signal(), response(page([raid('good'), bad], 'next')))).rejects.toThrow();
      expect(l.roads()).toHaveLength(0);
      expect(l.checkpoint(roadFeedSource(endpoint))).toBeNull();
    }
    await expect(pullRoadPage(l, endpoint, signal(), response({ ...page([raid('good')], 'next'), extra: 1 }))).rejects.toThrow();
    expect(l.roads()).toHaveLength(0);
  });
  it('rejects malformed endpoint, repeated IDs, nonadvancing cursors and oversized bodies', async () => {
    for (const url of ['ftp://example.test/realm/raid-roads', 'https://u:p@example.test/realm/raid-roads', 'https://example.test/realm/raid-roads?x=1', 'https://example.test/other']) expect(() => roadFeedUrl(url)).toThrow();
    const l = open(dir());
    for (const body of [page([raid('same'), raid('same')], 'next'), page([raid('one')], null), page([], 'new')]) await expect(pullRoadPage(l, endpoint, signal(), response(body))).rejects.toThrow();
    await expect(pullRoadPage(l, endpoint, signal(), async () => new Response('x'.repeat(ROAD_PAGE_MAX_BYTES + 1)))).rejects.toThrow('byte limit');
    await expect(pullRoadPage(l, endpoint, signal(), async () => new Response('{}', { headers: { 'content-length': String(ROAD_PAGE_MAX_BYTES + 1) } }))).rejects.toThrow('byte limit');
    expect(l.roads()).toHaveLength(0);
  });
  it('persists tail cursor through restart, empty and short pages, and namespaces changed URLs', async () => {
    const d = dir(); let l = open(d);
    await pullRoadPage(l, endpoint, signal(), response(page([raid('late', { occurredAt: time + 1000 }), raid('early')], 'tail')));
    close(l); l = open(d);
    const requests: string[] = [];
    const fetcher: typeof fetch = async input => { requests.push(String(input)); return Response.json(page([], 'tail')); };
    await pullRoadPage(l, endpoint, signal(), fetcher);
    expect(new URL(requests[0]!).searchParams.get('after')).toBe('tail');
    await pullRoadPage(l, endpoint, signal(), response(page([raid('third')], 'tail2')));
    expect(l.checkpoint(roadFeedSource(endpoint))).toBe('tail2');
    const other = roadFeedUrl('https://other.test/realm/raid-roads');
    await pullRoadPage(l, other, signal(), async input => { expect(new URL(String(input)).searchParams.has('after')).toBe(false); return Response.json(page([], null)); });
    expect(l.road('100', '200')?.raids).toBe(3);
  });
  it('retries a partially appended page without double counting or losing its tail cursor', async () => {
    const l = open(dir()); const controller = new AbortController();
    const interrupted = vi.spyOn(l, 'observeBatch').mockImplementation((items) => {
      l.observe(items[0], { recovered: true });
      controller.abort();
      throw controller.signal.reason;
    });
    const body = page([raid('first'), raid('second')], 'tail');
    await expect(pullRoadPage(l, endpoint, controller.signal, response(body))).rejects.toThrow();
    expect(l.checkpoint(roadFeedSource(endpoint))).toBeNull();
    interrupted.mockRestore();
    expect(await pullRoadPage(l, endpoint, signal(), response(body))).toMatchObject({ stored: 1, duplicates: 1, cursor: 'tail' });
    expect(l.road('100', '200')?.raids).toBe(2);
  });
  it('backfills a published recorder revision exactly once', async () => {
    const d = dir(); const source = FixtureSource.standard();
    try {
      const result = await runImport(configFor(source, d), { fetchImpl: fakeSurveyor({ status: source.status(), 'raids/recent': RECENT }).fetchImpl, now: clock(), sleep: async () => {} });
      expect(result.ok).toBe(true);
      const l = open(d); const first = await backfillRoads(d, l, signal());
      expect(first.stored).toBe(3);
      expect(first.revision).toBeTruthy();
      expect(await backfillRoads(d, l, signal())).toEqual({ revision: first.revision, stored: 0, duplicates: 0 });
      expect(l.checkpoint('surveyor-recorder')).toBe(first.revision);
    } finally { source.close(); }
  });
  it.each(['late malformed record', 'byte hash mismatch'])('rejects %s before any backfill writes', async (damage) => {
    const d = dir(); const source = FixtureSource.standard();
    try {
      const result = await runImport(configFor(source, d), { fetchImpl: fakeSurveyor({ status: source.status(), 'raids/recent': RECENT }).fetchImpl, now: clock(), sleep: async () => {} });
      if (!result.ok) throw new Error(result.error.message);
      const pointer = readCurrent(d)!;
      const manifestPath = join(revisionDir(d, pointer.revision), 'import.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const path = join(revisionDir(d, pointer.revision), manifest.files.raidObservations.path);
      const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
      if (damage === 'late malformed record') {
        lines[lines.length - 1] = JSON.stringify({ ...JSON.parse(lines.at(-1)!), unexpected: true });
        const bytes = Buffer.from(lines.join('\n') + '\n');
        writeFileSync(path, bytes);
        manifest.files.raidObservations.bytes = bytes.length;
        manifest.files.raidObservations.sha256 = sha256(bytes);
        const manifestBytes = JSON.stringify(manifest);
        writeFileSync(manifestPath, manifestBytes);
        writeFileSync(layout(d).current, JSON.stringify({ ...pointer, manifestSha256: sha256(manifestBytes) }));
      } else {
        const record = JSON.parse(lines.at(-1)!);
        record.raid.viewers = record.raid.viewers === 1 ? 2 : 1;
        const changed = JSON.stringify(record);
        // Keep the JSON valid and its byte count unchanged, isolating the hash check.
        expect(changed.length).toBe(lines.at(-1)!.length);
        lines[lines.length - 1] = changed; writeFileSync(path, lines.join('\n') + '\n');
      }
      const l = open(d);
      const attempt = backfillRoads(d, l, signal());
      if (damage === 'late malformed record') await expect(attempt).rejects.toMatchObject({ issues: [expect.objectContaining({ code: 'unrecognized_keys', keys: ['unexpected'] })] });
      else await expect(attempt).rejects.toThrow('Recorder backfill hash/length/count mismatch.');
      expect(l.roads()).toHaveLength(0);
      expect(l.checkpoint('surveyor-recorder')).toBeNull();
    } finally { source.close(); }
  });
  it('retries an interrupted published backfill and leaves its source file untouched', async () => {
    const d = dir(); const source = FixtureSource.standard();
    try {
      const result = await runImport(configFor(source, d), { fetchImpl: fakeSurveyor({ status: source.status(), 'raids/recent': RECENT }).fetchImpl, now: clock(), sleep: async () => {} });
      if (!result.ok) throw new Error(result.error.message);
      const path = join(revisionDir(d, result.revision), result.manifest.files.raidObservations.path);
      const before = statSync(path); const bytes = readFileSync(path);
      const l = open(d); const controller = new AbortController(); const observeBatch = l.observeBatch.bind(l);
      const abortReason = new Error('caller stopped backfill');
      const interrupted = vi.spyOn(l, 'observeBatch').mockImplementation((...args) => { const receipts = observeBatch(...args); controller.abort(abortReason); return receipts; });
      await expect(backfillRoads(d, l, controller.signal)).rejects.toBe(abortReason);
      expect(l.checkpoint('surveyor-recorder')).toBeNull();
      interrupted.mockRestore();
      expect(await backfillRoads(d, l, signal())).toMatchObject({ revision: result.revision, stored: 0, duplicates: 3 });
      expect(l.checkpoint('surveyor-recorder')).toBe(result.revision);
      expect(readFileSync(path)).toEqual(bytes);
      const after = statSync(path);
      expect({ size: after.size, mtimeMs: after.mtimeMs, mode: after.mode }).toEqual({ size: before.size, mtimeMs: before.mtimeMs, mode: before.mode });
    } finally { source.close(); }
  });
  it('classifies an HTTP failure without leaking source details and recovers on a good page', async () => {
    const d = dir(); const logs: string[] = []; let calls = 0;
    const runtime = createRoadRuntime(d, { feedUrl: endpoint.href, pollMs: 10, timeoutMs: 1000, fetch: async () => {
      calls++;
      return calls === 1 ? new Response('secret response content', { status: 503 }) : Response.json(page([], null));
    } }, line => logs.push(line));
    try {
      await vi.waitFor(() => expect(runtime.status()).toBe('connected'), { timeout: 2000, interval: 10 });
      expect(calls).toBeGreaterThanOrEqual(2);
      expect(logs).toContain('roads unavailable (raid-show:http-503)');
      expect(logs).toContain('roads connected');
      expect(logs.join(' ')).not.toContain('secret response content');
      expect(logs.join(' ')).not.toContain(endpoint.href);
    } finally { await runtime.close(); }
  });
  it('runs one poll at a time, aborts an in-flight fetch, closes idempotently and releases the ledger', async () => {
    const d = dir(); let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; }); let calls = 0; let aborted = false;
    const runtime = createRoadRuntime(d, { feedUrl: endpoint.href, pollMs: 10, timeoutMs: 1000, fetch: async (_input, init) => { calls++; started(); return new Promise<Response>((_resolve, reject) => { init!.signal!.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true }); }); } });
    await ready; await new Promise(resolve => setTimeout(resolve, 50)); expect(calls).toBe(1);
    const first = runtime.close(); expect(runtime.close()).toBe(first); await first;
    expect(aborted).toBe(true); expect(runtime.status()).toBe('stopped');
    const reopened = open(d); expect(reopened.roads()).toHaveLength(0);
  });
});
