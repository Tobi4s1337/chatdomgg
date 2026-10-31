import { ForgeDraftSchema, KingdomPresenceFrameSchema, type KingdomId, type KingdomPresenceFrame } from '@chatdom/shared';
import { ForgeTransientActivitySchema, REALM_CASTLE_SLOT, type CommittedForgeAttachment, type ForgeActivity, type KingdomRoomState, type RealmPublicDelivery } from '@chatdom/shared/realm';
import type { Room } from '@colyseus/sdk';

/** The slice of a Colyseus room these adapters need. Use `observedRoom` for an actual SDK room. */
export interface RealmObservedRoom {
  onMessage(type: string, callback: (payload: never) => void): () => void;
  send(type: string, payload?: unknown): void;
}
export function observedRoom(room: Room<KingdomRoomState>): RealmObservedRoom {
  return { onMessage: (type, callback) => room.onMessage(type, callback), send: (type, payload) => room.send(type, payload) };
}
export interface RealmObserverExpectation {
  readonly kingdomId: KingdomId;
  readonly origin: 'live' | 'simulated';
  /** The collision world the browser walks on; the room must be on the same revision. */
  readonly collisionRevision: number;
  readonly layoutRevision?: string;
}
export interface RealmHomeView {
  readonly plotId: string; readonly revision: string; readonly assetHash: string;
  readonly attachments: readonly CommittedForgeAttachment[];
}
export interface RealmCastleView {
  readonly moduleId: string; readonly revision: string; readonly assetHash: string;
  readonly attachments: readonly CommittedForgeAttachment[];
}
export type RealmObserverStatus = 'installing' | 'ready' | 'resyncing' | 'mismatch' | 'unavailable' | 'disposed';
/** `bootstrap` restores present state quietly; only `delivery` is something happening now. */
export type RealmObservationCause = 'bootstrap' | 'delivery';
export interface RealmObserverListener {
  presence?(frame: KingdomPresenceFrame, cause: RealmObservationCause): void;
  home?(home: RealmHomeView, cause: RealmObservationCause): void;
  castle?(castle: RealmCastleView, cause: RealmObservationCause): void;
  /** Live Forge activity only. A restored snapshot never replays a ritual. */
  forge?(event: ForgeActivity): void;
  status?(status: RealmObserverStatus): void;
}
export interface RealmObserverSnapshot {
  readonly status: RealmObserverStatus; readonly writerEpoch: string | null;
  /** The newest public outbox row applied (`RealmBootstrap.throughCursor`, then each delivery's `cursor`); -1 before the first checkpoint. */
  readonly cursor: number;
  readonly presence: KingdomPresenceFrame | null; readonly castle: RealmCastleView | null; readonly homes: ReadonlyMap<string, RealmHomeView>;
  /** Every committed part known now: restored from the checkpoint or delivered live since. */
  readonly attachments: ReadonlyMap<string, CommittedForgeAttachment>;
}
export interface RealmObserver {
  current(): RealmObserverSnapshot;
  subscribe(listener: RealmObserverListener): () => void;
  /** Ask the room for a fresh checkpoint (after a hold, a buffer overflow or a writer-epoch change). */
  resync(): void;
  /** Transport loss invalidates present-tense evidence until a new checkpoint arrives. */
  unavailable(): void;
  dispose(): void;
}
export interface RealmObserverOptions { readonly bootstrapTimeoutMs?: number; readonly attempts?: number; readonly maxBuffered?: number }

