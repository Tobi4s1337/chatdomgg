import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompress, constants as zlibConstants, gzipSync } from 'node:zlib';
import { sha256 } from './export/project';
import { publicSurvey, type PublicSurvey } from './export/public';
import { previewIdFor } from './preview/build';
import { nameFreshUntil, withheldReader } from './policy/visibility';
import { appendOwnerAct, OwnerVisibilityRequestSchema, type OwnerAct } from './policy/owner-hide';
import { PREVIEW_KIND, PreviewIdSchema, PreviewWorldSchema, ServedNamesSchema, type PreviewNames } from './preview/schema';
import { previewDir, readPreviewManifest, readPreviewNames } from './preview/store';
import { publishedPath, readPublished } from './edition/publish';
import { appendClaim, claimKeys, ClaimRequestSchema, ClaimSchema, readClaims, type Claim } from './edition/claims';
import { layout, readCurrent, readManifest } from './store/revisions';
import { LIVE_FILES, liveRoot, liveTargetDir, readFrame, readLiveManifest, readLiveState } from './live/store';
import { DirectoryFallback } from './directory/fallback';
import { LookupUnavailable, twitchLookupFromEnv, type TwitchLookup } from './directory/twitch-lookup';
import { loadDirectory, type Directory, type DirectoryRefusal, type Lookup } from './directory/directory';
import { createRoadRuntime, type RoadRuntimeOptions } from './roads/runtime';
import { busiestRoads, caravanEvent, channelRoads, finder, roadStory, type LiveNow, type PublicRoadsContext } from './roads/public';
import { AtlasRaidSchema, type AtlasRaid, type KingdomId } from '@chatdom/shared';

/**
 * The Atlas data service. It serves a fixed set of routes below /map-data from the current revision and nothing
 * else: no file paths, SQL, credentials or table browsing. Routes are matched exactly, so a traversal attempt is
 * just an unknown route.
 */
export const ROUTE_PREFIX = '/map-data';
export const MAX_URL_LENGTH = 2048;
export const MAX_QUERY_LENGTH = 256;

interface Loaded {
  key: string;
  survey: PublicSurvey;
  body: string;
  etag: string;
  /** Pointer to the current revision's survey preview, or null if it has not been drawn. */
  preview: string | null;
}

/** A body kept compressed in memory: gzip at once, brotli once the thread pool has made it (gzip is served until then). */
interface Encoded {
  body: Buffer;
  gzip: Buffer;
  br: Buffer | null;
}

/** An immutable preview file, verified against its pinned hash once and kept compressed in memory. */
interface PreviewFile extends Encoded {
  etag: string;
}

/**
 * Brotli off the event loop. Immutable files take the slow, small quality once; bodies rebuilt every minute take a
 * fast one. A failure leaves gzip in place.
 */
function brotliLater(target: Encoded, quality: number): void {
  brotliCompress(target.body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: quality, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: target.body.byteLength } }, (error, out) => {
    if (!error && out.byteLength < target.gzip.byteLength) target.br = out;
  });
}

/** The smallest encoding this reader accepts. */
function encodingFor(req: IncomingMessage, file: Encoded): { payload: Buffer; encoding: 'br' | 'gzip' | null } {
  const accepted = String(req.headers['accept-encoding'] ?? '');
  if (file.br && /\bbr\b/.test(accepted)) return { payload: file.br, encoding: 'br' };
  if (/\bgzip\b/.test(accepted)) return { payload: file.gzip, encoding: 'gzip' };
  return { payload: file.body, encoding: null };
}

/** Brotli quality for immutable files (made once per preview or frame) and for the names projections (rebuilt often). */
const BROTLI_IMMUTABLE = 11;
const BROTLI_NAMES = 6;
/** JSON replies at least this long are gzipped for readers that accept it; smaller ones are not worth the CPU. */
const SEND_GZIP_MIN = 1_400;

const PREVIEW_FILE = /^\/map-data\/v1\/preview\/(pv-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12})\/(world\.json|region-[0-9]{1,5}\.json)$/;
const PREVIEW_NAMES = /^\/map-data\/v1\/preview\/(pv-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12})\/names$/;
const MAX_CACHED_PREVIEWS = 3;
const LIVE_POINTER = /^\/map-data\/v1\/live\/(pv-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12})$/;
const LIVE_EVENTS = /^\/map-data\/v1\/live\/(pv-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12})\/events$/;
const LIVE_FILE = /^\/map-data\/v1\/live\/(pv-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12})\/(lf-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12})\/(live\.bin|starts\.json|dabs\.bin)$/;
/** One shared watcher looks for a new live manifest this often and tells every open event stream. */
const LIVE_WATCH_MS = 2_000;
const LIVE_HEARTBEAT_MS = 20_000;
/** Open event streams this process will hold; beyond it a reader falls back to its 60 s reconcile. */
export const MAX_LIVE_STREAMS = 4_000;
const MAX_CACHED_FRAMES = 12;
const PREVIEW_ID = 'pv-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}';
const ID = '[1-9][0-9]{0,31}';
const LOGIN = '[a-z0-9_]{1,25}';
const DIRECTORY_SEARCH = new RegExp(`^/map-data/v1/preview/(${PREVIEW_ID})/search$`);
const DIRECTORY_CARD = new RegExp(`^/map-data/v1/preview/(${PREVIEW_ID})/card/(?:(${ID})|login/(${LOGIN})|dab/([a-f0-9]{16}))$`);
const DIRECTORY_ROAD = new RegExp(`^/map-data/v1/preview/(${PREVIEW_ID})/road/(?:(${ID})/(${ID})|login/(${LOGIN})/(${LOGIN}))$`);
/** The road ledger's public reads: one channel's roads, one road's story, and the busiest roads of a land. */
export const ROADS_CHANNEL = new RegExp(`^/map-data/v1/roads/(${PREVIEW_ID})/channel/(${ID})$`);
export const ROADS_STORY = new RegExp(`^/map-data/v1/roads/(${PREVIEW_ID})/road/(?:(${ID})/(${ID})|login/(${LOGIN})/(${LOGIN}))$`);
export const ROADS_BUSIEST = new RegExp(`^/map-data/v1/roads/(${PREVIEW_ID})/busiest$`);
/** The Raid Gate's target finder. */
export const GATE_FINDER = new RegExp(`^/map-data/v1/gate/(${PREVIEW_ID})/finder$`);
const FINDER_FROM = new RegExp(`^${ID}$`);
/** The busiest roads of a land are computed at most this often per withheld list. */
const BUSIEST_CACHE_MS = 60_000;
/** A herald raid rides as a caravan only while it is this fresh (event time to storage). */
export const CARAVAN_FRESH_MS = 60_000;
/** The private road ingest: its one route and its body limit. */
export const INGEST_PATH = '/v1/roads/observe';
/** The private claim intake on the same listener: sign-in and founding claims (see edition/claims.ts). */
export const CLAIMS_PATH = '/v1/claims';
export const INGEST_MAX_BYTES = 16 * 1024;
/**
 * The private owner-visibility routes on the same listener (decision 39): the session authority hides or shows the
 * signed-in broadcaster's own channel, and reads its state for that broadcaster's own card. They need the token.
 */
