import { compareIds } from '../export/project';
import type { Placement } from '../cartography/taxonomy';
import { hashString } from './noise';

/**
 * Placement of holdings (R2, R4, R5). Every input is an observed channel; the layout only decides where its holding
 * is drawn. Languages become continents (≥600 candidates) or islands in the Isles of Many Tongues. A continent is
 * divided into realms: the Crossroads at its heart for variety channels, one realm per family of games that is
 * large enough there, and the Wilds at its edge for small families and games no family claims. Inside a realm,
 * channels that mostly stream the same category sit together. The Outer Isles are reserved, empty, for overflow.
 * The survey preview draws this from one revision; an edition freezes it.
 */
export const TIERS = ['capital', 'city', 'town', 'village'] as const;
export type Tier = typeof TIERS[number];

/** Average viewers (viewer-minutes / live-minutes) at which a holding reaches each tier. */
export const TIER_MIN_AVERAGE: Record<Tier, number> = { capital: 5_000, city: 500, town: 50, village: 25 };
/** Holding radius in world units ("leagues"). The deepest zoom draws a capital about 400 CSS px wide. */
export const HOLDING_RADIUS: Record<Tier, number> = { capital: 6, city: 3.4, town: 1.8, village: 1.25 };
/** A hamlet's holding: one slot of the hamlet lattice (see cartography/slots). */
export const HAMLET_RADIUS = 0.5;
/** Land per holding area: the rest is waiting land, where hamlet slots will lie once an edition is founded. */
export const WAITING_FACTOR = 4;
export const CONTINENT_MIN_CANDIDATES = 600;
export const MIN_HOLDING_GAP = 0.6;
const CLUSTER_GAP = 2.5;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function tierFor(average: number): Tier {
  if (average >= TIER_MIN_AVERAGE.capital) return 'capital';
  if (average >= TIER_MIN_AVERAGE.city) return 'city';
  if (average >= TIER_MIN_AVERAGE.town) return 'town';
  return 'village';
}

export interface PreviewChannel {
  id: string;
  login: string;
  name: string;
  /** When the source last confirmed the login and name. */
  factsAt: number;
  language: string;
  average: number;
  /** The category with the most observed live minutes, or null when the source recorded none. */
  mainGameId: string | null;
  /** Family, Crossroads or Wilds, from the taxonomy and the observed category minutes. */
  placement: Placement;
}

export interface PlacedChannel extends PreviewChannel {
  tier: Tier;
  r: number;
  x: number;
  y: number;
  region: number;
  realm: number;
  cluster: number;
}

/** A patch of one realm's ground: the channels of one main category, a mixed group, or reserved waiting land. */
export interface Cluster {
  index: number;
  region: number;
  realm: number;
  /** The shared main category, or null for a mixed group or empty waiting land (drawn without a label). */
  gameId: string | null;
  x: number;
  y: number;
  r: number;
  members: number;
}

export type RealmKind = 'crossroads' | 'family' | 'wilds' | 'isle' | 'outer';

export interface Realm {
  index: number;
  region: number;
  kind: RealmKind;
  /** Family index in the taxonomy for a family realm, otherwise -1. */
  family: number;
  x: number;
  y: number;
  r: number;
  members: number;
}

export interface Region {
  index: number;
  /** The stream language; null for the Outer Isles, which belong to no language. */
  language: string | null;
  kind: 'continent' | 'isle' | 'outer';
  x: number;
  y: number;
  r: number;
  members: number;
}

export interface Layout {
  regions: Region[];
  realms: Realm[];
  clusters: Cluster[];
  settlers: PlacedChannel[];
  /** The Isles of Many Tongues as one circle, when any language is too small for a continent. */
  isles: { x: number; y: number; r: number } | null;
  /** The Outer Isles as one circle around their islands. */
  outer: { x: number; y: number; r: number } | null;
}

interface Circle { x: number; y: number; r: number }

const tierRank = (tier: Tier) => TIERS.indexOf(tier);

/** Holdings first by tier, then by observed average, then by ID; never by login. */
export function compareHoldings(a: { tier: Tier; average: number; id: string }, b: { tier: Tier; average: number; id: string }): number {
  return tierRank(a.tier) - tierRank(b.tier) || b.average - a.average || compareIds(a.id, b.id);
}

