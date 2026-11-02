import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { PencilPlaces } from '../cartography/pencil-place';
import { currentNamesText, namesRefOf } from '../cartography/names-ref';
import { currentTaxonomyText, loadTaxonomy } from '../cartography/taxonomy';
import { loadDirectory } from '../directory/directory';
import type { TwitchChannelFacts, TwitchLookup } from '../directory/twitch-lookup';
import { runImport } from '../import';
import { dabHash } from '../live/frame';
import { loadLiveTarget, tierRadius } from '../live/target';
import type { PreviewFiles } from '../preview/build';
import { PreviewChunkSchema, TIER_CODES, type SettlerColumns } from '../preview/schema';
import { prunePreviews, previewDir, verifyPreviewDir } from '../preview/store';
import { createAtlasService, type AtlasServiceOptions } from '../serve';
import { FixtureSource, clock, configFor, fakeSurveyor, sweepAt, tempDataDir } from '../test/fixture-source';
import { allowRealImports } from '../test/timeouts';
import { MANIFEST_FILE, pruneRevisions, revisionDir } from '../store/revisions';
import { founderKey, signAuthorization } from './authorization';
import { appendClaim, readClaims, witnessedRoadRaids, type Claim } from './claims';
import { checkPublication, runPublish, runSettle, runStage } from './commands';
import { draftEdition, foundingRecord } from './found';
import { extendLedger, type LedgerState } from './ledger';
import { buildEditionPublication, editionAddress, readPublished, writePublication } from './publish';
import { editionContext, editionPencilPlace, holdingRadius, settleNight } from './settle';
import { readEditionFiles, verifyEditionDir } from './store';
import { verifyEdition } from './verify';
import { DAY, HOUR, T0, planChannels, raid, revision, synthId, testKeys, type ChannelSpec, type Revision } from './fixtures.test-support';

allowRealImports();

const TAXONOMY = currentTaxonomyText();
const TAXONOMY_REF = loadTaxonomy(TAXONOMY).ref;
const decoder = new TextDecoder();

// ── 1. The publication of a founded edition, as pure functions ────────────────────────────────────────────────

const ASOF1 = T0 + 8 * DAY;
const FOUNDED_AT = ASOF1 + HOUR;
const BASE: ChannelSpec[] = planChannels([{ code: 'de', candidates: 40, small: 10 }, { code: 'ja', candidates: 12, small: 4 }], 23);
const rev1 = revision({ asOf: ASOF1, specs: BASE, tag: 'publication' });
const keys = testKeys();

function found(rev: Revision, withheld: ReadonlySet<string> = new Set()) {
  const draft = draftEdition({ number: 'I', manifest: rev.manifest, channels: rev.channels, games: rev.games, taxonomyText: TAXONOMY, foundedAt: FOUNDED_AT, withheld });
  const authorization = signAuthorization({
    kind: 'chatdom-atlas-founding-authorization', edition: 'I', revision: rev.manifest.revision, taxonomySha256: TAXONOMY_REF.sha256, issuedAt: FOUNDED_AT, issuedBy: 'test_founder',
  }, keys.privatePem);
  const founding = foundingRecord(draft, 'I', rev.manifest, authorization, founderKey(keys.publicPem).fingerprint, 'none', namesRefOf(currentNamesText()));
  const address = editionAddress({ edition: draft.edition, foundingBytes: `${JSON.stringify(founding, null, 2)}\n`, taxonomyText: draft.taxonomyText, ledgerText: draft.ledgerText });
  return { draft, founding, address, ctx: editionContext(draft.world, loadTaxonomy(TAXONOMY)) };
}
type Founded = ReturnType<typeof found>;

const publish = (f: Founded, state: LedgerState, rev: Revision) => buildEditionPublication({
  edition: f.draft.edition, founding: f.founding, world: f.draft.world, address: f.address, state, manifest: rev.manifest, channels: rev.channels,
});

interface Row { file: string; index: number; tier: number; x: number; y: number; realm: number; founded: boolean }

/** Every drawn holding of a publication, read back from its own files. */
function rowsOf(publication: PreviewFiles): Map<string, Row> {
  const files: [string, SettlerColumns][] = [
    ['world.json', publication.world.head],
    ...publication.world.regions.map((region): [string, SettlerColumns] => [
      region.chunk.path, PreviewChunkSchema.parse(JSON.parse(decoder.decode(publication.files.get(region.chunk.path)!))).settlers,
    ]),
  ];
  const rows = new Map<string, Row>();
  for (const [file, columns] of files) {
    columns.ids.forEach((id, index) => rows.set(id, {
      file, index, tier: columns.tier[index]!, x: columns.x[index]!, y: columns.y[index]!, realm: columns.realm[index]!, founded: index < (columns.founded ?? columns.ids.length),
    }));
  }
  return rows;
}

