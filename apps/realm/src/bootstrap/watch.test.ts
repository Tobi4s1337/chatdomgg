import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { expect, it, vi } from 'vitest';
import { KingdomIdSchema } from '@chatdom/shared';
import { PRESENCE_FIXTURES } from '@chatdom/shared/world-fixtures';
import { REALM_WATCH_ROUTE, type RealmPublicMessage, type RealmWriterLease } from '@chatdom/shared/realm';
import { generateSettlementPlan } from '@chatdom/world';
import { createRealmState } from '@chatdom/world/realm';
import { createFoundedWorldLoader, FileFoundedStore } from '../founded';
import { createDurableRealmServices, type DurableRepository } from '../persistence';
import type { RealmOutboxStore } from '../outbox';
import type { RealmOutboxRow } from '../persistence/postgres-repository';
import { createFoundedReader } from './founded';
import { mountRealmWatchRoutes } from './watch';

type App = uWebSocketsTransport['app'];
type Handler = Parameters<App['get']>[1];
const deferred = () => {
  let resolve!: () => void;
  return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
};

/** Only the native socket boundary is simulated; the registry, writer, projection and policy reader are real. */
class Response {
  readonly chunks: string[] = [];
  readonly headers = new Map<string, string>();
  status = '';
  ended = false;
  writable = true;
  drained: ((offset: number) => boolean) | undefined;
  aborted = () => {};
  onAborted(callback: () => void) { this.aborted = callback; return this; }
  onWritable(callback: (offset: number) => boolean) { this.drained = callback; return this; }
  cork(callback: () => void) { callback(); return this; }
  writeStatus(value: string) { this.status = value; return this; }
  writeHeader(key: string, value: string) { this.headers.set(key, value); return this; }
  write(value: string) { this.chunks.push(value); return this.writable; }
  end(value = '') { if (value) this.chunks.push(value); this.ended = true; return this; }
  close() { this.ended = true; this.aborted(); return this; }
  events() {
    return this.chunks.flatMap(chunk => chunk.split('\n\n').filter(part => part.startsWith('event: ')).map(part => {
      const [event, data] = part.split('\n');
      return { event: event!.slice('event: '.length), data: JSON.parse(data!.slice('data: '.length)) };
    }));
  }
}

