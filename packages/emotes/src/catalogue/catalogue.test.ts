import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KingdomIdSchema } from '../deps';
import { createEmoteImageDecoder } from '../decode/index';
import { toadWaveGifBytes } from '../fixtures/toad-wave-animated';
import { sha256Hex } from '../sha256';
import { createMemoryEmoteBlobStore, EmoteBlobError } from './blobs';
import { createCheckedEmoteTransport, type PinnedGet } from './checked-transport';
import { checkAssetUrl, isPublicAddress } from './policy';
import { catalogueHealth, createEmoteCatalogueRefresher, createKingdomJobLimiter, type EmoteRefreshInput } from './refresh';
import { createThirdPartyEmoteAdapter, parseBttv, parseFfz, parseSevenTv } from './third-party';
import { createTwitchEmoteAdapter, parseTwitchChannelEmotes } from './twitch';
import { EmoteTransportError, type AuthorizedEmoteTransport } from './types';

const KINGDOM = KingdomIdSchema.parse('900000001');
const TEMPLATE = 'https://static-cdn.jtvnw.net/emoticons/v2/{{id}}/{{format}}/{{theme_mode}}/{{scale}}';
const PNG = new Uint8Array(readFileSync(new URL('../decode/testdata/png/rgb8.png', import.meta.url)));
const PNG_B = new Uint8Array(readFileSync(new URL('../decode/testdata/png/la8.png', import.meta.url)));
const GIF = toadWaveGifBytes();

const twitchItem = (id: string, name: string, animated: boolean) => ({
  id, name, images: {}, tier: '1000', emote_type: 'subscriptions', emote_set_id: '1',
  format: animated ? ['static', 'animated'] : ['static'], scale: ['1.0', '2.0', '3.0'], theme_mode: ['light', 'dark'],
});
const assetOf = (id: string, animated: boolean) => `https://static-cdn.jtvnw.net/emoticons/v2/${id}/${animated ? 'animated' : 'static'}/dark/3.0`;

describe('Twitch Get Channel Emotes', () => {
  it('builds addresses from the template and documented formats, never by renaming a file', () => {
    const result = parseTwitchChannelEmotes({ data: [twitchItem('emotesv2_b', 'toadWave', true), twitchItem('300', 'toadSit', false)], template: TEMPLATE });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.entries.map(e => [e.id, e.rendition, e.asset])).toEqual([
      ['twitch.300', 'png', assetOf('300', false)],
      ['twitch.emotesv2_b', 'gif', assetOf('emotesv2_b', true)],
    ]);
  });

  it('treats a malformed envelope as an outage and an empty list as an observed empty catalogue', () => {
    expect(parseTwitchChannelEmotes({ error: 'nope' })).toMatchObject({ status: 'unavailable', reason: 'malformed' });
    expect(parseTwitchChannelEmotes({ data: [twitchItem('1', 'a', false)], template: 'https://evil.example/{{id}}/{{format}}/{{theme_mode}}/{{scale}}' })).toMatchObject({ status: 'unavailable', reason: 'malformed' });
    expect(parseTwitchChannelEmotes({ data: [], template: '' })).toMatchObject({ status: 'ok', entries: [] });
  });

  it('skips unsafe items with a reason and caps the list at 256', () => {
    const data = [{ ...twitchItem('../../x', 'bad', false) }, { ...twitchItem('7', 'two words', false) }, ...Array.from({ length: 300 }, (_, i) => twitchItem(String(1000 + i), `e${i}`, false))];
    const result = parseTwitchChannelEmotes({ data, template: TEMPLATE });
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.entries.length).toBe(256);
    expect(result.truncated).toBe(true);
    expect(result.skipped.map(s => s.reason)).toEqual(['the emote ID is not a safe token', 'the emote has no usable name']);
  });
});

