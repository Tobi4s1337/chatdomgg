import { compareIds, sha256 } from '../export/project';
import { KINGDOM_CANDIDATE_MIN_AVERAGE, type ChannelObservation, type Game, type SnapshotManifest } from '../export/schema';
import {
  COORD_SCALE, DECOR_KINDS, buildField, extractRings, placeDecor, type Bounds,
} from './land';
import { HOLDING_RADIUS, TIER_MIN_AVERAGE, layoutPreview, type Layout, type PlacedChannel, type PreviewChannel } from './layout';
import { GAMBLING_POLICY, publicVisibility } from '../policy/visibility';
import {
  ISLES_NAME, PREVIEW_ALGORITHM, PREVIEW_KIND, PREVIEW_LABEL, PreviewChunkSchema, PreviewManifestSchema, PreviewNamesSchema,
  PreviewWorldSchema, TIER_CODES, type PreviewChunk, type PreviewManifest, type PreviewNames, type PreviewWorld, type SettlerColumns,
} from './schema';

export interface PreviewFiles {
  id: string;
  manifest: PreviewManifest;
  world: PreviewWorld;
  names: PreviewNames;
  /** File name → exact bytes. world.json pins every chunk by hash; the manifest pins world.json and names.json. */
  files: Map<string, Uint8Array>;
}

/** Same revision and algorithm → same ID; the bytes behind it are reproducible from the revision alone. */
export function previewIdFor(revision: string, asOf: number): string {
  const stamp = new Date(asOf).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `pv-${stamp}-${sha256(`${PREVIEW_KIND}:${PREVIEW_ALGORITHM}:${revision}`).slice(0, 12)}`;
}

const q = (value: number) => Math.round(value * COORD_SCALE);
const encoder = new TextEncoder();
const json = (value: unknown) => encoder.encode(`${JSON.stringify(value)}\n`);

/** The language's own name, capitalised as a map title; Twitch's "other" stays honest rather than invented. */
export function languageNames(code: string): { name: string; englishName: string } {
  if (code === 'other') return { name: 'Other tongues', englishName: 'Other languages' };
  const lookup = (locale: string) => {
    try {
      return new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' }).of(code) ?? null;
    } catch {
      return null;
    }
  };
  const english = lookup('en') ?? code.toUpperCase();
  const own = lookup(code) ?? english;
  const title = (text: string) => text.charAt(0).toLocaleUpperCase(code === 'other' ? 'en' : code) + text.slice(1);
  return { name: title(own), englishName: title(english) };
}

function mainGame(channel: ChannelObservation): string | null {
  let best: { gameId: string; minutes: number } | null = null;
  for (const category of channel.categories) {
    if (!best || category.minutes > best.minutes || (category.minutes === best.minutes && compareIds(category.gameId, best.gameId) < 0)) best = category;
  }
  return best?.gameId ?? null;
}

/**
 * Mapped channels: the source's kingdom candidates (≥25 average) that pass the public-visibility gate (not gone,
 * not a gambling channel), in ID order. `excludedGambling` counts the candidates the gambling policy kept off.
 */
export function previewChannels(channels: readonly ChannelObservation[]): { mapped: PreviewChannel[]; excludedGambling: number } {
  let excludedGambling = 0;
  const mapped: PreviewChannel[] = [];
  for (const channel of channels) {
    if (!channel.kingdomCandidate) continue;
    const visibility = publicVisibility(channel);
    if (visibility === 'gambling') excludedGambling++;
    if (visibility !== 'public') continue;
    mapped.push({
      id: channel.kingdomId,
      login: channel.login,
      name: channel.displayName,
      factsAt: channel.factsAt,
      language: channel.language,
      average: channel.averageViewers,
      mainGameId: mainGame(channel),
    });
  }
  return { mapped: mapped.sort((a, b) => compareIds(a.id, b.id)), excludedGambling };
}

function columns(settlers: readonly PlacedChannel[], gameIndex: Map<string, number>): SettlerColumns {
  return {
    ids: settlers.map((s) => s.id) as SettlerColumns['ids'],
    tier: settlers.map((s) => TIER_CODES.indexOf(s.tier)),
    x: settlers.map((s) => q(s.x)),
    y: settlers.map((s) => q(s.y)),
    average: settlers.map((s) => Math.round(s.average)),
    game: settlers.map((s) => (s.mainGameId === null ? -1 : gameIndex.get(s.mainGameId) ?? -1)),
    region: settlers.map((s) => s.region),
  };
}

function encodeRing(points: readonly number[]): number[] {
  const out: number[] = [];
  let px = 0;
  let py = 0;
  for (let p = 0; p < points.length; p += 2) {
    const x = q(points[p]!);
    const y = q(points[p + 1]!);
    out.push(x - px, y - py);
    px = x;
    py = y;
  }
  return out;
}

export interface PreviewInput {
  manifest: SnapshotManifest;
  channels: readonly ChannelObservation[];
  games: readonly Game[];
}

