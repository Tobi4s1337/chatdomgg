import { describe, expect, it, vi } from 'vitest';
import type { KingdomId } from '@chatdom/shared';
import {
  HAIR_STYLE_IDS, PORTRAIT_FIXTURES, TOP_STYLE_IDS, checkEarned, earnedOffers, parseLook, starterLookRecipe, wearPiece,
  type CitizenEntitlements, type CitizenLook,
} from '../../../../packages/content/src/avatar-style';
import type { PlayContext } from '../play/slots';
import { BENCH_RECORDS } from './bench-records';
import { freshenEarned, tileCard } from './cards';
import { TABS } from './catalogue';
import { createLookClient, kingdomFromQuery, type LookClient, type LookMine } from './look-client';
import { markRevealed, markSeen, mirrorPutOff, putOffMirror, revealKey, seenNew, unrevealed, type DeviceStore } from './memory';
import { mirrorPicks } from './mirror-picks';
import { allPieceCards } from './pieces';
import { LOOK_PAGE_ORDER, createLookSlots, type LookSlotDeps } from './play-slot';

const look = PORTRAIT_FIXTURES[0]!.look;
const TOKEN = `lk.${'a1'.repeat(20)}`;
const CSRF = 'c'.repeat(40);
const KINGDOM = '129634568' as KingdomId;

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const signedIn = () => reply(200, { version: 1, status: 'authenticated', expiresAt: Date.now() + 3_600_000, resumeScope: 'opaque-browser-scope', csrfToken: CSRF });

/** A fetch that answers the session route and then hands the look route to `looks`. */
function realm(looks: (init: RequestInit | undefined, url: string) => Response | Promise<Response>, session = signedIn) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith('/api/realm/session')) return session();
    return looks(init, url);
  });
  return { fetch, calls };
}

function memoryStore(): DeviceStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

