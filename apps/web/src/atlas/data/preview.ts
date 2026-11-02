/**
 * The map as the browser receives it from the Atlas service (`/map-data/v1/preview…`), in one of two shapes served
 * through the same files and routes:
 *
 * - a **survey preview**: draft land redrawn from one real observation revision, never founded;
 * - an **edition publication**: one night of a founded edition (Edition 0 or Edition I), whose land never moves.
 *   It adds the founding record, hamlets (tier 4, in region chunks only) and, per settler file, how many of its
 *   holdings are the edition's founding holdings.
 *
 * Neither is ever SIMULATED. Every file is checked against the hash it was pinned with before a single mark is
 * drawn, and its shape is validated strictly for the shape it says it is.
 */
export const PREVIEW_LABEL = 'Survey preview · land awaiting founding';
export const EDITION_LABELS = ['Edition 0', 'Edition I'] as const;
export type EditionLabel = typeof EDITION_LABELS[number];
export const EDITION_IDS = ['ed-0', 'ed-1'] as const;
export type EditionId = typeof EDITION_IDS[number];
/** Each edition's own label, by ID. */
export const EDITION_LABEL_OF: Readonly<Record<EditionId, EditionLabel>> = { 'ed-0': 'Edition 0', 'ed-1': 'Edition I' };
/**
 * Holding tiers by code. A hamlet (4) is a holding below 25 average viewers, granted land by a raid or by its
 * streamer's claim: it exists only in an edition, and only in region chunks. A survey preview never draws one.
 */
export const TIER_CODES = ['capital', 'city', 'town', 'village', 'hamlet'] as const;
export type Tier = typeof TIER_CODES[number];
/** The tiers a survey assigns from observed averages; each has a minimum average and a holding radius in the world file. */
export type SurveyTier = Exclude<Tier, 'hamlet'>;
export const HAMLET_RANK = 4;
export const DECOR_KINDS = ['mountain', 'hill', 'forest', 'marsh', 'monster', 'ship'] as const;
export type DecorKind = typeof DECOR_KINDS[number];
export const REGION_KINDS = ['continent', 'isle', 'outer'] as const;
export type RegionKind = typeof REGION_KINDS[number];
/** The Crossroads at a continent's heart, one realm per family of games, the Wilds at its edge; an isle is one realm. */
export const REALM_KINDS = ['crossroads', 'family', 'wilds', 'isle', 'outer'] as const;
export type RealmKind = typeof REALM_KINDS[number];
/** Which realms each kind of region may hold. */
const REALMS_OF: Record<RegionKind, readonly RealmKind[]> = { continent: ['crossroads', 'family', 'wilds'], isle: ['isle'], outer: ['outer'] };

export interface FileRef { path: string; sha256: string; bytes: number; records: number }

export interface PointerEdition { id: EditionId; label: EditionLabel; foundedAt: number; worldHash: string; address: string }

export interface PreviewPointer {
  version: 1;
  id: string;
  revision: string;
  asOf: number;
  world: { url: string; sha256: string; bytes: number };
  /** Present when the current publication is a night of a founded edition. */
  edition?: PointerEdition;
}

/** Geometry only: the immutable files carry no logins or names (those come from the names projection). */
export interface SettlerColumns {
  ids: string[];
  tier: number[];
  x: number[];
  y: number[];
  average: number[];
  game: number[];
  region: number[];
  realm: number[];
  /**
   * Editions only: the first `founded` entries of this file are the edition's founding holdings, the rest were
   * granted on later nights. Absent on a survey preview, where every holding counts as founding.
   */
  founded?: number;
}

export interface PreviewRegion {
  index: number;
  /** Null only for the Outer Isles, which belong to no language. */
  language: string | null;
  name: string;
  englishName: string;
  kind: RegionKind;
  x: number;
  y: number;
  r: number;
  members: number;
  chunk: FileRef;
}

export interface PreviewRealm {
  index: number;
  region: number;
  kind: RealmKind;
  /** Index into the preview's families for a family realm, otherwise -1. */
  family: number;
  name: string;
  x: number;
  y: number;
  r: number;
  members: number;
  /** Free hamlet slots in this realm's waiting land. */
  slots: number;
}

export interface NotFounded { status: 'not-founded'; edition0EligibleAt: number; editionIEligibleAt: number }

