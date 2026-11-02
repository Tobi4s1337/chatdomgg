import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import type { AtlasEdition, KingdomId } from '@chatdom/shared';
import { compareIds, sha256 } from '../export/project';
import { KINGDOM_CANDIDATE_MIN_AVERAGE, type ChannelObservation, type SnapshotManifest } from '../export/schema';
import { GAMBLING_POLICY, publicVisibility } from '../policy/visibility';
import {
  PREVIEW_KIND, PreviewChunkSchema, PreviewIdSchema, PreviewManifestSchema, PreviewNamesSchema, PreviewWorldSchema, TIER_CODES,
  type PreviewChunk, type PreviewNames, type PreviewWorld, type PublishedFounding, type SettlerColumns,
} from '../preview/schema';
import type { PreviewFiles } from '../preview/build';
import { writePreview } from '../preview/store';
import type { LedgerState } from './ledger';
import { LedgerLineSchema, type EditionWorld, type Founding } from './schema';

/**
 * An edition is drawn to the map as an **edition publication**: one night of a founded edition, in exactly the shape
 * of a survey preview (world.json, region-N.json, names.json, manifest.json under `previews/<id>/`), so every reader
 * of the map (service routes, live frames, search, roads, the browser) keeps working unchanged. What differs:
 *
 *  - the geometry is the edition's frozen world, byte for byte the same fields, never redrawn;
 *  - the holdings are the ledger's, at their granted point and holding tier, founding holdings first in each file
 *    (`founded` counts them: the pencil base), later grants after them in ordinal order;
 *  - tombstoned holdings keep their ground in the files and are listed in names.json as `tombstoned`, so the names
 *    projection draws them bare and nobody else is ever granted them;
 *  - averages, main games and names come from the night's survey: facts move, land does not;
 *  - `status: 'edition'`, the edition's label, and a `founding` block naming the edition, its content address and
 *    the ledger head this publication draws.
 *
 * The publication is a pure function of the edition files and the ledger prefix up to its head (the night's revision
 * is named by the ledger), so `atlas:check` can rebuild it byte for byte, and a service that adopts the same edition
 * files publishes the same bytes without anything being refounded.
 */
export const PUBLICATION_SALT = 'chatdom-atlas-edition-publication';
export const PUBLISHED_FILE = 'published.json';

/**
 * The content address of a founded edition: everything the founding wrote and nothing a later night adds. Two
 * services holding the same founded files derive the same address, whatever their own paths or clocks.
 */
export function editionAddress(input: { edition: AtlasEdition; foundingBytes: Uint8Array | string; taxonomyText: string; ledgerText: string }): string {
  return sha256(`chatdom-atlas-edition:${input.edition.id}:${input.edition.worldHash}:${sha256(JSON.stringify(input.edition))}:${sha256(input.foundingBytes)}:${sha256(input.taxonomyText)}:${foundingHead(input.ledgerText)}`);
}

/** The chain head after the founding night: the last line the founding itself wrote. */
export function foundingHead(ledgerText: string): string {
  for (const raw of ledgerText.split('\n')) {
    if (raw && LedgerLineSchema.parse(JSON.parse(raw)).kind === 'night') return sha256(raw);
  }
  throw new Error('The ledger has no founding night.');
}

/** The ledger exactly as it stood at an acknowledged head: its first `lines` lines. */
export function ledgerPrefix(ledgerText: string, lines: number): string {
  let offset = 0;
  for (let i = 0; i < lines; i++) {
    const end = ledgerText.indexOf('\n', offset);
    if (end < 0) throw new Error(`The ledger has fewer than ${lines} lines.`);
    offset = end + 1;
  }
  return ledgerText.slice(0, offset);
}

export function publicationIdFor(address: string, head: string, revision: string, asOf: number): string {
  const stamp = new Date(asOf).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `pv-${stamp}-${sha256(`${PUBLICATION_SALT}:${address}:${head}:${revision}`).slice(0, 12)}`;
}

function mainGame(channel: ChannelObservation | undefined): string | null {
  let best: { gameId: string; minutes: number } | null = null;
  for (const category of channel?.categories ?? []) {
    if (!best || category.minutes > best.minutes || (category.minutes === best.minutes && compareIds(category.gameId, best.gameId) < 0)) best = category;
  }
  return best?.gameId ?? null;
}

const encoder = new TextEncoder();
const json = (value: unknown) => encoder.encode(`${JSON.stringify(value)}\n`);

