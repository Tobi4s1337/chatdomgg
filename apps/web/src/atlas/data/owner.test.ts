// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { OWNER_BASE, ownerAct, OwnerActError, ownSearchRow, readOwner, validateOwner, type OwnerState } from './owner';

const PREVIEW = 'pv-20261031T133817Z-9303798faebf';
const AT = Date.UTC(2026, 9, 31, 13, 38);
const ME = '129634568';
const CSRF = 'c'.repeat(43);
const coverage = { raidWatch: { enabled: true, watching: 7474, liveCandidates: 9000 }, contentLabels: 'not-collected' };
const card = (id = ME) => ({
  version: 1, preview: PREVIEW, revision: 'obs-20261031T133817Z-82eb04a53567', servedAt: AT, asOf: AT, kind: 'chatdom-atlas-card',
  channel: { id, login: 'tobi4s_', name: 'tobi4s_', freshUntil: AT + 86_400_000, place: 'waiting', ordinal: null, tier: null, region: 1, realm: 4 },
  position: { x: 120, y: 340 }, average: null, language: 'de', firstSeenAt: null, lastLiveAt: null, stream: null, roads: null, coverage,
});
const me = (over: Record<string, unknown> = {}) => ({ version: 1, status: 'broadcaster', channelId: ME, hidden: false, onMap: true, card: null, csrfToken: CSRF, ...over });

function answering(...replies: { status: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = replies.shift() ?? { status: 503, body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json; charset=utf-8' } });
  }) as typeof fetch;
  return { fetcher, calls };
}

describe('the signed-in broadcaster', () => {
  it('reads strictly: anything unexpected is nobody signed in', () => {
    expect(validateOwner(me(), PREVIEW)).toEqual({ status: 'broadcaster', channelId: ME, hidden: false, onMap: true, card: null, csrfToken: CSRF });
    for (const bad of [null, {}, { version: 1, status: 'anonymous' }, { version: 1, status: 'unavailable', channelId: ME }, me({ channelId: '01' }), me({ hidden: 'yes' }), me({ csrfToken: 'short' }), me({ version: 2 })]) {
      expect(validateOwner(bad, PREVIEW)).toEqual({ status: 'anonymous' });
    }
    // A hidden channel keeps its own card; a card of anyone else, of another map, or while shown is dropped.
    expect(validateOwner(me({ hidden: true, onMap: false, card: card() }), PREVIEW)).toMatchObject({ card: { channel: { id: ME } } });
    expect(validateOwner(me({ hidden: true, card: card('42') }), PREVIEW)).toMatchObject({ status: 'broadcaster', card: null });
    expect(validateOwner(me({ hidden: true, card: card() }), 'pv-20261101T000000Z-000000000000')).toMatchObject({ card: null });
    expect(validateOwner(me({ hidden: false, card: card() }), PREVIEW)).toMatchObject({ card: null });
  });

  it('asks the session authority same-origin, uncached, for this map, and never throws on failure', async () => {
    const ok = answering({ status: 200, body: me() });
    expect(await readOwner(PREVIEW, undefined, ok.fetcher)).toMatchObject({ status: 'broadcaster' });
    expect(ok.calls[0]!.url).toBe(`${OWNER_BASE}?preview=${PREVIEW}`);
    expect(ok.calls[0]!.init).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
    expect(await readOwner(PREVIEW, undefined, answering({ status: 404, body: {} }).fetcher)).toEqual({ status: 'anonymous' });
    const down = (async () => { throw new TypeError('offline'); }) as typeof fetch;
    expect(await readOwner(PREVIEW, undefined, down)).toEqual({ status: 'anonymous' });
    const html = (async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch;
    expect(await readOwner(PREVIEW, undefined, html)).toEqual({ status: 'anonymous' });
  });

  it('hides and shows with the session’s CSRF token, and believes only a reply that did it', async () => {
    const owner = validateOwner(me(), PREVIEW) as Extract<OwnerState, { status: 'broadcaster' }>;
    const hide = answering({ status: 200, body: me({ hidden: true, onMap: false }) });
    expect(await ownerAct('hide', owner, PREVIEW, undefined, hide.fetcher)).toMatchObject({ hidden: true, onMap: false });
    expect(hide.calls[0]!.url).toBe(`${OWNER_BASE}/hide`);
    expect(hide.calls[0]!.init).toMatchObject({ method: 'POST', credentials: 'same-origin', headers: { 'x-csrf-token': CSRF } });
    await expect(ownerAct('hide', owner, PREVIEW, undefined, answering({ status: 200, body: me({ hidden: false }) }).fetcher)).rejects.toMatchObject({ reason: 'unavailable' });
    await expect(ownerAct('hide', owner, PREVIEW, undefined, answering({ status: 200, body: me({ hidden: true, channelId: '42' }) }).fetcher)).rejects.toBeInstanceOf(OwnerActError);
    await expect(ownerAct('show', owner, PREVIEW, undefined, answering({ status: 401, body: { status: 'anonymous' } }).fetcher)).rejects.toMatchObject({ reason: 'signed-out' });
    await expect(ownerAct('show', owner, PREVIEW, undefined, answering({ status: 503, body: {} }).fetcher)).rejects.toMatchObject({ reason: 'unavailable' });
    const show = answering({ status: 200, body: me({ hidden: false, onMap: false }) });
    expect(await ownerAct('show', owner, PREVIEW, undefined, show.fetcher)).toMatchObject({ hidden: false, onMap: false });
    expect(show.calls[0]!.url).toBe(`${OWNER_BASE}/show`);
  });

  it('finds their own hidden channel in search by login or name, and nobody else’s', () => {
    const hidden = validateOwner(me({ hidden: true, onMap: false, card: card() }), PREVIEW);
    expect(ownSearchRow(hidden, 'tobi')).toMatchObject({ channel: { id: ME }, position: { x: 120, y: 340 }, language: 'de' });
    expect(ownSearchRow(hidden, '@TOBI4S_')).toMatchObject({ channel: { id: ME } });
    expect(ownSearchRow(hidden, 't')).toBeNull();
    expect(ownSearchRow(hidden, 'kai')).toBeNull();
    expect(ownSearchRow(validateOwner(me(), PREVIEW), 'tobi')).toBeNull();
    expect(ownSearchRow({ status: 'anonymous' }, 'tobi')).toBeNull();
    expect(ownSearchRow(null, 'tobi')).toBeNull();
  });
});