/** What an edition publication says of its edition: which one, when it was founded, and which night this is. */
export interface Founding {
  status: 'founded';
  edition: EditionId;
  label: EditionLabel;
  foundedAt: number;
  /** The frozen world's hash, and the content address of the founded files. */
  worldHash: string;
  address: string;
  /** True only for a rehearsal staged with a rehearsal key: nothing is founded. */
  rehearsal: boolean;
  ledger: { lines: number; settlers: number; head: string };
  /** The survey night this publication draws. */
  night: { revision: string; asOf: number };
}

interface WorldFields {
  version: 1;
  kind: 'chatdom-atlas-survey-preview';
  id: string;
  algorithm: string;
  revision: string;
  asOf: number;
  window: { firstObservationAt: number; lastObservationAt: number; hours: number; sweeps: number; gapCount: number };
  coverage: { sweepFloorViewers: number; candidateMinAverage: number; contentLabels: 'not-collected'; missing: string[] };
  policy: { gambling: string; excludedGambling: number };
  counts: {
    channelsObserved: number; mapped: number; languages: number; capital: number; city: number; town: number; village: number;
    /** Editions only: holdings below 25 average viewers, granted by raid or claim. */
    hamlet?: number;
    hamletSlots: number;
  };
  /** The family taxonomy the realms were drawn with. A proposal is never founder approval. */
  taxonomy: { id: string; status: 'proposed' | 'reviewed'; sha256: string; variety: string; realmThreshold: string };
  lattice: { id: string; hamletRadius: number; shore: number; gap: number };
  coordScale: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** A hamlet's holding radius is `lattice.hamletRadius`; it has no minimum average (it is granted, not surveyed). */
  tiers: { minAverage: Record<SurveyTier, number>; holdingRadius: Record<SurveyTier, number> };
  regions: PreviewRegion[];
  isles: { name: string; x: number; y: number; r: number } | null;
  outer: { name: string; x: number; y: number; r: number };
  families: { id: string; name: string }[];
  realms: PreviewRealm[];
  games: { gameId: string; name: string | null }[];
  clusters: { region: number; realm: number; game: number; x: number; y: number; r: number; members: number }[];
  coasts: { region: number; points: number[] }[];
  decor: number[];
  head: SettlerColumns;
}

/** Draft land from one observation revision. */
export interface SurveyWorld extends WorldFields {
  label: typeof PREVIEW_LABEL;
  status: 'preview';
  founding: NotFounded;
}

/**
 * One night of a founded edition. Holdings are drawn at the tier they were granted, which never changes: the
 * average shown may sit above or below that tier's band.
 */
export interface EditionWorld extends WorldFields {
  label: EditionLabel;
  status: 'edition';
  founding: Founding;
}

export type PreviewWorld = SurveyWorld | EditionWorld;

export function isEdition(world: Pick<PreviewWorld, 'status'>): world is EditionWorld {
  return world.status === 'edition';
}

/** Holding radii in world units by tier rank: the four surveyed tiers, then the hamlet's lattice radius. */
export function holdingRadii(world: Pick<PreviewWorld, 'tiers' | 'lattice'>): readonly number[] {
  const r = world.tiers.holdingRadius;
  return [r.capital, r.city, r.town, r.village, world.lattice.hamletRadius];
}

export interface PreviewChunk {
  version: 1;
  kind: 'chatdom-atlas-survey-preview-region';
  preview: string;
  region: number;
  settlers: SettlerColumns;
}

/**
 * The names projection at one moment (`/v1/preview/<id>/names`, revalidated on every use). Withheld holdings are
 * drawn as bare land; a holding with no entry, or whose entry is past `freshUntil`, keeps its shield without a name.
 */
export interface ServedNames {
  version: 1;
  kind: 'chatdom-atlas-survey-preview-served-names';
  preview: string;
  servedAt: number;
  withheld: string[];
  ids: string[];
  logins: string[];
  names: string[];
  freshUntil: number[];
}

export class PreviewError extends Error {
  constructor(readonly reason: 'unavailable' | 'empty' | 'invalid' | 'mismatch', message: string) {
    super(message);
    this.name = 'PreviewError';
  }
}

