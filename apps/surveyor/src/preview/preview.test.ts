import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { compareIds } from '../export/project';
import {
  EDITION_0_MIN_MS, EDITION_I_MIN_MS, SNAPSHOT_KIND, SnapshotManifestSchema, isKingdomCandidate,
  type ChannelObservation, type Game, type SnapshotManifest,
} from '../export/schema';
import { GAMBLING_POLICY, publicVisibility } from '../policy/visibility';
import { currentTaxonomy } from '../cartography/taxonomy';
import { buildPreview, languageNames, previewChannels, previewIdFor, type PreviewFiles } from './build';
import { DECOR_KINDS, DECOR_SPACING, insideLand, ringArea, ringBox, type RingBox } from './land';
import { CONTINENT_MIN_CANDIDATES, HOLDING_RADIUS, layoutPreview, type Layout, type Tier } from './layout';
import {
  ISLES_NAME, PREVIEW_ALGORITHM, PREVIEW_KIND, PREVIEW_LABEL, PreviewChunkSchema, PreviewManifestSchema, PreviewNamesSchema,
  PreviewWorldSchema, TIER_CODES, type PreviewChunk, type PreviewNames, type PreviewWorld, type SettlerColumns,
} from './schema';
import { PREVIEW_MANIFEST, previewDir, previewsRoot, prunePreviews, verifyPreviewDir, writePreview } from './store';
import { allowRealImports } from '../test/timeouts';

allowRealImports();

// ── A deterministic synthetic survey ──────────────────────────────────────────────────────────────────────────
// Clearly fake channels shaped like a Surveyor export: several thousand channels, languages either side of the
// continent threshold, a few big categories and a long tail, every tier including its exact boundaries, plus
// non-candidates and gone channels that must never reach the map.

const T0 = 1_793_288_700_000;
const HOUR = 3_600_000;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Main categories with their share of channels; the remainder is the long tail, unnamed or none. */
const BIG_GAMES: readonly [string, string, number][] = [
  ['509658', 'Just Chatting', 0.3],
  ['21779', 'League of Legends', 0.18],
  ['32982', 'Grand Theft Auto V', 0.12],
  ['516575', 'VALORANT', 0.1],
  ['27471', 'Minecraft', 0.08],
];
/** Twitch sometimes reports a category with an empty name: it stays real, with the name unknown. */
const UNNAMED_GAME = '1469308723';
const TAIL_GAMES = Array.from({ length: 40 }, (_, k) => [`${90_000 + k}`, `Tail Category ${k}`] as const);
/** Only non-candidates stream it, so it must never reach the preview's games table. */
const UNUSED_GAME: Game = { gameId: '4444', name: 'Only Small Streams' };
/** Twitch's gambling categories as the policy lists them. */
const SLOTS = '498566';
const VIRTUAL_CASINO = '29452';
const POKER = '488190';

interface LanguagePlan {
  code: string;
  /** Mapped candidates (not gone). */
  candidates: number;
  gone?: number;
  small?: number;
}

interface Synthetic {
  manifest: SnapshotManifest;
  channels: ChannelObservation[];
  games: Game[];
}

const NAME_PREFIX: Record<string, string> = { ja: '配信者', ko: '방송', de: 'Kanal', es: 'Canal', pt: 'Canal', fr: 'Chaîne' };

/** Unique decimal IDs of mixed length (7–10 digits), so ID ordering is exercised, not just string order. */
const channelId = (n: number) => `${1 + (n % 9)}${String(n).padStart(6 + (n % 4), '0')}`;

