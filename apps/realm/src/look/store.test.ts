import { describe, expect, it } from 'vitest';
import { MAT, MATERIALS, createCivicProp } from '@chatdom/content';
import { NO_ENTITLEMENTS, starterLookRecipe, wearPiece, type CitizenEntitlements, type CitizenLook, type EntitlementKingdom } from '@chatdom/content/avatar-style';
import { KingdomIdSchema, LOOK_TOKEN, PersonIdSchema, isLookToken, starterCitizenLook } from '@chatdom/shared';
import { signTenureEvidence, TenureEvidenceVerifier } from '../allocation/evidence';
import { entitlementsFrom, royalStandardColours, ROYAL_STANDARD_PLACEMENT, wholeMonths } from './entitlements';
import { MemoryLookRepository } from './memory-repository';
import type { LookRecords, LookRecordsResult } from './ports';
import { LookStore } from './store';
import { canonicalLook } from './token';

const WREN = PersonIdSchema.parse('990300101'), KINGDOM = KingdomIdSchema.parse('990300001');
const HOME: EntitlementKingdom = { id: KINGDOM, name: 'SIMULATED Lanternmere', colours: ['#41677d', '#e5d8b7'] };
const base = (): CitizenLook => starterLookRecipe('hearth')!;
const hooded = () => wearPiece(base(), { family: 'hood', value: { cloth: HOME.colours[0], trim: HOME.colours[1] } });
const DAY = 24 * 60 * 60 * 1000;

/** Every key in reverse order, at every level: the same look written differently. */
const reversed = (value: unknown): unknown => Array.isArray(value) ? value.map(reversed)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reversed(v)])) : value;

function setup(records: LookRecordsResult | (() => Promise<LookRecordsResult>) = { kind: 'records', entitlements: NO_ENTITLEMENTS(HOME, 'simulated') }) {
  let t = 1_000_000;
  const repository = new MemoryLookRepository(() => t);
  const port: LookRecords = { entitlements: async () => typeof records === 'function' ? records() : records };
  const saved: string[] = [];
  const harmful = { list: [] as string[] };
  const store = new LookStore({ repository, records: port, origin: 'simulated', now: () => t, harmful: () => harmful.list });
  store.onSaved(event => saved.push(event.token));
  return { store, repository, saved, harmful, tick: (ms: number) => { t += ms; } };
}

describe('look tokens', () => {
  it('gives the same token for the same look, however it is written, and another for any change', () => {
    const one = canonicalLook(base()), again = canonicalLook(reversed(base()));
    expect(one.token).toMatch(LOOK_TOKEN);
    expect(isLookToken(one.token)).toBe(true);
    expect(again.token).toBe(one.token);
    expect(again.canonical).toBe(one.canonical);
    const other = canonicalLook({ ...base(), blush: !base().blush });
    expect(other.token).not.toBe(one.token);
    // Defaults a builder may leave out are part of the look: an old look and its filled-in twin are the same look.
    const withoutEarned: Record<string, unknown> = { ...base() };
    delete withoutEarned.earned;
    expect(canonicalLook(withoutEarned).token).toBe(canonicalLook({ ...base(), earned: base().earned }).token);
  });

  it('refuses anything parseLook refuses', () => {
    expect(() => canonicalLook({ ...base(), hair: { style: 'crown-of-snakes', colour: '#000000' } })).toThrow(/hair style/);
    expect(() => canonicalLook({ ...base(), extra: true })).toThrow();
  });
});