// ── Strict validation ─────────────────────────────────────────────────────────────────────────────────────────
export type Check = (value: unknown, path: string) => void;
export const fail = (path: string, what: string): never => {
  throw new PreviewError('invalid', `${path}: expected ${what}`);
};
export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function strict(value: unknown, path: string, shape: Record<string, Check>): Record<string, unknown> {
  if (!isObject(value)) return fail(path, 'an object');
  for (const key of Object.keys(value)) if (!Object.hasOwn(shape, key)) fail(`${path}.${key}`, 'no such field');
  for (const [key, check] of Object.entries(shape)) check(value[key], `${path}.${key}`);
  return value;
}
export const int = (min = -2_000_000_000, max = 2_000_000_000): Check => (value, path) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) fail(path, `an integer ${min}…${max}`);
};
const num: Check = (value, path) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'a finite number');
};
export const epoch = int(0, 8_640_000_000_000_000);
export const text = (max: number, pattern?: RegExp): Check => (value, path) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || (pattern && !pattern.test(value))) fail(path, `text up to ${max}`);
};
export const literal = (expected: unknown): Check => (value, path) => {
  if (value !== expected) fail(path, JSON.stringify(expected));
};
export const nullable = (check: Check): Check => (value, path) => {
  if (value !== null) check(value, path);
};
export const oneOf = (options: readonly string[]): Check => (value, path) => {
  if (typeof value !== 'string' || !options.includes(value)) fail(path, `one of ${options.join(', ')}`);
};
const positive: Check = (value, path) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail(path, 'a positive number');
};
export const array = (item: Check, max: number, min = 0): Check => (value, path) => {
  if (!Array.isArray(value) || value.length > max || value.length < min) return fail(path, `an array of ${min}…${max}`);
  value.forEach((entry, i) => item(entry, `${path}[${i}]`));
};
/** Fast path for large integer arrays. */
const ints = (max: number, lo = -2_000_000_000, hi = 2_000_000_000): Check => (value, path) => {
  if (!Array.isArray(value) || value.length > max) return fail(path, `an integer array up to ${max}`);
  for (let i = 0; i < value.length; i++) {
    const v = value[i] as unknown;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) fail(`${path}[${i}]`, 'an integer');
  }
};
export const shape = (fields: Record<string, Check>): Check => (value, path) => void strict(value, path, fields);

const SHA = /^[a-f0-9]{64}$/;
export const PREVIEW_ID = /^pv-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}$/;
export const REVISION = /^obs-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}$/;
const MAX = 1_000_000;

const fileRef = shape({ path: text(64, /^[a-z0-9-]+\.json$/), sha256: text(64, SHA), bytes: int(0), records: int(0) });

export const CHANNEL_ID = /^[1-9][0-9]{0,31}$/;
/** Optional: absent is fine, anything present must pass. */
export const optional = (check: Check): Check => (value, path) => {
  if (value !== undefined) check(value, path);
};
/** Settler columns; only an edition's files may say how many of their holdings are founding holdings. */
const settlerColumns = (edition: boolean): Check => (value, path) => {
  const columns = strict(value, path, {
    ids: array(text(32, CHANNEL_ID), MAX),
    tier: ints(MAX, 0, TIER_CODES.length - 1),
    x: ints(MAX),
    y: ints(MAX),
    average: ints(MAX, 0, Number.MAX_SAFE_INTEGER),
    game: ints(MAX, -1, 20_000),
    region: ints(MAX, 0, 65_535),
    realm: ints(MAX, 0, 65_535),
    ...(edition ? { founded: optional(int(0, MAX)) } : {}),
  });
  const n = (columns.ids as unknown[]).length;
  for (const key of ['tier', 'x', 'y', 'average', 'game', 'region', 'realm']) {
    if ((columns[key] as unknown[]).length !== n) fail(`${path}.${key}`, `${n} entries`);
  }
  if (columns.founded !== undefined && (columns.founded as number) > n) fail(`${path}.founded`, `at most ${n} founding holdings`);
};

const editionId = oneOf(EDITION_IDS);
const editionLabel = oneOf(EDITION_LABELS);
const bool: Check = (value, path) => {
  if (typeof value !== 'boolean') fail(path, 'a boolean');
};
/** An edition's ID and label name the same edition. */
function sameEdition(id: EditionId, label: EditionLabel, path: string): void {
  if (EDITION_LABEL_OF[id] !== label) fail(path, `${EDITION_LABEL_OF[id]} for ${id}`);
}

