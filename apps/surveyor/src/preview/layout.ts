import { compareIds } from '../export/project';
import { hashString } from './noise';

/**
 * Draft placement for the survey preview (R2, R4, R5). Every input is an observed channel; the layout only decides
 * where its holding is drawn. Languages become continents (≥600 candidates) or islands in the Isles of Many Tongues;
 * inside a language, channels that mostly stream the same category sit together. This is draft land: the official
 * family/realm geography and the frozen settler ledger come with founding, not from this preview.
 */
export const TIERS = ['capital', 'city', 'town', 'village'] as const;
export type Tier = typeof TIERS[number];

/** Average viewers (viewer-minutes / live-minutes) at which a holding reaches each tier. */
export const TIER_MIN_AVERAGE: Record<Tier, number> = { capital: 5_000, city: 500, town: 50, village: 25 };
/** Holding radius in world units ("leagues"). The deepest zoom draws a capital about 400 CSS px wide. */
export const HOLDING_RADIUS: Record<Tier, number> = { capital: 6, city: 3.4, town: 1.8, village: 1.25 };
/** Land per holding area: the rest is waiting land, where hamlet slots will lie once an edition is founded. */
export const WAITING_FACTOR = 4;
export const CONTINENT_MIN_CANDIDATES = 600;
const MIN_HOLDING_GAP = 0.6;
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
}

export interface PlacedChannel extends PreviewChannel {
  tier: Tier;
  r: number;
  x: number;
  y: number;
  region: number;
  cluster: number;
}

export interface Cluster {
  index: number;
  region: number;
  /** The shared main category, or null for a mixed group of smaller categories (drawn without a label). */
  gameId: string | null;
  x: number;
  y: number;
  r: number;
  members: number;
}

export interface Region {
  index: number;
  language: string;
  kind: 'continent' | 'isle';
  x: number;
  y: number;
  r: number;
  members: number;
}

export interface Layout {
  regions: Region[];
  clusters: Cluster[];
  settlers: PlacedChannel[];
  /** The Isles of Many Tongues as one circle, when any language is too small for a continent. */
  isles: { x: number; y: number; r: number } | null;
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

/** Main-category groups inside one language; small categories fill a few mixed groups, kept whole per category. */
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
  // Biggest community first so it takes the heart of the language's land; ties by category ID.
  return groups.sort((a, b) => b.members.length - a.members.length ||
    (a.gameId === null ? 1 : 0) - (b.gameId === null ? 1 : 0) || compareIds(a.gameId ?? '0', b.gameId ?? '0') ||
    compareIds(a.members[0]!.id, b.members[0]!.id));
}

interface RegionPlan {
  language: string;
  kind: 'continent' | 'isle';
  r: number;
  groups: { gameId: string | null; members: Member[]; circle: Circle; r: number }[];
}

function planRegion(language: string, channels: readonly PreviewChannel[]): RegionPlan {
  const members: Member[] = channels.map((channel) => {
    const tier = tierFor(channel.average);
    return { ...channel, tier, r: HOLDING_RADIUS[tier], x: 0, y: 0 };
  });
  const groups = groupByCategory(members).map((group, i) => {
    const r = placeMembers(group.members, (hashString(`${language}:${group.gameId ?? i}`) / 4294967296) * Math.PI * 2);
    return { ...group, r, circle: { x: 0, y: 0, r } };
  });
  const circles = packCircles(groups.map((group) => group.r), CLUSTER_GAP, 1.25);
  let extent = 0;
  groups.forEach((group, i) => {
    group.circle = circles[i]!;
    extent = Math.max(extent, Math.hypot(group.circle.x, group.circle.y) + group.r);
  });
  return { language, kind: channels.length >= CONTINENT_MIN_CANDIDATES ? 'continent' : 'isle', r: extent, groups };
}

/** Seas between continents grow with their size; the isles sit closer together inside their archipelago. */
export const continentGap = (r: number) => 34 + r * 0.16;
const ISLE_GAP = 16;

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

  // The archipelago is packed first, then placed in the world as one more "continent".
  const isleCircles = packCircles(isles.map((plan) => plan.r), ISLE_GAP, 1.4);
  let archipelagoR = 0;
  isleCircles.forEach((circle) => (archipelagoR = Math.max(archipelagoR, Math.hypot(circle.x, circle.y) + circle.r)));

  const worldItems = [...continents.map((plan) => plan.r), ...(isles.length ? [archipelagoR] : [])];
  const maxR = Math.max(...worldItems);
  const worldCircles = packCircles(worldItems, continentGap(maxR) * 0.55, 1.5);

  const regions: Region[] = [];
  const clusters: Cluster[] = [];
  const settlers: PlacedChannel[] = [];
  const place = (plan: RegionPlan, cx: number, cy: number) => {
    const region = regions.length;
    regions.push({ index: region, language: plan.language, kind: plan.kind, x: cx, y: cy, r: plan.r, members: plan.groups.reduce((s, g) => s + g.members.length, 0) });
    for (const group of plan.groups) {
      const gx = cx + group.circle.x;
      const gy = cy + group.circle.y;
      const cluster = clusters.length;
      clusters.push({ index: cluster, region, gameId: group.gameId, x: gx, y: gy, r: group.r, members: group.members.length });
      for (const member of group.members) {
        const { x, y, r, tier, ...channel } = member;
        settlers.push({ ...channel, tier, r, x: gx + x, y: gy + y, region, cluster });
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
  return { regions, clusters, settlers, isles: islesCircle };
}
