import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, type KingdomPresenceFrame } from '@chatdom/shared';
import type { CommittedForgeAttachment, RealmBootstrap, RealmPublicDelivery, RealmPublicMessage } from '@chatdom/shared/realm';
import { observeRealm, type RealmObservedRoom } from './observer';
import { observeForgeActivity } from './forge';
import { createRoomPresenceFeed } from './presence';
import { createRealmIntents } from './intents';

const K = KingdomIdSchema.parse('999000777'), HASH = 'a'.repeat(64);
function fakeRoom() {
  const handlers = new Map<string, Set<(payload: never) => void>>(), sent: { type: string; payload?: unknown }[] = [];
  const room: RealmObservedRoom = {
    onMessage(type, callback) { const set = handlers.get(type) ?? new Set(); set.add(callback); handlers.set(type, set); return () => { set.delete(callback); }; },
    send(type, payload) { sent.push({ type, payload }); },
  };
  const emit = (type: string, payload: unknown) => { for (const h of handlers.get(type) ?? []) h(payload as never); };
  return { room, sent, emit };
}
const frame = (sequence: number, present: boolean, epoch = 'w1'): KingdomPresenceFrame => ({ version: 1, kingdomId: K, epoch, sequence, asOf: Date.now(), origin: 'simulated',
  streamLive: true, connection: 'fresh', windows: [{ slot: 3, present, publicName: present ? 'Juniper' : null, since: Date.now() - 1000 }] });
const boot = (throughCursor: number, current: RealmPublicMessage[], writerEpoch = 'epoch-1', collisionRevision = 1, throughSequence = throughCursor): RealmBootstrap =>
  ({ version: 1, kingdomId: K, writerEpoch, throughSequence, throughCursor, layoutRevision: 'layout-1', collisionRevision, current });
const deliver = (cursor: number, eventId: string, message: RealmPublicMessage, writerEpoch = 'epoch-1', sequence = cursor): RealmPublicDelivery =>
  ({ version: 1, kingdomId: K, writerEpoch, sequence, cursor, eventId, message });
const home = (revision: string, attachments: CommittedForgeAttachment[] = [], plotId = 'plot-3'): RealmPublicMessage => ({ type: 'home', plotId, revision, assetHash: HASH, attachments });
const committed = (attachment: CommittedForgeAttachment): RealmPublicMessage => ({ type: 'forge', event: { type: 'committed', activityId: attachment.runId, attachment } });
const part = (id: string, socketId = 'roof'): CommittedForgeAttachment => ({ version: 1, id, runId: `run-${id}`, kingdomId: K, slot: 3, hostId: 'home-3', hostFingerprint: 'f'.repeat(64),
  socketId, origin: [0, 4, 0], kitId: 'kit', kitRevision: 1, family: 'hearth', committedAt: 1, draft: { plan: { version: 2, kind: 'lantern', motif: 'sleeping-dragon', finish: 'native', accent: 'none' }, title: 'Lantern', plaque: 'Made in a SIMULATED room.' },
  provenance: { source: 'simulated', makerName: 'Juniper', kingdomName: 'SIMULATED', designId: `design-${id}`, firstForgedAt: 1 } });
const expected = { kingdomId: K, origin: 'simulated' as const, collisionRevision: 1, layoutRevision: 'layout-1' };

