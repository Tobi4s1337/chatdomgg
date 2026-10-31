import { KingdomIdSchema, type KingdomId } from '@chatdom/shared';
import { REALM_WATCH_ROUTE, RealmFoundedManifestSchema, type RealmPublicDelivery, type RealmWatchCheckpoint } from '@chatdom/shared/realm';
import type { RealmObservedRoom } from './observer';

export interface WatchEventSource {
  addEventListener(type: string, listener: EventListener): void;
  close(): void;
}
export interface RealmWatch {
  readonly room: RealmObservedRoom;
  /** The actual first server checkpoint; geometry is fetched against this exact receipt. */
  readonly checkpoint: Promise<RealmWatchCheckpoint>;
  dispose(): void;
}

/** Public SSE transport only. It has no session, principal, join, walker or command channel. */
export function createRealmWatch(options: {
  kingdomId: KingdomId;
  signal: AbortSignal;
  revision(): void;
  unavailable(): void;
  source?: (path: string) => WatchEventSource;
  maxBuffered?: number;
}): RealmWatch {
  const kingdomId = KingdomIdSchema.parse(options.kingdomId);
  const handlers = new Map<string, Set<(payload: never) => void>>();
  const maxBuffered = options.maxBuffered ?? 512;
  let stream: WatchEventSource | undefined, generation = 0, disposed = false, failed = false;
  let installed = false, initial: RealmWatchCheckpoint | undefined, buffered: RealmPublicDelivery[] = [];
  let bufferBytes = 0, first = true;
  let resolve!: (checkpoint: RealmWatchCheckpoint) => void, reject!: (error: Error) => void;
  const checkpoint = new Promise<RealmWatchCheckpoint>((yes, no) => { resolve = yes; reject = no; });
  const emit = (type: string, value: unknown) => { for (const receive of [...handlers.get(type) ?? []]) receive(value as never); };
  const timer = setTimeout(() => fail(), 15_000);
  function fail() {
    if (disposed || failed) return;
    failed = true; generation++; clearTimeout(timer); stream?.close(); stream = undefined;
    initial = undefined; buffered = []; bufferBytes = 0;
    reject(new Error('The kingdom’s public watch is unavailable.'));
    options.unavailable();
  }
  function open() {
    if (disposed || failed) return;
    stream?.close(); initial = undefined; buffered = []; bufferBytes = 0;
    const own = ++generation;
    const next = (options.source ?? (path => new EventSource(path)))(REALM_WATCH_ROUTE.replace(':kingdomId', encodeURIComponent(kingdomId)));
    stream = next;
    const listen = (type: string, receive: (payload: unknown, length: number) => void) => next.addEventListener(type, event => {
      if (disposed || failed || generation !== own) return;
      const data = (event as MessageEvent<unknown>).data;
      if (typeof data !== 'string' || data.length > 8_000_000) { fail(); return; }
      try { receive(JSON.parse(data) as unknown, data.length); } catch { fail(); }
    });
    listen('checkpoint', raw => {
      const c = raw as RealmWatchCheckpoint | null;
      const manifest = RealmFoundedManifestSchema.safeParse(c?.manifest);
      const b = c?.checkpoint;
      if (c?.version !== 1 || !manifest.success || manifest.data.kingdomId !== kingdomId || !b || b.version !== 1
        || b.kingdomId !== kingdomId || b.layoutRevision !== manifest.data.layoutRevision || b.collisionRevision !== manifest.data.collisionRevision
        || !Array.isArray(b.current) || b.current.length > 65_536 || !Number.isSafeInteger(b.throughCursor) || b.throughCursor < 0
        || typeof b.writerEpoch !== 'string' || !b.writerEpoch.length || b.writerEpoch.length > 256) { fail(); return; }
      const value: RealmWatchCheckpoint = { version: 1, manifest: manifest.data, checkpoint: b };
      if (first) { first = false; initial = value; clearTimeout(timer); resolve(value); }
      else if (installed) emit('bootstrap', b);
      else initial = value;
    });
    listen('world', (raw, length) => {
      if (installed) emit('world', raw);
      else {
        buffered.push(raw as RealmPublicDelivery); bufferBytes += length;
        if (buffered.length > maxBuffered || bufferBytes > 8_000_000) fail();
      }
    });
    // Speech and present-tense stages received during asset loading are never replayed later.
    listen('transient', raw => { if (installed) emit('transient', raw); });
    listen('revision', raw => { emit('revision', raw); options.revision(); });
    next.addEventListener('closed', fail);
    next.addEventListener('error', fail);
  }
  const dispose = () => {
    if (disposed) return;
    disposed = true; generation++; clearTimeout(timer); stream?.close(); stream = undefined;
    options.signal.removeEventListener('abort', dispose); handlers.clear(); buffered = []; initial = undefined;
    reject(new DOMException('Watch was cancelled', 'AbortError'));
  };
  const room: RealmObservedRoom = {
    onMessage(type, receive) { const set = handlers.get(type) ?? new Set(); set.add(receive); handlers.set(type, set); return () => { set.delete(receive); }; },
    send(type) {
      // Observer checkpoint requests reopen the real endpoint. No command is ever sent.
      if (type !== 'bootstrap' || disposed || failed) return;
      if (!installed && initial) {
        const current = initial, pending = buffered;
        installed = true; initial = undefined; buffered = []; bufferBytes = 0;
        queueMicrotask(() => { if (!disposed && !failed) { for (const row of pending) emit('world', row); emit('bootstrap', current.checkpoint); } });
      } else { installed = true; open(); }
    },
  };
  options.signal.addEventListener('abort', dispose, { once: true });
  if (options.signal.aborted) dispose(); else open();
  return { room, checkpoint, dispose };
}
