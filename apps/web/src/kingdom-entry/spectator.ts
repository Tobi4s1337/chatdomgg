import { KingdomIdSchema, type KingdomId } from '@chatdom/shared';
import { REALM_ENTRY_ROUTE, REALM_FOUNDED_ROUTES, RealmEntryInfoSchema, type RealmFoundedManifest } from '@chatdom/shared/realm';
import { decodeFoundedScene, FOUNDED_SCENE_LIMITS } from '@chatdom/world/founded-scene';
import type { RealmFoundedScene } from '@chatdom/world';
import { RealmEntryError, type RealmFetch } from '../realm/adapters/entry';
import { createRealmWatch, type WatchEventSource } from '../realm/adapters/watch';
import { observeRealm, type RealmObserver } from '../realm/adapters/observer';
import { createRoomMomentFeed } from '../realm/adapters/moments';
import { createRoomPresenceFeed } from '../realm/adapters/presence';
import { createRoomGrowthFeed } from '../realm/adapters/growth';
import { createRoomChatFeed } from '../realm/adapters/chat';
import { createRealmForgeFeed, deferRealmForgeFeed } from '../realm/adapters/forge-feed';

/** One read-only stream view owns this closure; a scene replacement keeps only witnessed Forge work. */
export function createRealmSpectatorSource(options: { kingdomId: KingdomId; fetcher?: RealmFetch; source?: (path: string) => WatchEventSource }) {
  const kingdomId = KingdomIdSchema.parse(options.kingdomId), forgeFeed = createRealmForgeFeed();
  return async (signal: AbortSignal, revision: () => void, unavailable: () => void) => {
    signal.throwIfAborted();
    let observer: RealmObserver | undefined, disposed = false, active = false;
    const sceneForgeFeed = deferRealmForgeFeed(forgeFeed);
    const watch = createRealmWatch({ kingdomId, signal, revision, unavailable() { observer?.unavailable(); if (active) forgeFeed.unavailable(); unavailable(); },
      ...(options.source ? { source: options.source } : {}) });
    let offForge: (() => void) | undefined, chatFeed: ReturnType<typeof createRoomChatFeed> | undefined;
    const dispose = (reason?: 'scene-revision') => {
      if (disposed) return;
      disposed = true; signal.removeEventListener('abort', aborted);
      sceneForgeFeed.dispose(); offForge?.(); if (active && reason !== 'scene-revision') forgeFeed.unavailable();
      chatFeed?.dispose(); observer?.dispose(); watch.dispose();
    };
    const aborted = () => dispose(signal.reason === 'scene-revision' ? 'scene-revision' : undefined);
    signal.addEventListener('abort', aborted, { once: true });
    try {
      const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
      const read = async (path: string) => {
        const response = await fetcher(path, { signal, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
        if (!response.ok) throw new RealmEntryError('unavailable', 'The kingdom’s public watch is unavailable.');
        return response;
      };
      const [checkpoint, response] = await Promise.all([watch.checkpoint, read(REALM_ENTRY_ROUTE.replace(':kingdomId', encodeURIComponent(kingdomId)))]);
      const info = RealmEntryInfoSchema.parse(await response.json()), manifest: RealmFoundedManifest = checkpoint.manifest;
      if (info.kingdomId !== kingdomId || info.origin !== manifest.origin) throw new RealmEntryError('unavailable', 'The kingdom’s public name and streets do not agree.');
      const sceneResponse = await read(REALM_FOUNDED_ROUTES.scene.replace(':sceneHash', manifest.sceneHash));
      const scene: RealmFoundedScene = await decodeFoundedScene(await boundedBytes(sceneResponse), manifest);
      signal.throwIfAborted();
      observer = observeRealm(watch.room, { kingdomId, origin: manifest.origin, layoutRevision: manifest.layoutRevision, collisionRevision: manifest.collisionRevision });
      chatFeed = createRoomChatFeed(watch.room, observer);
      await ready(observer, signal);
      signal.throwIfAborted();
      const activate = () => {
        if (active || disposed) return;
        active = true; offForge = forgeFeed.bind(observer!); sceneForgeFeed.activate();
      };
      return { scene, manifest, kingdomName: info.name, presenceFeed: createRoomPresenceFeed(observer, manifest.origin, Date.now, true), growthFeed: createRoomGrowthFeed(observer, manifest.origin), walkerFeed: watch.walkerFeed, chatFeed, forgeFeed: sceneForgeFeed, momentFeed: createRoomMomentFeed(observer, manifest.origin), activate, dispose };
    } catch (error) { dispose(); throw error; }
  };
}

async function boundedBytes(response: Response): Promise<Uint8Array> {
  const limit = FOUNDED_SCENE_LIMITS.bytes;
  if (Number(response.headers.get('Content-Length')) > limit || !response.body) throw new Error('The founded scene exceeds its byte bound or has no bytes.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) { await reader.cancel(); throw new Error('The founded scene exceeds its byte bound.'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function ready(observer: RealmObserver, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let off = () => {};
    const finish = (error?: Error) => { off(); clearTimeout(timer); signal.removeEventListener('abort', aborted); if (error) reject(error); else resolve(); };
    const check = () => {
      const status = observer.current().status;
      if (status === 'ready') finish();
      else if (status === 'unavailable' || status === 'mismatch' || status === 'disposed') finish(new Error('The kingdom’s current streets could not be confirmed.'));
    };
    const aborted = () => finish(new DOMException('Watch was cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('The kingdom’s public checkpoint did not arrive.')), 15_000);
    off = observer.subscribe({ status: check });
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted(); else check();
  });
}