function overlaps(circle: Circle, placed: readonly Circle[], gap: number): boolean {
  for (const other of placed) {
    const min = circle.r + other.r + gap - 1e-6;
    const dx = circle.x - other.x;
    const dy = circle.y - other.y;
    if (dx * dx + dy * dy < min * min) return true;
  }
  return false;
}

/**
 * Greedy front packing: each circle (largest first) takes the free tangent position nearest the centre. `stretch`
 * > 1 favours a wide arrangement for landscape screens. Deterministic for a given input order.
 */
export function packCircles(radii: readonly number[], gap: number, stretch = 1): Circle[] {
  const placed: Circle[] = [];
  const metric = (x: number, y: number) => Math.hypot(x / stretch, y);
  for (const r of radii) {
    if (placed.length === 0) {
      placed.push({ x: 0, y: 0, r });
      continue;
    }
    let best: Circle | null = null;
    let bestScore = Infinity;
    const consider = (x: number, y: number) => {
      const candidate = { x, y, r };
      const score = metric(x, y);
      if (score < bestScore - 1e-9 && !overlaps(candidate, placed, gap)) {
        best = candidate;
        bestScore = score;
      }
    };
    for (const a of placed) {
      for (let k = 0; k < 16; k++) {
        const angle = (k / 16) * Math.PI * 2;
        const d = a.r + r + gap;
        consider(a.x + Math.cos(angle) * d, a.y + Math.sin(angle) * d);
      }
    }
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!;
        const b = placed[j]!;
        const ra = a.r + r + gap;
        const rb = b.r + r + gap;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d === 0 || d > ra + rb || d < Math.abs(ra - rb)) continue;
        const along = (ra * ra - rb * rb + d * d) / (2 * d);
        const h = Math.sqrt(Math.max(0, ra * ra - along * along));
        const mx = a.x + (dx * along) / d;
        const my = a.y + (dy * along) / d;
        consider(mx - (dy * h) / d, my + (dx * h) / d);
        consider(mx + (dy * h) / d, my - (dx * h) / d);
      }
    }
    if (!best) throw new Error('Circle packing found no free position.');
    placed.push(best);
  }
  return placed;
}

interface Member extends PreviewChannel { tier: Tier; r: number; x: number; y: number }

/** Sunflower placement by cumulative area (largest at the heart), then deterministic overlap relaxation. */
function placeMembers(members: Member[], phase: number): number {
  let area = 0;
  members.forEach((member, i) => {
    const own = Math.PI * member.r * member.r * WAITING_FACTOR;
    const radius = Math.sqrt((area + own / 2) / Math.PI);
    area += own;
    const angle = i * GOLDEN_ANGLE + phase;
    member.x = Math.cos(angle) * radius;
    member.y = Math.sin(angle) * radius;
  });
  relax(members);
  let extent = 0;
  for (const member of members) extent = Math.max(extent, Math.hypot(member.x, member.y) + member.r);
  return extent + 1;
}

