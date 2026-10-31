import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ATLAS_SPECTACLE, createAtlasAlignment, decodeDabsV1, decodeLiveStartsV1, decodeLiveV2, type AtlasSettler, type KingdomId,
} from '@chatdom/shared';
import { PreviewChunkSchema, PreviewWorldSchema } from '../preview/schema';
import { previewDir, readPreviewManifest } from '../preview/store';
import { buildFrame, dabHash, followsGap, holdingClass, judgeSweep, liveClassFor, SWEEP_RULE, type SweepJudgement } from './frame';
import { framePath } from './store';
import { IDS, LANDLESS, LOGINS, fixtureLand, iso, liveAt, liveSnapshot, type Land, type LiveChannelSpec } from './fixtures.test-support';

let land: Land;
beforeAll(async () => {
  land = await fixtureLand();
});
afterAll(() => land.cleanup());

const at = liveAt(1);
const now = at + 20_000;

function complete(judgement: SweepJudgement): Extract<SweepJudgement, { ok: true }> {
  if (!judgement.ok) throw new Error(`expected a complete sweep, got ${judgement.state}: ${judgement.reason}`);
  return judgement;
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

describe('judgeSweep (sweep-complete-1)', () => {
  const live: LiveChannelSpec[] = [{ id: IDS.capital, average: 6_000 }, { id: IDS.modest, average: 120 }, { id: LANDLESS[0], average: 8 }];

  it('accepts a complete sweep and carries its channels, previous sweep and rule', () => {
    const sweep = complete(judgeSweep(liveSnapshot(at, live), now));
    expect(SWEEP_RULE.id).toBe('sweep-complete-1');
    expect(sweep).toMatchObject({ ok: true, asOf: at, streams: 1_000, previousAt: at - 180_000, rejected: 0 });
    expect(sweep.channels.map((channel) => channel.id)).toEqual([IDS.capital, IDS.modest, LANDLESS[0]]);
    expect(sweep.channels[0]).toMatchObject({ language: 'en', average: 6_000, gameId: '509658', goneAt: null, startedAt: at - 3_600_000, categories: [{ gameId: '509658', minutes: 60 }] });
  });

  it('rejects a sweep that never paged below the floor as partial, and accepts it at exactly the floor margin', () => {
    const short = judgeSweep(liveSnapshot(at, live, { streams: live.length + SWEEP_RULE.minBelowFloor - 1, history: [] }), now);
    expect(short).toMatchObject({ ok: false, state: 'partial', sweepAt: at });
    expect(complete(judgeSweep(liveSnapshot(at, live, { streams: live.length + SWEEP_RULE.minBelowFloor, history: [] }), now)).asOf).toBe(at);
  });

  it('rejects a sweep whose live row was not seen by the latest sweep as incoherent', () => {
    const stale = judgeSweep(liveSnapshot(at, [...live, { id: IDS.quiet, lastLive: at - 180_000 }]), now);
    expect(stale).toMatchObject({ ok: false, state: 'incoherent', sweepAt: at });
  });

  it('rejects even one malformed live row so a live holding cannot appear offline', () => {
    const snapshot = liveSnapshot(at, live);
    for (let i = 0; i < 11; i++) snapshot.channels.push({ ...snapshot.channels[0]!, id: `not-an-id-${i}` });
    expect(judgeSweep(snapshot, now)).toMatchObject({ ok: false, state: 'incoherent', reason: '11 of 14 live rows failed validation.' });
    snapshot.channels.length = 4;
    expect(judgeSweep(snapshot, now)).toMatchObject({ ok: false, state: 'incoherent', reason: '1 of 4 live rows failed validation.' });
  });

  it('rejects a collapse below 60 % of the median of the ten previous sweeps', () => {
    // Ten earlier sweeps, five at 2,000 and five at 1,000: the median (the upper one of an even count) is 2,000.
    // The eleventh earlier sweep (10) is outside the window; counting it would lower the median to 1,000.
    const history = [2_000, 2_000, 2_000, 2_000, 2_000, 1_000, 1_000, 1_000, 1_000, 1_000, 10];
    expect(judgeSweep(liveSnapshot(at, live, { streams: 1_199, history }), now)).toMatchObject({ ok: false, state: 'partial', sweepAt: at });
    expect(complete(judgeSweep(liveSnapshot(at, live, { streams: 1_200, history }), now)).streams).toBe(1_200);
    // With fewer than three earlier sweeps there is no median to compare against.
    expect(complete(judgeSweep(liveSnapshot(at, live, { streams: 100, history: [10_000, 10_000] }), now)).streams).toBe(100);
  });

  it('rejects a latest sweep dated more than a minute in the future', () => {
    expect(judgeSweep(liveSnapshot(at, live), at - SWEEP_RULE.maxFutureMs - 1)).toMatchObject({ ok: false, state: 'future', sweepAt: at });
    expect(complete(judgeSweep(liveSnapshot(at, live), at - SWEEP_RULE.maxFutureMs)).asOf).toBe(at);
  });

  it('rejects a source with no sweep, or only malformed sweep rows, as empty', () => {
    expect(judgeSweep({ openedAt: now, readMs: 0, sweeps: [], channels: [], categories: [] }, now)).toEqual({
      ok: false, state: 'empty', sweepAt: null, reason: 'The source has recorded no sweep yet.',
    });
    const bad = liveSnapshot(at, live, { history: [] });
    bad.sweeps = [{ at: 'yesterday', streams: 5, calls: 1, ms: 1 }, { at: at - 1.5, streams: 5, calls: 1, ms: 1 }];
    expect(judgeSweep(bad, now)).toMatchObject({ ok: false, state: 'empty' });
  });

  it('keeps only real starts: malformed or later-than-the-sweep starts become unknown', () => {
    const sweep = complete(judgeSweep(liveSnapshot(at, [
      { id: IDS.capital, startedAt: '2026-10-29 12:00' }, { id: IDS.modest, startedAt: iso(at + 1_000) }, { id: IDS.quiet, startedAt: null },
    ]), now));
    expect(sweep.channels.map((channel) => channel.startedAt)).toEqual([null, null, null]);
  });

  it('flags a frame that follows a gap of more than two sweep cadences', () => {
    const regular = complete(judgeSweep(liveSnapshot(at, live), now));
    expect(followsGap(regular)).toBe(false);
    expect(followsGap({ ...regular, previousAt: at - 361_000 })).toBe(true);
    expect(followsGap({ ...regular, previousAt: null })).toBe(false);
  });
});

describe('live classes', () => {
  it('maps observed averages at the 5,000 / 500 / 50 / 25 / 5 thresholds', () => {
    const cases: [number, number][] = [
      [100_000, 1], [5_000, 1], [4_999.99, 2], [500, 2], [499.5, 3], [50, 3], [49.9, 4], [25, 4], [24.99, 5], [5, 5], [0, 5],
    ];
    for (const [average, liveClass] of cases) expect([average, liveClassFor(average)]).toEqual([average, liveClass]);
  });

  it('lets a holding grow at most one tier beyond its own (capital 0 … village 3)', () => {
    // A huge audience: the capital and a city may show as capital, a town as a city, a village as a town.
    expect([0, 1, 2, 3].map((rank) => holdingClass(90_000, rank))).toEqual([1, 1, 2, 3]);
    // A village past 500 shows as a town, never as a city.
    expect(holdingClass(600, 3)).toBe(3);
    // Small audiences show as they are, whatever the holding.
    expect([0, 1, 2, 3].map((rank) => holdingClass(30, rank))).toEqual([4, 4, 4, 4]);
    expect([0, 1, 2, 3].map((rank) => holdingClass(7, rank))).toEqual([5, 5, 5, 5]);
    expect(holdingClass(60, 3)).toBe(3);
  });
});

describe('buildFrame', () => {
  const GAMBLING_GAME = '498566';
  const withheld = new Set([IDS.town, LANDLESS[2]]);
  const channels: LiveChannelSpec[] = [
    { id: IDS.capital, average: 6_000 },
    { id: IDS.bright, average: 6_000, startedAt: null },
    { id: IDS.modest, average: 6_000 },
    { id: IDS.quiet, average: 600, goneAt: at - 60_000 },
    { id: IDS.village, average: 300, gameId: GAMBLING_GAME, lang: 'de' },
    { id: IDS.town, average: 60, lang: 'ja' },
    // Without land.
    { id: IDS.small, average: 8, startedAt: iso(at - 600_000) },
    { id: LANDLESS[0], average: 12, lang: 'xx', startedAt: iso(at - 900_000) },
    { id: LANDLESS[1], average: 9, gameId: GAMBLING_GAME },
    { id: LANDLESS[2], average: 9 },
    { id: LANDLESS[3], average: 6, startedAt: null },
    { id: '800000000000000009', average: 7, goneAt: at - 1_000 },
    { id: '800000000000000010', average: 5, lang: 'de', startedAt: iso(at - 120_000) },
  ];

  async function built(list: readonly LiveChannelSpec[] = channels, gate: ReadonlySet<string> = withheld) {
    const sweep = complete(judgeSweep(liveSnapshot(at, list), now));
    const frame = await buildFrame(land.target, sweep, gate, now);
    const paths = {
      live: framePath(land.previewId, frame.frameId, 'live'),
      starts: framePath(land.previewId, frame.frameId, 'starts'),
      dabs: framePath(land.previewId, frame.frameId, 'dabs'),
    };
    return { sweep, frame, manifest: frame.manifest(paths) };
  }

  it('paints classes per holding, gates gone, gambling and withheld channels to 0, and never writes a spectacle', async () => {
    const { frame, manifest } = await built();
    const { target } = land;
    const live = await decodeLiveV2(frame.live, manifest, target.alignment);
    const ord = (id: string) => target.ordinalOf.get(id)!;
    const classOf = (id: string) => live[ord(id) * 2];
    expect(live.byteLength).toBe(target.ids.length * 2);
    expect({
      capital: classOf(IDS.capital), bright: classOf(IDS.bright), modest: classOf(IDS.modest),
      quiet: classOf(IDS.quiet), village: classOf(IDS.village), town: classOf(IDS.town),
    }).toEqual({ capital: 1, bright: 1, modest: 2, quiet: 0, village: 0, town: 0 });
    for (let i = 1; i < live.length; i += 2) expect(live[i]).toBe(ATLAS_SPECTACLE.none);
    expect(frame.counts).toEqual({
      live: 3, byClass: [2, 1, 0, 0, 0], dabs: 3, startsUnknown: 1,
      gated: { gone: 2, gambling: 2, withheld: 2 }, dabsWithoutStart: 1, dabsOverLimit: 0,
    });

    const starts = await decodeLiveStartsV1(frame.starts, manifest, target.alignment, live);
    expect(starts.asOf).toBe(at);
    expect(starts.entries).toEqual([
      { ordinal: ord(IDS.capital), startedAt: at - 3_600_000 },
      { ordinal: ord(IDS.bright), startedAt: null },
      { ordinal: ord(IDS.modest), startedAt: at - 3_600_000 },
    ].sort((a, b) => a.ordinal - b.ordinal));
  });

  it('writes dabs with only realm, hash and start, hashed from the decimal ID and in canonical order', async () => {
    const { frame, manifest } = await built();
    const dabs = await decodeDabsV1(frame.dabs, manifest, land.target.alignment);
    expect(manifest.dabs.count).toBe(3);
    for (const dab of dabs) expect(Object.keys(dab).sort()).toEqual(['channelHash', 'realmIndex', 'startedAt']);
    const expected = [
      { realmIndex: land.target.realmFor({ id: IDS.small, language: 'en', categories: [] }), channelHash: sha(IDS.small).slice(0, 16), startedAt: at - 600_000 },
      { realmIndex: land.target.realmFor({ id: LANDLESS[0], language: 'xx', categories: [] }), channelHash: sha(LANDLESS[0]).slice(0, 16), startedAt: at - 900_000 },
      { realmIndex: land.target.realmFor({ id: '800000000000000010', language: 'de', categories: [] }), channelHash: sha('800000000000000010').slice(0, 16), startedAt: at - 120_000 },
    ].sort((a, b) => a.realmIndex - b.realmIndex || (a.channelHash < b.channelHash ? -1 : 1));
    expect(dabs).toEqual(expected);
    expect(dabHash(IDS.small)).toBe(sha(IDS.small).slice(0, 16));
    // English waits on its own isle, an unknown language on the Outer Isles, German on its isle.
    const realms = land.target.world.realms;
    expect(realms[expected.find((dab) => dab.channelHash === sha(LANDLESS[0]).slice(0, 16))!.realmIndex]!.kind).toBe('outer');
    expect(new Set(dabs.map((dab) => dab.realmIndex)).size).toBe(3);
  });

  it('puts no login, display name or channel ID into any of the three artifacts or the manifest', async () => {
    const { frame, manifest } = await built();
    const blobs = [Buffer.from(frame.live), Buffer.from(frame.starts), Buffer.from(frame.dabs), Buffer.from(JSON.stringify(manifest))];
    const needles = [...LOGINS, 'Fixture', 'fixture', ...Object.values(IDS), ...LANDLESS, '800000000000000010'];
    for (const blob of blobs) for (const needle of needles) expect(blob.includes(needle), needle).toBe(false);
  });

  it('aligns the manifest with createAtlasAlignment over the preview\'s own settler order', async () => {
    const { frame, manifest } = await built();
    const dir = previewDir(land.dataDir, land.previewId);
    const worldBytes = readFileSync(join(dir, readPreviewManifest(land.dataDir, land.previewId).world.path));
    const world = PreviewWorldSchema.parse(JSON.parse(worldBytes.toString('utf8')));
    const ids = [...world.head.ids];
    for (const region of world.regions) ids.push(...PreviewChunkSchema.parse(JSON.parse(readFileSync(join(dir, region.chunk.path), 'utf8'))).settlers.ids);
    expect(ids).toEqual(land.target.ids);
    const settlers: AtlasSettler[] = ids.map((kingdomId, ordinal) => ({
      ordinal, kingdomId: kingdomId as KingdomId, holdingId: `h${ordinal}`, realmIndex: 0, holdingTier: 'village', point: { x: 0, y: 0 }, settledAt: world.asOf,
    }));
    const alignment = await createAtlasAlignment({
      version: 1, id: land.previewId, label: 'Survey preview', status: 'preview', foundedAt: world.asOf, worldHash: sha256Bytes(worldBytes), realmCount: world.realms.length,
    }, settlers);
    expect(manifest.alignment).toEqual(alignment);
    expect(manifest.alignment.settlerOrderHash).toBe(sha(`chatdom:atlas-settler-order:v1\n${ids.map((id) => `${id}\n`).join('')}`));
    expect(manifest).toMatchObject({
      version: 1, evidence: { kind: 'observed', asOf: at }, publishedAt: now, realmCount: world.realms.length, coverage: 'complete-sweep',
      live: { format: 'live-v2', byteLength: ids.length * 2 }, starts: { format: 'live-starts-v1' }, dabs: { format: 'dabs-v1', byteLength: 3 * 20 },
    });
    expect(frame.frameId).toMatch(/^lf-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}$/);
  });

  it('is deterministic: the same sweep in any row order builds the same bytes and frame ID', async () => {
    const a = await built();
    const b = await built([...channels].reverse());
    expect(b.frame.frameId).toBe(a.frame.frameId);
    expect(Buffer.from(b.frame.dabs).equals(Buffer.from(a.frame.dabs))).toBe(true);
    expect(Buffer.from(b.frame.starts).equals(Buffer.from(a.frame.starts))).toBe(true);
    // A different withheld list is a different frame.
    const c = await built(channels, new Set());
    expect(c.frame.frameId).not.toBe(a.frame.frameId);
    expect(c.frame.counts.gated.withheld).toBe(0);
  });

  it('never dates publication before the observation it carries', async () => {
    const sweep = complete(judgeSweep(liveSnapshot(at, channels), now));
    const frame = await buildFrame(land.target, sweep, withheld, at - 5_000);
    expect(frame.manifest({ live: '/v1/live/a/live.bin', starts: '/v1/live/a/starts.json', dabs: '/v1/live/a/dabs.bin' }).publishedAt).toBe(at);
  });
});

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
