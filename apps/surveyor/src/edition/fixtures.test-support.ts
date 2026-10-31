import { generateKeyPairSync } from 'node:crypto';
import { AtlasRaidSchema } from '@chatdom/shared';
import { compareIds, revisionFor, sha256 } from '../export/project';
import {
  EDITION_0_MIN_MS, EDITION_I_MIN_MS, SNAPSHOT_KIND, SnapshotManifestSchema, isKingdomCandidate,
  type ChannelObservation, type Game, type RaidObservation, type SnapshotManifest,
} from '../export/schema';

/**
 * Test-only synthetic surveys for edition tests: clearly fake channels (IDs starting 7…, logins `synthetic_<n>`)
 * shaped like an exported revision. Nothing here describes a real channel, and nothing is ever written outside a
 * test's own temp directory.
 */
export const T0 = 1_793_288_700_000;
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fake, unique Twitch-shaped ID for synthetic channel number `n`. */
export const synthId = (n: number) => `7${String(n).padStart(9, '0')}`;

/** Main categories as the checked-in proposal files them (family index in families-1 in the comment). */
export const GAME = {
  justChatting: '509658', // 0 just-chatting
  valorant: '516575', // 2 shooters
  fortnite: '33214', // 2 shooters
  league: '21779', // 3 arenas
  gta: '32982', // 5 roleplay
  minecraft: '27471', // 6 sandbox
  crypto: '499634', // unassigned in families-1
  tail: '91000001', // in no taxonomy at all
} as const;

export const GAMES: Game[] = [
  { gameId: GAME.justChatting, name: 'Just Chatting' },
  { gameId: GAME.valorant, name: 'VALORANT' },
  { gameId: GAME.fortnite, name: 'Fortnite' },
  { gameId: GAME.league, name: 'League of Legends' },
  { gameId: GAME.gta, name: 'Grand Theft Auto V' },
  { gameId: GAME.minecraft, name: 'Minecraft' },
  { gameId: GAME.crypto, name: 'Crypto' },
  { gameId: GAME.tail, name: 'Synthetic Tail Category' },
].sort((a, b) => compareIds(a.gameId, b.gameId));

const MAIN_SHARES: readonly [string, number][] = [
  [GAME.justChatting, 0.34], [GAME.valorant, 0.16], [GAME.league, 0.14], [GAME.gta, 0.12], [GAME.minecraft, 0.1], [GAME.crypto, 0.06],
];

const round2 = (value: number) => Math.round(value * 100) / 100;

export interface ChannelSpec {
  n: number;
  language: string;
  /** Observed average viewers (viewer-minutes / live-minutes). */
  average: number;
  liveMinutes?: number;
  categories?: ChannelObservation['categories'];
  goneAt?: number | null;
  stream?: ChannelObservation['stream'];
}

/** One synthetic channel as the importer would export it at `asOf`. */
export function channel(spec: ChannelSpec, asOf: number): ChannelObservation {
  const liveMinutes = spec.liveMinutes ?? 600;
  const viewerMinutes = Math.round(spec.average * liveMinutes);
  const categories = spec.categories ?? [{ gameId: GAME.justChatting, minutes: liveMinutes }];
  return {
    kingdomId: synthId(spec.n) as ChannelObservation['kingdomId'],
    login: `synthetic_${spec.n}`,
    displayName: `Synthetic ${spec.n}`,
    language: spec.language,
    firstSeenAt: T0,
    lastLiveAt: asOf - HOUR,
    liveMinutes,
    viewerMinutes,
    averageViewers: liveMinutes > 0 ? round2(viewerMinutes / liveMinutes) : 0,
    peakViewers: liveMinutes > 0 ? Math.ceil(viewerMinutes / liveMinutes) : 0,
    kingdomCandidate: isKingdomCandidate(liveMinutes, viewerMinutes),
    live: false,
    stream: spec.stream ?? null,
    categories: [...categories].sort((a, b) => compareIds(a.gameId, b.gameId)),
    avatarUrl: null,
    factsAt: asOf - HOUR,
    goneAt: spec.goneAt ?? null,
    contentClassification: 'unknown',
  };
}

export interface LanguagePlan {
  code: string;
  candidates: number;
  /** Observed channels below the candidate rule (5–24 viewers). */
  small?: number;
}

/** Channel specs for a deterministic spread of tiers and main categories, numbered from `start`. */
export function planChannels(plans: readonly LanguagePlan[], seed: number, start = 1): ChannelSpec[] {
  const rand = mulberry32(seed);
  const specs: ChannelSpec[] = [];
  let n = start;
  const pickMain = () => {
    let roll = rand();
    for (const [gameId, share] of MAIN_SHARES) {
      if (roll < share) return gameId;
      roll -= share;
    }
    return GAME.tail;
  };
  for (const plan of plans) {
    for (let i = 0; i < plan.candidates; i++) {
      const roll = rand();
      const [lo, hi] = i === 0 ? [5_000, 20_000] : roll < 0.05 ? [500, 5_000] : roll < 0.35 ? [50, 500] : [25, 50];
      const liveMinutes = 120 + Math.floor(rand() * 1_800);
      const main = pickMain();
      const categories = [{ gameId: main, minutes: liveMinutes }];
      specs.push({ n: n++, language: plan.code, average: round2(lo + rand() * (hi - lo)), liveMinutes, categories });
    }
    for (let i = 0; i < (plan.small ?? 0); i++) {
      specs.push({ n: n++, language: plan.code, average: round2(5 + rand() * 19), liveMinutes: 60 + Math.floor(rand() * 300) });
    }
  }
  return specs;
}

