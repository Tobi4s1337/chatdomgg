import type { AtlasSettler } from '@chatdom/shared';
import { compareIds } from '../export/project';
import type { ChannelObservation, RaidObservation, RaidPair, SnapshotManifest } from '../export/schema';
import { publicVisibility } from '../policy/visibility';
import { LandIndex, LATTICE, Occupancy, landIndexOfWorld, latticePoint, nearestFreeSlot, slotHoldingId, type LatticePoint, type RealmCircle } from '../cartography/slots';
import { placementOf, type LoadedTaxonomy } from '../cartography/taxonomy';
import { hashString } from '../preview/noise';
import { TIER_MIN_AVERAGE } from '../preview/layout';
import { EDITIONS, type EditionNumber, type EditionWorld } from './schema';
import type { LedgerEvent, LedgerState, Tombstone } from './ledger';
import { PencilPlaces, type PencilRegionPlaces } from '../cartography/pencil-place';
import { dabHash } from '../live/frame';
import { realmResolver } from '../live/target';
import type { AtlasRaid } from '@chatdom/shared';
import { claimOrder, type Claim } from './claims';

/**
 * Nightly settlement of one edition (Spec 01 R3, R5): new kingdoms receive land in their realm without anything
 * already settled moving, hidden or gone channels get tombstones, and from Edition I a raid grants a small channel
 * a hamlet. Pure: the same edition, ledger and revision always give the same events.
 */
export type HoldingTier = AtlasSettler['holdingTier'];
const TIER_ORDER: readonly HoldingTier[] = ['hamlet', 'village', 'town', 'city', 'capital'];

/** A holding's tier from the observed average (viewer-minutes over live-minutes), with hamlets below 25. */
export function holdingTierFor(average: number): HoldingTier {
  if (average >= TIER_MIN_AVERAGE.capital) return 'capital';
  if (average >= TIER_MIN_AVERAGE.city) return 'city';
  if (average >= TIER_MIN_AVERAGE.town) return 'town';
  if (average >= TIER_MIN_AVERAGE.village) return 'village';
  return 'hamlet';
}

/**
 * How large a kingdom is drawn: it grows in place up to one tier past its holding and never below it; the holding
 * itself never changes (decided 2026-10-29).
 */
export function apparentTier(holding: HoldingTier, average: number): HoldingTier {
  const own = TIER_ORDER.indexOf(holding);
  const now = TIER_ORDER.indexOf(holdingTierFor(average));
  return TIER_ORDER[Math.max(own, Math.min(now, own + 1))]!;
}

/** Days a gone (deleted or banned) channel's land stays bare before it is drawn as waiting land again. */
export const GONE_RETURN_MS = 30 * 86_400_000;

/**
 * How a holding is drawn at a moment: active; waiting land once hidden (from the next cartography run); abandoned for
 * 30 days after its channel is gone, then waiting. The tombstone keeps the holding from any other owner either way.
 */
export function holdingState(tombstone: Tombstone | undefined, now: number): 'active' | 'waiting' | 'abandoned' {
  if (!tombstone) return 'active';
  if (tombstone.cause === 'hidden') return 'waiting';
  return now - tombstone.at < GONE_RETURN_MS ? 'abandoned' : 'waiting';
}

export function holdingRadius(world: Pick<EditionWorld, 'tiers' | 'lattice'>, tier: HoldingTier): number {
  return tier === 'hamlet' ? world.lattice.hamletRadius : world.tiers.holdingRadius[tier];
}

/** Everything settlement reads about a frozen world, indexed once. */
export interface EditionContext {
  world: EditionWorld;
  land: LandIndex;
  taxonomy: LoadedTaxonomy;
  realms: RealmCircle[];
  regionByLanguage: Map<string, number>;
  outerRealms: number[];
  /** The realm the map, search and live dabs give a channel without land: the same rule, so claims land where shown. */
  resolveRealm: (channel: { id: string; language: string; categories: readonly { gameId: string; minutes: number }[] }) => number;
  /** Pencil places against the founding holdings, built on first use. */
  pencil?: { places: PencilPlaces; regions: Map<number, PencilRegionPlaces> };
}

export function editionContext(world: EditionWorld, taxonomy: LoadedTaxonomy): EditionContext {
  if (taxonomy.ref.sha256 !== world.taxonomy.sha256) throw new Error('The taxonomy is not the one this edition was drawn with.');
  const s = world.coordScale;
  const realms = world.realms.map((realm) => ({ index: realm.index, region: realm.region, x: realm.x / s, y: realm.y / s, r: realm.r / s }));
  const regionByLanguage = new Map<string, number>();
  for (const region of world.regions) if (region.language !== null) regionByLanguage.set(region.language, region.index);
  return {
    world,
    land: landIndexOfWorld(world),
    taxonomy,
    realms,
    regionByLanguage,
    outerRealms: world.realms.filter((realm) => realm.kind === 'outer').map((realm) => realm.index),
    resolveRealm: realmResolver(world, taxonomy),
  };
}

