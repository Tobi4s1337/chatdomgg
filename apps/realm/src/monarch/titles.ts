import type { KingdomId } from '@chatdom/shared';
import { DEFAULT_MONARCH_TITLE, monarchTitleOf, type MonarchTitle } from '@chatdom/shared/realm';
import type { RealmDatabase } from '../persistence';

type Origin = 'live' | 'simulated';
type Listener = (title: MonarchTitle) => void;

/**
 * The kingdom's monarch, as the realm knows them: the title the streamer chose (default "Monarch") and the
 * broadcaster's own approved public name. Writes come only from the verified broadcaster (channel.ts).
 */
export interface RealmMonarchTitles {
  title(kingdomId: KingdomId): Promise<MonarchTitle>;
  choose(kingdomId: KingdomId, title: MonarchTitle): Promise<MonarchTitle>;
  /** The broadcaster's approved public name: their own sign-in first, else the name Twitch ingress observed. */
  name(kingdomId: KingdomId): Promise<string | null>;
  /** Called after a committed choice, so a room can re-crown its walking monarch at once. */
  watch(kingdomId: KingdomId, listener: Listener): () => void;
}

function listeners() {
  const watchers = new Map<string, Set<Listener>>();
  return {
    watch(kingdomId: KingdomId, listener: Listener) {
      let set = watchers.get(kingdomId);
      if (!set) watchers.set(kingdomId, set = new Set());
      set.add(listener);
      return () => { set!.delete(listener); if (!set!.size) watchers.delete(kingdomId); };
    },
    tell(kingdomId: KingdomId, title: MonarchTitle) {
      for (const listener of [...watchers.get(kingdomId) ?? []]) { try { listener(title); } catch { /* One room never blocks another. */ } }
    },
  };
}

/** Postgres-backed titles in the realm's own schema (migration 0015_realm_monarch). */
export function createPostgresMonarchTitles(db: RealmDatabase, origin: Origin, clock: () => number = Date.now): RealmMonarchTitles {
  const { watch, tell } = listeners(), cache = new Map<string, MonarchTitle>();
  return {
    async title(kingdomId) {
      const known = cache.get(kingdomId);
      if (known) return known;
      const row = (await db.query<{ title: string }>('SELECT title FROM realm_monarch_titles WHERE origin = $1 AND kingdom_id = $2', [origin, kingdomId])).rows[0];
      const title = monarchTitleOf(row?.title ?? DEFAULT_MONARCH_TITLE);
      cache.set(kingdomId, title);
      return title;
    },
    async choose(kingdomId, chosen) {
      const title = monarchTitleOf(chosen);
      await db.query(`INSERT INTO realm_monarch_titles (origin, kingdom_id, title, updated_ms) VALUES ($1, $2, $3, $4)
        ON CONFLICT (origin, kingdom_id) DO UPDATE SET title = excluded.title, updated_ms = excluded.updated_ms`, [origin, kingdomId, title, Math.floor(clock())]);
      cache.set(kingdomId, title);
      tell(kingdomId, title);
      return title;
    },
    async name(kingdomId) {
      const own = (await db.query<{ public_name: string | null }>('SELECT public_name FROM realm_persons WHERE person_id = $1 AND origin = $2', [kingdomId, origin])).rows[0];
      // An existing anonymous presentation is intentional; never replace it with an observed name.
      if (own) return own.public_name?.trim().slice(0, 64) || null;
      const observed = (await db.query<{ public_name: string }>('SELECT public_name FROM realm_citizen_names WHERE person_id = $1 AND origin = $2', [kingdomId, origin])).rows[0]?.public_name;
      return observed?.trim() ? observed.trim().slice(0, 64) : null;
    },
    watch,
  };
}

/** In-process titles for benches and tests: the same rules, nothing persisted. */
export function createMemoryMonarchTitles(names: ReadonlyMap<string, string> = new Map()): RealmMonarchTitles {
  const { watch, tell } = listeners(), titles = new Map<string, MonarchTitle>();
  return {
    async title(kingdomId) { return titles.get(kingdomId) ?? DEFAULT_MONARCH_TITLE; },
    async choose(kingdomId, chosen) { const title = monarchTitleOf(chosen); titles.set(kingdomId, title); tell(kingdomId, title); return title; },
    async name(kingdomId) { return names.get(kingdomId)?.trim() || null; },
    watch,
  };
}
