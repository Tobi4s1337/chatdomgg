import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { KingdomIdSchema, Sha256Schema, type KingdomId } from '@chatdom/shared';
import { REALM_FOUNDED_ROUTES, RealmFoundedManifestSchema, type RealmFoundedManifest } from '@chatdom/shared/realm';
import { FoundedUnavailableError, decodeFoundedScene, type FileFoundedStore, type createFoundedWorldLoader } from '../founded';
import type { DurableRealmServices } from '../persistence';

/** Copied during the synchronous uWS callback; request objects must never escape that callback. */
export interface FoundedReadRequest {
  readonly authorization: string;
  readonly cookie: string;
  readonly origin: string;
}
export interface FoundedReadTarget {
  readonly kingdomId: KingdomId;
  readonly origin: 'live' | 'simulated';
  /** Absent on the first manifest authorization, before any kingdom is opened. */
  readonly sceneHash?: string;
}
/** Required host policy. A stored content hash never grants access or overrides withdrawal. */
export type FoundedReadAccess = (target: FoundedReadTarget, request: FoundedReadRequest) => boolean | Promise<boolean>;
export const denyFoundedReads: FoundedReadAccess = () => false;

export class FoundedReadError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 503, message: string) { super(message); this.name = 'FoundedReadError'; }
}

export function createFoundedReader(input: {
  readonly origin: 'live' | 'simulated';
  readonly services: DurableRealmServices;
  readonly loader: ReturnType<typeof createFoundedWorldLoader>;
  readonly store: Pick<FileFoundedStore, 'get'>;
  readonly access: FoundedReadAccess;
}) {
  const authorize = async (target: FoundedReadTarget, request: FoundedReadRequest) => {
    if (target.origin !== input.origin || !await input.access(target, request)) throw new FoundedReadError(403, 'This kingdom geometry is not available to this request.');
  };
  const reader = {
    async manifest(rawKingdomId: string, request: FoundedReadRequest): Promise<RealmFoundedManifest> {
      const parsed = KingdomIdSchema.safeParse(rawKingdomId);
      if (!parsed.success) throw new FoundedReadError(400, 'The kingdom identifier is invalid.');
      const kingdomId = parsed.data, target = { kingdomId, origin: input.origin };
      await authorize(target, request);
      // This is the same retained registry rooms and ingress use. Cold entry needs no principal or second writer.
      const hold = await input.services.retain(kingdomId).catch(error => {
        if (error instanceof FoundedUnavailableError && error.reason === 'unfounded') throw new FoundedReadError(404, 'This kingdom has no adopted layout. Entry cannot found a kingdom.');
        throw error;
      });
      try {
        const kingdom = hold.kingdom, checkpoint = await kingdom.preparePublicCheckpoint();
        const prepared = input.loader.current(kingdomId), manifest = prepared?.manifestFor(checkpoint);
        if (!manifest || !kingdom.current || kingdom.origin !== input.origin || kingdom.world !== prepared?.world) {
          throw new FoundedReadError(503, 'The approved kingdom geometry is still preparing.');
        }
        // Access can be withdrawn while the public prefix is being read. Check again at the response boundary.
        await authorize({ ...target, sceneHash: manifest.sceneHash }, request);
        if (!kingdom.current || !prepared.manifestFor(kingdom.publicCheckpoint())
          || kingdom.world !== prepared.world) throw new FoundedReadError(503, 'The approved kingdom geometry changed during this read.');
        return manifest;
      } finally { await hold.release(); }
    },
    async scene(rawHash: string, request: FoundedReadRequest): Promise<Uint8Array> {
      const hash = Sha256Schema.safeParse(rawHash);
      if (!hash.success) throw new FoundedReadError(400, 'The scene identifier is invalid.');
      const bytes = await input.store.get(hash.data);
      if (!bytes) throw new FoundedReadError(404, 'This kingdom geometry is unavailable.');
      // Read the allowlisted public identity only. Full decoder checks that the exact bytes carry this hash.
      const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (typeof value !== 'object' || value === null) throw new FoundedReadError(503, 'This kingdom geometry is unavailable.');
      const scene = value as Record<string, unknown>;
      const manifest = RealmFoundedManifestSchema.parse({ version: scene.version, kingdomId: scene.kingdomId,
        origin: scene.origin, layoutRevision: scene.layoutRevision, collisionRevision: scene.collisionRevision, sceneHash: hash.data });
      const target = { kingdomId: manifest.kingdomId, origin: manifest.origin, sceneHash: hash.data };
      await authorize(target, request);
      await decodeFoundedScene(bytes, manifest);
      // A valid stored hash may name a native baseline or superseded publication. Only the exact scene that the
      // retained authority currently adopts and exposes at its delivered public checkpoint is readable.
      const current = await reader.manifest(manifest.kingdomId, request);
      if (current.sceneHash !== hash.data) throw new FoundedReadError(404, 'This scene is not the current approved kingdom geometry.');
      await authorize(target, request);
      return bytes;
    },
  };
  return reader;
}

type App = uWebSocketsTransport['app'];
type Reader = ReturnType<typeof createFoundedReader>;
const statuses = { 400: '400 Bad Request', 403: '403 Forbidden', 404: '404 Not Found', 503: '503 Service Unavailable' } as const;

/** Exact frozen public paths; the web host proxies them here without becoming another geometry authority. */
export function mountFoundedRoutes(app: App, reader: Reader) {
  const mount = (route: string, read: (parameter: string, request: FoundedReadRequest) => Promise<RealmFoundedManifest | Uint8Array>) => {
    app.get(route, (res, req) => {
      const parameter = req.getParameter(0) ?? '', request = { authorization: req.getHeader('authorization'), cookie: req.getHeader('cookie'), origin: req.getHeader('origin') };
      let aborted = false;
      res.onAborted(() => { aborted = true; });
      void read(parameter, request).then(body => {
        if (aborted) return;
        res.cork(() => {
          res.writeStatus('200 OK').writeHeader('Content-Type', 'application/json').writeHeader('Cache-Control', 'no-store')
            .writeHeader('X-Content-Type-Options', 'nosniff').end(body instanceof Uint8Array ? body : JSON.stringify(body));
        });
      }, error => {
        if (aborted) return;
        const failure = error instanceof FoundedReadError ? error : new FoundedReadError(503, 'The approved kingdom geometry is unavailable.');
        res.cork(() => {
          res.writeStatus(statuses[failure.status]).writeHeader('Content-Type', 'application/json').writeHeader('Cache-Control', 'no-store')
            .end(JSON.stringify({ version: 1, status: 'unavailable', message: failure.message }));
        });
      });
    });
  };
  // Register the specific scene path first; neither path mutates or accepts browser-authored geometry.
  mount(REALM_FOUNDED_ROUTES.scene, (hash, request) => reader.scene(hash, request));
  mount(REALM_FOUNDED_ROUTES.manifest, (kingdomId, request) => reader.manifest(kingdomId, request));
}