describe('buffered room checkpoint installation', () => {
  it('shows only live validated transient Forge stages and never treats them as a committed attachment', () => {
    const { room, emit } = fakeRoom(), observer = observeRealm(room, expected), stages: string[] = [], parts: string[] = [];
    observeForgeActivity(observer, { stage: (id, stage) => stages.push(`${id}:${stage}`), committed: part => parts.push(part.id) });
    const stage = { type: 'forge', event: { type: 'stage', activityId: 'run-live', stage: 'drafting' } };
    emit('transient', stage); expect(stages).toEqual([]);
    emit('bootstrap', boot(0, []));
    emit('transient', stage);
    emit('transient', { type: 'forge', event: { ...stage.event, stage: 'approved' } });
    emit('transient', committed(part('uncommitted')));
    expect(stages).toEqual(['run-live:drafting']); expect(parts).toEqual([]);
    observer.unavailable(); emit('transient', stage); expect(stages).toHaveLength(1); observer.dispose();
  });
  it('buffers deliveries before bootstrap, discards those at or below its cursor and applies newer ones in cursor order', () => {
    const { room, sent, emit } = fakeRoom();
    const observer = observeRealm(room, expected), frames: [number, string][] = [], revisions: [string, string][] = [];
    observer.subscribe({ presence: (f, cause) => frames.push([f.sequence, cause]), home: (h, cause) => revisions.push([h.revision, cause]) });
    expect(sent).toEqual([{ type: 'bootstrap' }]);
    // Arrival order is not cursor order; the bootstrap at cursor 10 already holds r10 and frame 5.
    emit('world', deliver(13, 'home:13', home('r13')));
    emit('world', deliver(9, 'presence:9', { type: 'presence', frame: frame(4, false) }));
    emit('world', deliver(11, 'home:11', home('r11')));
    emit('world', deliver(12, 'presence:12', { type: 'presence', frame: frame(6, true) }));
    emit('world', deliver(10, 'home:10', home('r10')));
    expect(observer.current()).toMatchObject({ status: 'installing', cursor: -1, writerEpoch: null });
    emit('bootstrap', boot(10, [home('r10'), { type: 'presence', frame: frame(5, false) }]));
    expect(revisions).toEqual([['r10', 'bootstrap'], ['r11', 'delivery'], ['r13', 'delivery']]);
    expect(frames).toEqual([[5, 'bootstrap'], [6, 'delivery']]);
    expect(observer.current()).toMatchObject({ status: 'ready', writerEpoch: 'epoch-1', cursor: 13 });
    expect(observer.current().homes.get('plot-3')?.revision).toBe('r13');
    expect(sent).toHaveLength(1);
  });

  it('orders rows that share one fact sequence by cursor, across the bootstrap overlap', () => {
    const { room, emit } = fakeRoom();
    const observer = observeRealm(room, expected), rituals: string[] = [], frames: number[] = [];
    observeForgeActivity(observer, { committed: a => rituals.push(a.id) });
    observer.subscribe({ presence: (f, cause) => { if (cause === 'delivery') frames.push(f.sequence); } });
    // Fact 7 published a home, a part and a frame as rows 19, 20 and 21; the checkpoint reached row 20.
    emit('world', deliver(19, 'fact:7:0', home('r7'), 'epoch-1', 7));
    emit('world', deliver(20, 'fact:7:1', committed(part('p7')), 'epoch-1', 7));
    emit('world', deliver(21, 'fact:7:2', { type: 'presence', frame: frame(8, true) }, 'epoch-1', 7));
    emit('bootstrap', boot(20, [home('r7', [part('p7')])], 'epoch-1', 1, 7));
    expect(rituals).toEqual([]);
    expect(frames).toEqual([8]);
    expect(observer.current().cursor).toBe(21);
    // A later row at the same fact sequence is still new; one at or below the cursor is not.
    emit('world', deliver(22, 'fact:7:3', committed(part('q7', 'door')), 'epoch-1', 7));
    emit('world', deliver(21, 'fact:7:4', committed(part('r7', 'door')), 'epoch-1', 7));
    expect(rituals).toEqual(['q7']);
    expect(observer.current().cursor).toBe(22);
  });

  it('lets zero-fact presence advance the cursor and treats cursor, fact and frame jumps as normal', () => {
    const { room, sent, emit } = fakeRoom();
    const observer = observeRealm(room, expected), frames: number[] = [];
    observer.subscribe({ presence: (f, cause) => { if (cause === 'delivery') frames.push(f.sequence); } });
    emit('bootstrap', boot(30, [{ type: 'presence', frame: frame(2, false) }], 'epoch-1', 1, 7));
    // Two presence rows with no new domain fact: same fact sequence, new cursors, frame revisions far apart.
    emit('world', deliver(31, 'presence:31', { type: 'presence', frame: frame(9, true) }, 'epoch-1', 7));
    emit('world', deliver(32, 'presence:32', { type: 'presence', frame: frame(40, false) }, 'epoch-1', 7));
    expect(observer.current().cursor).toBe(32);
    // Private facts 8–14 and other kingdoms' rows leave holes in both numbers; nothing was lost.
    emit('world', deliver(57, 'fact:15:0', home('r15'), 'epoch-1', 15));
    emit('world', deliver(90, 'presence:90', { type: 'presence', frame: frame(41, true) }, 'epoch-1', 15));
    expect(frames).toEqual([9, 40, 41]);
    expect(observer.current()).toMatchObject({ status: 'ready', cursor: 90 });
    expect(observer.current().homes.get('plot-3')?.revision).toBe('r15');
    expect(sent).toHaveLength(1);
  });

  it('ignores a redelivered event ID and an unseen row at or below the cursor', () => {
    const { room, emit } = fakeRoom();
    const observer = observeRealm(room, expected), rituals: string[] = [], homes: string[] = [];
    observeForgeActivity(observer, { committed: a => rituals.push(a.id) });
    observer.subscribe({ home: (h, cause) => { if (cause === 'delivery') homes.push(h.revision); } });
    emit('bootstrap', boot(4, []));
    emit('world', deliver(5, 'fact:5:0', committed(part('lamp'))));
    emit('world', deliver(6, 'fact:6:0', home('r6')));
    // At-least-once: the writer resends after a lost acknowledgement, with the original IDs and cursors.
    emit('world', deliver(5, 'fact:5:0', committed(part('lamp'))));
    emit('world', deliver(6, 'fact:6:0', home('r6')));
    // A seen ID never applies twice, even if a confused relay stamps it higher.
    emit('world', deliver(9, 'fact:6:0', home('r6-again')));
    emit('world', deliver(6, 'fact:6:1', home('r6-late')));
    expect(rituals).toEqual(['lamp']);
    expect(homes).toEqual(['r6']);
    expect(observer.current()).toMatchObject({ status: 'ready', cursor: 6 });
    expect(observer.current().homes.get('plot-3')?.revision).toBe('r6');
  });

  it('remembers the last 1,024 event IDs; the cursor still holds back older rows', () => {
    const { room, emit } = fakeRoom();
    const observer = observeRealm(room, expected), homes: string[] = [];
    observer.subscribe({ home: (h, cause) => { if (cause === 'delivery') homes.push(h.revision); } });
    emit('bootstrap', boot(0, []));
    for (let i = 1; i <= 1_100; i++) emit('world', deliver(i, `fact:${i}:0`, home(`r${i}`)));
    emit('world', deliver(1, 'fact:1:0', home('r1')));
    emit('world', deliver(1_100, 'fact:1100:0', home('r1100')));
    expect(homes).toHaveLength(1_100);
    expect(observer.current().cursor).toBe(1_100);
  });

  it('a writer change holds effects and installs a fresh checkpoint without replaying its rituals', () => {
    const { room, sent, emit } = fakeRoom();
    const observer = observeRealm(room, expected), rituals: string[] = [], restored: string[][] = [], statuses: string[] = [];
    observeForgeActivity(observer, { committed: a => rituals.push(a.id), restored: parts => restored.push(parts.map(p => p.id).sort()) });
    observer.subscribe({ status: s => statuses.push(s) });
    emit('bootstrap', boot(40, [home('r1', [part('a')])]));
    emit('world', deliver(41, 'fact:9:0', { type: 'presence', frame: frame(3, true) }));
    expect(observer.current().cursor).toBe(41);
    // The new writer's first row arrives before anyone has its checkpoint: hold, ask, apply nothing.
    emit('world', deliver(70, 'fact:12:0', committed(part('b', 'door')), 'epoch-2', 12));
    expect(observer.current().status).toBe('resyncing');
    expect(sent).toHaveLength(2);
    expect(rituals).toEqual([]);
    expect(observer.current().presence?.windows[0]?.present).toBe(true);
    // While installing, the new writer redelivers rows already in its checkpoint and sends one newer row.
    emit('world', deliver(70, 'fact:12:0', committed(part('b', 'door')), 'epoch-2', 12));
    emit('world', deliver(72, 'fact:13:0', committed(part('c', 'chimney')), 'epoch-2', 13));
    emit('world', deliver(42, 'fact:10:0', home('r-stale'), 'epoch-1', 10));
    emit('bootstrap', boot(71, [home('r2', [part('a'), part('b', 'door')]), { type: 'presence', frame: frame(4, false) }], 'epoch-2', 1, 12));
    expect(observer.current()).toMatchObject({ status: 'ready', writerEpoch: 'epoch-2', cursor: 72 });
    expect(restored).toEqual([['a'], ['a', 'b']]);
    expect(rituals).toEqual(['c']);
    // The old writer is gone for good: its late rows and a late answer from it change nothing and ask for nothing.
    emit('world', deliver(43, 'fact:11:0', home('r-old'), 'epoch-1', 11));
    emit('bootstrap', boot(43, [home('r-old')]));
    expect(observer.current()).toMatchObject({ status: 'ready', writerEpoch: 'epoch-2', cursor: 72 });
    expect(observer.current().homes.get('plot-3')?.revision).toBe('r2');
    expect(sent).toHaveLength(2);
    expect(statuses).toEqual(['ready', 'resyncing', 'ready']);
  });

  it('fails closed on a different collision or layout revision', () => {
    const { room, emit } = fakeRoom(), statuses: string[] = [];
    const observer = observeRealm(room, expected);
    const feed = createRoomPresenceFeed(observer, 'simulated');
    let unavailable = 0;
    feed.subscribe(() => {}, () => { unavailable++; });
    observer.subscribe({ status: s => statuses.push(s) });
    emit('bootstrap', boot(1, [{ type: 'presence', frame: frame(1, true) }], 'epoch-1', 2));
    expect(observer.current().status).toBe('mismatch');
    expect(observer.current().presence).toBeNull();
    expect(unavailable).toBe(1);
    expect(statuses).toEqual(['mismatch']);
    const other = fakeRoom(), layout = observeRealm(other.room, expected);
    other.emit('bootstrap', { ...boot(1, []), layoutRevision: 'layout-2' });
    expect(layout.current().status).toBe('mismatch');
    other.emit('bootstrap', boot(1, []));
    expect(layout.current().status).toBe('mismatch');
  });

  it('refuses a checkpoint without a delivery cursor', () => {
    const { room, emit } = fakeRoom();
    const observer = observeRealm(room, expected);
    const legacy: Record<string, unknown> = { ...boot(5, [{ type: 'presence', frame: frame(5, true) }]) };
    delete legacy.throughCursor;
    emit('bootstrap', legacy);
    expect(observer.current()).toMatchObject({ status: 'installing', presence: null, cursor: -1 });
    emit('bootstrap', boot(5, [{ type: 'presence', frame: frame(5, true) }]));
    expect(observer.current()).toMatchObject({ status: 'ready', cursor: 5 });
  });

  it('restores standing parts quietly and celebrates only a newly committed one, once', () => {
    const { room, emit } = fakeRoom();
    const observer = observeRealm(room, expected), restored: string[][] = [], rituals: string[] = [];
    observeForgeActivity(observer, { restored: parts => restored.push(parts.map(p => p.id)), committed: a => rituals.push(a.id) });
    emit('bootstrap', boot(10, [home('r10', [part('old')])]));
    expect(restored).toEqual([['old']]);
    emit('world', deliver(9, 'fact:9:0', committed(part('x'))));
    emit('world', deliver(11, 'fact:11:0', committed(part('old'))));
    emit('world', deliver(12, 'fact:12:0', committed(part('new', 'door'))));
    emit('world', deliver(12, 'fact:12:0', committed(part('new', 'door'))));
    expect(rituals).toEqual(['new']);
    expect([...observer.current().attachments.keys()].sort()).toEqual(['new', 'old']);
  });

  it('rejects a foreign kingdom or origin and labels the feed by origin', () => {
    const { room, emit } = fakeRoom();
    const observer = observeRealm(room, expected);
    emit('bootstrap', boot(1, [{ type: 'presence', frame: { ...frame(1, true), origin: 'live' } }]));
    expect(observer.current().presence).toBeNull();
    emit('world', { ...deliver(2, 'presence:2', { type: 'presence', frame: frame(2, true) }), kingdomId: '999000778' });
    expect(observer.current()).toMatchObject({ presence: null, cursor: 1 });
    expect(createRoomPresenceFeed(observer, 'simulated').label).toBe('SIMULATED');
    expect(createRoomPresenceFeed(observer, 'live').label).toBe('LIVE');
  });
});

