import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { KingdomIdSchema } from '@chatdom/shared';
import { afterEach, expect, it } from 'vitest';
import { proxyHttp, parseTarget } from '../../../api/src/public/proxy';
import { classify } from '../../../api/src/public/routes';
import { DirectoryError, fetchCard, fetchSearch } from '../../../web/src/atlas/data/directory';
import type { PreviewSource } from '../../../web/src/atlas/data/preview';
import { runImport } from '../import';
import { appendOwnerAct } from '../policy/owner-hide';
import { WITHHELD_FILE } from '../policy/visibility';
import { createAtlasService, type AtlasService } from '../serve';
import { FixtureSource, RECENT, clock, configFor, fakeSurveyor, sweepAt, tempDataDir } from '../test/fixture-source';
import { allowRealImports } from '../test/timeouts';
import { loadDirectory } from './directory';
import type { TwitchChannelFacts, TwitchLookup } from './twitch-lookup';

/**
 * chatdom.io's path for a channel the survey never saw: the browser's own search and card readers, through the public
 * gateway's allowlist and proxy, to the Atlas service, which asks Twitch (mocked here). Nothing is invented, nothing
 * is stored, and a withheld or self-hidden channel stays hidden.
 */
allowRealImports();
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });
const NOW = sweepAt(12);

const twitchChannel = (id: string, login: string, game: string | null, live: boolean): TwitchChannelFacts => ({
  id, login, name: login, avatarUrl: `https://static-cdn.jtvnw.net/jtv_user_pictures/${login}-profile_image-300x300.png`,
  language: 'en', gameId: game ? '1469308723' : null, game, title: game ? 'Working on a PUG system' : null, live,
  viewers: live ? 2 : null, startedAt: live ? NOW - 600_000 : null, fetchedAt: NOW,
});
const SMALL = twitchChannel('129634568', 'smallstream_', 'Software and Game Development', false);
const WITHHELD = twitchChannel('424242424242', 'withheldstream', 'Just Chatting', true);
const HIDDEN = twitchChannel('525252525252', 'hiddenstream', 'Just Chatting', false);
const TWITCH = [SMALL, WITHHELD, HIDDEN];

function mockTwitch(calls: string[]): TwitchLookup {
  return {
    lookup: async query => {
      calls.push(query);
      const key = query.toLowerCase();
      return TWITCH.filter(channel => key === channel.login || key === `login:${channel.login}` || key === `id:${channel.id}`).map(channel => ({ ...channel }));
    },
    close: () => {},
  };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

/** The public gateway's routing for map data, exactly: its allowlist decides, its proxy forwards. */
async function gateway(atlasPort: number): Promise<number> {
  const target = parseTarget('PUBLIC_MAP_TARGET', `http://127.0.0.1:${atlasPort}`);
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://chatdom.test');
    const route = classify(url.pathname, url.search);
    if (route.kind === 'optional' && route.service === 'map') proxyHttp(target, request, response, 'https');
    else response.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"No such route"}');
  });
  cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  return listen(server);
}

async function atlas(dataDir: string, calls: string[], log: string[] = []): Promise<{ service: AtlasService; port: number }> {
  const service = createAtlasService(dataDir, line => log.push(line), {
    // As deployed: behind one gateway address every visitor shares a client allowance, so it is raised.
    now: () => NOW, twitchLookup: mockTwitch(calls), trustLoopbackProxy: true, warmRegister: true, lookupsPerClientMinute: 60,
  });
  cleanup.push(() => service.close());
  return { service, port: await listen(service.server) };
}

async function imported() {
  const source = FixtureSource.standard();
  const dataDir = tempDataDir();
  cleanup.push(() => source.close(), () => rmSync(dataDir, { recursive: true, force: true }));
  const outcome = await runImport(configFor(source, dataDir), {
    fetchImpl: fakeSurveyor({ status: source.status(), 'raids/recent': RECENT }).fetchImpl, now: clock(sweepAt(10)),
  });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return { dataDir, preview: outcome.preview.id };
}

