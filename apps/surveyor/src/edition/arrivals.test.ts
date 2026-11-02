// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { currentNamesText, namesRefOf } from '../cartography/names-ref';
import { currentTaxonomyText, loadTaxonomy } from '../cartography/taxonomy';
import { loadDirectory } from '../directory/directory';
import { LookupUnavailable, type TwitchChannelFacts } from '../directory/twitch-lookup';
import { runImport } from '../import';
import { readPreviewNames } from '../preview/store';
import { FixtureSource, clock, configFor, fakeSurveyor, sweepAt, tempDataDir } from '../test/fixture-source';
import { allowRealImports } from '../test/timeouts';
import { ARRIVAL_CHECKS_PER_NIGHT, appendArrivals, arrivalsToCheck, checkArrivals, foundArrivals, readArrivals, type Arrival, type FoundArrival, type RaidRef } from './arrivals';
import { founderKey, signAuthorization } from './authorization';
import { checkPublication, runSettle, runStage, settleWithArrivals } from './commands';
import { draftEdition, foundingRecord } from './found';
import { extendLedger } from './ledger';
import { buildEditionPublication, editionAddress } from './publish';
import { editionContext, editionPencilPlace, settleNight } from './settle';
import { verifyEditionDir } from './store';
import { DAY, HOUR, T0, planChannels, raid, revision, synthId, testKeys, type ChannelSpec } from './fixtures.test-support';

allowRealImports();

const TAXONOMY = currentTaxonomyText();
const TAXONOMY_REF = loadTaxonomy(TAXONOMY).ref;
const ASOF1 = T0 + 8 * DAY;
const FOUNDED_AT = ASOF1 + HOUR;
const BASE: ChannelSpec[] = planChannels([{ code: 'de', candidates: 40, small: 10 }, { code: 'ja', candidates: 12, small: 4 }], 23);
const rev1 = revision({ asOf: ASOF1, specs: BASE, tag: 'arrivals' });
const keys = testKeys();
const draft = draftEdition({ number: 'I', manifest: rev1.manifest, channels: rev1.channels, games: rev1.games, taxonomyText: TAXONOMY, foundedAt: FOUNDED_AT, withheld: new Set() });
const ctx = editionContext(draft.world, loadTaxonomy(TAXONOMY));
const japan = draft.world.realms.find((realm) => draft.world.regions[realm.region]!.language === 'ja')!.index;
const raider = Number(draft.settlers.find((settler) => settler.realmIndex !== japan)!.kingdomId.slice(1));
const raiderId = synthId(raider);

/** A raided channel the survey never saw: well outside the synthetic survey's numbers. */
const UNSEEN = synthId(8_801);
const ALSO_UNSEEN = synthId(8_802);

const found = (kingdomId: string, night: number, raidRef: { id: string; fromKingdomId: string; observedAt: number }, over: Partial<FoundArrival> = {}): FoundArrival => ({
  version: 1, kind: 'chatdom-atlas-raid-arrival', status: 'found', kingdomId: kingdomId as FoundArrival['kingdomId'], login: `synthetic_${kingdomId.slice(-4)}`,
  name: `Synthetic ${kingdomId.slice(-4)}`, language: 'ja', categories: [{ gameId: '509658', minutes: 1 }], checkedAt: night + 60_000, night,
  raid: { id: raidRef.id, fromKingdomId: raidRef.fromKingdomId as FoundArrival['kingdomId'], observedAt: raidRef.observedAt }, ...over,
});