export function validatePointer(value: unknown): PreviewPointer {
  strict(value, 'pointer', {
    version: literal(1),
    id: text(64, PREVIEW_ID),
    revision: text(64, REVISION),
    asOf: epoch,
    world: shape({ url: text(256, /^\/(?!\/)[A-Za-z0-9_./-]+$/), sha256: text(64, SHA), bytes: int(1, 64_000_000) }),
    edition: optional(shape({ id: editionId, label: editionLabel, foundedAt: epoch, worldHash: text(64, SHA), address: text(64, SHA) })),
  });
  const pointer = value as PreviewPointer;
  if (pointer.edition) sameEdition(pointer.edition.id, pointer.edition.label, 'pointer.edition.label');
  return pointer;
}

/**
 * A world in either shape. The shape is chosen by `status` alone, and everything an edition adds (its founding
 * record, hamlets, the hamlet count, founding-holding counts) is refused on a survey preview.
 */
export function validateWorld(value: unknown): PreviewWorld {
  const edition = isObject(value) && value.status === 'edition';
  strict(value, 'world', {
    version: literal(1),
    kind: literal('chatdom-atlas-survey-preview'),
    id: text(64, PREVIEW_ID),
    algorithm: text(64),
    label: edition ? editionLabel : literal(PREVIEW_LABEL),
    status: oneOf(['preview', 'edition']),
    revision: text(64, REVISION),
    asOf: epoch,
    window: shape({ firstObservationAt: epoch, lastObservationAt: epoch, hours: num, sweeps: int(0), gapCount: int(0) }),
    coverage: shape({ sweepFloorViewers: int(0), candidateMinAverage: int(0), contentLabels: literal('not-collected'), missing: array(text(300), 20) }),
    founding: edition
      ? shape({
        status: literal('founded'), edition: editionId, label: editionLabel, foundedAt: epoch, worldHash: text(64, SHA), address: text(64, SHA),
        rehearsal: bool, ledger: shape({ lines: int(0, Number.MAX_SAFE_INTEGER), settlers: int(0, Number.MAX_SAFE_INTEGER), head: text(64, SHA) }),
        night: shape({ revision: text(64, REVISION), asOf: epoch }),
      })
      : shape({ status: literal('not-founded'), edition0EligibleAt: epoch, editionIEligibleAt: epoch }),
    policy: shape({ gambling: text(64), excludedGambling: int(0) }),
    counts: shape({
      channelsObserved: int(0), mapped: int(0), languages: int(0), capital: int(0), city: int(0), town: int(0), village: int(0),
      ...(edition ? { hamlet: optional(int(0)) } : {}),
      hamletSlots: int(0),
    }),
    // Rule versions are matched by form, like the algorithm: a newer rule is still drawn, and the key names it.
    taxonomy: shape({
      id: text(32, /^families-[0-9]{1,4}$/), status: oneOf(['proposed', 'reviewed']), sha256: text(64, SHA),
      variety: text(32, /^variety-[0-9]{1,4}$/), realmThreshold: text(32, /^realm-threshold-[0-9]{1,4}$/),
    }),
    lattice: shape({ id: text(16, /^hex-[0-9]{1,4}$/), hamletRadius: positive, shore: positive, gap: positive }),
    coordScale: int(1, 1000),
    bounds: shape({ minX: int(), minY: int(), maxX: int(), maxY: int() }),
    tiers: shape({
      minAverage: shape({ capital: int(0), city: int(0), town: int(0), village: int(0) }),
      holdingRadius: shape({ capital: num, city: num, town: num, village: num }),
    }),
    regions: array(shape({
      index: int(0, 65_535), language: nullable(text(16)), name: text(128), englishName: text(128), kind: oneOf(REGION_KINDS),
      x: int(), y: int(), r: int(0), members: int(0), chunk: fileRef,
    }), 512, 1),
    isles: nullable(shape({ name: text(128), x: int(), y: int(), r: int(0) })),
    outer: shape({ name: text(128), x: int(), y: int(), r: int(0) }),
    families: array(shape({ id: text(32, /^[a-z][a-z0-9-]{1,31}$/), name: text(128) }), 32),
    realms: array(shape({
      index: int(0, 65_535), region: int(0, 65_535), kind: oneOf(REALM_KINDS), family: int(-1, 31), name: text(128),
      x: int(), y: int(), r: int(0), members: int(0), slots: int(0),
    }), 4_096, 1),
    games: array(shape({ gameId: text(20, /^[0-9]+$/), name: nullable(text(256)) }), 20_000),
    clusters: array(shape({ region: int(0), realm: int(0), game: int(-1), x: int(), y: int(), r: int(0), members: int(0) }), 20_000),
    coasts: array(shape({ region: int(0), points: ints(400_000) }), 50_000),
    decor: ints(600_000),
    head: settlerColumns(edition),
  });
  const world = value as PreviewWorld;
  if (isEdition(world)) {
    if (world.founding.label !== world.label) fail('world.label', `the founding's label, ${world.founding.label}`);
    sameEdition(world.founding.edition, world.founding.label, 'world.founding.label');
  }
  if (world.bounds.maxX <= world.bounds.minX || world.bounds.maxY <= world.bounds.minY) fail('world.bounds', 'a non-empty box');
  if (world.decor.length % 3 !== 0) fail('world.decor', 'triples');
  world.regions.forEach((region, i) => {
    if (region.index !== i) fail(`world.regions[${i}].index`, `${i}`);
    if ((region.language === null) !== (region.kind === 'outer')) fail(`world.regions[${i}].language`, 'a language unless the region is one of the Outer Isles');
  });
  world.realms.forEach((realm, i) => {
    const path = `world.realms[${i}]`;
    if (realm.index !== i) fail(`${path}.index`, `${i}`);
    const region = world.regions[realm.region];
    if (!region) return fail(`${path}.region`, 'a known region');
    if (!REALMS_OF[region.kind].includes(realm.kind)) fail(`${path}.kind`, `a realm of a ${region.kind}`);
    if (realm.kind === 'family' ? realm.family < 0 || realm.family >= world.families.length : realm.family !== -1) fail(`${path}.family`, realm.kind === 'family' ? 'a known family' : '-1');
  });
  for (const coast of world.coasts) if (coast.region >= world.regions.length || coast.points.length % 2) fail('world.coasts', 'rings of known regions');
  world.clusters.forEach((cluster, i) => {
    if (cluster.region >= world.regions.length || cluster.game >= world.games.length) fail('world.clusters', 'known regions and games');
    if (world.realms[cluster.realm]?.region !== cluster.region) fail(`world.clusters[${i}].realm`, 'a realm of its own region');
  });
  checkColumns(world.head, world, 'world.head', [0, 1]);
  return world;
}

