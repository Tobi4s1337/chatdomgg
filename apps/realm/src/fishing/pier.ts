import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { KingdomIdSchema, PIER_CHAT_COMMAND, type KingdomId, type PersonId, type PierAlmanac, type PierAlmanacMark,
  type PierFeedEvent, type PierFeedWho } from '@chatdom/shared';
import type { RealmHeraldChat } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import type { ItemCatalogue, ItemStore, RealmItems } from '../items';
import type { DurableKingdom } from '../persistence';
import { assembleAlmanac, createPostgresPierAlmanacStore, type PierAlmanacStore } from './almanac';
import { createPostgresChatCatchWriter, type FishingCatchAuthority } from './catches';
import { createChatFishing, type ChatCatchCandidate, type ChatFishing, type ChatKeepResult } from './chat';
import { createFishingInstallationReader } from './installation';
import type { FishingSpecies } from './species';

const ALMANAC_CACHE_MS = 5_000, MAX_KINGDOMS = 256, MAX_LISTENERS = 64;

/** `!fish`, alone or followed by words, in any case. Emotes and other text never start a line. */
export function isFishCommand(parts: RealmHeraldChat['parts']): boolean {
  const first = parts[0];
  if (!first || first.kind !== 'text') return false;
  const text = first.text.trim().toLowerCase();
  return text === PIER_CHAT_COMMAND || text.startsWith(`${PIER_CHAT_COMMAND} `);
}

/** What `RealmEveningBridge` calls (SEAMS 5b). Returning true claims the message: no speech bubble. */
export interface RealmChatCommands {
  chat(input: RealmHeraldChat, kingdom: DurableKingdom, slot: number): boolean;
  cleanup(kingdomId: KingdomId, filter: { readonly messageIds?: readonly string[]; readonly personId?: string }): void;
}

export interface RealmPierOptions {
  readonly pool: Pool; readonly origin: 'live' | 'simulated';
  readonly store: ItemStore; readonly items: RealmItems; readonly catalogue: ItemCatalogue;
  /** Every authored species; each kingdom reads its own water's share. */
  readonly species: FishingSpecies;
  /** The same composition gate as the walkers' channel: fishing opens only where its layer is drawn. */
  visible(kingdomId: KingdomId): boolean;
  scene(kingdomId: KingdomId): RealmFoundedScene | null;
  authority(kingdomId: KingdomId): FishingCatchAuthority | null;
  where(kingdomId: KingdomId): string;
  kingdomName(kingdomId: KingdomId): string;
  readonly almanacStore?: PierAlmanacStore;
  readonly clock?: () => number;
  readonly seed?: () => number;
  readonly makeId?: () => string;
  readonly schedule?: (callback: () => void, delayMs: number) => () => void;
  /** Tests may replace the durable writer. */
  readonly keep?: (kingdom: DurableKingdom, candidate: ChatCatchCandidate, name: string | null) => Promise<ChatKeepResult>;
}

interface Bound { readonly kingdom: DurableKingdom; readonly fishing: ChatFishing }
const defaultSchedule = (callback: () => void, delay: number) => {
  const timer = setTimeout(callback, delay);
  timer.unref?.();
  return () => clearTimeout(timer);
};