describe('land by raid for streams the survey never saw', () => {
  const asOf2 = ASOF1 + DAY;
  const raided = raid(raider, 8_801, ASOF1 + 2 * HOUR);
  const rev2 = revision({ asOf: asOf2, tag: 'arrival-night', specs: BASE, raids: [raided] });
  const night = (arrivals: ReadonlyMap<string, FoundArrival>, withheld: ReadonlySet<string> = new Set(), state = draft.state, rev = rev2) => settleNight({
    number: 'I', ctx, state, manifest: rev.manifest, channels: rev.channels, raidPairs: [], raidObservations: rev.raidObservations, withheld, arrivals,
  });
  const arrival = found(UNSEEN, asOf2, raided.raid);

  it('waits without Twitch\'s answer, and grants the pencil place on it: the road keeps its end and nobody moves', () => {
    expect(night(new Map()).summary).toMatchObject({ settled: 0, byRaid: 0, byRaidArrival: 0, unseenRaidTargets: 1 });
    const granted = night(new Map([[UNSEEN, arrival]]));
    expect(granted.summary).toMatchObject({ settled: 1, byRaid: 1, byRaidArrival: 1, unseenRaidTargets: 0, deferred: 0 });
    const settles = granted.events.filter((event) => event.kind === 'settle');
    expect(settles.map((event) => [event.settler.kingdomId, event.reason, event.settler.holdingTier, event.settler.realmIndex])).toEqual([[UNSEEN, 'raid', 'hamlet', japan]]);
    // Exactly where search drew its pencil flag from the same facts, so a road drawn to it before tonight ends on it.
    expect(settles[0]!.settler.point).toEqual(editionPencilPlace(ctx, draft.state, japan, UNSEEN));
    const next = extendLedger(draft.state, granted.events).next;
    expect(next.settlers.slice(0, draft.state.settlers.length)).toEqual(draft.state.settlers);
  });

  it('grants nothing to a withheld or gambling stream, or for a raid from hidden land', () => {
    expect(night(new Map([[UNSEEN, arrival]]), new Set([UNSEEN])).summary.byRaid).toBe(0);
    expect(night(new Map([[UNSEEN, { ...arrival, categories: [{ gameId: '498566', minutes: 1 }] }]])).summary.byRaid).toBe(0);
    expect(night(new Map([[UNSEEN, arrival]]), new Set([raiderId])).summary).toMatchObject({ byRaid: 0, tombstones: 1 });
  });

  it('grants a raid from an earlier night once its answer arrives, and only on the night it was checked for', () => {
    // Night 2 settled while Twitch could not answer; the raid is older than night 3's window.
    const state2 = extendLedger(draft.state, night(new Map()).events).next;
    const rev3 = revision({ asOf: asOf2 + DAY, tag: 'arrival-retry', specs: BASE, raids: [raided] });
    const late = found(UNSEEN, rev3.manifest.asOf, raided.raid);
    expect(night(new Map([[UNSEEN, late]]), new Set(), state2, rev3).summary).toMatchObject({ byRaid: 1, byRaidArrival: 1 });
    // An answer from an earlier night carries no raid into a later one: only a fresh raid grants then.
    expect(night(new Map([[UNSEEN, arrival]]), new Set(), state2, rev3).summary.byRaid).toBe(0);
  });

  it('names the new holding from Twitch\'s answer in the publication; the survey\'s own name always wins', () => {
    const founding = foundingRecord(draft, 'I', rev1.manifest, signAuthorization({
      kind: 'chatdom-atlas-founding-authorization', edition: 'I', revision: rev1.manifest.revision, taxonomySha256: TAXONOMY_REF.sha256, issuedAt: FOUNDED_AT, issuedBy: 'test_founder',
    }, keys.privatePem), founderKey(keys.publicPem).fingerprint, 'none', namesRefOf(currentNamesText()));
    const address = editionAddress({ edition: draft.edition, foundingBytes: `${JSON.stringify(founding, null, 2)}\n`, taxonomyText: draft.taxonomyText, ledgerText: draft.ledgerText });
    const state = extendLedger(draft.state, night(new Map([[UNSEEN, arrival]])).events).next;
    const surveyed = rev2.channels[0]!;
    const arrived = new Map([[UNSEEN, { login: arrival.login, name: arrival.name, factsAt: arrival.checkedAt }], [surveyed.kingdomId, { login: 'someone_else', name: 'Someone Else', factsAt: 1 }]]);
    const publish = () => buildEditionPublication({ edition: draft.edition, founding, world: draft.world, address, state, manifest: rev2.manifest, channels: rev2.channels, arrived });
    const names = publish().names;
    const at = names.ids.indexOf(UNSEEN as never);
    expect([names.logins[at], names.names[at], names.factsAt[at]]).toEqual([arrival.login, arrival.name, arrival.checkedAt]);
    const own = names.ids.indexOf(surveyed.kingdomId);
    expect(names.logins[own]).toBe(surveyed.login);
    expect(Buffer.from(publish().files.get('names.json')!).equals(Buffer.from(publish().files.get('names.json')!))).toBe(true);
  });
});

