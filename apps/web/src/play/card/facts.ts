import { KingdomIdSchema, REALM_LOOK_ROUTES, RealmLookMineReplySchema, type KingdomId, type RealmCitizenFacts } from '@chatdom/shared';
import type { ForgedSource, ForgedThing, PlayContext } from '../slots';

/*
 * The facts behind "Your card": what the realm really knows about the signed-in person, read from their own
 * `GET /api/realm/looks/me?kingdom=<id>`. Nothing here is invented: a fact the realm does not give is left off the card.
 */

export type CitizenFactsResult =
  | { readonly kind: 'ready'; readonly facts: RealmCitizenFacts }
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'unavailable' };

const TIMEOUT_MS = 5_000;

/** Reads the card's facts for one kingdom. Anything but a trusted answer with facts is `unavailable`; an abort rejects. */
export async function loadCitizenFacts(kingdomId: KingdomId, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<CitizenFactsResult> {
  const id = KingdomIdSchema.safeParse(kingdomId);
  if (!id.success) return { kind: 'unavailable' };
  let response: Response;
  try {
    response = await fetcher(`${REALM_LOOK_ROUTES.mine}?kingdom=${encodeURIComponent(id.data)}`, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    return { kind: 'unavailable' };
  }
  if (response.status === 401) return { kind: 'anonymous' };
  if (!response.ok) return { kind: 'unavailable' };
  let body: unknown;
  try { body = await response.json(); } catch (error) { if (signal.aborted) throw error; return { kind: 'unavailable' }; }
  return citizenFactsOf(body);
}

/** The card's reading of a `GET /me` body. A reply without facts (the realm could not read them) is `unavailable`. */
export function citizenFactsOf(body: unknown): CitizenFactsResult {
  const reply = RealmLookMineReplySchema.safeParse(body);
  if (!reply.success) return { kind: 'unavailable' };
  if (reply.data.status === 'anonymous') return { kind: 'anonymous' };
  return reply.data.citizen ? { kind: 'ready', facts: reply.data.citizen } : { kind: 'unavailable' };
}

/* ---------------------------------------------------------------- What the card draws */

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
/** '2 November 2026'. */
export const cardDate = (ms: number): string => DATE.format(new Date(ms));

/** The first letter of a name, for the empty frame: a whole grapheme, upper-cased where the script has case. */
export function initialOf(name: string): string {
  const trimmed = name.trim().replace(/^[^\p{L}\p{N}]+/u, '') || name.trim();
  if (!trimmed) return '';
  const first = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(trimmed)[Symbol.iterator]().next().value?.segment ?? ''
    : [...trimmed][0] ?? '';
  return first.toLocaleUpperCase('en-GB');
}

export interface CardHome { readonly key: string; readonly street: string; readonly kingdom: string; readonly here: boolean; readonly since: string }
export interface CardView {
  /** The approved name, or null when the card does not know it. */
  readonly name: string | null;
  readonly initial: string;
  readonly picture: string | null;
  /** 'Citizen of Lanternmere since 2 November 2026', only when the home here has a date. */
  readonly since: string | null;
  readonly homes: readonly CardHome[];
  /** The one line under the name while there is nothing else to say. */
  readonly note: string | null;
  readonly state: 'loading' | CitizenFactsResult['kind'];
}

export const CARD_WORDS = {
  loading: 'Reading the kingdom’s rolls…',
  unavailable: 'Your card cannot be read just now.',
  anonymous: 'Sign in to keep a card here.',
  homeless: 'No home has been granted to you yet.',
  here: 'This kingdom',
} as const;

/** Everything the card shows, from the approved name and the realm's answer; no field without a source. */
export function cardView(self: PlayContext['self'], result: CitizenFactsResult | null): CardView {
  const name = self?.publicName.trim() || null;
  const base = { name, initial: name ? initialOf(name) : '', picture: null, since: null, homes: [] as CardHome[] };
  if (!result) return { ...base, note: CARD_WORDS.loading, state: 'loading' };
  if (result.kind === 'anonymous') return { ...base, name: null, initial: '', note: CARD_WORDS.anonymous, state: 'anonymous' };
  if (result.kind === 'unavailable') return { ...base, note: CARD_WORDS.unavailable, state: 'unavailable' };
  const { facts } = result;
  const here = facts.homes.find(home => home.here);
  const homes = facts.homes.map(home => ({ key: `${home.kingdomId}:${home.plotId}`, street: home.street,
    kingdom: home.here ? CARD_WORDS.here : home.kingdomName, here: home.here, since: cardDate(home.since) }));
  return {
    ...base, picture: facts.picture, homes, state: 'ready',
    since: facts.since !== null ? `Citizen of ${here?.kingdomName ?? 'this kingdom'} since ${cardDate(facts.since)}` : null,
    note: homes.length ? null : CARD_WORDS.homeless,
  };
}

/* ---------------------------------------------------------------- The shelf */

/**
 * What you forged, newest first, when a forged source is registered and answers with real pieces. Null otherwise
 * (no source, nothing forged, or it could not answer): then the card has no shelf at all.
 */
export async function loadForged(source: ForgedSource | null, ctx: PlayContext, signal: AbortSignal): Promise<readonly ForgedThing[] | null> {
  if (!source) return null;
  let things: readonly ForgedThing[];
  try { things = await source.mine(ctx, signal); } catch { return null; }
  if (signal.aborted || !Array.isArray(things)) return null;
  const real = things.filter(thing => thing && typeof thing.id === 'string' && thing.id && typeof thing.title === 'string' && thing.title.trim()
    && typeof thing.plaque === 'string' && Number.isFinite(thing.forgedAt));
  const seen = new Set<string>();
  // The source's first word on a piece stands; a repeated id is the same piece again.
  const unique = real.filter(thing => !seen.has(thing.id) && !!seen.add(thing.id));
  return unique.length ? unique.sort((a, b) => b.forgedAt - a.forgedAt) : null;
}
