import type { FishingCaughtFish, FishingChannelReply, FishingMood, FishingOwnerCast, FishingPierSite, FishingPublicBeat,
  FishingPublicCast, ItemRecord, Vec3 } from '@chatdom/shared';
import { requestId, type FishingLink } from './link';

/** What the presentation hears. The server decides every one of these; the browser only draws them. */
export type FishingEvent =
  | { readonly kind: FishingPublicBeat['kind']; readonly castId: string; readonly walkerId: string; readonly at: number;
      readonly outcome?: FishingPublicBeat['outcome']; readonly self: boolean }
  | { readonly kind: 'caught'; readonly castId: string; readonly walkerId: string; readonly fish: FishingCaughtFish;
      readonly kingdomFirst: boolean; readonly self: boolean }
  | { readonly kind: 'kept'; readonly castId: string; readonly item: ItemRecord; readonly fish: FishingCaughtFish;
      readonly personalFirst: boolean; readonly kingdomFirst: boolean; readonly replayed: boolean }
  | { readonly kind: 'rod'; readonly walkerId: string; readonly equipped: boolean; readonly self: boolean }
  | { readonly kind: 'taken'; readonly item: ItemRecord }
  | { readonly kind: 'note'; readonly message: string; readonly tone: 'plain' | 'warn' }
  | { readonly kind: 'state' };

export interface FishingHint { readonly label: string; readonly key?: string; readonly urgent?: boolean }
export type FishingInput = 'idle' | 'drawing' | 'reeling';

export interface FishingControllerState {
  readonly ready: boolean;
  readonly site: FishingPierSite | null;
  readonly rack: Vec3 | null;
  /** The pier's lantern glass, as the realm placed it. */
  readonly lights: readonly Vec3[];
  readonly water: { readonly hour: number; readonly mood: FishingMood } | null;
  readonly revision: number;
  /** Server time minus local time, from the latest state answer. */
  readonly offset: number;
  readonly casts: ReadonlyMap<string, FishingPublicCast>;
  readonly rods: ReadonlySet<string>;
  readonly rod: ItemRecord | null;
  readonly cast: FishingOwnerCast | null;
  readonly pendingCastId: string | null;
  readonly input: FishingInput;
  /** Local time the draw began, for the rod's draw-back pose; null when not drawing. */
  readonly drawStartedAt: number | null;
  /** Local time of the latest reel edge, for the rod's immediate response. */
  readonly reelChangedAt: number;
  readonly busy: boolean;
}

export interface FishingControllerOptions {
  readonly link: FishingLink;
  readonly selfWalkerId: string;
  readonly now?: () => number;
  readonly schedule?: (callback: () => void, delayMs: number) => () => void;
}

/** Plain words for an ended line. Arbitrary server refusal text is shown only to its own fisher. */
export const ENDED_WORDS: Record<NonNullable<FishingPublicBeat['outcome']>, string> = {
  snapped: 'The line snapped.', escaped: 'The fish slipped the hook.', missed: 'The fish slipped away.',
  cancelled: 'Your line is reeled in.', unkept: 'The catch could not be kept.',
};
/** The server refuses a release shorter than 200 ms of its own time; leave room for the trip. */
const MIN_DRAW_MS = 260, REEL_GAP_MS = 70;
const PHASE_OF_BEAT: Partial<Record<FishingPublicBeat['kind'], FishingOwnerCast['phase']>> = {
  cast: 'flying', float: 'waiting', bite: 'bite', hook: 'fighting', landing: 'landing',
};

const defaultSchedule = (callback: () => void, delay: number) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); };