const HASH = /^[a-f0-9]{64}$/;
/** Event IDs remembered per writer (README: delivery cursor). */
const SEEN_EVENTS = 1_024;
const RETIRED_EPOCHS = 8;
const text = (value: unknown, max = 256): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * Buffered checkpoint installation under the realm delivery cursor (apps/realm README, "Delivery cursor for the
 * browser lane"). `world` deliveries are buffered from the moment this subscribes; the bootstrap installs present
 * state and its `throughCursor`, then buffered and live deliveries apply in cursor order: another writer epoch, a
 * seen event ID or `cursor <= current` drops. The cursor orders every public row, including presence frames that add
 * no domain fact and several rows at one fact sequence, so fact and frame sequences are never used for ordering.
 *
 * What the server guarantees: `cursor` is the outbox row id, a bigserial shared by every kingdom's rows and burnt by
 * rolled-back writes, so per kingdom it is strictly increasing and never contiguous. The writer delivers
 * at-least-once in commit order from its durable cursor and folds each row into the bootstrap prefix before sending
 * it, so a redelivery always lands at or below what this client holds. A jump in `cursor`, fact `sequence` or frame
 * `sequence` is therefore not a lost delivery; the only signal that the stream restarted is a new writer epoch,
 * which holds effects and installs a fresh bootstrap (current views, so no older ritual replays as new). A
 * layout/collision mismatch fails closed.
 */
export function observeRealm(room: RealmObservedRoom, expected: RealmObserverExpectation, options: RealmObserverOptions = {}): RealmObserver {
  const timeoutMs = options.bootstrapTimeoutMs ?? 10_000, attempts = options.attempts ?? 3, maxBuffered = options.maxBuffered ?? 512;
  const listeners = new Set<RealmObserverListener>(), retired = new Set<string>();
  let status: RealmObserverStatus = 'installing', epoch: string | null = null, cursor = -1, frame: KingdomPresenceFrame | null = null;
  let castle: RealmCastleView | null = null;
  let homes = new Map<string, RealmHomeView>(), attached = new Map<string, CommittedForgeAttachment>(), buffer: RealmPublicDelivery[] = [], seen = new Set<string>(), tries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const emit = (call: (listener: RealmObserverListener) => void) => { for (const listener of [...listeners]) { try { call(listener); } catch (error) { console.error('Realm observer listener failed', error); } } };
  const setStatus = (next: RealmObserverStatus) => { if (status === next) return; status = next; emit(l => l.status?.(next)); };
  const presenceFrame = (value: unknown): KingdomPresenceFrame | null => {
    const parsed = KingdomPresenceFrameSchema.safeParse(value);
    return parsed.success && parsed.data.kingdomId === expected.kingdomId && parsed.data.origin === expected.origin ? parsed.data : null;
  };
  const attachment = (value: unknown): value is CommittedForgeAttachment => {
    const a = value as CommittedForgeAttachment | null;
    return !!a && a.version === 1 && text(a.id) && text(a.socketId) && a.kingdomId === expected.kingdomId
      && (a.provenance?.source === 'live' || a.provenance?.source === 'simulated') && ForgeDraftSchema.safeParse(a.draft).success;
  };
  const homeView = (value: unknown): RealmHomeView | null => {
    const h = value as { plotId?: unknown; revision?: unknown; assetHash?: unknown; attachments?: unknown } | null;
    if (!h || !text(h.plotId) || !text(h.revision) || typeof h.assetHash !== 'string' || !HASH.test(h.assetHash)
      || !Array.isArray(h.attachments) || h.attachments.length > 64 || !h.attachments.every(attachment)) return null;
    return { plotId: h.plotId, revision: h.revision, assetHash: h.assetHash, attachments: h.attachments };
  };
  const castleView = (value: unknown): RealmCastleView | null => {
    const c = value as { moduleId?: unknown; revision?: unknown; assetHash?: unknown; attachments?: unknown } | null;
    if (!c || !text(c.moduleId) || !text(c.revision) || typeof c.assetHash !== 'string' || !HASH.test(c.assetHash)
      || !Array.isArray(c.attachments) || c.attachments.length > 64 || !c.attachments.every(attachment)
      || c.attachments.some(part => part.slot !== REALM_CASTLE_SLOT)) return null;
    return { moduleId: c.moduleId, revision: c.revision, assetHash: c.assetHash, attachments: c.attachments };
  };
  const replaceAttachments = (before: readonly CommittedForgeAttachment[], after: readonly CommittedForgeAttachment[]) => {
    for (const part of before) attached.delete(part.id);
    for (const part of after) attached.set(part.id, part);
  };
  const remember = (id: string) => { seen.add(id); if (seen.size > SEEN_EVENTS) seen.delete(seen.values().next().value!); };
  const retire = (old: string) => { retired.add(old); if (retired.size > RETIRED_EPOCHS) retired.delete(retired.values().next().value!); };

  function request(): void {
    if (status === 'disposed' || status === 'mismatch') return;
    clearTimeout(timer);
    buffer = [];
    if (tries++ >= attempts) { setStatus('unavailable'); return; }
    setStatus(epoch === null ? 'installing' : 'resyncing');
    room.send('bootstrap');
    timer = setTimeout(request, timeoutMs);
  }
  function mismatch(): void { clearTimeout(timer); buffer = []; setStatus('mismatch'); }

  function install(raw: unknown): void {
    if (status !== 'installing' && status !== 'resyncing') return;
    const b = raw as Record<string, unknown> | null;
    if (!b || b.version !== 1 || b.kingdomId !== expected.kingdomId || !text(b.writerEpoch) || !count(b.throughCursor)
      || !text(b.layoutRevision) || !count(b.collisionRevision) || !Array.isArray(b.current)) return;
    // A late answer from a writer this client already left behind is not a checkpoint; the next answer or retry is.
    if (retired.has(b.writerEpoch)) return;
    if (b.collisionRevision !== expected.collisionRevision || (expected.layoutRevision !== undefined && b.layoutRevision !== expected.layoutRevision)) { mismatch(); return; }
    clearTimeout(timer); tries = 0;
    // A new writer starts a new delivery stream: its event IDs and cursor owe nothing to the old one.
    if (epoch !== null && epoch !== b.writerEpoch) { retire(epoch); seen = new Set(); }
    epoch = b.writerEpoch; cursor = b.throughCursor; homes = new Map(); castle = null; attached = new Map(); frame = null;
    for (const message of b.current as unknown[]) {
      const m = message as { type?: unknown; frame?: unknown } | null;
      if (m?.type === 'home') {
        const view = homeView(m);
        if (view) { homes.set(view.plotId, view); for (const part of view.attachments) attached.set(part.id, part); }
      }
      else if (m?.type === 'castle') {
        const view = castleView(m);
        if (view) { castle = view; for (const part of view.attachments) attached.set(part.id, part); }
      }
      else if (m?.type === 'presence') frame = presenceFrame(m.frame) ?? frame;
      // A checkpoint is present state. Any historical Forge activity in it is ignored, never replayed.
    }
    const pending = buffer; buffer = [];
    setStatus('ready');
    for (const view of homes.values()) emit(l => l.home?.(view, 'bootstrap'));
    if (castle) { const installed = castle; emit(l => l.castle?.(installed, 'bootstrap')); }
    if (frame) { const installed = frame; emit(l => l.presence?.(installed, 'bootstrap')); }
    // Same-writer entries in cursor order first; one from an unknown writer then asks for its checkpoint. A listener
    // may dispose or resync during the drain, so stop applying once the observer is no longer ready.
    const own = (d: RealmPublicDelivery) => d.writerEpoch === epoch ? 0 : 1;
    for (const delivery of pending.sort((a, z) => own(a) - own(z) || a.cursor - z.cursor)) if ((status as RealmObserverStatus) === 'ready') apply(delivery);
  }

  function apply(raw: unknown): void {
    const d = raw as RealmPublicDelivery | null;
    if (!d || d.version !== 1 || d.kingdomId !== expected.kingdomId || !text(d.writerEpoch) || !count(d.cursor) || !text(d.eventId) || !d.message) return;
    if (retired.has(d.writerEpoch)) return;
    if (status === 'installing' || status === 'resyncing') {
      buffer.push(d);
      if (buffer.length > maxBuffered) request();
      return;
    }
    if (status !== 'ready') return;
    if (d.writerEpoch !== epoch) { request(); return; }
    if (seen.has(d.eventId) || d.cursor <= cursor) return;
    // The row is consumed whatever its body: the cursor orders every public row, shown or not.
    remember(d.eventId); cursor = d.cursor;
    const message = d.message;
    if (message.type === 'presence') {
      const next = presenceFrame(message.frame);
      if (!next) return;
      frame = next;
      emit(l => l.presence?.(next, 'delivery'));
    } else if (message.type === 'home') {
      const view = homeView(message);
      if (!view) return;
      replaceAttachments(homes.get(view.plotId)?.attachments ?? [], view.attachments);
      homes.set(view.plotId, view);
      emit(l => l.home?.(view, 'delivery'));
    } else if (message.type === 'castle') {
      const view = castleView(message);
      if (!view) return;
      replaceAttachments(castle?.attachments ?? [], view.attachments);
      castle = view;
      emit(l => l.castle?.(view, 'delivery'));
    } else if (message.type === 'forge') {
      const event = message.event;
      if (event?.type === 'stage' && text(event.activityId)) emit(l => l.forge?.(event));
      else if (event?.type === 'committed' && attachment(event.attachment)) {
        // A part already present in the checkpoint (or already celebrated) never forges twice.
        if (attached.has(event.attachment.id)) return;
        for (const old of attached.values()) if (old.slot === event.attachment.slot && old.socketId === event.attachment.socketId) attached.delete(old.id);
        attached.set(event.attachment.id, event.attachment);
        if (castle && event.attachment.slot === REALM_CASTLE_SLOT) castle = { ...castle,
          attachments: [...castle.attachments.filter(part => part.socketId !== event.attachment.socketId), event.attachment] };
        emit(l => l.forge?.(event));
      }
    }
  }

  const unbind = [
    room.onMessage('transient', (payload: never) => {
      if (status !== 'ready') return;
      const message = payload as { type?: unknown; event?: unknown } | null;
      if (message?.type !== 'forge') return;
      const event = ForgeTransientActivitySchema.safeParse(message.event);
      if (event.success) emit(l => l.forge?.(event.data));
    }),
    room.onMessage('world', (payload: never) => apply(payload)),
    room.onMessage('bootstrap', (payload: never) => install(payload)),
    room.onMessage('revision', (payload: never) => {
      const r = payload as { collisionRevision?: unknown } | null;
      if (r && r.collisionRevision !== expected.collisionRevision) mismatch();
    }),
  ];
  request();
  return {
    current: () => ({ status, writerEpoch: epoch, cursor, presence: frame, castle, homes: new Map(homes), attachments: new Map(attached) }),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    resync() { tries = 0; if (status !== 'mismatch') request(); },
    unavailable() { if (status === 'disposed') return; clearTimeout(timer); buffer = []; frame = null; setStatus('unavailable'); },
    dispose() { clearTimeout(timer); for (const release of unbind) release(); frame = null; setStatus('disposed'); listeners.clear(); buffer = []; },
  };
}
