import type { AtlasRaid } from '@chatdom/shared';
import { compareId, type Directory, type DirectoryRefusal, type Lookup, type WorldPoint } from '../directory/directory';
import type { DirectoryFallback } from '../directory/fallback';
import type { ChannelFace, ChannelPortrait, SearchReply } from '../directory/schema';
import { LookupUnavailable, type TwitchChannelFacts, type TwitchLookup } from '../directory/twitch-lookup';
import { RAW_CONTENT_MAX_AGE_MS } from '../export/schema';
import type { RoadLedger, RoadLine } from './ledger';

/**
 * Public reads of the road ledger and the Raid Gate's finder. Every answer is projected at request time through the
 * register's gate and the current withheld list: a withheld, gone or gambling channel is never named, and a road to
 * one is left out entirely, never shown as anonymous. Old roads are served like any other; fading is drawing,
 * never deletion. Nothing here spends Twitch budget except the finder's search, through the fallback's own limits.
 */

/** Roads one channel lists at most, strongest first. */
export const CHANNEL_ROADS = 64;
/** Observations a road story shows, newest first. */
export const STORY_RECENT = 5;
/** Roads the busiest view carries at most. */
export const BUSIEST_ROADS = 400;
/** Entries per proposal group of the finder. */
export const FINDER_GROUP = 12;
/** Realms of the source's region, nearest centres first, whose live channels are neighbours. */
export const NEIGHBOUR_REALMS = 3;

export type Basis = 'observations' | 'at-least';

export interface RoadEntry {
  other: ChannelFace;
  position: WorldPoint | null;
  sent: number;
  received: number;
  travellers: number;
  firstAt: number | null;
  lastAt: number;
  basis: Basis;
}

export interface FinderEntry {
  channel: ChannelFace;
  position: WorldPoint | null;
  live: boolean;
  /** The ordering key: observed average audience, or live viewers for a channel outside the survey. */
  size: number | null;
  game: string | null;
  language: string | null;
  viewers: number | null;
  land: 'founded' | 'waiting' | 'edge';
  roads: { raids: number; lastAt: number } | null;
  portrait?: ChannelPortrait | null;
}

export type FinderGroupKind = 'roads' | 'realm' | 'neighbours' | 'search';

interface ReplyHeader { version: 1; preview: string; servedAt: number; since: number }

export interface ChannelRoadsReply extends ReplyHeader {
  kind: 'chatdom-atlas-roads';
  channel: ChannelFace;
  position: WorldPoint | null;
  /** Every road the gate allows, of which at most CHANNEL_ROADS are listed. */
  total: number;
  roads: RoadEntry[];
}

export interface RoadTally { raids: number; travellers: number }

export interface RoadStoryReply extends ReplyHeader {
  kind: 'chatdom-atlas-road-story';
  a: ChannelFace;
  b: ChannelFace;
  pa: WorldPoint | null;
  pb: WorldPoint | null;
  aToB: RoadTally | null;
  bToA: RoadTally | null;
  firstAt: number | null;
  lastAt: number | null;
  basis: Basis | 'none';
  recent: { at: number; from: string; viewers: number }[];
}

export interface BusiestRoad {
  a: string;
  b: string;
  pa: WorldPoint;
  pb: WorldPoint;
  ra: number | null;
  rb: number | null;
  raids: number;
  travellers: number;
  lastAt: number;
  basis: Basis;
}

export interface BusiestReply extends ReplyHeader {
  kind: 'chatdom-atlas-busiest-roads';
  roads: BusiestRoad[];
}

export interface CaravanEvent {
  version: 1;
  id: string;
  from: string;
  to: string;
  viewers: number;
  at: number;
  a: ChannelFace;
  b: ChannelFace;
  pa: WorldPoint | null;
  pb: WorldPoint | null;
  ra: number | null;
  rb: number | null;
}

export interface FinderReply {
  version: 1;
  kind: 'chatdom-atlas-finder';
  preview: string;
  servedAt: number;
  liveAsOf: number | null;
  from: { channel: ChannelFace; position: WorldPoint | null };
  groups: { kind: FinderGroupKind; entries: FinderEntry[] }[];
  unavailable?: 'disabled' | 'limited' | 'upstream';
}

/** The channels on air in one preview's current live frame. */
export interface LiveNow {
  asOf: number | null;
  ids: ReadonlySet<string>;
}

export interface PublicRoadsContext {
  ledger: RoadLedger;
  twitch: TwitchLookup | null;
  fallback: DirectoryFallback | null;
}

/** A channel as one answer may show it: its face, its place and its region; null when the gate keeps it off. */
interface Placed {
  face: ChannelFace;
  position: WorldPoint | null;
  region: number | null;
  /** Twitch facts from the fallback's cache, for channels outside the survey. */
  facts: TwitchChannelFacts | null;
}