/** The parts of a published world that are the edition's land: everything but the night's facts and file pins. */
function land(publication: PreviewFiles) {
  const rest: Partial<PreviewFiles['world']> = { ...publication.world };
  for (const key of ['id', 'revision', 'asOf', 'window', 'coverage', 'counts', 'founding', 'policy', 'head', 'regions'] as const) delete rest[key];
  return { ...rest, regions: publication.world.regions.map((region) => ({ ...region, chunk: undefined })) };
}

describe('an edition publication', () => {
  const f = found(rev1);

  it('draws the founded night byte for byte the same, every holding at its granted point and holding tier', () => {
    const a = publish(f, f.draft.state, rev1);
    const b = publish(found(rev1), f.draft.state, rev1);
    expect(b.id).toBe(a.id);
    expect([...b.files.keys()]).toEqual([...a.files.keys()]);
    for (const [name, bytes] of a.files) expect(Buffer.from(b.files.get(name)!).equals(Buffer.from(bytes))).toBe(true);
    expect(a.world).toMatchObject({
      status: 'edition', label: 'Edition I', revision: rev1.manifest.revision,
      founding: {
        status: 'founded', edition: 'ed-1', label: 'Edition I', foundedAt: FOUNDED_AT, worldHash: f.draft.edition.worldHash, address: f.address, rehearsal: false,
        ledger: { lines: f.draft.state.lines, settlers: f.draft.settlers.length, head: f.draft.state.head }, night: { revision: rev1.manifest.revision, asOf: ASOF1 },
      },
    });
    const rows = rowsOf(a);
    expect(rows.size).toBe(f.draft.settlers.length);
    for (const settler of f.draft.settlers) {
      expect(rows.get(settler.kingdomId)).toMatchObject({
        tier: TIER_CODES.indexOf(settler.holdingTier), x: settler.point.x * 20, y: settler.point.y * 20, realm: settler.realmIndex, founded: true,
      });
    }
    // Capitals and cities ride in world.json; towns, villages and hamlets in their region's file.
    for (const row of rows.values()) expect(row.file === 'world.json').toBe(row.tier <= 1);
    // The publication's geometry is the founded world's, field for field.
    const geometry: Partial<typeof f.draft.world> = { ...f.draft.world };
    for (const key of ['version', 'kind', 'edition', 'revision', 'asOf', 'regions'] as const) delete geometry[key];
    expect(land(a)).toEqual({ version: 1, kind: a.world.kind, label: 'Edition I', status: 'edition', ...geometry, regions: f.draft.world.regions.map((region) => ({ ...region, chunk: undefined })) });
  });

  it('writes and verifies like a survey preview, and the map pointer names the edition', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'chatdom-atlas-publication-'));
    try {
      const publication = publish(f, f.draft.state, rev1);
      const pointer = {
        edition: 'ed-1', label: 'Edition I', address: f.address, revision: rev1.manifest.revision, asOf: ASOF1, head: f.draft.state.head,
        lines: f.draft.state.lines, foundedAt: FOUNDED_AT, worldHash: f.draft.edition.worldHash, rehearsal: false,
      };
      expect(writePublication(dataDir, publication, pointer)).toBe('written');
      expect(writePublication(dataDir, publication, pointer)).toBe('existing');
      expect(verifyPreviewDir(previewDir(dataDir, publication.id), { id: publication.id, revision: rev1.manifest.revision })).toEqual([]);
      expect(readPublished(dataDir)).toEqual({ version: 1, ...pointer, preview: publication.id });
      // Retention never removes the publication the map is drawn from, even with its revision gone.
      expect(prunePreviews(dataDir, new Set())).toEqual([]);
      expect(verifyPreviewDir(previewDir(dataDir, publication.id), { id: publication.id, revision: rev1.manifest.revision })).toEqual([]);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('moves nobody on a settlement night: founded holdings keep their file place, point and tier; new land follows them', () => {
    const settled = f.draft.settlers;
    const hidden = settled[5]!.kingdomId;
    const raised = new Set(BASE.filter((spec) => spec.average >= 25).slice(0, 6).map((spec) => spec.n));
    const small = BASE.find((spec) => spec.language === 'de' && spec.average < 25)!;
    const raider = Number(settled[1]!.kingdomId.slice(1));
    const rev2 = revision({
      asOf: ASOF1 + DAY, tag: 'publication-night',
      specs: [
        ...BASE.map((spec) => (raised.has(spec.n) ? { ...spec, average: spec.average * 40 } : spec)),
        { n: 2001, language: 'de', average: 260 }, { n: 2002, language: 'ja', average: 31 }, { n: 2003, language: 'de', average: 7_500 },
      ],
      raids: [raid(raider, small.n, ASOF1 + 2 * HOUR)],
    });
    const night = settleNight({
      number: 'I', ctx: f.ctx, state: f.draft.state, manifest: rev2.manifest, channels: rev2.channels, raidPairs: [], raidObservations: rev2.raidObservations, withheld: new Set([hidden]),
    });
    expect(night.summary).toMatchObject({ settled: 4, byRaid: 1, tombstones: 1 });
    const next = extendLedger(f.draft.state, night.events).next;
    const before = rowsOf(publish(f, f.draft.state, rev1));
    const publication = publish(f, next, rev2);
    const after = rowsOf(publication);
    for (const [id, row] of before) expect(after.get(id)).toEqual(row);
    const added = [...after.entries()].filter(([id]) => !before.has(id));
    expect(added.map(([id]) => id).sort()).toEqual([synthId(2001), synthId(2002), synthId(2003), synthId(small.n)].sort());
    for (const [, row] of added) expect(row.founded).toBe(false);
    // A capital granted tonight is still drawn at its holding tier, and the raided stream as a hamlet.
    expect(after.get(synthId(2003))!.tier).toBe(TIER_CODES.indexOf('capital'));
    expect(after.get(synthId(small.n))!.tier).toBe(TIER_CODES.indexOf('hamlet'));
    expect(publication.world.counts.hamlet).toBe(1);
    expect(land(publication)).toEqual(land(publish(f, f.draft.state, rev1)));
    // Hidden land keeps its ground, drawn bare: listed as tombstoned and never named.
    expect(after.has(hidden)).toBe(true);
    expect(publication.names.tombstoned).toEqual([hidden]);
    expect(publication.names.ids).not.toContain(hidden);
    expect(publication.world.founding).toMatchObject({ status: 'founded', ledger: { settlers: f.draft.settlers.length + 4 }, night: { revision: rev2.manifest.revision } });
  });

  it('grants a raided stream the slot at its own pencil place: where the map already drew it, the road keeps its end', () => {
    const small = BASE.filter((spec) => spec.language === 'ja' && spec.average < 25).map((spec) => spec.n);
    const raider = Number(f.draft.settlers.find((settler) => f.draft.world.regions[f.draft.world.realms[settler.realmIndex]!.region]!.language === 'ja')!.kingdomId.slice(1));
    const rev2 = revision({ asOf: ASOF1 + DAY, tag: 'pencil-grant', specs: BASE, raids: small.map((n, i) => raid(raider, n, ASOF1 + (i + 1) * HOUR)) });
    const night = settleNight({ number: 'I', ctx: f.ctx, state: f.draft.state, manifest: rev2.manifest, channels: rev2.channels, raidPairs: [], raidObservations: rev2.raidObservations, withheld: new Set() });
    expect(night.summary.byRaid).toBe(small.length);
    // The pencil places the map draws from the published founding night, computed the way the service and the
    // browser compute them: the founded holdings are the pencil base.
    const publication = publish(f, f.draft.state, rev1);
    const rows = rowsOf(publication);
    const pencil = new PencilPlaces(publication.world);
    for (const event of night.events) {
      if (event.kind !== 'settle') continue;
      const realm = event.settler.realmIndex;
      const region = f.draft.world.realms[realm]!.region;
      const base = [...rows.values()].filter((row) => row.founded && f.draft.world.realms[row.realm]!.region === region)
        .map((row) => ({ x: row.x / 20, y: row.y / 20, r: tierRadius(publication.world, row.tier) }));
      const drawn = pencil.forRegion(region, base).place(dabHash(event.settler.kingdomId), realm);
      expect(editionPencilPlace(f.ctx, f.draft.state, realm, event.settler.kingdomId)).toEqual(drawn);
      expect(event.settler.point).toEqual(drawn);
    }
    expect(holdingRadius(f.draft.world, 'village')).toBe(tierRadius(publication.world, TIER_CODES.indexOf('village')));
  });

  it('grants a claim at its pencil place, on the survey\'s facts or the facts it arrived with, once per channel', () => {
    const small = BASE.find((spec) => spec.language === 'de' && spec.average < 25)!;
    const claim = (kingdomId: string, cause: Claim['cause'], claimedAt: number, language = 'de'): Claim => ({
      version: 1, kind: 'chatdom-atlas-claim', kingdomId: kingdomId as Claim['kingdomId'], cause, claimedAt, receivedAt: claimedAt, language, categories: [], facts: 'twitch',
    });
    const rev2 = revision({ asOf: ASOF1 + DAY, tag: 'claims', specs: BASE });
    const unseen = synthId(4_444);
    const claims = [claim(synthId(small.n), 'signed-in', ASOF1 + HOUR), claim(synthId(small.n), 'founded', ASOF1 + 2 * HOUR), claim(unseen, 'signed-in', ASOF1 + 3 * HOUR, 'ja'),
      claim(f.draft.settlers[0]!.kingdomId, 'signed-in', ASOF1 + 4 * HOUR)];
    const night = settleNight({ number: 'I', ctx: f.ctx, state: f.draft.state, manifest: rev2.manifest, channels: rev2.channels, raidPairs: [], raidObservations: [], withheld: new Set(), claims });
    expect(night.summary).toMatchObject({ settled: 2, byClaim: 2, byRaid: 0 });
    const grants = night.events.filter((event) => event.kind === 'settle');
    expect(grants.map((event) => [event.settler.kingdomId, event.reason, event.settler.holdingTier])).toEqual([[synthId(small.n), 'signed-in', 'hamlet'], [unseen, 'signed-in', 'hamlet']]);
    const japan = f.draft.world.realms.find((realm) => f.draft.world.regions[realm.region]!.language === 'ja')!.index;
    expect(grants[1]!.settler.realmIndex).toBe(japan);
    for (const event of grants) expect(event.settler.point).toEqual(editionPencilPlace(f.ctx, f.draft.state, event.settler.realmIndex, event.settler.kingdomId));
    // Edition 0 grants nothing by claim, and a claim from a withheld channel waits.
    expect(settleNight({ number: '0', ctx: f.ctx, state: f.draft.state, manifest: rev2.manifest, channels: rev2.channels, raidPairs: [], raidObservations: [], withheld: new Set(), claims }).summary.byClaim).toBe(0);
    expect(settleNight({ number: 'I', ctx: f.ctx, state: f.draft.state, manifest: rev2.manifest, channels: rev2.channels, raidPairs: [], raidObservations: [], withheld: new Set([unseen]), claims }).summary.byClaim).toBe(1);
    // Verification accepts claims in Edition I and refuses them anywhere earlier.
    const { text } = extendLedger(f.draft.state, night.events);
    const files = { edition: f.draft.edition, worldBytes: f.draft.worldBytes, taxonomyText: f.draft.taxonomyText, ledgerText: f.draft.ledgerText + text, heads: [], founding: null };
    expect(verifyEdition(files, null).problems.filter((problem) => !problem.includes('no head acknowledges'))).toEqual([]);
  });

  it('keeps continent labels out of the geometry: the world hash names the land, not its names', () => {
    const before = found(rev1).draft;
    expect(before.edition.worldHash).toBe(f.draft.edition.worldHash);
    // A language's land is named by its code in the frozen bytes; the continent name table is applied at reading
    // time, so a reviewed rename of a continent never changes the world hash or anybody's holding.
    for (const region of before.world.regions) {
      if (region.language === null) continue;
      expect([region.name, region.englishName]).toEqual([region.language, region.language]);
    }
    for (const realm of before.world.realms) if (realm.kind === 'isle') expect(realm.name).toBe(before.world.regions[realm.region]!.language);
    expect(decoder.decode(before.worldBytes)).not.toContain(namesRefOf(currentNamesText()).id);
  });
});