it('hands the exact checkpoint before new deltas, stays quiet on restored history, applies policy and releases every hold (SIMULATED)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chatdom-watch-'));
  const kingdomId = KingdomIdSchema.parse('900007201'), gate = deferred();
  const plan = generateSettlementPlan({ seed: 'SIMULATED-watch', tier: 'hamlet', firstYear: 2026, year: 2026 });
  const store = new FileFoundedStore(directory);
  const loader = createFoundedWorldLoader({ origin: 'simulated', currentLayout: async () => ({ revision: plan.revision, foundedAt: 1, adoptedAt: 1 }), layoutPlan: async () => plan }, store);
  const initial = { ...createRealmState(kingdomId, 'simulated'), sequence: 3, privateSentinel: 'PRIVATE-SIMULATED-state' };
  const lease: RealmWriterLease = { kingdomId, epoch: 'SIMULATED-watch-writer', expiresAt: Date.now() + 60_000 };
  const release = vi.fn(async () => {}), acquire = vi.fn(async () => lease);
  const repository: DurableRepository = { leaseMs: 60_000, acquire, release,
    renew: async () => ({ ...lease, expiresAt: Date.now() + 60_000 }), load: async () => initial,
    committedState: () => initial, execute: async () => ({ status: 'unchanged', reason: 'unused' }),
    lookup: async () => null, loadIngress: async () => null, executeIngress: async () => ({ status: 'unchanged', reason: 'unused' }), snapshot: async () => initial.sequence };
  const presence = (sequence: number): Extract<RealmPublicMessage, { type: 'presence' }> => ({ type: 'presence', frame: { ...PRESENCE_FIXTURES.public, kingdomId, sequence } });
  let rows: RealmOutboxRow[] = [];
  const outbox: RealmOutboxStore = { open: async () => 10,
    prefix: async () => ({ homes: [], presence: presence(1), sequence: 1, committed: 10 }),
    read: async (_id, after) => rows.filter(row => row.id > after), acknowledge: async () => {} };
  const authenticate = vi.fn(async () => { throw new Error('A spectator must not authenticate as a walker.'); });
  const services = createDurableRealmServices({ repository, outbox, auth: { authenticate, current: async () => false }, kingdom: loader.options });
  let allowed = true, blockedPolicy = true;
  const access = vi.fn(async () => { if (blockedPolicy) await gate.promise; return allowed; });
  const founded = createFoundedReader({ origin: 'simulated', services, loader, store, access });
  let handler!: Handler;
  const app = { get: (_route: string, callback: Handler) => { expect(_route).toBe(REALM_WATCH_ROUTE); handler = callback; } } as unknown as App;
  mountRealmWatchRoutes(app, { services, founded, loader });
  const open = () => {
    const response = new Response();
    const request = { getParameter: () => kingdomId, getHeader: () => '' };
    handler(response as unknown as Parameters<Handler>[0], request as unknown as Parameters<Handler>[1]);
    return response;
  };
  const write = (id: number) => { rows = [...rows, { id, sequence: id - 9, eventId: `SIMULATED-presence-${id}`, plotId: null, message: presence(id - 9) }]; };
  await loader.prepare(kingdomId);
  const existing = await services.retain(kingdomId);
  try {
    const first = open();
    await vi.waitFor(() => expect(access).toHaveBeenCalled());
    write(11);
    await existing.kingdom.preparePublicCheckpoint();
    existing.kingdom.transient({ type: 'chat.clear' }); // Preparation is not a live speech replay.
    expect(first.chunks).toHaveLength(0);
    gate.resolve(); blockedPolicy = false;
    await vi.waitFor(() => expect(first.events()).toHaveLength(1));
    const firstEvent = first.events()[0]!;
    expect(firstEvent.event).toBe('checkpoint');
    expect(firstEvent.data.checkpoint).toMatchObject({ throughCursor: 11, throughSequence: 3, current: [presence(2)] });
    expect(firstEvent.data.manifest).toEqual(loader.current(kingdomId)!.manifestFor(existing.kingdom.publicCheckpoint()));
    expect(firstEvent.data.manifest.collisionRevision).toBe(existing.kingdom.world.revision);

    write(12); await existing.kingdom.preparePublicCheckpoint();
    existing.kingdom.transient({ type: 'chat.clear' });
    existing.kingdom.toOwner('SIMULATED-private-owner', { type: 'receipt', receipt: { version: 1, id: 'PRIVATE-SIMULATED-receipt', status: 'held', message: 'PRIVATE-SIMULATED-reply' } });
    expect(first.events().map(event => event.event)).toEqual(['checkpoint', 'world', 'transient']);
    expect(first.events()[1]!.data.cursor).toBe(12);
    expect(first.chunks.join('')).not.toContain('PRIVATE-SIMULATED');
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    expect(authenticate).not.toHaveBeenCalled(); expect(acquire).toHaveBeenCalledTimes(1);

    first.aborted();
    const quiet = open();
    await vi.waitFor(() => expect(quiet.events()).toHaveLength(1));
    expect(quiet.events()[0]!.data.checkpoint.throughCursor).toBe(12);
    expect(quiet.events().map(event => event.event)).toEqual(['checkpoint']);
    quiet.aborted();
    allowed = false;
    const denied = open();
    await vi.waitFor(() => expect(denied.status).toBe('403 Forbidden'));
    expect(denied.chunks.join('')).not.toContain('SIMULATED-watch-writer');
    expect(denied.chunks.join('')).not.toContain('sceneHash');
    allowed = true;
    const stalled = open(); stalled.writable = false;
    await vi.waitFor(() => expect(stalled.events()).toHaveLength(1));
    existing.kingdom.transient({ type: 'chat.clear' });
    expect(stalled.ended).toBe(true); // No event is queued behind a blocked native write.

    // With the independent inspection hold gone, every aborted/refused/stalled observer must have released.
    await existing.release();
    expect(services.kingdoms.size).toBe(0); expect(release).toHaveBeenCalledTimes(1);

    const closed = open();
    await vi.waitFor(() => expect(closed.events()).toHaveLength(1));
    await services.kingdoms.get(kingdomId)!.dispose();
    expect(closed.events().map(event => event.event)).toEqual(['checkpoint', 'closed']);
    expect(closed.ended).toBe(true);
    await vi.waitFor(() => expect(services.kingdoms.size).toBe(0));
    expect(release).toHaveBeenCalledTimes(2);
  } finally {
    gate.resolve(); await existing.release(); await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