describe('the look client', () => {
  it('saves through the realm with the session csrf token and returns the realm token', async () => {
    const { fetch, calls } = realm(init => {
      expect(init?.method).toBe('PUT');
      expect((init?.headers as Record<string, string>)['x-csrf-token']).toBe(CSRF);
      const body = JSON.parse(String(init?.body)) as { version: number; look: unknown; kingdomId?: string };
      expect(body.version).toBe(1);
      expect(body.kingdomId).toBe(KINGDOM);
      return reply(200, { version: 1, ok: true, token: TOKEN, look: body.look, savedAt: 1 });
    });
    const client = createLookClient({ fetch, returnTo: () => '/' });
    const saved = vi.fn();
    const outcome = await client.authority(KINGDOM, saved).save(look);
    expect(outcome).toEqual({ ok: true, look: parseLook(look), token: TOKEN });
    expect(saved).toHaveBeenCalledWith({ token: TOKEN, look: parseLook(look) });
    expect(calls.map(c => c.url)).toEqual(['/api/realm/session', '/api/realm/looks/me']);
  });

  it('passes the realm refusal sentence on as it is', async () => {
    const reason = 'The month ribbons are earned in Lanternmere. Take them off to save here.';
    const { fetch } = realm(() => reply(422, { version: 1, ok: false, code: 'unearned', reason }));
    const outcome = await createLookClient({ fetch }).save(look, KINGDOM);
    expect(outcome).toEqual({ ok: false, code: 'unearned', reason });
  });

  it('never calls a malformed or unreadable reply a save', async () => {
    const bodies: (() => Response)[] = [
      () => reply(200, { version: 1, ok: true, token: 'not-a-token', look, savedAt: 1 }),
      () => reply(200, { ok: true }),
      () => reply(200, { version: 1, ok: true, token: TOKEN, look: { nonsense: true }, savedAt: 1 }),
      () => new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      () => reply(500, { version: 1, ok: true, token: TOKEN, look, savedAt: 1 }),
    ];
    for (const body of bodies) {
      const { fetch } = realm(body);
      const outcome = await createLookClient({ fetch }).save(look);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason.length).toBeGreaterThan(10);
    }
  });

  it('says plainly when the realm cannot be reached', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('network'); });
    const outcome = await createLookClient({ fetch }).save(look);
    expect(outcome).toMatchObject({ ok: false, code: 'unavailable' });
  });

  it('is anonymous without a session and refuses to save, asking to sign in', async () => {
    const { fetch, calls } = realm(() => { throw new Error('the look route is never asked'); }, () => reply(200, { version: 1, status: 'anonymous' }));
    const client = createLookClient({ fetch, returnTo: () => '/-/avatar-builder?kingdom=129634568' });
    const mine = await client.mine(KINGDOM);
    expect(mine.status).toBe('anonymous');
    if (mine.status === 'anonymous') expect(mine.signInUrl).toContain('/api/realm/auth/start');
    const outcome = await client.save(look);
    expect(outcome).toMatchObject({ ok: false, code: 'unauthenticated' });
    expect(calls.every(c => c.url === '/api/realm/session')).toBe(true);
  });

  it('reads a saved look and its records, and a starter for someone who never saved', async () => {
    const records = BENCH_RECORDS.regular;
    const saved = realm(() => reply(200, { version: 1, status: 'saved', token: TOKEN, look, savedAt: 5, entitlements: records, granted: [] }));
    const mine = await createLookClient({ fetch: saved.fetch }).mine(KINGDOM);
    expect(mine).toMatchObject({ status: 'saved', token: TOKEN, savedAt: 5 });
    expect(saved.calls[1]!.url).toBe(`/api/realm/looks/me?kingdom=${KINGDOM}`);

    const fresh = realm(() => reply(200, { version: 1, status: 'none', starter: 'tide', entitlements: records, granted: [] }));
    const starter = await createLookClient({ fetch: fresh.fetch }).mine();
    expect(starter.status).toBe('none');
    if (starter.status === 'none') expect(starter.look).toEqual(parseLook(starterLookRecipe('tide')));

    const forged = realm(() => reply(200, { version: 1, status: 'saved', token: TOKEN, look, savedAt: 5, entitlements: { ...records, founder: 'yes' }, granted: [] }));
    await expect(createLookClient({ fetch: forged.fetch }).mine()).rejects.toMatchObject({ kind: 'untrusted' });
  });

  it('reads a kingdom from the page query only when it is a kingdom id', () => {
    expect(kingdomFromQuery('?kingdom=129634568')).toBe('129634568');
    expect(kingdomFromQuery('?kingdom=tobi4s_')).toBeNull();
    expect(kingdomFromQuery('')).toBeNull();
  });
});

