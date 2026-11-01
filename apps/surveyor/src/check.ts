import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AtlasError, bound, zodDetails } from './errors';
import { compareIds, contentHashOf, revisionFor, sha256 } from './export/project';
import {
  EDITION_0_MIN_MS, EDITION_I_MIN_MS, RAW_CONTENT_MAX_AGE_MS, isKingdomCandidate, SNAPSHOT_FILE_NAMES,
  SNAPSHOT_FILES, SNAPSHOT_RECORD_SCHEMAS, SnapshotManifestSchema,
  type ChannelObservation, type Game, type RaidObservation, type RaidPair, type SnapshotFile, type SnapshotManifest, type Sweep,
} from './export/schema';
import { buildPreview, previewIdFor } from './preview/build';
import { previewDir, readPreviewManifest, readPreviewNames, verifyPreviewDir } from './preview/store';
import { publicVisibility, withheldReader } from './policy/visibility';
import { MANIFEST_FILE, readCurrent, readLedger, revisionDir } from './store/revisions';

export interface CheckReport {
  ok: boolean;
  revision: string | null;
  manifest: SnapshotManifest | null;
  problems: string[];
  /** Candidates the visibility gate keeps off the public map (gone, gambling); the preview must not draw them. */
  offMap?: ReadonlySet<string>;
  /** The verified records, for callers that go on to draw or settle from them. */
  records?: RevisionRecords;
}

export interface RevisionRecords {
  channels: ChannelObservation[];
  games: Game[];
  raidPairs: RaidPair[];
  raidObservations: RaidObservation[];
}

const MAX_PROBLEMS = 20;

class Problems {
  readonly list: string[] = [];
  private extra = 0;

  add(problem: string): void {
    if (this.list.length < MAX_PROBLEMS) this.list.push(bound(problem, 240));
    else this.extra++;
  }

  done(): string[] {
    return this.extra ? [...this.list, `… ${this.extra} more problems`] : this.list;
  }
}

function readRecords(dir: string, manifest: SnapshotManifest, file: SnapshotFile, problems: Problems): unknown[] | null {
  const entry = manifest.files[file];
  const path = join(dir, SNAPSHOT_FILE_NAMES[file]);
  if (entry.path !== SNAPSHOT_FILE_NAMES[file]) problems.add(`${file}: manifest path ${entry.path} is not ${SNAPSHOT_FILE_NAMES[file]}.`);
  if (!existsSync(path)) {
    problems.add(`${file}: ${SNAPSHOT_FILE_NAMES[file]} is missing.`);
    return null;
  }
  const bytes = readFileSync(path);
  if (bytes.byteLength !== entry.bytes) problems.add(`${file}: ${bytes.byteLength} bytes, manifest says ${entry.bytes}.`);
  if (sha256(bytes) !== entry.sha256) {
    problems.add(`${file}: SHA-256 does not match the manifest; the revision is corrupt.`);
    return null;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    problems.add(`${file}: not valid UTF-8.`);
    return null;
  }
  if (text.length && !text.endsWith('\n')) problems.add(`${file}: truncated final record.`);
  const lines = text.split('\n');
  lines.pop();
  if (lines.length !== entry.records) problems.add(`${file}: ${lines.length} records, manifest says ${entry.records}.`);
  const schema = SNAPSHOT_RECORD_SCHEMAS[file];
  const records: unknown[] = [];
  for (const [index, line] of lines.entries()) {
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      problems.add(`${file}:${index + 1}: not JSON.`);
      continue;
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      problems.add(`${file}:${index + 1}: ${zodDetails(parsed.error)[0] ?? 'invalid record'}`);
      continue;
    }
    // Canonical serialization: a strict re-encode must match byte for byte, so nothing hides in formatting.
    if (JSON.stringify(parsed.data) !== line) problems.add(`${file}:${index + 1}: not in canonical form.`);
    records.push(parsed.data);
  }
  return records;
}