function synthesize(plans: readonly LanguagePlan[], seed: number, revision = 'obs-20261030T004500Z-0123456789ab', asOf = T0 + 9 * HOUR): Synthetic {
  const rand = mulberry32(seed);
  const channels: ChannelObservation[] = [];
  let n = 1;
  const pickMain = (): string | null => {
    let roll = rand();
    for (const [gameId, , share] of BIG_GAMES) {
      if (roll < share) return gameId;
      roll -= share;
    }
    if (roll < 0.06) return UNNAMED_GAME;
    if (roll < 0.19) return TAIL_GAMES[Math.floor(rand() * TAIL_GAMES.length)]![0];
    return null;
  };
  const push = (language: string, liveMinutes: number, viewerMinutes: number, opts: { gone?: boolean; main?: string | null; categories?: ChannelObservation['categories']; stream?: ChannelObservation['stream'] } = {}) => {
    const id = n++;
    const main = opts.main === undefined ? pickMain() : opts.main;
    let categories = opts.categories;
    if (!categories) {
      categories = [];
      if (main !== null) {
        const minutes = Math.max(1, Math.round(liveMinutes * 0.6));
        categories.push({ gameId: main, minutes });
        if (rand() < 0.5) {
          const other = TAIL_GAMES[Math.floor(rand() * TAIL_GAMES.length)]![0];
          if (other !== main) categories.push({ gameId: other, minutes: Math.max(0, minutes - 1 - Math.floor(rand() * minutes)) });
        }
      }
    }
    channels.push({
      kingdomId: channelId(id) as ChannelObservation['kingdomId'],
      login: `synthetic_${id}`,
      displayName: `${NAME_PREFIX[language] ?? 'Channel'} ${id}`,
      language,
      firstSeenAt: T0,
      lastLiveAt: asOf - HOUR,
      liveMinutes,
      viewerMinutes,
      averageViewers: liveMinutes > 0 ? round2(viewerMinutes / liveMinutes) : 0,
      peakViewers: liveMinutes > 0 ? Math.ceil(viewerMinutes / liveMinutes) : 0,
      kingdomCandidate: isKingdomCandidate(liveMinutes, viewerMinutes),
      live: false,
      stream: opts.stream ?? null,
      categories: categories.sort((a, b) => compareIds(a.gameId, b.gameId)),
      avatarUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/preview-fresh-70x70.png',
      avatarFactsAt: asOf - HOUR,
      factsAt: asOf - HOUR,
      goneAt: opts.gone ? asOf - 2 * HOUR : null,
      contentClassification: 'unknown',
    });
  };
  const candidate = (language: string, i: number, gone = false) => {
    const liveMinutes = 30 + Math.floor(rand() * 2000);
    const roll = rand();
    // The first channel of a sizeable language is its capital; otherwise a skewed spread over all tiers.
    const [lo, hi] = i === 0 ? [5_000, 40_000] : roll < 0.006 ? [5_000, 40_000] : roll < 0.07 ? [500, 5_000] : roll < 0.4 ? [50, 500] : [25, 50];
    const average = lo + rand() * (hi - lo);
    push(language, liveMinutes, Math.max(Math.round(average * liveMinutes), 25 * liveMinutes), { gone });
  };
  for (const plan of plans) {
    let made = 0;
    if (plan.code === 'en') {
      // Exact tier boundaries: 5000 capital, 4999.97 city, 500 city, 499.97 town, 50 town, 49.97 village, 25 village.
      for (const viewerMinutes of [500_000, 499_997, 50_000, 49_997, 5_000, 4_997, 2_500]) {
        push('en', 100, viewerMinutes);
        made++;
      }
      // Equal minutes in two categories: the lower category ID is the main one (21779 before 516575).
      push('en', 120, 12_000, { main: null, categories: [{ gameId: '516575', minutes: 60 }, { gameId: '21779', minutes: 60 }] });
      made++;
      // R16 gambling: a little Slots among mostly Just Chatting stays mapped …
      push('en', 200, 20_000, { main: null, categories: [{ gameId: '509658', minutes: 180 }, { gameId: SLOTS, minutes: 20 }] });
      made++;
      // … while a Slots channel, a channel with a quarter of its minutes in Virtual Casino, and one whose latest
      // stream was Poker never reach the map, whatever their audience.
      push('en', 300, 3_000_000, { main: null, categories: [{ gameId: SLOTS, minutes: 300 }] });
      push('en', 200, 40_000, { main: null, categories: [{ gameId: '509658', minutes: 150 }, { gameId: VIRTUAL_CASINO, minutes: 50 }] });
      push('en', 200, 40_000, {
        main: null, categories: [{ gameId: '509658', minutes: 200 }],
        stream: { gameId: POKER, game: 'Poker', title: null, viewers: null, startedAt: null },
      });
      // Just below the candidate rule: observed, never mapped.
      push('en', 100, 2_499);
    }
    for (let i = made; i < plan.candidates; i++) candidate(plan.code, i);
    for (let i = 0; i < (plan.gone ?? 0); i++) candidate(plan.code, 1 + i, true);
    for (let i = 0; i < (plan.small ?? 0); i++) {
      const liveMinutes = i % 37 === 0 ? 0 : 10 + Math.floor(rand() * 500);
      const main = i % 11 === 0 ? UNUSED_GAME.gameId : undefined;
      push(plan.code, liveMinutes, Math.floor(rand() * 24.99 * liveMinutes), main === undefined ? {} : { main });
    }
  }
  channels.sort((a, b) => compareIds(a.kingdomId, b.kingdomId));
  const games: Game[] = [
    ...BIG_GAMES.map(([gameId, name]) => ({ gameId, name })),
    { gameId: UNNAMED_GAME, name: null },
    ...TAIL_GAMES.map(([gameId, name]) => ({ gameId, name })),
    UNUSED_GAME,
    { gameId: SLOTS, name: 'Slots' }, { gameId: VIRTUAL_CASINO, name: 'Virtual Casino' }, { gameId: POKER, name: 'Poker' },
  ].sort((a, b) => compareIds(a.gameId, b.gameId));
  const file = (path: string) => ({ path, sha256: '0'.repeat(64), bytes: 0, records: 0 });
  const manifest = SnapshotManifestSchema.parse({
    version: 1, kind: SNAPSHOT_KIND, revision, contentHash: 'a'.repeat(64), importedAt: asOf + 60_000, asOf,
    window: { firstObservationAt: T0, lastObservationAt: asOf, hours: round2((asOf - T0) / HOUR), sweeps: 180, cadenceMs: 180_000, gapCount: 0, gaps: [] },
    coverage: {
      sweep: { method: 'helix-get-streams-by-viewers', floorViewers: 5, note: 'Synthetic test survey.' },
      raidWatch: { enabled: true, watching: 0, verified: 0, costTotal: 0, costMax: 10_000, liveCandidates: 0, note: 'Synthetic.' },
      recorder: { enabled: false, keepDays: 7, frames: 0, firstFrameAt: null, lastFrameAt: null },
      contentLabels: 'not-collected',
      sourceSettledHoldings: 0,
      missing: ['Synthetic test survey: no real channel is described.'],
    },
    founding: { status: 'not-founded', edition0EligibleAt: T0 + EDITION_0_MIN_MS, editionIEligibleAt: T0 + EDITION_I_MIN_MS, observedMs: asOf - T0 },
    source: {
      http: { base: 'http://surveyor.test/atlas/api/', readAt: asOf + 1_000, statusSince: T0, statusSweeps: 180, statusLastSweepAt: asOf, statusChannels: channels.length, statusLiveNow: 0, recentPairs: 0, recentPairsMatched: 0 },
      database: { path: '/synthetic/surveyor.db', bytes: 0, walBytes: null, readOnly: true, transaction: 'single-read', openedAt: asOf + 2_000, readMs: 1, sweeps: 180, lagSweeps: 0 },
    },
    counts: {
      channels: channels.length, kingdomCandidates: channels.filter((c) => c.kingdomCandidate).length, liveChannels: 0, liveCandidates: 0,
      games: games.length, categoryRows: 0, raidPairs: 0, raidObservations: 0, raidObservationsBetweenCandidates: 0,
      avatarsDropped: 0, streamsExpired: 0, rejected: {}, rejectedSamples: [],
    },
    retention: { streamFactsMaxOfflineMs: 86_400_000, avatarMaxAgeMs: 86_400_000, keepRevisions: 3 },
    files: {
      channels: file('channels.ndjson'), games: file('games.ndjson'), raidPairs: file('raid-pairs.ndjson'),
      raidObservations: file('raid-observations.ndjson'), sweeps: file('sweeps.ndjson'),
    },
  });
  return { manifest, channels, games };
}