describe('the catalogue and its cards', () => {
  const tiles = TABS.flatMap(t => t.controls).filter(c => c.kind === 'tiles');

  it('has a tile, and so a card, for every piece the content package describes', () => {
    expect(allPieceCards().length).toBeGreaterThan(100);
    for (const card of allPieceCards()) {
      const control = tiles.find(c => c.piece === card.kind);
      expect(control, `${card.kind}`).toBeDefined();
      const option = control!.options.find(o => o.id === card.id);
      expect(option, `${card.kind}:${card.id}`).toBeDefined();
      const shown = tileCard(control!, option!, new Set());
      expect(shown.name).toBe(card.name);
      expect(shown.story).toBe(card.story);
      expect(shown.tier).toBe(card.tier);
    }
    // And the other way: every piece tile has its card.
    for (const control of tiles) if (control.piece) for (const option of control.options) {
      if (option.id === 'none') continue;
      expect(allPieceCards().some(c => c.kind === control.piece && c.id === option.id), `${control.piece}:${option.id}`).toBe(true);
    }
  });

  it('offers every style in the content lists as a tile', () => {
    const ids = (piece: string) => tiles.find(c => c.piece === piece)!.options.map(o => o.id);
    expect(ids('hair')).toEqual([...HAIR_STYLE_IDS]);
    expect(ids('top')).toEqual([...TOP_STYLE_IDS]);
  });

  it('takes off the new optional parts by leaving them out, so older looks keep their token', () => {
    for (const [kind, piece] of [['ears', 'ears'], ['face-paint', 'facePaint'], ['held', 'held']] as const) {
      const control = tiles.find(c => c.piece === kind)!;
      const on = control.options[1]!.apply(look);
      expect(on[piece as keyof CitizenLook], piece).toBeTruthy();
      const off = control.options[0]!.apply(on);
      expect(piece in off, piece).toBe(false);
      expect(JSON.stringify(parseLook(off))).toBe(JSON.stringify(parseLook(look)));
    }
  });

  it('keeps the ribbons someone wears in step with the months they have reached', () => {
    const before: CitizenEntitlements = { ...BENCH_RECORDS.regular, sub: { tier: '1', months: 3, active: true } };
    const after: CitizenEntitlements = { ...BENCH_RECORDS.regular, sub: { tier: '1', months: 7, active: true } };
    const ribbons = earnedOffers(before).find(o => o.piece.family === 'ribbons' && o.unlocked)!;
    const wearing = wearPiece(look, ribbons.piece);
    expect(wearing.earned.ribbons?.months).toBe(3);
    const grown = freshenEarned(wearing, after);
    expect(grown.earned.ribbons?.months).toBe(6);
    expect(checkEarned(grown, after)).toEqual([]);
    expect(freshenEarned(look, after)).toBe(look);
  });

  it('gives the mirror its three quick picks with what you wear first', () => {
    const picks = mirrorPicks(look);
    expect(picks.hairs[0]!.selected(look)).toBe(true);
    expect(picks.hairs.length).toBe(8);
    expect(picks.tops.length).toBe(TOP_STYLE_IDS.length);
    expect(picks.colours.length).toBeGreaterThan(6);
    expect(new Set(picks.colours.map(c => c.id)).size).toBe(picks.colours.length);
  });
});

describe('what the device remembers', () => {
  it('reveals each unlock once per kingdom, and a new month mark again', () => {
    const store = memoryStore();
    const offers = earnedOffers(BENCH_RECORDS.regular);
    const first = unrevealed(offers, 'k1', store);
    expect(first.length).toBeGreaterThan(0);
    markRevealed(first, 'k1', store);
    expect(unrevealed(offers, 'k1', store)).toEqual([]);
    expect(unrevealed(offers, 'k2', store).length).toBe(first.length);
    const later = earnedOffers({ ...BENCH_RECORDS.regular, sub: { tier: '1', months: 12, active: true } });
    expect(unrevealed(later, 'k1', store).map(revealKey).some(k => k.startsWith(first.find(o => o.piece.family === 'ribbons')!.key))).toBe(true);
  });

  it('remembers new pieces tried on and the mirror put off, and forgives broken storage', () => {
    const store = memoryStore();
    markSeen('held:balloon', store);
    expect(seenNew(store).has('held:balloon')).toBe(true);
    expect(mirrorPutOff(store)).toBe(false);
    putOffMirror(store);
    expect(mirrorPutOff(store)).toBe(true);
    store.data.set('chatdom.wardrobe.v1', '{nope');
    expect(mirrorPutOff(store)).toBe(false);
    expect(mirrorPutOff(null)).toBe(false);
  });
});

