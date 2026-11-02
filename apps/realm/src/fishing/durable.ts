import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { ItemRecord, KingdomId, PersonId } from '@chatdom/shared';
import type { RealmFoundedScene } from '@chatdom/world';
import type { RealmPrincipal } from '@chatdom/shared/realm';
import type { RealmReadiness } from '../diagnostics/readiness';
import type { ItemCatalogue, ItemStore, RealmItems } from '../items';
import type { RealmChannelSender, RealmRoomChannel } from '../room-channels';
import { createFishingCasts } from './cast';
import { createFishingRoomChannel, type FishingRoomChannelOptions } from './channel';
import { createPostgresFishingCatchWriter, type FishingCatchAuthority } from './catches';
import { createPostgresFishingAdmission } from './entry';
import { createFishingInstallationReader } from './installation';
import { createPostgresRodRack, isEquippedWillowRod, WILLOW_ROD_ID } from './rod';
import { readRodHistory } from './rod-history';
import type { FishingSpecies } from './species';
import type { RealmPier } from './pier';

export interface DurableFishingChannelOptions {
  readonly pool: Pool; readonly origin: 'live' | 'simulated'; readonly store: ItemStore; readonly items: RealmItems;
  readonly catalogue: ItemCatalogue; readonly species: FishingSpecies;
  readonly readiness: Pick<RealmReadiness, 'held'>;
  /** Actual retained handle and adopted scene from the durable boot; never retain/open another writer here. */
  authority(kingdomId: KingdomId): FishingCatchAuthority | null;
  scene(kingdomId: KingdomId): RealmFoundedScene | null;
  /** Explicit composition gate. Until the mood is drawn, the production fishing path stays closed. */
  visible(kingdomId: KingdomId): boolean;
  biome?(kingdomId: KingdomId): string | null;
  where?(kingdomId: KingdomId): string;
  readonly clock?: () => number;
  readonly seed?: () => number;
  readonly makeId?: () => string;
  readonly schedule?: FishingRoomChannelOptions['schedule'];
  /** The kingdom's pier beyond the room: personal Almanac marks and the public feed. */
  readonly pier?: Pick<RealmPier, 'marks' | 'announce'>;
}

interface RodFact {
  readonly itemId: string; readonly walkerId: string; readonly principal: RealmPrincipal; readonly until: number;
  /** The original socket capability stays false after replacement, even if its public walker id is reused. */
  readonly present: () => boolean; readonly token: string;
}