/**
 * A channel's pencil place inside the edition: the free hamlet slot nearest its hashed spot in its realm, computed
 * against the founding holdings only, exactly as search and the live layer compute it. It depends on nothing but the
 * frozen edition and the channel ID, so it is the same on every night, after every restart, on every service.
 */
export function editionPencilPlace(ctx: EditionContext, state: Pick<LedgerState, 'settlers'>, realm: number, kingdomId: string): { x: number; y: number } | null {
  if (!ctx.pencil) {
    const places = new PencilPlaces(ctx.world);
    ctx.pencil = { places, regions: new Map() };
  }
  const region = ctx.world.realms[realm]?.region;
  if (region === undefined) return null;
  let regionPlaces = ctx.pencil.regions.get(region);
  if (!regionPlaces) {
    const holdings = state.settlers
      .filter((settler) => settler.holdingId.startsWith('f:') && ctx.world.realms[settler.realmIndex]!.region === region)
      .map((settler) => ({ x: settler.point.x, y: settler.point.y, r: holdingRadius(ctx.world, settler.holdingTier) }));
    regionPlaces = ctx.pencil.places.forRegion(region, holdings);
    ctx.pencil.regions.set(region, regionPlaces);
  }
  return regionPlaces.place(dabHash(kingdomId), realm);
}

/** Occupancy of every settled holding (tombstoned land included: it is never given to anyone else). */
export function occupancyOf(ctx: EditionContext, settlers: readonly AtlasSettler[]): Occupancy {
  const occupancy = new Occupancy(ctx.world.lattice.gap);
  for (const settler of settlers) occupancy.add(settler.point.x, settler.point.y, holdingRadius(ctx.world, settler.holdingTier));
  return occupancy;
}

/**
 * The realm a channel belongs to in this edition: its language's isle, or on a continent its family's realm, the
 * Crossroads for variety, the Wilds otherwise. Null when the edition has no land for its language (Outer Isles).
 */
export function realmFor(ctx: EditionContext, channel: Pick<ChannelObservation, 'language' | 'categories'>): number | null {
  const region = ctx.regionByLanguage.get(channel.language);
  if (region === undefined) return null;
  const realms = ctx.world.realms.filter((realm) => realm.region === region);
  if (ctx.world.regions[region]!.kind === 'isle') return realms[0]!.index;
  const placement = placementOf(channel.categories, ctx.taxonomy.familyOf);
  const byKind = (kind: string) => realms.find((realm) => realm.kind === kind)!.index;
  if (placement.kind === 'variety') return byKind('crossroads');
  if (placement.kind === 'family') return realms.find((realm) => realm.kind === 'family' && realm.family === placement.family)?.index ?? byKind('wilds');
  return byKind('wilds');
}

/** A channel's own spot in a realm, from its ID alone: where a newcomer with no raid ties starts looking. */
export function hashedTarget(ctx: EditionContext, realm: number, kingdomId: string): { x: number; y: number } {
  const circle = ctx.realms[realm]!;
  const angle = (hashString(`place:a:${kingdomId}`) / 4294967296) * Math.PI * 2;
  const radius = Math.sqrt(hashString(`place:r:${kingdomId}`) / 4294967296) * circle.r * 0.9;
  return { x: circle.x + Math.cos(angle) * radius, y: circle.y + Math.sin(angle) * radius };
}

export interface Placed { realm: number; point: LatticePoint; path: 'realm' | 'outer' }

/**
 * The nearest free slot for a holding: in its realm near the target, else on the Outer Isles nearest that realm,
 * else nothing (deferred). Never a second owner, never a moved border.
 */
export function placeHolding(ctx: EditionContext, occupancy: Occupancy, realm: number | null, target: { x: number; y: number } | null, radius: number, kingdomId: string): Placed | null {
  if (realm !== null) {
    const point = nearestFreeSlot(ctx.land, occupancy, ctx.realms[realm]!, target ?? hashedTarget(ctx, realm, kingdomId), radius);
    if (point) return { realm, point, path: 'realm' };
  }
  const from = realm !== null ? ctx.realms[realm]! : null;
  const outer = [...ctx.outerRealms].sort((a, b) => {
    if (!from) return (hashString(`outer:${kingdomId}:${a}`) - hashString(`outer:${kingdomId}:${b}`)) || a - b;
    const da = Math.hypot(ctx.realms[a]!.x - from.x, ctx.realms[a]!.y - from.y);
    const db = Math.hypot(ctx.realms[b]!.x - from.x, ctx.realms[b]!.y - from.y);
    return da - db || a - b;
  });
  for (const index of outer) {
    const point = nearestFreeSlot(ctx.land, occupancy, ctx.realms[index]!, hashedTarget(ctx, index, kingdomId), radius);
    if (point) return { realm: index, point, path: 'outer' };
  }
  return null;
}

