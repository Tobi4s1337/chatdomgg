/**
 * Explicit development source: a staged rehearsal of a founded kingdom on the realm's reference room. It opens only
 * on a development machine (the public gateway also refuses `source=simulated`), so nobody on chatdom.io meets
 * staged people. Production entry is owned by realm-wiring; it never falls back here.
 */
import { KingdomPresenceFrameSchema, type PresenceFeed, type KingdomPresenceFrame } from '@chatdom/shared';
import { RealmFoundedManifestSchema, RealmJoinSchema, REALM_FOUNDED_ROUTES, type RealmBootstrap, type RealmPublicDelivery } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import { connectRealm } from '../realm/client';
import { compileFoundedScene } from '@chatdom/world/founded-collision';
import type { KingdomEntrySource } from './types';
import { observeRealm, observedRoom } from '../realm/adapters/observer';
import { createRealmForgeFeed } from '../realm/adapters/forge-feed';
import { createRoomChatFeed } from '../realm/adapters/chat';
import { RealmEntryError } from '../realm/adapters/entry';

const endpoint = () => `${location.origin}/realm-data`;
async function read(path: string, signal: AbortSignal) {
  const response = await fetch(`${endpoint()}${path}`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('The rehearsal kingdom is not open.');
  return response;
}

/** A development machine: the browser is on loopback (a local preview or bench), or this is a dev build. */
export function stagedEntryAllowed(hostname = location.hostname): boolean {
  return import.meta.env.DEV || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export const openSimulatedKingdomEntry: KingdomEntrySource = async signal => {
  if (!stagedEntryAllowed()) throw new RealmEntryError('refused', 'This rehearsal opens only on a development machine.');
  const info: { kingdomId: string; kingdomName: string; origin: string; geometry: string; notice?: string } = await (await read('/preview/entry', signal)).json();
  if (info.origin !== 'simulated' || !info.kingdomName) throw new Error('The preview must describe its staged source.');
  const manifest = RealmFoundedManifestSchema.parse(await (await read(REALM_FOUNDED_ROUTES.manifest.replace(':kingdomId', encodeURIComponent(info.kingdomId)), signal)).json());
  if (manifest.origin !== 'simulated' || manifest.kingdomId !== info.kingdomId || info.geometry !== 'founded-v1') throw new Error('The preview ground does not match its town.');
  const bytes = await (await read(REALM_FOUNDED_ROUTES.scene.replace(':sceneHash', manifest.sceneHash), signal)).arrayBuffer();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
  if (hash !== manifest.sceneHash) throw new Error('The preview town bytes have changed.');
  const scene: RealmFoundedScene = JSON.parse(new TextDecoder().decode(bytes));
  if (scene.kingdomId !== manifest.kingdomId || scene.origin !== manifest.origin || scene.layoutRevision !== manifest.layoutRevision
    || scene.collisionRevision !== manifest.collisionRevision) throw new Error('The preview scene does not match its receipt.');
  const collision = compileFoundedScene(scene);
  const scopeKey = 'chatdom:simulated-founded-scope';
  let resumeScope = sessionStorage.getItem(scopeKey);
  if (!resumeScope) { resumeScope = crypto.randomUUID(); sessionStorage.setItem(scopeKey, resumeScope); }
  signal.throwIfAborted();
  const client = await connectRealm(endpoint(), { kingdomId: manifest.kingdomId, resumeScope,
    ticket: async () => {
      const response = await fetch(`${endpoint()}/reference/session`, { method: 'POST', signal, cache: 'no-store' });
      if (!response.ok) throw new Error('The preview gate did not open.');
      return RealmJoinSchema.parse(await response.json());
    },
  }, collision, sessionStorage);
  if (signal.aborted) { client.dispose(); signal.throwIfAborted(); }
  const room = observedRoom(client.room);
  const observer = observeRealm(room, { kingdomId: manifest.kingdomId, origin: 'simulated',
    collisionRevision: manifest.collisionRevision, layoutRevision: manifest.layoutRevision });
  const forgeFeed = createRealmForgeFeed(), offForge = forgeFeed.bind(observer);
  const chatFeed = createRoomChatFeed(room, observer);
  let frame: KingdomPresenceFrame | undefined, cursor = -1, disposed = false;
  const listeners = new Set<{ receive: (frame: KingdomPresenceFrame) => void; unavailable: () => void }>();
  let ready: () => void = () => {};
  const firstFrame = new Promise<void>(resolve => { ready = resolve; });
  const accept = (value: unknown) => {
    const parsed = KingdomPresenceFrameSchema.safeParse(value);
    if (!parsed.success || parsed.data.origin !== 'simulated' || parsed.data.kingdomId !== manifest.kingdomId) return;
    frame = parsed.data; ready();
    for (const listener of listeners) listener.receive(frame);
  };
  const offBootstrap = client.room.onMessage('bootstrap', (bootstrap: RealmBootstrap) => {
    if (bootstrap.kingdomId !== manifest.kingdomId || bootstrap.writerEpoch !== client.room.state.writerEpoch
      || bootstrap.layoutRevision !== manifest.layoutRevision || bootstrap.collisionRevision !== manifest.collisionRevision) return;
    cursor = bootstrap.throughCursor;
    for (const message of bootstrap.current) if (message.type === 'presence') accept(message.frame);
  });
  const offWorld = client.room.onMessage('world', (delivery: RealmPublicDelivery) => {
    if (delivery.kingdomId !== manifest.kingdomId || delivery.writerEpoch !== client.room.state.writerEpoch || delivery.cursor <= cursor) return;
    if (cursor < 0 || delivery.cursor !== cursor + 1) { client.room.send('bootstrap'); return; }
    cursor = delivery.cursor;
    if (delivery.message.type === 'presence') accept(delivery.message.frame);
  });
  const dropped = () => { frame = undefined; for (const listener of listeners) listener.unavailable(); };
  const reconnect = () => { cursor = -1; client.room.send('bootstrap'); };
  client.room.onDrop(dropped); client.room.onLeave(dropped); client.room.onReconnect(reconnect);
  const dispose = () => {
    if (disposed) return; disposed = true; signal.removeEventListener('abort', dispose);
    offBootstrap(); offWorld(); client.room.onDrop.remove(dropped); client.room.onLeave.remove(dropped); client.room.onReconnect.remove(reconnect);
    listeners.clear(); offForge(); forgeFeed.unavailable(); chatFeed.dispose(); observer.dispose(); client.dispose();
  };
  signal.addEventListener('abort', dispose, { once: true });
  client.room.send('bootstrap');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('The preview windows did not arrive.')), 10_000); });
  try { await Promise.race([firstFrame, timeout]); signal.throwIfAborted(); }
  catch (error) { dispose(); throw error; }
  finally { clearTimeout(timer); }
  const presenceFeed: PresenceFeed = { label: 'SIMULATED', subscribe(receive, unavailable) {
    const listener = { receive, unavailable }; listeners.add(listener);
    if (frame) receive(frame); else unavailable();
    return () => listeners.delete(listener);
  } };
  return { scene, manifest, collision, client, presenceFeed, forgeFeed, chatFeed, kingdomName: info.kingdomName, ...(info.notice ? { notice: info.notice } : {}), dispose };
};
