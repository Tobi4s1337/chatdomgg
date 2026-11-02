import type { Pool } from 'pg';
import { RealmCitizenFactsSchema, TwitchPictureUrlSchema, type KingdomId, type PersonId, type RealmCitizenFacts, type RealmCitizenHome } from '@chatdom/shared';
import { UNNAMED_KINGDOM } from './entitlements';
import type { LookOrigin } from './ports';

/*
 * The card's facts: what the realm really knows about a signed-in person. Their homes come from their deeds
 * (`realm_deeds`, never void, of this realm's origin), the kingdoms' names from the host-approved map, and their
 * picture from Twitch's public profile, read with the app's own token. A field without a source stays null or empty.
 */

/** A home in a kingdom with no approved name, seen from another kingdom (the asked one reads `this kingdom`). */
export const UNNAMED_ELSEWHERE = 'a kingdom not yet named';
/** How long a card waits for Twitch before it is drawn without the picture; the lookup still finishes and is kept. */
export const PICTURE_BUDGET_MS = 2_000;
const HOMES_SHOWN = 3;

export interface CitizenFacts {
  /** The person's facts as seen from `kingdomId` (null: no kingdom asked). A throw is storage trouble; null is nothing known. */
  facts(personId: PersonId, kingdomId: KingdomId | null, signal?: AbortSignal): Promise<RealmCitizenFacts | null>;
}

/** A person's Twitch profile picture, or null when Twitch is not configured, cannot answer, or answers with anything else. */
export interface TwitchPictures { picture(personId: PersonId, signal?: AbortSignal): Promise<string | null> }

/** One non-void deed, as the facts are made from it. */
export interface CitizenDeed {
  readonly kingdomId: KingdomId;
  readonly plotId: string;
  readonly street: string;
  readonly allocatedMs: number;
}

const fits = (value: string) => value.length >= 1 && value.length <= 128;

/**
 * Shapes deeds into facts: the asked kingdom's home first, then the others by when they were granted, at most three.
 * `since` is the asked kingdom's earliest deed. Deeds whose street or plot cannot be shown are left out.
 */
export function citizenFactsFrom(input: {
  readonly deeds: readonly CitizenDeed[];
  readonly kingdomId: KingdomId;
  readonly name: (kingdomId: KingdomId) => string | undefined;
  readonly picture: string | null;
}): RealmCitizenFacts {
  const here = input.kingdomId;
  const named = (id: KingdomId) => {
    const name = input.name(id)?.trim();
    return name && fits(name) ? name : id === here ? UNNAMED_KINGDOM : UNNAMED_ELSEWHERE;
  };
  const shown = input.deeds
    .filter(deed => fits(deed.street.trim()) && fits(deed.plotId) && Number.isSafeInteger(deed.allocatedMs) && deed.allocatedMs >= 0)
    .slice().sort((a, b) => Number(b.kingdomId === here) - Number(a.kingdomId === here) || a.allocatedMs - b.allocatedMs || (a.kingdomId < b.kingdomId ? -1 : 1));
  const seen = new Set<KingdomId>();
  const homes: RealmCitizenHome[] = [];
  for (const deed of shown) {
    if (seen.has(deed.kingdomId) || homes.length >= HOMES_SHOWN) continue;
    seen.add(deed.kingdomId);
    homes.push({ kingdomId: deed.kingdomId, kingdomName: named(deed.kingdomId), street: deed.street.trim(), plotId: deed.plotId, since: deed.allocatedMs, here: deed.kingdomId === here });
  }
  const picture = input.picture !== null && TwitchPictureUrlSchema.safeParse(input.picture).success ? input.picture : null;
  return RealmCitizenFactsSchema.parse({ picture, since: homes.find(home => home.here)?.since ?? null, homes });
}

/** Waits for the picture at most `budget` ms; a slow Twitch draws the card without it this time. */
function within<T>(promise: Promise<T>, budget: number, otherwise: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise, new Promise<T>(resolve => { timer = setTimeout(() => resolve(otherwise), budget); timer.unref?.(); })])
    .finally(() => clearTimeout(timer));
}

/** The facts from the realm schema: the person's deeds of this realm's origin, never void. */
export function createPostgresCitizenFacts(options: {
  readonly pool: Pick<Pool, 'query'>;
  readonly origin: LookOrigin;
  /** The host-approved kingdom name, as the entry gate serves it. */
  readonly name: (kingdomId: KingdomId) => string | undefined;
  readonly pictures: TwitchPictures;
  readonly pictureBudgetMs?: number;
}): CitizenFacts {
  const budget = options.pictureBudgetMs ?? PICTURE_BUDGET_MS;
  return {
    async facts(personId, kingdomId, signal) {
      if (!kingdomId) return null;
      const picture = within(options.pictures.picture(personId, signal).catch(() => null), budget, null);
      const result = await options.pool.query<{ kingdom_id: string; plot_id: string; placement: string; allocated_ms: string | number }>(`
        SELECT kingdom_id, plot_id, placement, allocated_ms FROM realm_deeds
        WHERE person_id = $1 AND origin = $2 AND status <> 'void' ORDER BY allocated_ms ASC LIMIT 8`, [personId, options.origin]);
      const deeds: CitizenDeed[] = [];
      for (const row of result.rows) {
        let street: unknown;
        try { street = (JSON.parse(row.placement) as { street?: unknown }).street; } catch { continue; }
        const allocatedMs = Number(row.allocated_ms);
        if (typeof street !== 'string') continue;
        deeds.push({ kingdomId: row.kingdom_id as KingdomId, plotId: row.plot_id, street, allocatedMs });
      }
      return citizenFactsFrom({ deeds, kingdomId, name: options.name, picture: await picture });
    },
  };
}