describe('room intents', () => {
  it('matches private receipts by ID and leaves silence pending, never failed', async () => {
    const { room, sent, emit } = fakeRoom();
    const intents = createRealmIntents(room, { answerMs: 20 });
    const answered = intents.send({ version: 1, id: 'wish-1', type: 'forge.wish', words: 'a lantern' });
    emit('private', { type: 'interaction', requestId: null, writerEpoch: 'e', state: {} });
    emit('private', { type: 'receipt', receipt: { version: 1, id: 'wish-1', status: 'unavailable', message: 'The forge is cold.' } });
    expect(await answered).toEqual({ kind: 'receipt', receipt: { version: 1, id: 'wish-1', status: 'unavailable', message: 'The forge is cold.' } });
    expect(sent[0]).toMatchObject({ type: 'intent', payload: { id: 'wish-1' } });
    const late: string[] = [];
    intents.onLate(r => late.push(r.id));
    expect(await intents.send({ version: 1, id: 'wish-2', type: 'forge.wish', words: 'a bell' })).toEqual({ kind: 'pending', id: 'wish-2' });
    emit('private', { type: 'receipt', receipt: { version: 1, id: 'wish-2', status: 'committed', writerEpoch: 'e', sequence: 3 } });
    expect(late).toEqual(['wish-2']);
    expect(() => intents.send({ version: 1, id: 'x', type: 'forge.wish', words: 'a', ownerId: '1' } as never)).toThrow();
  });
});
