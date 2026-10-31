import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { type KingdomPresenceFrame } from '@chatdom/shared';
import { REALM_AUTH_ROUTES, type RealmFoundedManifest } from '@chatdom/shared/realm';
import { createLiveKingdomEntrySource } from '../../kingdom-entry/live';
import { connectRealm } from '../client';
import { type RealmChatMessage } from './chat';

vi.mock('../client', () => ({ connectRealm: vi.fn() }));
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const artifact = new URL('../../../../realm/src/founded/artifacts/', import.meta.url);
const session = { version: 1, status: 'authenticated', expiresAt: Date.now() + 60_000, resumeScope: 'opaque-rehearsal-scope', csrfToken: 'c'.repeat(40) };
const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 } as Storage;
function channel() {
  const callbacks = new Set<() => void>();
  return Object.assign((callback: () => void) => { callbacks.add(callback); }, { remove: (callback: () => void) => callbacks.delete(callback), emit: () => { for (const callback of callbacks) callback(); } });
}
function roomFixture(manifest: RealmFoundedManifest) {
  const callbacks = new Map<string, Set<(value: unknown) => void>>();
  const frame: KingdomPresenceFrame = { version: 1, kingdomId: manifest.kingdomId, origin: manifest.origin, epoch: 'presence-1', sequence: 2,
    asOf: Date.now(), streamLive: true, connection: 'fresh', windows: [{ slot: 1, since: Date.now() - 1000, present: true, publicName: 'SIMULATED visitor' }] };
  const emit = (type: string, value: unknown) => { for (const callback of callbacks.get(type) ?? []) callback(value); };
  const room = {
    state: { ...manifest, writerEpoch: 'writer-1' }, onDrop: channel(), onLeave: channel(), onReconnect: channel(),
    onMessage(type: string, callback: (value: unknown) => void) {
      const set = callbacks.get(type) ?? new Set(); set.add(callback); callbacks.set(type, set); return () => set.delete(callback);
    },
    send(type: string) {
      if (type === 'bootstrap') queueMicrotask(() => emit('bootstrap', { ...manifest, version: 1, writerEpoch: 'writer-1', throughSequence: 42,
        throughCursor: 109, current: [{ type: 'presence', frame }] }));
    },
  };
  const dispose = vi.fn();
  vi.mocked(connectRealm).mockResolvedValue({ room, dispose } as never);
  return { room, frame, emit, dispose, callbacks };
}

async function fixture() {
  const manifest = JSON.parse(await readFile(new URL('simulated-town.manifest.json', artifact), 'utf8')) as RealmFoundedManifest;
  const bytes = await readFile(new URL('simulated-town.scene.json', artifact));
  const calls: { path: string; init?: RequestInit }[] = [];
  const fetcher = async (path: string, init?: RequestInit) => {
    calls.push({ path, ...(init ? { init } : {}) });
    if (path === REALM_AUTH_ROUTES.session) return json(session);
    if (path.includes('/scenes/')) return new Response(new Uint8Array(bytes));
    return json(manifest);
  };
  return { manifest, bytes, fetcher, calls };
}

describe('checked authenticated founded entry', () => {
  it('opens the actual checked artifact, installs public cursor presence and clears transient speech and listeners on leave', async () => {
    const { manifest, bytes, fetcher, calls } = await fixture();
    const liveRoom = roomFixture(manifest), controller = new AbortController();
    const open = createLiveKingdomEntrySource({ kingdomId: manifest.kingdomId, kingdomName: 'SIMULATED Willowmere', origin: 'simulated', notice: 'SIMULATED rehearsal',
      endpoint: 'https://chatdom.test/realm-data', storage, fetcher });
    const connection = await open(controller.signal);
    expect(connection.manifest).toEqual(manifest);
    expect(connection.scene).toEqual(JSON.parse(bytes.toString()));
    expect(connection.scene.placements.length).toBeGreaterThan(900);
    expect('query' in connection.collision && connection.collision.revision).toBe(manifest.collisionRevision);
    const entry = vi.mocked(connectRealm).mock.calls.at(-1)![1];
    expect(entry.resumeScope).toBe(session.resumeScope);
    expect(calls.some(call => call.path === REALM_AUTH_ROUTES.ticket)).toBe(false);
    expect(calls.every(call => call.init?.credentials === 'same-origin' && call.init?.cache === 'no-store')).toBe(true);
    let frames = 0, unavailable = 0;
    const offPresence = connection.presenceFeed.subscribe(() => frames++, () => unavailable++);
    expect(frames).toBe(1);
    // Public cursors are sparse and independent from private fact/frame sequences.
    liveRoom.emit('world', { version: 1, kingdomId: manifest.kingdomId, writerEpoch: 'writer-1', sequence: 42, cursor: 900, eventId: 'presence:900',
      message: { type: 'presence', frame: { ...liveRoom.frame, sequence: 19 } } });
    expect(frames).toBe(2);
    const messages: RealmChatMessage[] = [];
    const offChat = (connection as typeof connection & { chatFeed: { subscribe(receive: (message: RealmChatMessage) => void): () => void } }).chatFeed.subscribe(message => messages.push(message));
    const cue = { version: 1, id: 'chat-1', kingdomId: manifest.kingdomId, epoch: liveRoom.frame.epoch, origin: 'simulated', slot: 1,
      asOf: Date.now(), expiresAt: Date.now() + 3000, parts: [{ kind: 'text', text: 'SIMULATED hello' }] };
    liveRoom.emit('transient', { type: 'chat', cue });
    liveRoom.emit('transient', { type: 'chat', cue });
    expect(messages.map(message => message.type)).toEqual(['chat']);
    liveRoom.room.onDrop.emit();
    expect(messages.at(-1)?.type).toBe('chat.clear');
    expect(unavailable).toBe(1);
    controller.abort();
    offPresence(); offChat();
    expect(liveRoom.dispose).toHaveBeenCalledOnce();
    expect([...liveRoom.callbacks.values()].every(set => set.size === 0)).toBe(true);
  }, 30_000);

  it('rejects changed exact bytes and anonymous entry without connecting to another world', async () => {
    const { manifest, bytes } = await fixture();
    vi.mocked(connectRealm).mockClear();
    const open = createLiveKingdomEntrySource({ kingdomId: manifest.kingdomId, kingdomName: 'SIMULATED Willowmere', origin: 'simulated', notice: 'SIMULATED rehearsal', storage,
      fetcher: async path => path === REALM_AUTH_ROUTES.session ? json(session) : path.includes('/scenes/') ? new Response(`${bytes.toString()} `) : json(manifest) });
    await expect(open(new AbortController().signal)).rejects.toThrow('hash');
    const anonymous = createLiveKingdomEntrySource({ kingdomId: manifest.kingdomId, kingdomName: 'Approved name', storage,
      fetcher: async () => json({ version: 1, status: 'anonymous' }) });
    await expect(anonymous(new AbortController().signal)).rejects.toMatchObject({ status: 'unauthenticated' });
    expect(connectRealm).not.toHaveBeenCalled();
  });
});