function relax(members: Member[]): void {
  if (members.length < 2) return;
  const cell = HOLDING_RADIUS.capital * 2 + MIN_HOLDING_GAP;
  for (let iteration = 0; iteration < 60; iteration++) {
    const grid = new Map<string, number[]>();
    members.forEach((member, index) => {
      const key = `${Math.floor(member.x / cell)},${Math.floor(member.y / cell)}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(index);
      else grid.set(key, [index]);
    });
    let moved = false;
    for (let i = 0; i < members.length; i++) {
      const a = members[i]!;
      const cx = Math.floor(a.x / cell);
      const cy = Math.floor(a.y / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          for (const j of grid.get(`${gx},${gy}`) ?? []) {
            if (j <= i) continue;
            const b = members[j]!;
            const min = a.r + b.r + MIN_HOLDING_GAP;
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let d = Math.hypot(dx, dy);
            if (d >= min) continue;
            if (d < 1e-9) {
              const angle = (hashString(`${a.id}:${b.id}`) / 4294967296) * Math.PI * 2;
              dx = Math.cos(angle);
              dy = Math.sin(angle);
              d = 1;
            }
            // The smaller holding gives way more, so capitals stay at the heart of their community.
            const push = (min - d) / d;
            const wa = (b.r * b.r) / (a.r * a.r + b.r * b.r);
            a.x -= dx * push * wa;
            a.y -= dy * push * wa;
            b.x += dx * push * (1 - wa);
            b.y += dy * push * (1 - wa);
            moved = true;
          }
        }
      }
    }
    if (!moved) return;
  }
}

/** Main-category groups inside one realm; small categories fill a few mixed groups, kept whole per category. */
function groupByCategory(channels: readonly Member[]): { gameId: string | null; members: Member[] }[] {
  const byGame = new Map<string, Member[]>();
  const none: Member[] = [];
  for (const channel of channels) {
    if (channel.mainGameId === null) none.push(channel);
    else {
      const list = byGame.get(channel.mainGameId);
      if (list) list.push(channel);
      else byGame.set(channel.mainGameId, [channel]);
    }
  }
  const threshold = Math.max(8, Math.ceil(channels.length * 0.012));
  const groups: { gameId: string | null; members: Member[] }[] = [];
  const small: [string, Member[]][] = [];
  for (const [gameId, members] of [...byGame.entries()].sort((a, b) => compareIds(a[0], b[0]))) {
    if (members.length >= threshold) groups.push({ gameId, members });
    else small.push([gameId, members]);
  }
  const mixedCount = small.reduce((sum, [, members]) => sum + members.length, 0) + none.length;
  if (mixedCount > 0) {
    const target = Math.max(60, Math.ceil(channels.length * 0.06));
    const buckets = Math.max(1, Math.round(mixedCount / target));
    const mixed: Member[][] = Array.from({ length: buckets }, () => []);
    for (const [gameId, members] of small) mixed[hashString(`game:${gameId}`) % buckets]!.push(...members);
    for (const member of none) mixed[hashString(`channel:${member.id}`) % buckets]!.push(member);
    for (const members of mixed) if (members.length) groups.push({ gameId: null, members });
  }
  for (const group of groups) group.members.sort(compareHoldings);
  // Biggest community first so it takes the heart of the realm; ties by category ID.
  return groups.sort((a, b) => b.members.length - a.members.length ||
    (a.gameId === null ? 1 : 0) - (b.gameId === null ? 1 : 0) || compareIds(a.gameId ?? '0', b.gameId ?? '0') ||
    compareIds(a.members[0]!.id, b.members[0]!.id));
}

/**
 * A family has a realm on a continent when at least this many of the continent's channels belong to it; smaller
 * families live in the Wilds. Documented in Spec 01 as `realm-threshold-1`.
 */
export function realmThreshold(continentMembers: number): number {
  return Math.max(24, Math.ceil(continentMembers * 0.015));
}
/** Waiting land kept for a realm that has no channels yet (an empty Crossroads or Wilds), in world units. */
export const RESERVED_REALM_RADIUS = 9;
const REALM_GAP = 3.5;

interface GroupPlan { gameId: string | null; members: Member[]; circle: Circle; r: number }
interface RealmPlan { kind: RealmKind; family: number; r: number; groups: GroupPlan[]; circle: Circle }

interface RegionPlan {
  language: string;
  kind: 'continent' | 'isle';
  r: number;
  realms: RealmPlan[];
}

function planRealm(kind: RealmKind, family: number, members: Member[], seed: string): RealmPlan {
  if (members.length === 0) {
    const r = RESERVED_REALM_RADIUS;
    return { kind, family, r, circle: { x: 0, y: 0, r }, groups: [] };
  }
  const groups = groupByCategory(members).map((group, i) => {
    const r = placeMembers(group.members, (hashString(`${seed}:${group.gameId ?? i}`) / 4294967296) * Math.PI * 2);
    return { ...group, r, circle: { x: 0, y: 0, r } };
  });
  const circles = packCircles(groups.map((group) => group.r), CLUSTER_GAP, 1.15);
  let extent = 0;
  groups.forEach((group, i) => {
    group.circle = circles[i]!;
    extent = Math.max(extent, Math.hypot(group.circle.x, group.circle.y) + group.r);
  });
  return { kind, family, r: extent, circle: { x: 0, y: 0, r: extent }, groups };
}

/** How densely a realm's patches fill its ground once relaxed; sets the realm's area-equivalent radius. */
const PATCH_DENSITY = 0.8;
const patchArea = (r: number) => (r + CLUSTER_GAP / 2) ** 2;

interface Patch { realm: number; x: number; y: number; r: number; group: GroupPlan | null }

/**
 * Lays a region's realms down as one landmass. Nested circle packing leaves a void between every three circles at
 * every level, and those voids become sea, so a continent would fall apart into islands. Instead each realm is packed
 * at its area-equivalent radius, its patches start compressed around that centre, and every patch of the region is
 * relaxed together: each is drawn toward its realm's centre (so a realm stays one contiguous patch of land) and,
 * more weakly, toward the region's heart (so no voids open between realms), and pushed out of any patch it overlaps,
 * with a wider gap between patches of different realms. Holdings never leave their patch, so they cannot overlap.
 * Deterministic for a given input order.
 */
function settleRealms(realms: RealmPlan[], stretch: number): number {
  const equivalent = realms.map((realm) => realm.groups.length
    ? Math.sqrt(realm.groups.reduce((sum, group) => sum + patchArea(group.r), 0) / PATCH_DENSITY)
    : realm.r);
  const centres = packCircles(equivalent, REALM_GAP, stretch);
  const patches: Patch[] = [];
  realms.forEach((realm, index) => {
    const centre = centres[index]!;
    if (realm.groups.length === 0) {
      patches.push({ realm: index, x: centre.x, y: centre.y, r: realm.r, group: null });
      return;
    }
    const squeeze = Math.min(1, equivalent[index]! / realm.r);
    for (const group of realm.groups) {
      patches.push({ realm: index, x: centre.x + group.circle.x * squeeze, y: centre.y + group.circle.y * squeeze, r: group.r, group });
    }
  });
  relaxPatches(patches, centres);

  let extent = 0;
  realms.forEach((realm, index) => {
    const own = patches.filter((patch) => patch.realm === index);
    const weight = own.reduce((sum, patch) => sum + patchArea(patch.r), 0);
    const x = own.reduce((sum, patch) => sum + patch.x * patchArea(patch.r), 0) / weight;
    const y = own.reduce((sum, patch) => sum + patch.y * patchArea(patch.r), 0) / weight;
    const r = realm.groups.length ? Math.sqrt(weight) : realm.r;
    realm.circle = { x, y, r };
    realm.r = r;
    for (const patch of own) {
      if (patch.group) patch.group.circle = { x: patch.x - x, y: patch.y - y, r: patch.r };
      extent = Math.max(extent, Math.hypot(patch.x, patch.y) + patch.r);
    }
  });
  return extent;
}

const RELAX_PULL = 0.05;
const RELAX_HEART = 0.012;
const RELAX_GATHER_ROUNDS = 240;
const RELAX_MAX_ROUNDS = 4000;

function relaxPatches(patches: Patch[], centres: readonly Circle[]): void {
  for (let round = 0; round < RELAX_MAX_ROUNDS; round++) {
    const gathering = round < RELAX_GATHER_ROUNDS;
    if (gathering) {
      for (const patch of patches) {
        const centre = centres[patch.realm]!;
        patch.x += (centre.x - patch.x) * RELAX_PULL - patch.x * RELAX_HEART;
        patch.y += (centre.y - patch.y) * RELAX_PULL - patch.y * RELAX_HEART;
      }
    }
    let moved = false;
    for (let i = 0; i < patches.length; i++) {
      for (let j = i + 1; j < patches.length; j++) {
        const a = patches[i]!;
        const b = patches[j]!;
        const min = a.r + b.r + (a.realm === b.realm ? CLUSTER_GAP : REALM_GAP);
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= min - 1e-9) continue;
        if (d < 1e-9) {
          const angle = ((i * 7919 + j * 104729) % 360) * (Math.PI / 180);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          d = 1;
        }
        // Overshoot a hair so the final pass settles instead of creeping toward the limit.
        const push = (min - d + 1e-6) / d;
        const wa = (b.r * b.r) / (a.r * a.r + b.r * b.r);
        a.x -= dx * push * wa;
        a.y -= dy * push * wa;
        b.x += dx * push * (1 - wa);
        b.y += dy * push * (1 - wa);
        moved = true;
      }
    }
    if (!gathering && !moved) return;
  }
  throw new Error('Realm patches did not settle apart.');
}

function planRegion(language: string, channels: readonly PreviewChannel[]): RegionPlan {
  const members: Member[] = channels.map((channel) => {
    const tier = tierFor(channel.average);
    return { ...channel, tier, r: HOLDING_RADIUS[tier], x: 0, y: 0 };
  });
  if (channels.length < CONTINENT_MIN_CANDIDATES) {
    const realm = planRealm('isle', -1, members, language);
    const r = settleRealms([realm], 1.15);
    return { language, kind: 'isle', r, realms: [realm] };
  }
  const threshold = realmThreshold(members.length);
  const byFamily = new Map<number, Member[]>();
  const crossroads: Member[] = [];
  for (const member of members) {
    if (member.placement.kind === 'variety') crossroads.push(member);
    else if (member.placement.kind === 'family') {
      const list = byFamily.get(member.placement.family);
      if (list) list.push(member);
      else byFamily.set(member.placement.family, [member]);
    }
  }
  const wilds = members.filter((member) => member.placement.kind === 'unassigned' ||
    (member.placement.kind === 'family' && byFamily.get(member.placement.family)!.length < threshold));
  const families = [...byFamily.entries()]
    .filter(([, list]) => list.length >= threshold)
    .sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
  // The Crossroads first, so it takes the continent's heart; the Wilds last, so they lie at its edge.
  const realms = [
    planRealm('crossroads', -1, crossroads, `${language}:crossroads`),
    ...families.map(([family, list]) => planRealm('family', family, list, `${language}:family:${family}`)),
    planRealm('wilds', -1, wilds, `${language}:wilds`),
  ];
  const r = settleRealms(realms, 1.25);
  return { language, kind: 'continent', r, realms };
}

/** Seas between continents grow with their size; the isles sit closer together inside their archipelago. */
export const continentGap = (r: number) => 34 + r * 0.16;
const ISLE_GAP = 16;
/** The Outer Isles: a handful of empty islands, together about this share of the land of every language. */
export const OUTER_ISLES = Object.freeze({ islands: 6, landShare: 0.05, minRadius: 14 });

function outerIsleRadii(regionPlans: readonly RegionPlan[]): number[] {
  const land = regionPlans.reduce((sum, plan) => sum + Math.PI * plan.r * plan.r, 0);
  const weights = Array.from({ length: OUTER_ISLES.islands }, (_, i) => 0.6 + (hashString(`outer-isle:${i}`) / 4294967296) * 0.8);
  const total = weights.reduce((sum, w) => sum + w, 0);
  return weights
    .map((w) => Math.max(OUTER_ISLES.minRadius, Math.sqrt((land * OUTER_ISLES.landShare * w) / total / Math.PI)))
    .sort((a, b) => b - a);
}

/**
 * The ground of one Outer Isle: a body and a few seeded lobes inside its circle, so each island has its own outline
 * (headlands and bays) instead of a disc's. Seeded by the region index only.
 */
function outerIsleLobes(region: number, r: number): Circle[] {
  const unit = (salt: string) => hashString(`outer-isle:${region}:${salt}`) / 4294967296;
  const body = r * (0.6 + unit('body') * 0.1);
  const lobes: Circle[] = [{ x: 0, y: 0, r: body }];
  const count = 3 + Math.floor(unit('lobes') * 3);
  const start = unit('turn') * Math.PI * 2;
  for (let k = 0; k < count; k++) {
    const lr = r * (0.22 + unit(`r:${k}`) * 0.16);
    const angle = start + (k / count) * Math.PI * 2 + (unit(`a:${k}`) - 0.5) * 0.9;
    const reach = Math.min(r * 0.92 - lr, body + lr * (0.25 + unit(`d:${k}`) * 0.5));
    lobes.push({ x: Math.cos(angle) * reach, y: Math.sin(angle) * reach, r: lr });
  }
  return lobes;
}

export function layoutPreview(channels: readonly PreviewChannel[]): Layout {
  const byLanguage = new Map<string, PreviewChannel[]>();
  for (const channel of channels) {
    const list = byLanguage.get(channel.language);
    if (list) list.push(channel);
    else byLanguage.set(channel.language, [channel]);
  }
  const plans = [...byLanguage.entries()]
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
    .map(([language, list]) => planRegion(language, list));
  const continents = plans.filter((plan) => plan.kind === 'continent');
  const isles = plans.filter((plan) => plan.kind === 'isle');

  // The archipelagos are packed first, then placed in the world as more "continents".
  const isleCircles = packCircles(isles.map((plan) => plan.r), ISLE_GAP, 1.4);
  let archipelagoR = 0;
  isleCircles.forEach((circle) => (archipelagoR = Math.max(archipelagoR, Math.hypot(circle.x, circle.y) + circle.r)));
  const outerRadii = outerIsleRadii(plans);
  // Open sea between the Outer Isles, so they read as a scatter of islands rather than one land.
  const outerCircles = packCircles(outerRadii, Math.max(ISLE_GAP * 1.3, outerRadii[0]! * 0.5), 1.6);
  let outerR = 0;
  outerCircles.forEach((circle) => (outerR = Math.max(outerR, Math.hypot(circle.x, circle.y) + circle.r)));

  const worldItems = [...continents.map((plan) => plan.r), ...(isles.length ? [archipelagoR] : []), outerR];
  const maxR = Math.max(...worldItems);
  const worldCircles = packCircles(worldItems, continentGap(maxR) * 0.55, 1.5);

  const regions: Region[] = [];
  const realms: Realm[] = [];
  const clusters: Cluster[] = [];
  const settlers: PlacedChannel[] = [];
  const place = (plan: RegionPlan, cx: number, cy: number) => {
    const region = regions.length;
    const members = plan.realms.reduce((sum, realm) => sum + realm.groups.reduce((s, g) => s + g.members.length, 0), 0);
    regions.push({ index: region, language: plan.language, kind: plan.kind, x: cx, y: cy, r: plan.r, members });
    for (const realmPlan of plan.realms) {
      const rx = cx + realmPlan.circle.x;
      const ry = cy + realmPlan.circle.y;
      const realm = realms.length;
      const realmMembers = realmPlan.groups.reduce((s, g) => s + g.members.length, 0);
      realms.push({ index: realm, region, kind: realmPlan.kind, family: realmPlan.family, x: rx, y: ry, r: realmPlan.r, members: realmMembers });
      if (realmPlan.groups.length === 0) {
        clusters.push({ index: clusters.length, region, realm, gameId: null, x: rx, y: ry, r: realmPlan.r, members: 0 });
        continue;
      }
      for (const group of realmPlan.groups) {
        const gx = rx + group.circle.x;
        const gy = ry + group.circle.y;
        const cluster = clusters.length;
        clusters.push({ index: cluster, region, realm, gameId: group.gameId, x: gx, y: gy, r: group.r, members: group.members.length });
        for (const member of group.members) {
          const { x, y, r, tier, ...channel } = member;
          settlers.push({ ...channel, tier, r, x: gx + x, y: gy + y, region, realm, cluster });
        }
      }
    }
  };
  continents.forEach((plan, i) => place(plan, worldCircles[i]!.x, worldCircles[i]!.y));
  let islesCircle: Layout['isles'] = null;
  if (isles.length) {
    const centre = worldCircles[continents.length]!;
    islesCircle = { x: centre.x, y: centre.y, r: archipelagoR };
    isles.forEach((plan, i) => place(plan, centre.x + isleCircles[i]!.x, centre.y + isleCircles[i]!.y));
  }
  const outerCentre = worldCircles[worldCircles.length - 1]!;
  outerCircles.forEach((circle) => {
    const region = regions.length;
    const x = outerCentre.x + circle.x;
    const y = outerCentre.y + circle.y;
    regions.push({ index: region, language: null, kind: 'outer', x, y, r: circle.r, members: 0 });
    const realm = realms.length;
    realms.push({ index: realm, region, kind: 'outer', family: -1, x, y, r: circle.r, members: 0 });
    for (const lobe of outerIsleLobes(region, circle.r)) {
      clusters.push({ index: clusters.length, region, realm, gameId: null, x: x + lobe.x, y: y + lobe.y, r: lobe.r, members: 0 });
    }
  });
  return { regions, realms, clusters, settlers, isles: islesCircle, outer: { x: outerCentre.x, y: outerCentre.y, r: outerR } };
}