/**
 * en has exactly the continent threshold and pt one below it once its gone channels are left out, so both sides of
 * R4's rule are exercised. ko has only small streams and it only gone ones: neither may get land.
 */
const MAIN_PLAN: LanguagePlan[] = [
  { code: 'en', candidates: CONTINENT_MIN_CANDIDATES, gone: 6, small: 900 },
  { code: 'es', candidates: 640, gone: 4, small: 600 },
  { code: 'pt', candidates: CONTINENT_MIN_CANDIDATES - 1, gone: 5, small: 300 },
  { code: 'de', candidates: 120, small: 200 },
  { code: 'ja', candidates: 48, small: 150 },
  { code: 'fr', candidates: 20, small: 60 },
  { code: 'other', candidates: 6, small: 20 },
  { code: 'ko', candidates: 0, small: 80 },
  { code: 'it', candidates: 0, gone: 7 },
];
const SMALL_PLAN: LanguagePlan[] = [
  { code: 'de', candidates: 40, gone: 2, small: 30 },
  { code: 'ja', candidates: 12, small: 10 },
  { code: 'fr', candidates: 5 },
];

// ── Reading the preview back the way a client would ───────────────────────────────────────────────────────────

const decodeRing = (points: readonly number[], scale: number) => {
  const out: number[] = [];
  let x = 0;
  let y = 0;
  for (let p = 0; p < points.length; p += 2) {
    x += points[p]!;
    y += points[p + 1]!;
    out.push(x / scale, y / scale);
  }
  return out;
};

interface Holding { id: string; login: string; name: string; tier: Tier; x: number; y: number; average: number; game: number; region: number; file: string }

function holdings(columns: SettlerColumns, file: string, scale: number, names: PreviewNames): Holding[] {
  const index = new Map(names.ids.map((id, i) => [id as string, i]));
  return columns.ids.map((id, i) => ({
    id, login: names.logins[index.get(id)!]!, name: names.names[index.get(id)!]!, tier: TIER_CODES[columns.tier[i]!]!,
    x: columns.x[i]! / scale, y: columns.y[i]! / scale, average: columns.average[i]!, game: columns.game[i]!, region: columns.region[i]!, file,
  }));
}

interface Decoded {
  world: PreviewWorld;
  chunks: PreviewChunk[];
  names: PreviewNames;
  all: Holding[];
  rings: { points: number[]; box: RingBox; area: number; region: number }[];
}

function decode(preview: PreviewFiles): Decoded {
  const text = (name: string) => new TextDecoder().decode(preview.files.get(name)!);
  const world = PreviewWorldSchema.parse(JSON.parse(text('world.json')));
  const chunks = world.regions.map((region) => PreviewChunkSchema.parse(JSON.parse(text(region.chunk.path))));
  const names = PreviewNamesSchema.parse(JSON.parse(text('names.json')));
  const all = [
    ...holdings(world.head, 'head', world.coordScale, names),
    ...chunks.flatMap((chunk) => holdings(chunk.settlers, `region-${chunk.region}`, world.coordScale, names)),
  ];
  const rings = world.coasts.map((coast) => {
    const points = decodeRing(coast.points, world.coordScale);
    return { points, box: ringBox(points), area: Math.abs(ringArea(points)), region: coast.region };
  });
  return { world, chunks, names, all, rings };
}

/**
 * Problems with "one language, one landmass": a holding not inside any coast, a holding whose innermost coast is
 * tagged with another region, or a coast holding more than one language.
 */
function sharedLandmasses({ world, all, rings }: Decoded): string[] {
  const problems: string[] = [];
  const contains = (ring: Decoded['rings'][number], x: number, y: number) =>
    x >= ring.box.minX && x <= ring.box.maxX && y >= ring.box.minY && y <= ring.box.maxY && insideLand([ring], x, y);
  const languagesOnRing = new Map<number, Set<string>>();
  for (const holding of all) {
    // The innermost ring around a holding is the landmass it stands on (an island in a lake is its own land).
    let best = -1;
    for (const [index, ring] of rings.entries()) {
      if (contains(ring, holding.x, holding.y) && (best < 0 || ring.area < rings[best]!.area)) best = index;
    }
    if (best < 0) {
      problems.push(`${holding.id} is on no landmass`);
      continue;
    }
    if (rings[best]!.region !== holding.region) problems.push(`${holding.id} stands on a coast of region ${rings[best]!.region}`);
    const set = languagesOnRing.get(best) ?? new Set<string>();
    set.add(world.regions[holding.region]!.language ?? 'outer');
    languagesOnRing.set(best, set);
  }
  for (const [ring, languages] of languagesOnRing) if (languages.size > 1) problems.push(`coast ${ring} holds ${[...languages].join(' + ')}`);
  return problems;
}

/** Regions that belong to a language: everything but the empty Outer Isles. */
const spoken = (world: PreviewWorld) => world.regions.filter((region) => region.language !== null);

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

function expectedTier(average: number): Tier {
  if (average >= 5_000) return 'capital';
  if (average >= 500) return 'city';
  if (average >= 50) return 'town';
  return 'village';
}

/** Main category as R4 defines it: most observed minutes; equal minutes go to the lower category ID. */
function expectedMain(channel: ChannelObservation): string | null {
  const sorted = [...channel.categories].sort((a, b) => b.minutes - a.minutes || compareIds(a.gameId, b.gameId));
  return sorted[0]?.gameId ?? null;
}

// ── Tests ─────────────────────────────────────────────────────────────────────────────────────────────────────

let input: Synthetic;
let preview: PreviewFiles;
let decoded: Decoded;
let layout: Layout;

beforeAll(() => {
  input = synthesize(MAIN_PLAN, 0xc0ffee);
  preview = buildPreview(input);
  decoded = decode(preview);
  layout = layoutPreview(previewChannels(input.channels, currentTaxonomy()).mapped);
});