export const OWNER_VISIBILITY = new RegExp(`^/v1/channels/(${ID})/(hide|unhide|visibility)$`);
/** Registers held in memory at once: the current preview and one a tab may still be pinned to. */
const MAX_DIRECTORIES = 2;
/** A request waits this long for a register still being read before it is told to come back. */
const DIRECTORY_WAIT_MS = 6_000;
const REGISTER_WARM_MS = 30_000;
/** A register that failed to build is not tried again for this long (no retry storm on a broken file). */
const DIRECTORY_RETRY_MS = 30_000;
/** A served names projection is rebuilt at least this often, and whenever a name in it goes stale or the withheld list changes. */
const NAMES_REBUILD_MS = 60_000;

/** The names projection of one preview at one moment. Never cached by intermediaries without revalidation. */
interface NamesBody extends Encoded {
  withheldKey: string;
  builtAt: number;
  /** The earliest moment a name in this body goes stale. */
  staleAt: number;
  etag: string;
}

export interface AtlasServiceOptions {
  /** Optional durable raid-show feed; recorder backfill uses this service's own verified imports. */
  roads?: RoadRuntimeOptions;
  /** Optional public-read Twitch adapter; null disables lookup. */
  twitchLookup?: TwitchLookup | null;
  /** Trust only a loopback reverse proxy which overwrites X-Forwarded-For. */
  trustLoopbackProxy?: boolean;
  /** Injected clock for name freshness. */
  now?: () => number;
  /** How often the live watcher looks for a new frame (tests shorten it). */
  liveWatchMs?: number;
  /** Bearer token the private ingest requires; null requires none. Defaults to ATLAS_INGEST_TOKEN. */
  ingestToken?: string | null;
  /** JSON replies at least this long are gzipped (tests lower it). */
  gzipMin?: number;
  /** Twitch lookups one client address may start per minute (default 6). */
  lookupsPerClientMinute?: number;
  /**
   * Read the served preview's register at start and whenever a new preview becomes current, so the first search after
   * a start or an import does not wait for it. The command-line service turns this on; tests leave it off.
   */
  warmRegister?: boolean;
}

/**
 * Projects a preview's raw names for publication: withheld channels are listed (so the browser draws their land bare)
 * and lose their names. The result is the only way a login or display name leaves this service. With `only`, the
 * names are those of that set alone (the world's head: its capitals and cities), withheld ids still all listed.
 */
export function projectNames(names: PreviewNames, withheld: ReadonlySet<string>, now: number, only: ReadonlySet<string> | null = null): { served: unknown; staleAt: number } {
  const served = {
    version: 1 as const, kind: `${PREVIEW_KIND}-served-names` as const, preview: names.preview, servedAt: now,
    withheld: [] as string[], ids: [] as string[], logins: [] as string[], names: [] as string[], freshUntil: [] as number[],
  };
  let staleAt = Number.POSITIVE_INFINITY;
  // An edition's tombstoned holdings keep their ground but are drawn bare, exactly like withheld ones.
  served.withheld.push(...(names.tombstoned ?? []));
  names.ids.forEach((id, i) => {
    if (withheld.has(id)) {
      served.withheld.push(id);
      return;
    }
    // The head carries every withheld id (so no land is ever drawn named that should be bare) but only its own names.
    if (only && !only.has(id)) return;
    // Names are always served (withholding above still applies); the survey is refreshed every few hours.
    const until = Math.max(nameFreshUntil(names.factsAt[i]!), now + 86_400_000);
    served.ids.push(id);
    served.logins.push(names.logins[i]!);
    served.names.push(names.names[i]!);
    served.freshUntil.push(until);
    if (until < staleAt) staleAt = until;
  });
  return { served: ServedNamesSchema.parse(served), staleAt };
}

export interface AtlasService {
  server: Server;
  /**
   * The private road ingest (`POST /v1/roads/observe`). It shares no route with `server` and is listened on only
   * where the operator binds it: loopback by default, never proxied by the public gateway.
   */
  ingest: Server;
  /** The currently served revision, or null while none has been imported. */
  revision(): string | null;
  close(): Promise<void>;
}

