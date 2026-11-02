import { Buffer } from 'node:buffer';
import { FISHING_CHANNEL, FISHING_PRIVATE_BYTES, FISHING_PUBLIC_BYTES, FishingChannelRequestSchema,
  kingdomFishingHour, kingdomWaterMood, type FishingOwnerCast, type FishingPrivateReply, type FishingPublicBeat,
  type FishingPublicCast, type FishingPublicReply, type FishingPublicRod, type ItemRecord, type PersonId } from '@chatdom/shared';
import type { RealmChannelRoom, RealmChannelSender, RealmRoomChannel } from '../room-channels';
import type { CastBeat, CastView, createFishingCasts } from './cast';
import type { FishingCatchResult } from './catches';
import type { FishingRoomInstallation } from './installation';

export interface FishingRoomRuntime {
  readonly casts: ReturnType<typeof createFishingCasts>;
  now(): number;
  installation(): FishingRoomInstallation | null;
  /** Authenticate, read a bounded owned item, and refresh the binding's synchronous rod fact cache. */
  refreshRod(from: RealmChannelSender, itemId: string): Promise<ItemRecord | null>;
  takeRod(from: RealmChannelSender): Promise<
    { readonly status: 'taken'; readonly item: ItemRecord } |
    { readonly status: 'refused' | 'uncertain'; readonly message: string }>;
  keep(from: RealmChannelSender, castId: string): Promise<FishingCatchResult>;
  /** The binding invalidates its cached fact before calling this listener. */
  onRodChange(listener: (personId: PersonId) => void): () => void;
  dispose(): void;
}

export interface FishingRoomChannelOptions {
  bind(room: RealmChannelRoom, selected: (personId: PersonId, walkerId: string) => string | null): FishingRoomRuntime;
  /** One-shot scheduler, returning cancellation. No repeating timer or timer-owned database work. */
  readonly schedule?: (callback: () => void, delayMs: number) => () => void;
}

interface Fisher {
  readonly owner: PersonId;
  readonly walkerId: string;
  selectedId: string | null;
  selectionVersion: number;
  rod: ItemRecord | null;
  refreshedAt: number;
  refreshNeeded: boolean;
  pendingCastId: string | null;
  queuedKeep: string | null;
  attemptedCastId: string | null;
}
interface CastOwner { readonly owner: PersonId; readonly walkerId: string }
const MAX_PEOPLE = 300, MAX_JOBS = 4, TICK_MS = 50, FRAME_MS = 200, REFRESH_MS = 1000;
const BUSY = 'The pier is busy just now. Try that once more.';
const END_OUTCOMES = new Map<string, NonNullable<FishingPublicBeat['outcome']>>([
  ['The line snapped.', 'snapped'], ['The fish slipped the hook.', 'escaped'],
  ['The fish slipped away.', 'missed'], ['The hook came back empty.', 'missed'],
  ['Nothing is biting in this water.', 'missed'], ['The catch could not be kept.', 'unkept'],
  ['The catch could not be confirmed.', 'unkept'], ['Your line is reeled in.', 'cancelled'],
  ['The rod is lowered.', 'cancelled'],
]);
const defaultSchedule: NonNullable<FishingRoomChannelOptions['schedule']> = (callback, delay) => {
  const timer = setTimeout(callback, delay);
  timer.unref?.();
  return () => clearTimeout(timer);
};

/** Explicit projections keep private seeds, proof, item ids and bite deadlines out of public packets. */
function ownView(view: CastView): FishingOwnerCast {
  return { id: view.id, phase: view.phase, anchor: [...view.anchor], float: view.float ? [...view.float] : null, at: view.at,
    ...(view.biteClosesAt === undefined ? {} : { biteClosesAt: view.biteClosesAt }),
    ...(view.fight ? { fight: { tick: view.fight.tick, tension: view.fight.tension, progress: view.fight.progress,
      phase: view.fight.phase, tired: view.fight.tired } } : {}),
    ...(view.environment ? { environment: { water: view.environment.water, biome: view.environment.biome,
      depthM: view.environment.depthM, hour: view.environment.hour, mood: view.environment.mood } } : {}) };
}
function publicView(view: CastView, walkerId: string): FishingPublicCast {
  return { id: view.id, walkerId, phase: view.phase, anchor: [...view.anchor], float: view.float ? [...view.float] : null, at: view.at,
    ...(view.fight ? { fight: { tick: view.fight.tick, tension: view.fight.tension, progress: view.fight.progress,
      phase: view.fight.phase, tired: view.fight.tired } } : {}) };
}
function bytes(value: unknown, limit: number): boolean {
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8') <= limit; } catch { return false; }
}