/** Verifies one revision folder (staged or published) completely. Never trusts a count it has not recomputed. */
export function checkRevisionDir(dir: string): CheckReport {
  const problems = new Problems();
  let manifest: SnapshotManifest;
  try {
    const parsed = SnapshotManifestSchema.safeParse(JSON.parse(readFileSync(join(dir, MANIFEST_FILE), 'utf8')));
    if (!parsed.success) return { ok: false, revision: null, manifest: null, problems: [`${MANIFEST_FILE}: ${zodDetails(parsed.error).join('; ')}`] };
    manifest = parsed.data;
  } catch (error) {
    return { ok: false, revision: null, manifest: null, problems: [`${MANIFEST_FILE} unreadable: ${error instanceof Error ? error.message : String(error)}`] };
  }

  const expectedFiles = new Set([MANIFEST_FILE, ...SNAPSHOT_FILES.map((file) => SNAPSHOT_FILE_NAMES[file])]);
  for (const name of readdirSync(dir)) if (!expectedFiles.has(name)) problems.add(`Unexpected file ${name} in the revision.`);
  if (contentHashOf(manifest.files) !== manifest.contentHash) problems.add('Content hash does not match the listed files.');
  if (revisionFor(manifest.asOf, manifest.contentHash) !== manifest.revision) problems.add('Revision ID does not match its observation cut and content.');

  // Source dates must tell one coherent story.
  const { window, source, founding } = manifest;
  if (window.lastObservationAt !== manifest.asOf) problems.add('The observation cut is not the last sweep.');
  if (window.firstObservationAt > manifest.asOf) problems.add('The window starts after its cut.');
  if (source.http.statusSince !== window.firstObservationAt) problems.add('HTTP status and database first sweep disagree.');
  if (manifest.asOf > source.database.openedAt) problems.add('The cut is later than the database snapshot.');
  if (source.database.openedAt > manifest.importedAt || source.http.readAt > manifest.importedAt) problems.add('A source read is dated after the import.');
  if (founding.edition0EligibleAt !== window.firstObservationAt + EDITION_0_MIN_MS ||
    founding.editionIEligibleAt !== window.firstObservationAt + EDITION_I_MIN_MS) problems.add('Founding eligibility dates are wrong.');
  if (founding.observedMs !== manifest.asOf - window.firstObservationAt) problems.add('Observed duration is wrong.');

  const sweeps = readRecords(dir, manifest, 'sweeps', problems) as Sweep[] | null;
  if (sweeps) {
    if (sweeps.length !== window.sweeps) problems.add('Sweep count differs from the window.');
    if (sweeps[0]?.at !== window.firstObservationAt || sweeps[sweeps.length - 1]?.at !== manifest.asOf) problems.add('Sweeps do not span the window.');
    for (let i = 1; i < sweeps.length; i++) if (sweeps[i]!.at <= sweeps[i - 1]!.at) problems.add(`sweeps:${i + 1}: not strictly increasing.`);
  }

  const games = readRecords(dir, manifest, 'games', problems) as Game[] | null;
  const gameIds = new Set<string>();
  games?.forEach((game, index) => {
    if (index && compareIds(games[index - 1]!.gameId, game.gameId) >= 0) problems.add(`games:${index + 1}: not in ID order.`);
    gameIds.add(game.gameId);
  });

  const channels = readRecords(dir, manifest, 'channels', problems) as ChannelObservation[] | null;
  const offMap = new Set<string>();
  if (channels) {
    let candidates = 0;
    let live = 0;
    let liveCandidates = 0;
    channels.forEach((channel, index) => {
      const at = `channels:${index + 1} (${channel.kingdomId})`;
      if (index && compareIds(channels[index - 1]!.kingdomId, channel.kingdomId) >= 0) problems.add(`${at}: duplicate or out of order.`);
      if (channel.lastLiveAt > manifest.asOf || channel.firstSeenAt < window.firstObservationAt || channel.firstSeenAt > channel.lastLiveAt) {
        problems.add(`${at}: dates outside the observation window.`);
      }
      if (channel.live && channel.lastLiveAt !== manifest.asOf) problems.add(`${at}: live but not seen by the last sweep.`);
      if (channel.stream && manifest.asOf - channel.lastLiveAt > RAW_CONTENT_MAX_AGE_MS) problems.add(`${at}: keeps stream facts past retention.`);
      if (channel.stream?.startedAt != null && channel.stream.startedAt > manifest.asOf) problems.add(`${at}: stream starts after the cut.`);
      if (channel.avatarUrl && manifest.asOf - channel.factsAt > RAW_CONTENT_MAX_AGE_MS) problems.add(`${at}: keeps an avatar past retention.`);
      if (channel.kingdomCandidate !== isKingdomCandidate(channel.liveMinutes, channel.viewerMinutes)) {
        problems.add(`${at}: candidate flag disagrees with its average.`);
      }
      for (const category of channel.categories) if (games && !gameIds.has(category.gameId)) problems.add(`${at}: unknown category ${category.gameId}.`);
      if (channel.kingdomCandidate) candidates++;
      if (channel.kingdomCandidate && publicVisibility(channel) !== 'public') offMap.add(channel.kingdomId);
      if (channel.live) live++;
      if (channel.live && channel.kingdomCandidate) liveCandidates++;
    });
    const { counts } = manifest;
    if (counts.channels !== channels.length || counts.kingdomCandidates !== candidates || counts.liveChannels !== live ||
      counts.liveCandidates !== liveCandidates) problems.add('Channel counts in the manifest do not match the records.');
  }

  const pairs = readRecords(dir, manifest, 'raidPairs', problems) as RaidPair[] | null;
  pairs?.forEach((pair, index) => {
    const previous = pairs[index - 1];
    if (previous && (compareIds(previous.fromKingdomId, pair.fromKingdomId) || compareIds(previous.toKingdomId, pair.toKingdomId)) >= 0) {
      problems.add(`raidPairs:${index + 1}: duplicate or out of order.`);
    }
    if (pair.lastAt > source.database.openedAt) problems.add(`raidPairs:${index + 1}: dated after the snapshot.`);
  });

  const observations = readRecords(dir, manifest, 'raidObservations', problems) as RaidObservation[] | null;
  if (observations) {
    const ids = new Set<string>();
    let between = 0;
    observations.forEach(({ raid, betweenCandidates }, index) => {
      if (ids.has(raid.id)) problems.add(`raidObservations:${index + 1}: duplicate observation.`);
      ids.add(raid.id);
      if (index && observations[index - 1]!.raid.observedAt > raid.observedAt) problems.add(`raidObservations:${index + 1}: out of time order.`);
      if (raid.observedAt > source.database.openedAt) problems.add(`raidObservations:${index + 1}: dated after the snapshot.`);
      if (raid.source !== 'surveyor-recorder' || raid.evidence.kind !== 'observed') problems.add(`raidObservations:${index + 1}: not a recorder observation.`);
      if (betweenCandidates) between++;
    });
    if (manifest.counts.raidObservations !== observations.length || manifest.counts.raidObservationsBetweenCandidates !== between) {
      problems.add('Raid observation counts in the manifest do not match the records.');
    }
  }
  if (pairs && manifest.counts.raidPairs !== pairs.length) problems.add('Raid pair count in the manifest does not match the records.');
  if (games && manifest.counts.games !== games.length) problems.add('Game count in the manifest does not match the records.');

  const list = problems.done();
  const records = channels && games && pairs && observations ? { channels, games, raidPairs: pairs, raidObservations: observations } : null;
  return { ok: list.length === 0, revision: manifest.revision, manifest, problems: list, ...(channels ? { offMap } : {}), ...(records ? { records } : {}) };
}