async function until(test: () => boolean, ms = 10_000): Promise<void> {
  const end = performance.now() + ms;
  while (!test()) {
    if (performance.now() > end) throw new Error('timed out');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

it('finds a channel the survey never saw through the public routes, pencils it at one place and stores nothing', async () => {
  const { dataDir, preview } = await imported();
  const calls: string[] = [];
  const log: string[] = [];
  const first = await atlas(dataDir, calls, log);
  // The register of the served preview is read at start, before anybody searches.
  await until(() => log.some(line => line.startsWith(`register of ${preview}:`)));
  const source: PreviewSource = { base: `http://127.0.0.1:${await gateway(first.port)}/map-data`, fetch };

  const pointer = await (await fetch(`${source.base}/v1/preview`)).json() as { id: string };
  expect(pointer.id).toBe(preview);

  const search = await fetchSearch(source, preview, SMALL.login);
  expect(search.results).toHaveLength(1);
  const found = search.results[0]!;
  // It reads exactly like a mapped channel's row, placed by its ID, waiting for land, never a holding.
  expect(found).toMatchObject({ channel: { id: SMALL.id, login: SMALL.login, name: SMALL.login, place: 'waiting', tier: null, ordinal: null }, average: null, language: 'en' });
  expect(found.position).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  expect(found.portrait?.url).toBe(SMALL.avatarUrl);

  const byLogin = await fetchCard(source, preview, { login: SMALL.login });
  expect(byLogin).toMatchObject({ channel: { id: SMALL.id, place: 'waiting', tier: null }, average: null, roads: null, position: found.position });
  expect(byLogin.stream).toMatchObject({ live: false, game: 'Software and Game Development' });
  expect(byLogin.portrait?.url).toBe(SMALL.avatarUrl);
  const byId = await fetchCard(source, preview, { id: SMALL.id });
  expect(byId.position).toEqual(found.position);
  // One Twitch question for the search; the cards are served from that answer or one exact lookup each.
  expect(calls[0]).toBe(SMALL.login);

  // Twitch does not know it: nothing is invented, in search or card.
  expect((await fetchSearch(source, preview, 'nosuchstream_x')).results).toEqual([]);
  await expect(fetchCard(source, preview, { login: 'nosuchstream_x' })).rejects.toMatchObject({ reason: 'not-found' });
  await expect(fetchCard(source, preview, { id: '999999999999' })).rejects.toBeInstanceOf(DirectoryError);

  // Withheld by the operator, or hidden by its own streamer: Twitch knows them, the Atlas never shows them.
  mkdirSync(join(dataDir, 'moderation'), { recursive: true });
  const file = join(dataDir, WITHHELD_FILE);
  writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, updatedAt: NOW, kingdomIds: [WITHHELD.id] }));
  renameSync(`${file}.tmp`, file);
  appendOwnerAct(dataDir, { version: 1, kind: 'chatdom-atlas-owner-visibility', kingdomId: KingdomIdSchema.parse(HIDDEN.id), act: 'hide', at: NOW, receivedAt: NOW }, new Set());
  for (const channel of [WITHHELD, HIDDEN]) {
    const asked = calls.length;
    const reply = await fetch(`${source.base}/v1/preview/${preview}/search?q=${channel.login}&portraits=1&lookup=1`);
    const body = await reply.text();
    expect(calls.length).toBe(asked + 1);
    expect(JSON.parse(body)).toMatchObject({ results: [] });
    expect(JSON.parse(body)).not.toHaveProperty('unavailable');
    expect(body).not.toContain(channel.id);
    await expect(fetchCard(source, preview, { login: channel.login })).rejects.toMatchObject({ reason: 'not-found' });
    await expect(fetchCard(source, preview, { id: channel.id })).rejects.toMatchObject({ reason: 'not-found' });
  }

  // Nothing was stored: the register still does not hold it, and a restarted service places it at the same spot.
  expect((await loadDirectory(dataDir, preview)).has({ login: SMALL.login })).toBe(false);
  await first.service.close();
  const second = await atlas(dataDir, []);
  const again = await fetchCard({ base: `http://127.0.0.1:${await gateway(second.port)}/map-data`, fetch }, preview, { login: SMALL.login });
  expect(again).toMatchObject({ channel: { place: 'waiting', tier: null }, position: found.position });
});

it('admits every public route the search and the card read, and nothing private', () => {
  const pv = 'pv-20261102T125607Z-8887bf7756d2';
  const admitted = (path: string) => {
    const url = new URL(path, 'http://chatdom.test');
    const route = classify(url.pathname, url.search);
    return route.kind === 'optional' && route.service === 'map';
  };
  for (const path of [
    '/map-data/v1/preview',
    `/map-data/v1/preview/${pv}/world.json`,
    `/map-data/v1/preview/${pv}/names?part=head`,
    `/map-data/v1/preview/${pv}/search?q=tobi4s_&portraits=1&lookup=1`,
    `/map-data/v1/preview/${pv}/card/login/tobi4s_?portraits=1&lookup=1`,
    `/map-data/v1/preview/${pv}/card/129634568?portraits=1&lookup=1`,
    `/map-data/v1/roads/${pv}/channel/129634568`,
  ]) expect(admitted(path), path).toBe(true);
  for (const path of ['/map-data/v1/roads/observe', '/map-data/v1/channels/129634568/hide', '/v1/claims', `/map-data/v1/preview/${pv}/card/login/TOBI4S_..`]) {
    expect(admitted(path), path).toBe(false);
  }
});