/**
 * A pencil place for a small live channel (5–24 viewers): the free hamlet slot nearest its hashed spot in its realm.
 * Computed, never stored; it can wander between nights until the channel is granted land.
 */
export function provisionalPlace(ctx: EditionContext, occupancy: Occupancy, channel: Pick<ChannelObservation, 'kingdomId' | 'language' | 'categories'>): Placed | null {
  return placeHolding(ctx, occupancy, realmFor(ctx, channel), null, ctx.world.lattice.hamletRadius, channel.kingdomId);
}

/** Weighted centre of a channel's observed raid ties to holdings in the same realm, or null without any. */
export function raidTieTarget(ctx: EditionContext, kingdomId: string, realm: number, ties: ReadonlyMap<string, ReadonlyMap<string, number>>, state: LedgerState): { x: number; y: number } | null {
  let x = 0;
  let y = 0;
  let weight = 0;
  for (const [partner, raids] of ties.get(kingdomId) ?? []) {
    const ordinal = state.owners.get(partner);
    if (ordinal === undefined || state.tombstones.has(partner)) continue;
    const settler = state.settlers[ordinal]!;
    if (settler.realmIndex !== realm) continue;
    x += settler.point.x * raids;
    y += settler.point.y * raids;
    weight += raids;
  }
  return weight > 0 ? { x: x / weight, y: y / weight } : null;
}

export function raidTies(pairs: readonly RaidPair[]): Map<string, Map<string, number>> {
  const ties = new Map<string, Map<string, number>>();
  const add = (a: string, b: string, raids: number) => {
    const map = ties.get(a) ?? new Map<string, number>();
    map.set(b, (map.get(b) ?? 0) + raids);
    ties.set(a, map);
  };
  for (const pair of pairs) {
    add(pair.fromKingdomId, pair.toKingdomId, pair.raids);
    add(pair.toKingdomId, pair.fromKingdomId, pair.raids);
  }
  return ties;
}

export interface NightInput {
  number: EditionNumber;
  ctx: EditionContext;
  state: LedgerState;
  manifest: SnapshotManifest;
  channels: readonly ChannelObservation[];
  raidPairs: readonly RaidPair[];
  raidObservations: readonly RaidObservation[];
  /** The withheld list at this run (hidden channels and moderation removals). */
  withheld: ReadonlySet<string>;
  /** Sign-in and founding claims from the claim log; each is granted once, from Edition I. */
  claims?: readonly Claim[];
  /** Witnessed raids from the road ledger beyond the survey's own (raid-show's authority). */
  roadRaids?: readonly AtlasRaid[];
}

export interface NightResult {
  events: LedgerEvent[];
  summary: { settled: number; byRaid: number; byClaim: number; outer: number; tombstones: number; restores: number; deferred: number; unseenRaidTargets: number };
}

/**
 * One cartography run. A revision older than (or equal to) the last settled one is refused: an out-of-order snapshot
 * can never roll land back. Absence from a revision is not evidence of anything, so it changes nothing.
 */