/** Twitch facts the fallback already holds for this ID, without spending any request. */
async function cachedFacts(twitch: TwitchLookup | null, id: string): Promise<TwitchChannelFacts | null> {
  if (!twitch?.cached?.(`id:${id}`)) return null;
  try {
    return (await twitch.lookup(`id:${id}`)).find((facts) => facts.id === id) ?? null;
  } catch {
    return null;
  }
}

/**
 * One channel through the gate. A surveyed channel stands at its holding or pencil place. A channel the survey
 * never saw is `unseen` without a place, unless the fallback's cache already knows its facts: then it stands at
 * its deterministic place like a searched channel. Gated channels (withheld, gone, gambling) are null.
 */
async function place(register: Directory, id: string, withheld: ReadonlySet<string>, now: number, twitch: TwitchLookup | null): Promise<Placed | null> {
  const face = register.face(id, withheld, now);
  if (!face) return null;
  if (register.knows(id)) return { face, position: register.position(id), region: face.region, facts: null };
  const facts = await cachedFacts(twitch, id);
  if (!facts) return { face, position: null, region: null, facts: null };
  const card = register.external(facts, withheld, now, false);
  if (!card) return null;
  return { face: card.channel, position: card.position ?? null, region: card.channel.region, facts };
}

/** When the raid watch's memory begins: the register's window, or the ledger's earliest event if earlier. */
export function since(register: Directory, ledger: RoadLedger): number {
  const from = register.manifest.window.firstObservationAt;
  const earliest = ledger.earliestEventAt();
  return earliest === null ? from : Math.min(from, earliest);
}

function header(register: Directory, ledger: RoadLedger, now: number): ReplyHeader {
  return { version: 1 as const, preview: register.preview, servedAt: now, since: since(register, ledger) };
}

/** One direction of a road as seen from `from`. */
function directed(road: RoadLine, from: string): { sent: { raids: number; viewers: number }; received: { raids: number; viewers: number } } {
  return road.from === from ? { sent: road.forward, received: road.backward } : { sent: road.backward, received: road.forward };
}

/** Every road of one channel the gate allows, strongest first. */
export async function channelRoads(context: PublicRoadsContext, register: Directory, id: string, withheld: ReadonlySet<string>, now: number): Promise<ChannelRoadsReply | DirectoryRefusal> {
  const { ledger, twitch } = context;
  const lines = ledger.lines(id);
  const channel = await place(register, id, withheld, now, twitch);
  if (!channel || (!register.knows(id) && lines.length === 0 && channel.facts === null)) return 'not-found';
  const roads: RoadEntry[] = [];
  for (const road of lines) {
    const otherId = road.from === id ? road.to : road.from;
    const other = await place(register, otherId, withheld, now, twitch);
    if (!other) continue;
    const { sent, received } = directed(road, id);
    roads.push({
      other: other.face, position: other.position, sent: sent.raids, received: received.raids,
      travellers: road.viewers, firstAt: road.firstAt, lastAt: road.lastAt, basis: road.countBasis,
    });
  }
  roads.sort((a, b) => (b.sent + b.received) - (a.sent + a.received) || b.travellers - a.travellers || b.lastAt - a.lastAt || compareId(a.other.id, b.other.id));
  return {
    ...header(register, ledger, now), kind: 'chatdom-atlas-roads',
    channel: channel.face, position: channel.position, total: roads.length, roads: roads.slice(0, CHANNEL_ROADS),
  };
}

/** The story of the road between two channels. No witnessed raid between them reads `none`: not observed. */
export async function roadStory(context: PublicRoadsContext, register: Directory, a: Lookup, b: Lookup, withheld: ReadonlySet<string>, now: number): Promise<RoadStoryReply | DirectoryRefusal> {
  const { ledger, twitch } = context;
  const first = 'id' in a ? a.id : register.resolve(a);
  const second = 'id' in b ? b.id : register.resolve(b);
  if (!first || !second || first === second) return 'not-found';
  const road = ledger.lines(first).find((line) => line.from === second || line.to === second) ?? null;
  if (!road && (!register.knows(first) || !register.knows(second))) return 'not-found';
  const [pa, pb] = await Promise.all([place(register, first, withheld, now, twitch), place(register, second, withheld, now, twitch)]);
  if (!pa || !pb) return 'not-found';
  const tally = road ? directed(road, first) : null;
  return {
    ...header(register, ledger, now), kind: 'chatdom-atlas-road-story',
    a: pa.face, b: pb.face, pa: pa.position, pb: pb.position,
    aToB: tally ? { raids: tally.sent.raids, travellers: tally.sent.viewers } : null,
    bToA: tally ? { raids: tally.received.raids, travellers: tally.received.viewers } : null,
    firstAt: road?.firstAt ?? null, lastAt: road?.lastAt ?? null, basis: road?.countBasis ?? 'none',
    recent: road ? ledger.recent(first, second, STORY_RECENT).map((raid) => ({ at: raid.occurredAt ?? raid.observedAt, from: raid.fromKingdomId, viewers: raid.viewers })) : [],
  };
}

