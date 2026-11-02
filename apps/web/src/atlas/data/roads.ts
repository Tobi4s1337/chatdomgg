import { checked, DirectoryError, face, getJson, portrait, type ChannelFace, type ChannelPortrait } from './directory';
import {
  array, CHANNEL_ID, epoch, fail, int, literal, nullable, oneOf, PREVIEW_ID, shape, strict, text, type Check, type PreviewSource,
} from './preview';

/**
 * The road ledger as the Atlas service projects it (`/map-data/v1/roads/<preview>/…`, `/gate/<preview>/finder`) and
 * the caravans its live stream announces. Every reply passed the service's visibility gate; it is validated strictly
 * again here before anything is drawn. Roads are memory of witnessed raids: counts are what was seen, and `basis`
 * says whether a count is exact (`observations`) or a floor kept from the collector's totals (`at-least`).
 */

export type RoadBasis = 'observations' | 'at-least';
export interface MapPoint { x: number; y: number }

export interface RoadEntry {
  other: ChannelFace;
  position: MapPoint | null;
  /** Raids from the card's channel to the other, and back. */
  sent: number;
  received: number;
  travellers: number;
  /** The first witnessed raid; null when part of the count is a collector total without dates. */
  firstAt: number | null;
  lastAt: number;
  basis: RoadBasis;
}

export interface ChannelRoads {
  version: 1;
  kind: 'chatdom-atlas-roads';
  preview: string;
  servedAt: number;
  /** When the raid watch's memory begins: nothing before it was observed, so nothing before it is denied. */
  since: number;
  channel: ChannelFace;
  position: MapPoint | null;
  total: number;
  roads: RoadEntry[];
}

export interface RoadStory {
  version: 1;
  kind: 'chatdom-atlas-road-story';
  preview: string;
  servedAt: number;
  since: number;
  a: ChannelFace;
  b: ChannelFace;
  pa: MapPoint | null;
  pb: MapPoint | null;
  aToB: { raids: number; travellers: number } | null;
  bToA: { raids: number; travellers: number } | null;
  firstAt: number | null;
  lastAt: number | null;
  /** `none`: no raid between them was witnessed since `since` (not observed, never "no raids"). */
  basis: RoadBasis | 'none';
  recent: { at: number; from: string; viewers: number }[];
}

export interface BusyRoad {
  a: string;
  b: string;
  pa: MapPoint;
  pb: MapPoint;
  ra: number | null;
  rb: number | null;
  raids: number;
  travellers: number;
  lastAt: number;
  basis: RoadBasis;
}

export interface BusiestRoads {
  version: 1;
  kind: 'chatdom-atlas-busiest-roads';
  preview: string;
  servedAt: number;
  since: number;
  roads: BusyRoad[];
}

export type GateLandKind = 'founded' | 'waiting' | 'edge';
export interface FinderEntry {
  channel: ChannelFace;
  position: MapPoint | null;
  live: boolean;
  /** Observed average audience, or current viewers for a channel outside the survey: the finder's only sort key. */
  size: number | null;
  viewers: number | null;
  game: string | null;
  language: string | null;
  land: GateLandKind;
  roads: { raids: number; lastAt: number } | null;
  portrait?: ChannelPortrait | null;
}
export type FinderGroupKind = 'roads' | 'realm' | 'neighbours' | 'search';
export interface FinderReply {
  version: 1;
  kind: 'chatdom-atlas-finder';
  preview: string;
  servedAt: number;
  liveAsOf: number | null;
  from: { channel: ChannelFace; position: MapPoint | null };
  groups: { kind: FinderGroupKind; entries: FinderEntry[] }[];
  unavailable?: 'disabled' | 'limited' | 'upstream';
}

/** A fresh witnessed raid, announced once by the live stream at the moment it was stored. */
export interface CaravanRaid {
  version: 1;
  id: string;
  from: string;
  to: string;
  viewers: number;
  at: number;
  a: ChannelFace;
  b: ChannelFace;
  pa: MapPoint | null;
  pb: MapPoint | null;
  ra: number | null;
  rb: number | null;
}

