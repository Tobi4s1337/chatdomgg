import { sha256, toHex, utf8 } from '../heraldry/sha256';
import { PORTRAIT_MAX_AGE_MS, PORTRAIT_URL, type ChannelPortrait } from './portrait';
export type { ChannelPortrait } from './portrait';
import {
  array, CHANNEL_ID, epoch, fail, int, literal, nullable, oneOf, PREVIEW_ID, REVISION, shape, strict, text, type Check,
  type PreviewSource,
} from './preview';

/**
 * The register of a survey preview as the Atlas service answers it (`/map-data/v1/preview/<id>/search|card|road`):
 * search, public channel cards and roads. Every reply was projected at request time through the visibility gate,
 * the withheld list; names remain served between survey refreshes, and is validated strictly again here before anything is
 * shown. Nothing in it concerns a person: channels, observed audiences and the raid aggregates between them.
 */

/** `mapped` holds land here; `waiting` was seen and named but holds none; `unseen` is a raid counterpart below the sweep floor. */
export type Place = 'mapped' | 'waiting' | 'unseen';

export interface ChannelFace {
  id: string;
  login: string | null;
  name: string | null;
  freshUntil: number | null;
  place: Place;
  ordinal: number | null;
  tier: number | null;
  region: number | null;
  realm: number | null;
}

export interface SearchResult { channel: ChannelFace; portrait?: ChannelPortrait | null; average: number; language: string }

interface Reply { version: 1; preview: string; revision: string; servedAt: number; asOf: number }

export interface SearchReply extends Reply {
  kind: 'chatdom-atlas-search';
  key: string;
  results: SearchResult[];
  more: boolean;
}

export interface RoadWindow { from: number; to: number }
export interface Coverage { raidWatch: { enabled: boolean; watching: number; liveCandidates: number }; contentLabels: 'not-collected' }
export interface CardRoad { other: ChannelFace; sent: number; received: number; travellers: number; lastAt: number }
export interface StreamFacts { live: boolean; game: string | null; title: string | null; viewers: number | null; startedAt: number | null }

export interface CardReply extends Reply {
  kind: 'chatdom-atlas-card';
  channel: ChannelFace;
  portrait?: ChannelPortrait | null;
  average: number;
  language: string;
  firstSeenAt: number;
  lastLiveAt: number;
  stream: StreamFacts | null;
  roads: { window: RoadWindow; total: number; strongest: CardRoad[] };
  coverage: Coverage;
}

export interface RoadTally { raids: number; travellers: number; lastAt: number }

export interface RoadReply extends Reply {
  kind: 'chatdom-atlas-road';
  a: ChannelFace;
  b: ChannelFace;
  aToB: RoadTally | null;
  bToA: RoadTally | null;
  window: RoadWindow;
  coverage: Coverage;
}

export type Lookup = { id: string } | { login: string } | { dab: string };

/**
 * Why the register gave no answer: `not-found` (unknown, withheld, gone or gambling, all alike), `warming` (still
 * being read; try again after `retryAfter`), `refused` (names withheld while moderation cannot be read),
 * `bad-query`, `unavailable` (service unreachable or failing) or `invalid` (a reply that failed validation).
 */
export class DirectoryError extends Error {
  constructor(readonly reason: 'not-found' | 'warming' | 'refused' | 'bad-query' | 'unavailable' | 'invalid', message: string, readonly retryAfter = 0) {
    super(message);
    this.name = 'DirectoryError';
  }
}

/** Results one search returns at most (the service's own bound). */
export const MAX_RESULTS = 8;
/** A register read never waits longer than this, body included. */
export const REGISTER_TIMEOUT_MS = 12_000;
const LOGIN = /^[a-z0-9_]{1,25}$/;
const DAB = /^[a-f0-9]{16}$/;

