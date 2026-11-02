import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runImport } from '../import';
import { WITHHELD_FILE } from '../policy/visibility';
import { createAtlasService, type AtlasService } from '../serve';
import { FixtureSource, RECENT, clock, configFor, fakeSurveyor, sweepAt, tempDataDir } from '../test/fixture-source';
import { allowRealImports } from '../test/timeouts';
import { loadDirectory } from './directory';
import { LookupUnavailable, type TwitchChannelFacts, type TwitchLookup } from './twitch-lookup';

allowRealImports();
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });
const NOW = sweepAt(12);
const FACTS: TwitchChannelFacts = {
  id: '818181818181', login: 'offmapfixture', name: 'Offmap Fixture', avatarUrl: null,
  language: 'en', gameId: null, game: null, title: null, live: false, viewers: null,
  startedAt: null, fetchedAt: NOW,
};

function http(port: number, path: string, options: { method?: string; forwarded?: string } = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: options.method ?? 'GET',
      headers: options.forwarded ? { 'x-forwarded-for': options.forwarded } : {} }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function start(dataDir: string, lookup: TwitchLookup, trustLoopbackProxy = false): Promise<{ service: AtlasService; port: number }> {
  const service = createAtlasService(dataDir, () => {}, { now: () => NOW, twitchLookup: lookup, trustLoopbackProxy });
  await new Promise<void>(resolve => service.server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => service.close());
  return { service, port: (service.server.address() as AddressInfo).port };
}

it('projects fallback over HTTP, preserves old replies and rechecks privacy across pending lookups and restarts', async () => {
  const source = FixtureSource.standard();
  const dataDir = tempDataDir();
  cleanup.push(() => source.close(), () => rmSync(dataDir, { recursive: true, force: true }));
  const outcome = await runImport(configFor(source, dataDir), {
    fetchImpl: fakeSurveyor({ status: source.status(), 'raids/recent': RECENT }).fetchImpl, now: clock(sweepAt(10)),
  });
  if (!outcome.ok) throw new Error(outcome.error.message);
  const base = `/map-data/v1/preview/${outcome.preview.id}`;
  const calls: string[] = [];
  let resolveSlow: ((value: TwitchChannelFacts[]) => void) | undefined;
  let slowStarted: (() => void) | undefined;
  const started = new Promise<void>(resolve => { slowStarted = resolve; });
  const lookup: TwitchLookup = {
    lookup: async query => {
      calls.push(query);
      if (query === 'slowfixture') {
        slowStarted?.();
        return new Promise(resolve => { resolveSlow = resolve; });
      }
      if (query === 'disabledfixture') throw new LookupUnavailable('disabled');
      return query === FACTS.login || query === `id:${FACTS.id}` ? [{ ...FACTS }] : [];
    },
    close: () => {},
  };
  const first = await start(dataDir, lookup, true);
  const read = async (path: string, forwarded = '192.0.2.1') => http(first.port, base + path, { forwarded });

  const old = await read('/card/login/fixture_capital');
  const oldCard = JSON.parse(old.body);
  expect(old.status).toBe(200);
  expect(oldCard).not.toHaveProperty('position');
  expect(oldCard).not.toHaveProperty('portrait');
  expect((await read('/search?q=fixture_capital&lookup=1')).status).toBe(200);
  expect(calls).toEqual([]);
  expect((await read(`/card/${FACTS.id}`)).status).toBe(404);
  expect(calls).toEqual([]);

  const search = JSON.parse((await read(`/search?q=${FACTS.login}&lookup=1&portraits=1`)).body);
  expect(search.results).toHaveLength(1);
  expect(search.results[0]).toMatchObject({ channel: { id: FACTS.id, login: FACTS.login, place: 'waiting' }, average: null, portrait: null, position: { x: expect.any(Number), y: expect.any(Number) } });
  const card = JSON.parse((await read(`/card/login/${FACTS.login}?lookup=1&portraits=1`)).body);
  expect(card).toMatchObject({ channel: { id: FACTS.id }, average: null, firstSeenAt: null, lastLiveAt: null, roads: null, position: search.results[0].position });
  const direct = (await loadDirectory(dataDir, outcome.preview.id)).external(FACTS, new Set(), NOW, true);
  expect(card.position).toEqual(direct?.position);
  expect((await read('/search?q=missingfixture&lookup=1')).body).toContain('"results":[]');
  expect(JSON.parse((await read('/search?q=disabledfixture&lookup=1')).body)).toMatchObject({ results: [], unavailable: 'disabled' });
  expect((await http(first.port, base + '/search?q=fixture&lookup=1', { method: 'POST' })).status).toBe(405);

  const pending = read('/search?q=slowfixture&lookup=1', '192.0.2.2');
  await started;
  mkdirSync(join(dataDir, 'moderation'), { recursive: true });
  const file = join(dataDir, WITHHELD_FILE);
  writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, updatedAt: NOW, kingdomIds: [FACTS.id] }));
  renameSync(`${file}.tmp`, file);
  resolveSlow?.([FACTS]);
  const changedGate = await pending;
  expect(changedGate.status).toBe(503);
  expect(JSON.parse(changedGate.body)).toEqual({ error: 'names-unavailable' });
  expect(changedGate.body).not.toContain(FACTS.name);
  expect((await read(`/card/${FACTS.id}?lookup=1`, '192.0.2.3')).status).toBe(404);
  rmSync(file);

  // A restart: the first process lets go of the data directory (one writer holds the road ledger) before the next.
  await first.service.close();
  const second = await start(dataDir, lookup, true);
  const restarted = await http(second.port, `${base}/card/${FACTS.id}?lookup=1`);
  expect(restarted.status).toBe(200);
  expect(JSON.parse(restarted.body).position).toEqual(card.position);

  // Survey hits do not spend the allowance; separate trusted forwarded clients receive separate allowances.
  for (let i = 0; i < 6; i++) expect((await http(second.port, `${base}/card/login/absent${i}?lookup=1`, { forwarded: '192.0.2.20' })).status).toBe(404);
  expect((await http(second.port, `${base}/card/login/absent6?lookup=1`, { forwarded: '192.0.2.20' })).status).toBe(429);
  expect((await http(second.port, `${base}/card/login/absent7?lookup=1`, { forwarded: '192.0.2.21' })).status).toBe(404);
  await second.service.close();
  const untrusted = await start(dataDir, lookup);
  for (let i = 0; i < 6; i++) expect((await http(untrusted.port, `${base}/card/login/absent${i}?lookup=1`, { forwarded: `192.0.2.${i + 30}` })).status).toBe(404);
  expect((await http(untrusted.port, `${base}/card/login/absent6?lookup=1`, { forwarded: '192.0.2.99' })).status).toBe(429);
});
