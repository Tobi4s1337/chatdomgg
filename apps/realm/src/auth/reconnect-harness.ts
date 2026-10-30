import { matchMaker } from '@colyseus/core';
import { Client } from '@colyseus/sdk';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import { createRealmServer } from '../server';
import { PostgresRealmRepository, createDurableRealmServices, createRealmPool, type DurableRealmServices } from '../persistence';
import { PostgresOutboxStore } from '../outbox';
import { createRealmAuthenticator } from './authenticator';

/**
 * Spec 34 R8 harness: one realm process as production composes it (Postgres writer lease, checked tickets, durable
 * kingdom) plus the real SDK client, for the reconnect/revocation test in `apps/api/src/realm-auth`. Test support
 * only; the server entry never imports it. Every kingdom is SIMULATED and walks the reference court.
 */
export { Client as RealmSdkClient };
export { REFERENCE_WORLD as HARNESS_WORLD };

export interface HarnessRealm {
  readonly endpoint: string;
  readonly services: DurableRealmServices;
  /** Graceful process stop: rooms close (4001), kingdoms snapshot and release their own lease, the pool ends. */
  close(): Promise<void>;
}

export async function startHarnessRealm(input: { readonly connectionString: string; readonly schema: string; readonly port: number }): Promise<HarnessRealm> {
  const pool = createRealmPool({ connectionString: input.connectionString, schema: input.schema });
  const services = createDurableRealmServices({
    repository: new PostgresRealmRepository(pool, { origin: 'simulated' }), outbox: new PostgresOutboxStore(pool),
    auth: createRealmAuthenticator({ pool, origin: 'simulated' }),
    kingdom: () => ({ world: REFERENCE_WORLD, layoutRevision: 'reference-court-v1',
      spawn: (_principal, arrival) => [((arrival % 5) - 2) * 3, 0, 6 + (Math.floor(arrival / 5) % 4) * 2.5] }),
  });
  const { server } = createRealmServer(services);
  await server.listen(input.port, '127.0.0.1');
  return { endpoint: `http://127.0.0.1:${input.port}`, services, async close() { await server.gracefullyShutdown(false); await pool.end(); } };
}

/** Cut one walker's socket the way a lost network does: no close frame, so the browser sees 1006 and the room a drop. */
export function severWalker(roomId: string, walkerId: string): boolean {
  const client = matchMaker.getLocalRoomById(roomId)?.clients.getById(walkerId);
  if (!client) return false;
  client.leave();
  return true;
}

/** Walkers the server holds in a room right now, connected or waiting out a reconnect grace. */
export function seatedWalkers(roomId: string): string[] {
  const room = matchMaker.getLocalRoomById(roomId) as { state?: { walkers?: Map<string, unknown> } } | undefined;
  return [...(room?.state?.walkers?.keys() ?? [])];
}