function checkColumns(columns: SettlerColumns, world: PreviewWorld, path: string, tiers: readonly number[], region?: number): void {
  for (let i = 0; i < columns.ids.length; i++) {
    if (!tiers.includes(columns.tier[i]!)) fail(`${path}.tier[${i}]`, `one of ${tiers.join(',')}`);
    if (columns.region[i]! >= world.regions.length || (region !== undefined && columns.region[i] !== region)) fail(`${path}.region[${i}]`, 'its region');
    if (world.realms[columns.realm[i]!]?.region !== columns.region[i]) fail(`${path}.realm[${i}]`, 'a realm of its region');
    if (columns.game[i]! >= world.games.length) fail(`${path}.game[${i}]`, 'a known game');
  }
}

export function validateChunk(value: unknown, world: PreviewWorld, region: number): PreviewChunk {
  strict(value, 'chunk', {
    version: literal(1),
    kind: literal('chatdom-atlas-survey-preview-region'),
    preview: literal(world.id),
    region: literal(region),
    settlers: settlerColumns(isEdition(world)),
  });
  const chunk = value as PreviewChunk;
  // Towns and villages; an edition's chunks also hold its hamlets.
  checkColumns(chunk.settlers, world, 'chunk.settlers', isEdition(world) ? [2, 3, HAMLET_RANK] : [2, 3], region);
  return chunk;
}

export function validateNames(value: unknown, preview: string): ServedNames {
  const names = strict(value, 'names', {
    version: literal(1),
    kind: literal('chatdom-atlas-survey-preview-served-names'),
    preview: literal(preview),
    servedAt: epoch,
    withheld: array(text(32, CHANNEL_ID), MAX),
    ids: array(text(32, CHANNEL_ID), MAX),
    logins: array(text(25, /^[a-z0-9_]+$/), MAX),
    names: array(text(128), MAX),
    freshUntil: ints(MAX, 0, 8_640_000_000_000_000),
  }) as unknown as ServedNames;
  const n = names.ids.length;
  for (const key of ['logins', 'names', 'freshUntil'] as const) if (names[key].length !== n) fail(`names.${key}`, `${n} entries`);
  return names;
}

// ── Fetching ──────────────────────────────────────────────────────────────────────────────────────────────────
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface PreviewSource {
  base: string;
  fetch: typeof fetch;
}