export interface PublicationInput {
  edition: AtlasEdition;
  founding: Founding;
  world: EditionWorld;
  address: string;
  /** The ledger replayed to the head being published. Its last night names `manifest`. */
  state: LedgerState;
  /** The night's survey: the revision of the ledger's last night. */
  manifest: SnapshotManifest;
  channels: readonly ChannelObservation[];
  /**
   * Names of holdings the night's survey did not observe (raided channels under the sweep's floor, claims), from the
   * answers Twitch gave for them. The survey's own name always wins.
   */
  arrived?: ReadonlyMap<string, ArrivedName>;
}

export interface ArrivedName { login: string; name: string; factsAt: number }

/** Pure and deterministic: the same edition, ledger prefix and survey always give byte-identical files. */
export function buildEditionPublication(input: PublicationInput): PreviewFiles {
  const { edition, founding, world, state, manifest } = input;
  if (!state.lastNight || state.lastNight.revision !== manifest.revision) {
    throw new Error(`The publication draws ${manifest.revision}, but the ledger's last night is ${state.lastNight?.revision ?? 'none'}.`);
  }
  const id = publicationIdFor(input.address, state.head, manifest.revision, manifest.asOf);
  const channels = new Map(input.channels.map((channel) => [channel.kingdomId, channel]));
  const gameIndex = new Map(world.games.map((game, i) => [game.gameId, i]));
  const tombstoned = new Set(state.tombstones.keys() as Iterable<KingdomId>);

  type Row = { ordinal: number; id: KingdomId; tier: number; x: number; y: number; average: number; game: number; region: number; realm: number };
  const rows: Row[] = state.settlers.map((settler) => {
    const channel = channels.get(settler.kingdomId);
    const game = mainGame(channel);
    return {
      ordinal: settler.ordinal,
      id: settler.kingdomId,
      tier: TIER_CODES.indexOf(settler.holdingTier),
      x: Math.round(settler.point.x * world.coordScale),
      y: Math.round(settler.point.y * world.coordScale),
      average: Math.round(channel?.averageViewers ?? 0),
      game: game === null ? -1 : gameIndex.get(game) ?? -1,
      region: world.realms[settler.realmIndex]!.region,
      realm: settler.realmIndex,
    };
  });
  const columns = (list: readonly Row[]): SettlerColumns => ({
    ids: list.map((row) => row.id) as SettlerColumns['ids'],
    tier: list.map((row) => row.tier),
    x: list.map((row) => row.x),
    y: list.map((row) => row.y),
    average: list.map((row) => row.average),
    game: list.map((row) => row.game),
    region: list.map((row) => row.region),
    realm: list.map((row) => row.realm),
    // Settlers are in ordinal order and founding holdings hold the first ordinals, so they lead every file.
    founded: list.filter((row) => row.ordinal < founding.settlers).length,
  });

  const files = new Map<string, Uint8Array>();
  const regionChunks = world.regions.map((region) => {
    const list = rows.filter((row) => row.region === region.index && row.tier >= 2);
    const chunk: PreviewChunk = PreviewChunkSchema.parse({ version: 1, kind: `${PREVIEW_KIND}-region`, preview: id, region: region.index, settlers: columns(list) });
    const path = `region-${region.index}.json`;
    const bytes = json(chunk);
    files.set(path, bytes);
    return { path, sha256: sha256(bytes), bytes: bytes.byteLength, records: list.length };
  });
  const head = rows.filter((row) => row.tier <= 1);
  const tierCount = (code: string) => rows.filter((row) => row.tier === TIER_CODES.indexOf(code as typeof TIER_CODES[number])).length;
  const later = rows.filter((row) => row.ordinal >= founding.settlers).length;
  let excludedGambling = 0;
  for (const channel of input.channels) if (channel.kingdomCandidate && publicVisibility(channel) === 'gambling') excludedGambling++;

  const published: PublishedFounding = {
    status: 'founded',
    edition: edition.id as PublishedFounding['edition'],
    label: edition.label as PublishedFounding['label'],
    foundedAt: edition.foundedAt,
    worldHash: edition.worldHash,
    address: input.address,
    rehearsal: founding.rehearsal !== undefined,
    ledger: { lines: state.lines, settlers: state.settlers.length, head: state.head },
    night: { revision: state.lastNight.revision, asOf: state.lastNight.asOf },
  };
  const geometry: Partial<EditionWorld> = { ...world };
  for (const key of ['version', 'kind', 'edition', 'revision', 'asOf', 'regions'] as const) delete geometry[key];
  const regions = world.regions;
  const previewWorld: PreviewWorld = PreviewWorldSchema.parse({
    version: 1,
    kind: PREVIEW_KIND,
    id,
    label: edition.label,
    status: 'edition',
    revision: manifest.revision,
    asOf: manifest.asOf,
    window: {
      firstObservationAt: manifest.window.firstObservationAt, lastObservationAt: manifest.window.lastObservationAt,
      hours: manifest.window.hours, sweeps: manifest.window.sweeps, gapCount: manifest.window.gapCount,
    },
    coverage: {
      sweepFloorViewers: manifest.coverage.sweep.floorViewers,
      candidateMinAverage: KINGDOM_CANDIDATE_MIN_AVERAGE,
      contentLabels: manifest.coverage.contentLabels,
      missing: manifest.coverage.missing,
    },
    founding: published,
    policy: { gambling: GAMBLING_POLICY.version, excludedGambling },
    counts: {
      channelsObserved: manifest.counts.channels,
      mapped: rows.length,
      languages: world.regions.filter((region) => region.language !== null).length,
      capital: tierCount('capital'), city: tierCount('city'), town: tierCount('town'), village: tierCount('village'), hamlet: tierCount('hamlet'),
      // The founding's free slots, less one for every holding granted since (each takes at least one).
      hamletSlots: Math.max(0, world.realms.reduce((sum, realm) => sum + realm.slots, 0) - later),
    },
    ...geometry,
    regions: regions.map((region) => ({ ...region, chunk: regionChunks[region.index]! })),
    head: columns(head),
  });
  const worldBytes = json(previewWorld);
  files.set('world.json', worldBytes);

  const nameOf = (kingdomId: KingdomId): ArrivedName | null => {
    const channel = channels.get(kingdomId);
    if (channel) return { login: channel.login, name: channel.displayName, factsAt: channel.factsAt };
    return input.arrived?.get(kingdomId) ?? null;
  };
  const named = rows.filter((row) => !tombstoned.has(row.id) && nameOf(row.id) !== null).sort((a, b) => compareIds(a.id, b.id));
  const names: PreviewNames = PreviewNamesSchema.parse({
    version: 1,
    kind: `${PREVIEW_KIND}-names`,
    preview: id,
    revision: manifest.revision,
    ids: named.map((row) => row.id),
    logins: named.map((row) => nameOf(row.id)!.login),
    names: named.map((row) => nameOf(row.id)!.name),
    factsAt: named.map((row) => nameOf(row.id)!.factsAt),
    tombstoned: [...tombstoned].sort(compareIds),
  });
  const namesBytes = json(names);
  files.set('names.json', namesBytes);
  const previewManifest = PreviewManifestSchema.parse({
    version: 1,
    kind: `${PREVIEW_KIND}-manifest`,
    id,
    revision: manifest.revision,
    asOf: manifest.asOf,
    world: { path: 'world.json', sha256: sha256(worldBytes), bytes: worldBytes.byteLength, records: head.length },
    names: { path: 'names.json', sha256: sha256(namesBytes), bytes: namesBytes.byteLength, records: named.length },
  });
  return { id, manifest: previewManifest, world: previewWorld, names, files };
}

