import type { Directory, DirectoryRefusal, Lookup } from './directory';
import { queryKey } from './normalize';
import { MAX_RESULTS, type CardReply, type SearchReply } from './schema';
import { LookupUnavailable, type TwitchLookup } from './twitch-lookup';

const CLIENT_CAPACITY = 6;
const CLIENT_WINDOW_MS = 60_000;
const MAX_CLIENTS = 10_000;

interface ClientBucket { tokens: number; at: number }

export interface DirectoryFallbackOptions {
  now?: () => number;
}

/**
 * The immutable survey always answers first. Only a miss may ask Twitch; ephemeral answers are projected through
 * the same current visibility gate as survey entries, and never become holdings or a new observation revision.
 */
export class DirectoryFallback {
  private readonly clients = new Map<string, ClientBucket>();
  private readonly now: () => number;

  constructor(private readonly twitch: TwitchLookup, options: DirectoryFallbackOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  private admit(ip: string, at: number): void {
    const held = this.clients.get(ip);
    const bucket = held ?? { tokens: CLIENT_CAPACITY, at };
    bucket.tokens = Math.min(CLIENT_CAPACITY, bucket.tokens + Math.max(0, at - bucket.at) * CLIENT_CAPACITY / CLIENT_WINDOW_MS);
    bucket.at = Math.max(bucket.at, at);
    // Refresh insertion order, so the bounded table retains clients who are still asking.
    this.clients.delete(ip);
    this.clients.set(ip, bucket);
    while (this.clients.size > MAX_CLIENTS) this.clients.delete(this.clients.keys().next().value!);
    if (bucket.tokens < 1) {
      throw new LookupUnavailable('limited', Math.max(1, Math.ceil((1 - bucket.tokens) * CLIENT_WINDOW_MS / CLIENT_CAPACITY / 1_000)));
    }
    bucket.tokens--;
  }

  async search(register: Directory, query: string, withheld: ReadonlySet<string>, ip: string, portraits: boolean): Promise<SearchReply | DirectoryRefusal> {
    const at = this.now();
    const surveyed = register.search(query, withheld, at, portraits, true);
    if (typeof surveyed === 'string') return surveyed;
    const normalized = queryKey(query);
    if (!normalized.ok) return normalized.reason;
    const raw = query.trim();
    // Adapter selectors are private protocol, never commands accepted from a public search string.
    if (/^(?:id|login):/i.test(raw)) return surveyed;
    const login = raw.toLowerCase();
    const validLogin = /^[a-z0-9_]{1,25}$/i.test(raw);
    const hasLocal = surveyed.results.length > 0;
    if (hasLocal && (!validLogin || surveyed.results.some(result => result.channel.login === login))) return surveyed;
    // A known name denied by the gate is a miss, never an invitation to recover it from another source.
    if (validLogin && register.has({ login })) return surveyed;
    // Local prefix matches must not hide an exact login outside the survey. This probe asks Get Users only.
    const externalQuery = hasLocal ? `login:${login}` : raw;
    try {
      if (!this.twitch.cached?.(externalQuery)) this.admit(ip, at);
      const facts = await this.twitch.lookup(externalQuery);
      const cards = facts.filter(channel => !hasLocal || channel.login.toLowerCase() === login)
        .map(channel => register.external(channel, withheld, this.now(), portraits)).filter((card): card is CardReply => card !== null);
      if (hasLocal && cards.length === 0) return surveyed;
      const external = cards.map(card => ({
        channel: card.channel,
        ...(portraits ? { portrait: card.portrait ?? null } : {}),
        ...(card.position ? { position: card.position } : {}),
        average: card.average,
        language: card.language,
      }));
      const seen = new Set<string>();
      const chosen = [...external, ...surveyed.results].filter(result => {
        if (seen.has(result.channel.id)) return false;
        seen.add(result.channel.id);
        return true;
      });
      return {
        ...surveyed,
        servedAt: this.now(),
        results: chosen.slice(0, MAX_RESULTS),
        more: surveyed.more || chosen.length > MAX_RESULTS,
      };
    } catch (error) {
      if (hasLocal) return surveyed;
      return { ...surveyed, servedAt: this.now(), unavailable: error instanceof LookupUnavailable ? error.reason : 'upstream' };
    }
  }

  async card(register: Directory, lookup: Lookup, withheld: ReadonlySet<string>, ip: string, portraits: boolean): Promise<CardReply | DirectoryRefusal> {
    const at = this.now();
    const surveyed = register.card(lookup, withheld, at, portraits, true);
    if (typeof surveyed !== 'string' || surveyed !== 'not-found' || 'dab' in lookup || register.has(lookup)) return surveyed;
    if ('id' in lookup && !register.allowed(lookup.id, withheld)) return 'not-found';
    const query = 'id' in lookup ? `id:${lookup.id}` : lookup.login;
    if (!this.twitch.cached?.(query)) this.admit(ip, at);
    const facts = await this.twitch.lookup(query);
    const found = facts.find(channel => 'id' in lookup ? channel.id === lookup.id : channel.login.toLowerCase() === lookup.login.toLowerCase());
    if (!found) return 'not-found';
    return register.external(found, withheld, this.now(), portraits) ?? 'not-found';
  }
}