export function createFishingController(options: FishingControllerOptions) {
  const now = options.now ?? (() => performance.now()), schedule = options.schedule ?? defaultSchedule;
  const listeners = new Set<(event: FishingEvent) => void>();
  let state: FishingControllerState = {
    ready: false, site: null, rack: null, lights: [], water: null, revision: 0, offset: 0, casts: new Map(), rods: new Set(),
    rod: null, cast: null, pendingCastId: null, input: 'idle', drawStartedAt: null, reelChangedAt: 0, busy: false,
  };
  let closed = false, takeWaiting = false, seq = 0, drawId: string | null = null, earlyStrike: string | null = null, struck: string | null = null, takeId: string | null = null, releaseQueued = false, drawSentAt = 0;
  let reelWanted = false, reelSent = false, reelSentAt = -Infinity, cancelReel: (() => void) | null = null, cancelRelease: (() => void) | null = null;
  const requests = new Set<string>();
  const set = (patch: Partial<FishingControllerState>) => { state = { ...state, ...patch }; };
  const emit = (event: FishingEvent) => {
    for (const listener of [...listeners]) { try { listener(event); } catch (error) { console.error('A fishing listener failed.', error); } }
  };
  const note = (message: string, tone: 'plain' | 'warn' = 'plain') => emit({ kind: 'note', message, tone });
  const send = (prefix: string, build: (id: string) => Parameters<FishingLink['send']>[0]) => {
    if (closed) return null;
    const id = requestId(prefix);
    requests.add(id); if (requests.size > 64) requests.delete(requests.values().next().value!);
    options.link.send(build(id));
    return id;
  };
  const nextSeq = () => { seq = Math.min(10_000, seq + 1); return seq; };
  const resetInput = () => {
    drawId = null; releaseQueued = false; reelWanted = false; reelSent = false;
    cancelReel?.(); cancelReel = null; cancelRelease?.(); cancelRelease = null;
    set({ input: 'idle', drawStartedAt: null });
  };
  const adoptCast = (cast: FishingOwnerCast | null) => {
    const previous = state.cast;
    if (cast && previous?.id !== cast.id) { seq = 0; reelSent = false; }
    set({ cast });
    if (!cast) { resetInput(); return; }
    if (cast.phase === 'drawing' && releaseQueued) sendRelease();
    if (cast.phase !== 'drawing' && cast.phase !== 'fighting' && state.input !== 'idle' && cast.phase !== 'bite') set({ input: 'idle', drawStartedAt: null });
  };
  const sendRelease = () => {
    const cast = state.cast;
    if (!cast || cast.phase !== 'drawing') { releaseQueued = true; return; }
    const wait = MIN_DRAW_MS - (now() - drawSentAt);
    if (wait > 0) {
      releaseQueued = true;
      if (!cancelRelease) cancelRelease = schedule(() => { cancelRelease = null; if (releaseQueued) sendRelease(); }, wait);
      return;
    }
    releaseQueued = false;
    send('release', id => ({ type: 'pier.release', id, castId: cast.id, seq: nextSeq() }));
    set({ input: 'idle', drawStartedAt: null });
  };
  /** Reel edges are coalesced to stay well inside the room's per-person rate. */
  const flushReel = () => {
    cancelReel = null;
    const cast = state.cast;
    if (!cast || (cast.phase !== 'fighting' && cast.phase !== 'bite') || reelWanted === reelSent) return;
    const wait = REEL_GAP_MS - (now() - reelSentAt);
    if (wait > 0) { cancelReel = schedule(flushReel, wait); return; }
    reelSent = reelWanted; reelSentAt = now();
    send('reel', id => ({ type: 'pier.reel', id, castId: cast.id, seq: nextSeq(), on: reelWanted }));
  };
  const reel = (on: boolean) => {
    if (reelWanted === on) return;
    reelWanted = on; set({ input: on ? 'reeling' : 'idle', reelChangedAt: now() });
    if (!cancelReel) flushReel();
  };
  const handle = (reply: FishingChannelReply) => {
    if (closed) return;
    const self = options.selfWalkerId;
    switch (reply.type) {
      case 'pier.state': {
        const casts = new Map(reply.casts.map(cast => [cast.walkerId, cast]));
        set({ ready: true, site: reply.site, rack: reply.rack, lights: reply.lights ?? [], water: reply.water, revision: reply.revision, offset: reply.at - now(),
          casts, rods: new Set(reply.rods.map(rod => rod.walkerId)), rod: reply.self.rod, pendingCastId: reply.self.pendingCastId, busy: false });
        adoptCast(reply.self.cast);
        if (reply.self.pendingCastId && !reply.self.cast) note('A catch is still waiting to be kept.');
        if (takeId && reply.id === takeId) { takeId = null; if (reply.self.rod) emit({ kind: 'taken', item: reply.self.rod }); }
        if (takeWaiting) { takeWaiting = false; if (reply.self.rod) set({ busy: false }); else { set({ busy: true }); takeId = send('take', id => ({ type: 'pier.take', id })); } }
        emit({ kind: 'state' });
        return;
      }
      case 'pier.action':
        if (!requests.has(reply.id)) return;
        adoptCast(reply.cast);
        if (reply.cast?.phase === 'fighting' && reelWanted !== reelSent && !cancelReel) flushReel();
        emit({ kind: 'state' });
        return;
      case 'pier.refused': {
        const mine = reply.id === undefined || requests.has(reply.id) || reply.id === 'fishing';
        if (!mine) return;
        if (reply.id && reply.id === drawId) resetInput();
        if (reply.id && reply.id === takeId) takeId = null;
        if (reply.castId && reply.castId === state.cast?.id && state.cast.phase === 'drawing') resetInput();
        set({ busy: false });
        note(reply.message, 'warn');
        emit({ kind: 'state' });
        return;
      }
      case 'pier.pending':
        set({ pendingCastId: reply.castId });
        note(reply.message);
        emit({ kind: 'state' });
        return;
      case 'pier.kept': {
        const wasMine = state.cast?.id === reply.castId;
        set({ pendingCastId: state.pendingCastId === reply.castId ? null : state.pendingCastId, ...(wasMine ? { cast: null } : {}) });
        if (wasMine) resetInput();
        emit({ kind: 'kept', castId: reply.castId, item: reply.item, fish: reply.fish, personalFirst: reply.personalFirst,
          kingdomFirst: reply.kingdomFirst, replayed: reply.replayed });
        emit({ kind: 'state' });
        return;
      }
      case 'pier.casts': {
        const casts = new Map(reply.casts.map(cast => [cast.walkerId, cast]));
        set({ casts, revision: reply.revision });
        const own = casts.get(self);
        if (state.cast && own?.id === state.cast.id && own.phase !== state.cast.phase) {
          adoptCast({ ...state.cast, phase: own.phase, float: own.float, at: own.at, ...(own.fight ? { fight: own.fight } : {}) });
        } else if (state.cast && own?.id === state.cast.id && own.fight) set({ cast: { ...state.cast, fight: own.fight } });
        return;
      }
      case 'pier.rod': {
        const rods = new Set(state.rods);
        if (reply.equipped) rods.add(reply.walkerId); else rods.delete(reply.walkerId);
        set({ rods });
        emit({ kind: 'rod', walkerId: reply.walkerId, equipped: reply.equipped, self: reply.walkerId === self });
        return;
      }
      case 'pier.beats':
        for (const beat of reply.beats) {
          const mine = beat.walkerId === self && beat.castId === state.cast?.id;
          if (mine) {
            if (beat.kind === 'ended') {
              set({ cast: null }); resetInput();
              // An early strike is answered by its own refusal; one plain line is enough.
              if (beat.outcome && beat.outcome !== 'cancelled' && !(beat.outcome === 'missed' && earlyStrike === beat.castId)) note(ENDED_WORDS[beat.outcome], beat.outcome === 'unkept' ? 'warn' : 'plain');
            } else {
              const phase = PHASE_OF_BEAT[beat.kind];
              if (phase && state.cast && state.cast.phase !== phase) adoptCast({ ...state.cast, phase, at: beat.at });
            }
          }
          emit({ kind: beat.kind, castId: beat.castId, walkerId: beat.walkerId, at: beat.at,
            ...(beat.outcome ? { outcome: beat.outcome } : {}), self: beat.walkerId === self });
        }
        emit({ kind: 'state' });
        return;
      case 'pier.caught':
        emit({ kind: 'caught', castId: reply.castId, walkerId: reply.walkerId, fish: reply.fish, kingdomFirst: reply.kingdomFirst,
          self: reply.walkerId === self });
        return;
    }
  };
  const unsubscribe = options.link.subscribe(handle);

  return {
    state: (): FishingControllerState => state,
    subscribe(listener: (event: FishingEvent) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** Server time now, from the latest state answer. */
    serverNow: () => Math.round(now() + state.offset),
    sync() { send('sync', id => ({ type: 'pier.sync', id })); },
    take() {
      if (state.busy) return;
      set({ busy: true });
      // The room answers one request at a time per person: ask for the rod once the first state is in.
      if (!state.ready) { takeWaiting = true; return; }
      takeId = send('take', id => ({ type: 'pier.take', id }));
    },
    equip(itemId: string | null) {
      if (state.cast) send('cancel', id => ({ type: 'pier.cancel', id, castId: state.cast!.id, seq: nextSeq() }));
      send('equip', id => ({ type: 'pier.equip', id, itemId }));
    },
    keep() {
      const castId = state.pendingCastId;
      if (castId) send('keep', id => ({ type: 'pier.keep', id, castId }));
    },
    /** Primary button or touch down. */
    press() {
      if (closed) return;
      const cast = state.cast;
      if (state.pendingCastId && !cast) { note('Your last catch is still being kept.'); return; }
      if (!cast) {
        if (!state.rod) { note('Take a rod from the rack at the landing first.'); return; }
        if (drawId) return;
        drawSentAt = now(); releaseQueued = false;
        drawId = send('draw', id => ({ type: 'pier.draw', id }));
        set({ input: 'drawing', drawStartedAt: drawSentAt });
        return;
      }
      // One strike per cast. Once it is on its way, every later press is the reel (the room agrees), so a double
      // click or a press crossing the strike's own answer never throws the fish back.
      if (struck === cast.id) { reel(true); return; }
      if (cast.phase === 'flying' || cast.phase === 'waiting' || cast.phase === 'bite') {
        // Striking before the dip is honest: the server says the hook came back empty.
        struck = cast.id;
        send('strike', id => ({ type: 'pier.strike', id, castId: cast.id, seq: nextSeq() }));
        if (cast.phase !== 'bite') earlyStrike = cast.id;
        if (cast.phase === 'bite') { reelWanted = true; reelSent = true; reelSentAt = now(); set({ input: 'reeling', reelChangedAt: now() }); }
        return;
      }
      if (cast.phase === 'fighting') reel(true);
    },
    /** Primary button or touch up. */
    release() {
      if (closed) return;
      if (state.input === 'drawing') { sendRelease(); return; }
      if (state.cast?.phase === 'fighting' || state.cast?.phase === 'bite' || state.input === 'reeling') reel(false);
    },
    /** Reel in and lower the rod. */
    cancel() {
      const cast = state.cast;
      if (cast && cast.phase !== 'landing') send('cancel', id => ({ type: 'pier.cancel', id, castId: cast.id, seq: nextSeq() }));
      resetInput();
    },
    /** The quiet line under the prompt. `lip` and `nearRack` come from the drawn pose; the server checks both again. */
    hint(where: { readonly lip: boolean; readonly nearRack: boolean; readonly onPier: boolean; readonly touch: boolean }): FishingHint | null {
      const key = where.touch ? 'Tap' : 'Click';
      const cast = state.cast;
      if (!state.ready || !state.site) return null;
      if (state.pendingCastId && !cast) return { label: 'Keeping your catch' };
      if (!state.rod) return where.nearRack ? { label: 'Take a willow rod', key: where.touch ? 'Tap' : 'E' } : null;
      if (!cast) {
        if (state.input === 'drawing') return { label: 'Let go to cast' };
        return where.lip ? { label: 'Hold to draw back, let go to cast', key } : where.onPier ? { label: 'Walk out to the end of the pier to cast' } : null;
      }
      switch (cast.phase) {
        case 'drawing': return { label: 'Let go to cast' };
        case 'flying': case 'waiting': return { label: 'Wait for the float to dip' };
        case 'bite': return { label: 'Strike!', key, urgent: true };
        case 'fighting': return { label: 'Hold to reel · ease off when it runs', key };
        case 'landing': return null;
      }
    },
    dispose() {
      if (closed) return;
      closed = true; unsubscribe(); listeners.clear(); cancelReel?.(); cancelRelease?.();
    },
  };
}
export type FishingController = ReturnType<typeof createFishingController>;