describe('Third-party catalogues (shapes checked 2026-10-31)', () => {
  it('7TV prefers animated WebP, skips overlays and sensitive flags, keeps the artist privately', () => {
    const file = (name: string, format: string, size = 1000) => ({ name, static_name: name, width: 32, height: 32, frame_count: 10, size, format });
    const parsed = parseSevenTv({ emote_set: { emotes: [
      { id: '01G3WEGZN0000ET2J0MQP5YJ0G', name: 'GAMBA', flags: 0, data: { flags: 0, listed: true, animated: true, owner: { id: 'u1', display_name: 'Artist' },
        host: { url: '//cdn.7tv.app/emote/01G3WEGZN0000ET2J0MQP5YJ0G', files: [file('1x.webp', 'WEBP'), file('4x.webp', 'WEBP'), file('4x.gif', 'GIF'), file('4x.avif', 'AVIF')] } } },
      { id: '01ZEROWIDTH0000000000000000', name: 'RainTime', flags: 1, data: { flags: 256, animated: true, host: { url: '//cdn.7tv.app/emote/01ZEROWIDTH0000000000000000', files: [file('4x.webp', 'WEBP')] } } },
      { id: '01EDGY000000000000000000000', name: 'edgy', flags: 0, data: { flags: 1 << 18, animated: false, host: { url: '//cdn.7tv.app/emote/01EDGY000000000000000000000', files: [file('4x.png', 'PNG')] } } },
      { id: '01STILL00000000000000000000', name: 'still', flags: 0, data: { flags: 0, animated: false, host: { url: '//cdn.7tv.app/emote/01STILL00000000000000000000', files: [file('4x.webp', 'WEBP'), file('3x.png', 'PNG'), file('4x.png', 'PNG', 9_000_000)] } } },
    ] } });
    expect(parsed!.entries.map(e => [e.name, e.rendition, e.asset, e.owner?.name])).toEqual([
      ['GAMBA', 'webp', 'https://cdn.7tv.app/emote/01G3WEGZN0000ET2J0MQP5YJ0G/4x.webp', 'Artist'],
      ['still', 'png', 'https://cdn.7tv.app/emote/01STILL00000000000000000000/3x.png', undefined],
    ]);
    expect(parsed!.skipped.length).toBe(2);
    expect(parseSevenTv({ emote_set: null })).toEqual({ entries: [], skipped: [] });
  });

  it('BTTV reads channel and shared emotes and uses `animated`, not the deprecated image type', () => {
    const parsed = parseBttv({ channelEmotes: [{ id: '6027ea208fbb823604bde323', code: 'YESIDOTHINKSOr', imageType: 'png', animated: true, userId: '5559' }],
      sharedEmotes: [{ id: '579f9ac281108bf71a550e97', code: 'MegaLUL', imageType: 'png', animated: false, user: { id: '5565', name: 'con', displayName: 'Con' } }] });
    expect(parsed!.entries.map(e => [e.name, e.rendition, e.asset])).toEqual([
      ['YESIDOTHINKSOr', 'webp', 'https://cdn.betterttv.net/emote/6027ea208fbb823604bde323/3x.webp'],
      ['MegaLUL', 'png', 'https://cdn.betterttv.net/emote/579f9ac281108bf71a550e97/3x.png'],
    ]);
  });

  it('FFZ follows the animated map only when sent and skips modifiers and hidden emotes', () => {
    const parsed = parseFfz({ room: { set: 1 }, sets: { 1: { emoticons: [
      { id: 246878, name: 'WideHard', urls: { 1: 'https://cdn.frankerfacez.com/emote/246878/1', 4: 'https://cdn.frankerfacez.com/emote/246878/4' }, owner: { _id: 5, display_name: 'Maker' } },
      { id: 720564, name: 'Dance', urls: { 1: 'https://cdn.frankerfacez.com/emote/720564/1' }, animated: { 1: 'https://cdn.frankerfacez.com/emote/720564/animated/1', 2: 'https://cdn.frankerfacez.com/emote/720564/animated/2' } },
      { id: 9, name: 'Hidden', modifier_flags: 1, urls: { 1: 'https://cdn.frankerfacez.com/emote/9/1' } },
      { id: 10, name: 'Elsewhere', urls: { 1: 'https://evil.example/emote/10/1' } },
    ] } } });
    expect(parsed!.entries.map(e => [e.name, e.rendition, e.asset, e.owner?.name])).toEqual([
      ['WideHard', 'png', 'https://cdn.frankerfacez.com/emote/246878/4', 'Maker'],
      ['Dance', 'webp', 'https://cdn.frankerfacez.com/emote/720564/animated/2.webp', undefined],
    ]);
    expect(parsed!.skipped.map(s => s.name)).toEqual(['Hidden', 'Elsewhere']);
  });

  it('a 404 for the channel is an observed empty catalogue; other failures are outages', async () => {
    const transport = (error: Error): AuthorizedEmoteTransport => ({ getHelix: async () => ({}), getProviderCatalogue: async () => { throw error; }, getAsset: async () => new Uint8Array() });
    const signal = new AbortController().signal;
    expect(await createThirdPartyEmoteAdapter('bttv', transport(new EmoteTransportError('not-found', 'user not found'))).fetchCatalogue({ kingdomId: KINGDOM, channelId: '42' }, signal)).toMatchObject({ status: 'ok', entries: [] });
    expect(await createThirdPartyEmoteAdapter('ffz', transport(new EmoteTransportError('timeout', 'slow'))).fetchCatalogue({ kingdomId: KINGDOM, channelId: '42' }, signal)).toMatchObject({ status: 'unavailable', reason: 'timeout' });
  });
});

