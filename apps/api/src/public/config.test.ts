import { describe, expect, it } from 'vitest';
import { readPublicConfig } from './config';

const REPO = '/srv/chatdom';
const BASE = { PUBLIC_KINGDOMS: '1001:tobi4s_' };
const read = (env: Record<string, string | undefined>) => readPublicConfig({ ...BASE, ...env }, REPO);

/** Expects the config to refuse, naming the problem without ever repeating what was set. */
function refuses(env: Record<string, string | undefined>, secret: string, expected: RegExp) {
  let message = '';
  try { readPublicConfig(env, REPO); } catch (error) { message = error instanceof Error ? error.message : String(error); }
  expect(message).toMatch(expected);
  expect(message).not.toContain(secret);
}

describe('the public server settings', () => {
  it('starts from loopback defaults and supervises its own realm', () => {
    // The realm serves its rooms at its root; the web app reaches them under /live-realm-data.
    const config = read({});
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(5175);
    expect(config.proto).toBe('http');
    expect(config.webRoot).toBe('/srv/chatdom/apps/web/dist');
    expect(config.realm).toEqual({
      mode: 'spawn', target: { name: 'PUBLIC_REALM_TARGET', host: '127.0.0.1', port: 5173, strip: '/live-realm-data' }, entry: '/srv/chatdom/apps/realm/dist/realm.mjs',
    });
    expect(config.optional).toEqual({ herald: null, map: null, forge: null });
    expect(config.extension).toBeNull();
  });

  it('takes the host, port and web root it is given, resolving relative roots against the repo', () => {
    expect(read({ PUBLIC_HOST: '0.0.0.0', PUBLIC_PORT: '5180', PUBLIC_WEB_ROOT: 'build/web' })).toMatchObject({
      host: '0.0.0.0', port: 5180, webRoot: '/srv/chatdom/build/web',
    });
    expect(read({ PUBLIC_WEB_ROOT: '/opt/web' }).webRoot).toBe('/opt/web');
  });

  it('refuses a port that is not a TCP port', () => {
    for (const value of ['0', '70000', 'abc', '5175.5']) refuses({ ...BASE, PUBLIC_PORT: value }, value, /PUBLIC_PORT must be a TCP port/);
  });

  it('needs at least one front-door kingdom, listed as <channel id>:<login>', () => {
    expect(read({ PUBLIC_KINGDOMS: ' 1001:tobi4s_ , 2002:wren_tarn ,' }).doorKingdoms).toEqual([
      { kingdomId: '1001', login: 'tobi4s_' }, { kingdomId: '2002', login: 'wren_tarn' },
    ]);
    expect(() => readPublicConfig({}, REPO)).toThrow(/PUBLIC_KINGDOMS must name at least one kingdom/);
    expect(() => readPublicConfig({ PUBLIC_KINGDOMS: ' , ' }, REPO)).toThrow(/PUBLIC_KINGDOMS must name at least one kingdom/);
    for (const value of ['secret-login', '0123:tobi4s_', '1001:Tobi4s', '1001:', ':tobi4s_', '1001:tobi4s_:extra', 'abc:tobi4s_']) {
      refuses({ PUBLIC_KINGDOMS: `1001:tobi4s_,${value}` }, value, /PUBLIC_KINGDOMS must list kingdoms as <channel id>:<login>/);
    }
  });

  it('keeps a supervised realm on a port in 5170–5199', () => {
    expect(read({ REALM_PORT: '5170' }).realm.target.port).toBe(5170);
    expect(read({ REALM_PORT: '5199' }).realm.target.port).toBe(5199);
    for (const value of ['5169', '5200', '80', 'realm', '5180.5']) refuses({ ...BASE, REALM_PORT: value }, value, /REALM_PORT must be a port in 5170–5199/);
  });

  it('uses an already-running realm when PUBLIC_REALM_TARGET names one', () => {
    const config = read({ PUBLIC_REALM_TARGET: ' http://10.0.0.5:7000 ', REALM_PORT: '9999' });
    // The supervised port is irrelevant then: no realm is spawned.
    expect(config.realm.mode).toBe('proxy');
    expect(config.realm.target).toEqual({ name: 'PUBLIC_REALM_TARGET', host: '10.0.0.5', port: 7000, strip: '/live-realm-data' });
    for (const value of ['https://realm.example:7000', 'http://10.0.0.5', 'http://10.0.0.5:7000/path', 'realm-host-secret']) {
      refuses({ ...BASE, PUBLIC_REALM_TARGET: value }, value, /PUBLIC_REALM_TARGET must be an http:\/\/host:port address/);
    }
  });

  it('wires the optional services with their public prefixes', () => {
    const config = read({ PUBLIC_HERALD_TARGET: 'http://127.0.0.1:5177', PUBLIC_MAP_TARGET: 'http://127.0.0.1:5178', PUBLIC_FORGE_TARGET: ' ' });
    expect(config.optional).toEqual({
      herald: { name: 'PUBLIC_HERALD_TARGET', host: '127.0.0.1', port: 5177, strip: '/presence-data' },
      map: { name: 'PUBLIC_MAP_TARGET', host: '127.0.0.1', port: 5178, strip: '/map-data' },
      forge: null,
    });
    refuses({ ...BASE, PUBLIC_MAP_TARGET: 'ftp://maps-secret:21' }, 'maps-secret', /PUBLIC_MAP_TARGET must be an http:\/\/host:port address/);
  });

  it('needs the extension id and secret as a pair', () => {
    expect(read({ TWITCH_EXTENSION_CLIENT_ID: ' abc123 ', TWITCH_EXTENSION_SECRET: ' c2VjcmV0 ' }).extension).toEqual({ clientId: 'abc123', secret: 'c2VjcmV0' });
    expect(read({ TWITCH_EXTENSION_CLIENT_ID: ' ', TWITCH_EXTENSION_SECRET: '' }).extension).toBeNull();
    refuses({ ...BASE, TWITCH_EXTENSION_CLIENT_ID: 'client-id-value' }, 'client-id-value', /Set both TWITCH_EXTENSION_CLIENT_ID and TWITCH_EXTENSION_SECRET, or neither/);
    refuses({ ...BASE, TWITCH_EXTENSION_SECRET: 'super-secret-value' }, 'super-secret-value', /Set both TWITCH_EXTENSION_CLIENT_ID and TWITCH_EXTENSION_SECRET, or neither/);
  });

  it('tells the realm the scheme visitors use, from the public origin', () => {
    expect(read({ REALM_PUBLIC_ORIGIN: 'https://chatdom.io' }).proto).toBe('https');
    expect(read({ REALM_PUBLIC_ORIGIN: 'http://localhost:5175' }).proto).toBe('http');
  });
});
