import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runImport } from '../import';
import { createAtlasService } from '../serve';
import { readWithheldList } from '../edition/commands';
import { FixtureSource, RECENT, clock, configFor, fakeSurveyor, sweepAt, tempDataDir } from '../test/fixture-source';
import { allowRealImports } from '../test/timeouts';
import { appendOwnerAct, ownerHiddenKey, ownerVisibilityPath, parseOwnerHidden, readOwnerHidden, type OwnerVisibilityLine } from './owner-hide';
import { readWithheldIds, WITHHELD_FILE, withheldReader } from './visibility';

allowRealImports();

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

const CAPITAL = '900000000000000001';
const TOWN = '900000000000000002';
const VILLAGE = '900000000000000003';
const NOW = sweepAt(12);
const TOKEN = 'session-authority-token-0123456789';

const line = (kingdomId: string, act: 'hide' | 'show', at = NOW): OwnerVisibilityLine =>
  ({ version: 1, kind: 'chatdom-atlas-owner-visibility', kingdomId: kingdomId as OwnerVisibilityLine['kingdomId'], act, at, receivedAt: at });

function withhold(dataDir: string, ids: string[]): void {
  mkdirSync(join(dataDir, 'moderation'), { recursive: true });
  const path = join(dataDir, WITHHELD_FILE);
  writeFileSync(`${path}.tmp`, JSON.stringify({ version: 1, updatedAt: sweepAt(20), kingdomIds: ids }));
  renameSync(`${path}.tmp`, path);
}

describe('the owner visibility log', () => {
  it('keeps each channel’s latest act, ignores a torn tail and refuses a damaged line', () => {
    const text = [line(TOWN, 'hide'), line(VILLAGE, 'hide'), line(TOWN, 'show')].map((l) => JSON.stringify(l)).join('\n');
    expect([...parseOwnerHidden(`${text}\n`)]).toEqual([VILLAGE]);
    expect([...parseOwnerHidden(`${text}\n{"version":1,"kind":"chatdom-at`)]).toEqual([VILLAGE]);
    expect(() => parseOwnerHidden(`{"broken"\n${text}\n`)).toThrow(/line 1/);
    expect(ownerHiddenKey(new Set())).toBe('');
    expect(ownerHiddenKey(new Set([TOWN, VILLAGE]))).toBe(ownerHiddenKey(new Set([VILLAGE, TOWN])));
  });

  it('records an act durably once, answers unchanged for a repeat, and cuts an unacknowledged tail', () => {
    const dataDir = tempDataDir();
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    expect(appendOwnerAct(dataDir, line(TOWN, 'show'), new Set())).toBe('unchanged');
    expect(appendOwnerAct(dataDir, line(TOWN, 'hide'), new Set())).toBe('recorded');
    expect(appendOwnerAct(dataDir, line(TOWN, 'hide'), readOwnerHidden(dataDir))).toBe('unchanged');
    writeFileSync(ownerVisibilityPath(dataDir), '{"torn', { flag: 'a' });
    expect(appendOwnerAct(dataDir, line(TOWN, 'show'), readOwnerHidden(dataDir))).toBe('recorded');
    expect(readOwnerHidden(dataDir).size).toBe(0);
    expect(readFileSync(ownerVisibilityPath(dataDir), 'utf8').split('\n').filter(Boolean)).toHaveLength(2);
  });

  it('joins the operator’s list in every reader, and showing lifts only the owner’s own hide', () => {
    const dataDir = tempDataDir();
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    const reader = withheldReader(dataDir);
    const before = reader.current();
    expect(before.key).toBe('none');
    withhold(dataDir, [VILLAGE]);
    appendOwnerAct(dataDir, line(TOWN, 'hide'), new Set());
    appendOwnerAct(dataDir, line(VILLAGE, 'hide'), new Set([TOWN]));
    const both = reader.current();
    expect([...both.ids].sort()).toEqual([TOWN, VILLAGE]);
    expect([...both.operator]).toEqual([VILLAGE]);
    expect([...both.owner].sort()).toEqual([TOWN, VILLAGE]);
    expect([...readWithheldIds(dataDir)].sort()).toEqual([TOWN, VILLAGE]);
    const founding = readWithheldList(dataDir);
    expect('ids' in founding && [...founding.ids].sort()).toEqual([TOWN, VILLAGE]);
    expect('key' in founding && founding.key).toMatch(/^sha256:[0-9a-f]{64}\+owner:[0-9a-f]{16}$/);
    // The owner of a channel the operator withholds shows it again: still withheld.
    appendOwnerAct(dataDir, line(VILLAGE, 'show'), reader.current().owner);
    appendOwnerAct(dataDir, line(TOWN, 'show'), reader.current().owner);
    const after = reader.current();
    expect([...after.ids]).toEqual([VILLAGE]);
    expect(after.owner.size).toBe(0);
    expect(after.key).not.toBe(both.key);
    // A damaged log fails closed for runs that cannot fall back, and keeps the last good set for the server.
    writeFileSync(ownerVisibilityPath(dataDir), 'garbage\n', { flag: 'a' });
    expect(() => readWithheldIds(dataDir)).toThrow(/owner visibility/);
    expect(reader.current()).toMatchObject({ error: expect.stringMatching(/owner visibility unreadable/) });
    expect([...reader.current().ids]).toEqual([VILLAGE]);
  });
});