/** A scripted host: answers per provider, counts calls and tracks concurrent asset fetches. */
function scriptedTransport() {
  const state = {
    helix: { data: [] as unknown[], template: TEMPLATE } as unknown,
    helixError: null as Error | null,
    providers: {} as Record<string, unknown>,
    assets: new Map<string, Uint8Array | Error>(),
    calls: { helix: 0, provider: 0, asset: 0 },
    concurrent: 0, maxConcurrent: 0,
    gate: null as Promise<void> | null,
  };
  const transport: AuthorizedEmoteTransport = {
    async getHelix() { state.calls.helix++; await state.gate; if (state.helixError) throw state.helixError; return state.helix; },
    async getProviderCatalogue(provider) { state.calls.provider++; const body = state.providers[provider]; if (body instanceof Error) throw body; return body; },
    async getAsset(_provider, url) {
      state.calls.asset++; state.concurrent++; state.maxConcurrent = Math.max(state.maxConcurrent, state.concurrent);
      await new Promise(resolve => setTimeout(resolve, 2));
      state.concurrent--;
      const bytes = state.assets.get(url);
      if (!bytes) throw new EmoteTransportError('not-found', 'no such image');
      if (bytes instanceof Error) throw bytes;
      return bytes.slice();
    },
  };
  return { state, transport };
}

function refresher(transport: AuthorizedEmoteTransport) {
  const blobs = createMemoryEmoteBlobStore();
  const adapters = [createTwitchEmoteAdapter(transport), createThirdPartyEmoteAdapter('7tv', transport), createThirdPartyEmoteAdapter('bttv', transport), createThirdPartyEmoteAdapter('ffz', transport)];
  return { blobs, refresher: createEmoteCatalogueRefresher({ transport, decoder: createEmoteImageDecoder(), blobs, adapters }) };
}
const off = { '7tv': false, bttv: false, ffz: false } as const;
const input = (atMs: number, previous: EmoteRefreshInput['previous'], thirdParty: EmoteRefreshInput['thirdParty'] = off): EmoteRefreshInput =>
  ({ kingdomId: KINGDOM, channelId: '123456', reason: 'daily', atMs, thirdParty, previous });

