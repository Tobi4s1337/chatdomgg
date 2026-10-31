import { describe, expect, it, vi } from 'vitest';
import { KingdomIdSchema, type KingdomPresenceFrame } from '@chatdom/shared';
import type { RealmWatchCheckpoint } from '@chatdom/shared/realm';
import { createRealmWatch, type WatchEventSource } from './watch';
import { observeRealm } from './observer';
import { createRoomChatFeed } from './chat';

const kingdomId = KingdomIdSchema.parse('129634568');
const manifest = { version: 1 as const, kingdomId, origin: 'live' as const, layoutRevision: 'streets-1', collisionRevision: 1, sceneHash: 'a'.repeat(64) };
const frame = (sequence: number): KingdomPresenceFrame => ({ version: 1, kingdomId, origin: 'live', epoch: 'presence-1', sequence,
  asOf: Date.now(), streamLive: true, connection: 'fresh', windows: [{ slot: 3, present: true, publicName: 'Juniper', since: Date.now() - 1000 }] });
const checkpoint = (throughCursor = 10): RealmWatchCheckpoint => ({ version: 1, manifest, checkpoint: {
  version: 1, kingdomId, writerEpoch: 'writer-1', throughSequence: 1, throughCursor,
  layoutRevision: manifest.layoutRevision, collisionRevision: 1, current: [{ type: 'presence', frame: frame(1) }],
} });
class Source extends EventTarget implements WatchEventSource {
  closed = false;
  close() { this.closed = true; }
  emit(type: string, data: unknown) { this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) })); }
}

describe('read-only public realm watch', () => {
  it('buffers actual asset-load deltas, installs a cursor checkpoint, drops old speech and reopens for real resync', async () => {
    const sources: Source[] = [], paths: string[] = [], lost = vi.fn(), revision = vi.fn();
    const watch = createRealmWatch({ kingdomId, signal: new AbortController().signal, unavailable: lost, revision,
      source: path => { paths.push(path); const source = new Source(); sources.push(source); return source; } });
    const first = sources[0]!;
    first.emit('checkpoint', checkpoint());
    expect((await watch.checkpoint).manifest.sceneHash).toBe(manifest.sceneHash);
    const delivery = (cursor: number, sequence: number) => ({ version: 1, kingdomId, writerEpoch: 'writer-1', cursor, sequence: 1,
      eventId: `presence-${cursor}`, message: { type: 'presence', frame: frame(sequence) } });
    first.emit('world', delivery(10, 0)); first.emit('world', delivery(12, 3)); first.emit('world', delivery(11, 2));
    const cue = { version: 1, id: 'speech-old', kingdomId, origin: 'live', epoch: 'presence-1', slot: 3,
      asOf: Date.now(), expiresAt: Date.now() + 9000, parts: [{ kind: 'text', text: 'A real message' }] };
    first.emit('transient', { type: 'chat', cue });
    const observer = observeRealm(watch.room, { kingdomId, origin: 'live', collisionRevision: 1, layoutRevision: 'streets-1' });
    const chat = createRoomChatFeed(watch.room, observer), speech = vi.fn(); chat.subscribe(speech);
    await Promise.resolve();
    expect(observer.current()).toMatchObject({ status: 'ready', cursor: 12, presence: { sequence: 3 } });
    expect(speech).not.toHaveBeenCalled();
    first.emit('world', delivery(12, 9));
    expect(observer.current().presence?.sequence).toBe(3);
    first.emit('transient', { type: 'chat', cue: { ...cue, id: 'speech-new' } });
    expect(speech).toHaveBeenCalledTimes(1);
    observer.resync();
    expect(paths).toEqual(['/api/realm/watch/129634568', '/api/realm/watch/129634568']);
    expect(first.closed).toBe(true);
    expect(observer.current().status).toBe('resyncing');
    sources[1]!.emit('checkpoint', checkpoint(20));
    expect(observer.current()).toMatchObject({ status: 'ready', cursor: 20 });
    sources[1]!.emit('revision', { layoutRevision: 'streets-2', collisionRevision: 2 });
    expect(revision).toHaveBeenCalledOnce();
    chat.dispose(); observer.dispose(); watch.dispose();
    expect(sources.every(source => source.closed)).toBe(true);
    expect(lost).not.toHaveBeenCalled();
  });

  it('fails closed when public deltas exceed the bound while exact geometry is being fetched', async () => {
    const source = new Source(), unavailable = vi.fn();
    const watch = createRealmWatch({ kingdomId, signal: new AbortController().signal, source: () => source,
      unavailable, revision: vi.fn(), maxBuffered: 1 });
    source.emit('checkpoint', checkpoint()); await watch.checkpoint;
    source.emit('world', {}); source.emit('world', {});
    expect(unavailable).toHaveBeenCalledOnce(); expect(source.closed).toBe(true);
    watch.dispose();
  });
});