function call(port: number, path: string, init: { method?: string; body?: string; token?: string | null } = {}): Promise<{ status: number; text: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.token !== null) headers.authorization = `Bearer ${init.token ?? TOKEN}`;
    const req = request({ host: '127.0.0.1', port, path, method: init.method ?? 'GET', headers }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (chunk: Buffer) => parts.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(parts).toString('utf8'), headers: res.headers }));
    });
    req.on('error', reject);
    req.end(init.body);
  });
}

async function served(ingestToken: string | null = TOKEN) {
  const source = FixtureSource.standard();
  source.addRaidPair(CAPITAL, TOWN, 2, 300, sweepAt(3));
  const dataDir = tempDataDir();
  cleanup.push(() => source.close(), () => rmSync(dataDir, { recursive: true, force: true }));
  const outcome = await runImport(configFor(source, dataDir), { fetchImpl: fakeSurveyor({ status: source.status(), 'raids/recent': RECENT }).fetchImpl, now: clock(sweepAt(10)) });
  if (!outcome.ok) throw new Error(outcome.error.message);
  const service = createAtlasService(dataDir, () => {}, { now: () => NOW, twitchLookup: null, ingestToken });
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => service.ingest.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => service.close());
  return {
    dataDir, preview: outcome.preview.id,
    pub: (service.server.address() as AddressInfo).port,
    priv: (service.ingest.address() as AddressInfo).port,
  };
}

const act = (port: number, id: string, verb: 'hide' | 'unhide', token?: string | null) =>
  call(port, `/v1/channels/${id}/${verb}`, { method: 'POST', body: JSON.stringify({ version: 1, at: NOW }), ...(token !== undefined ? { token } : {}) });