/** Checks what readers would actually get: the current pointer, its manifest hash, that revision and the ledger. */
export function checkDataDir(dataDir: string, revision?: string): CheckReport {
  let pointer;
  try {
    pointer = readCurrent(dataDir);
  } catch (error) {
    return { ok: false, revision: null, manifest: null, problems: [`current.json is invalid: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const target = revision ?? pointer?.revision;
  if (!target) return { ok: false, revision: null, manifest: null, problems: ['No imported revision yet. Run atlas:import first.'] };
  let dir: string;
  try {
    dir = revisionDir(dataDir, target);
  } catch {
    return { ok: false, revision: null, manifest: null, problems: ['Revision ID is not valid.'] };
  }
  if (!existsSync(dir)) return { ok: false, revision: target, manifest: null, problems: [`Revision ${target} is missing from ATLAS_DATA_DIR.`] };
  const report = checkRevisionDir(dir);
  const extra: string[] = [];
  if (pointer && pointer.revision === target && sha256(readFileSync(join(dir, MANIFEST_FILE))) !== pointer.manifestSha256) {
    extra.push('current.json does not match the revision manifest hash.');
  }
  try {
    readLedger(dataDir);
  } catch {
    extra.push('The import ledger has an invalid entry.');
  }
  if (report.manifest) extra.push(...checkPreview(dataDir, report.manifest, report.offMap, report.ok ? report.records : undefined));
  const withheld = withheldReader(dataDir).current();
  if (withheld.error) extra.push(`${withheld.error} (names are refused until it is fixed).`);
  const problems = [...report.problems, ...extra];
  return { ...report, ok: problems.length === 0, problems };
}

/**
 * A revision is never current without its land (Spec 01 R2): its survey preview must exist, belong to it, and pass
 * the full preview verification (hashes, shapes, label, every mapped channel once on dry land, no overlaps).
 */
export function checkPreview(dataDir: string, manifest: SnapshotManifest, offMap?: ReadonlySet<string>, records?: RevisionRecords): string[] {
  const id = previewIdFor(manifest.revision, manifest.asOf);
  const dir = previewDir(dataDir, id);
  if (!existsSync(dir)) return [`Survey preview ${id} for revision ${manifest.revision} is missing. Run atlas:preview to draw it from the local revision.`];
  const problems = verifyPreviewDir(dir, { id, revision: manifest.revision });
  if (offMap && problems.length === 0) {
    const drawn = readPreviewNames(dataDir, id).ids.filter((channel) => offMap.has(channel));
    if (drawn.length) problems.push(`${drawn.length} channels the visibility gate excludes (gone or gambling) are drawn, e.g. ${drawn[0]}.`);
  }
  // Same input, same land: redraw the preview from its revision and require identical bytes.
  if (records && problems.length === 0) problems.push(...previewReproduces(dataDir, id, manifest, records));
  return problems.map((problem) => bound(`Survey preview ${id}: ${problem}`, 240));
}

export function assertRevisionDir(dir: string): void {
  const report = checkRevisionDir(dir);
  if (!report.ok) throw new AtlasError('check', 'The written revision failed verification; the previous revision stays current.', report.problems);
}

/** The stored preview's world and names must be exactly what its revision draws today. */
export function previewReproduces(dataDir: string, id: string, manifest: SnapshotManifest, records: Pick<RevisionRecords, 'channels' | 'games'>): string[] {
  const stored = readPreviewManifest(dataDir, id);
  const rebuilt = buildPreview({ manifest, channels: records.channels, games: records.games });
  const problems: string[] = [];
  if (rebuilt.manifest.world.sha256 !== stored.world.sha256) problems.push('world.json is not reproducible from its revision (same input gave different land).');
  if (rebuilt.manifest.names.sha256 !== stored.names.sha256) problems.push('names.json is not reproducible from its revision.');
  for (const region of rebuilt.world.regions) {
    const file = join(previewDir(dataDir, id), region.chunk.path);
    if (!existsSync(file) || sha256(readFileSync(file)) !== region.chunk.sha256) problems.push(`${region.chunk.path} is not reproducible from its revision.`);
  }
  return problems.slice(0, 5);
}