/** Pure and deterministic: the same revision always yields byte-identical files. */
export function buildPreview({ manifest, channels, games }: PreviewInput): PreviewFiles {
  const { mapped, excludedGambling } = previewChannels(channels);
  if (mapped.length === 0) throw new Error('The revision has no mapped channels to draw.');
  const layout: Layout = layoutPreview(mapped);
  const field = buildField(layout);
  const rings = extractRings(field, layout);
  const decor = placeDecor(field, layout);
  const id = previewIdFor(manifest.revision, manifest.asOf);

  const gameNames = new Map(games.map((game) => [game.gameId, game.name]));
  const usedGames = new Set<string>();
  for (const settler of layout.settlers) if (settler.mainGameId) usedGames.add(settler.mainGameId);
  for (const cluster of layout.clusters) if (cluster.gameId) usedGames.add(cluster.gameId);
  const gameList = [...usedGames].sort(compareIds);
  const gameIndex = new Map(gameList.map((gameId, i) => [gameId, i]));

  const files = new Map<string, Uint8Array>();
  const regionChunks = layout.regions.map((region) => {
    const settlers = layout.settlers.filter((s) => s.region === region.index && (s.tier === 'town' || s.tier === 'village'));
    const chunk: PreviewChunk = PreviewChunkSchema.parse({
      version: 1, kind: `${PREVIEW_KIND}-region`, preview: id, region: region.index, settlers: columns(settlers, gameIndex),
    });
    const path = `region-${region.index}.json`;
    const bytes = json(chunk);
    files.set(path, bytes);
    return { path, sha256: sha256(bytes), bytes: bytes.byteLength, records: settlers.length };
  });

  const bounds: Bounds = field.bounds;
  const head = layout.settlers.filter((s) => s.tier === 'capital' || s.tier === 'city');
  const tierCount = (tier: string) => layout.settlers.filter((s) => s.tier === tier).length;
  const world: PreviewWorld = PreviewWorldSchema.parse({
    version: 1,
    kind: PREVIEW_KIND,
    id,
    algorithm: PREVIEW_ALGORITHM,
    label: PREVIEW_LABEL,
    status: 'preview',
    revision: manifest.revision,
    asOf: manifest.asOf,
    window: {
      firstObservationAt: manifest.window.firstObservationAt, lastObservationAt: manifest.window.lastObservationAt,
      hours: manifest.window.hours, sweeps: manifest.window.sweeps, gapCount: manifest.window.gapCount,
    },
    coverage: {
      sweepFloorViewers: manifest.coverage.sweep.floorViewers,
      candidateMinAverage: KINGDOM_CANDIDATE_MIN_AVERAGE,
      contentLabels: manifest.coverage.contentLabels,
      missing: manifest.coverage.missing,
    },
    founding: {
      status: manifest.founding.status,
      edition0EligibleAt: manifest.founding.edition0EligibleAt,
      editionIEligibleAt: manifest.founding.editionIEligibleAt,
    },
    policy: { gambling: GAMBLING_POLICY.version, excludedGambling },
    counts: {
      channelsObserved: manifest.counts.channels,
      mapped: layout.settlers.length,
      languages: layout.regions.length,
      capital: tierCount('capital'), city: tierCount('city'), town: tierCount('town'), village: tierCount('village'),
    },
    coordScale: COORD_SCALE,
    bounds: { minX: q(bounds.minX), minY: q(bounds.minY), maxX: q(bounds.maxX), maxY: q(bounds.maxY) },
    tiers: { minAverage: TIER_MIN_AVERAGE, holdingRadius: HOLDING_RADIUS },
    regions: layout.regions.map((region) => ({
      index: region.index,
      language: region.language,
      ...languageNames(region.language),
      kind: region.kind,
      x: q(region.x), y: q(region.y), r: q(region.r),
      members: region.members,
      chunk: regionChunks[region.index]!,
    })),
    isles: layout.isles ? { name: ISLES_NAME, x: q(layout.isles.x), y: q(layout.isles.y), r: q(layout.isles.r) } : null,
    games: gameList.map((gameId) => ({ gameId, name: gameNames.get(gameId) ?? null })),
    clusters: layout.clusters.map((cluster) => ({
      region: cluster.region,
      game: cluster.gameId === null ? -1 : gameIndex.get(cluster.gameId)!,
      x: q(cluster.x), y: q(cluster.y), r: q(cluster.r), members: cluster.members,
    })),
    coasts: rings.map((ring) => ({ region: ring.region, points: encodeRing(ring.points) })),
    decor: decor.flatMap((item) => [(DECOR_KINDS.indexOf(item.kind) << 12) | (item.bands << 7) | item.variant, q(item.x), q(item.y)]),
    head: columns(head, gameIndex),
  });
  const worldBytes = json(world);
  files.set('world.json', worldBytes);
  const byId = [...layout.settlers].sort((a, b) => compareIds(a.id, b.id));
  const names: PreviewNames = PreviewNamesSchema.parse({
    version: 1,
    kind: `${PREVIEW_KIND}-names`,
    preview: id,
    revision: manifest.revision,
    ids: byId.map((s) => s.id),
    logins: byId.map((s) => s.login),
    names: byId.map((s) => s.name),
    factsAt: byId.map((s) => s.factsAt),
  });
  const namesBytes = json(names);
  files.set('names.json', namesBytes);
  const previewManifest = PreviewManifestSchema.parse({
    version: 1,
    kind: `${PREVIEW_KIND}-manifest`,
    id,
    revision: manifest.revision,
    asOf: manifest.asOf,
    world: { path: 'world.json', sha256: sha256(worldBytes), bytes: worldBytes.byteLength, records: head.length },
    names: { path: 'names.json', sha256: sha256(namesBytes), bytes: namesBytes.byteLength, records: byId.length },
  });
  return { id, manifest: previewManifest, world, names, files };
}