describe('witnessed road raids', () => {
  it('reads raid-show\'s observed raids from the road ledger, never the recorder\'s, a simulation or an aggregate', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'chatdom-atlas-roads-'));
    try {
      const observed = (id: string, source: string, at: number, evidence: object = { kind: 'observed', asOf: at }) => ({
        body: {
          kind: 'observation', canonicalId: id, recovered: false,
          raid: { version: 1, id, fromKingdomId: synthId(1), toKingdomId: synthId(2), viewers: 12, observedAt: at, occurredAt: at, evidence, delivery: 'resumable', source },
        },
      });
      const lines = [
        observed('r:herald:1', 'herald', T0 + HOUR), observed('r:rec:1', 'surveyor-recorder', T0 + HOUR), observed('r:sim:1', 'simulation', T0 + HOUR),
        observed('r:herald:old', 'herald', T0 - HOUR), observed('r:herald:late', 'herald', T0 + 3 * HOUR),
        { body: { kind: 'baseline', pairs: [] } },
      ];
      const roads = join(dataDir, 'roads');
      mkdirSync(roads, { recursive: true });
      writeFileSync(join(roads, 'ledger.ndjson'), `${lines.map((line) => JSON.stringify(line)).join('\n')}\n{"torn":`);
      const raids = witnessedRoadRaids(dataDir, T0, T0 + 2 * HOUR);
      expect(raids.map((r) => r.id)).toEqual(['r:herald:1']);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

// ── 2. Edition I staged on a temp data directory, served, claimed and settled ────────────────────────────────

const CAPITAL = '900000000000000001';
const TOWN = '900000000000000002';
const VILLAGE = '900000000000000003';
const SMALL = '900000000000000004';
const TINY = '900000000000000005';
const SIGNED = '900000000000000006';
const NEWCOMER = '900000000000000007';
const UNSEEN = '900000000000000098';
const STRANGER = '900000000000000097';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});
const rehearsalWas = process.env.ATLAS_REHEARSAL;
afterAll(() => {
  if (rehearsalWas === undefined) delete process.env.ATLAS_REHEARSAL;
  else process.env.ATLAS_REHEARSAL = rehearsalWas;
});

