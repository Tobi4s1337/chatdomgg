import { KingdomIdSchema, type KingdomId } from '@chatdom/shared';
import { REALM_FOUNDED_ROUTES, RealmFoundedManifestSchema } from '@chatdom/shared/realm';
import { compileFoundedScene } from '@chatdom/world/founded-collision';
import { decodeFoundedScene, FOUNDED_SCENE_LIMITS } from '@chatdom/world/founded-scene';
import { connectRealm } from '../realm/client';
import { openRealmApiSession, RealmEntryError, realmEntryFailureMessage, readRealmJson, type RealmFetch } from '../realm/adapters/entry';
import { createRoomChatFeed } from '../realm/adapters/chat';
import { createRealmForgeFeed } from '../realm/adapters/forge-feed';
import { observeRealm, observedRoom, type RealmObserver } from '../realm/adapters/observer';
import { createRoomMomentFeed } from '../realm/adapters/moments';
import { createRoomPresenceFeed } from '../realm/adapters/presence';
import type { KingdomEntrySource } from './types';

export interface LiveKingdomEntryOptions {
  readonly kingdomId: KingdomId;
  /** Approved public name supplied by the host. Receipts do not carry names; never infer one from the URL. */
  readonly kingdomName: string;
  /** Explicit authenticated rehearsal only; it still uses API sessions, CSRF and checked founded geometry. */
  readonly origin?: 'live' | 'simulated';
  readonly notice?: string;
  /** Trusted host configuration. Defaults to this origin's /realm-data transport. */
  readonly endpoint?: string;
  readonly fetcher?: RealmFetch;
  readonly storage?: Storage;
}

/** Same-origin API session -> exact approved scene -> matching room checkpoint, with no alternate entry path. */
export function createLiveKingdomEntrySource(options: LiveKingdomEntryOptions): KingdomEntrySource {
  const kingdomId = KingdomIdSchema.parse(options.kingdomId), origin = options.origin ?? 'live';
  const kingdomName = options.kingdomName.trim();
  if (!kingdomName || kingdomName.length > 80) throw new RealmEntryError('unavailable', 'The kingdom’s approved name is not available yet.');
  if (origin === 'simulated' && !options.notice?.includes('SIMULATED')) throw new RealmEntryError('refused', 'This rehearsal must be labelled SIMULATED.');
  const forgeFeed = createRealmForgeFeed();
  const open: KingdomEntrySource = async signal => {
    let step = 'reading your sign-in';
    try {
    signal.throwIfAborted();
    const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    const session = await openRealmApiSession(kingdomId, fetcher, signal);
    if (session.status !== 'authenticated') throw new RealmEntryError('unauthenticated', 'Sign in with Twitch to walk into this kingdom.');
    const read = async (path: string) => {
      const response = await fetcher(path, { signal, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new RealmEntryError('unavailable', 'The kingdom’s founded streets are not ready for visitors yet.');
      return response;
    };
    step = 'loading the founded streets';
    const manifestPath = REALM_FOUNDED_ROUTES.manifest.replace(':kingdomId', encodeURIComponent(kingdomId));
    const manifest = RealmFoundedManifestSchema.parse(await readRealmJson(await read(manifestPath), `Loading the founded streets (${manifestPath})`));
    if (manifest.kingdomId !== kingdomId || manifest.origin !== origin) throw new RealmEntryError('unavailable', 'The gate and the founded kingdom do not agree.');
    const response = await read(REALM_FOUNDED_ROUTES.scene.replace(':sceneHash', manifest.sceneHash));
    const bytes = await boundedBytes(response, FOUNDED_SCENE_LIMITS.bytes);
    step = 'checking the founded streets';
    const scene = await decodeFoundedScene(bytes, manifest);
    signal.throwIfAborted();
    step = 'preparing the walkable streets';
    const collision = compileFoundedScene(scene);
    signal.throwIfAborted();
    step = 'joining the live kingdom';
    const client = await connectRealm(options.endpoint ?? `${location.origin}/realm-data`, session.entry, collision, options.storage ?? sessionStorage);
    if (signal.aborted) { client.dispose(); signal.throwIfAborted(); }
    const state = client.room.state;
    if (state.kingdomId !== kingdomId || state.origin !== origin || state.layoutRevision !== manifest.layoutRevision
      || state.collisionRevision !== manifest.collisionRevision) { client.dispose(); throw new RealmEntryError('unavailable', 'The kingdom’s streets changed while the gate was opening. Try again.'); }
    step = 'confirming your place in the room';
    const room = observedRoom(client.room);
    const observer = observeRealm(room, { kingdomId, origin, collisionRevision: manifest.collisionRevision, layoutRevision: manifest.layoutRevision });
    const chatFeed = createRoomChatFeed(room, observer);
    const offForge = forgeFeed.bind(observer);
    const dropped = () => observer.unavailable();
    const reconnected = () => observer.resync();
    client.room.onDrop(dropped); client.room.onLeave(dropped); client.room.onReconnect(reconnected);
    let disposed = false;
    const dispose = (reason?: 'scene-revision') => {
      if (disposed) return; disposed = true;
      signal.removeEventListener('abort', aborted);
      client.room.onDrop.remove(dropped); client.room.onLeave.remove(dropped); client.room.onReconnect.remove(reconnected);
      offForge();
      if (reason !== 'scene-revision') forgeFeed.unavailable();
      chatFeed.dispose(); observer.dispose(); client.dispose();
    };
    const aborted = () => dispose();
    signal.addEventListener('abort', aborted, { once: true });
    try { await readyCheckpoint(observer, signal); signal.throwIfAborted(); }
    catch (error) { dispose(); throw error; }
    return { scene, manifest, collision, client, presenceFeed: createRoomPresenceFeed(observer, origin), chatFeed, forgeFeed, momentFeed: createRoomMomentFeed(observer, origin),
      kingdomName, ...(options.notice ? { notice: options.notice } : {}), dispose };
    } catch (error) {
      if (signal.aborted || error instanceof RealmEntryError) throw error;
      throw new RealmEntryError('unavailable', `Could not finish ${step}: ${realmEntryFailureMessage(error)}`);
    }
  };
  return async signal => {
    try { return await open(signal); }
    catch (error) { forgeFeed.unavailable(); throw error; }
  };
}

async function boundedBytes(response: Response, limit: number): Promise<Uint8Array> {
  if (Number(response.headers.get('Content-Length')) > limit) throw new Error('The founded scene exceeds its byte bound.');
  if (!response.body) throw new Error('The founded scene has no bytes.');
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

function readyCheckpoint(observer: RealmObserver, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const finish = (error?: Error) => { clearTimeout(timer); unsubscribe(); signal.removeEventListener('abort', aborted); if (error) reject(error); else resolve(); };
    const check = () => {
      const now = observer.current();
      if (now.status === 'ready') finish();
      else if (now.status === 'mismatch' || now.status === 'unavailable' || now.status === 'disposed') finish(new RealmEntryError('unavailable', 'The kingdom’s current streets could not be confirmed.'));
    };
    const aborted = () => finish(new DOMException('Entry was cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(new RealmEntryError('unavailable', 'The kingdom’s current streets did not arrive.')), 15_000);
    unsubscribe = observer.subscribe({ status: check, presence: check });
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted(); else check();
  });
}