/** The kingdom's pier beyond the walkers' room: chat's floats, the public feed and the Almanac. */
export function createRealmPier(options: RealmPierOptions) {
  const almanacs = options.almanacStore ?? createPostgresPierAlmanacStore({ pool: options.pool, origin: options.origin });
  const schedule = options.schedule ?? defaultSchedule;
  const bound = new Map<KingdomId, Bound>();
  const listeners = new Map<KingdomId, Set<(event: PierFeedEvent) => void>>();
  const cache = new Map<KingdomId, { at: number; value: Promise<PierAlmanac> }>();
  let closed = false;
  const now = () => options.clock?.() ?? Date.now();

  const publish = (kingdomId: KingdomId, event: PierFeedEvent) => {
    if (event.kind === 'caught' || event.kind === 'broken') cache.delete(kingdomId);
    for (const listener of [...listeners.get(kingdomId) ?? []]) { try { listener(event); } catch { /* One stalled watcher never stops the others. */ } }
  };
  const writer = (kingdom: DurableKingdom) => createPostgresChatCatchWriter({ kingdomId: kingdom.kingdomId, origin: kingdom.origin,
    store: options.store, items: options.items, catalogue: options.catalogue, species: options.species.forKingdom(kingdom.kingdomId),
    where: options.where(kingdom.kingdomId), authority: () => {
      const retained = options.authority(kingdom.kingdomId);
      return retained === kingdom && kingdom.current ? retained : null;
    } });
  const bind = (kingdom: DurableKingdom): Bound | null => {
    const kingdomId = kingdom.kingdomId, old = bound.get(kingdomId);
    if (old?.kingdom === kingdom) return old;
    old?.fishing.dispose();
    bound.delete(kingdomId);
    if (closed || kingdom.origin !== options.origin || !kingdom.current) return null;
    if (bound.size >= MAX_KINGDOMS) {
      for (const [id, entry] of bound) if (!entry.kingdom.current) { entry.fishing.dispose(); bound.delete(id); }
      if (bound.size >= MAX_KINGDOMS) return null;
    }
    const reader = createFishingInstallationReader({
      scene: () => { const scene = options.scene(kingdomId); return scene?.kingdomId === kingdomId && scene.origin === kingdom.origin ? scene : null; },
      revision: () => kingdom.world.revision,
    });
    const durable = options.keep ? null : writer(kingdom);
    const fishing = createChatFishing({ kingdomId, species: options.species.forKingdom(kingdomId),
      clock: () => kingdom.databaseNow(),
      installation: () => kingdom.current && options.visible(kingdomId) ? reader() : null,
      seed: options.seed ?? (() => randomBytes(4).readUInt32LE()), makeId: options.makeId ?? randomUUID, schedule,
      publish: event => publish(kingdomId, event),
      keep: async candidate => {
        const name = names.get(candidate.castId) ?? null;
        if (options.keep) return options.keep(kingdom, candidate, name);
        const kept = await durable!.keep(candidate, name);
        if (kept.status !== 'kept') return { status: kept.status };
        names.delete(candidate.castId);
        return { status: 'kept', kingdomFirst: kept.catch.kingdomFirst, keepsake: kept.keepsake?.number ?? null, replayed: kept.replayed };
      } });
    const entry = { kingdom, fishing };
    bound.set(kingdomId, entry);
    kingdom.onClosed(() => { if (bound.get(kingdomId) === entry) { entry.fishing.dispose(); bound.delete(kingdomId); } });
    return entry;
  };
  // The item story keeps the person's approved name even when public pages hide it.
  const names = new Map<string, string>();

  const chatCommands: RealmChatCommands = {
    chat(input, kingdom, slot) {
      if (closed || !isFishCommand(input.parts) || kingdom.kingdomId !== input.kingdomId || !options.visible(kingdom.kingdomId)) return false;
      const entry = bind(kingdom);
      if (!entry) return false;
      const frame = kingdom.publicCheckpoint().current.find(message => message.type === 'presence')?.frame;
      const name = frame?.windows.find(window => window.slot === slot && window.present)?.publicName ?? null;
      const personId = input.personId as PersonId;
      void almanacs.hidden(kingdom.kingdomId, personId).catch(() => true).then(hidden => {
        if (closed || bound.get(kingdom.kingdomId) !== entry) return;
        const before = new Set(entry.fishing.lines().map(line => line.id));
        entry.fishing.cast({ personId, messageId: input.id, slot, name: hidden ? null : name });
        if (name) for (const line of entry.fishing.lines()) if (!before.has(line.id)) {
          if (names.size >= 1024) names.delete(names.keys().next().value!);
          names.set(line.id, name);
        }
      });
      return true;
    },
    cleanup(kingdomId, filter) {
      const entry = bound.get(kingdomId);
      if (filter.messageIds) entry?.fishing.remove(filter.messageIds);
      else if (filter.personId !== undefined) {
        entry?.fishing.clear(filter.personId as PersonId);
        cache.delete(kingdomId);
        void almanacs.hide(kingdomId, filter.personId as PersonId, now()).catch(() => { /* The next moderation event writes it again. */ });
      } else entry?.fishing.clear();
    },
  };

  return {
    chatCommands,
    /** A walker's catch, for the stream: the name is checked against the pier's hidden names first. */
    async announce(kingdomId: KingdomId, input: { id: string; ownerId: PersonId; name: string | null;
      fish: { speciesId: string; lengthMm: number; weightG: number }; kingdomFirst: boolean; keepsake: number | null; at: number }) {
      if (closed) return;
      const hidden = await almanacs.hidden(kingdomId, input.ownerId).catch(() => true);
      const who: PierFeedWho = { name: hidden ? null : input.name, slot: null, colour: null };
      publish(kingdomId, { kind: 'caught', at: input.at, id: input.id, who, via: 'pier', fish: input.fish,
        kingdomFirst: input.kingdomFirst, keepsake: input.keepsake, float: null });
    },
    /** Subscribe to one kingdom's public pier beats; the first event is the current chat lines. */
    watch(raw: string, listener: (event: PierFeedEvent) => void): (() => void) | null {
      const kingdomId = KingdomIdSchema.parse(raw);
      const set = listeners.get(kingdomId) ?? new Set();
      if (closed || set.size >= MAX_LISTENERS || (!listeners.has(kingdomId) && listeners.size >= MAX_KINGDOMS)) return null;
      set.add(listener); listeners.set(kingdomId, set);
      const entry = bound.get(kingdomId);
      listener({ kind: 'lines', at: now(), lines: entry?.kingdom.current ? entry.fishing.lines() : [], cap: 8 });
      return () => { set.delete(listener); if (!set.size) listeners.delete(kingdomId); };
    },
    /** The kingdom's public Almanac, briefly cached; approved names only and no person ids. */
    almanac(raw: string): Promise<PierAlmanac> {
      const kingdomId = KingdomIdSchema.parse(raw), at = now(), cached = cache.get(kingdomId);
      if (cached && at - cached.at < ALMANAC_CACHE_MS) return cached.value;
      if (cache.size >= MAX_KINGDOMS) cache.delete(cache.keys().next().value!);
      const scene = options.scene(kingdomId);
      // Every founded pier stands on its kingdom's lake; a kingdom whose scene is not loaded is read as a lake too.
      const reader = scene ? createFishingInstallationReader({ scene: () => scene, revision: () => scene.collisionRevision }) : null;
      const installed = reader?.();
      const water = scene && !installed ? null : { water: installed?.site.water ?? 'lake' as const, biome: installed?.biome ?? null };
      const value = almanacs.rows(kingdomId).then(rows => assembleAlmanac({ kingdomId, kingdom: options.kingdomName(kingdomId),
        asOf: at, species: options.species, water, rows }));
      value.catch(() => { if (cache.get(kingdomId)?.value === value) cache.delete(kingdomId); });
      cache.set(kingdomId, { at, value });
      return value;
    },
    marks(kingdomId: KingdomId, personId: PersonId): Promise<readonly PierAlmanacMark[]> { return almanacs.marks(kingdomId, personId); },
    dispose() {
      closed = true;
      for (const entry of bound.values()) entry.fishing.dispose();
      bound.clear(); listeners.clear(); cache.clear(); names.clear();
    },
  };
}
export type RealmPier = ReturnType<typeof createRealmPier>;