const MAX_INT = Number.MAX_SAFE_INTEGER;
const uint = int(0, MAX_INT);
const portrait: Check = (value, path) => {
  if (value === undefined || value === null) return;
  strict(value, path, { url: text(256, PORTRAIT_URL), freshUntil: epoch });
};
function checkPortraitAge(picture: ChannelPortrait | null | undefined, servedAt: number, path: string): void {
  if (picture && picture.freshUntil > servedAt + PORTRAIT_MAX_AGE_MS + 60_000) fail(path, 'a picture expiring within its source day');
}
const face: Check = (value, path) => {
  const f = strict(value, path, {
    id: text(32, CHANNEL_ID),
    login: nullable(text(64, /^[a-z0-9_]+$/)),
    name: nullable(text(128)),
    freshUntil: nullable(epoch),
    place: oneOf(['mapped', 'waiting', 'unseen']),
    ordinal: nullable(uint),
    tier: nullable(int(0, 3)),
    region: nullable(int(0, 65_535)),
    realm: nullable(int(0, 65_535)),
  }) as unknown as ChannelFace;
  if ((f.login === null) !== (f.name === null) || (f.name === null) !== (f.freshUntil === null)) fail(path, 'a name, login and freshness together');
  const mapped = f.place === 'mapped';
  if (mapped !== (f.ordinal !== null) || mapped !== (f.tier !== null)) fail(path, 'an ordinal and tier only for mapped land');
  if ((f.place === 'unseen') !== (f.realm === null) || (f.realm === null) !== (f.region === null)) fail(path, 'a realm unless unseen');
  if (f.place === 'unseen' && f.name !== null) fail(path, 'no name for an unseen channel');
};
const reply = (preview: string, kind: string): Record<string, Check> => ({
  version: literal(1),
  preview: literal(preview),
  revision: text(64, REVISION),
  servedAt: epoch,
  asOf: epoch,
  kind: literal(kind),
});
const window: Check = shape({ from: epoch, to: epoch });
const coverage: Check = shape({ raidWatch: shape({ enabled: (v, p) => void (typeof v !== 'boolean' && fail(p, 'a boolean')), watching: uint, liveCandidates: uint }), contentLabels: literal('not-collected') });
const tally: Check = shape({ raids: int(1, MAX_INT), travellers: uint, lastAt: epoch });
const language = text(16);

export function validateSearch(value: unknown, preview: string): SearchReply {
  strict(value, 'search', {
    ...reply(preview, 'chatdom-atlas-search'),
    key: text(200),
    results: array(shape({ channel: face, portrait, average: uint, language }), MAX_RESULTS),
    more: (v, p) => void (typeof v !== 'boolean' && fail(p, 'a boolean')),
  });
  const search = value as SearchReply;
  // Search finds named channels only: an unnamed or unseen result would be a reply that broke its own rule.
  search.results.forEach((result, i) => {
    checkPortraitAge(result.portrait, search.servedAt, `search.results[${i}].portrait`);
    if (result.channel.name === null || result.channel.place === 'unseen') fail(`search.results[${i}]`, 'a named, observed channel');
  });
  return search;
}

export function validateCard(value: unknown, preview: string): CardReply {
  strict(value, 'card', {
    ...reply(preview, 'chatdom-atlas-card'),
    channel: face,
    portrait,
    average: uint,
    language,
    firstSeenAt: epoch,
    lastLiveAt: epoch,
    stream: nullable(shape({
      live: (v, p) => void (typeof v !== 'boolean' && fail(p, 'a boolean')),
      game: nullable(text(256)),
      title: nullable((v, p) => void ((typeof v !== 'string' || v.length > 512) && fail(p, 'a title'))),
      viewers: nullable(uint),
      startedAt: nullable(epoch),
    })),
    roads: shape({ window, total: uint, strongest: array(shape({ other: face, sent: uint, received: uint, travellers: uint, lastAt: epoch }), 3) }),
    coverage,
  });
  const card = value as CardReply;
  checkPortraitAge(card.portrait, card.servedAt, 'card.portrait');
  if (card.channel.place === 'unseen') fail('card.channel', 'an observed channel');
  return card;
}

export function validateRoad(value: unknown, preview: string): RoadReply {
  strict(value, 'road', {
    ...reply(preview, 'chatdom-atlas-road'),
    a: face,
    b: face,
    aToB: nullable(tally),
    bToA: nullable(tally),
    window,
    coverage,
  });
  return value as RoadReply;
}

/** The shared dab hash of a channel: the first 64 bits of SHA-256 over its decimal ID, as hex. */
export function dabHashOf(channelId: string): string {
  return toHex(sha256(utf8(channelId))).slice(0, 16);
}