describe('Catalogue refresh and reconciliation', () => {
  it('walks a full provider change cycle: added, outage kept, changed, renamed, emptied', async () => {
    const { state, transport } = scriptedTransport(), { refresher: r, blobs } = refresher(transport), signal = new AbortController().signal;
    state.helix = { data: [twitchItem('emotesv2_wave', 'toadWave', true), twitchItem('300', 'toadSit', false)], template: TEMPLATE };
    state.assets.set(assetOf('emotesv2_wave', true), GIF).set(assetOf('300', false), PNG);

    const first = await r.refresh(input(1000, null), signal);
    expect(first.changes.added.sort()).toEqual(['twitch.300', 'twitch.emotesv2_wave']);
    expect(first.snapshot.providers.twitch!.health).toBe('current');
    const wave = first.snapshot.providers.twitch!.entries.find(e => e.id === 'twitch.emotesv2_wave')!;
    expect(wave).toMatchObject({ state: 'ready', sourceHash: sha256Hex(GIF), decoded: { width: 112, height: 112, frames: 8, periodMs: 1170 } });
    expect(await blobs.get(sha256Hex(GIF))).toEqual(GIF);
    expect(catalogueHealth(first.snapshot)).toBe('current');

    // Outage: Twitch times out. The last good catalogue stays, marked stale; nothing is removed.
    state.helixError = new EmoteTransportError('timeout', 'slow');
    const outage = await r.refresh(input(2000, first.snapshot), signal);
    expect(outage.snapshot.providers.twitch).toMatchObject({ health: 'stale', lastSuccessAt: 1000, problem: { reason: 'timeout' } });
    expect(outage.snapshot.providers.twitch!.entries).toEqual(first.snapshot.providers.twitch!.entries);
    expect(outage.changes.removed).toEqual([]);
    expect(catalogueHealth(outage.snapshot)).toBe('stale');

    // Back online: the still emote got new art, the animated one a new code with the same bytes.
    state.helixError = null;
    state.helix = { data: [twitchItem('emotesv2_wave', 'toadHello', true), twitchItem('300', 'toadSit', false)], template: TEMPLATE };
    state.assets.set(assetOf('300', false), PNG_B);
    const changed = await r.refresh(input(3000, outage.snapshot), signal);
    expect(changed.changes).toMatchObject({ added: [], changed: ['twitch.300'], renamed: ['twitch.emotesv2_wave'], removed: [] });
    expect(changed.snapshot.providers.twitch!.entries.find(e => e.id === 'twitch.300')!.sourceHash).toBe(sha256Hex(PNG_B));
    expect(changed.snapshot.revision).toBeGreaterThan(outage.snapshot.revision);

    // An observed, successful empty answer is a removal, unlike the outage above.
    state.helix = { data: [], template: TEMPLATE };
    const emptied = await r.refresh(input(4000, changed.snapshot), signal);
    expect(emptied.changes.removed.sort()).toEqual(['twitch.300', 'twitch.emotesv2_wave']);
    expect(emptied.snapshot.providers.twitch).toMatchObject({ health: 'current', entries: [] });
  });

  it('never contacts a disabled provider, and a 404 channel on an enabled one is empty, not an outage', async () => {
    const { state, transport } = scriptedTransport(), { refresher: r } = refresher(transport), signal = new AbortController().signal;
    const disabled = await r.refresh(input(1000, null), signal);
    expect(state.calls.provider).toBe(0);
    expect(disabled.requests.catalogues).toBe(1);
    expect(disabled.snapshot.providers['7tv']!.health).toBe('disabled');
    state.providers['7tv'] = new EmoteTransportError('not-found', 'user not found');
    state.providers.bttv = { channelEmotes: [{ id: '6027ea208fbb823604bde323', code: 'hop', animated: false, userId: '1' }], sharedEmotes: [] };
    state.assets.set('https://cdn.betterttv.net/emote/6027ea208fbb823604bde323/3x.png', PNG);
    const enabled = await r.refresh(input(2000, disabled.snapshot, { '7tv': true, bttv: true, ffz: false }), signal);
    expect(state.calls.provider).toBe(2);
    expect(enabled.snapshot.providers['7tv']).toMatchObject({ health: 'current', entries: [] });
    expect(enabled.changes.added).toEqual(['bttv.6027ea208fbb823604bde323']);
    // Switching BetterTTV off withdraws its emotes without fetching or calling them removed.
    const before = state.calls.provider;
    const withdrawn = await r.refresh(input(3000, enabled.snapshot, { '7tv': true, bttv: false, ffz: false }), signal);
    expect(state.calls.provider).toBe(before + 1);
    expect(withdrawn.changes).toMatchObject({ withdrawn: ['bttv.6027ea208fbb823604bde323'], removed: [] });
  });

  it('keeps a known image through an asset outage and refuses undecodable new bytes privately', async () => {
    const { state, transport } = scriptedTransport(), { refresher: r } = refresher(transport), signal = new AbortController().signal;
    state.helix = { data: [twitchItem('300', 'toadSit', false), twitchItem('emotesv2_wave', 'toadWave', true)], template: TEMPLATE };
    state.assets.set(assetOf('300', false), PNG).set(assetOf('emotesv2_wave', true), GIF);
    const first = await r.refresh(input(1000, null), signal);
    state.assets.set(assetOf('300', false), new EmoteTransportError('network', 'reset'));
    state.assets.set(assetOf('emotesv2_wave', true), new TextEncoder().encode('<svg onload="alert(1)"/>'));
    const second = await r.refresh(input(2000, first.snapshot), signal);
    const sit = second.snapshot.providers.twitch!.entries.find(e => e.id === 'twitch.300')!;
    const wave = second.snapshot.providers.twitch!.entries.find(e => e.id === 'twitch.emotesv2_wave')!;
    expect(sit).toMatchObject({ state: 'ready', sourceHash: sha256Hex(PNG), checkedAt: 1000 });
    expect(wave).toMatchObject({ state: 'unavailable', sourceHash: null, problem: { code: 'unsupported' } });
    expect(second.changes.unavailable).toEqual(['twitch.emotesv2_wave']);
  });

  it('refuses an animation that decodes to a single frame instead of showing its poster', async () => {
    const { state, transport } = scriptedTransport(), { refresher: r } = refresher(transport);
    state.helix = { data: [twitchItem('emotesv2_flat', 'flat', true)], template: TEMPLATE };
    state.assets.set(assetOf('emotesv2_flat', true), PNG);
    const result = await r.refresh(input(1000, null), new AbortController().signal);
    // The bytes are a PNG while the provider documents a GIF: refused before decoding.
    expect(result.snapshot.providers.twitch!.entries[0]).toMatchObject({ state: 'unavailable', problem: { code: 'unsupported' } });
  });

  it('coalesces overlapping refreshes per kingdom and runs at most two source jobs at once', async () => {
    const { state, transport } = scriptedTransport(), { refresher: r } = refresher(transport), signal = new AbortController().signal;
    state.helix = { data: Array.from({ length: 6 }, (_, i) => twitchItem(String(100 + i), `e${i}`, false)), template: TEMPLATE };
    for (let i = 0; i < 6; i++) state.assets.set(assetOf(String(100 + i), false), PNG);
    let open!: () => void;
    state.gate = new Promise(resolve => { open = resolve; });
    const a = r.refresh(input(1000, null), signal), b = r.refresh({ ...input(1000, null), reason: 'go-live' }, signal);
    open();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe(rb);
    expect(state.calls.helix).toBe(1);
    expect(state.maxConcurrent).toBeLessThanOrEqual(2);
    expect(state.calls.asset).toBe(6);
  });

  it('a limiter slot is released when a queued job is cancelled', async () => {
    const limiter = createKingdomJobLimiter(1), controller = new AbortController();
    let release!: () => void;
    const first = limiter.run('k', () => new Promise<void>(resolve => { release = resolve; }));
    const queued = limiter.run('k', async () => 'never', controller.signal);
    controller.abort(new Error('stop'));
    await expect(queued).rejects.toThrow('stop');
    release(); await first;
    expect(limiter.active('k')).toBe(0);
  });
});

