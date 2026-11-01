import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { sha256 } from './export/project';
import { publicSurvey, type PublicSurvey } from './export/public';
import { previewIdFor } from './preview/build';
import { nameFreshUntil, withheldReader } from './policy/visibility';
import { PREVIEW_KIND, PreviewIdSchema, PreviewWorldSchema, ServedNamesSchema, type PreviewNames } from './preview/schema';
import { previewDir, readPreviewManifest, readPreviewNames } from './preview/store';
import { layout, readCurrent, readManifest } from './store/revisions';
import { LIVE_FILES, liveRoot, liveTargetDir, readLiveManifest, readLiveState } from './live/store';
import { loadDirectory, type Directory, type DirectoryRefusal, type Lookup } from './directory/directory';

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

/** An immutable preview file, verified against its pinned hash once and kept compressed in memory. */
interface PreviewFile {
  body: Buffer;
  gzip: Buffer;
  etag: string;
}

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
/** Registers held in memory at once: the current preview and one a tab may still be pinned to. */
const MAX_DIRECTORIES = 2;
/** A request waits this long for a register still being read before it is told to come back. */
const DIRECTORY_WAIT_MS = 6_000;
/** A register that failed to build is not tried again for this long (no retry storm on a broken file). */
const DIRECTORY_RETRY_MS = 30_000;
/** A served names projection is rebuilt at least this often, and whenever a name in it goes stale or the withheld list changes. */
const NAMES_REBUILD_MS = 60_000;

/** The names projection of one preview at one moment. Never cached by intermediaries without revalidation. */
interface NamesBody {
  withheldKey: string;
  builtAt: number;
  /** The earliest moment a name in this body goes stale. */
  staleAt: number;
  body: Buffer;
  gzip: Buffer;
  etag: string;
}

export interface AtlasServiceOptions {
  /** Injected clock for name freshness. */
  now?: () => number;
  /** How often the live watcher looks for a new frame (tests shorten it). */
  liveWatchMs?: number;
}

/**
 * Projects a preview's raw names for publication: withheld channels are listed (so the browser draws their land bare)
 * and lose their names. The result is the only way a login or display name leaves this service.
 */
