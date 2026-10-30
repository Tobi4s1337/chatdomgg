import { createServer as createNetServer } from 'node:net';
import { performance } from 'node:perf_hooks';
import { afterAll, expect, it, vi } from 'vitest';
import type { Room } from '@colyseus/sdk';
import type { KingdomId } from '@chatdom/shared';
import { KingdomRoomState, RealmIntentSchema, type CommittedForgeAttachment, type RealmPrivateMessage, type RealmPublicDelivery,
  type RealmPublicMessage, type WalkInput } from '@chatdom/shared/realm';
import { createRealmState } from '@chatdom/world/realm';
import { WALK_SPEED } from '@chatdom/world/movement';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import { createRealmServer } from '../server';
import { REFERENCE_KINGDOM, referenceServices } from '../reference';
import { REALM_LIMITS } from '../limits';
import { createDurableRealmServices, type DurableRepository, type RealmDatabase, type RealmOutboxRow } from '../persistence';
import type { RealmOutboxStore } from '../outbox';
import { RealmDiagnostics, RealmReadiness, closeReason, databaseProbe, holdEntry, mountDiagnosticsRoutes, writerProbe } from './index';

// The SDK picks Node's built-in WebSocket when present, once, as it loads. This test loads it with `ws` instead, whose
// public pause() makes a client that really stops reading, so the server's buffers fill as behind a stalled phone.
const native = vi.hoisted(() => { const ws = globalThis.WebSocket; Reflect.deleteProperty(globalThis, 'WebSocket'); return ws; });
const { Client } = await import('@colyseus/sdk');
globalThis.WebSocket = native; // the server side (Colyseus core) reads the global itself
type SdkRoom = Room<KingdomRoomState>;
/** JSON bytes: an upper bound for the msgpack frame the SDK actually sends. */
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate: () => boolean, ms = 8_000, what = 'condition') {
  const end = Date.now() + ms;
  while (!predicate()) { if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`); await sleep(20); }
}
const cleanup: (() => Promise<unknown> | unknown)[] = [];
afterAll(async () => {
  for (const step of cleanup.reverse()) await step();
});

/**
 * Storage the test can stall. It commits what it is handed and nothing else: decisions, fencing and recovery are
 * proven against real Postgres in postgres.integration.test.ts. Here only the ceilings above the store are measured.
 */
function stallableStore(kingdomId: KingdomId) {
  let sequence = 0, stall: { promise: Promise<void>; release: () => void } | null = null;
  const rows: RealmOutboxRow[] = [], staged: RealmPublicMessage[] = [];
  const stalled = async () => { while (stall) await stall.promise; };
  const state = () => ({ ...createRealmState(kingdomId, 'simulated'), sequence });
  const repository: DurableRepository = {
    leaseMs: 15_000,
    acquire: async () => ({ kingdomId, epoch: 'e'.repeat(64), expiresAt: Date.now() + 15_000 }),
    renew: async lease => ({ ...lease, expiresAt: Date.now() + 15_000 }),
    release: async () => {},
    load: async () => state(), committedState: () => state(),
    execute: async () => {
      await stalled();
      sequence++;
      for (const message of staged.splice(0)) rows.push({ id: rows.length + 1, sequence, eventId: `${kingdomId}:${sequence}:${rows.length}`, plotId: message.type === 'home' ? message.plotId : null, message });
      return { status: 'committed', sequence, at: Date.now() };
    },
    lookup: async () => null, loadIngress: async () => null, snapshot: async () => sequence,
    executeIngress: async () => ({ status: 'unchanged', reason: 'not used here' }),
  };
  const outbox: RealmOutboxStore = {
    open: async () => 0, acknowledge: async () => {},
    prefix: async () => ({ homes: [], presence: null, sequence: 0, committed: 0 }),
    read: async (_kingdom, after, limit = REALM_LIMITS.delivery.outboxBatch) => rows.filter(r => r.id > after).slice(0, limit),
  };
  const db = { query: async () => { await stalled(); return { rows: [], rowCount: 0 }; } } as unknown as Pick<RealmDatabase, 'query'>;
  return {
    repository, outbox, db, rows,
    stage: (messages: readonly RealmPublicMessage[]) => { staged.push(...messages); },
    stall() { let release!: () => void; const promise = new Promise<void>(done => { release = done; }); stall = { promise, release }; },
    release() { const current = stall; stall = null; current?.release(); },
  };
}

/** A public home row as large as a well-decorated house: 48 committed attachments (~48 KiB on the wire). */
function bigHome(n: number): RealmPublicMessage {
  const attachment = (i: number): CommittedForgeAttachment => ({ version: 1, id: `run:${n}:${i}`, runId: `run:${n}:${i}`, kingdomId: REFERENCE_KINGDOM, slot: n % 64,
    hostId: `host:${n}`, hostFingerprint: 'f'.repeat(64), socketId: `socket-${i}`, origin: [i, 24, -i], kitId: 'hearth', kitRevision: 1, family: 'hearth',
    draft: { plan: { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' }, title: `A sleeping dragon ${'·'.repeat(120)}`, plaque: `Warm dreams ${'~'.repeat(400)}` },
    provenance: { source: 'simulated', makerName: 'SIMULATED maker', kingdomName: 'SIMULATED kingdom', designId: `design:${n}:${i}` } } as unknown as CommittedForgeAttachment);
  return { type: 'home', plotId: `plot:limits:${n % 32}`, revision: `rev:${n}`, assetHash: 'a'.repeat(64), attachments: Array.from({ length: 48 }, (_, i) => attachment(i)) };
}

const observe = { type: 'stream.observe', sessionId: null, startedAt: 0, liveUntil: 0 } as const;

it('R9: a flood, a stalled reader and a stalled store each meet a finite ceiling, and the measured marks stay under it', async () => {
  const probe = createNetServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address(); if (!address || typeof address === 'string') throw new Error('No test port');
  const port = address.port; await new Promise<void>(resolve => probe.close(() => resolve()));

  const reference = referenceServices(), store = stallableStore(REFERENCE_KINGDOM);
  let sessionStall: Promise<void> | null = null, releaseSession = () => {};
  const auth = { authenticate: reference.auth.authenticate, current: async (principal: Parameters<typeof reference.auth.current>[0], now: number) => {
    if (sessionStall) await sessionStall;
    return reference.auth.current(principal, now);
  } };
  const diagnostics = new RealmDiagnostics();
  const kingdoms = () => services.kingdoms.values();
  const readiness = new RealmReadiness([databaseProbe(store.db), writerProbe(kingdoms)], { probeEveryMs: 200, probeTimeoutMs: 300, holdAfterFailures: 2 });
  const held = () => readiness.held();
  const services = createDurableRealmServices({
    repository: store.repository, outbox: store.outbox, auth: holdEntry(auth, held), hold: held,
    kingdom: () => ({ world: REFERENCE_WORLD, layoutRevision: 'reference-court-v1', spawn: (_principal, arrival) => [-12 + arrival * 3, 0, 8] as const }),
    attach: kingdom => kingdom.onClosed(reason => diagnostics.writerClosed(kingdom, reason)),
  });
  const { server, transport } = createRealmServer(services, diagnostics);
  mountDiagnosticsRoutes(transport.app, readiness, diagnostics, kingdoms);
  await server.listen(port, '127.0.0.1');
  await readiness.start();
  cleanup.push(() => server.gracefullyShutdown(false), () => readiness.stop(), () => diagnostics.stop(), () => { store.release(); releaseSession(); });
  const endpoint = `http://127.0.0.1:${port}`, client = new Client(endpoint);
  const join = async () => {
    const room = await client.joinOrCreate<KingdomRoomState>('kingdom', reference.issue(), KingdomRoomState);
    room.reconnection.enabled = false;
    room.onMessage('world', () => {}); room.onMessage('private', () => {});
    cleanup.push(() => room.leave().catch(() => {}));
    await waitFor(() => room.state.walkers.has(room.sessionId), 8_000, 'own walker');
    return room;
  };
  const ended = (room: SdkRoom) => new Promise<number>(resolve => { room.onLeave(code => resolve(code)); room.onDrop(code => resolve(code)); });
  const kingdom = () => services.kingdoms.get(REFERENCE_KINGDOM)!;

  // 1. Input flood inside the frame budget: ~75 inputs/s for 1.5 s. Walking still integrates once per 30 Hz tick.
  const walker = await join(), self = walker.sessionId;
  const world: RealmPublicDelivery[] = [];
  walker.onMessage('world', (delivery: RealmPublicDelivery) => { world.push(delivery); });
  const input = walker.input<WalkInput>({ mode: 'reliable' });
  const started = performance.now();
  let sent = 0;
  while (performance.now() - started < 1_500) {
    Object.assign(input.data, { moveX: 127, moveZ: 0, buttons: 0, yaw: 64, collisionRevision: 1 }); input.send(); sent++;
    await sleep(12);
  }
  const flooded = performance.now() - started;
  await sleep(600); // the bounded buffer (8) drains in under 300 ms; two more patches bring the result.
  const window = flooded + 600;
  const distance = walker.state.walkers.get(self)!.distance;
  const bound = (Math.ceil(window / 1000 * REALM_LIMITS.room.walkHz) + 1) * WALK_SPEED / REALM_LIMITS.room.walkHz;
  expect(sent / (flooded / 1000)).toBeGreaterThan(55); // genuinely above 30 Hz
  expect(sent / (flooded / 1000)).toBeLessThan(REALM_LIMITS.room.messagesPerSecond);
  expect(distance).toBeLessThanOrEqual(bound);
  expect(distance).toBeLessThan(sent * WALK_SPEED / REALM_LIMITS.room.walkHz * 0.8); // a drain-everything loop would integrate every sent input
  expect(distance).toBeGreaterThan(WALK_SPEED * flooded / 1000 * 0.6);
  expect(diagnostics.report().highWater.inputQueue.value).toBe(REALM_LIMITS.room.inputBuffer);

  // 2. An abusive sender: 300 frames at once. Colyseus closes it at the 91st within a second (4002); no seat is kept.
  const abuser = await join(), abuserToken = abuser.reconnectionToken, abuserEnded = ended(abuser);
  const flood = abuser.input<WalkInput>({ mode: 'reliable' });
  for (let n = 0; n < 300; n++) { Object.assign(flood.data, { moveX: 127, moveZ: 0, buttons: 2, yaw: 64, collisionRevision: 1 }); flood.send(); }
  expect(await abuserEnded).toBe(4002);
  await expect(client.reconnect(abuserToken, KingdomRoomState)).rejects.toThrow();
  await waitFor(() => !walker.state.walkers.has(abuser.sessionId), 4_000, 'abuser removed');

  // 3. Frames: the largest legitimate intent fits easily in 16 KiB; a frame past it closes that socket before buffering.
  const largest = RealmIntentSchema.parse({ version: 1, id: 'i'.repeat(128), type: 'build.publish', plotId: 'p'.repeat(128), revision: Number.MAX_SAFE_INTEGER, name: '𝒞'.repeat(80) });
  expect(bytes(['intent', largest])).toBeLessThan(REALM_LIMITS.transport.maxPayloadLength / 8);
  const sender = await join(), senderEnded = ended(sender), receipts: RealmPrivateMessage[] = [];
  sender.onMessage('private', (message: RealmPrivateMessage) => { receipts.push(message); });
  sender.send('intent', largest);
  await waitFor(() => receipts.length === 1, 4_000, 'receipt for the largest intent');
  sender.send('intent', { ...largest, name: 'x'.repeat(REALM_LIMITS.transport.maxPayloadLength) });
  expect(closeReason(await senderEnded)).toMatch(/frame-too-large|connection-lost/);

  // 4. A reader that stops reading while public deliveries keep coming. Its buffer never passes 1 MiB plus one frame:
  //    uWS drops the send and closes it. Healthy walkers receive every row; the stalled one reconnects to full state.
  const reader = await join(), readerToken = reader.reconnectionToken, readerId = reader.sessionId, readerEnded = ended(reader);
  const socket = (reader.connection.transport as unknown as { ws: { pause(): void; resume(): void } }).ws;
  socket.pause();
  let pushed = 0, burst = 0;
  while (diagnostics.report().refused.droppedSends === 0 && pushed < 48 * 1024 * 1024) {
    const rows = Array.from({ length: 8 }, () => bigHome(burst++));
    pushed += rows.reduce((n, row) => n + bytes(row), 0);
    store.stage(rows);
    await kingdom().execute(`burst:${burst}`, observe, 'presence');
    await sleep(40);
  }
  expect(diagnostics.report().refused.droppedSends).toBeGreaterThan(0);
  await waitFor(() => world.length === store.rows.length, 8_000, 'every row at the healthy walker');
  expect(world.map(d => d.cursor)).toEqual(store.rows.map(r => r.id));
  await waitFor(() => (diagnostics.report().closes['drop:connection-lost'] ?? 0) > 0, 4_000, 'the stalled reader closed');
  socket.resume();
  expect(await readerEnded).toBeGreaterThan(1000);
  const resumed = await client.reconnect<KingdomRoomState>(readerToken, KingdomRoomState);
  cleanup.push(() => resumed.leave().catch(() => {}));
  expect(resumed.sessionId).toBe(readerId);
  await waitFor(() => resumed.state.factSequence === walker.state.factSequence && resumed.state.walkers.size === walker.state.walkers.size, 6_000, 'full state after reconnect');
  const marks = diagnostics.report().highWater;
  expect(marks.socketBackpressureBytes.value).toBeGreaterThan(REALM_LIMITS.transport.maxBackpressure / 2);
  expect(marks.socketBackpressureBytes.value).toBeLessThanOrEqual(REALM_LIMITS.transport.maxBackpressure + 64 * 1024);
  expect(marks.outboxBatch.value).toBeLessThanOrEqual(REALM_LIMITS.delivery.outboxBatch);

  // 5. Storage stops answering. The writer queue holds 64 commands, refuses the 65th at once, and refuses the waiting
  //    ones unstarted after 10 s. Readiness turns the store unready, new owned work and new arrivals are held with a
  //    reason, /healthz stays alive, and people already inside keep walking: walking needs no store.
  store.stall();
  const first = kingdom().execute('stalled:0', observe, 'presence');
  const queuedAt = performance.now();
  const queued = Array.from({ length: REALM_LIMITS.writer.pendingCommands - 1 }, (_, n) =>
    kingdom().execute(`stalled:${n + 1}`, observe, 'presence').then(() => null, (error: Error & { code?: string }) => ({ code: error.code, at: performance.now() })));
  await expect(kingdom().execute('one-too-many', observe, 'presence')).rejects.toMatchObject({ code: 'realm.busy' });
  expect(kingdom().commands).toMatchObject({ pending: REALM_LIMITS.writer.pendingCommands, highWater: REALM_LIMITS.writer.pendingCommands });
  await waitFor(() => readiness.held() !== null, 4_000, 'readiness to hold');
  await expect(kingdom().execute('while-held', observe, 'presence')).rejects.toMatchObject({ code: 'realm.held' });
  await expect(client.joinOrCreate('kingdom', reference.issue(), KingdomRoomState)).rejects.toThrow(/not taking new arrivals while the realm database is not answering/);
  const ready = await fetch(`${endpoint}/readyz`), body = await ready.json() as { ready: boolean; held: string; dependencies: { database: { ready: boolean; reason: string } }; limits: unknown };
  expect(ready.status).toBe(503);
  expect(body).toMatchObject({ ready: false, held: 'the realm database is not answering', dependencies: { database: { ready: false, reason: 'no answer within 300 ms' } } });
  expect((await fetch(`${endpoint}/healthz`)).status).toBe(200);
  const before = walker.state.walkers.get(self)!.x;
  for (let n = 0; n < 12; n++) { Object.assign(input.data, { moveX: -127, moveZ: 0, buttons: 0, yaw: 64, collisionRevision: 1 }); input.send(); await sleep(34); }
  await waitFor(() => walker.state.walkers.get(self)!.x < before - 0.5, 4_000, 'walking while storage is held');
  const refused = await Promise.all(queued);
  expect(refused.every(r => r?.code === 'realm.busy')).toBe(true);
  const waited = Math.min(...refused.map(r => r!.at - queuedAt));
  expect(waited).toBeGreaterThanOrEqual(REALM_LIMITS.writer.queueWaitMs - 100);
  expect(Math.max(...refused.map(r => r!.at - queuedAt))).toBeLessThan(REALM_LIMITS.writer.queueWaitMs + 2_000);
  expect(kingdom().commands.refused).toMatchObject({ busy: 1, held: 1, expired: REALM_LIMITS.writer.pendingCommands - 1 });
  store.release();
  await expect(first).resolves.toMatchObject({ status: 'committed' });
  await waitFor(() => readiness.report().ready, 4_000, 'readiness to recover');
  await expect(kingdom().execute('after', observe, 'presence')).resolves.toMatchObject({ status: 'committed' });

  // 6. The session service stops answering. One action per walker is in flight; the next is answered `held` at once,
  //    and the session recheck holds walking after 3 s and ends the entry after 15 s instead of letting it act unchecked.
  let release!: () => void;
  sessionStall = new Promise<void>(done => { release = done; }); releaseSession = () => { sessionStall = null; release(); };
  const walkerEnded = ended(walker), answers: RealmPrivateMessage[] = [];
  walker.onMessage('private', (message: RealmPrivateMessage) => { answers.push(message); });
  for (const id of ['wish:1', 'wish:2', 'wish:3']) walker.send('intent', { version: 1, id, type: 'forge.wish', words: 'a lantern' });
  await waitFor(() => answers.length === 2, 4_000, 'held receipts');
  expect(answers.map(a => a.type === 'receipt' ? [a.receipt.id, a.receipt.status] : null)).toEqual([['wish:2', 'held'], ['wish:3', 'held']]);
  expect(await walkerEnded).toBe(4503);
  releaseSession();

  const report = diagnostics.report(kingdoms());
  expect(report.highWater.actionsPerWalker).toEqual({ value: 1, limit: REALM_LIMITS.room.actionsPerWalker });
  expect(report.refused.actionsHeld).toBe(2);
  for (const reason of Object.keys(report.closes)) expect(reason).toMatch(/^(drop|leave):(left|normal|going-away|connection-lost|frame-too-large|server-shutdown|protocol-or-rate|entry-ended|reconnect-failed|other)$/);
  expect(report.closes).toMatchObject({ 'drop:protocol-or-rate': 1 });
  // One line of measured evidence for the lane log. Counts and categories only.
  console.info(`[realm limits] SIMULATED ${JSON.stringify({ sentPerSecond: Math.round(sent / (flooded / 1000)), distance: +distance.toFixed(3), bound: +bound.toFixed(3),
    pushedBytes: pushed, deliveredRows: world.length, queueWaitMs: Math.round(waited), ...report })}`);
}, 60_000);
