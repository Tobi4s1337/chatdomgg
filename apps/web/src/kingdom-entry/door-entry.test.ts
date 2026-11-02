import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { REALM_AUTH_ROUTES, type RealmFoundedManifest } from '@chatdom/shared/realm';
import { connectRealm } from '../realm/client';
import { createLiveKingdomEntrySource } from './live';

// The way through a door (play SEAMS B1b): the connection lends the walk an entry and a transport, and coming back
// names the door on the first join only.
vi.mock('../realm/client', () => ({ connectRealm: vi.fn() }));
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const artifact = new URL('../../../realm/src/founded/artifacts/', import.meta.url);
const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 } as Storage;
const channel = () => Object.assign(() => {}, { remove: () => {} });

async function fixture() {
  const manifest = JSON.parse(await readFile(new URL('simulated-town.manifest.json', artifact), 'utf8')) as RealmFoundedManifest;
  const bytes = await readFile(new URL('simulated-town.scene.json', artifact));
  const session = { version: 1, status: 'authenticated', expiresAt: Date.now() + 60_000, resumeScope: 'opaque-door-scope', csrfToken: 'c'.repeat(40) };
  const calls: { path: string; signal: AbortSignal | undefined }[] = [];
  let tickets = 0;
  const fetcher = async (path: string, init?: RequestInit) => {
    calls.push({ path, signal: init?.signal ?? undefined });
    if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (path === REALM_AUTH_ROUTES.session) return json(session);
    if (path === REALM_AUTH_ROUTES.ticket) return json({ version: 1, status: 'issued', expiresAt: Date.now() + 30_000,
      join: { kingdomId: manifest.kingdomId, ticket: `ticket-${++tickets}`.padEnd(16, '-'), protocol: 1 } });
    if (path.includes('/scenes/')) return new Response(new Uint8Array(bytes));
    return json(manifest);
  };
  const room = {
    state: { ...manifest, writerEpoch: 'writer-1' }, onDrop: channel(), onLeave: channel(), onReconnect: channel(),
    onMessage(type: string, callback: (value: unknown) => void) {
      if (type === 'bootstrap') queueMicrotask(() => callback({ ...manifest, version: 1, writerEpoch: 'writer-1', throughSequence: 1, throughCursor: 1, current: [] }));
      return () => {};
    },
    send() {},
  };
  vi.mocked(connectRealm).mockReset();
  vi.mocked(connectRealm).mockResolvedValue({ room, dispose: vi.fn() } as never);
  const source = createLiveKingdomEntrySource({ kingdomId: manifest.kingdomId, kingdomName: 'Willowmere', origin: 'simulated', notice: 'SIMULATED rehearsal',
    endpoint: 'https://chatdom.test/realm-data', storage, fetcher });
  return { manifest, source, calls };
}

describe('the kingdom entry at a door', () => {
  it('names the door on the first fresh join only, and joins plainly without one', async () => {
    const { manifest, source } = await fixture();
    await source(new AbortController().signal, { portal: `tavern:${manifest.kingdomId}:door` });
    const entry = vi.mocked(connectRealm).mock.calls.at(-1)![1];
    expect(vi.mocked(connectRealm).mock.calls.at(-1)![0]).toBe('https://chatdom.test/realm-data');
    expect(entry.resumeScope).toBe('opaque-door-scope');
    const first = await entry.ticket(), again = await entry.ticket();
    expect(first.arrive).toEqual({ portal: `tavern:${manifest.kingdomId}:door` });
    expect(first.ticket).not.toBe(again.ticket);
    // A drop and a fresh join later is the gate's business, not the door's.
    expect(again.arrive).toBeUndefined();
    await source(new AbortController().signal);
    expect((await vi.mocked(connectRealm).mock.calls.at(-1)![1].ticket()).arrive).toBeUndefined();
  }, 30_000);

  it('lends the walk an entry that outlives the connection it came with', async () => {
    const { manifest, source, calls } = await fixture();
    const controller = new AbortController(), connection = await source(controller.signal);
    expect(connection.endpoint).toBe('https://chatdom.test/realm-data');
    // Going through the door ends this connection and its signal; the room behind the door still gets a ticket.
    controller.abort();
    const before = calls.length, join = await connection.entry!.ticket();
    expect(join.kingdomId).toBe(manifest.kingdomId);
    expect(join.arrive).toBeUndefined();
    const asked = calls.slice(before);
    expect(asked.map(call => call.path)).toEqual([REALM_AUTH_ROUTES.session, REALM_AUTH_ROUTES.ticket]);
    expect(asked.every(call => !call.signal?.aborted)).toBe(true);
    expect(connection.entry!.resumeScope).toBe('opaque-door-scope');
  }, 30_000);
});