describe('which raided streams settlement asks Twitch about', () => {
  const state = draft.state;
  const ref = (to: string, at: number, from = raiderId): RaidRef => ({ id: `r:${from}:${to}:${at}`, fromKingdomId: from, toKingdomId: to, observedAt: at });
  const observed = rev1.channels.find((channel) => !state.owners.has(channel.kingdomId))!.kingdomId;

  it('asks once per unseen target of a settled kingdom, earliest raid first, never about known, owned or withheld channels', () => {
    const raids = [ref(ALSO_UNSEEN, 30), ref(UNSEEN, 20), ref(UNSEEN, 10), ref(observed, 5), ref(draft.settlers[3]!.kingdomId, 6), ref(synthId(8_803), 7), ref(synthId(8_804), 8, synthId(8_900))];
    const wanted = arrivalsToCheck({ state, channels: rev1.channels, raids, arrivals: [], withheld: new Set([synthId(8_803)]) });
    expect(wanted.map((raidRef) => [raidRef.toKingdomId, raidRef.observedAt])).toEqual([[UNSEEN, 10], [ALSO_UNSEEN, 30]]);
  });

  it('does not ask again after an answer, except about a stream found gone before a newer raid into it', () => {
    const arrivals: Arrival[] = [
      found(UNSEEN, ASOF1, ref(UNSEEN, 10)),
      { version: 1, kind: 'chatdom-atlas-raid-arrival', status: 'absent', kingdomId: ALSO_UNSEEN as Arrival['kingdomId'], checkedAt: 50, night: ASOF1 },
    ];
    expect(arrivalsToCheck({ state, channels: [], raids: [ref(UNSEEN, 99), ref(ALSO_UNSEEN, 40)], arrivals, withheld: new Set() })).toEqual([]);
    expect(arrivalsToCheck({ state, channels: [], raids: [ref(ALSO_UNSEEN, 60)], arrivals, withheld: new Set() }).map((r) => r.toKingdomId)).toEqual([ALSO_UNSEEN]);
  });

  it('asks about at most a bounded number a night', () => {
    const raids = Array.from({ length: ARRIVAL_CHECKS_PER_NIGHT + 7 }, (_, i) => ref(synthId(100_000 + i), i + 1));
    expect(arrivalsToCheck({ state, channels: [], raids, arrivals: [], withheld: new Set() })).toHaveLength(ARRIVAL_CHECKS_PER_NIGHT);
  });

  it('asks in batches of a hundred, records found and gone answers, and stops at the first refusal', async () => {
    const wanted = Array.from({ length: 250 }, (_, i) => ref(synthId(200_000 + i), i + 1));
    const calls: number[] = [];
    const facts = (id: string): TwitchChannelFacts => ({ id, login: `synthetic_${id.slice(-6)}`, name: `Synthetic ${id.slice(-6)}`, avatarUrl: null, language: 'de', gameId: '509658', game: 'Just Chatting', title: null, live: false, viewers: null, startedAt: null, fetchedAt: 1 });
    const result = await checkArrivals(wanted, async (ids) => {
      calls.push(ids.length);
      if (calls.length === 2) return { found: ids.slice(1).map(facts), absent: [ids[0]!] };
      if (calls.length === 3) throw new LookupUnavailable('limited', 30);
      return { found: ids.map(facts), absent: [] };
    }, ASOF1, () => 5, 10);
    expect(calls).toEqual([100, 100, 50]);
    expect(result.summary).toEqual({ asked: 250, found: 199, absent: 1, unanswered: 50, reason: 'limited' });
    expect(result.arrivals[0]).toMatchObject({ status: 'found', kingdomId: wanted[0]!.toKingdomId, language: 'de', night: ASOF1, raid: { id: wanted[0]!.id, observedAt: 1 } });
    expect(result.arrivals.find((a) => a.status === 'absent')!.kingdomId).toBe(wanted[100]!.toKingdomId);
    // The deadline stops asking without failing the night.
    expect((await checkArrivals(wanted, async () => { throw new Error('never asked'); }, ASOF1, () => 10, 10)).summary).toMatchObject({ unanswered: 250, reason: 'limited' });
  });

  it('keeps answers durably and reads the first found answer per channel up to a night', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatdom-atlas-arrivals-'));
    try {
      const a = found(UNSEEN, ASOF1, ref(UNSEEN, 10));
      const b = found(UNSEEN, ASOF1 + DAY, ref(UNSEEN, 11), { login: 'synthetic_later' as FoundArrival['login'] });
      const c = found(ALSO_UNSEEN, ASOF1 + DAY, ref(ALSO_UNSEEN, 12));
      appendArrivals(dir, [a, b]);
      // A torn tail from a crash is ignored and cut off by the next append.
      writeFileSync(join(dir, 'claims', 'raid-arrivals.ndjson'), `${readFileSync(join(dir, 'claims', 'raid-arrivals.ndjson'), 'utf8')}{"version":1,`);
      expect(readArrivals(dir)).toEqual([a, b]);
      appendArrivals(dir, [c]);
      expect(readArrivals(dir)).toEqual([a, b, c]);
      expect([...foundArrivals(readArrivals(dir), ASOF1).keys()]).toEqual([UNSEEN]);
      expect(foundArrivals(readArrivals(dir), ASOF1 + DAY).get(UNSEEN)).toEqual(a);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── Staged on a temp data directory, through the real import and settle commands ──────────────────────────────

const CAPITAL = '900000000000000001';
const QUIET = '900000000000000091';
const GONE = '900000000000000092';
const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});
const rehearsalWas = process.env.ATLAS_REHEARSAL;
afterAll(() => {
  if (rehearsalWas === undefined) delete process.env.ATLAS_REHEARSAL;
  else process.env.ATLAS_REHEARSAL = rehearsalWas;
});

describe('settling with Twitch\'s answers for raided streams under the sweep', () => {
  it('asks once, grants the raided stream its pencil place under its own name, and waits when Twitch cannot answer', async () => {
    const source = FixtureSource.standard();
    const sourceDir = tempDataDir();
    const stageDir = mkdtempSync(join(tmpdir(), 'chatdom-atlas-arrival-bench-'));
    cleanup.push(() => source.close(), () => rmSync(sourceDir, { recursive: true, force: true }), () => rmSync(stageDir, { recursive: true, force: true }));
    const importInto = async (dataDir: string, at: number) => {
      const outcome = await runImport(configFor(source, dataDir), { fetchImpl: fakeSurveyor({ status: source.status(), 'raids/recent': [] }).fetchImpl, now: clock(at), sleep: async () => {} });
      if (!outcome.ok) throw new Error(`import failed: ${outcome.error.code} ${outcome.error.message}`);
      return outcome;
    };
    await importInto(sourceDir, sweepAt(10));
    const stage = runStage(sourceDir, stageDir, 'I', sweepAt(11));
    process.env.ATLAS_REHEARSAL = '1';
    const pem = readFileSync(stage.publicKeyPath, 'utf8');
    const key = founderKey(pem);
    const advance = (sweeps: number) => {
      source.addSweeps(sweeps);
      source.db.prepare('UPDATE channels SET last_live = ?, last_sweep = ? WHERE live = 1').run(sweepAt(source.sweeps - 1), source.sweeps);
    };

    // The capital raids two streams no sweep ever listed; Twitch is down for the first night.
    advance(3);
    source.addRaidObservation(sweepAt(6) + 5_000, CAPITAL, QUIET, 12, false);
    source.addRaidObservation(sweepAt(6) + 9_000, CAPITAL, GONE, 4, false);
    await importInto(stageDir, sweepAt(20));
    const asked: string[][] = [];
    const down = { channels: async (ids: readonly string[]) => { asked.push([...ids]); throw new LookupUnavailable('upstream', 5); } };
    const first = await settleWithArrivals(stageDir, pem, () => sweepAt(21), down, { allowRehearsal: true });
    expect(first).toMatchObject({ outcome: 'settled', summary: { byRaid: 0, unseenRaidTargets: 2 }, arrivals: { asked: 2, unanswered: 2, reason: 'upstream' } });
    expect(asked).toEqual([[QUIET, GONE]]);
    expect(readArrivals(stageDir)).toEqual([]);

    // The next night Twitch answers: one stream exists (German, Just Chatting), the other is gone.
    advance(2);
    const second = await importInto(stageDir, sweepAt(30));
    const quiet: TwitchChannelFacts = { id: QUIET, login: 'fixture_quiet', name: 'Fixture Quiet', avatarUrl: null, language: 'de', gameId: '509658', game: 'Just Chatting', title: null, live: false, viewers: null, startedAt: null, fetchedAt: sweepAt(31) };
    const up = { channels: async (ids: readonly string[]) => { asked.push([...ids]); return { found: ids.includes(QUIET) ? [quiet] : [], absent: ids.filter((id) => id !== QUIET) }; } };
    const was = verifyEditionDir(stageDir, 'ed-1', key, { allowRehearsal: true }).state!;
    const settled = await settleWithArrivals(stageDir, pem, () => sweepAt(31), up, { allowRehearsal: true });
    expect(settled).toMatchObject({ outcome: 'settled', revision: second.revision, summary: { byRaid: 1, byRaidArrival: 1, unseenRaidTargets: 0 }, arrivals: { asked: 2, found: 1, absent: 1, unanswered: 0, reason: null } });
    expect(asked[1]).toEqual([QUIET, GONE]);
    const report = verifyEditionDir(stageDir, 'ed-1', key, { allowRehearsal: true });
    expect(report.problems).toEqual([]);
    expect(report.state!.settlers.slice(0, was.settlers.length)).toEqual(was.settlers);
    const holding = report.state!.settlers.find((settler) => settler.kingdomId === QUIET)!;
    expect(holding).toMatchObject({ holdingTier: 'hamlet' });
    expect(checkPublication(stageDir, 'ed-1', key, true)).toEqual([]);
    if (settled.outcome !== 'settled') throw new Error('not settled');

    // On the map, in search and on its card it is land with its own name, exactly where its pencil flag stood.
    const names = readPreviewNames(stageDir, settled.publication);
    expect(names.logins[names.ids.indexOf(QUIET as never)]).toBe('fixture_quiet');
    const directory = await loadDirectory(stageDir, settled.publication);
    expect(directory.face(QUIET, new Set(), sweepAt(31))).toMatchObject({ login: 'fixture_quiet', place: 'mapped' });
    expect(directory.position(QUIET)).toEqual(holding.point);
    const card = directory.card({ login: 'fixture_quiet' }, new Set(), sweepAt(31));
    expect(card).toMatchObject({ channel: { id: QUIET, place: 'mapped' }, average: null, language: 'de', firstSeenAt: null });
    expect(directory.card({ id: QUIET }, new Set([QUIET]), sweepAt(31))).toBe('not-found');

    // Answered channels are never asked about again; a plain settle reads the same log and asks nobody.
    advance(2);
    await importInto(stageDir, sweepAt(40));
    expect(await settleWithArrivals(stageDir, pem, () => sweepAt(41), up, { allowRehearsal: true })).toMatchObject({ outcome: 'settled', arrivals: { asked: 0 } });
    expect(asked).toHaveLength(2);
    expect(runSettle(stageDir, pem, sweepAt(42), { allowRehearsal: true })).toMatchObject({ outcome: 'up-to-date', publication: expect.stringMatching(/^pv-/) });
    expect(checkPublication(stageDir, 'ed-1', key, true)).toEqual([]);
  });
});