describe('the wardrobe in play', () => {
  const leases: string[] = [];
  const ctx = (self: PlayContext['self'], mode: PlayContext['mode'] = 'walking'): PlayContext => ({
    kingdomId: KINGDOM, self, live: false, mode, settings: {} as PlayContext['settings'],
    requestCursor: reason => { leases.push(`cursor:${reason}`); return { active: true, release: () => leases.push(`-cursor:${reason}`) }; },
    closeLedger: () => leases.push('close-ledger'),
    requestInput: reason => { leases.push(`input:${reason}`); return { active: true, onKey: () => () => undefined, onPointer: () => () => undefined, release: () => leases.push(`-input:${reason}`) }; },
    hideSelf: () => ({ release: () => undefined }),
  });
  const walker = { personId: '4242', publicName: 'cozy_otter', lookToken: 'tide' };

  function slots(mine: LookMine | Error, store: DeviceStore | null = memoryStore()) {
    const remember = vi.fn();
    const runMirror = vi.fn(async () => 'saved' as const);
    const openBuilderOverlay = vi.fn();
    const client: LookClient = {
      mine: vi.fn(async () => { if (mine instanceof Error) throw mine; return mine; }),
      save: vi.fn(),
      authority: vi.fn(),
    };
    const deps: LookSlotDeps = {
      client: () => client, memory: () => store, library: () => ({ remember }),
      ui: async () => ({ runMirror, openBuilderOverlay }) as unknown as typeof import('./play-ui'),
    };
    return { s: createLookSlots(deps), remember, runMirror, openBuilderOverlay, client };
  }
  const none: LookMine = { status: 'none', starter: 'tide', look: parseLook(starterLookRecipe('tide')), entitlements: BENCH_RECORDS.newcomer, granted: [] };

  it('offers the look page only to a signed-in walker, after the way home', () => {
    const { s } = slots(none);
    expect(s.page.id).toBe('look');
    expect(LOOK_PAGE_ORDER).toBeGreaterThan(20);
    expect(LOOK_PAGE_ORDER).toBeLessThan(30);
    expect(s.page.available(ctx(null))).toBe(false);
    expect(s.page.available(ctx(walker, 'watching'))).toBe(false);
    expect(s.page.available(ctx(walker))).toBe(true);
  });

  it('wants the mirror only for a signed-in walker without a saved look who has not put it off', () => {
    const store = memoryStore();
    const { s } = slots(none, store);
    expect(s.mirror.wanted(ctx(null))).toBe(false);
    expect(s.mirror.wanted(ctx({ ...walker, lookToken: TOKEN }))).toBe(false);
    expect(s.mirror.wanted(ctx(walker))).toBe(true);
    putOffMirror(store);
    expect(s.mirror.wanted(ctx(walker))).toBe(false);
  });

  it('shows nothing when the realm already holds a look, and remembers it for the street', async () => {
    const saved: LookMine = { status: 'saved', token: TOKEN, look, savedAt: 1, entitlements: BENCH_RECORDS.newcomer, granted: [] };
    const { s, remember, runMirror } = slots(saved);
    await s.mirror.run({} as HTMLElement, ctx(walker));
    expect(runMirror).not.toHaveBeenCalled();
    expect(remember).toHaveBeenCalledWith(TOKEN, look);
  });

  it('shows nothing when the realm cannot say, and the mirror when nothing is saved', async () => {
    const down = slots(new Error('down'));
    await down.s.mirror.run({} as HTMLElement, ctx(walker));
    expect(down.runMirror).not.toHaveBeenCalled();
    const fresh = slots(none);
    await fresh.s.mirror.run({} as HTMLElement, ctx(walker));
    expect(fresh.runMirror).toHaveBeenCalledTimes(1);
  });

  it('opens the builder holding the cursor and the walk, and gives both back when it closes', async () => {
    leases.length = 0;
    const { s, openBuilderOverlay } = slots(none);
    s.openLookBuilder({ ctx: ctx(walker), from: 'ledger', kingdomId: KINGDOM });
    s.openLookBuilder({ ctx: ctx(walker), from: 'ledger', kingdomId: KINGDOM });
    await vi.waitFor(() => expect(openBuilderOverlay).toHaveBeenCalledTimes(1));
    expect(leases).toEqual(['cursor:look', 'input:look', 'close-ledger']);
    const { onClosed } = openBuilderOverlay.mock.calls[0]![0] as { onClosed(): void };
    onClosed();
    onClosed();
    expect(leases).toEqual(['cursor:look', 'input:look', 'close-ledger', '-input:look', '-cursor:look']);
  });
});