const MAX = Number.MAX_SAFE_INTEGER;
const uint = int(0, MAX);
const id = text(32, CHANNEL_ID);
const region = nullable(int(0, 65_535));
const coordinate: Check = (n, p) => { if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 100_000) fail(p, 'a finite map coordinate'); };
const point: Check = shape({ x: coordinate, y: coordinate });
const basis = oneOf(['observations', 'at-least']);
const flag: Check = (v, p) => void (typeof v !== 'boolean' && fail(p, 'a boolean'));
const head = (preview: string, kind: string): Record<string, Check> => ({
  version: literal(1), kind: literal(kind), preview: literal(preview), servedAt: epoch,
});
/** One way along a road: null when there is no road at all; a way nobody has ridden yet reads zero. */
const ways: Check = nullable(shape({ raids: uint, travellers: uint }));

export function validateChannelRoads(value: unknown, preview: string): ChannelRoads {
  strict(value, 'roads', {
    ...head(preview, 'chatdom-atlas-roads'),
    since: epoch,
    channel: face,
    position: nullable(point),
    total: uint,
    roads: array(shape({
      other: face, position: nullable(point), sent: uint, received: uint, travellers: uint,
      firstAt: nullable(epoch), lastAt: epoch, basis,
    }), 64),
  });
  const reply = value as ChannelRoads;
  if (reply.total < reply.roads.length) fail('roads.total', 'at least the roads listed');
  reply.roads.forEach((road, i) => {
    if (road.sent + road.received < 1) fail(`roads.roads[${i}]`, 'a road with at least one raid');
    if (road.other.id === reply.channel.id) fail(`roads.roads[${i}]`, 'a road to another channel');
  });
  return reply;
}

export function validateRoadStory(value: unknown, preview: string): RoadStory {
  strict(value, 'story', {
    ...head(preview, 'chatdom-atlas-road-story'),
    since: epoch,
    a: face, b: face, pa: nullable(point), pb: nullable(point),
    aToB: ways, bToA: ways,
    firstAt: nullable(epoch), lastAt: nullable(epoch),
    basis: oneOf(['observations', 'at-least', 'none']),
    recent: array(shape({ at: epoch, from: id, viewers: uint }), 5),
  });
  const story = value as RoadStory;
  const raids = (story.aToB?.raids ?? 0) + (story.bToA?.raids ?? 0);
  const seen = !!story.aToB || !!story.bToA;
  if (seen !== (story.aToB !== null && story.bToA !== null)) fail('story', 'both ways of a road, or neither');
  if (seen !== (story.basis !== 'none') || seen !== (story.lastAt !== null) || seen !== (raids > 0)) fail('story', 'a story whose basis matches its raids');
  if (story.a.id === story.b.id) fail('story', 'two different channels');
  return story;
}

export function validateBusiest(value: unknown, preview: string): BusiestRoads {
  strict(value, 'busiest', {
    ...head(preview, 'chatdom-atlas-busiest-roads'),
    since: epoch,
    roads: array(shape({ a: id, b: id, pa: point, pb: point, ra: region, rb: region, raids: int(1, MAX), travellers: uint, lastAt: epoch, basis }), 400),
  });
  return value as BusiestRoads;
}

const finderEntry: Check = shape({
  channel: face, position: nullable(point), live: flag, size: nullable(uint), viewers: nullable(uint),
  game: nullable(text(256)), language: nullable(text(16)), land: oneOf(['founded', 'waiting', 'edge']),
  roads: nullable(shape({ raids: int(1, MAX), lastAt: epoch })), portrait,
});