/**
 * Which publication the map serves now: written after every founding and settlement, only once the publication it
 * names is verified in place. Once an edition is founded the map never falls back to a survey preview.
 */
export interface PublishedPointer {
  version: 1;
  edition: string;
  label: string;
  address: string;
  preview: string;
  revision: string;
  asOf: number;
  head: string;
  lines: number;
  foundedAt: number;
  worldHash: string;
  rehearsal: boolean;
}

export const publishedPath = (dataDir: string) => join(dataDir, 'editions', PUBLISHED_FILE);

export function readPublished(dataDir: string): PublishedPointer | null {
  const path = publishedPath(dataDir);
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as PublishedPointer;
  if (parsed.version !== 1 || !PreviewIdSchema.safeParse(parsed.preview).success) throw new Error('editions/published.json is not a publication pointer.');
  return parsed;
}

/** Writes the publication (verified, immutable, idempotent) and then, atomically, the pointer to it. */
export function writePublication(dataDir: string, publication: PreviewFiles, pointer: Omit<PublishedPointer, 'version' | 'preview'>): 'written' | 'existing' {
  const outcome = writePreview(dataDir, publication);
  const path = publishedPath(dataDir);
  mkdirSync(join(dataDir, 'editions'), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify({ version: 1, ...pointer, preview: publication.id }, null, 2)}\n`);
    const fd = openSync(temp, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
  return outcome;
}