/** Production-ready composition, deliberately not mounted until the world presentation is present. */
export function createDurableFishingChannel(options: DurableFishingChannelOptions): RealmRoomChannel {
  const admit = createPostgresFishingAdmission(options);
  return createFishingRoomChannel({
    ...(options.schedule ? { schedule: options.schedule } : {}),
    bind(room, selected) {
      const retained = options.authority(room.kingdomId);
      if (!retained || room.origin !== options.origin || retained.origin !== room.origin || retained.kingdomId !== room.kingdomId) throw new Error('The fishing room needs its actual retained kingdom.');
      let closed = false, lastTime = 0;
      const now = () => {
        const value = (options.clock ?? Date.now)();
        if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid fishing time.');
        return lastTime = Math.max(lastTime, value);
      };
      const live = () => !closed && retained.current && options.authority(room.kingdomId) === retained && !options.readiness.held();
      const source = createFishingInstallationReader({
        scene: () => {
          const scene = options.scene(room.kingdomId);
          return scene?.kingdomId === room.kingdomId && scene.origin === room.origin ? scene : null;
        },
        revision: () => room.world().revision,
        biome: () => options.biome?.(room.kingdomId) ?? null,
      });
      const installation = () => live() && options.visible(room.kingdomId) ? source() : null;
      const facts = new Map<PersonId, RodFact>();
      /** Earned reach, read with the rod's history; the cast reads it synchronously. */
      const reaches = new Map<PersonId, number>();
      const listeners = new Set<(personId: PersonId) => void>();
      const forget = (from: RealmChannelSender) => {
        const fact = facts.get(from.principal.personId);
        if (fact?.walkerId === from.walkerId && fact.principal === from.principal) facts.delete(from.principal.personId);
      };
      const remember = (from: RealmChannelSender, item: ItemRecord | null) => {
        const owner = from.principal.personId;
        if (!live() || !from.present() || !isEquippedWillowRod(item, from)) { forget(from); return null; }
        if (!facts.has(owner) && facts.size >= 300) {
          for (const [person, fact] of facts) if (fact.until <= now() || !room.person(person)?.present()) facts.delete(person);
          if (facts.size >= 300) return null;
        }
        const previous = facts.get(owner);
        const token = previous?.walkerId === from.walkerId && previous.principal === from.principal
          && previous.itemId === item.id && previous.present() ? previous.token : randomUUID();
        facts.set(owner, { itemId: item.id, walkerId: from.walkerId, principal: from.principal, until: now() + 2000, present: from.present, token });
        return item;
      };
      // This kingdom's own water: the same view rolls the bite and audits the catch.
      const species = options.species.forKingdom(room.kingdomId);
      const casts = createFishingCasts({ kingdomId: room.kingdomId, clock: now, species, installation,
        makeId: options.makeId ?? randomUUID, seed: options.seed ?? (() => randomBytes(4).readUInt32LE()),
        seat(personId) {
          const from = live() ? room.person(personId) : null, fact = facts.get(personId);
          if (!from || !fact || fact.until <= now() || fact.walkerId !== from.walkerId || fact.principal !== from.principal
            || selected(personId, from.walkerId) !== fact.itemId || !fact.present() || !from.present()) return null;
          const pose = from.pose();
          return pose ? { token: fact.token, pose, ownsRod: true, reachM: reaches.get(personId) ?? 0 } : null;
        },
      });
      const stopItems = options.items.onChange((personId, kingdomId, items) => {
        if (closed || kingdomId !== room.kingdomId || !items.some(item => item.origin === room.origin && item.defId === WILLOW_ROD_ID)) return;
        facts.delete(personId);
        for (const listener of listeners) listener(personId);
      });
      const where = options.where?.(room.kingdomId) ?? 'the pier';
      const authority = () => live() ? retained : null;
      const writer = createPostgresFishingCatchWriter({ kingdomId: room.kingdomId, origin: room.origin,
        store: options.store, items: options.items, catalogue: options.catalogue, species, where,
        authority, candidate: personId => casts.candidate(personId), finish: (personId, castId) => casts.finish(personId, castId),
        async admit(from, tx) {
          const admission = await admit(from, tx);
          if (!admission || !live() || !from.present()) return null;
          const itemId = selected(from.principal.personId, from.walkerId);
          const item = itemId ? await tx.get(itemId) : null;
          remember(from, item);
          // Existing receipts remain recoverable without a rod. A new candidate must still pass casts.seat.
          return live() && from.present() ? admission : null;
        },
      });
      const takeRod = createPostgresRodRack({ kingdomId: room.kingdomId, origin: room.origin,
        store: options.store, items: options.items, where, authority, installation, admit, now });
      return {
        casts, now, installation, takeRod,
        ...(options.pier ? {
          marks: async (from: RealmChannelSender) => live() && from.present() ? options.pier!.marks(room.kingdomId, from.principal.personId) : [],
          announce: (kept: Parameters<NonNullable<ReturnType<FishingRoomChannelOptions['bind']>['announce']>>[0]) => {
            void options.pier!.announce(room.kingdomId, { id: kept.catch.id, ownerId: kept.catch.ownerId,
              name: kept.item.story.by?.name ?? null, fish: { speciesId: kept.catch.speciesId, lengthMm: kept.catch.fish.lengthMm,
                weightG: kept.catch.fish.weightG }, kingdomFirst: kept.catch.kingdomFirst, keepsake: kept.keepsake?.number ?? null,
              at: kept.catch.caughtAt }).catch(() => { /* The stream misses one tag; the catch is kept. */ });
          },
        } : {}),
        keep: (from, castId) => writer.keep(from, castId),
        async rodHistory(from) {
          const history = await readRodHistory(options.pool, { kingdomId: room.kingdomId, origin: room.origin, ownerId: from.principal.personId, species });
          if (reaches.size >= 300 && !reaches.has(from.principal.personId)) {
            for (const person of reaches.keys()) if (!room.person(person)) reaches.delete(person);
          }
          if (reaches.size < 300 || reaches.has(from.principal.personId)) reaches.set(from.principal.personId, history.reachM);
          return history;
        },
        async refreshRod(from, itemId) {
          if (!live() || !await from.current() || !live() || !from.present()) { forget(from); return null; }
          const item = await options.items.get(itemId);
          if (!live() || !await from.current() || !live() || !from.present()) { forget(from); return null; }
          return remember(from, item);
        },
        onRodChange(listener) { if (closed) return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
        dispose() { if (closed) return; closed = true; stopItems(); listeners.clear(); facts.clear(); reaches.clear(); casts.dispose(); },
      };
    },
  });
}
