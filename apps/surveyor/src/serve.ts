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
}

/**
 * Projects a preview's raw names for publication: withheld channels are listed (so the browser draws their land bare)
 * and lose their names; a name the source has not confirmed within a day is left out, so the browser falls back to
 * the shield. The result is the only way a login or display name leaves this service.
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
    const until = nameFreshUntil(names.factsAt[i]!);
    if (until <= now) return;
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
      server.close(() => done());
      server.closeAllConnections();
    }),
  };
}