/**
 * How long each read may take, body included, before it counts as unavailable. A stalled response never leaves the
 * map loading forever: the reader gets the designed failure and its retry instead.
 */
export const READ_TIMEOUT_MS = { pointer: 10_000, names: 15_000, world: 45_000, chunk: 30_000 } as const;

async function getBytes(source: PreviewSource, url: string, timeoutMs: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
  const local = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    local.abort();
  }, timeoutMs);
  const forward = () => local.abort();
  signal?.addEventListener('abort', forward, { once: true });
  const outcome = (error: unknown): never => {
    if (timedOut) throw new PreviewError('unavailable', `The Atlas service did not answer within ${Math.round(timeoutMs / 1000)} s.`);
    if (signal?.aborted || (error as Error).name === 'AbortError') throw error;
    throw new PreviewError('unavailable', 'The Atlas service could not be reached.');
  };
  try {
    let response: Response;
    try {
      response = await source.fetch(url, { signal: local.signal, credentials: 'omit' });
    } catch (error) {
      return outcome(error);
    }
    if (!response.ok) {
      // The service answers 503 `no-preview` (or `no-revision`) until a survey has been imported.
      if (response.status === 503) {
        const body = await response.text().catch(() => '');
        if (/"no-(preview|revision)"/.test(body)) throw new PreviewError('empty', 'No survey preview has been published yet.');
      }
      throw new PreviewError('unavailable', `The Atlas service answered ${response.status}.`);
    }
    try {
      return await response.arrayBuffer();
    } catch (error) {
      return outcome(error);
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
}

async function pinned(source: PreviewSource, url: string, sha256: string, bytes: number, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  const body = await getBytes(source, url, timeoutMs, signal);
  if (body.byteLength !== bytes || (await sha256Hex(body)) !== sha256) throw new PreviewError('mismatch', `${url} does not match its pinned hash.`);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown;
  } catch {
    throw new PreviewError('invalid', `${url} is not valid JSON.`);
  }
}

export async function fetchPointer(source: PreviewSource, signal?: AbortSignal): Promise<PreviewPointer> {
  const body = await getBytes(source, `${source.base}/v1/preview`, READ_TIMEOUT_MS.pointer, signal);
  try {
    return validatePointer(JSON.parse(new TextDecoder().decode(body)) as unknown);
  } catch (error) {
    if (error instanceof PreviewError) throw error;
    throw new PreviewError('invalid', 'The preview pointer is not valid JSON.');
  }
}

/** The world file is immutable and addressed by preview ID; the pointer pins its hash and length. */
export function worldUrl(source: PreviewSource, id: string): string {
  return `${source.base}/v1/preview/${id}/world.json`;
}

export async function fetchWorld(source: PreviewSource, pointer: Pick<PreviewPointer, 'id' | 'world'>, signal?: AbortSignal): Promise<PreviewWorld> {
  const world = validateWorld(await pinned(source, worldUrl(source, pointer.id), pointer.world.sha256, pointer.world.bytes, READ_TIMEOUT_MS.world, signal));
  if (world.id !== pointer.id) throw new PreviewError('mismatch', 'The world file belongs to another preview.');
  return world;
}

export async function fetchChunk(source: PreviewSource, world: PreviewWorld, region: number, signal?: AbortSignal): Promise<PreviewChunk> {
  const ref = world.regions[region];
  if (!ref) throw new PreviewError('invalid', `Unknown region ${region}.`);
  const value = await pinned(source, `${source.base}/v1/preview/${world.id}/${ref.chunk.path}`, ref.chunk.sha256, ref.chunk.bytes, READ_TIMEOUT_MS.chunk, signal);
  return validateChunk(value, world, region);
}

/**
 * The current names projection for this preview. Not hash-pinned: it changes as names refresh or are withheld. The
 * `head` part holds only the head's names (and every withheld id), small enough for the first frame to wait on.
 */
export async function fetchNames(source: PreviewSource, world: Pick<PreviewWorld, 'id'>, signal?: AbortSignal, part: 'all' | 'head' = 'all'): Promise<ServedNames> {
  const body = await getBytes(source, `${source.base}/v1/preview/${world.id}/names${part === 'head' ? '?part=head' : ''}`, READ_TIMEOUT_MS.names, signal);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown;
  } catch {
    throw new PreviewError('invalid', 'The names are not valid JSON.');
  }
  return validateNames(value, world.id);
}