/** The strongest roads whose both ends are allowed and placed, without names: what a whole view draws. */
export async function busiestRoads(context: PublicRoadsContext, register: Directory, withheld: ReadonlySet<string>, now: number): Promise<BusiestReply> {
  const { ledger, twitch } = context;
  const placeable = new Map<string, boolean>();
  const could = (id: string) => {
    let known = placeable.get(id);
    if (known === undefined) {
      known = register.allowed(id, withheld) && (register.knows(id) ? register.position(id) !== null : twitch?.cached?.(`id:${id}`) === true);
      placeable.set(id, known);
    }
    return known;
  };
  const candidates = ledger.busiest(BUSIEST_ROADS, (road) => could(road.from) && could(road.to));
  const roads: BusiestRoad[] = [];
  for (const road of candidates) {
    const [a, b] = await Promise.all([place(register, road.from, withheld, now, twitch), place(register, road.to, withheld, now, twitch)]);
    if (!a?.position || !b?.position) continue;
    roads.push({ a: road.from, b: road.to, pa: a.position, pb: b.position, ra: a.region, rb: b.region, raids: road.raids, travellers: road.viewers, lastAt: road.lastAt, basis: road.countBasis });
  }
  return { ...header(register, ledger, now), kind: 'chatdom-atlas-busiest-roads', roads };
}

/** The public caravan of one freshly witnessed raid, or null when the gate keeps either end off the map. */
export async function caravanEvent(context: PublicRoadsContext, register: Directory, raid: AtlasRaid, withheld: ReadonlySet<string>, now: number): Promise<CaravanEvent | null> {
  if (!register.allowed(raid.fromKingdomId, withheld) || !register.allowed(raid.toKingdomId, withheld)) return null;
  const [a, b] = await Promise.all([
    place(register, raid.fromKingdomId, withheld, now, context.twitch), place(register, raid.toKingdomId, withheld, now, context.twitch),
  ]);
  if (!a || !b) return null;
  return {
    version: 1 as const, id: raid.id, from: raid.fromKingdomId, to: raid.toKingdomId, viewers: raid.viewers, at: raid.occurredAt ?? raid.observedAt,
    a: a.face, b: b.face, pa: a.position, pb: b.position, ra: a.region, rb: b.region,
  };
}

/**
 * The finder's order inside one proposal group: smaller channels first, then channel ID. Only these two keys are
 * read; nothing paid, sponsored or bought exists in any input, and no other field can move a channel.
 */
export function finderOrder<T extends { id: string; size: number | null }>(candidates: readonly T[]): T[] {
  return [...candidates].sort((a, b) => (a.size ?? Number.MAX_SAFE_INTEGER) - (b.size ?? Number.MAX_SAFE_INTEGER) || compareId(a.id, b.id));
}

export interface FinderRequest {
  from: string;
  query: string | null;
  portraits: boolean;
  ip: string;
}

/** Whether cached Twitch facts may still speak about the stream. */
function freshFacts(facts: TwitchChannelFacts, now: number): boolean {
  return facts.fetchedAt + RAW_CONTENT_MAX_AGE_MS > now;
}

/**
 * The Raid Gate's target finder: live channels the source has roads with, then live channels of its realm, then of
 * the nearest realms of its region; with a query, a search of every Twitch channel through the fallback. It only
 * proposes. raid-show's authority decides who may raid, and refuses a pick no longer live at the press.
 */
