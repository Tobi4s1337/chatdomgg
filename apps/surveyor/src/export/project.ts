import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { AtlasError } from '../errors';
import type { SurveyorHttpRead } from '../source/http';
import type { SourceChannelRow, SourceSnapshot } from '../source/sqlite';
import {
  AvatarUrlSchema, ChannelObservationSchema, EDITION_0_MIN_MS, EDITION_I_MIN_MS, GameSchema,
  RAW_CONTENT_MAX_AGE_MS, isKingdomCandidate, RaidObservationSchema, RaidPairSchema, SNAPSHOT_FILE_NAMES,
  SNAPSHOT_FILES, SNAPSHOT_KIND, SOURCE_SWEEP_CADENCE_MS, SOURCE_SWEEP_FLOOR_VIEWERS, SnapshotManifestSchema, SweepSchema,
  type ChannelObservation, type Game, type RaidObservation, type RaidPair, type SnapshotFile, type SnapshotManifest, type Sweep,
} from './schema';

/** More than this share of invalid source rows means the source is broken, not that a few rows are odd. */
export const MAX_REJECTED_SHARE = 0.005;
const MAX_GAPS_LISTED = 50;

export interface SnapshotFiles {
  bytes: Record<SnapshotFile, Uint8Array>;
  records: Record<SnapshotFile, number>;
}

export interface ProjectedSnapshot {
  manifest: SnapshotManifest;
  files: SnapshotFiles;
}

/** Decimal IDs order numerically by length, then lexically; never coerce them to numbers. */
export function compareIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

const round = (value: number, places: number) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

class Rejections {
  readonly counts: Record<string, number> = {};
  readonly samples: string[] = [];
  total = 0;

  add(reason: string, sample: string): void {
    this.total++;
    this.counts[reason] = (this.counts[reason] ?? 0) + 1;
    if (this.samples.length < 10) this.samples.push(`${reason}: ${sample.slice(0, 80)}`);
  }
}

function idText(value: unknown): string {
  return typeof value === 'string' && /^[0-9]{1,32}$/.test(value) ? value : '(invalid id)';
}