describe('Network policy', () => {
  it('accepts only documented CDN renditions over plain HTTPS', () => {
    expect(checkAssetUrl('twitch', 'https://static-cdn.jtvnw.net/emoticons/v2/25/static/dark/3.0').ok).toBe(true);
    for (const bad of ['http://static-cdn.jtvnw.net/emoticons/v2/25/static/dark/3.0', 'https://static-cdn.jtvnw.net:8443/emoticons/v2/25/static/dark/3.0',
      'https://user:pw@static-cdn.jtvnw.net/emoticons/v2/25/static/dark/3.0', 'https://static-cdn.jtvnw.net/emoticons/v2/25/static/dark/3.0?x=1',
      'https://static-cdn.jtvnw.net.evil.example/emoticons/v2/25/static/dark/3.0', 'https://static-cdn.jtvnw.net/emoticons/v2/../../admin/static/dark/3.0',
      'https://cdn.7tv.app/emote/01ABC/4x.svg']) {
      expect(checkAssetUrl(bad.includes('7tv') ? '7tv' : 'twitch', bad).ok, bad).toBe(false);
    }
  });

  it('treats only globally routable unicast addresses as public', () => {
    for (const address of ['8.8.8.8', '151.101.1.1', '2606:4700::1111', '2a00:1450:4001:80b::200e']) expect(isPublicAddress(address), address).toBe(true);
    for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '198.18.0.1',
      '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:8.8.8.8', '64:ff9b::7f00:1', '2002:7f00:1::1', '2001:db8::1', '2001::1', 'ff02::1', 'not-an-ip']) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });
});