interface Reply { status: number; headers: Record<string, string | string[] | undefined>; text: string }

function call(port: number, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: init.method ?? 'GET', headers: init.headers ?? {} }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (chunk: Buffer) => parts.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(parts).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(init.body);
  });
}

async function serve(dataDir: string, options: AtlasServiceOptions = {}) {
  const service = createAtlasService(dataDir, () => {}, { twitchLookup: null, now: () => sweepAt(12), ...options });
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => service.ingest.listen(0, '127.0.0.1', resolve));
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await service.close();
  };
  cleanup.push(close);
  return { port: (service.server.address() as AddressInfo).port, ingest: (service.ingest.address() as AddressInfo).port, close };
}

const facts = (id: string, language: string): TwitchChannelFacts => ({
  id, login: `fixture_${id.slice(-2)}`, name: `Fixture ${id.slice(-2)}`, avatarUrl: null, language, gameId: '509658', game: 'Just Chatting',
  title: null, live: false, viewers: null, startedAt: null, fetchedAt: sweepAt(12),
});
const lookup = (known: Record<string, TwitchChannelFacts>): TwitchLookup => ({
  lookup: async (query) => (known[query.replace(/^id:/, '')] ? [known[query.replace(/^id:/, '')]!] : []),
  close: () => {},
});