export function settleNight(input: NightInput): NightResult {
  const { ctx, state, manifest, number } = input;
  if (state.lastNight && manifest.asOf <= state.lastNight.asOf) {
    throw new Error(`Revision ${manifest.revision} is not newer than the last settled ${state.lastNight.revision}.`);
  }
  const events: LedgerEvent[] = [];
  const revision = manifest.revision;
  const channelById = new Map(input.channels.map((channel) => [channel.kingdomId, channel]));

  // Tombstones and restorations for land already held.
  let tombstones = 0;
  let restores = 0;
  /** Who holds land under a tombstone once this night's tombstones and restorations apply. */
  const silenced = new Set(state.tombstones.keys());
  for (const settler of [...state.settlers].sort((a, b) => compareIds(a.kingdomId, b.kingdomId))) {
    const id = settler.kingdomId;
    const channel = channelById.get(id);
    const current = state.tombstones.get(id);
    const hidden = input.withheld.has(id);
    const goneAt = channel?.goneAt ?? null;
    const holdingId = settler.holdingId;
    if (!current) {
      // Hidden outranks gone: a withheld channel's land waits from this run even when the channel is also gone.
      if (hidden) events.push({ kind: 'tombstone', kingdomId: settler.kingdomId, holdingId, cause: 'hidden', at: manifest.asOf, revision });
      else if (goneAt !== null) events.push({ kind: 'tombstone', kingdomId: settler.kingdomId, holdingId, cause: 'gone', at: goneAt, revision });
      else continue;
      silenced.add(id);
      tombstones++;
    } else if (hidden && current.cause === 'gone') {
      // A gone holding withheld later waits from now on rather than lying abandoned for the rest of its 30 days.
      events.push({ kind: 'tombstone', kingdomId: settler.kingdomId, holdingId, cause: 'hidden', at: manifest.asOf, revision });
      tombstones++;
    } else if (channel && goneAt === null && !hidden) {
      // Only a channel this revision actually observed, neither gone nor withheld, is restored. A hidden channel
      // missing from the sweep may still be hidden, deleted or banned: absence proves nothing, so it stays waiting.
      events.push({ kind: 'restore', kingdomId: settler.kingdomId, holdingId, at: manifest.asOf, revision });
      silenced.delete(id);
      restores++;
    }
  }

  const occupancy = occupancyOf(ctx, state.settlers);
  const ties = raidTies(input.raidPairs);
  let ordinal = state.settlers.length;
  let settled = 0;
  let outer = 0;
  let deferred = 0;
  const granted = new Set<string>();
  const grant = (channel: ChannelObservation, tier: HoldingTier, reason: 'candidate' | 'raid'): boolean => {
    const realm = realmFor(ctx, channel);
    const radius = holdingRadius(ctx.world, tier);
    const target = realm !== null ? raidTieTarget(ctx, channel.kingdomId, realm, ties, state) : null;
    const placed = placeHolding(ctx, occupancy, realm, target, radius, channel.kingdomId);
    if (!placed) {
      deferred++;
      return false;
    }
    occupancy.add(placed.point.x, placed.point.y, radius);
    events.push({
      kind: 'settle',
      settler: {
        ordinal: ordinal++,
        kingdomId: channel.kingdomId as AtlasSettler['kingdomId'],
        holdingId: slotHoldingId(placed.point.i, placed.point.j),
        realmIndex: placed.realm,
        holdingTier: tier,
        point: { x: placed.point.x, y: placed.point.y },
        settledAt: manifest.asOf,
      },
      reason,
      path: placed.path,
      revision,
    });
    granted.add(channel.kingdomId);
    settled++;
    if (placed.path === 'outer') outer++;
    return true;
  };
  const eligible = (channel: ChannelObservation) =>
    !state.owners.has(channel.kingdomId) && !granted.has(channel.kingdomId) && publicVisibility(channel, input.withheld) === 'public';

  // New kingdoms: largest first, so a city claims its room before villages fill the gaps.
  const newcomers = input.channels
    .filter((channel) => channel.kingdomCandidate && eligible(channel))
    .map((channel) => ({ channel, tier: holdingTierFor(channel.averageViewers) }))
    .sort((a, b) => TIER_ORDER.indexOf(b.tier) - TIER_ORDER.indexOf(a.tier) || b.channel.averageViewers - a.channel.averageViewers || compareIds(a.channel.kingdomId, b.channel.kingdomId));
  for (const { channel, tier } of newcomers) grant(channel, tier, 'candidate');

  /**
   * A claimed channel's grant: the free slot at its own pencil place when that slot is still free, else the nearest
   * free slot to it, in the realm the map already shows it in; the Outer Isles only when that realm is full.
   */
  const claimGrant = (facts: { kingdomId: string; language: string; categories: readonly { gameId: string; minutes: number }[] }, tier: HoldingTier, reason: 'raid' | 'founded' | 'signed-in'): boolean => {
    const realm = ctx.resolveRealm({ id: facts.kingdomId, language: facts.language, categories: facts.categories });
    const radius = holdingRadius(ctx.world, tier);
    const target = editionPencilPlace(ctx, state, realm, facts.kingdomId);
    const placed = placeHolding(ctx, occupancy, realm, target, radius, facts.kingdomId);
    if (!placed) {
      deferred++;
      return false;
    }
    occupancy.add(placed.point.x, placed.point.y, radius);
    events.push({
      kind: 'settle',
      settler: {
        ordinal: ordinal++,
        kingdomId: facts.kingdomId as AtlasSettler['kingdomId'],
        holdingId: slotHoldingId(placed.point.i, placed.point.j),
        realmIndex: placed.realm,
        holdingTier: tier,
        point: { x: placed.point.x, y: placed.point.y },
        settledAt: manifest.asOf,
      },
      reason,
      path: placed.path,
      revision,
    });
    granted.add(facts.kingdomId);
    settled++;
    if (placed.path === 'outer') outer++;
    return true;
  };
  const landByClaim = EDITIONS[number].landByRaid;

  // Claims (Edition I): a streamer who signed in, or a kingdom founded in Chatdom, is granted its pencil place. The
  // survey's facts win when it observed the channel; otherwise the facts the claim recorded on arrival decide.
  let byClaim = 0;
  if (landByClaim) {
    for (const claim of [...(input.claims ?? [])].sort(claimOrder)) {
      const id = claim.kingdomId;
      if (state.owners.has(id) || granted.has(id) || input.withheld.has(id)) continue;
      const observed = channelById.get(id);
      // The one visibility gate, on the survey's facts or else on the facts the claim recorded on arrival.
      const gate = observed ?? { kingdomId: id, categories: claim.categories, goneAt: null, stream: null };
      if (publicVisibility(gate, input.withheld) !== 'public') continue;
      const facts = observed
        ? { kingdomId: id, language: observed.language, categories: observed.categories }
        : { kingdomId: id, language: claim.language, categories: claim.categories };
      if (claimGrant(facts, holdingTierFor(observed?.averageViewers ?? 0), claim.cause)) byClaim++;
    }
  }

  // Land by raid (Edition I): a raid from a settled kingdom grants an observed small target the slot at its pencil
  // place, so the road keeps its end. Raids come from the survey's recorder and from raid-show's witnessed feed in
  // the road ledger; the same raid seen twice grants once. A target the sweep never saw (under five viewers) is
  // reached at the edge of known land and gets nothing.
  let byRaid = 0;
  const unseen = new Set<string>();
  if (landByClaim) {
    const since = state.lastNight?.asOf ?? 0;
    const until = Math.max(manifest.source.database.openedAt, ...(input.roadRaids ?? []).map((raid) => raid.observedAt));
    const raids = [...input.raidObservations.map((observation) => observation.raid), ...(input.roadRaids ?? [])]
      .filter((raid) => raid.observedAt > since && raid.observedAt <= until)
      .sort((a, b) => a.observedAt - b.observedAt || compareIds(a.toKingdomId, b.toKingdomId) || compareIds(a.fromKingdomId, b.fromKingdomId));
    for (const raid of raids) {
      const from = state.owners.get(raid.fromKingdomId);
      // A hidden or gone kingdom's raids grant nothing, including one tombstoned this very night.
      if (from === undefined || silenced.has(raid.fromKingdomId)) continue;
      const target = channelById.get(raid.toKingdomId);
      if (!target) {
        if (!state.owners.has(raid.toKingdomId) && !granted.has(raid.toKingdomId)) unseen.add(raid.toKingdomId);
        continue;
      }
      if (!eligible(target)) continue;
      if (claimGrant({ kingdomId: target.kingdomId, language: target.language, categories: target.categories }, 'hamlet', 'raid')) byRaid++;
    }
  }

  events.push({ kind: 'night', revision, asOf: manifest.asOf, settled, byRaid, outer, tombstones, restores, deferred });
  return { events, summary: { settled, byRaid, byClaim, outer, tombstones, restores, deferred, unseenRaidTargets: unseen.size } };
}

/**
 * Moderation between surveys: a cartography run with no newer revision still reads the withheld list, and every
 * holding on it that is not yet hidden waits from this run on, including one already tombstoned as gone (hidden
 * outranks gone). Hiding never waits for a fresh sweep; lifting a tombstone does (only an observed revision restores
 * land), so this pass only ever adds hidden tombstones.
 */
export function hideWithheld(state: LedgerState, withheld: ReadonlySet<string>, revision: string, at: number): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  for (const settler of [...state.settlers].sort((a, b) => compareIds(a.kingdomId, b.kingdomId))) {
    if (!withheld.has(settler.kingdomId) || state.tombstones.get(settler.kingdomId)?.cause === 'hidden') continue;
    events.push({ kind: 'tombstone', kingdomId: settler.kingdomId, holdingId: settler.holdingId, cause: 'hidden', at, revision });
  }
  return events;
}

/** The lattice point a slot holding claims to stand on, or null for a founding holding. */
export function slotPointOf(holdingId: string): LatticePoint | null {
  const match = /^s:(-?\d{1,7}):(-?\d{1,7})$/.exec(holdingId);
  return match ? latticePoint(Number(match[1]), Number(match[2])) : null;
}

export { LATTICE };