export function validateFinder(value: unknown, preview: string): FinderReply {
  const raw = value as Record<string, unknown> | null;
  strict(value, 'finder', {
    ...head(preview, 'chatdom-atlas-finder'),
    liveAsOf: nullable(epoch),
    from: shape({ channel: face, position: nullable(point) }),
    groups: array(shape({ kind: oneOf(['roads', 'realm', 'neighbours', 'search']), entries: array(finderEntry, 32) }), 4),
    ...(raw && 'unavailable' in raw ? { unavailable: oneOf(['disabled', 'limited', 'upstream']) } : {}),
  });
  const reply = value as FinderReply;
  const seen = new Set<string>();
  for (const group of reply.groups) {
    for (const entry of group.entries) {
      if (entry.channel.id === reply.from.channel.id) fail('finder', 'a finder that never proposes its own source');
      if (group.kind !== 'search' && !entry.live) fail('finder', 'only live channels among the proposals');
      if (group.kind !== 'search' && seen.has(entry.channel.id)) fail('finder', 'each channel once');
      seen.add(entry.channel.id);
    }
  }
  return reply;
}

/** The live stream's `raid` event. Throws on anything malformed; the caller drops it without drawing. */
export function validateCaravan(value: unknown): CaravanRaid {
  strict(value, 'raid', {
    version: literal(1), id: text(128), from: id, to: id, viewers: int(1, MAX), at: epoch,
    a: face, b: face, pa: nullable(point), pb: nullable(point), ra: region, rb: region,
  });
  const raid = value as CaravanRaid;
  if (raid.from === raid.to || raid.a.id !== raid.from || raid.b.id !== raid.to) fail('raid', 'two different channels named as its ends');
  return raid;
}

function roadsBase(source: PreviewSource, preview: string, area: 'roads' | 'gate'): string {
  if (!PREVIEW_ID.test(preview)) throw new DirectoryError('invalid', 'Not a preview.');
  return `${source.base}/v1/${area}/${preview}`;
}

const channelId = (value: string) => {
  if (!CHANNEL_ID.test(value)) throw new DirectoryError('not-found', 'Not a channel ID.');
  return value;
};

export async function fetchChannelRoads(source: PreviewSource, preview: string, channel: string, signal?: AbortSignal): Promise<ChannelRoads> {
  const reply = checked(validateChannelRoads, await getJson(source, `${roadsBase(source, preview, 'roads')}/channel/${channelId(channel)}`, signal), preview);
  if (reply.channel.id !== channel) throw new DirectoryError('invalid', 'The roads belong to another channel.');
  return reply;
}

const LOGIN = /^[a-z0-9_]{1,25}$/;
export async function fetchRoadStory(source: PreviewSource, preview: string, a: { id: string } | { login: string }, b: { id: string } | { login: string }, signal?: AbortSignal): Promise<RoadStory> {
  let path: string;
  if ('id' in a && 'id' in b) path = `${channelId(a.id)}/${channelId(b.id)}`;
  else if ('login' in a && 'login' in b && LOGIN.test(a.login) && LOGIN.test(b.login)) path = `login/${a.login}/${b.login}`;
  else throw new DirectoryError('not-found', 'Both ends must be named the same way.');
  return checked(validateRoadStory, await getJson(source, `${roadsBase(source, preview, 'roads')}/road/${path}`, signal), preview);
}

export async function fetchBusiest(source: PreviewSource, preview: string, signal?: AbortSignal): Promise<BusiestRoads> {
  return checked(validateBusiest, await getJson(source, `${roadsBase(source, preview, 'roads')}/busiest`, signal), preview);
}

export async function fetchFinder(source: PreviewSource, preview: string, from: string, query: string | null, signal?: AbortSignal): Promise<FinderReply> {
  const q = query?.trim().slice(0, 120);
  const url = `${roadsBase(source, preview, 'gate')}/finder?from=${channelId(from)}&portraits=1${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  const reply = checked(validateFinder, await getJson(source, url, signal), preview);
  if (reply.from.channel.id !== from) throw new DirectoryError('invalid', 'The finder belongs to another source.');
  return reply;
}