async function getJson(source: PreviewSource, url: string, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
  const local = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    local.abort();
  }, REGISTER_TIMEOUT_MS);
  const forward = () => local.abort();
  signal?.addEventListener('abort', forward, { once: true });
  const lost = (error: unknown): never => {
    if (timedOut) throw new DirectoryError('unavailable', 'The register did not answer in time.');
    if (signal?.aborted || (error as Error).name === 'AbortError') throw error;
    throw new DirectoryError('unavailable', 'The register could not be reached.');
  };
  try {
    let response: Response;
    try {
      response = await source.fetch(url, { signal: local.signal, credentials: 'omit' });
    } catch (error) {
      return lost(error);
    }
    let body: string;
    try {
      body = await response.text();
    } catch (error) {
      return lost(error);
    }
    if (!response.ok) {
      if (response.status === 404) throw new DirectoryError('not-found', 'Not in this survey’s public register.');
      if (response.status === 400) throw new DirectoryError('bad-query', 'The register cannot search for that.');
      if (response.status === 503 && /"warming"/.test(body)) {
        throw new DirectoryError('warming', 'The register is still being read.', Math.min(30, Math.max(1, Number(response.headers.get('retry-after')) || 5)));
      }
      if (response.status === 503 && /"names-unavailable"/.test(body)) throw new DirectoryError('refused', 'Names are held back just now.');
      throw new DirectoryError('unavailable', `The register answered ${response.status}.`);
    }
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new DirectoryError('invalid', 'The register’s reply is not valid JSON.');
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
}

function checked<T>(validate: (value: unknown, preview: string) => T, value: unknown, preview: string): T {
  try {
    return validate(value, preview);
  } catch (error) {
    throw new DirectoryError('invalid', (error as Error).message);
  }
}

function base(source: PreviewSource, preview: string): string {
  if (!PREVIEW_ID.test(preview)) throw new DirectoryError('invalid', 'Not a preview.');
  return `${source.base}/v1/preview/${preview}`;
}

export async function fetchSearch(source: PreviewSource, preview: string, query: string, signal?: AbortSignal): Promise<SearchReply> {
  const value = await getJson(source, `${base(source, preview)}/search?q=${encodeURIComponent(query.slice(0, 120))}&portraits=1`, signal);
  return checked(validateSearch, value, preview);
}

function lookupPath(lookup: Lookup): string {
  if ('id' in lookup) {
    if (!CHANNEL_ID.test(lookup.id)) throw new DirectoryError('not-found', 'Not a channel ID.');
    return lookup.id;
  }
  if ('login' in lookup) {
    if (!LOGIN.test(lookup.login)) throw new DirectoryError('not-found', 'Not a Twitch login.');
    return `login/${lookup.login}`;
  }
  if (!DAB.test(lookup.dab)) throw new DirectoryError('not-found', 'Not a dab hash.');
  return `dab/${lookup.dab}`;
}

export async function fetchCard(source: PreviewSource, preview: string, lookup: Lookup, signal?: AbortSignal): Promise<CardReply> {
  const value = await getJson(source, `${base(source, preview)}/card/${lookupPath(lookup)}?portraits=1`, signal);
  const card = checked(validateCard, value, preview);
  if ('id' in lookup && card.channel.id !== lookup.id) throw new DirectoryError('invalid', 'The card belongs to another channel.');
  if ('login' in lookup && card.channel.login !== lookup.login) throw new DirectoryError('invalid', 'The card belongs to another login.');
  return card;
}

/** A road by two channel IDs or two logins (a route's form). */
export async function fetchRoad(source: PreviewSource, preview: string, a: { id: string } | { login: string }, b: { id: string } | { login: string }, signal?: AbortSignal): Promise<RoadReply> {
  const byId = 'id' in a && 'id' in b;
  const byLogin = 'login' in a && 'login' in b;
  if (!byId && !byLogin) throw new DirectoryError('not-found', 'Both ends must be named the same way.');
  const path = byId ? `${lookupPath(a)}/${lookupPath(b)}` : `login/${(a as { login: string }).login}/${(b as { login: string }).login}`;
  if (byLogin && (!LOGIN.test((a as { login: string }).login) || !LOGIN.test((b as { login: string }).login))) throw new DirectoryError('not-found', 'Not a Twitch login.');
  return checked(validateRoad, await getJson(source, `${base(source, preview)}/road/${path}`, signal), preview);
}