export function projectNames(names: PreviewNames, withheld: ReadonlySet<string>, now: number): { served: unknown; staleAt: number } {
  const served = {
    version: 1 as const, kind: `${PREVIEW_KIND}-served-names` as const, preview: names.preview, servedAt: now,
    withheld: [] as string[], ids: [] as string[], logins: [] as string[], names: [] as string[], freshUntil: [] as number[],
  };
  let staleAt = Number.POSITIVE_INFINITY;
  names.ids.forEach((id, i) => {
    if (withheld.has(id)) {
      served.withheld.push(id);
      return;
    }
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
  /** The currently served revision, or null while none has been imported. */
  revision(): string | null;
  close(): Promise<void>;
}

export function createAtlasService(dataDir: string, log: (line: string) => void = () => {}, options: AtlasServiceOptions = {}): AtlasService {
  const paths = layout(dataDir);
  const now = options.now ?? Date.now;
  const withheld = withheldReader(dataDir);
  const namesCache = new Map<string, NamesBody>();
  let loaded: Loaded | null = null;
  let lastFailure = '';

  /** Reloads only when current.json changes; a bad swap keeps serving the last good revision. */
  function current(): Loaded | null {
    let key: string;
    try {
      const stat = statSync(paths.current);
      key = `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
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
      loaded = { key, survey, body: JSON.stringify(survey), etag: `"${manifest.revision}"`, preview: previewPointer(manifest.revision, manifest.asOf) };
      log(`serving ${manifest.revision}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== lastFailure) log(`kept ${loaded?.survey.revision ?? 'no revision'}: ${message}`);
      lastFailure = message;
    }
    return loaded;
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
        files.set(file, { body, gzip: gzipSync(body, { level: 9 }), etag: `"${hash.slice(0, 32)}"` });
      }
      previewCache.set(id, files);
      while (previewCache.size > MAX_CACHED_PREVIEWS) previewCache.delete(previewCache.keys().next().value!);
    }
    return files.get(name) ?? null;
  }

  /** The current names projection for a preview this service still keeps, or why there is none. */
  function previewNames(id: string): NamesBody | 'missing' | 'refused' {
    if (!PreviewIdSchema.safeParse(id).success || !existsSync(previewDir(dataDir, id))) {
      namesCache.delete(id);
      return 'missing';
    }
    const list = withheld.current();
    // Without a readable withheld list, no name may be published: it could revive a withheld channel.
    if (list.error) {
      if (list.error !== lastFailure) log(`refusing names: ${list.error}`);
      lastFailure = list.error;
      return 'refused';
    }
    const at = now();
    const cached = namesCache.get(id);
    if (cached && cached.withheldKey === list.key && at < cached.staleAt && at - cached.builtAt < NAMES_REBUILD_MS) return cached;
    let names: PreviewNames;
    try {
      names = readPreviewNames(dataDir, id);
    } catch {
      return 'missing';
    }
    const { served, staleAt } = projectNames(names, list.ids, at);
    const body = Buffer.from(JSON.stringify(served));
    const entry: NamesBody = {
      withheldKey: list.key, builtAt: at, staleAt, body, gzip: gzipSync(body, { level: 6 }), etag: `"${sha256(body).slice(0, 32)}"`,
    };
    namesCache.set(id, entry);
    while (namesCache.size > MAX_CACHED_PREVIEWS) namesCache.delete(namesCache.keys().next().value!);
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
    const stamp = (path: string) => {
      try {
        const stat = statSync(path);
        return `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
      } catch {
        return '-';
      }
    };
    const key = `${stamp(join(liveTargetDir(dataDir, id), 'manifest.json'))}|${stamp(join(liveRoot(dataDir), 'state.json'))}`;
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

  const frameCache = new Map<string, Buffer>();
  function liveFile(id: string, frame: string, name: string): Buffer | null {
    const key = `${id}/${frame}/${name}`;
    const hit = frameCache.get(key);
    if (hit) return hit;
    if (!Object.values(LIVE_FILES).includes(name as never)) return null;
    const path = join(liveTargetDir(dataDir, id), frame, name);
    if (!existsSync(path)) return null;
    const body = readFileSync(path);
    frameCache.set(key, body);
    while (frameCache.size > MAX_CACHED_FRAMES) frameCache.delete(frameCache.keys().next().value!);
    return body;
  }

  /**
   * The register of each preview (search, cards, roads), read once in the background from the preview's own revision
   * and kept for the two most recent previews. Answers are projected per request through the withheld list.
   */
  const directories = new Map<string, { promise: Promise<Directory>; failedAt: number | null }>();
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
    const slot: { promise: Promise<Directory>; failedAt: number | null } = { promise: Promise.resolve(null as never), failedAt: null };
    const started = Date.now();
    slot.promise = loadDirectory(dataDir, id).then((built) => {
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
    void Promise.race([pending, waited]).then((register) => {
      clearTimeout(timer);
      if (res.writableEnded) return;
      if (register === 'warming') return send(res, 503, JSON.stringify({ error: 'warming' }), { 'retry-after': '5' }, head);
      const list = withheld.current();
      if (list.error) return send(res, 503, JSON.stringify({ error: 'names-unavailable' }), { 'retry-after': '60' }, head);
      const answer = ask(register, list.ids, now());
      if (answer === 'not-found') return send(res, 404, JSON.stringify({ error: 'not-found' }), {}, head);
      if (answer === 'empty' || answer === 'too-long') return send(res, 400, JSON.stringify({ error: `query-${answer}` }), {}, head);
      return send(res, 200, JSON.stringify(answer), { vary: 'accept-encoding' }, head);
    }, () => {
      clearTimeout(timer);
      if (!res.writableEnded) send(res, 503, JSON.stringify({ error: 'register-unavailable' }), { 'retry-after': '30' }, head);
    });
  }

  /** Open event streams by land, each with the pointer it was last sent. One timer serves them all, only while any are open. */
  const streams = new Map<string, Map<ServerResponse, string>>();
  let streamCount = 0;
  let lastBeat = now();
  const watcher = setInterval(() => {
    if (streamCount === 0) return;
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
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-cache',
      ...headers,
    });
    res.end(head ? undefined : body);
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
      void directory(previewIdFor(state.survey.revision, state.survey.asOf))?.catch(() => undefined);
      return send(res, 200, state.preview, { etag: `"${state.survey.revision}"` }, head);
    }
    const namesMatch = PREVIEW_NAMES.exec(path);
    if (namesMatch) {
      const names = previewNames(namesMatch[1]!);
      if (names === 'missing') return send(res, 404, JSON.stringify({ error: 'not-found' }), {}, head);
      if (names === 'refused') return send(res, 503, JSON.stringify({ error: 'names-unavailable' }), { 'retry-after': '60' }, head);
      // Revalidated on every use, so withholding and staleness reach every reader at once.
      const headers = { etag: names.etag, 'cache-control': 'no-cache', vary: 'accept-encoding' };
      if (req.headers['if-none-match'] === names.etag) {
        res.writeHead(304, headers);
        return void res.end();
      }
      const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', ...headers,
        ...(gzip ? { 'content-encoding': 'gzip' } : {}),
        'content-length': String((gzip ? names.gzip : names.body).byteLength),
      });
      return void res.end(head ? undefined : gzip ? names.gzip : names.body);
    }
    const searchMatch = DIRECTORY_SEARCH.exec(path);
    if (searchMatch) {
      const params = new URLSearchParams(query >= 0 ? url.slice(query + 1) : '');
      const q = params.get('q') ?? '';
      return answerDirectory(res, searchMatch[1]!, head, (register, ids, at) => register.search(q, ids, at, params.get('portraits') === '1'));
    }
    const cardMatch = DIRECTORY_CARD.exec(path);
    if (cardMatch) {
      const lookup: Lookup = cardMatch[2] ? { id: cardMatch[2] } : cardMatch[3] ? { login: cardMatch[3] } : { dab: cardMatch[4]! };
      // Opt-in keeps older clients' strict v1 decoders usable during a rolling web/service adoption.
      const portraits = new URLSearchParams(query >= 0 ? url.slice(query + 1) : '').get('portraits') === '1';
      return answerDirectory(res, cardMatch[1]!, head, (register, ids, at) => register.card(lookup, ids, at, portraits));
    }
    const roadMatch = DIRECTORY_ROAD.exec(path);
    if (roadMatch) {
      const [a, b]: [Lookup, Lookup] = roadMatch[2] ? [{ id: roadMatch[2] }, { id: roadMatch[3]! }] : [{ login: roadMatch[4]! }, { login: roadMatch[5]! }];
      return answerDirectory(res, roadMatch[1]!, head, (register, ids, at) => register.road(a, b, ids, at));
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
      const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? '')) && liveMatch[3] !== 'dabs.bin';
      const payload = gzip ? gzipSync(body, { level: 6 }) : body;
      res.writeHead(200, {
        'content-type': liveMatch[3] === 'starts.json' ? 'application/json; charset=utf-8' : 'application/octet-stream',
        'x-content-type-options': 'nosniff', ...immutable,
        ...(gzip ? { 'content-encoding': 'gzip' } : {}),
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
      const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', ...immutable,
        ...(gzip ? { 'content-encoding': 'gzip' } : {}),
        'content-length': String((gzip ? file.gzip : file.body).byteLength),
      });
      return void res.end(head ? undefined : gzip ? file.gzip : file.body);
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
  current();
  return {
    server,
    revision: () => current()?.survey.revision ?? null,
    close: () => new Promise((done) => {
      clearInterval(watcher);
      for (const clients of streams.values()) for (const res of clients.keys()) res.end();
      server.close(() => done());
      server.closeAllConnections();
    }),
  };
}