function fileStamp(path: string): string {
  try {
    const stat = statSync(path);
    return `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
  } catch {
    return '-';
  }
}

/** Fixed reason codes for a refused ingest body; the payload itself is never echoed. */
type IngestReason = 'content-type' | 'json' | 'schema' | 'simulation' | 'source' | 'conflict' | 'unknown-channel';

export function createAtlasService(dataDir: string, log: (line: string) => void = () => {}, options: AtlasServiceOptions = {}): AtlasService {
  const paths = layout(dataDir);
  const now = options.now ?? Date.now;
  const gzipMin = options.gzipMin ?? SEND_GZIP_MIN;
  const twitch = options.twitchLookup === undefined ? twitchLookupFromEnv() : options.twitchLookup;
  const fallback = twitch ? new DirectoryFallback(twitch, { now, ...(options.lookupsPerClientMinute ? { perClientMinute: options.lookupsPerClientMinute } : {}) }) : null;
  const trustProxy = options.trustLoopbackProxy ?? process.env.ATLAS_TRUST_LOOPBACK_PROXY === '1';
  function clientIp(req: IncomingMessage): string {
    const remote = req.socket.remoteAddress ?? 'unknown';
    if (trustProxy && /^(?:::ffff:)?127\.|^::1$/.test(remote)) {
      const forwarded = req.headers['x-forwarded-for'];
      if (typeof forwarded === 'string' && /^[a-fA-F0-9:.]{3,64}$/.test(forwarded)) return forwarded;
    }
    return remote;
  }
  const withheld = withheldReader(dataDir);
  const namesCache = new Map<string, NamesBody>();
  let loaded: Loaded | null = null;
  let lastFailure = '';

  /**
   * Reloads only when current.json or the edition's publication pointer changes; a bad swap keeps serving the last
   * good revision. Once an edition is published the map is that publication, never a survey preview again.
   */
  function current(): Loaded | null {
    let key: string;
    try {
      const stat = statSync(paths.current);
      key = `${stat.mtimeMs}:${stat.size}:${stat.ino}|${fileStamp(publishedPath(dataDir))}`;
    } catch {
      return loaded;
    }
    if (loaded?.key === key) return loaded;
    try {
      const pointer = readCurrent(dataDir);
      if (!pointer) return loaded;
      const { manifest, sha256 } = readManifest(dataDir, pointer.revision);
      if (sha256 !== pointer.manifestSha256) throw new Error('manifest hash does not match current.json');
      const survey = publicSurvey(manifest);
      const edition = editionPointer();
      const preview = edition === undefined ? previewPointer(manifest.revision, manifest.asOf) : edition;
      loaded = { key, survey, body: JSON.stringify(survey), etag: `"${manifest.revision}"`, preview };
      log(`serving ${manifest.revision}${edition ? ` as ${JSON.parse(edition).edition.label}` : ''}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== lastFailure) log(`kept ${loaded?.survey.revision ?? 'no revision'}: ${message}`);
      lastFailure = message;
    }
    return loaded;
  }

  /**
   * The founded edition's pointer: undefined when none is published, null when one is published but its publication
   * cannot be read (the map then waits rather than showing draft land), else the pointer body. It names the edition
   * beside the publication, so a reader learns the edition id without another route.
   */
  function editionPointer(): string | null | undefined {
    let published;
    try {
      published = readPublished(dataDir);
    } catch (error) {
      log(`edition pointer unreadable: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
      return null;
    }
    if (!published) return undefined;
    // A rehearsal is a bench's: a service not started as one never shows it, and keeps waiting rather than drafting.
    if (published.rehearsal && process.env.ATLAS_REHEARSAL !== '1') return null;
    try {
      const manifest = readPreviewManifest(dataDir, published.preview);
      if (manifest.revision !== published.revision) return null;
      return JSON.stringify({
        version: 1, id: published.preview, revision: manifest.revision, asOf: manifest.asOf,
        world: { url: `${ROUTE_PREFIX}/v1/preview/${published.preview}/world.json`, sha256: manifest.world.sha256, bytes: manifest.world.bytes },
        edition: { id: published.edition, label: published.label, foundedAt: published.foundedAt, worldHash: published.worldHash, address: published.address },
      });
    } catch {
      return null;
    }
  }

  function previewPointer(revision: string, asOf: number): string | null {
    const id = previewIdFor(revision, asOf);
    try {
      const manifest = readPreviewManifest(dataDir, id);
      if (manifest.revision !== revision) return null;
      return JSON.stringify({
        version: 1, id, revision, asOf,
        world: { url: `${ROUTE_PREFIX}/v1/preview/${id}/world.json`, sha256: manifest.world.sha256, bytes: manifest.world.bytes },
      });
    } catch {
      return null;
    }
  }

  const previewCache = new Map<string, Map<string, PreviewFile>>();
  /** Reads only files a verified world.json names, checking each against its pinned hash. */
  function previewFile(id: string, name: string): PreviewFile | null {
    let files = previewCache.get(id);
    // A pruned preview leaves with its revision: never keep serving names past retention from memory.
    if (files && !existsSync(previewDir(dataDir, id))) {
      previewCache.delete(id);
      return null;
    }
    if (!files) {
      if (!PreviewIdSchema.safeParse(id).success || !existsSync(previewDir(dataDir, id))) return null;
      let manifest;
      let worldBytes: Buffer;
      try {
        manifest = readPreviewManifest(dataDir, id);
        worldBytes = readFileSync(join(previewDir(dataDir, id), 'world.json'));
      } catch {
        return null;
      }
      if (sha256(worldBytes) !== manifest.world.sha256) return null;
      const world = PreviewWorldSchema.parse(JSON.parse(worldBytes.toString('utf8')));
      files = new Map();
      const pinned = new Map<string, string>([['world.json', manifest.world.sha256], ...world.regions.map((r) => [r.chunk.path, r.chunk.sha256] as [string, string])]);
      for (const [file, hash] of pinned) {
        const body = file === 'world.json' ? worldBytes : readFileSync(join(previewDir(dataDir, id), file));
        if (sha256(body) !== hash) return null;
        const entry: PreviewFile = { body, gzip: gzipSync(body, { level: 9 }), br: null, etag: `"${hash.slice(0, 32)}"` };
        brotliLater(entry, BROTLI_IMMUTABLE);
        files.set(file, entry);
      }
      previewCache.set(id, files);
      while (previewCache.size > MAX_CACHED_PREVIEWS) previewCache.delete(previewCache.keys().next().value!);
    }
    return files.get(name) ?? null;
  }

  /** The ids of a preview's head (the settlers world.json itself carries), read once from its verified world.json. */
  const headIds = new Map<string, ReadonlySet<string>>();
  function headOf(id: string): ReadonlySet<string> | null {
    const known = headIds.get(id);
    if (known) return known;
    const file = previewFile(id, 'world.json');
    if (!file) return null;
    const ids = new Set((JSON.parse(file.body.toString('utf8')) as { head: { ids: string[] } }).head.ids);
    headIds.set(id, ids);
    while (headIds.size > MAX_CACHED_PREVIEWS) headIds.delete(headIds.keys().next().value!);
    return ids;
  }

  /**
   * The current names projection for a preview this service still keeps, or why there is none. `head` is the small
   * first part a map waits for before its first frame (the head's names and every withheld id); the whole follows.
   */
  function previewNames(id: string, part: 'all' | 'head' = 'all'): NamesBody | 'missing' | 'refused' {
    if (!PreviewIdSchema.safeParse(id).success || !existsSync(previewDir(dataDir, id))) {
      namesCache.delete(id);
      namesCache.delete(`${id}/head`);
      headIds.delete(id);
      return 'missing';
    }
    const cacheKey = part === 'head' ? `${id}/head` : id;
    const list = withheld.current();
    // Without a readable withheld list, no name may be published: it could revive a withheld channel.
    if (list.error) {
      if (list.error !== lastFailure) log(`refusing names: ${list.error}`);
      lastFailure = list.error;
      return 'refused';
    }
    const at = now();
    const cached = namesCache.get(cacheKey);
    if (cached && cached.withheldKey === list.key && at < cached.staleAt && at - cached.builtAt < NAMES_REBUILD_MS) return cached;
    let names: PreviewNames;
    let only: ReadonlySet<string> | null = null;
    try {
      names = readPreviewNames(dataDir, id);
      if (part === 'head') only = headOf(id);
    } catch {
      return 'missing';
    }
    if (part === 'head' && !only) return 'missing';
    const { served, staleAt } = projectNames(names, list.ids, at, only);
    const body = Buffer.from(JSON.stringify(served));
    const entry: NamesBody = {
      withheldKey: list.key, builtAt: at, staleAt, body, gzip: gzipSync(body, { level: 6 }), br: null, etag: `"${sha256(body).slice(0, 32)}"`,
    };
    brotliLater(entry, part === 'head' ? BROTLI_IMMUTABLE : BROTLI_NAMES);
    namesCache.set(cacheKey, entry);
    while (namesCache.size > MAX_CACHED_PREVIEWS * 2) namesCache.delete(namesCache.keys().next().value!);
    return entry;
  }

  /**
   * The live pointer of one land: its current complete frame (or null before the first), and what the producer last
   * saw of the source, published separately so a partial or stale sweep is visible without touching the frame.
   * Reasons stay in the producer's log; readers learn the state and its times only.
   */
  let livePointers = new Map<string, { key: string; body: string; etag: string }>();
  function livePointer(id: string): { body: string; etag: string } | null {
    if (!PreviewIdSchema.safeParse(id).success || !existsSync(previewDir(dataDir, id))) return null;
    const key = `${fileStamp(join(liveTargetDir(dataDir, id), 'manifest.json'))}|${fileStamp(join(liveRoot(dataDir), 'state.json'))}`;
    const cached = livePointers.get(id);
    if (cached?.key === key) return cached;
    let manifest = null;
    try {
      manifest = readLiveManifest(dataDir, id);
    } catch {
      // A damaged manifest publishes nothing; the reader keeps the frame it has.
      if (cached) return cached;
    }
    let state: ReturnType<typeof readLiveState> = null;
    try {
      state = readLiveState(dataDir);
    } catch {
      // An unreadable state file reads as an unavailable source, never as a complete one.
    }
    const body = JSON.stringify({
      version: 1,
      kind: 'chatdom-atlas-live-pointer',
      preview: id,
      manifest,
      source: state
        ? { state: state.state, checkedAt: state.checkedAt, sweepAt: state.sweepAt, completeAt: state.completeAt, gapBefore: state.gapBefore, rule: state.rule }
        : { state: 'unavailable', checkedAt: null, sweepAt: null, completeAt: null, gapBefore: false, rule: null },
    });
    const entry = { key, body, etag: `"${sha256(body).slice(0, 32)}"` };
    livePointers.set(id, entry);
    if (livePointers.size > 16) livePointers = new Map([...livePointers].slice(-8));
    return entry;
  }

  /** Live frame files, compressed once per frame rather than once per reader. Dab bytes do not compress: kept plain. */
  const frameCache = new Map<string, Encoded>();
  function liveFile(id: string, frame: string, name: string): Encoded | null {
    const key = `${id}/${frame}/${name}`;
    const hit = frameCache.get(key);
    if (hit) return hit;
    if (!Object.values(LIVE_FILES).includes(name as never)) return null;
    const path = join(liveTargetDir(dataDir, id), frame, name);
    if (!existsSync(path)) return null;
    const body = readFileSync(path);
    const entry: Encoded = { body, gzip: name === LIVE_FILES.dabs ? body : gzipSync(body, { level: 6 }), br: null };
    if (name !== LIVE_FILES.dabs) brotliLater(entry, BROTLI_NAMES);
    frameCache.set(key, entry);
    while (frameCache.size > MAX_CACHED_FRAMES) frameCache.delete(frameCache.keys().next().value!);
    return entry;
  }

  /**
   * The register of each preview (search, cards, roads), read once in the background from the preview's own revision
   * and kept for the two most recent previews. Answers are projected per request through the withheld list.
   */
  const directories = new Map<string, { promise: Promise<Directory>; failedAt: number | null; settled?: Directory }>();
  function directory(id: string): Promise<Directory> | null {
    if (!PreviewIdSchema.safeParse(id).success || !existsSync(previewDir(dataDir, id))) {
      directories.delete(id);
      return null;
    }
    const held = directories.get(id);
    if (held && (held.failedAt === null || now() - held.failedAt < DIRECTORY_RETRY_MS)) {
      directories.delete(id);
      directories.set(id, held);
      return held.promise;
    }
    const slot: { promise: Promise<Directory>; failedAt: number | null; settled?: Directory } = { promise: Promise.resolve(null as never), failedAt: null };
    const started = Date.now();
    slot.promise = loadDirectory(dataDir, id).then((built) => {
      slot.settled = built;
      log(`register of ${id}: ${built.size} named channels from ${built.revision} in ${Date.now() - started} ms`);
      return built;
    }, (error: unknown) => {
      slot.failedAt = now();
      const message = error instanceof Error ? error.message : String(error);
      log(`register of ${id} failed: ${message.slice(0, 200)}`);
      throw error;
    });
    slot.promise.catch(() => undefined);
    directories.set(id, slot);
    while (directories.size > MAX_DIRECTORIES) directories.delete(directories.keys().next().value!);
    return slot.promise;
  }

  /** The register of a preview only if it is already read: a caravan never waits for a warming register. */
  function settledDirectory(id: string): Directory | null {
    return directories.get(id)?.settled ?? null;
  }

  /**
   * The channels on air in a preview's current live frame, read through the shared decoders against the register's
   * own alignment and kept until the manifest changes. A missing or unreadable frame means nobody is known live.
   */
  const liveNowCache = new Map<string, { key: string; value: Promise<LiveNow> }>();
  function liveNow(id: string, register: Directory): Promise<LiveNow> {
    const key = `${fileStamp(join(liveTargetDir(dataDir, id), 'manifest.json'))}|${register.revision}`;
    const cached = liveNowCache.get(id);
    if (cached?.key === key) return cached.value;
    const value = (async (): Promise<LiveNow> => {
      const manifest = readLiveManifest(dataDir, id);
      if (!manifest || !register.alignment) return { asOf: null, ids: new Set() };
      const frame = await readFrame(dataDir, id, manifest, register.alignment);
      return { asOf: frame.asOf, ids: register.liveIds(frame) };
    })().catch((error: unknown) => {
      // Not kept: the next request tries the frame again.
      if (liveNowCache.get(id)?.value === value) liveNowCache.delete(id);
      log(`live frame of ${id} unreadable: ${(error instanceof Error ? error.message : String(error)).slice(0, 200)}`);
      return { asOf: null, ids: new Set<string>() };
    });
    liveNowCache.set(id, { key, value });
    while (liveNowCache.size > MAX_DIRECTORIES) liveNowCache.delete(liveNowCache.keys().next().value!);
    return value;
  }

  const roadContext = (): PublicRoadsContext => ({ ledger: roads.ledger, twitch, fallback });
  const busiestCache = new Map<string, { key: string; at: number; body: Promise<unknown> }>();
  function busiest(id: string, register: Directory, ids: ReadonlySet<string>, at: number): Promise<unknown> {
    const key = `${withheld.current().key}|${register.revision}`;
    const cached = busiestCache.get(id);
    if (cached && cached.key === key && at - cached.at < BUSIEST_CACHE_MS) return cached.body;
    const body = busiestRoads(roadContext(), register, ids, at);
    body.catch(() => { if (busiestCache.get(id)?.body === body) busiestCache.delete(id); });
    busiestCache.set(id, { key, at, body });
    while (busiestCache.size > MAX_DIRECTORIES) busiestCache.delete(busiestCache.keys().next().value!);
    return body;
  }

  /**
   * One freshly witnessed raid rides once to the streams open right now. Nothing is buffered: a stream that opens
   * later never sees it. Each land judges both ends through its own register and the current withheld list; a land
   * whose register is still warming drops the caravan (the road is in the ledger all the same).
   */
  function caravan(raid: AtlasRaid): void {
    for (const [id, clients] of streams) {
      const register = settledDirectory(id);
      if (!register) continue;
      const list = withheld.current();
      if (list.error) continue;
      const audience = [...clients.keys()];
      void caravanEvent(roadContext(), register, raid, list.ids, now()).then((event) => {
        const latest = withheld.current();
        if (!event || latest.error || latest.key !== list.key) return;
        const frame = `event: raid\ndata: ${JSON.stringify(event)}\n\n`;
        for (const res of audience) if (clients.has(res) && !res.writableEnded && !res.destroyed) res.write(frame);
      }).catch(() => undefined);
    }
  }

  /** A herald raid newly stored by the ingest or the raid-show pull rides only while it is fresh. */
  function heraldCaravan(raid: AtlasRaid): void {
    const age = now() - (raid.occurredAt ?? raid.observedAt);
    if (age <= CARAVAN_FRESH_MS && age >= -5_000) caravan(raid);
  }

  /**
   * Answers a register request. Without a readable withheld list nothing is answered (it could name a withheld
   * channel). A register still being read after a few seconds says so with a retry time, never a partial answer.
   */
  function answerDirectory(res: ServerResponse, id: string, head: boolean, ask: (register: Directory, withheld: ReadonlySet<string>, at: number) => unknown | DirectoryRefusal): void {
    const pending = directory(id);
    if (!pending) return send(res, 404, JSON.stringify({ error: 'not-found' }), {}, head);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<'warming'>((resolve) => {
      timer = setTimeout(() => resolve('warming'), DIRECTORY_WAIT_MS);
    });
    void Promise.race([pending, waited]).then(async (register) => {
      clearTimeout(timer);
      if (res.writableEnded) return;
      if (register === 'warming') return send(res, 503, JSON.stringify({ error: 'warming' }), { 'retry-after': '5' }, head);
      const list = withheld.current();
      if (list.error) return send(res, 503, JSON.stringify({ error: 'names-unavailable' }), { 'retry-after': '60' }, head);
      const answer = await ask(register, list.ids, now());
      if (res.writableEnded || res.destroyed) return;
      // Network lookups can outlive a moderation change. Re-project before any name leaves the service.
      const latest = withheld.current();
      if (latest.error || latest.key !== list.key) return send(res, 503, JSON.stringify({ error: 'names-unavailable' }), { 'retry-after': '1' }, head);
      if (answer && typeof answer === 'object') {
        const reply = answer as { channel?: { id: string }; results?: { channel: { id: string } }[] };
        if (reply.channel && !register.allowed(reply.channel.id, latest.ids)) return send(res, 404, JSON.stringify({ error: 'not-found' }), {}, head);
        if (reply.results) reply.results = reply.results.filter(result => register.allowed(result.channel.id, latest.ids));
      }
      if (answer === 'not-found') return send(res, 404, JSON.stringify({ error: 'not-found' }), {}, head);
      if (answer === 'empty' || answer === 'too-long') return send(res, 400, JSON.stringify({ error: `query-${answer}` }), {}, head);
      return send(res, 200, JSON.stringify(answer), { vary: 'accept-encoding' }, head);
    }).catch((error: unknown) => {
      clearTimeout(timer);
      if (!res.writableEnded && !res.destroyed) send(res, error instanceof LookupUnavailable && error.reason === 'limited' ? 429 : 503,
        JSON.stringify({ error: error instanceof LookupUnavailable ? `lookup-${error.reason}` : 'register-unavailable' }),
        { 'retry-after': String(error instanceof LookupUnavailable ? error.retryAfter ?? 30 : 30) }, head);
    });
  }

  /** Open event streams by land, each with the pointer it was last sent. One timer serves them all, only while any are open. */
  const streams = new Map<string, Map<ServerResponse, string>>();
  let streamCount = 0;
  let lastBeat = now();
  /** The withheld key the open streams last heard of. A change tells every open map to read its names again now. */
  let namesKey = withheld.current().key;
  function namesChanged(): void {
    const key = withheld.current().key;
    if (key === namesKey) return;
    namesKey = key;
    // No payload: an open map learns only that names changed, never whose; it reads the names projection again.
    for (const clients of streams.values()) for (const res of clients.keys()) if (!res.writableEnded && !res.destroyed) res.write('event: names\ndata: {}\n\n');
  }
  const watcher = setInterval(() => {
    if (streamCount === 0) return;
    namesChanged();
    const beat = now() - lastBeat >= LIVE_HEARTBEAT_MS;
    if (beat) lastBeat = now();
    for (const [id, clients] of streams) {
      const pointer = livePointer(id);
      if (!pointer) {
        for (const res of clients.keys()) res.end();
        continue;
      }
      // Each stream is judged on its own: one reader connecting must never mark a change as sent to another.
      for (const [res, sent] of clients) {
        if (sent !== pointer.etag) {
          clients.set(res, pointer.etag);
          res.write(`event: live\ndata: ${pointer.body}\n\n`);
        } else if (beat) {
          res.write(': still here\n\n');
        }
      }
    }
  }, options.liveWatchMs ?? LIVE_WATCH_MS);
  watcher.unref();

  function openStream(req: IncomingMessage, res: ServerResponse, id: string): void {
    const pointer = livePointer(id);
    if (!pointer) return send(res, 404, JSON.stringify({ error: 'not-found' }));
    if (streamCount >= MAX_LIVE_STREAMS) return send(res, 503, JSON.stringify({ error: 'busy' }), { 'retry-after': '60' });
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-content-type-options': 'nosniff',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    });
    // A dropped stream reconnects after 15 s; meanwhile the reader's own 60 s reconcile carries on.
    res.write(`retry: 15000\nevent: live\ndata: ${pointer.body}\n\n`);
    let clients = streams.get(id);
    if (!clients) {
      clients = new Map();
      streams.set(id, clients);
    }
    clients.set(res, pointer.etag);
    streamCount++;
    req.socket.setTimeout(0);
    res.on('close', () => {
      if (clients.delete(res)) streamCount--;
      if (clients.size === 0) streams.delete(id);
    });
  }

  function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}, head = false): void {
    // Larger JSON replies (busiest roads, finder, search, cards) travel gzipped to a reader that takes it.
    const zip = !head && body.length >= gzipMin && /\bgzip\b/.test(String(res.req?.headers['accept-encoding'] ?? ''));
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-cache',
      ...headers,
      ...(body.length >= gzipMin ? { vary: headers.vary ?? 'accept-encoding' } : {}),
      ...(zip ? { 'content-encoding': 'gzip' } : {}),
    });
    res.end(head ? undefined : zip ? gzipSync(body, { level: 6 }) : body);
  }

  function handle(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';
    if (url.length > MAX_URL_LENGTH) return send(res, 414, JSON.stringify({ error: 'uri-too-long' }));
    const query = url.indexOf('?');
    if (query >= 0 && url.length - query - 1 > MAX_QUERY_LENGTH) return send(res, 414, JSON.stringify({ error: 'query-too-long' }));
    const path = query >= 0 ? url.slice(0, query) : url;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, JSON.stringify({ error: 'method-not-allowed' }), { allow: 'GET, HEAD' });
    }
    const head = req.method === 'HEAD';
    const state = current();
    if (path === `${ROUTE_PREFIX}/v1/health`) {
      return state
        ? send(res, 200, JSON.stringify({ ok: true, revision: state.survey.revision, asOf: state.survey.asOf }), {}, head)
        : send(res, 503, JSON.stringify({ ok: false, reason: 'no-revision' }), {}, head);
    }
    if (path === `${ROUTE_PREFIX}/v1/survey`) {
      if (!state) return send(res, 503, JSON.stringify({ error: 'no-revision' }), { 'retry-after': '60' }, head);
      if (req.headers['if-none-match'] === state.etag) {
        res.writeHead(304, { etag: state.etag, 'cache-control': 'no-cache' });
        return void res.end();
      }
      return send(res, 200, state.body, { etag: state.etag }, head);
    }
    if (path === `${ROUTE_PREFIX}/v1/preview`) {
      if (!state?.preview) return send(res, 503, JSON.stringify({ error: 'no-preview' }), { 'retry-after': '60' }, head);
      // A reader is about to open this preview: start reading its register so the first search does not wait.
      void directory((JSON.parse(state.preview) as { id: string }).id)?.catch(() => undefined);
      return send(res, 200, state.preview, { etag: `"${state.survey.revision}"` }, head);
    }
    const namesMatch = PREVIEW_NAMES.exec(path);
    if (namesMatch) {
      // `?part=head` is the first frame's part. A service without it answers the whole, which a map reads just as well.
      const part = query >= 0 ? new URLSearchParams(url.slice(query + 1)).get('part') : null;
      if (part !== null && part !== 'head') return send(res, 400, JSON.stringify({ error: 'unknown-part' }), {}, head);
      const names = previewNames(namesMatch[1]!, part === 'head' ? 'head' : 'all');
      if (names === 'missing') return send(res, 404, JSON.stringify({ error: 'not-found' }), {}, head);
      if (names === 'refused') return send(res, 503, JSON.stringify({ error: 'names-unavailable' }), { 'retry-after': '60' }, head);
      // Revalidated on every use, so withholding and staleness reach every reader at once.
      const headers = { etag: names.etag, 'cache-control': 'no-cache', vary: 'accept-encoding' };
      if (req.headers['if-none-match'] === names.etag) {
        res.writeHead(304, headers);
        return void res.end();
      }
      const { payload, encoding } = encodingFor(req, names);
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', ...headers,
        ...(encoding ? { 'content-encoding': encoding } : {}),
        'content-length': String(payload.byteLength),
      });
      return void res.end(head ? undefined : payload);
    }
    const searchMatch = DIRECTORY_SEARCH.exec(path);
    if (searchMatch) {
      const params = new URLSearchParams(query >= 0 ? url.slice(query + 1) : '');
      const q = params.get('q') ?? '';
      return answerDirectory(res, searchMatch[1]!, head, (register, ids, at) => params.get('lookup') === '1' && fallback
        ? fallback.search(register, q, ids, clientIp(req), params.get('portraits') === '1')
        : register.search(q, ids, at, params.get('portraits') === '1'));
    }
    const cardMatch = DIRECTORY_CARD.exec(path);
    if (cardMatch) {
      const lookup: Lookup = cardMatch[2] ? { id: cardMatch[2] } : cardMatch[3] ? { login: cardMatch[3] } : { dab: cardMatch[4]! };
      // Opt-in keeps older clients' strict v1 decoders usable during a rolling web/service adoption.
      const params = new URLSearchParams(query >= 0 ? url.slice(query + 1) : '');
      const portraits = params.get('portraits') === '1';
      return answerDirectory(res, cardMatch[1]!, head, (register, ids, at) => params.get('lookup') === '1' && fallback
        ? fallback.card(register, lookup, ids, clientIp(req), portraits)
        : register.card(lookup, ids, at, portraits));
    }
    const roadMatch = DIRECTORY_ROAD.exec(path);
    if (roadMatch) {
      const [a, b]: [Lookup, Lookup] = roadMatch[2] ? [{ id: roadMatch[2] }, { id: roadMatch[3]! }] : [{ login: roadMatch[4]! }, { login: roadMatch[5]! }];
      return answerDirectory(res, roadMatch[1]!, head, (register, ids, at) => register.road(a, b, ids, at));
    }
    const roadsChannel = ROADS_CHANNEL.exec(path);
    if (roadsChannel) {
      return answerDirectory(res, roadsChannel[1]!, head, (register, ids, at) => channelRoads(roadContext(), register, roadsChannel[2]!, ids, at));
    }
    const roadsStory = ROADS_STORY.exec(path);
    if (roadsStory) {
      const [a, b]: [Lookup, Lookup] = roadsStory[2] ? [{ id: roadsStory[2] }, { id: roadsStory[3]! }] : [{ login: roadsStory[4]! }, { login: roadsStory[5]! }];
      return answerDirectory(res, roadsStory[1]!, head, (register, ids, at) => roadStory(roadContext(), register, a, b, ids, at));
    }
    const roadsBusiest = ROADS_BUSIEST.exec(path);
    if (roadsBusiest) {
      return answerDirectory(res, roadsBusiest[1]!, head, (register, ids, at) => busiest(roadsBusiest[1]!, register, ids, at));
    }
    const finderMatch = GATE_FINDER.exec(path);
    if (finderMatch) {
      const params = new URLSearchParams(query >= 0 ? url.slice(query + 1) : '');
      const from = params.get('from') ?? '';
      if (!FINDER_FROM.test(from)) return send(res, 400, JSON.stringify({ error: 'query-from' }), {}, head);
      const q = params.get('q');
      const request = { from, query: q !== null && q.trim() !== '' ? q : null, portraits: params.get('portraits') === '1', ip: clientIp(req) };
      return answerDirectory(res, finderMatch[1]!, head, async (register, ids, at) => finder(roadContext(), register, await liveNow(finderMatch[1]!, register), request, ids, at));
    }
    const livePointerMatch = LIVE_POINTER.exec(path);
    if (livePointerMatch) {
      const pointer = livePointer(livePointerMatch[1]!);
      if (!pointer) return send(res, 404, JSON.stringify({ error: 'not-found' }), {}, head);
      if (req.headers['if-none-match'] === pointer.etag) {
        res.writeHead(304, { etag: pointer.etag, 'cache-control': 'no-cache' });
        return void res.end();
      }
      return send(res, 200, pointer.body, { etag: pointer.etag }, head);
    }
    const liveEvents = LIVE_EVENTS.exec(path);
    if (liveEvents) {
      if (head) return send(res, 200, '', { 'content-type': 'text/event-stream' }, true);
      return openStream(req, res, liveEvents[1]!);
    }
    const liveMatch = LIVE_FILE.exec(path);
    if (liveMatch) {
      const body = liveFile(liveMatch[1]!, liveMatch[2]!, liveMatch[3]!);
      if (!body) return send(res, 404, JSON.stringify({ error: 'not-found' }), {}, head);
      // Content addressed by frame: the reader checks every byte against the manifest's hash anyway.
      const etag = `"${liveMatch[2]!}:${liveMatch[3]!}"`;
      const immutable = { etag, 'cache-control': 'public, max-age=31536000, immutable', vary: 'accept-encoding' };
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, immutable);
        return void res.end();
      }
      const { payload, encoding } = liveMatch[3] === 'dabs.bin' ? { payload: body.body, encoding: null } : encodingFor(req, body);
      res.writeHead(200, {
        'content-type': liveMatch[3] === 'starts.json' ? 'application/json; charset=utf-8' : 'application/octet-stream',
        'x-content-type-options': 'nosniff', ...immutable,
        ...(encoding ? { 'content-encoding': encoding } : {}),
        'content-length': String(payload.byteLength),
      });
      return void res.end(head ? undefined : payload);
    }
    const match = PREVIEW_FILE.exec(path);
    if (match) {
      const file = previewFile(match[1]!, match[2]!);
      if (!file) return send(res, 404, JSON.stringify({ error: 'not-found' }), {}, head);
      const immutable = { etag: file.etag, 'cache-control': 'public, max-age=31536000, immutable', vary: 'accept-encoding' };
      if (req.headers['if-none-match'] === file.etag) {
        res.writeHead(304, immutable);
        return void res.end();
      }
      const { payload, encoding } = encodingFor(req, file);
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', ...immutable,
        ...(encoding ? { 'content-encoding': encoding } : {}),
        'content-length': String(payload.byteLength),
      });
      return void res.end(head ? undefined : payload);
    }
    return send(res, 404, JSON.stringify({ error: 'not-found' }), {}, head);
  }

  const server = createServer((req, res) => {
    try {
      handle(req, res);
    } catch {
      if (!res.headersSent) send(res, 500, JSON.stringify({ error: 'internal' }));
      else res.end();
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;

  const ingestToken = options.ingestToken === undefined ? process.env.ATLAS_INGEST_TOKEN || null : options.ingestToken;
  const tokenDigest = ingestToken ? createHash('sha256').update(ingestToken).digest() : null;
  /** Compared as fixed-length digests, so neither the token's length nor its prefix leaks through timing. */
  function authorized(req: IncomingMessage): boolean {
    if (!tokenDigest) return true;
    const header = req.headers.authorization;
    const presented = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    const same = timingSafeEqual(createHash('sha256').update(presented).digest(), tokenDigest);
    return same && presented.length > 0;
  }
  function ingestReply(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    if (res.headersSent) return void res.end();
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
    res.end(JSON.stringify(body));
  }
  const invalid = (res: ServerResponse, reason: IngestReason) => ingestReply(res, 422, { kind: 'invalid', reason });
  /**
   * One witnessed herald raid in, one durable receipt out. The ledger's observe is synchronous and fsyncs before it
   * returns, and Node runs one handler at a time, so concurrent identical posts store once and answer duplicate.
   */
  function accept(res: ServerResponse, raw: Buffer): void {
    let input: unknown;
    try {
      input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } catch {
      return invalid(res, 'json');
    }
    const parsed = AtlasRaidSchema.safeParse(input);
    if (!parsed.success) {
      const claimed = input as { source?: unknown; evidence?: { kind?: unknown } } | null;
      const simulated = typeof claimed === 'object' && claimed !== null && (claimed.source === 'simulation' || claimed.evidence?.kind === 'simulated');
      return invalid(res, simulated ? 'simulation' : 'schema');
    }
    const raid = parsed.data;
    if (raid.source === 'simulation' || raid.evidence.kind !== 'observed') return invalid(res, 'simulation');
    if (raid.source !== 'herald') return invalid(res, 'source');
    let receipt;
    try {
      receipt = roads.ledger.observe(raid);
    } catch (error) {
      if (error instanceof Error && /^Conflicting road raid ID /.test(error.message)) return invalid(res, 'conflict');
      return ingestReply(res, 503, { kind: 'unavailable' }, { 'retry-after': '30' });
    }
    ingestReply(res, 200, { kind: receipt.kind, raidId: receipt.raidId, road: receipt.road, raids: receipt.raids });
    if (receipt.kind === 'stored') heraldCaravan(raid);
  }
  let claimed: Set<string> | null = null;
  /**
   * One claim in, one durable receipt out. The service attaches the facts that decide the claim's realm: the survey's
   * when it knows the channel (settlement then reads that night's own observation), else its public Twitch lookup.
   * Without either it answers `facts-unavailable` so the producer retries; it never guesses a realm. The duplicate
   * check runs again right before the synchronous append, so concurrent identical posts record once.
   */
  async function acceptClaim(res: ServerResponse, raw: Buffer): Promise<void> {
    let input: unknown;
    try {
      input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } catch {
      return invalid(res, 'json');
    }
    const parsed = ClaimRequestSchema.safeParse(input);
    if (!parsed.success || parsed.data.claimedAt > now() + 60_000) return invalid(res, 'schema');
    const request = parsed.data;
    claimed ??= claimKeys(readClaims(dataDir));
    const key = `${request.kingdomId}:${request.cause}`;
    const receipt = (kind: 'recorded' | 'duplicate') => ingestReply(res, kind === 'recorded' ? 202 : 200, { kind, kingdomId: request.kingdomId, cause: request.cause, settles: 'next-survey' });
    if (claimed.has(key)) return receipt('duplicate');
    const pointer = current()?.preview;
    const register = pointer ? await directory((JSON.parse(pointer) as { id: string }).id)?.catch(() => null) ?? null : null;
    let facts: Pick<Claim, 'language' | 'categories' | 'facts' | 'login' | 'name'> | null = null;
    const surveyed = register?.knows(request.kingdomId) ? register.facts(request.kingdomId) : null;
    if (surveyed?.language) facts = { language: surveyed.language, categories: [], facts: 'survey' };
    else if (twitch) {
      try {
        const found = (await twitch.lookup(`id:${request.kingdomId}`)).find((channel) => channel.id === request.kingdomId);
        if (!found) return invalid(res, 'unknown-channel');
        facts = { language: found.language || 'other', categories: found.gameId ? [{ gameId: found.gameId, minutes: 1 }] : [], facts: 'twitch' };
        // Names the holding on the map if the survey never observes the channel; checked as the log will read it.
        const named = ClaimSchema.shape.login.safeParse(found.login).success && ClaimSchema.shape.name.safeParse(found.name).success;
        if (named) facts = { ...facts, login: found.login, name: found.name };
      } catch {
        facts = null;
      }
    }
    if (!facts) return ingestReply(res, 503, { kind: 'facts-unavailable' }, { 'retry-after': '300' });
    if (claimed.has(key)) return receipt('duplicate');
    const claim: Claim = { version: 1, kind: 'chatdom-atlas-claim', kingdomId: request.kingdomId, cause: request.cause, claimedAt: request.claimedAt, receivedAt: now(), ...facts };
    const outcome = appendClaim(dataDir, claim, claimed);
    claimed.add(key);
    receipt(outcome);
  }

  /** Whether the public map shows this channel right now: the same gate every public read uses. */
  function onMap(id: string, ids: ReadonlySet<string>): boolean {
    const pointer = current()?.preview;
    const register = pointer ? settledDirectory((JSON.parse(pointer) as { id: string }).id) : null;
    return register ? register.allowed(id, ids) : !ids.has(id);
  }

  /**
   * The broadcaster pressed "Hide my channel" or "Show my channel". The act is durable before the reply, and the
   * very next public read (names, search, cards, roads, finder) already judges the channel by it; open maps hear of
   * it on their live stream within seconds, and live paint drops its wash at its next run. Showing lifts only the
   * owner's own hide: the operator's withheld list always wins, and `onMap` says so without saying why.
   */
  function ownerAct(res: ServerResponse, kingdomId: string, act: OwnerAct, raw: Buffer): void {
    let input: unknown;
    try {
      input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } catch {
      return invalid(res, 'json');
    }
    const parsed = OwnerVisibilityRequestSchema.safeParse(input);
    if (!parsed.success || parsed.data.at > now() + 60_000) return invalid(res, 'schema');
    const list = withheld.current();
    if (list.error) return ingestReply(res, 503, { kind: 'unavailable' }, { 'retry-after': '30' });
    let outcome: 'recorded' | 'unchanged';
    try {
      outcome = appendOwnerAct(dataDir, { version: 1, kind: 'chatdom-atlas-owner-visibility', kingdomId: kingdomId as KingdomId, act, at: parsed.data.at, receivedAt: now() }, list.owner);
    } catch {
      return ingestReply(res, 503, { kind: 'unavailable' }, { 'retry-after': '30' });
    }
    const after = withheld.current();
    if (outcome === 'recorded') namesChanged();
    ingestReply(res, 200, { kind: act === 'hide' ? 'hidden' : 'shown', kingdomId, changed: outcome === 'recorded', hidden: after.owner.has(kingdomId), onMap: onMap(kingdomId, after.ids) });
  }

  /**
   * The broadcaster's own view of their channel, for their own card: whether they hid it, whether the map shows it,
   * and the card as the map would draw it without their own hide (never past the operator's list). Private: it goes
   * only to the session authority, which hands it only to that broadcaster with no-store.
   */
  async function ownerState(res: ServerResponse, kingdomId: string, wanted: string | null): Promise<void> {
    const list = withheld.current();
    if (list.error) return ingestReply(res, 503, { kind: 'unavailable' }, { 'retry-after': '30' });
    const pointer = current()?.preview;
    const id = wanted && PreviewIdSchema.safeParse(wanted).success && existsSync(previewDir(dataDir, wanted)) ? wanted : pointer ? (JSON.parse(pointer) as { id: string }).id : null;
    const register = id ? await directory(id)?.catch(() => null) ?? null : null;
    let card: unknown = null;
    if (register && list.owner.has(kingdomId) && !list.operator.has(kingdomId)) {
      const answer = fallback
        ? await fallback.card(register, { id: kingdomId }, list.operator, 'session-authority', true).catch(() => null)
        : register.card({ id: kingdomId }, list.operator, now(), true, true);
      if (answer && typeof answer === 'object') card = answer;
    }
    const latest = withheld.current();
    ingestReply(res, 200, {
      version: 1, kind: 'owner-visibility', kingdomId, preview: id, hidden: latest.owner.has(kingdomId),
      onMap: register ? register.allowed(kingdomId, latest.ids) : !latest.ids.has(kingdomId),
      card: latest.owner.has(kingdomId) && !latest.operator.has(kingdomId) ? card : null,
    });
  }

  const ingest = createServer((req, res) => {
    try {
      const [path = '/', search = ''] = (req.url ?? '/').split('?');
      const owner = OWNER_VISIBILITY.exec(path);
      if (path !== INGEST_PATH && path !== CLAIMS_PATH && !owner) return ingestReply(res, 404, { kind: 'not-found' });
      const method = owner?.[2] === 'visibility' ? 'GET' : 'POST';
      if (req.method !== method) return ingestReply(res, 405, { kind: 'method-not-allowed' }, { allow: method });
      if (!authorized(req)) return ingestReply(res, 401, { kind: 'unauthorized' });
      // A channel's visibility is the broadcaster's own: only a caller holding the token (the session authority) may
      // touch it, so a service without a token never offers these routes.
      if (owner && !tokenDigest) return ingestReply(res, 503, { kind: 'not-configured' });
      if (owner?.[2] === 'visibility') return void ownerState(res, owner[1]!, new URLSearchParams(search).get('preview')).catch(() => ingestReply(res, 503, { kind: 'unavailable' }, { 'retry-after': '30' }));
      if (!/^application\/json\s*(?:;.*)?$/i.test(String(req.headers['content-type'] ?? ''))) return invalid(res, 'content-type');
      const declared = Number(req.headers['content-length']);
      const tooLarge = () => {
        ingestReply(res, 413, { kind: 'too-large' }, { connection: 'close' });
        req.resume();
      };
      if (Number.isFinite(declared) && declared > INGEST_MAX_BYTES) return tooLarge();
      const parts: Buffer[] = [];
      let size = 0;
      let refused = false;
      req.on('data', (chunk: Buffer) => {
        if (refused) return;
        size += chunk.byteLength;
        if (size > INGEST_MAX_BYTES) {
          refused = true;
          parts.length = 0;
          return tooLarge();
        }
        parts.push(chunk);
      });
      req.on('end', () => {
        if (refused || res.writableEnded) return;
        try {
          if (path === CLAIMS_PATH) void acceptClaim(res, Buffer.concat(parts)).catch(() => ingestReply(res, 503, { kind: 'unavailable' }, { 'retry-after': '30' }));
          else if (owner) ownerAct(res, owner[1]!, owner[2] === 'hide' ? 'hide' : 'show', Buffer.concat(parts));
          else accept(res, Buffer.concat(parts));
        } catch {
          ingestReply(res, 503, { kind: 'unavailable' }, { 'retry-after': '30' });
        }
      });
      req.on('error', () => res.destroy());
    } catch {
      ingestReply(res, 503, { kind: 'unavailable' }, { 'retry-after': '30' });
    }
  });
  ingest.requestTimeout = 5_000;
  ingest.headersTimeout = 3_000;

  current();
  /** The register of the preview being served, read ahead of the first search (checked again every half minute). */
  function warmRegister(): void {
    const pointer = current()?.preview;
    if (!pointer) return;
    const id = (JSON.parse(pointer) as { id?: unknown }).id;
    if (typeof id === 'string') directory(id)?.catch(() => undefined);
  }
  const warmer = options.warmRegister ? setInterval(warmRegister, REGISTER_WARM_MS) : null;
  warmer?.unref();
  if (options.warmRegister) warmRegister();
  let roads: ReturnType<typeof createRoadRuntime>;
  try {
    roads = createRoadRuntime(dataDir, {
      ...options.roads,
      onLiveRaid: (raid) => {
        options.roads?.onLiveRaid?.(raid);
        caravan(raid);
      },
      onHeraldRaid: (raid) => {
        options.roads?.onHeraldRaid?.(raid);
        heraldCaravan(raid);
      },
    }, log);
  } catch (error) {
    clearInterval(watcher);
    if (warmer) clearInterval(warmer);
    twitch?.close();
    throw error;
  }
  let closed: Promise<void> | undefined;
  return {
    server,
    ingest,
    revision: () => current()?.survey.revision ?? null,
    close: () => closed ??= (async () => {
      clearInterval(watcher);
      if (warmer) clearInterval(warmer);
      twitch?.close();
      for (const clients of streams.values()) for (const res of clients.keys()) res.end();
      const stopped = new Promise<void>((done) => server.close(() => done()));
      const ingestStopped = new Promise<void>((done) => ingest.close(() => done()));
      server.closeAllConnections();
      ingest.closeAllConnections();
      // The ingest stops taking posts before the ledger is released.
      await ingestStopped;
      await Promise.all([stopped, roads.close()]);
    })(),
  };
}