/** Transport orchestration only. The bound server domain and durable writers decide every grant. */
export function createFishingRoomChannel(options: FishingRoomChannelOptions): RealmRoomChannel {
  const schedule = options.schedule ?? defaultSchedule;
  return { type: FISHING_CHANNEL, rate: 20, attach(room) {
    let active = true, cancelWake: (() => void) | null = null, pumping = false, publicDirty = false;
    let lastFrameAt = -Infinity, lastFrame = '', jobs = 0;
    const people = new Map<PersonId, Fisher>(), owners = new Map<string, CastOwner>(), busy = new Set<PersonId>();
    const selected = (owner: PersonId, walkerId: string) => {
      const fisher = people.get(owner);
      return active && fisher?.walkerId === walkerId && fisher.rod ? fisher.selectedId : null;
    };
    const runtime = options.bind(room, selected);
    const sameSeat = (from: RealmChannelSender) => active && from.present()
      && room.person(from.principal.personId)?.walkerId === from.walkerId;
    const publicSend = (message: FishingPublicReply) => {
      if (active && bytes(message, FISHING_PUBLIC_BYTES)) {
        try { room.broadcast(message); } catch { /* A dropped observer recovers the snapshot on sync. */ }
      }
    };
    // Direct synchronous replies follow the room hook's fresh authentication. Async jobs check again below.
    const privateSend = (from: RealmChannelSender, message: FishingPrivateReply) => {
      if (!sameSeat(from)) return;
      try {
        room.toPerson(from.principal.personId, bytes(message, FISHING_PRIVATE_BYTES) ? message : {
          type: 'pier.refused', ...('id' in message && message.id ? { id: message.id } : {}),
          message: 'The pier could not show that record. Open your bag to check your things.',
        } satisfies FishingPrivateReply);
      } catch { /* The confirmed receipt and bag survive a failed socket send. */ }
    };
    const authenticated = async (from: RealmChannelSender) => sameSeat(from) && await from.current() && sameSeat(from);
    const refuse = (from: RealmChannelSender, message: string, id?: string, castId?: string) => privateSend(from, {
      type: 'pier.refused', ...(id ? { id } : {}), ...(castId ? { castId } : {}), message,
    });
    const pending = (from: RealmChannelSender, castId: string, message: string, id?: string) => privateSend(from, {
      type: 'pier.pending', castId, message, ...(id ? { id } : {}),
    });
    const rodEvent = (fisher: Fisher, equipped: boolean) => publicSend({ type: 'pier.rod', at: runtime.now(), walkerId: fisher.walkerId, equipped });
    const clearRod = (fisher: Fisher) => {
      const wasSelected = !!fisher.rod;
      fisher.rod = null;
      if (wasSelected) rodEvent(fisher, false);
    };
    const prune = () => {
      for (const [owner, fisher] of people) {
        const present = room.person(owner);
        if (present?.walkerId === fisher.walkerId && present.present()) continue;
        clearRod(fisher); fisher.selectedId = null; fisher.queuedKeep = null;
        // Receipt recovery accepts the client's original UUID. Disconnected records must not pin capacity.
        if (!busy.has(owner)) people.delete(owner);
      }
    };
    const person = (from: RealmChannelSender): Fisher | null => {
      const owner = from.principal.personId, old = people.get(owner);
      if (old?.walkerId === from.walkerId) return old;
      prune();
      if (!old && people.size >= MAX_PEOPLE) return null;
      if (old) clearRod(old);
      const fisher: Fisher = { owner, walkerId: from.walkerId, selectedId: null, selectionVersion: 0, rod: null, refreshedAt: 0,
        refreshNeeded: false, pendingCastId: old?.pendingCastId ?? null, queuedKeep: null, attemptedCastId: null };
      people.set(owner, fisher);
      return fisher;
    };
    const currentFisher = (from: RealmChannelSender, fisher: Fisher) => sameSeat(from) && people.get(fisher.owner) === fisher;
    const qualified = (from: RealmChannelSender, item: ItemRecord | null): item is ItemRecord => !!item
      && item.ownerId === from.principal.personId && item.kingdomId === room.kingdomId && item.origin === room.origin
      && item.defId === 'tool:rod.willow' && item.branch === 'held' && item.count === 1 && item.storied
      && (item.place === 'hotbar' || item.place === 'hand');
    const refresh = async (from: RealmChannelSender, fisher: Fisher, itemId: string): Promise<boolean> => {
      const version = fisher.selectionVersion;
      const item = await runtime.refreshRod(from, itemId);
      if (!currentFisher(from, fisher) || !await authenticated(from) || !currentFisher(from, fisher)
        || version !== fisher.selectionVersion) {
        if (people.get(fisher.owner) === fisher && version === fisher.selectionVersion) {
          clearRod(fisher); fisher.selectedId = null; fisher.refreshNeeded = false;
        }
        return false;
      }
      if (!qualified(from, item) || item.id !== itemId) { clearRod(fisher); return false; }
      const restored = !fisher.rod && fisher.selectedId === itemId;
      fisher.rod = structuredClone(item); fisher.refreshedAt = runtime.now(); fisher.refreshNeeded = false;
      if (restored) rodEvent(fisher, true);
      return true;
    };
    const ownCast = (owner: PersonId): FishingOwnerCast | null => {
      const view = runtime.casts.views().find(view => owners.get(view.id)?.owner === owner);
      return view ? ownView(view) : null;
    };
    const publicCasts = (): FishingPublicCast[] => runtime.casts.views().flatMap(view => {
      const owner = owners.get(view.id);
      return owner ? [publicView(view, owner.walkerId)] : [];
    });
    const state = (from: RealmChannelSender, fisher: Fisher, id: string) => {
      const installation = runtime.installation(), at = runtime.now();
      const rods: FishingPublicRod[] = [];
      for (const person of people.values()) if (person.rod && person.selectedId
        && room.person(person.owner)?.walkerId === person.walkerId) rods.push({ walkerId: person.walkerId, model: 'tool:rod.willow' });
      privateSend(from, { type: 'pier.state', id, at, revision: installation?.revision ?? room.world().revision,
        site: installation?.site ?? null, rack: installation?.rack ?? null,
        water: installation ? { hour: kingdomFishingHour(at), mood: kingdomWaterMood(room.kingdomId, at) } : null,
        casts: publicCasts(), rods, self: { rod: fisher.rod, cast: ownCast(fisher.owner), pendingCastId: fisher.pendingCastId } });
    };
    const drain = (beats: readonly CastBeat[]) => {
      const projected: FishingPublicBeat[] = [];
      for (const beat of beats) {
        const owner = owners.get(beat.castId);
        if (!owner) continue;
        const outcome = beat.kind === 'ended' ? END_OUTCOMES.get(beat.reason ?? '') ?? 'cancelled' : undefined;
        projected.push({ castId: beat.castId, walkerId: owner.walkerId, at: beat.at, kind: beat.kind,
          ...(outcome ? { outcome } : {}) });
        if (beat.kind === 'landing') {
          const fisher = people.get(owner.owner);
          if (fisher?.walkerId === owner.walkerId && !fisher.pendingCastId && fisher.attemptedCastId !== beat.castId) {
            fisher.pendingCastId = beat.castId; fisher.queuedKeep = beat.castId;
          }
        }
      }
      if (projected.length) publicSend({ type: 'pier.beats', beats: projected });
      if (beats.length) publicDirty = true;
    };
    const frames = () => {
      const casts = publicCasts(), fingerprint = JSON.stringify(casts), at = runtime.now();
      if (fingerprint !== lastFrame) publicDirty = true;
      if (publicDirty && at - lastFrameAt >= FRAME_MS) {
        publicSend({ type: 'pier.casts', at, revision: runtime.installation()?.revision ?? room.world().revision, casts });
        lastFrame = fingerprint; lastFrameAt = at; publicDirty = false;
      }
    };
    const needsWake = () => active && (runtime.casts.views().length > 0 || publicDirty);
    const wake = () => {
      if (!active || cancelWake || !needsWake()) return;
      cancelWake = schedule(() => { cancelWake = null; pump(); }, TICK_MS);
    };
    /** The bounded job is kept until the actual work settles; no timeout frees a still-running slot. */
    const job = (from: RealmChannelSender, fisher: Fisher, work: () => Promise<void>, id?: string): Promise<void> | null => {
      if (!currentFisher(from, fisher) || jobs >= MAX_JOBS || busy.has(fisher.owner)) return null;
      jobs++; busy.add(fisher.owner);
      return (async () => {
        try {
          if (!await authenticated(from) || !currentFisher(from, fisher)) {
            if (people.get(fisher.owner) === fisher) {
              clearRod(fisher); fisher.selectedId = null; fisher.refreshNeeded = false; fisher.queuedKeep = null;
            }
            return;
          }
          await work();
        } catch {
          clearRod(fisher); fisher.selectedId = null; fisher.refreshNeeded = false; fisher.queuedKeep = null;
          if (await authenticated(from).catch(() => false)) refuse(from, 'The kingdom could not check that fishing request. Try again shortly.', id);
        } finally {
          jobs--; busy.delete(fisher.owner);
          if (active) pump();
        }
      })();
    };
    const keep = async (from: RealmChannelSender, fisher: Fisher, castId: string, id?: string) => {
      if (!currentFisher(from, fisher)) return;
      const landingHere = () => owners.get(castId)?.owner === fisher.owner
        && runtime.casts.views().some(view => view.id === castId && view.phase === 'landing');
      const beganAtLanding = landingHere();
      fisher.queuedKeep = null; fisher.attemptedCastId = castId;
      if (!fisher.pendingCastId) fisher.pendingCastId = castId;
      pending(from, castId, 'The kingdom is keeping your catch.', id);
      let kept: FishingCatchResult;
      try { kept = await runtime.keep(from, castId); }
      catch {
        if (await authenticated(from).catch(() => false)) pending(from, castId,
          'The kingdom could not confirm that catch. Try keeping this same catch again.', id);
        return;
      }
      if (!currentFisher(from, fisher) || !await authenticated(from) || !currentFisher(from, fisher)) return;
      if (kept.status === 'uncertain') { pending(from, castId, kept.message, id); return; }
      if (fisher.pendingCastId === castId) fisher.pendingCastId = null;
      if (kept.status === 'refused') {
        if (fisher.attemptedCastId === castId) fisher.attemptedCastId = null;
        // An early keep may be refused before its delayed answer crosses the actual landing.
        // Recover the skipped landing once; genuine landing refusals never restart themselves.
        if (!beganAtLanding && landingHere()) {
          fisher.pendingCastId = castId; fisher.queuedKeep = castId;
          pending(from, castId, 'The kingdom is keeping your catch.', id); return;
        }
        refuse(from, kept.message, id, castId); return;
      }
      if (kept.catch.id !== castId || kept.catch.ownerId !== fisher.owner || kept.catch.kingdomId !== room.kingdomId
        || kept.catch.origin !== room.origin || kept.item.ownerId !== fisher.owner || kept.item.kingdomId !== room.kingdomId
        || kept.item.origin !== room.origin || kept.item.id !== kept.catch.itemId) {
        refuse(from, 'The kingdom could not show that catch. Open your bag to check your things.', id, castId); return;
      }
      const fish = { speciesId: kept.catch.speciesId, lengthMm: kept.catch.fish.lengthMm, weightG: kept.catch.fish.weightG };
      privateSend(from, { type: 'pier.kept', ...(id ? { id } : {}), castId, item: kept.item, fish,
        personalFirst: kept.catch.personalFirst, kingdomFirst: kept.catch.kingdomFirst, replayed: kept.replayed });
      if (!kept.replayed) publicSend({ type: 'pier.caught', at: kept.catch.caughtAt, castId, walkerId: from.walkerId,
        fish, kingdomFirst: kept.catch.kingdomFirst });
      publicDirty = true;
    };
    function pump() {
      if (!active || pumping) return;
      pumping = true;
      try {
        prune();
        drain(runtime.casts.tick());
        const views = runtime.casts.views(), ids = new Set(views.map(view => view.id));
        for (const [id] of owners) if (!ids.has(id)) owners.delete(id);
        for (const fisher of people.values()) {
          const from = room.person(fisher.owner);
          if (!from || from.walkerId !== fisher.walkerId || !from.present() || busy.has(fisher.owner)) continue;
          if (fisher.queuedKeep) {
            const castId = fisher.queuedKeep;
            // An expired candidate gets one receipt lookup, never a newly created cast or a replacement seat.
            void job(from, fisher, () => keep(from, fisher, castId));
          } else if (fisher.selectedId && (fisher.refreshNeeded || views.some(view => owners.get(view.id)?.owner === fisher.owner)
            && runtime.now() - fisher.refreshedAt >= REFRESH_MS)) {
            const itemId = fisher.selectedId;
            void job(from, fisher, async () => {
              if (await refresh(from, fisher, itemId) && currentFisher(from, fisher) && fisher.selectedId === itemId) return;
              if (currentFisher(from, fisher)) { clearRod(fisher); fisher.selectedId = null; fisher.refreshNeeded = false; }
            });
          }
        }
        frames();
      } catch {
        // A failed domain or clock cannot keep autonomous work alive or issue a catch through a fallback.
        dispose();
      } finally { pumping = false; }
      wake();
    }
    const stopChanges = runtime.onRodChange(owner => {
      const fisher = people.get(owner);
      if (!active || !fisher?.selectedId) return;
      clearRod(fisher); fisher.refreshNeeded = true;
      pump();
    });
    function dispose() {
      if (!active) return;
      active = false; cancelWake?.(); cancelWake = null;
      stopChanges(); runtime.dispose(); people.clear(); owners.clear();
    }
    room.onMessage(async (from, raw) => {
      if (!sameSeat(from)) return;
      const parsed = FishingChannelRequestSchema.safeParse(raw);
      if (!parsed.success) { refuse(from, 'Choose a valid fishing action.', 'fishing'); return; }
      const request = parsed.data, fisher = person(from);
      if (!fisher) { refuse(from, BUSY, request.id); return; }
      const requestJob = async (work: () => Promise<void>) => {
        const running = job(from, fisher, work, request.id);
        if (running) await running;
        else refuse(from, BUSY, request.id);
      };
      if (request.type === 'pier.sync') {
        await requestJob(async () => {
          if (fisher.selectedId) await refresh(from, fisher, fisher.selectedId);
          if (await authenticated(from) && currentFisher(from, fisher)) { pump(); state(from, fisher, request.id); }
        });
        return;
      }
      if (request.type === 'pier.take') {
        await requestJob(async () => {
          const version = fisher.selectionVersion;
          const taken = await runtime.takeRod(from);
          if (!currentFisher(from, fisher) || !await authenticated(from) || version !== fisher.selectionVersion) return;
          if (taken.status !== 'taken') { refuse(from, taken.message, request.id); return; }
          if (!qualified(from, taken.item) || !await refresh(from, fisher, taken.item.id)) {
            if (await authenticated(from) && currentFisher(from, fisher)) refuse(from, 'Your rod is put away. Move it to your hotbar to fish.', request.id);
            return;
          }
          if (!currentFisher(from, fisher) || version !== fisher.selectionVersion) return;
          fisher.selectionVersion++; fisher.selectedId = taken.item.id; rodEvent(fisher, true); pump(); state(from, fisher, request.id);
        });
        return;
      }
      if (request.type === 'pier.equip') {
        if (request.itemId === null) {
          fisher.selectionVersion++; clearRod(fisher); fisher.selectedId = null; fisher.refreshNeeded = false;
          pump(); state(from, fisher, request.id); return;
        }
        await requestJob(async () => {
          if (!await refresh(from, fisher, request.itemId!)) {
            if (await authenticated(from) && currentFisher(from, fisher)) refuse(from, 'Choose your own rod from your hotbar.', request.id);
            return;
          }
          if (!currentFisher(from, fisher)) return;
          fisher.selectionVersion++; fisher.selectedId = request.itemId; rodEvent(fisher, true); pump(); state(from, fisher, request.id);
        });
        return;
      }
      if (request.type === 'pier.keep') {
        if (fisher.pendingCastId && fisher.pendingCastId !== request.castId) {
          pending(from, fisher.pendingCastId, 'Check this catch before keeping another.', request.id); return;
        }
        await requestJob(() => keep(from, fisher, request.castId, request.id));
        return;
      }
      const act = () => {
        const result = runtime.casts.act(fisher.owner, request);
        if (result.cast) owners.set(result.cast.id, { owner: fisher.owner, walkerId: from.walkerId });
        drain(result.beats); pump();
        if (result.ok) privateSend(from, { type: 'pier.action', id: request.id, cast: result.cast ? ownView(result.cast) : null });
        else refuse(from, result.message ?? 'That fishing action could not be made.', request.id,
          'castId' in request ? request.castId : undefined);
      };
      if (request.type === 'pier.draw') {
        if (fisher.pendingCastId) { pending(from, fisher.pendingCastId, 'Check this catch before casting again.', request.id); return; }
        if (!fisher.selectedId) { refuse(from, 'Take a rod from the rack, then select it in your hotbar.', request.id); return; }
        await requestJob(async () => {
          if (!await refresh(from, fisher, fisher.selectedId!) || !currentFisher(from, fisher)) {
            if (await authenticated(from) && currentFisher(from, fisher)) refuse(from, 'Select your own rod in the hotbar before casting.', request.id);
            return;
          }
          act();
        });
      } else act();
    });
    return dispose;
  } };
}