/** In-process facts for tests and benches, with the same shaping as Postgres. */
export class MemoryCitizenFacts implements CitizenFacts {
  private readonly deeds = new Map<PersonId, CitizenDeed[]>();
  private readonly pictures = new Map<PersonId, string>();
  /** Set to make every call fail as storage trouble would. */
  failing = false;

  constructor(private readonly name: (kingdomId: KingdomId) => string | undefined = () => undefined) {}

  settle(personId: PersonId, deed: CitizenDeed): this {
    this.deeds.set(personId, [...(this.deeds.get(personId) ?? []), deed]);
    return this;
  }

  picture(personId: PersonId, url: string): this { this.pictures.set(personId, url); return this; }

  async facts(personId: PersonId, kingdomId: KingdomId | null): Promise<RealmCitizenFacts | null> {
    if (this.failing) throw new Error('SIMULATED storage failure');
    if (!kingdomId) return null;
    return citizenFactsFrom({ deeds: this.deeds.get(personId) ?? [], kingdomId, name: this.name, picture: this.pictures.get(personId) ?? null });
  }
}

const TTL_MS = 10 * 60_000, LIMIT = 5_000, TIMEOUT_MS = 5_000;

/** The app's Twitch credentials from the process, or null when either is missing. Never logged. */
export function twitchCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): { readonly clientId: string; readonly clientSecret: string } | null {
  const clientId = env.TWITCH_CLIENT_ID?.trim(), clientSecret = env.TWITCH_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * Profile pictures from Helix `users?id=`, with a client-credentials app token: public facts, no user token. Answers
 * are kept ten minutes per person; a failed read is an absence, never a guess, and is asked again next time. Only a
 * URL on Twitch's static CDN is accepted.
 */
export function createTwitchPictures(credentials: { readonly clientId: string; readonly clientSecret: string } | null, fetcher: typeof fetch = fetch): TwitchPictures {
  let token: { value: string; until: number } | null = null;
  let tokenRequest: Promise<string | null> | null = null;
  const cache = new Map<string, { at: number; picture: string | null }>();
  const asking = new Map<string, Promise<string | null>>();

  const appToken = async (): Promise<string | null> => {
    if (!credentials) return null;
    if (token && token.until > Date.now()) return token.value;
    tokenRequest ??= (async () => {
      try {
        const response = await fetcher('https://id.twitch.tv/oauth2/token', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: credentials.clientId, client_secret: credentials.clientSecret, grant_type: 'client_credentials' }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) return null;
        const body = await response.json() as { access_token?: unknown; expires_in?: unknown };
        if (typeof body.access_token !== 'string' || !body.access_token) return null;
        const seconds = typeof body.expires_in === 'number' ? body.expires_in : 3600;
        token = { value: body.access_token, until: Date.now() + Math.max(60, seconds - 300) * 1000 };
        return token.value;
      } catch { return null; } finally { tokenRequest = null; }
    })();
    return tokenRequest;
  };

  const ask = async (personId: string, signal?: AbortSignal): Promise<string | null> => {
    const value = await appToken();
    if (!value || !credentials) return null;
    try {
      const response = await fetcher(`https://api.twitch.tv/helix/users?id=${encodeURIComponent(personId)}`, {
        headers: { Authorization: `Bearer ${value}`, 'Client-Id': credentials.clientId },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 401) { token = null; return null; }
      if (!response.ok) return null;
      const body = await response.json() as { data?: { id?: unknown; profile_image_url?: unknown }[] };
      if (!Array.isArray(body?.data)) return null;
      const user = body.data.find(entry => entry?.id === personId);
      const url = user?.profile_image_url;
      const picture = typeof url === 'string' && TwitchPictureUrlSchema.safeParse(url).success ? url : null;
      // Only a definite answer is remembered (a person Twitch does not know, too); a failed read is asked again.
      cache.set(personId, { at: Date.now(), picture });
      if (cache.size > LIMIT) cache.delete(cache.keys().next().value!);
      return picture;
    } catch { return null; }
  };

  return {
    async picture(personId, signal) {
      if (!credentials) return null;
      const cached = cache.get(personId);
      if (cached && Date.now() - cached.at < TTL_MS) return cached.picture;
      let pending = asking.get(personId);
      if (!pending) {
        pending = ask(personId, signal).finally(() => asking.delete(personId));
        asking.set(personId, pending);
      }
      return pending;
    },
  };
}
