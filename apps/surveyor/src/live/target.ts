import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createAtlasAlignment, type AtlasAlignment, type AtlasEdition, type AtlasSettler, type KingdomId,
} from '@chatdom/shared';
import { currentTaxonomy, placementOf } from '../cartography/taxonomy';
import { sha256 } from '../export/project';
import { PREVIEW_LABEL, PreviewChunkSchema, PreviewIdSchema, PreviewWorldSchema, TIER_CODES, type PreviewWorld, type SettlerColumns } from '../preview/schema';
import { previewDir, previewsRoot, readPreviewManifest } from '../preview/store';

/**
 * The land a live frame is aligned to. Until an edition is founded that is a survey preview: its holdings, in the
 * settler order every reader can derive from the preview alone (the capitals and cities of `world.head`, then each
 * region's chunk in region order, each in file order). The world file pins every chunk by hash, so the world hash
 * binds that order too. The alignment is computed with the shared `createAtlasAlignment`, never restated.
 */
export interface LiveTarget {
  previewId: string;
  world: PreviewWorld;
  worldSha256: string;
  edition: AtlasEdition;
  alignment: AtlasAlignment;
  /** Complete immutable holding geometry, including ground whose name is withheld. */
  holdingGeometry?: readonly { region: number; x: number; y: number; r: number }[];
  /** Channel ID per ordinal. */
  ids: readonly string[];
  /** Holding tier rank per ordinal: 0 capital … 3 village. */
  tierRank: Uint8Array;
  /** Realm index per ordinal. */
  realmOf: Uint16Array;
  ordinalOf: ReadonlyMap<string, number>;
  /** The realm a channel without land belongs to: its language's land, then its family of games (Spec 01 R4/R5). */
  realmFor(channel: { id: string; language: string; categories: readonly { gameId: string; minutes: number }[] }): number;
}

function concatColumns(world: PreviewWorld, chunks: readonly SettlerColumns[]): { ids: string[]; tier: number[]; x: number[]; y: number[]; realm: number[] } {
  const out = { ids: [] as string[], tier: [] as number[], x: [] as number[], y: [] as number[], realm: [] as number[] };
  for (const columns of [world.head, ...chunks]) {
    out.ids.push(...columns.ids);
    out.tier.push(...columns.tier);
    out.x.push(...columns.x);
    out.y.push(...columns.y);
    out.realm.push(...columns.realm);
  }
  return out;
}

/** FNV-1a over a decimal ID: a stable pick among equal choices (the Outer Isles), never a person hash. */
function stablePick(id: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) % n;
}

export function realmResolver(world: PreviewWorld): LiveTarget['realmFor'] {
  const taxonomy = currentTaxonomy();
  // The families of a world are indices into the taxonomy it was drawn with; another taxonomy's indices mean nothing.
  const familyOf = taxonomy.ref.sha256 === world.taxonomy.sha256 ? taxonomy.familyOf : new Map<string, number>();
  const regionOf = new Map<string, number>();
  for (const region of world.regions) if (region.language !== null) regionOf.set(region.language, region.index);
  const realmsOf = new Map<number, PreviewWorld['realms']>();
  for (const realm of world.realms) {
    const list = realmsOf.get(realm.region);
    if (list) list.push(realm);
    else realmsOf.set(realm.region, [realm]);
  }
  const outer = world.realms.filter((realm) => realm.kind === 'outer');
  return (channel) => {
    const region = regionOf.get(channel.language);
    // A language with no land yet waits on the Outer Isles, the overflow kept empty for exactly this.
    if (region === undefined) return outer.length ? outer[stablePick(channel.id, outer.length)]!.index : 0;
    const realms = realmsOf.get(region) ?? [];
    if (realms.length === 1) return realms[0]!.index;
    const placement = placementOf(channel.categories, familyOf);
    const find = (kind: string, family = -1) => realms.find((realm) => realm.kind === kind && realm.family === family);
    const wilds = find('wilds') ?? find('crossroads') ?? realms[0]!;
    if (placement.kind === 'variety') return (find('crossroads') ?? wilds).index;
    if (placement.kind === 'family') return (find('family', placement.family) ?? wilds).index;
    return wilds.index;
  };
}

/** Reads and verifies one preview (world and every chunk against their pinned hashes) as a live target. */
export async function loadLiveTarget(dataDir: string, previewId: string): Promise<LiveTarget> {
  const id = PreviewIdSchema.parse(previewId);
  const dir = previewDir(dataDir, id);
  const manifest = readPreviewManifest(dataDir, id);
  const worldBytes = readFileSync(join(dir, manifest.world.path));
  const worldSha256 = sha256(worldBytes);
  if (worldSha256 !== manifest.world.sha256) throw new Error(`${id}: world.json does not match its manifest hash.`);
  const world = PreviewWorldSchema.parse(JSON.parse(worldBytes.toString('utf8')));
  if (world.id !== id) throw new Error(`${id}: world.json belongs to another preview.`);
  const chunks = world.regions.map((region) => {
    const bytes = readFileSync(join(dir, region.chunk.path));
    if (sha256(bytes) !== region.chunk.sha256) throw new Error(`${id}: ${region.chunk.path} does not match its pinned hash.`);
    const chunk = PreviewChunkSchema.parse(JSON.parse(bytes.toString('utf8')));
    if (chunk.preview !== id || chunk.region !== region.index) throw new Error(`${id}: ${region.chunk.path} belongs elsewhere.`);
    return chunk.settlers;
  });
  const all = concatColumns(world, chunks);
  const edition: AtlasEdition = {
    version: 1, id, label: PREVIEW_LABEL, status: 'preview', foundedAt: world.asOf, worldHash: worldSha256, realmCount: world.realms.length,
  };
  const settlers: AtlasSettler[] = all.ids.map((kingdomId, ordinal) => ({
    ordinal,
    kingdomId: kingdomId as KingdomId,
    // A preview has no holding ledger: its holding is the drawn place of this preview, named by preview and ordinal.
    holdingId: `${id}:${ordinal}`,
    realmIndex: all.realm[ordinal]!,
    holdingTier: TIER_CODES[all.tier[ordinal]!]!,
    point: { x: all.x[ordinal]! / world.coordScale, y: all.y[ordinal]! / world.coordScale },
    settledAt: world.asOf,
  }));
  const alignment = await createAtlasAlignment(edition, settlers);
  return {
    previewId: id, world, worldSha256, edition, alignment, ids: all.ids,
    holdingGeometry: all.ids.map((_, i) => ({ region: world.realms[all.realm[i]!]!.region, x: all.x[i]! / world.coordScale, y: all.y[i]! / world.coordScale, r: [world.tiers.holdingRadius.capital, world.tiers.holdingRadius.city, world.tiers.holdingRadius.town, world.tiers.holdingRadius.village][all.tier[i]!]! })),
    tierRank: Uint8Array.from(all.tier),
    realmOf: Uint16Array.from(all.realm),
    ordinalOf: new Map(all.ids.map((kingdomId, ordinal) => [kingdomId, ordinal])),
    realmFor: realmResolver(world),
  };
}

/** Every preview this service still keeps (newest last): each one may still be pinned by an open map. */
export function listPreviews(dataDir: string): string[] {
  const root = previewsRoot(dataDir);
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((name) => PreviewIdSchema.safeParse(name).success && existsSync(join(root, name, 'manifest.json'))).sort();
}