describe('LookStore', () => {
  it('saves a look, keeps the same token for the same look and serves its recipe for ever', async () => {
    const { store, repository, saved, tick } = setup();
    const first = await store.save(WREN, { version: 1, look: base() });
    expect(first).toMatchObject({ status: 200, reply: { ok: true, version: 1 } });
    const token = (first.reply as { token: string }).token;
    tick(5_000);
    const again = await store.save(WREN, { version: 1, look: reversed(base()) });
    expect(again.reply).toMatchObject({ ok: true, token, savedAt: 1_005_000 });
    expect(saved).toEqual([token, token]);
    expect(repository.recipes.size).toBe(1);
    expect(await store.recipe(token)).toMatchObject({ status: 'found', immutable: true, reply: { version: 1, token, look: JSON.parse(canonicalLook(base()).canonical) } });
    expect(await store.mine(WREN, null)).toMatchObject({ status: 'saved', token, savedAt: 1_005_000, entitlements: null, granted: [] });
    const changed = await store.save(WREN, { version: 1, look: { ...base(), freckles: 'full' } });
    expect((changed.reply as { token: string }).token).not.toBe(token);
    expect(await store.recipe(token)).toMatchObject({ status: 'found' });
  });

  it('answers a person who never saved with their starter, and the entitlements the save will be checked against', async () => {
    const { store } = setup();
    expect(await store.mine(WREN, KINGDOM)).toEqual({ version: 1, status: 'none', starter: starterCitizenLook(WREN),
      entitlements: NO_ENTITLEMENTS(HOME, 'simulated'), granted: [] });
  });

  it('serves the six starters and refuses what is not a token', async () => {
    const { store } = setup();
    expect(await store.recipe('dusk')).toEqual({ status: 'found', immutable: false, reply: { version: 1, token: 'dusk', look: starterLookRecipe('dusk') } });
    expect(await store.recipe(`lk.${'0'.repeat(40)}`)).toEqual({ status: 'missing' });
    for (const bad of ['neutral', 'lk.ABC', `lk.${'0'.repeat(41)}`, '../me', '']) expect(await store.recipe(bad)).toEqual({ status: 'malformed' });
  });

  it('refuses a malformed save and leaves the look as it was', async () => {
    const { store, repository, saved } = setup();
    for (const body of [null, {}, { look: base() }, { version: 2, look: base() }, { version: 1, look: base(), personId: WREN }, { version: 1, look: base(), kingdomId: 'x' }]) {
      expect(await store.save(WREN, body)).toMatchObject({ status: 400, reply: { ok: false, code: 'malformed' } });
    }
    const unknown = await store.save(WREN, { version: 1, look: { ...base(), hat: { style: 'crown', colour: '#ffffff', trim: '#000000' } } });
    expect(unknown).toMatchObject({ status: 400, reply: { code: 'malformed' } });
    expect((unknown.reply as { reason: string }).reason).toMatch(/Unknown hat: crown/);
    expect(repository.recipes.size).toBe(0); expect(saved).toEqual([]);
  });

  it('refuses an earned piece the verified records do not hold, and accepts it once they do', async () => {
    let records: CitizenEntitlements = NO_ENTITLEMENTS(HOME, 'simulated');
    const { store, saved } = setup(async () => ({ kind: 'records', entitlements: records }));
    const noKingdom = await store.save(WREN, { version: 1, look: hooded() });
    expect(noKingdom).toMatchObject({ status: 403, reply: { ok: false, code: 'unearned' } });
    const notYet = await store.save(WREN, { version: 1, look: hooded(), kingdomId: KINGDOM });
    expect(notYet).toMatchObject({ status: 403, reply: { ok: false, code: 'unearned' } });
    expect((notYet.reply as { reason: string }).reason).toBe("The kingdom's records do not show the tenure hood as yours yet, so it cannot be worn. Your look was left as it was.");
    // A hood in other colours is not this kingdom's hood, even with the year.
    records = { ...records, followedMonths: 12 };
    const recoloured = wearPiece(base(), { family: 'hood', value: { cloth: '#ff0000', trim: HOME.colours[1] } });
    expect(await store.save(WREN, { version: 1, look: recoloured, kingdomId: KINGDOM })).toMatchObject({ reply: { code: 'unearned' } });
    expect(saved).toEqual([]);
    expect(await store.save(WREN, { version: 1, look: hooded(), kingdomId: KINGDOM })).toMatchObject({ status: 200, reply: { ok: true } });
  });

  it('says plainly when a kingdom is unknown or its records are not open, and changes nothing', async () => {
    const unknown = setup({ kind: 'unknown' }), closed = setup({ kind: 'closed' });
    expect(await unknown.store.save(WREN, { version: 1, look: hooded(), kingdomId: KINGDOM })).toMatchObject({ status: 403, reply: { code: 'unearned' } });
    expect(await closed.store.save(WREN, { version: 1, look: hooded(), kingdomId: KINGDOM })).toMatchObject({ status: 503, reply: { code: 'unavailable' } });
    // A look with no earned piece never needs the records.
    expect(await closed.store.save(WREN, { version: 1, look: base(), kingdomId: KINGDOM })).toMatchObject({ status: 200 });
    const failing = setup(async () => { throw new Error('SIMULATED records down'); });
    expect(await failing.store.save(WREN, { version: 1, look: hooded(), kingdomId: KINGDOM })).toMatchObject({ status: 503, reply: { code: 'unavailable' } });
  });

  it('refuses a harmful combination with a kind sentence', async () => {
    const { store, harmful } = setup();
    harmful.list = ['SIMULATED reason'];
    const outcome = await store.save(WREN, { version: 1, look: base() });
    expect(outcome).toMatchObject({ status: 422, reply: { ok: false, code: 'unsuitable' } });
    expect((outcome.reply as { reason: string }).reason).not.toMatch(/violation|flagged|invalid/i);
  });

  it('rate-limits saves per person and recovers after a minute', async () => {
    const { store, tick } = setup();
    for (let n = 0; n < 20; n++) expect(await store.save(WREN, { version: 1, look: base() })).toMatchObject({ status: 200 });
    expect(await store.save(WREN, { version: 1, look: base() })).toMatchObject({ status: 429, reply: { code: 'busy' } });
    expect(await store.save(PersonIdSchema.parse('990300102'), { version: 1, look: base() })).toMatchObject({ status: 200 });
    tick(60_001);
    expect(await store.save(WREN, { version: 1, look: base() })).toMatchObject({ status: 200 });
  });

  it('reports storage trouble as unavailable and keeps the old look', async () => {
    const { store, repository, saved } = setup();
    await store.save(WREN, { version: 1, look: base() });
    repository.failing = true;
    expect(await store.save(WREN, { version: 1, look: { ...base(), blush: !base().blush } })).toMatchObject({ status: 503, reply: { code: 'unavailable' } });
    repository.failing = false;
    expect((await store.mine(WREN, null) as { token: string }).token).toBe(canonicalLook(base()).token);
    expect(saved).toHaveLength(1);
  });

  it('grants a forged piece once and lists it with the look', async () => {
    const { store, tick } = setup();
    const grant = { personId: WREN, pieceId: 'forge.SIMULATED-owl-1', slot: 'hat' as const, title: 'Owl hat', recipe: { voxels: [[0, 1, 2]], b: 1, a: 2 }, source: 'forge' as const };
    const first = await store.grantWardrobePiece(grant);
    tick(1_000);
    expect(await store.grantWardrobePiece({ ...grant, title: 'Another title' })).toEqual(first);
    expect(first).toEqual({ pieceId: grant.pieceId, slot: 'hat', source: 'forge', title: 'Owl hat', recipe: { a: 2, b: 1, voxels: [[0, 1, 2]] }, grantedAt: 1_000_000 });
    expect(await store.mine(WREN, null)).toMatchObject({ status: 'none', granted: [first] });
    await expect(store.grantWardrobePiece({ ...grant, slot: 'boots' as never })).rejects.toThrow();
    await expect(store.grantWardrobePiece({ ...grant, personId: 'someone' })).rejects.toThrow();
  });
});

