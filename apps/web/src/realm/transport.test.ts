import { expect, it } from 'vitest';
import { createRealmNetwork, realmProxyUrl } from './transport';

it('keeps matchmaking, reconnect and public-address socket URLs on the realm proxy mount', () => {
  const endpoint = 'http://localhost:5190/live-realm-data';
  for (const path of ['/matchmake/joinOrCreate/kingdom', '/matchmake/reconnect/k:129634568']) {
    expect(realmProxyUrl(endpoint, new URL(`http://localhost:5190${path}`)).pathname).toBe(`/live-realm-data${path}`);
    expect(realmProxyUrl(endpoint, new URL(`http://localhost:5190/live-realm-data${path}`)).pathname).toBe(`/live-realm-data${path}`);
  }
  expect(realmProxyUrl(endpoint, new URL('ws://internal:5197/process/k:129634568?sessionId=opaque')).toString())
    .toBe('ws://localhost:5190/live-realm-data/process/k:129634568?sessionId=opaque');
  expect(realmProxyUrl('https://chatdom.gg/live-realm-data', new URL('ws://internal:5197/process/room')).protocol).toBe('wss:');
});

it('names the actual SDK step when a proxy returns HTML or malformed JSON', async () => {
  for (const [body, type, reason] of [['<!doctype html><title>Chatdom</title>', 'text/html', 'text/html; expected JSON'], ['Colyseus 0.18.23', 'application/json', 'with invalid JSON']]) {
    const requests: string[] = [];
    const network = createRealmNetwork('http://localhost:5190/live-realm-data', async input => {
      requests.push(String(input)); return new Response(body, { status: 200, headers: { 'Content-Type': type! } });
    });
    await expect(network.joinOrCreate('kingdom', {})).rejects.toThrow(`Joining the kingdom (/live-realm-data/matchmake/joinOrCreate/kingdom) returned HTTP 200 ${reason}`);
    expect(requests).toEqual(['http://localhost:5190/live-realm-data/matchmake/joinOrCreate/kingdom']);
    await expect(network.reconnect('k:129634568:opaque-token')).rejects.toThrow('Reconnecting to the kingdom (/live-realm-data/matchmake/reconnect/k:129634568)');
  }
});
