import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { KingdomIdSchema } from '@chatdom/shared';
import { REALM_WATCH_ROUTE, type RealmPublicDelivery, type RealmWatchCheckpoint, type RealmWatchRevision } from '@chatdom/shared/realm';
import { FoundedUnavailableError, type createFoundedWorldLoader } from '../founded';
import type { DurableKingdomHold, DurableRealmServices } from '../persistence';
import { FoundedReadError, type createFoundedReader } from './founded';

const WATCH_LIMIT = 32;
const PREFIX_LIMIT = 256;
const BYTE_LIMIT = 1024 * 1024;
const STALLED_WRITE_MS = 10_000;
const statuses = { 400: '400 Bad Request', 403: '403 Forbidden', 404: '404 Not Found', 503: '503 Service Unavailable' } as const;
const frame = (event: string, value: unknown) => `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;

/** A public spectator shares the retained authority; it never joins a room or obtains a principal. */
export function mountRealmWatchRoutes(app: uWebSocketsTransport['app'], input: {
  readonly services: Pick<DurableRealmServices, 'retain'>;
  readonly founded: Pick<ReturnType<typeof createFoundedReader>, 'manifest'>;
  readonly loader: Pick<ReturnType<typeof createFoundedWorldLoader>, 'current'>;
}) {
  let watchers = 0;
  app.get(REALM_WATCH_ROUTE, (res, req) => {
    // uWS request storage expires when this synchronous callback returns.
    const parameter = req.getParameter(0) ?? '';
    const request = { authorization: req.getHeader('authorization'), cookie: req.getHeader('cookie'), origin: req.getHeader('origin') };
    let ended = false, streaming = false, ready = false, counted = false, blocked = false;
    let hold: DurableKingdomHold | undefined;
    let stalled: ReturnType<typeof setTimeout> | undefined;
    let keepalive: ReturnType<typeof setInterval> | undefined;
    let prefixBytes = 0, throughCursor = 0;
    const prefix: RealmPublicDelivery[] = [], detach: (() => void)[] = [];
    const cleanup = () => {
      if (ended) return;
      ended = true;
      if (stalled) clearTimeout(stalled);
      if (keepalive) clearInterval(keepalive);
      for (const unsubscribe of detach.splice(0)) unsubscribe();
      prefix.length = 0;
      if (counted) { counted = false; watchers--; }
      void hold?.release().catch(() => {});
    };
    const close = (reason: string, force = false) => {
      if (ended) return;
      const wasStreaming = streaming;
      cleanup();
      if (force || blocked) { res.close(); return; }
      res.cork(() => {
        if (wasStreaming) res.end(frame('closed', { reason }));
        else res.writeStatus('503 Service Unavailable').writeHeader('Content-Type', 'application/json').writeHeader('Cache-Control', 'no-store')
          .end(JSON.stringify({ version: 1, status: 'unavailable', message: 'The kingdom watch must reconnect.' }));
      });
    };
    const write = (body: string) => {
      if (ended) return false;
      // write(false) already owns its entire chunk. Never retry it or accumulate a history behind it.
      if (blocked || Buffer.byteLength(body) > BYTE_LIMIT) { close('resync-required', true); return false; }
      res.cork(() => { blocked = !res.write(body); });
      if (blocked) {
        stalled = setTimeout(() => close('stalled', true), STALLED_WRITE_MS);
        stalled.unref?.();
      }
      return !ended;
    };
    const send = (event: string, value: unknown) => write(frame(event, value));
    res.onAborted(cleanup);
    res.onWritable(() => {
      if (ended) return true;
      blocked = false;
      if (stalled) { clearTimeout(stalled); stalled = undefined; }
      return true;
    });
    const fail = (error: unknown) => {
      if (ended) return;
      if (streaming) { close('unavailable'); return; }
      cleanup();
      const failure = error instanceof FoundedReadError ? error
        : error instanceof FoundedUnavailableError && error.reason === 'unfounded'
          ? new FoundedReadError(404, 'This kingdom has no adopted layout. Watching cannot found a kingdom.')
          : new FoundedReadError(503, 'The approved kingdom watch is unavailable.');
      res.cork(() => res.writeStatus(statuses[failure.status]).writeHeader('Content-Type', 'application/json')
        .writeHeader('Cache-Control', 'no-store').writeHeader('X-Content-Type-Options', 'nosniff')
        .end(JSON.stringify({ version: 1, status: 'unavailable', message: failure.message })));
    };
    if (watchers >= WATCH_LIMIT) { fail(new FoundedReadError(503, 'The kingdom watch is full. Reconnect shortly.')); return; }
    counted = true; watchers++;
    void (async () => {
      const parsed = KingdomIdSchema.safeParse(parameter);
      if (!parsed.success) throw new FoundedReadError(400, 'The kingdom identifier is invalid.');
      const retained = await input.services.retain(parsed.data);
      if (ended) { await retained.release(); return; }
      hold = retained;
      const kingdom = hold.kingdom;
      detach.push(kingdom.onClosed(() => close('authority-lost')));
      detach.push(kingdom.subscribe(message => {
        if (ended) return;
        if (ready) {
          if (message.cursor <= throughCursor) return;
          if (send('world', message)) throughCursor = message.cursor;
          return;
        }
        const bytes = Buffer.byteLength(frame('world', message));
        if (prefix.length >= PREFIX_LIMIT || prefixBytes + bytes > BYTE_LIMIT) { close('resync-required', true); return; }
        prefix.push(message); prefixBytes += bytes;
      }));
      detach.push(kingdom.subscribeWalkers(frame => { if (ready) send('walkers', frame); }));
      detach.push(kingdom.bindTransient(message => { if (ready) send('transient', message); }, () => {}));
      detach.push(kingdom.onWorldAdopted(() => {
        if (!ready || ended) return;
        const revision: RealmWatchRevision = { layoutRevision: kingdom.layoutRevision, collisionRevision: kingdom.world.revision };
        if (send('revision', revision)) close('revision');
      }));
      // The required geometry policy and its withdrawal recheck stay in the real founded reader.
      // Subscriptions precede its asynchronous public-prefix/world preparation.
      const approved = await input.founded.manifest(parameter, request);
      if (ended) return;
      const checkpoint = kingdom.publicCheckpoint(), prepared = input.loader.current(parsed.data);
      const manifest = prepared?.manifestFor(checkpoint);
      if (!kingdom.current || !manifest || manifest.sceneHash !== approved.sceneHash || prepared?.world !== kingdom.world) {
        throw new FoundedReadError(503, 'The approved kingdom geometry changed during this watch.');
      }
      const initial: RealmWatchCheckpoint = { version: 1, manifest, checkpoint };
      if (Buffer.byteLength(frame('checkpoint', initial)) > BYTE_LIMIT) throw new FoundedReadError(503, 'The kingdom watch checkpoint is too large.');
      res.cork(() => res.writeStatus('200 OK').writeHeader('Content-Type', 'text/event-stream; charset=utf-8')
        .writeHeader('Cache-Control', 'no-store').writeHeader('X-Accel-Buffering', 'no').writeHeader('X-Content-Type-Options', 'nosniff'));
      streaming = true;
      throughCursor = checkpoint.throughCursor;
      if (!send('checkpoint', initial)) return;
      ready = true;
      if (!send('walkers', kingdom.currentWalkers())) return;
      keepalive = setInterval(() => { write(': keepalive\n\n'); }, 10_000);
      keepalive.unref?.();
      for (const message of prefix) {
        if (message.cursor <= throughCursor) continue;
        if (!send('world', message)) break;
        throughCursor = message.cursor;
      }
      prefix.length = 0; prefixBytes = 0;
    })().catch(fail);
  });
}