describe('a streamer hides their own channel', () => {
  it('is gone from names, search, cards and roads at the next read, and back after showing it', async () => {
    const s = await served();
    const base = `/map-data/v1/preview/${s.preview}`;
    const names = async () => JSON.parse((await call(s.pub, `${base}/names`)).text) as { withheld: string[]; ids: string[]; logins: string[] };
    const capitalRoads = async () => JSON.parse((await call(s.pub, `${base}/card/${CAPITAL}`)).text).roads.strongest.map((r: { other: { id: string; name: string | null } }) => r.other);
    expect((await names()).ids).toContain(TOWN);
    expect((await capitalRoads()).find((o: { id: string }) => o.id === TOWN)).toMatchObject({ name: expect.any(String) });

    const hidden = await act(s.priv, TOWN, 'hide');
    expect(hidden.status).toBe(200);
    expect(JSON.parse(hidden.text)).toEqual({ kind: 'hidden', kingdomId: TOWN, changed: true, hidden: true, onMap: false });
    expect(hidden.headers['cache-control']).toBe('no-store');
    // Drawn bare like any withheld holding: listed, unnamed, unfindable, without a card, unnamed on every road.
    const after = await names();
    expect(after.withheld).toContain(TOWN);
    expect(after.ids).not.toContain(TOWN);
    expect(after.logins).not.toContain('fixture_town');
    expect(JSON.parse((await call(s.pub, `${base}/search?q=fixture`)).text).results.map((r: { channel: { id: string } }) => r.channel.id)).not.toContain(TOWN);
    expect((await call(s.pub, `${base}/card/${TOWN}`)).status).toBe(404);
    expect((await call(s.pub, `${base}/card/login/fixture_town`)).status).toBe(404);
    expect(JSON.stringify(await capitalRoads())).not.toMatch(/fixture_town|Fixture Town/i);
    expect((await call(s.pub, `${base}/road/login/fixture_capital/fixture_town`)).status).toBe(404);
    expect([...readWithheldIds(s.dataDir)]).toEqual([TOWN]);

    // Pressed twice: nothing new is written.
    expect(JSON.parse((await act(s.priv, TOWN, 'hide')).text)).toMatchObject({ changed: false, hidden: true });
    // The broadcaster still sees their own card, privately, as the map would draw it without the hide.
    const own = JSON.parse((await call(s.priv, `/v1/channels/${TOWN}/visibility?preview=${s.preview}`)).text);
    expect(own).toMatchObject({ kind: 'owner-visibility', kingdomId: TOWN, preview: s.preview, hidden: true, onMap: false, card: { channel: { id: TOWN, login: 'fixture_town' } } });

    const shown = await act(s.priv, TOWN, 'unhide');
    expect(JSON.parse(shown.text)).toEqual({ kind: 'shown', kingdomId: TOWN, changed: true, hidden: false, onMap: true });
    expect((await names()).ids).toContain(TOWN);
    expect((await call(s.pub, `${base}/card/login/fixture_town`)).status).toBe(200);
    expect(JSON.parse((await call(s.priv, `/v1/channels/${TOWN}/visibility`)).text)).toMatchObject({ hidden: false, onMap: true, card: null });
  });

  it('never outranks the operator’s list', async () => {
    const s = await served();
    withhold(s.dataDir, [TOWN]);
    expect(JSON.parse((await act(s.priv, TOWN, 'hide')).text)).toMatchObject({ hidden: true, onMap: false });
    // While the operator holds it, not even its owner gets the card back from the private side.
    expect(JSON.parse((await call(s.priv, `/v1/channels/${TOWN}/visibility`)).text)).toMatchObject({ hidden: true, onMap: false, card: null });
    expect(JSON.parse((await act(s.priv, TOWN, 'unhide')).text)).toMatchObject({ changed: true, hidden: false, onMap: false });
    expect((await call(s.pub, `/map-data/v1/preview/${s.preview}/card/${TOWN}`)).status).toBe(404);
  });

  it('answers only the session authority, on the private listener only', async () => {
    const s = await served();
    expect(await act(s.priv, TOWN, 'hide', null)).toMatchObject({ status: 401 });
    expect(await act(s.priv, TOWN, 'hide', 'not-the-token')).toMatchObject({ status: 401 });
    expect((await call(s.priv, `/v1/channels/${TOWN}/visibility`, { token: 'not-the-token' })).status).toBe(401);
    expect((await call(s.priv, `/v1/channels/${TOWN}/hide`)).status).toBe(405);
    expect((await call(s.priv, `/v1/channels/${TOWN}/visibility`, { method: 'POST', body: '{}' })).status).toBe(405);
    expect(await call(s.priv, `/v1/channels/${TOWN}/hide`, { method: 'POST', body: '{"version":1,"at":1,"kingdomId":"1"}' })).toMatchObject({ status: 422, text: '{"kind":"invalid","reason":"schema"}' });
    expect(await call(s.priv, `/v1/channels/${TOWN}/hide`, { method: 'POST', body: 'nope' })).toMatchObject({ status: 422 });
    expect((await call(s.priv, `/v1/channels/0${TOWN}/hide`, { method: 'POST', body: '{}' })).status).toBe(404);
    // The public server never routes them.
    expect((await call(s.pub, `/v1/channels/${TOWN}/hide`, { method: 'POST', body: JSON.stringify({ version: 1, at: NOW }) })).status).toBeGreaterThanOrEqual(400);
    expect(readOwnerHidden(s.dataDir).size).toBe(0);
  });

  it('is not offered at all by a service without a token', async () => {
    const s = await served(null);
    expect(await act(s.priv, TOWN, 'hide', null)).toMatchObject({ status: 503, text: '{"kind":"not-configured"}' });
    expect(readOwnerHidden(s.dataDir).size).toBe(0);
  });
});
