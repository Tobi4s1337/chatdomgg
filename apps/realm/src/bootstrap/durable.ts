import type { Pool } from 'pg';
import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import type { KingdomId } from '@chatdom/shared';
import { createRealmAuthenticator } from '../auth/authenticator';
import { AllocationService, type HomeFurnisher, type TenureEvidenceVerifier } from '../allocation';
import { FileFoundedStore, FoundedUnavailableError, createFoundedWorldLoader } from '../founded';
import { PostgresRealmRepository, createDurableRealmServices, type DurableKingdom, type DurableRealmServices, type PostgresRealmRepositoryOptions } from '../persistence';
import { PostgresOutboxStore } from '../outbox';
import { RealmIngress, type IngressCredentials } from '../ingress';
import { RealmDiagnostics, RealmReadiness, authProbe, databaseProbe, holdEntry, mountDiagnosticsRoutes, writerProbe } from '../diagnostics';
import { createRealmServer } from '../server';
import { mountIngressRoute } from '../ingress';
import { createFoundedReader, mountFoundedRoutes, type FoundedReadAccess } from './founded';

export interface DurableRealmBootOptions {
  readonly pool: Pool;
  readonly origin: 'live' | 'simulated';
  readonly foundedDirectory: string;
  readonly verifier: TenureEvidenceVerifier;
  readonly foundedAccess: FoundedReadAccess;
  readonly ingressCredentials: IngressCredentials;
  readonly furnish?: HomeFurnisher;
  readonly log?: (line: string) => void;
  /** Install the same ForgeWriteGate guards used by the trusted coordinator. Origin stays fixed by this boot. */
  readonly repositoryOptions?: Omit<PostgresRealmRepositoryOptions, 'origin'>;
  /** Main binds its real Forge/interaction authority here; this callback has the one retained writer. */
  readonly attach?: (kingdom: DurableKingdom) => () => void;
}

/** Actual durable composition. Caller owns pool creation/schema assertion, listen and final pool shutdown. */
export function createDurableRealmBoot(options: DurableRealmBootOptions) {
  const { pool, origin } = options, log = options.log ?? (() => {});
  const allocation = new AllocationService(pool, { origin, verifier: options.verifier,
    ...(options.furnish ? { furnish: options.furnish } : {}), log });
  const store = new FileFoundedStore(options.foundedDirectory), loader = createFoundedWorldLoader(allocation, store);
  const repository = new PostgresRealmRepository(pool, { ...options.repositoryOptions, origin });
  const diagnostics = new RealmDiagnostics(), ingress = new RealmIngress(pool, origin, options.ingressCredentials, log);
  const open = () => services.kingdoms.values();
  const readiness = new RealmReadiness([databaseProbe(pool), authProbe(pool), writerProbe(open)]);
  const held = () => readiness.held();
  const registry = createDurableRealmServices({ repository, outbox: new PostgresOutboxStore(pool),
    auth: holdEntry(createRealmAuthenticator({ pool, origin }), held), hold: held, log,
    kingdom: loader.options,
    attach: kingdom => {
      const forget = kingdom.onClosed(reason => diagnostics.writerClosed(kingdom, reason));
      const detachIngress = ingress.attach(kingdom);
      let detachAuthority: (() => void) | undefined;
      try { detachAuthority = options.attach?.(kingdom); }
      catch (error) { forget(); detachIngress(); throw error; }
      return () => { detachAuthority?.(); detachIngress(); forget(); };
    },
  });
  // All cold openings prewarm real adopted content before entering the existing writer's acquire/load window.
  // Coalesce preparations, but do not cache the layout head: a later adoption must resolve its actual revision.
  const preparing = new Map<KingdomId, Promise<void>>();
  const prepare = (kingdomId: KingdomId): Promise<void> => {
    let pending = preparing.get(kingdomId);
    if (!pending) {
      pending = (async () => {
        if (!await allocation.currentLayout(kingdomId)) throw new FoundedUnavailableError('unfounded', 'This kingdom has no adopted layout. Entry cannot found a kingdom.');
        await loader.prepare(kingdomId);
      })().finally(() => preparing.delete(kingdomId));
      preparing.set(kingdomId, pending);
    }
    return pending;
  };
  const services: DurableRealmServices = { auth: registry.auth, kingdoms: registry.kingdoms,
    async open(kingdomId) { await prepare(kingdomId); return registry.open(kingdomId); },
    async retain(kingdomId) { await prepare(kingdomId); return registry.retain(kingdomId); },
  };
  ingress.use(services);
  const founded = createFoundedReader({ origin, services, loader, store, access: options.foundedAccess });
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    readiness.stop(); diagnostics.stop(); await ingress.stop();
    await Promise.all([...services.kingdoms.values()].map(kingdom => kingdom.dispose()));
  };
  return { services, repository, allocation, store, loader, ingress, diagnostics, readiness, founded,
    prepare, stop,
    /** Mount the real transport once; server shutdown releases our services, while caller closes the pool. */
    createServer(routes: { readonly mountIngress?: (app: uWebSocketsTransport['app']) => void } = {}) {
      const runtime = createRealmServer(services, diagnostics);
      diagnostics.watch({ pool });
      mountDiagnosticsRoutes(runtime.transport.app, readiness, diagnostics, open);
      mountFoundedRoutes(runtime.transport.app, founded);
      if (routes.mountIngress) routes.mountIngress(runtime.transport.app);
      else if (ingress.gate.configured) mountIngressRoute(runtime.transport.app, ingress);
      return runtime;
    },
  };
}