describe('survey preview build', () => {
  it('runs on a survey of several thousand channels with non-candidates and gone channels', () => {
    expect(input.channels.length).toBeGreaterThan(4_000);
    expect(input.channels.filter((c) => !c.kingdomCandidate).length).toBeGreaterThan(2_000);
    expect(input.channels.filter((c) => c.kingdomCandidate && c.goneAt !== null).length).toBe(22);
    expect(new Set(input.channels.map((c) => c.kingdomId)).size).toBe(input.channels.length);
  });

  it('is deterministic and content-addressed: the same revision gives byte-identical files and the same ID', () => {
    // Input order is not part of the revision's identity: shuffle channels and games, rebuild.
    const rand = mulberry32(7);
    const shuffle = <T>(list: readonly T[]) => list.map((item) => [rand(), item] as const).sort((a, b) => a[0] - b[0]).map(([, item]) => item);
    const again = buildPreview({ manifest: input.manifest, channels: shuffle(input.channels), games: shuffle(input.games) });
    expect(again.id).toBe(preview.id);
    expect([...again.files.keys()].sort()).toEqual([...preview.files.keys()].sort());
    for (const [name, bytes] of preview.files) expect(sha(again.files.get(name)!), name).toBe(sha(bytes));
    expect(again.manifest).toEqual(preview.manifest);

    const stamp = '20261030T004500Z';
    expect(new Date(input.manifest.asOf).toISOString()).toBe('2026-10-30T00:45:00.000Z');
    const expectedId = `pv-${stamp}-${sha(`${PREVIEW_KIND}:${PREVIEW_ALGORITHM}:${input.manifest.revision}`).slice(0, 12)}`;
    expect(preview.id).toBe(expectedId);
    expect(previewIdFor(input.manifest.revision, input.manifest.asOf)).toBe(expectedId);
    // Another revision is another preview; the ID never depends on the channels themselves.
    expect(previewIdFor('obs-20261030T004500Z-ffffffffffff', input.manifest.asOf)).not.toBe(expectedId);
    expect(preview.id.slice(-12)).toBe(sha(`${PREVIEW_KIND}:${PREVIEW_ALGORITHM}:${input.manifest.revision}`).slice(0, 12));
  });

  it('pins every file by hash: the manifest pins world.json and names.json, world.json pins every region chunk', () => {
    const { world, names } = decoded;
    expect(PreviewManifestSchema.parse(preview.manifest)).toEqual(preview.manifest);
    const worldBytes = preview.files.get('world.json')!;
    expect(preview.manifest.world).toEqual({ path: 'world.json', sha256: sha(worldBytes), bytes: worldBytes.byteLength, records: world.head.ids.length });
    const namesBytes = preview.files.get('names.json')!;
    expect(preview.manifest.names).toEqual({ path: 'names.json', sha256: sha(namesBytes), bytes: namesBytes.byteLength, records: names.ids.length });
    expect([...preview.files.keys()].sort()).toEqual(['world.json', 'names.json', ...world.regions.map((r) => `region-${r.index}.json`)].sort());
    for (const region of world.regions) {
      const bytes = preview.files.get(region.chunk.path)!;
      expect(region.chunk).toEqual({ path: `region-${region.index}.json`, sha256: sha(bytes), bytes: bytes.byteLength, records: decoded.chunks[region.index]!.settlers.ids.length });
    }
    expect(preview.manifest).toMatchObject({ id: preview.id, revision: input.manifest.revision, asOf: input.manifest.asOf });
  });

  it('is schema-valid, labelled as a survey preview and never as a founded or simulated edition', () => {
    const { world, chunks } = decoded;
    expect(world).toMatchObject({
      version: 1, kind: PREVIEW_KIND, id: preview.id, algorithm: PREVIEW_ALGORITHM, status: 'preview',
      label: 'Survey preview · land awaiting founding', revision: input.manifest.revision, asOf: input.manifest.asOf,
      founding: { status: 'not-founded', edition0EligibleAt: T0 + 48 * HOUR, editionIEligibleAt: T0 + 7 * 24 * HOUR },
      coverage: { sweepFloorViewers: 5, candidateMinAverage: 25, contentLabels: 'not-collected', missing: input.manifest.coverage.missing },
      window: { firstObservationAt: T0, lastObservationAt: input.manifest.asOf, hours: 9, sweeps: 180, gapCount: 0 },
      coordScale: 20,
      tiers: { minAverage: { capital: 5_000, city: 500, town: 50, village: 25 }, holdingRadius: HOLDING_RADIUS },
    });
    expect(PREVIEW_LABEL).toBe('Survey preview · land awaiting founding');
    for (const chunk of chunks) expect(chunk).toMatchObject({ version: 1, kind: `${PREVIEW_KIND}-region`, preview: preview.id });
    const text = [...preview.files.values()].map((bytes) => new TextDecoder().decode(bytes)).join('\n');
    expect(text).not.toMatch(/SIMULATED|edition-0|"founded"/i);
    // Canonical bytes: one JSON document per file with a final newline, exactly as the schema re-encodes it.
    expect(new TextDecoder().decode(preview.files.get('world.json'))).toBe(`${JSON.stringify(world)}\n`);
  });

  it('maps every kingdom candidate that passes the visibility gate exactly once, and nothing else', () => {
    const { world, all } = decoded;
    const mapped = input.channels.filter((c) => c.kingdomCandidate && publicVisibility(c) === 'public');
    const excluded = input.channels.filter((c) => !c.kingdomCandidate || publicVisibility(c) !== 'public');
    expect(all.length).toBe(mapped.length);
    expect(new Set(all.map((h) => h.id)).size).toBe(all.length);
    expect(new Set(all.map((h) => h.id))).toEqual(new Set(mapped.map((c) => c.kingdomId)));
    const drawn = new Set(all.map((h) => h.id));
    for (const channel of excluded) expect(drawn.has(channel.kingdomId), channel.kingdomId).toBe(false);
    // Gone, gambling and small channels leave no trace at all: not their ID, login or name.
    const text = [...preview.files.values()].map((bytes) => new TextDecoder().decode(bytes)).join('\n');
    for (const channel of excluded) {
      expect(text.includes(`"${channel.login}"`), channel.login).toBe(false);
      expect(text.includes(`"${channel.kingdomId}"`), channel.kingdomId).toBe(false);
    }
    expect(world.counts).toMatchObject({ channelsObserved: input.channels.length, mapped: mapped.length, languages: 7 });

    // Every holding carries its own channel's facts.
    const byId = new Map(mapped.map((c) => [c.kingdomId as string, c]));
    for (const holding of all) {
      const channel = byId.get(holding.id)!;
      expect(holding).toMatchObject({ login: channel.login, name: channel.displayName, average: Math.round(channel.averageViewers) });
      expect(world.regions[holding.region]!.language).toBe(channel.language);
      const main = expectedMain(channel);
      expect(holding.game === -1 ? null : world.games[holding.game]!.gameId).toBe(main);
    }
  });

  it('R16: gambling channels and categories never reach the map, and the preview records the policy it used', () => {
    const { world, all } = decoded;
    const candidates = input.channels.filter((c) => c.kingdomCandidate && c.goneAt === null);
    const gambling = candidates.filter((c) => publicVisibility(c) === 'gambling');
    // The Slots channel, the quarter-Virtual-Casino channel and the one whose latest stream was Poker.
    expect(gambling).toHaveLength(3);
    expect(gambling.some((c) => c.averageViewers >= 5_000)).toBe(true);
    const drawn = new Set(all.map((h) => h.id));
    for (const channel of gambling) expect(drawn.has(channel.kingdomId)).toBe(false);
    // A tenth of the minutes in Slots is not a gambling channel.
    const occasional = candidates.find((c) => c.categories.some((g) => g.gameId === SLOTS) && c.categories.length === 2);
    expect(occasional && drawn.has(occasional.kingdomId)).toBe(true);
    expect(world.policy).toEqual({ gambling: GAMBLING_POLICY.version, excludedGambling: 3 });
    for (const game of world.games) expect(GAMBLING_POLICY.gameIds as readonly string[]).not.toContain(game.gameId);
  });

  it('R16: the immutable files hold geometry by channel ID and no raw name; names.json alone carries them, dated', () => {
    const { world, chunks, names, all } = decoded;
    const immutable = ['world.json', ...world.regions.map((r) => r.chunk.path)].map((name) => new TextDecoder().decode(preview.files.get(name)!)).join('\n');
    for (const bytes of preview.files.values()) expect(new TextDecoder().decode(bytes)).not.toMatch(/jtvnw\.net|avatarUrl|avatarFactsAt|portrait/);
    for (const holding of all) {
      expect(immutable.includes(`"${holding.login}"`), holding.login).toBe(false);
      expect(immutable.includes(`"${holding.name}"`), holding.name).toBe(false);
    }
    for (const columns of [world.head, ...chunks.map((c) => c.settlers)]) expect(Object.keys(columns).sort()).toEqual(['average', 'game', 'ids', 'realm', 'region', 'tier', 'x', 'y']);
    // names.json: exactly the drawn holdings in ID order, each with the moment the source last confirmed it.
    expect(names.ids).toEqual(all.map((h) => h.id).sort(compareIds));
    const byId = new Map(input.channels.map((c) => [c.kingdomId as string, c]));
    names.ids.forEach((id, i) => expect(names.factsAt[i]).toBe(byId.get(id)!.factsAt));
    expect(names).toMatchObject({ version: 1, kind: `${PREVIEW_KIND}-names`, preview: preview.id, revision: input.manifest.revision });
  });

  it('assigns tiers by the R5 thresholds; the head holds capitals and cities, each chunk its own towns and villages', () => {
    const { world, chunks, all } = decoded;
    const byId = new Map(input.channels.map((c) => [c.kingdomId as string, c]));
    for (const holding of all) expect(holding.tier, holding.id).toBe(expectedTier(byId.get(holding.id)!.averageViewers));
    // The exact boundaries land on the right side.
    const tierOfAverage = (average: number) => all.find((h) => byId.get(h.id)!.averageViewers === average)?.tier;
    expect([5_000, 4_999.97, 500, 499.97, 50, 49.97, 25].map(tierOfAverage)).toEqual(['capital', 'city', 'city', 'town', 'town', 'village', 'village']);
    expect(all.some((h) => byId.get(h.id)!.averageViewers === 24.99)).toBe(false);

    const head = all.filter((h) => h.file === 'head');
    expect(head.length).toBe(all.filter((h) => h.tier === 'capital' || h.tier === 'city').length);
    expect(new Set(head.map((h) => h.tier))).toEqual(new Set(['capital', 'city']));
    for (const chunk of chunks) {
      const inChunk = all.filter((h) => h.file === `region-${chunk.region}`);
      expect(inChunk.every((h) => (h.tier === 'town' || h.tier === 'village') && h.region === chunk.region)).toBe(true);
      expect(inChunk.length).toBe(all.filter((h) => h.region === chunk.region && (h.tier === 'town' || h.tier === 'village')).length);
    }
    for (const tier of TIER_CODES) {
      const count = all.filter((h) => h.tier === tier).length;
      expect(world.counts[tier], tier).toBe(count);
      expect(count, tier).toBeGreaterThan(0);
    }
  });

  it('R4: languages with at least 600 candidates are continents, smaller ones isles in the Isles of Many Tongues', () => {
    const { world } = decoded;
    const kinds = Object.fromEntries(spoken(world).map((r) => [r.language, r.kind]));
    expect(kinds).toEqual({ en: 'continent', es: 'continent', pt: 'isle', de: 'isle', ja: 'isle', fr: 'isle', other: 'isle' });
    const members = Object.fromEntries(spoken(world).map((r) => [r.language, r.members]));
    expect(members).toEqual({ en: 600, es: 640, pt: 599, de: 120, ja: 48, fr: 20, other: 6 });
    expect(world.regions.map((r) => r.index)).toEqual(world.regions.map((_, i) => i));

    // The archipelago is one named place that holds every isle; continents and the archipelago never overlap.
    expect(world.isles).not.toBeNull();
    const isles = world.isles!;
    expect(isles.name).toBe(ISLES_NAME);
    expect(ISLES_NAME).toBe('The Isles of Many Tongues');
    const s = world.coordScale;
    for (const region of world.regions.filter((r) => r.kind === 'isle')) {
      expect(Math.hypot(region.x - isles.x, region.y - isles.y) + region.r, region.language ?? undefined).toBeLessThanOrEqual(isles.r + 2);
    }
    const discs = [...world.regions.filter((r) => r.kind === 'continent'), { ...isles, language: 'isles' }];
    for (let i = 0; i < discs.length; i++) {
      for (let j = i + 1; j < discs.length; j++) {
        const a = discs[i]!;
        const b = discs[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y) / s, `${a.language}/${b.language}`).toBeGreaterThan((a.r + b.r) / s);
      }
    }
    // Isles are separate islands: their discs never overlap.
    const isleRegions = world.regions.filter((r) => r.kind === 'isle');
    for (let i = 0; i < isleRegions.length; i++) {
      for (let j = i + 1; j < isleRegions.length; j++) {
        const a = isleRegions[i]!;
        const b = isleRegions[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.language}/${b.language}`).toBeGreaterThan(a.r + b.r);
      }
    }
  });

  it('R4: each language stands on its own landmass, never sharing a coast with another language', () => {
    expect(sharedLandmasses(decoded)).toEqual([]);
    // Tiny isles packed close together: the smooth union and the coastal noise once fused all of them into one
    // island painted in a single language's colour. Several seeds, because the noise decides where bridges form.
    const tiny: LanguagePlan[] = [
      { code: 'de', candidates: 1 }, { code: 'ja', candidates: 1 }, { code: 'fr', candidates: 2 }, { code: 'ko', candidates: 3 }, { code: 'it', candidates: 1 },
    ];
    for (const seed of [1, 2, 3]) {
      const built = decode(buildPreview(synthesize(tiny, seed)));
      expect(spoken(built.world)).toHaveLength(5);
      expect(sharedLandmasses(built), `seed ${seed}`).toEqual([]);
    }
  });

  it('keeps retained v4 geometry readable while v5 moves labels out of immutable bytes', () => {
    const retained = { ...preview.world, algorithm: 'survey-preview-4' };
    expect(PreviewWorldSchema.parse(retained).algorithm).toBe('survey-preview-4');
    expect(PreviewWorldSchema.parse(preview.world).algorithm).toBe('survey-preview-5');
  });

  it('R4: immutable regions store codes, with display names resolved separately', () => {
    const { world } = decoded;
    const names = Object.fromEntries(spoken(world).map((r) => [r.language, [r.name, r.englishName]]));
    expect(names).toEqual({
      en: ['en', 'en'], es: ['es', 'es'], pt: ['pt', 'pt'], de: ['de', 'de'],
      ja: ['ja', 'ja'], fr: ['fr', 'fr'], other: ['other', 'other'],
    });
    expect(languageNames('ko')).toEqual({ name: 'Korean', englishName: 'Korean' });

    const inputNames = new Map(input.games.map((g) => [g.gameId, g.name]));
    const { mapped } = previewChannels(input.channels, currentTaxonomy());
    const mains = new Set(mapped.map((c) => c.mainGameId).filter((g): g is string => g !== null));
    expect(new Set(world.games.map((g) => g.gameId))).toEqual(mains);
    expect(world.games.map((g) => g.gameId)).toEqual([...mains].sort(compareIds));
    for (const game of world.games) expect(game.name, game.gameId).toBe(inputNames.get(game.gameId));
    expect(world.games.find((g) => g.gameId === UNNAMED_GAME)).toEqual({ gameId: UNNAMED_GAME, name: null });
    expect(world.games.some((g) => g.gameId === UNUSED_GAME.gameId)).toBe(false);

    // Clusters are named only by a shared real category, or not at all; the unnamed category keeps a null name.
    const named = world.clusters.filter((c) => c.game >= 0);
    expect(named.length).toBeGreaterThan(5);
    expect(world.clusters.some((c) => c.game === -1)).toBe(true);
    expect(world.clusters.some((c) => c.game >= 0 && world.games[c.game]!.gameId === UNNAMED_GAME)).toBe(true);
    for (const cluster of named) expect(world.games[cluster.game]!.name).toBe(inputNames.get(world.games[cluster.game]!.gameId));
  });

  it('groups each category cluster around its shared main category, inside its region', () => {
    const { world } = decoded;
    expect(world.clusters.length).toBe(layout.clusters.length);
    for (const [index, cluster] of layout.clusters.entries()) {
      const members = layout.settlers.filter((s) => s.cluster === index);
      expect(members.length).toBe(cluster.members);
      expect(members.every((s) => s.region === cluster.region)).toBe(true);
      if (cluster.gameId !== null) {
        expect(members.every((s) => s.mainGameId === cluster.gameId), `cluster ${index}`).toBe(true);
        expect(world.games[world.clusters[index]!.game]!.gameId).toBe(cluster.gameId);
      } else {
        expect(world.clusters[index]!.game).toBe(-1);
      }
      for (const settler of members) expect(Math.hypot(settler.x - cluster.x, settler.y - cluster.y) + settler.r).toBeLessThanOrEqual(cluster.r + 1e-6);
      const region = layout.regions[cluster.region]!;
      expect(Math.hypot(cluster.x - region.x, cluster.y - region.y) + cluster.r).toBeLessThanOrEqual(region.r + 1e-6);
    }
    // A category is never split between two named clusters of the same language.
    const keys = layout.clusters.filter((c) => c.gameId !== null).map((c) => `${c.region}:${c.gameId}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const region of world.regions) {
      expect(world.clusters.filter((c) => c.region === region.index).reduce((sum, c) => sum + c.members, 0)).toBe(region.members);
    }
  });

  it('puts every holding wholly on dry land, and no two holdings overlap', () => {
    const { all, rings } = decoded;
    for (const holding of all) {
      const r = HOLDING_RADIUS[holding.tier];
      expect(insideLand(rings, holding.x, holding.y), holding.id).toBe(true);
      for (let k = 0; k < 8; k++) {
        const angle = (k / 8) * Math.PI * 2;
        expect(insideLand(rings, holding.x + Math.cos(angle) * r, holding.y + Math.sin(angle) * r), `${holding.id} rim ${k}`).toBe(true);
      }
    }
    // Quantised to 1/20 unit, so allow that much.
    let overlaps = 0;
    for (let i = 0; i < all.length; i++) {
      const a = all[i]!;
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j]!;
        const min = HOLDING_RADIUS[a.tier] + HOLDING_RADIUS[b.tier] - 0.1;
        const dx = a.x - b.x;
        if (Math.abs(dx) >= min) continue;
        if (Math.hypot(dx, a.y - b.y) < min) overlaps++;
      }
    }
    expect(overlaps).toBe(0);
  });

  it('keeps decor off the holdings drawn at each of its bands, land marks on land and ships and monsters at sea', () => {
    const { world, all, rings } = decoded;
    expect(world.decor.length % 3).toBe(0);
    // The tiers whose stamps are drawn at each band (land.ts): capitals, then cities, towns and villages join.
    const visible: readonly (readonly Tier[])[] = [
      ['capital'], ['capital', 'city'], ['capital', 'city', 'town'], ['capital', 'city', 'town', 'village'], ['capital', 'city', 'town', 'village'],
    ];
    const counts = new Map<string, number>();
    for (let k = 0; k < world.decor.length; k += 3) {
      const code = world.decor[k]!;
      const kind = DECOR_KINDS[code >> 12]!;
      const bands = (code >> 7) & 0b11111;
      const x = world.decor[k + 1]! / world.coordScale;
      const y = world.decor[k + 2]! / world.coordScale;
      expect(kind).toBeDefined();
      expect(bands).toBeGreaterThan(0);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      if (kind === 'monster' || kind === 'ship') {
        expect(insideLand(rings, x, y), `${kind} at ${x},${y}`).toBe(false);
        continue;
      }
      expect(insideLand(rings, x, y), `${kind} at ${x},${y}`).toBe(true);
      for (let band = 0; band < DECOR_SPACING.length; band++) {
        if (!(bands & (1 << band))) continue;
        const clearance = 0.5 + DECOR_SPACING[band]! * 0.36;
        for (const holding of all) {
          if (!visible[band]!.includes(holding.tier)) continue;
          // Both positions are quantised to 1/20 unit.
          const limit = HOLDING_RADIUS[holding.tier] * 1.2 + clearance - 0.1;
          const dx = holding.x - x;
          if (Math.abs(dx) >= limit) continue;
          expect(Math.hypot(dx, holding.y - y) >= limit, `${kind} band ${band} on ${holding.tier} ${holding.id}`).toBe(true);
        }
      }
    }
    // A real map: mountains or hills and forests on land, a ship or a monster at sea.
    expect((counts.get('forest') ?? 0)).toBeGreaterThan(0);
    expect((counts.get('mountain') ?? 0) + (counts.get('hill') ?? 0)).toBeGreaterThan(0);
    expect((counts.get('ship') ?? 0) + (counts.get('monster') ?? 0)).toBeGreaterThan(0);
  });

  it('writes coasts as closed delta-encoded rings inside the world bounds', () => {
    const { world, rings } = decoded;
    expect(rings.length).toBeGreaterThan(0);
    const s = world.coordScale;
    for (const ring of rings) {
      expect(ring.points.length % 2).toBe(0);
      expect(ring.region).toBeLessThan(world.regions.length);
      expect(ring.box.minX).toBeGreaterThanOrEqual(world.bounds.minX / s);
      expect(ring.box.maxX).toBeLessThanOrEqual(world.bounds.maxX / s);
      expect(ring.box.minY).toBeGreaterThanOrEqual(world.bounds.minY / s);
      expect(ring.box.maxY).toBeLessThanOrEqual(world.bounds.maxY / s);
    }
  });

  it('refuses a revision with nothing to draw', () => {
    const { manifest, channels, games } = synthesize([{ code: 'en', candidates: 0, gone: 3, small: 10 }], 1);
    expect(() => buildPreview({ manifest, channels: channels.filter((c) => c.language === 'ko'), games })).toThrow(/no mapped channels/);
    expect(() => buildPreview({ manifest, channels: channels.filter((c) => !c.kingdomCandidate || c.goneAt !== null), games })).toThrow(/no mapped channels/);
  });

  it('draws a small survey with only isles', () => {
    const small = synthesize(SMALL_PLAN, 3);
    const built = decode(buildPreview(small));
    expect(spoken(built.world).every((r) => r.kind === 'isle')).toBe(true);
    expect(built.world.regions.filter((r) => r.language === null).every((r) => r.kind === 'outer' && r.members === 0)).toBe(true);
    expect(built.world.isles).not.toBeNull();
    expect(built.all.length).toBe(57);
  });
});

