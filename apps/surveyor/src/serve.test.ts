import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { rmSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { PublicSurveySchema } from './export/public';
import { runImport } from './import';
import { createAtlasService, projectNames, type AtlasService } from './serve';
import { PreviewNamesSchema, ServedNamesSchema } from './preview/schema';
import { layout } from './store/revisions';
import { FixtureSource, RECENT, clock, configFor, fakeSurveyor, sweepAt, tempDataDir } from './test/fixture-source';
import { allowRealImports } from './test/timeouts';

allowRealImports();

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

async function start(dataDir: string): Promise<{ service: AtlasService; port: number }> {
  const service = createAtlasService(dataDir);
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => service.close());
  return { service, port: (service.server.address() as AddressInfo).port };
}

/** Raw request, so paths like /map-data/../x reach the server unnormalised. */
function get(port: number, path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: init.method ?? 'GET', headers: init.headers ?? {} }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function imported() {
  const source = FixtureSource.standard();
  const dataDir = tempDataDir();
  cleanup.push(() => source.close(), () => rmSync(dataDir, { recursive: true, force: true }));
  const importNow = async (at: number) => runImport(configFor(source, dataDir), {
    fetchImpl: fakeSurveyor({ status: source.status(), 'raids/recent': RECENT }).fetchImpl, now: clock(at),
  });
  const first = await importNow(sweepAt(10));
  if (!first.ok) throw new Error(first.error.message);
  return { source, dataDir, first, importNow };
}

describe('atlas:serve', () => {
  it('keeps day-old names served while withholding still removes the channel name', () => {
    const now = Date.UTC(2026, 10, 1), day = 86_400_000;
    const projected = projectNames(PreviewNamesSchema.parse({
      version: 1, kind: 'chatdom-atlas-survey-preview-names',
      preview: 'pv-20261101T000000Z-aaaaaaaaaaaa', revision: 'obs-20261101T000000Z-aaaaaaaaaaaa',
      ids: ['1', '2'], logins: ['returning_citizen', 'withheld_citizen'], names: ['Returning Citizen', 'Withheld Citizen'],
      factsAt: [now - day - 1, now - day - 1],
    }), new Set(['2']), now);
    const served = ServedNamesSchema.parse(projected.served);
    expect(served.ids).toEqual(['1']);
    expect(served.names).toEqual(['Returning Citizen']);
    expect(served.freshUntil).toEqual([now + day]);
    expect(served.withheld).toEqual(['2']);
    expect(JSON.stringify(served)).not.toContain('withheld_citizen');
  });

  it('serves the public survey of the current revision, without source paths or rows', async () => {
    const { dataDir, first } = await imported();
    const { port } = await start(dataDir);
    const response = await get(port, '/map-data/v1/survey');
    expect(response.status).toBe(200);
    expect(response.headers.etag).toBe(`"${first.revision}"`);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    const survey = PublicSurveySchema.parse(JSON.parse(response.body));
    expect(survey).toMatchObject({ revision: first.revision, asOf: sweepAt(4), founding: { status: 'not-founded' } });
    expect(response.body).not.toContain(dataDir);
    expect(response.body).not.toContain('surveyor.db');
    expect(response.body).not.toContain('surveyor.test');
    expect(response.body).not.toContain('fixture_capital');
    expect((await get(port, '/map-data/v1/survey', { headers: { 'if-none-match': `"${first.revision}"` } })).status).toBe(304);
    expect(await get(port, '/map-data/v1/health')).toMatchObject({ status: 200 });
  });

  it('answers only its fixed routes and methods, with bounded inputs', async () => {
    const { dataDir } = await imported();
    const { port } = await start(dataDir);
    for (const path of ['/map-data/../current.json', '/map-data/v1/survey/../../current.json', '/map-data/%2e%2e/ledger/imports.ndjson',
      '/map-data/v1/../../revisions', '/current.json', '/map-data/v1/survey.json', '/map-data/v1/sql?q=select']) {
      const response = await get(port, path);
      expect(response.status, path).toBe(404);
      expect(response.body).toBe('{"error":"not-found"}');
    }
    expect((await get(port, '/map-data/v1/survey', { method: 'POST' })).status).toBe(405);
    expect((await get(port, '/map-data/v1/survey', { method: 'DELETE' })).headers.allow).toBe('GET, HEAD');
    expect((await get(port, `/map-data/v1/survey?${'q'.repeat(300)}`)).status).toBe(414);
    expect((await get(port, `/map-data/${'a'.repeat(3000)}`)).status).toBe(414);
    const head = await get(port, '/map-data/v1/survey', { method: 'HEAD' });
    expect(head).toMatchObject({ status: 200, body: '' });
  });

  it('switches to a newly published revision and keeps the last good one through a broken swap', async () => {
    const { source, dataDir, first, importNow } = await imported();
    const { port, service } = await start(dataDir);
    expect(service.revision()).toBe(first.revision);

    source.addSweeps(1);
    source.db.prepare('UPDATE channels SET last_live = ? WHERE live = 1').run(sweepAt(5));
    const second = await importNow(sweepAt(30));
    if (!second.ok) throw new Error(second.error.message);
    expect(JSON.parse((await get(port, '/map-data/v1/survey')).body)).toMatchObject({ revision: second.revision, asOf: sweepAt(5) });

    writeFileSync(layout(dataDir).current, '{"version":1,"revision":"not-a-revision"');
    const kept = await get(port, '/map-data/v1/survey');
    expect(kept.status).toBe(200);
    expect(JSON.parse(kept.body)).toMatchObject({ revision: second.revision });
  });

  it('reports a designed unavailable state before any import', async () => {
    const dataDir = tempDataDir();
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    const { port } = await start(dataDir);
    expect(await get(port, '/map-data/v1/survey')).toMatchObject({ status: 503, body: '{"error":"no-revision"}' });
    expect(await get(port, '/map-data/v1/health')).toMatchObject({ status: 503 });
  });
});