function parseStartedAt(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function emptyToNull(value: unknown): unknown {
  return value === '' ? null : value;
}

function projectChannel(row: SourceChannelRow, asOf: number, categories: Map<string, { gameId: string; minutes: number }[]>,
  counters: { avatarsDropped: number; streamsExpired: number }): z.ZodSafeParseResult<ChannelObservation> {
  const liveMinutes = round(Number(row.live_min), 4);
  const viewerMinutes = round(Number(row.viewer_min), 4);
  const average = liveMinutes > 0 ? viewerMinutes / liveMinutes : 0;
  const lastLiveAt = Number(row.last_live);
  const live = row.live === 1;
  // R16: a title, game and audience leave the export a day after the channel was last live.
  const streamFresh = asOf - lastLiveAt <= RAW_CONTENT_MAX_AGE_MS;
  const startedAt = parseStartedAt(row.started_at);
  const hasStream = row.title !== null || row.game !== null || row.viewers !== null || row.started_at !== null;
  if (hasStream && !streamFresh) counters.streamsExpired++;
  // Facts are confirmed by the daily refresh or by any live sweep (which carries login and display name).
  const factsAt = Math.max(typeof row.facts_at === 'number' ? row.facts_at : 0, lastLiveAt);
  const avatar = AvatarUrlSchema.safeParse(row.avatar);
  const avatarFresh = typeof row.facts_at === 'number' && asOf - row.facts_at <= RAW_CONTENT_MAX_AGE_MS;
  if (row.avatar !== null && (!avatar.success || !avatarFresh)) counters.avatarsDropped++;
  const id = String(row.id);
  return ChannelObservationSchema.safeParse({
    kingdomId: row.id,
    login: row.login,
    displayName: row.name,
    language: row.lang,
    firstSeenAt: row.first_seen,
    lastLiveAt,
    liveMinutes,
    viewerMinutes,
    averageViewers: round(average, 2),
    peakViewers: row.peak,
    kingdomCandidate: isKingdomCandidate(liveMinutes, viewerMinutes),
    live,
    stream: hasStream && streamFresh ? {
      gameId: emptyToNull(row.game_id),
      game: emptyToNull(row.game),
      title: row.title,
      viewers: row.viewers,
      startedAt: startedAt !== null && startedAt <= asOf ? startedAt : null,
    } : null,
    categories: categories.get(id) ?? [],
    avatarUrl: avatar.success && avatarFresh ? avatar.data : null,
    factsAt,
    goneAt: row.gone_at,
    contentClassification: 'unknown',
  });
}

function ndjson(records: readonly unknown[]): Uint8Array {
  return new TextEncoder().encode(records.map((record) => `${JSON.stringify(record)}\n`).join(''));
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function revisionFor(asOf: number, contentHash: string): string {
  const stamp = new Date(asOf).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `obs-${stamp}-${contentHash.slice(0, 12)}`;
}

/** Canonical content identity: domain prefix, then each file's name, hash and length. Import time is excluded. */
export function contentHashOf(files: Record<SnapshotFile, { sha256: string; bytes: number }>): string {
  const lines = SNAPSHOT_FILES.map((file) => `${SNAPSHOT_FILE_NAMES[file]} ${files[file].sha256} ${files[file].bytes}`);
  return sha256(`${SNAPSHOT_KIND}:v1\n${lines.join('\n')}\n`);
}

/**
 * Turns one HTTP read and one consistent database snapshot into the exported observation records and manifest.
 * Throws a bounded AtlasError instead of producing a partial or invented inventory.
 */
export function projectSnapshot(http: SurveyorHttpRead, source: SourceSnapshot, opts: { importedAt: number; keepRevisions: number }): ProjectedSnapshot {
  const rejections = new Rejections();

  const sweeps: Sweep[] = [];
  for (const row of source.sweeps) {
    const parsed = SweepSchema.safeParse(row);
    if (parsed.success) sweeps.push(parsed.data);
    else rejections.add('sweep', String(row.at));
  }
  if (sweeps.length === 0) throw new AtlasError('inventory-empty', 'The source has recorded no complete sweep; there is nothing observed to export.');
  const first = sweeps[0]!;
  const last = sweeps[sweeps.length - 1]!;
  const asOf = last.at;

  // The HTTP status and the database must describe the same collector run.
  if (http.status.since !== first.at) {
    throw new AtlasError('source-incoherent', 'SURVEYOR_BASE_URL and SURVEYOR_DB_PATH describe different collectors (first sweep times differ).',
      [`http since ${new Date(http.status.since).toISOString()}`, `database first sweep ${new Date(first.at).toISOString()}`]);
  }

  const games: Game[] = [];
  const gameIds = new Set<string>();
  for (const row of source.games) {
    const parsed = GameSchema.safeParse({ gameId: row.id, name: emptyToNull(row.name) });
    if (parsed.success) {
      games.push(parsed.data);
      gameIds.add(parsed.data.gameId);
    } else rejections.add('game', idText(row.id));
  }
  games.sort((a, b) => compareIds(a.gameId, b.gameId));

  const categories = new Map<string, { gameId: string; minutes: number }[]>();
  let categoryRows = 0;
  for (const row of source.categories) {
    const minutes = Number(row.minutes);
    if (typeof row.channel !== 'string' || typeof row.game_id !== 'string' || !gameIds.has(row.game_id) || !(minutes >= 0)) {
      rejections.add('category', `${idText(row.channel)}/${idText(row.game_id)}`);
      continue;
    }
    if (minutes === 0) continue;
    const list = categories.get(row.channel) ?? [];
    list.push({ gameId: row.game_id, minutes: round(minutes, 4) });
    categories.set(row.channel, list);
    categoryRows++;
  }
  for (const list of categories.values()) list.sort((a, b) => b.minutes - a.minutes || compareIds(a.gameId, b.gameId));

  const counters = { avatarsDropped: 0, streamsExpired: 0 };
  const channels: ChannelObservation[] = [];
  for (const row of source.channels) {
    const parsed = projectChannel(row, asOf, categories, counters);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      rejections.add(`channel.${issue?.path[0]?.toString() ?? 'row'}`, idText(row.id));
      continue;
    }
    const channel = parsed.data;
    if (channel.lastLiveAt > asOf || channel.firstSeenAt < first.at || channel.firstSeenAt > channel.lastLiveAt) {
      rejections.add('channel.dates', channel.kingdomId);
      continue;
    }
    // In one snapshot a live channel was seen by the last sweep; anything else is an incoherent read.
    if (channel.live && channel.lastLiveAt !== asOf) {
      throw new AtlasError('source-incoherent', 'A channel marked live was not seen by the last sweep in the same snapshot.', [channel.kingdomId]);
    }
    channels.push(channel);
  }
  if (channels.length === 0) throw new AtlasError('inventory-empty', 'The source has no valid observed channels; refusing to publish an empty survey.');
  channels.sort((a, b) => compareIds(a.kingdomId, b.kingdomId));

  const raidPairs: RaidPair[] = [];
  for (const row of source.raidPairs) {
    const parsed = RaidPairSchema.safeParse({ fromKingdomId: row.from_id, toKingdomId: row.to_id, raids: row.n, viewersTotal: row.viewers, lastAt: row.last_at });
    if (parsed.success && parsed.data.lastAt <= source.openedAt) raidPairs.push(parsed.data);
    else rejections.add('raidPair', `${idText(row.from_id)}>${idText(row.to_id)}`);
  }
  raidPairs.sort((a, b) => compareIds(a.fromKingdomId, b.fromKingdomId) || compareIds(a.toKingdomId, b.toKingdomId));

  const raidObservations: RaidObservation[] = [];
  const seenRaids = new Set<string>();
  for (const row of source.raidObservations) {
    const at = Number(row.at);
    // A content key, documented as such: the recorder kept no upstream message ID.
    const id = `recorder:${at}:${String(row.from_id)}:${String(row.to_id)}:${String(row.viewers)}`;
    const parsed = RaidObservationSchema.safeParse({
      raid: {
        version: 1, id, fromKingdomId: row.from_id, toKingdomId: row.to_id, viewers: row.viewers,
        // The recorder stores the webhook message timestamp; it is an observation time, not a proven event time.
        observedAt: at, occurredAt: null, evidence: { kind: 'observed', asOf: at },
        delivery: 'resumable', source: 'surveyor-recorder',
      },
      betweenCandidates: row.kept === 1,
    });
    if (!parsed.success || at > source.openedAt) {
      rejections.add('raidObservation', `${idText(row.from_id)}>${idText(row.to_id)}`);
      continue;
    }
    // Redelivered webhooks with the same content are one observation.
    if (seenRaids.has(id)) continue;
    seenRaids.add(id);
    raidObservations.push(parsed.data);
  }

  const totalRows = source.sweeps.length + source.games.length + source.categories.length + source.channels.length +
    source.raidPairs.length + source.raidObservations.length;
  if (rejections.total > Math.max(10, totalRows * MAX_REJECTED_SHARE)) {
    throw new AtlasError('inventory-invalid', `${rejections.total} of ${totalRows} source rows failed validation; the source looks broken.`,
      Object.entries(rejections.counts).map(([reason, count]) => `${reason}: ${count}`));
  }

  const gaps: { after: number; before: number; minutes: number }[] = [];
  let gapCount = 0;
  for (let i = 1; i < sweeps.length; i++) {
    const delta = sweeps[i]!.at - sweeps[i - 1]!.at;
    if (delta > SOURCE_SWEEP_CADENCE_MS * 2) {
      gapCount++;
      if (gaps.length < MAX_GAPS_LISTED) gaps.push({ after: sweeps[i - 1]!.at, before: sweeps[i]!.at, minutes: round(delta / 60_000, 1) });
    }
  }

  const records: Record<SnapshotFile, readonly unknown[]> = { channels, games, raidPairs, raidObservations, sweeps };
  const bytes = {} as Record<SnapshotFile, Uint8Array>;
  const counts = {} as Record<SnapshotFile, number>;
  const fileEntries = {} as SnapshotManifest['files'];
  for (const file of SNAPSHOT_FILES) {
    bytes[file] = ndjson(records[file]);
    counts[file] = records[file].length;
    fileEntries[file] = { path: SNAPSHOT_FILE_NAMES[file], sha256: sha256(bytes[file]), bytes: bytes[file].byteLength, records: counts[file] };
  }
  const contentHash = contentHashOf(fileEntries);
  const liveCandidates = channels.filter((channel) => channel.live && channel.kingdomCandidate).length;
  const recentMatched = matchRecentPairs(http, channels, raidPairs);
  const status = http.status;

  const manifest = SnapshotManifestSchema.parse({
    version: 1,
    kind: SNAPSHOT_KIND,
    revision: revisionFor(asOf, contentHash),
    contentHash,
    importedAt: opts.importedAt,
    asOf,
    window: {
      firstObservationAt: first.at, lastObservationAt: asOf, hours: round((asOf - first.at) / 3_600_000, 2),
      sweeps: sweeps.length, cadenceMs: SOURCE_SWEEP_CADENCE_MS, gapCount, gaps,
    },
    coverage: {
      sweep: {
        method: 'helix-get-streams-by-viewers',
        floorViewers: SOURCE_SWEEP_FLOOR_VIEWERS,
        note: 'Each sweep pages live streams by viewers until a whole page is below the floor; streams under five viewers are never observed.',
      },
      raidWatch: {
        enabled: status.raidWatch.enabled, watching: status.raidWatch.watching, verified: status.raidWatch.verified,
        costTotal: status.raidWatch.cost.total, costMax: status.raidWatch.cost.max, liveCandidates,
        note: 'Raids are observed only for channels inside the capped raid watch; an unwatched channel with no raid is unknown, not quiet.',
      },
      recorder: {
        enabled: status.recorder.enabled, keepDays: status.recorder.keepDays, frames: source.recorder.frames,
        firstFrameAt: source.recorder.firstAt, lastFrameAt: source.recorder.lastAt,
      },
      contentLabels: 'not-collected',
      sourceSettledHoldings: source.settlers,
      missing: [
        'Content classification labels are not collected by the source; every channel is unknown.',
        'Raid SSE and recorder rows carry no upstream event ID or replay cursor.',
        'Raid pair rows are cumulative aggregates without individual event times.',
        'Founded kingdoms, settled holdings and approved drawings do not exist yet.',
      ],
    },
    founding: {
      status: 'not-founded',
      edition0EligibleAt: first.at + EDITION_0_MIN_MS,
      editionIEligibleAt: first.at + EDITION_I_MIN_MS,
      observedMs: asOf - first.at,
    },
    source: {
      http: {
        base: http.base,
        readAt: http.readAt,
        statusSince: status.since,
        statusSweeps: status.sweeps,
        statusLastSweepAt: status.lastSweep?.at ?? null,
        statusChannels: status.channels,
        statusLiveNow: status.liveNow,
        recentPairs: http.recentPairs.length,
        recentPairsMatched: recentMatched,
      },
      database: {
        path: source.path, bytes: source.bytes, walBytes: source.walBytes, readOnly: true, transaction: 'single-read',
        openedAt: source.openedAt, readMs: source.readMs, sweeps: sweeps.length, lagSweeps: status.sweeps - sweeps.length,
      },
    },
    counts: {
      channels: channels.length,
      kingdomCandidates: channels.filter((channel) => channel.kingdomCandidate).length,
      liveChannels: channels.filter((channel) => channel.live).length,
      liveCandidates,
      games: games.length,
      categoryRows,
      raidPairs: raidPairs.length,
      raidObservations: raidObservations.length,
      raidObservationsBetweenCandidates: raidObservations.filter((observation) => observation.betweenCandidates).length,
      avatarsDropped: counters.avatarsDropped,
      streamsExpired: counters.streamsExpired,
      rejected: rejections.counts,
      rejectedSamples: rejections.samples,
    },
    retention: { streamFactsMaxOfflineMs: RAW_CONTENT_MAX_AGE_MS, avatarMaxAgeMs: RAW_CONTENT_MAX_AGE_MS, keepRevisions: opts.keepRevisions },
    files: fileEntries,
  });
  return { manifest, files: { bytes, records: counts } };
}

/** How many HTTP recent pairs the database snapshot also holds (by login). Evidence of agreement, never a source of raids. */
function matchRecentPairs(http: SurveyorHttpRead, channels: readonly ChannelObservation[], pairs: readonly RaidPair[]): number {
  const idByLogin = new Map(channels.map((channel) => [channel.login, channel.kingdomId]));
  const pairKeys = new Set(pairs.map((pair) => `${pair.fromKingdomId}>${pair.toKingdomId}`));
  let matched = 0;
  for (const pair of http.recentPairs) {
    const from = pair.from_login ? idByLogin.get(pair.from_login) : undefined;
    const to = pair.to_login ? idByLogin.get(pair.to_login) : undefined;
    if (from && to && pairKeys.has(`${from}>${to}`)) matched++;
  }
  return matched;
}