export interface Revision {
  manifest: SnapshotManifest;
  channels: ChannelObservation[];
  games: Game[];
  raidObservations: RaidObservation[];
}

/**
 * A revision of synthetic channels at `asOf`. Its observation window opens at `firstObservationAt` (default T0), so
 * a test chooses the founding window explicitly. Raids are read at `asOf + 2 s`, like the importer's database cut.
 */
export function revision(input: {
  asOf: number;
  specs: readonly ChannelSpec[];
  raids?: readonly RaidObservation[];
  firstObservationAt?: number;
  tag?: string;
}): Revision {
  const first = input.firstObservationAt ?? T0;
  const channels = input.specs.map((spec) => channel(spec, input.asOf)).sort((a, b) => compareIds(a.kingdomId, b.kingdomId));
  const contentHash = sha256(`synthetic:${input.tag ?? ''}:${input.asOf}:${channels.map((c) => `${c.kingdomId}/${c.viewerMinutes}`).join(',')}`);
  const id = revisionFor(input.asOf, contentHash);
  const raidObservations = [...(input.raids ?? [])];
  const file = (path: string) => ({ path, sha256: '0'.repeat(64), bytes: 0, records: 0 });
  const manifest = SnapshotManifestSchema.parse({
    version: 1, kind: SNAPSHOT_KIND, revision: id, contentHash, importedAt: input.asOf + 60_000, asOf: input.asOf,
    window: {
      firstObservationAt: first, lastObservationAt: input.asOf, hours: round2((input.asOf - first) / HOUR),
      sweeps: Math.max(1, Math.floor((input.asOf - first) / 180_000) + 1), cadenceMs: 180_000, gapCount: 0, gaps: [],
    },
    coverage: {
      sweep: { method: 'helix-get-streams-by-viewers', floorViewers: 5, note: 'Synthetic test survey.' },
      raidWatch: { enabled: true, watching: 0, verified: 0, costTotal: 0, costMax: 10_000, liveCandidates: 0, note: 'Synthetic.' },
      recorder: { enabled: false, keepDays: 7, frames: 0, firstFrameAt: null, lastFrameAt: null },
      contentLabels: 'not-collected',
      sourceSettledHoldings: 0,
      missing: ['Synthetic test survey: no real channel is described.'],
    },
    founding: { status: 'not-founded', edition0EligibleAt: first + EDITION_0_MIN_MS, editionIEligibleAt: first + EDITION_I_MIN_MS, observedMs: input.asOf - first },
    source: {
      http: {
        base: 'http://surveyor.test/atlas/api/', readAt: input.asOf + 1_000, statusSince: first, statusSweeps: 1, statusLastSweepAt: input.asOf,
        statusChannels: channels.length, statusLiveNow: 0, recentPairs: 0, recentPairsMatched: 0,
      },
      database: { path: '/synthetic/surveyor.db', bytes: 0, walBytes: null, readOnly: true, transaction: 'single-read', openedAt: input.asOf + 2_000, readMs: 1, sweeps: 1, lagSweeps: 0 },
    },
    counts: {
      channels: channels.length, kingdomCandidates: channels.filter((c) => c.kingdomCandidate).length, liveChannels: 0, liveCandidates: 0,
      games: GAMES.length, categoryRows: 0, raidPairs: 0, raidObservations: raidObservations.length, raidObservationsBetweenCandidates: 0,
      avatarsDropped: 0, streamsExpired: 0, rejected: {}, rejectedSamples: [],
    },
    retention: { streamFactsMaxOfflineMs: 86_400_000, avatarMaxAgeMs: 86_400_000, keepRevisions: 3 },
    files: {
      channels: file('channels.ndjson'), games: file('games.ndjson'), raidPairs: file('raid-pairs.ndjson'),
      raidObservations: file('raid-observations.ndjson'), sweeps: file('sweeps.ndjson'),
    },
  });
  return { manifest, channels, games: GAMES, raidObservations };
}

/** One recorder raid observation between two synthetic channels, as the importer normalises it. */
export function raid(fromN: number, toN: number, observedAt: number, viewers = 40): RaidObservation {
  return {
    raid: AtlasRaidSchema.parse({
      version: 1, id: `r:${synthId(fromN)}:${synthId(toN)}:${observedAt}`, fromKingdomId: synthId(fromN), toKingdomId: synthId(toN), viewers,
      observedAt, occurredAt: null, evidence: { kind: 'observed', asOf: observedAt }, delivery: 'resumable', source: 'surveyor-recorder',
    }),
    betweenCandidates: false,
  };
}

/** A throwaway Ed25519 key pair for one test run; never written anywhere but a test's temp directory. */
export function testKeys(): { publicPem: string; privatePem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicPem: publicKey, privatePem: privateKey };
}

/** A public key of another curve, which the founder key must refuse. */
export function x25519PublicKey(): string {
  return generateKeyPairSync('x25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } }).publicKey;
}
