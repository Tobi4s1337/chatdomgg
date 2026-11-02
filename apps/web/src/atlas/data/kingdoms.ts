/**
 * The kingdoms founded in Chatdom, as the site's own door lists them (`GET /api/public/door`, front-door's public
 * read: `{ mode, kingdoms: [{ kingdomId, name, login }] }`). A founded kingdom's ID is its broadcaster's Twitch
 * channel ID. The Atlas reads it only to draw a found channel as the kingdom it truly is; it never grants land, and
 * a door that answers anything but `live` names no kingdom (no simulated kingdom is ever drawn on the public map).
 */
export interface FoundedKingdom { readonly kingdomId: string; readonly login: string; readonly name: string }
/** Founded kingdoms by channel ID. */
export type FoundedKingdoms = ReadonlyMap<string, FoundedKingdom>;

export const DOOR_ROUTE = '/api/public/door';
const ID = /^[1-9][0-9]{0,31}$/;
const LOGIN = /^[a-z0-9_]{1,25}$/;
/** More founded kingdoms than this in one answer is not the door's list; the Atlas then names none. */
const MAX_KINGDOMS = 10_000;
export const NO_KINGDOMS: FoundedKingdoms = new Map();

/** The founded kingdoms in a door answer; anything malformed, simulated or oversized names none. */
export function parseFoundedKingdoms(body: unknown): FoundedKingdoms {
  if (!body || typeof body !== 'object') return NO_KINGDOMS;
  const { mode, kingdoms } = body as { mode?: unknown; kingdoms?: unknown };
  if (mode !== 'live' || !Array.isArray(kingdoms) || kingdoms.length > MAX_KINGDOMS) return NO_KINGDOMS;
  const out = new Map<string, FoundedKingdom>();
  for (const raw of kingdoms) {
    if (!raw || typeof raw !== 'object') continue;
    const { kingdomId, login, name } = raw as Partial<Record<keyof FoundedKingdom, unknown>>;
    if (typeof kingdomId !== 'string' || !ID.test(kingdomId) || typeof login !== 'string' || !LOGIN.test(login) || typeof name !== 'string') continue;
    const clean = name.trim();
    if (!clean || clean.length > 80) continue;
    out.set(kingdomId, { kingdomId, login, name: clean });
  }
  return out;
}

/** The founded kingdom of a channel, only when the door names it under the same login the register gave. */
export function kingdomOf(kingdoms: FoundedKingdoms, channel: { id: string; login: string | null }): FoundedKingdom | null {
  const kingdom = kingdoms.get(channel.id);
  return kingdom && channel.login === kingdom.login ? kingdom : null;
}

/** Read the door once. Every failure (no door on this host, a refusal, a timeout) names no kingdom. */
export async function readFoundedKingdoms(signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<FoundedKingdoms> {
  try {
    const timeout = AbortSignal.timeout(8_000);
    const response = await fetcher(DOOR_ROUTE, { cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json' }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok || !/json/i.test(response.headers.get('content-type') ?? '')) return NO_KINGDOMS;
    return parseFoundedKingdoms(await response.json());
  } catch {
    return NO_KINGDOMS;
  }
}