describe('Edition I staged on a temp data directory', () => {
  async function bench() {
    const source = FixtureSource.standard();
    source.addChannel({ id: TINY, login: 'fixture_tiny', name: 'Fixture Tiny', firstSweep: 1, lastSweep: 4, live: true, liveMin: 10, viewerMin: 70 });
    source.addChannel({ id: SIGNED, login: 'fixture_signed', name: 'Fixture Signed', lang: 'de', firstSweep: 1, lastSweep: 3, live: false, liveMin: 10, viewerMin: 60 });
    const sourceDir = tempDataDir();
    const stageDir = mkdtempSync(join(tmpdir(), 'chatdom-atlas-bench-'));
    cleanup.push(() => source.close(), () => rmSync(sourceDir, { recursive: true, force: true }), () => rmSync(stageDir, { recursive: true, force: true }));
    const importInto = async (dataDir: string, at: number) => {
      const outcome = await runImport(configFor(source, dataDir), { fetchImpl: fakeSurveyor({ status: source.status(), 'raids/recent': [] }).fetchImpl, now: clock(at), sleep: async () => {} });
      if (!outcome.ok) throw new Error(`import failed: ${outcome.error.code} ${outcome.error.message}`);
      return outcome;
    };
    const first = await importInto(sourceDir, sweepAt(10));
    const sourceManifest = readFileSync(join(revisionDir(sourceDir, first.revision), MANIFEST_FILE));
    const stage = runStage(sourceDir, stageDir, 'I', sweepAt(11));
    // The source data directory is only read.
    expect(readFileSync(join(revisionDir(sourceDir, first.revision), MANIFEST_FILE)).equals(sourceManifest)).toBe(true);
    return { source, sourceDir, stageDir, stage, first, importInto };
  }

  it('founds a rehearsal that every verifier and service refuses unless it runs as a bench', async () => {
    const { stageDir, stage, first } = await bench();
    expect(stage.founding).toMatchObject({ revision: first.revision, settlers: 3, hidden: 0, publication: expect.stringMatching(/^pv-/) });
    expect(stage.nights).toEqual([]);
    // What the rehearsal could not pass is written down in its founding record.
    for (const reason of [/needs 168\.0 h/, /reviewed family taxonomy/, /reviewed continent name table/]) expect(stage.waived.some((problem) => reason.test(problem))).toBe(true);
    expect(readEditionFiles(stageDir, 'ed-1').founding!.rehearsal).toEqual({ waived: stage.waived });
    const pem = readFileSync(stage.publicKeyPath, 'utf8');
    const key = founderKey(pem);
    expect(verifyEditionDir(stageDir, 'ed-1', key).problems).toEqual([expect.stringMatching(/rehearsal/)]);
    expect(verifyEditionDir(stageDir, 'ed-1', key, { allowRehearsal: true }).problems).toEqual([]);
    expect(checkPublication(stageDir, 'ed-1', key, true)).toEqual([]);
    expect(checkPublication(stageDir, 'ed-1', key, false)).toEqual([expect.stringMatching(/rehearsal/)]);
    expect(() => runSettle(stageDir, pem, sweepAt(12), { allowRehearsal: false })).toThrow(/failed verification/);

    delete process.env.ATLAS_REHEARSAL;
    const plain = await serve(stageDir);
    expect(await call(plain.port, '/map-data/v1/preview')).toMatchObject({ status: 503, text: '{"error":"no-preview"}' });
    await plain.close();

    process.env.ATLAS_REHEARSAL = '1';
    const benchService = await serve(stageDir);
    const pointer = await call(benchService.port, '/map-data/v1/preview');
    expect(pointer.status).toBe(200);
    expect(JSON.parse(pointer.text)).toMatchObject({
      id: stage.founding.publication, revision: first.revision,
      edition: { id: 'ed-1', label: 'Edition I', address: stage.founding.address, foundedAt: sweepAt(11) },
    });
    const world = await call(benchService.port, `/map-data/v1/preview/${stage.founding.publication}/world.json`);
    expect(JSON.parse(world.text)).toMatchObject({ status: 'edition', label: 'Edition I', founding: { status: 'founded', rehearsal: true } });
  });

  it('takes sign-in claims durably, once, with the facts that decide their realm', async () => {
    const { stageDir } = await bench();
    process.env.ATLAS_REHEARSAL = '1';
    const service = await serve(stageDir, { ingestToken: 'claim-token', twitchLookup: lookup({ [UNSEEN]: facts(UNSEEN, 'ja') }), now: () => sweepAt(12) });
    const auth = { authorization: 'Bearer claim-token', 'content-type': 'application/json' };
    const post = (body: unknown, headers: Record<string, string> = auth) => call(service.ingest, '/v1/claims', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
    const claim = (kingdomId: string, cause = 'signed-in') => ({ version: 1, kingdomId, cause, claimedAt: sweepAt(12) - 1_000 });

    expect((await post(claim(SIGNED), { 'content-type': 'application/json' })).status).toBe(401);
    expect(await post('{"version":1,')).toMatchObject({ status: 422, text: '{"kind":"invalid","reason":"json"}' });
    expect(await post({ ...claim(SIGNED), place: { x: 1, y: 2 } })).toMatchObject({ status: 422, text: '{"kind":"invalid","reason":"schema"}' });
    expect(await post({ ...claim(SIGNED), claimedAt: sweepAt(12) + HOUR })).toMatchObject({ status: 422 });
    expect(await post(claim(STRANGER))).toMatchObject({ status: 422, text: '{"kind":"invalid","reason":"unknown-channel"}' });
    expect(readClaims(stageDir)).toEqual([]);

    const recorded = await post(claim(SIGNED));
    expect(recorded.status).toBe(202);
    expect(JSON.parse(recorded.text)).toEqual({ kind: 'recorded', kingdomId: SIGNED, cause: 'signed-in', settles: 'next-survey' });
    expect(JSON.parse((await post(claim(SIGNED))).text)).toMatchObject({ kind: 'duplicate' });
    const racing = await Promise.all([post(claim(SIGNED, 'founded')), post(claim(SIGNED, 'founded'))]);
    expect(racing.map((reply) => reply.status).sort()).toEqual([200, 202]);
    expect((await post(claim(UNSEEN))).status).toBe(202);
    const lines = readFileSync(join(stageDir, 'claims', 'claims.ndjson'), 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(readClaims(stageDir).map((c) => [c.kingdomId, c.cause, c.language, c.facts])).toEqual([
      [SIGNED, 'signed-in', 'de', 'survey'], [SIGNED, 'founded', 'de', 'survey'], [UNSEEN, 'signed-in', 'ja', 'twitch'],
    ]);
    // A channel the survey never saw is named by the lookup, so its holding carries its name on the map.
    expect(readClaims(stageDir).map((c) => [c.login, c.name])).toEqual([[undefined, undefined], [undefined, undefined], ['fixture_98', 'Fixture 98']]);
    await service.close();

    // A restarted service still knows what it recorded; without any source of facts it asks the producer to retry.
    const blind = await serve(stageDir, { ingestToken: 'claim-token', twitchLookup: null, now: () => sweepAt(13) });
    const retry = await call(blind.ingest, '/v1/claims', { method: 'POST', headers: auth, body: JSON.stringify(claim(STRANGER)) });
    expect(retry).toMatchObject({ status: 503, text: '{"kind":"facts-unavailable"}' });
    expect(retry.headers['retry-after']).toBe('300');
    expect(JSON.parse((await call(blind.ingest, '/v1/claims', { method: 'POST', headers: auth, body: JSON.stringify(claim(UNSEEN)) })).text)).toMatchObject({ kind: 'duplicate' });
    // A torn tail from a crash is ignored, and the next claim starts on its own line.
    writeFileSync(join(stageDir, 'claims', 'claims.ndjson'), `${lines.join('\n')}\n{"version":1,"kind":`);
    expect(readClaims(stageDir)).toHaveLength(3);
    appendClaim(stageDir, { ...readClaims(stageDir)[2]!, kingdomId: TINY as Claim['kingdomId'] }, new Set());
    expect(readClaims(stageDir).map((c) => c.kingdomId)).toEqual([SIGNED, SIGNED, UNSEEN, TINY]);
  });

  it('settles a night after founding that moves nobody, slots in a newcomer, grants claims and raids at their pencil place, and keeps every place across restarts', async () => {
    const { source, stageDir, stage, importInto } = await bench();
    process.env.ATLAS_REHEARSAL = '1';
    const pem = readFileSync(stage.publicKeyPath, 'utf8');
    const key = founderKey(pem);
    const pub1 = stage.founding.publication;
    appendClaim(stageDir, {
      version: 1, kind: 'chatdom-atlas-claim', kingdomId: SIGNED as Claim['kingdomId'], cause: 'signed-in', claimedAt: sweepAt(11) + 1, receivedAt: sweepAt(11) + 2,
      language: 'de', categories: [], facts: 'survey',
    }, new Set());

    // Before the night: the waiting channels stand at their pencil places, searched the same by every restart.
    const first = await serve(stageDir);
    const searchTiny = async (port: number, preview: string) => {
      const reply = JSON.parse((await call(port, `/map-data/v1/preview/${preview}/search?q=fixture_tiny`)).text) as { results: unknown[] };
      return reply.results;
    };
    const tinyBefore = await searchTiny(first.port, pub1);
    expect(tinyBefore).toEqual([expect.objectContaining({ channel: expect.objectContaining({ id: TINY, place: 'waiting' }) })]);
    await first.close();
    const again = await serve(stageDir);
    expect(await searchTiny(again.port, pub1)).toEqual(tinyBefore);
    await again.close();
    const before = await loadDirectory(stageDir, pub1);
    const places = Object.fromEntries([CAPITAL, TOWN, VILLAGE, SMALL, TINY, SIGNED].map((id) => [id, before.position(id)]));
    expect(before.face(SMALL, new Set(), sweepAt(12))).toMatchObject({ place: 'waiting' });

    // A later survey: a newcomer, the capital raids the small stream, the signed-in streamer claimed land.
    source.addSweeps(3);
    source.db.prepare('UPDATE channels SET last_live = ?, last_sweep = ? WHERE live = 1').run(sweepAt(7), 8);
    source.addChannel({ id: NEWCOMER, login: 'fixture_newcomer', name: 'Fixture Newcomer', firstSweep: 5, lastSweep: 7, live: true, liveMin: 9, viewerMin: 3_600 });
    source.addRaidObservation(sweepAt(6) + 5_000, CAPITAL, SMALL, 40, true);
    const second = await importInto(stageDir, sweepAt(20));
    // A fresh survey preview never replaces the founded map.
    const meanwhile = await serve(stageDir);
    expect(JSON.parse((await call(meanwhile.port, '/map-data/v1/preview')).text)).toMatchObject({ id: pub1, edition: { id: 'ed-1' } });
    await meanwhile.close();

    // Retention keeps the revision the map is still drawn from beside the current one, however few it keeps.
    expect(pruneRevisions(stageDir, 1)).toEqual([]);
    const wasState = verifyEditionDir(stageDir, 'ed-1', key, { allowRehearsal: true }).state!;
    const settled = runSettle(stageDir, pem, sweepAt(21), { allowRehearsal: true });
    expect(settled).toMatchObject({ outcome: 'settled', edition: 'ed-1', revision: second.revision, summary: { settled: 3, byRaid: 1, byClaim: 1, tombstones: 0, deferred: 0 } });
    if (settled.outcome !== 'settled') throw new Error('not settled');
    const pub2 = settled.publication;
    expect(pub2).not.toBe(pub1);
    const report = verifyEditionDir(stageDir, 'ed-1', key, { allowRehearsal: true });
    expect(report.problems).toEqual([]);
    // Zero moves: every holding of the founding night is exactly as it was.
    expect(report.state!.settlers.slice(0, wasState.settlers.length)).toEqual(wasState.settlers);
    const grants = report.state!.settlers.slice(wasState.settlers.length);
    expect(grants.map((settler) => [settler.kingdomId, settler.holdingTier])).toEqual([[NEWCOMER, 'town'], [SIGNED, 'hamlet'], [SMALL, 'hamlet']]);
    expect(checkPublication(stageDir, 'ed-1', key, true)).toEqual([]);

    const after = await loadDirectory(stageDir, pub2);
    for (const id of [CAPITAL, TOWN, VILLAGE]) expect(after.position(id)).toEqual(places[id]);
    // Granted where search showed them: the raided stream and the signed-in streamer hold their pencil place, so a
    // road drawn to the small stream before tonight ends on its holding now.
    for (const id of [SMALL, SIGNED]) {
      const holding = grants.find((settler) => settler.kingdomId === id)!;
      expect(holding.point).toEqual(places[id]);
      expect(after.position(id)).toEqual(places[id]);
      expect(after.face(id, new Set(), sweepAt(21))).toMatchObject({ place: 'mapped' });
    }
    // Still waiting, still at the same place: the pencil base is the founding, so tonight's grants move no pencil.
    expect(after.position(TINY)).toEqual(places[TINY]);
    const target = await loadLiveTarget(stageDir, pub2);
    expect(target.holdingGeometry).toHaveLength(3);
    expect(target.holdingPoints).toHaveLength(6);

    // The service now draws the new night under the same edition, and every restart agrees.
    const served = await serve(stageDir);
    const pointer = JSON.parse((await call(served.port, '/map-data/v1/preview')).text) as { id: string; edition: { id: string; address: string } };
    expect(pointer).toMatchObject({ id: pub2, edition: { id: 'ed-1', address: stage.founding.address } });
    expect(await searchTiny(served.port, pub2)).toEqual(tinyBefore.map((result) => ({ ...(result as object) })));
    await served.close();
    const restarted = await serve(stageDir);
    expect(JSON.parse((await call(restarted.port, '/map-data/v1/preview')).text)).toEqual(pointer);
    // Adoption is idempotent: publishing the same head again changes nothing.
    expect(runPublish(stageDir, pem)).toEqual({ id: pub2, address: stage.founding.address, outcome: 'existing' });
    expect(runSettle(stageDir, pem, sweepAt(22), { allowRehearsal: true })).toMatchObject({ outcome: 'up-to-date', publication: pub2 });
  });
});