describe('Checked server transport', () => {
  function host(routes: Record<string, { status: number; headers?: Record<string, string>; body?: Uint8Array; chunks?: number }>, dns: Record<string, string[]>) {
    const seen: { url: string; address: string }[] = [];
    const get: PinnedGet = async ({ url, address }) => {
      seen.push({ url: url.href, address });
      const route = routes[url.href];
      if (!route) return { status: 404, headers: { get: () => null }, body: (async function* () { /* empty */ })(), cancel() {} };
      const body = route.body ?? new Uint8Array(), chunks = route.chunks ?? 1;
      return {
        status: route.status, headers: { get: (name: string) => route.headers?.[name.toLowerCase()] ?? null },
        body: (async function* () { for (let i = 0; i < chunks; i++) yield body; })(), cancel() {},
      };
    };
    const lookups: string[] = [];
    const transport = createCheckedEmoteTransport({
      get,
      resolve: async name => { lookups.push(name); const list = dns[name]; if (!list) throw new Error('NXDOMAIN'); return list.map(address => ({ address, family: address.includes(':') ? 6 as const : 4 as const })); },
      helixHeaders: async () => ({ 'Client-Id': 'test', Authorization: 'Bearer test' }),
    });
    return { transport, seen, lookups };
  }
  const A = 'https://static-cdn.jtvnw.net/emoticons/v2/25/static/dark/3.0';
  const signal = () => new AbortController().signal;
  const kind = async (promise: Promise<unknown>) => { try { await promise; return 'ok'; } catch (error) { return error instanceof EmoteTransportError ? error.kind : String(error); } };

  it('pins each hop to the address it checked', async () => {
    const { transport, seen } = host({ [A]: { status: 200, body: PNG } }, { 'static-cdn.jtvnw.net': ['151.101.2.2'] });
    expect(await transport.getAsset('twitch', A, signal())).toEqual(PNG);
    expect(seen).toEqual([{ url: A, address: '151.101.2.2' }]);
  });

  it('refuses private DNS answers, including a mix with public ones', async () => {
    expect(await kind(host({ [A]: { status: 200, body: PNG } }, { 'static-cdn.jtvnw.net': ['127.0.0.1'] }).transport.getAsset('twitch', A, signal()))).toBe('policy');
    expect(await kind(host({ [A]: { status: 200, body: PNG } }, { 'static-cdn.jtvnw.net': ['151.101.2.2', '10.0.0.5'] }).transport.getAsset('twitch', A, signal()))).toBe('policy');
  });

  it('re-checks every redirect against the same provider policy and re-resolves its host', async () => {
    const other = 'https://static-cdn.jtvnw.net/emoticons/v2/26/static/dark/3.0';
    const ok = host({ [A]: { status: 302, headers: { location: other } }, [other]: { status: 200, body: PNG } }, { 'static-cdn.jtvnw.net': ['151.101.2.2'] });
    expect(await ok.transport.getAsset('twitch', A, signal())).toEqual(PNG);
    expect(ok.lookups.length).toBe(2);
    const away = host({ [A]: { status: 301, headers: { location: 'https://169.254.169.254/latest/meta-data' } } }, { 'static-cdn.jtvnw.net': ['151.101.2.2'] });
    expect(await kind(away.transport.getAsset('twitch', A, signal()))).toBe('policy');
    expect(away.seen.length).toBe(1);
    const loop = host({ [A]: { status: 302, headers: { location: A } } }, { 'static-cdn.jtvnw.net': ['151.101.2.2'] });
    expect(await kind(loop.transport.getAsset('twitch', A, signal()))).toBe('policy');
  });

  it('counts streamed bytes instead of trusting Content-Length', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const liar = host({ [A]: { status: 200, headers: { 'content-length': '100' }, body: chunk, chunks: 5 } }, { 'static-cdn.jtvnw.net': ['151.101.2.2'] });
    expect(await kind(liar.transport.getAsset('twitch', A, signal()))).toBe('too-large');
  });

  it('maps statuses to typed failures and needs bound credentials for Helix', async () => {
    const { transport } = host({}, { 'static-cdn.jtvnw.net': ['151.101.2.2'], 'api.twitch.tv': ['151.101.3.3'], 'api.betterttv.net': ['151.101.4.4'] });
    expect(await kind(transport.getAsset('twitch', A, signal()))).toBe('not-found');
    expect(await kind(transport.getProviderCatalogue('bttv', '42', signal()))).toBe('not-found');
    expect(await kind(transport.getAsset('twitch', 'https://evil.example/x.png', signal()))).toBe('policy');
    const bare = createCheckedEmoteTransport({ get: async () => { throw new Error('unreachable'); }, resolve: async () => [] });
    expect(await kind(bare.getHelix('chat/emotes', { broadcaster_id: '1' }, signal()))).toBe('unavailable');
  });
});

describe('Content-addressed blobs', () => {
  it('verifies the address on write and bounds memory by bytes', async () => {
    const store = createMemoryEmoteBlobStore({ maxBytes: PNG.length + GIF.length, maxEntries: 8 });
    await expect(store.put(sha256Hex(GIF), PNG)).rejects.toBeInstanceOf(EmoteBlobError);
    await store.put(sha256Hex(PNG), PNG);
    await store.put(sha256Hex(GIF), GIF);
    await store.put(sha256Hex(PNG_B), PNG_B);
    expect(store.bytes).toBeLessThanOrEqual(PNG.length + GIF.length);
    expect(await store.get(sha256Hex(PNG))).toBeNull();
    expect(await store.get(sha256Hex(PNG_B))).toEqual(PNG_B);
  });
});