export async function finder(context: PublicRoadsContext, register: Directory, live: LiveNow, request: FinderRequest, withheld: ReadonlySet<string>, now: number): Promise<FinderReply | DirectoryRefusal> {
  const { ledger, twitch, fallback } = context;
  const lines = ledger.lines(request.from);
  let source: { face: ChannelFace; position: WorldPoint | null } | null = null;
  let unavailable: SearchReply['unavailable'];
  if (register.knows(request.from)) {
    const face = register.face(request.from, withheld, now);
    source = face && { face, position: register.position(request.from) };
  } else if (register.allowed(request.from, withheld)) {
    // A source outside the survey: its public facts place it like a searched channel, under the fallback's limits.
    try {
      const card = fallback ? await fallback.card(register, { id: request.from }, withheld, request.ip, false) : 'not-found';
      if (typeof card !== 'string') source = { face: card.channel, position: card.position ?? null };
    } catch (error) {
      if (!(error instanceof LookupUnavailable) || lines.length === 0) throw error;
      unavailable = error.reason;
    }
    if (!source && lines.length > 0) {
      const face = register.face(request.from, withheld, now);
      source = face && { face, position: null };
    }
  }
  if (!source) return 'not-found';

  const roadOf = new Map<string, { raids: number; lastAt: number }>();
  for (const road of lines) roadOf.set(road.from === request.from ? road.to : road.from, { raids: road.raids, lastAt: road.lastAt });

  const surveyEntry = (id: string): FinderEntry | null => {
    const face = register.face(id, withheld, now);
    if (!face) return null;
    const facts = register.facts(id);
    const stream = register.stream(id, now);
    const position = register.position(id);
    return {
      channel: face, position, live: live.ids.has(id), size: facts.average, game: stream?.game ?? null,
      language: facts.language, viewers: stream?.live ? stream.viewers : null,
      // No founded-kingdom record exists yet, so no channel is `founded`; a placed channel waits for its founding.
      land: position ? 'waiting' : 'edge', roads: roadOf.get(id) ?? null,
      ...(request.portraits ? { portrait: register.portraitOf(id, now) } : {}),
    };
  };

  const seen = new Set<string>([request.from]);
  const group = (kind: FinderGroupKind, ids: Iterable<string>) => {
    const candidates: { id: string; size: number | null }[] = [];
    for (const id of ids) {
      if (seen.has(id) || !live.ids.has(id) || !register.allowed(id, withheld)) continue;
      candidates.push({ id, size: register.facts(id).average });
    }
    const entries: FinderEntry[] = [];
    for (const { id } of finderOrder(candidates)) {
      if (entries.length >= FINDER_GROUP) break;
      const entry = surveyEntry(id);
      if (!entry) continue;
      seen.add(id);
      entries.push(entry);
    }
    return { kind, entries };
  };

  const groups: { kind: FinderGroupKind; entries: FinderEntry[] }[] = [group('roads', roadOf.keys())];
  const realm = source.face.realm;
  const realms = register.realms();
  const own = realm === null ? undefined : realms.find((candidate) => candidate.index === realm);
  const realmOf = (id: string) => register.facts(id).realm;
  groups.push(group('realm', own ? [...live.ids].filter((id) => realmOf(id) === own.index) : []));
  const near = own ? new Set(realms.filter((candidate) => candidate.region === own.region && candidate.index !== own.index)
    .sort((a, b) => Math.hypot(a.x - own.x, a.y - own.y) - Math.hypot(b.x - own.x, b.y - own.y) || a.index - b.index)
    .slice(0, NEIGHBOUR_REALMS).map((candidate) => candidate.index)) : new Set<number>();
  groups.push(group('neighbours', near.size ? [...live.ids].filter((id) => near.has(realmOf(id) ?? -1)) : []));

  if (request.query !== null) {
    const reply = fallback
      ? await fallback.search(register, request.query, withheld, request.ip, request.portraits)
      : register.search(request.query, withheld, now, request.portraits, true);
    if (typeof reply === 'string') return reply;
    if (reply.unavailable) unavailable = reply.unavailable;
    const entries: FinderEntry[] = [];
    // Relevance order is kept; offline results stay listed (not selectable), so search never hides a real channel.
    for (const result of reply.results) {
      const id = result.channel.id;
      if (id === request.from || !register.allowed(id, withheld)) continue;
      if (register.knows(id)) {
        const entry = surveyEntry(id);
        if (entry) entries.push(request.portraits ? { ...entry, portrait: result.portrait ?? entry.portrait ?? null } : entry);
        continue;
      }
      const facts = await cachedFacts(twitch, id);
      const stream = facts && freshFacts(facts, now) ? facts : null;
      const position = result.position ?? null;
      entries.push({
        channel: result.channel, position, live: stream?.live ?? false, size: stream?.live ? stream.viewers : null,
        game: stream?.game ?? null, language: facts?.language ?? result.language, viewers: stream?.live ? stream.viewers : null,
        land: position ? 'waiting' : 'edge', roads: roadOf.get(id) ?? null,
        ...(request.portraits ? { portrait: result.portrait ?? null } : {}),
      });
    }
    groups.push({ kind: 'search', entries });
  }

  return {
    version: 1 as const, kind: 'chatdom-atlas-finder' as const, preview: register.preview, servedAt: now, liveAsOf: live.asOf,
    from: { channel: source.face, position: source.position }, groups,
    ...(unavailable ? { unavailable } : {}),
  };
}