describe('verified records', () => {
  it('counts whole calendar months, never into the future', () => {
    const at = Date.UTC(2025, 0, 31, 12);
    expect(wholeMonths(at, Date.UTC(2025, 1, 28, 12))).toBe(1);
    expect(wholeMonths(at, Date.UTC(2025, 1, 28, 11))).toBe(0);
    expect(wholeMonths(at, Date.UTC(2026, 0, 31, 12))).toBe(12);
    expect(wholeMonths(at, at - 1)).toBe(0);
  });

  it('turns signed tenure evidence into entitlements as it was observed', () => {
    const key = new Uint8Array(32).fill(7), verifier = new TenureEvidenceVerifier('simulated', key), now = Date.UTC(2026, 10, 1);
    const signed = { version: 1 as const, kingdomId: KINGDOM, personId: WREN, origin: 'simulated' as const };
    const follow = signTenureEvidence(key, { ...signed, kind: 'follow', source: 'helix.channel-followers', observedAt: now - 40 * DAY, followedAt: Date.UTC(2025, 0, 1) });
    const sub = signTenureEvidence(key, { ...signed, kind: 'subscription', source: 'chat.badge-info', observedAt: now - 40 * DAY, months: 7 });
    const tenure = verifier.verify([follow, sub], { kingdomId: KINGDOM, personId: WREN, now });
    const e = entitlementsFrom(tenure, HOME, 'simulated', now);
    // Followed from January 2025 to the observation in late September 2026: twenty whole months, not to today.
    expect(e).toMatchObject({ followedMonths: 20, sub: { tier: '1', months: 7, active: false }, founder: false, keepsakes: [], forged: [], moments: [] });
    expect(entitlementsFrom(tenure, HOME, 'simulated', now - 20 * DAY).sub?.active).toBe(true);
    expect(entitlementsFrom({ followedAt: null, subscribedMonths: null, records: [] }, HOME, 'live', now)).toEqual(NO_ENTITLEMENTS(HOME, 'live'));
  });

  it('reads the kingdom colours from the royal standard that stands in the founded scene', () => {
    const scene = (style: 'hearth' | 'tide') => ({
      materials: MATERIALS, assets: [{ assetHash: 'a'.repeat(64), blueprint: createCivicProp('banner-standard', style) }],
      placements: [{ id: ROYAL_STANDARD_PLACEMENT, assetHash: 'a'.repeat(64), position: [0, 0, 0] as const, rotation: 0 as const }],
    });
    const colour = (id: number) => MATERIALS.materials.find(material => material.id === id)!.colour.toLowerCase();
    // Tide flies a slate field with a cream charge, Hearth a red cloth field (civic kit, `kit.ts`).
    expect(royalStandardColours(scene('tide'))).toEqual([colour(MAT.slate), colour(MAT.cream)]);
    expect(royalStandardColours(scene('hearth'))).toEqual([colour(MAT.cloth), colour(MAT.cream)]);
    expect(royalStandardColours({ ...scene('tide'), placements: [] })).toBeNull();
  });
});
