// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DOOR_ROUTE, kingdomOf, parseFoundedKingdoms, readFoundedKingdoms } from './kingdoms';

const LIVE = { version: 1, mode: 'live', kingdoms: [{ kingdomId: '129634568', name: 'Willowmere', login: 'tobi4s_' }] };

describe('the founded kingdoms', () => {
  it('reads the door’s live list by channel ID', () => {
    const kingdoms = parseFoundedKingdoms(LIVE);
    expect([...kingdoms.values()]).toEqual([{ kingdomId: '129634568', name: 'Willowmere', login: 'tobi4s_' }]);
    expect(kingdomOf(kingdoms, { id: '129634568', login: 'tobi4s_' })?.name).toBe('Willowmere');
    expect(kingdomOf(kingdoms, { id: '129634568', login: null })).toBeNull();
    expect(kingdomOf(kingdoms, { id: '1', login: 'tobi4s_' })).toBeNull();
  });

  it('names no kingdom from a simulated door, and skips anything malformed', () => {
    expect(parseFoundedKingdoms({ ...LIVE, mode: 'simulated' }).size).toBe(0);
    expect(parseFoundedKingdoms(null).size).toBe(0);
    expect(parseFoundedKingdoms({ mode: 'live', kingdoms: 'x' }).size).toBe(0);
    const mixed = parseFoundedKingdoms({ mode: 'live', kingdoms: [
      { kingdomId: '0123', name: 'Leading zero', login: 'a' },
      { kingdomId: '5', name: '  ', login: 'b' },
      { kingdomId: '6', name: 'Upper', login: 'NotALogin' },
      { kingdomId: '7', name: 'x'.repeat(81), login: 'c' },
      { kingdomId: '8', name: '  Emberwick ', login: 'd_8' },
      null,
    ] });
    expect([...mixed.values()]).toEqual([{ kingdomId: '8', name: 'Emberwick', login: 'd_8' }]);
  });

  it('asks the site’s own door, and names none when it cannot be read', async () => {
    const asked: string[] = [];
    const ok = await readFoundedKingdoms(undefined, (async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify(LIVE), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);
    expect(asked).toEqual([DOOR_ROUTE]);
    expect(ok.get('129634568')?.name).toBe('Willowmere');
    const page = await readFoundedKingdoms(undefined, (async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })) as typeof fetch);
    expect(page.size).toBe(0);
    const refused = await readFoundedKingdoms(undefined, (async () => new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })) as typeof fetch);
    expect(refused.size).toBe(0);
    const down = await readFoundedKingdoms(undefined, (async () => { throw new TypeError('offline'); }) as typeof fetch);
    expect(down.size).toBe(0);
  });
});