// ── Store ─────────────────────────────────────────────────────────────────────────────────────────────────────

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'chatdom-preview-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe('survey preview store', () => {
  let small: Synthetic;
  let smallPreview: PreviewFiles;
  beforeAll(() => {
    small = synthesize(SMALL_PLAN, 3, 'obs-20261030T004500Z-aaaaaaaaaaaa');
    smallPreview = buildPreview(small);
  });

  it('publishes a verified preview atomically and reports an intact one as existing', () => {
    const dataDir = tempDir();
    expect(writePreview(dataDir, smallPreview)).toBe('written');
    const dir = previewDir(dataDir, smallPreview.id);
    expect(readdirSync(dir).sort()).toEqual([PREVIEW_MANIFEST, ...smallPreview.files.keys()].sort());
    for (const [name, bytes] of smallPreview.files) expect(sha(readFileSync(join(dir, name)))).toBe(sha(bytes));
    expect(JSON.parse(readFileSync(join(dir, PREVIEW_MANIFEST), 'utf8'))).toEqual(smallPreview.manifest);
    expect(verifyPreviewDir(dir, { id: smallPreview.id, revision: small.manifest.revision })).toEqual([]);
    // Nothing of the staging step is left behind, and nothing outside previews/ is written.
    expect(readdirSync(dataDir)).toEqual(['previews']);
    expect(readdirSync(previewsRoot(dataDir))).toEqual([smallPreview.id]);

    expect(writePreview(dataDir, buildPreview(small))).toBe('existing');
    expect(verifyPreviewDir(dir)).toEqual([]);
    expect(verifyPreviewDir(dir, { id: smallPreview.id, revision: 'obs-20261030T004500Z-bbbbbbbbbbbb' })).toContain('preview belongs to a different revision.');
  });

  it('never publishes a preview that fails verification', () => {
    const dataDir = tempDir();
    const files = new Map(smallPreview.files);
    const chunk = Buffer.from(files.get('region-0.json')!);
    chunk[chunk.length - 3] = chunk[chunk.length - 3]! ^ 0x01;
    files.set('region-0.json', chunk);
    expect(() => writePreview(dataDir, { ...smallPreview, files })).toThrow(/failed verification: region-0\.json does not match its hash/);
    expect(existsSync(previewDir(dataDir, smallPreview.id))).toBe(false);
    expect(existsSync(join(dataDir, '.staging-preview'))).toBe(false);
  });

  it('detects tampering, injected files and a broken manifest, and a rewrite repairs the preview', () => {
    const dataDir = tempDir();
    writePreview(dataDir, smallPreview);
    const dir = previewDir(dataDir, smallPreview.id);
    const flip = (name: string, at: number) => {
      const path = join(dir, name);
      const original = readFileSync(path);
      const changed = Buffer.from(original);
      changed[at] = changed[at]! ^ 0x01;
      writeFileSync(path, changed);
      return () => writeFileSync(path, original);
    };

    let restore = flip('region-1.json', 40);
    expect(verifyPreviewDir(dir)).toContain('region-1.json does not match its hash in world.json.');
    restore();
    restore = flip('world.json', 100);
    expect(verifyPreviewDir(dir)).toEqual(['preview world.json does not match its manifest hash.']);
    restore();
    expect(verifyPreviewDir(dir)).toEqual([]);

    writeFileSync(join(dir, 'debug.json'), '{}');
    expect(verifyPreviewDir(dir)).toContain('unexpected file debug.json in the preview.');
    rmSync(join(dir, 'debug.json'));

    rmSync(join(dir, 'region-0.json'));
    expect(verifyPreviewDir(dir).join('\n')).toMatch(/region-0\.json unreadable/);
    writeFileSync(join(dir, PREVIEW_MANIFEST), '{"version":1');
    expect(verifyPreviewDir(dir)[0]).toMatch(/^preview unreadable/);

    // A damaged preview is not "existing": writing it again replaces it with the verified bytes.
    expect(writePreview(dataDir, smallPreview)).toBe('written');
    expect(verifyPreviewDir(dir, { id: smallPreview.id, revision: small.manifest.revision })).toEqual([]);
  });

  it('rejects a preview whose holdings were moved into the sea or onto each other, even with consistent hashes', () => {
    // A self-consistent but wrong preview: re-hash after editing, so only the land rules can catch it.
    const dataDir = tempDir();
    const world = decode(smallPreview).world;
    const head = { ...world.head, x: [...world.head.x], y: [...world.head.y] };
    expect(head.ids.length).toBeGreaterThan(0);
    head.x[0] = world.bounds.minX + 20;
    head.y[0] = world.bounds.minY + 20;
    const chunk = decode(smallPreview).chunks[0]!;
    const settlers = { ...chunk.settlers, x: [...chunk.settlers.x], y: [...chunk.settlers.y] };
    settlers.x[1] = settlers.x[0]!;
    settlers.y[1] = settlers.y[0]!;
    const chunkBytes = new TextEncoder().encode(`${JSON.stringify({ ...chunk, settlers })}\n`);
    const regions = world.regions.map((r) => (r.index === 0 ? { ...r, chunk: { ...r.chunk, sha256: sha(chunkBytes), bytes: chunkBytes.byteLength } } : r));
    const worldBytes = new TextEncoder().encode(`${JSON.stringify({ ...world, head, regions })}\n`);
    const files = new Map(smallPreview.files);
    files.set('world.json', worldBytes);
    files.set('region-0.json', chunkBytes);
    const manifest = { ...smallPreview.manifest, world: { ...smallPreview.manifest.world, sha256: sha(worldBytes), bytes: worldBytes.byteLength } };
    expect(() => writePreview(dataDir, { ...smallPreview, manifest, files })).toThrow(/1 holdings stand in the sea\. 1 pairs of holdings overlap\./);
    expect(existsSync(previewDir(dataDir, smallPreview.id))).toBe(false);
  });

  it('prunes previews whose revision is no longer kept and leaves kept ones and foreign folders', () => {
    const dataDir = tempDir();
    const second = synthesize(SMALL_PLAN, 3, 'obs-20261030T034500Z-bbbbbbbbbbbb', T0 + 12 * HOUR);
    const secondPreview = buildPreview(second);
    expect(secondPreview.id).not.toBe(smallPreview.id);
    writePreview(dataDir, smallPreview);
    writePreview(dataDir, secondPreview);
    mkdirSync(join(previewsRoot(dataDir), 'notes'));
    // A preview folder whose manifest is unreadable belongs to no kept revision.
    const brokenId = 'pv-20261028T000000Z-000000000000';
    mkdirSync(previewDir(dataDir, brokenId));

    expect(prunePreviews(dataDir, new Set([second.manifest.revision, small.manifest.revision]))).toEqual([brokenId]);
    expect(prunePreviews(dataDir, new Set([second.manifest.revision]))).toEqual([smallPreview.id]);
    expect(readdirSync(previewsRoot(dataDir)).sort()).toEqual(['notes', secondPreview.id].sort());
    expect(verifyPreviewDir(previewDir(dataDir, secondPreview.id))).toEqual([]);
    expect(prunePreviews(dataDir, new Set())).toEqual([secondPreview.id]);
    expect(prunePreviews(tempDir(), new Set())).toEqual([]);
  });
});
