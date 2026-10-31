import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { selectTree, type CanopyMotion, type PictureTree, type StyleFamily, type TreeSpecies } from '@chatdom/content/trees';
import type { GroundPiece } from '../ground-dressing/plan';

const CELL = 0.125;
/** The root flare is set one course into the turf, so a tree on a gentle slope never shows daylight under it. */
export const TREE_SINK = CELL;

/**
 * Where a site stands, as the caller classified it: in the ring around a home court, in the open woods, or at the
 * water's edge. The caller decides suitability; this module never creates, moves or rejects a site.
 */
export type TreeZone = 'court' | 'grove' | 'water';
export const TREE_ZONES = ['court', 'grove', 'water'] as const satisfies readonly TreeZone[];

export interface TreeSite {
  /** Stable across rebuilds: the same id always grows the same tree in the same place. */
  id: string;
  zone: TreeZone;
  /** The trunk's root point in world metres, y on the ground the caller sampled. */
  position: Vec3;
  /** Radians, the `GroundPiece` convention: local (x, z) → (x cos + z sin, −x sin + z cos). */
  yaw: number;
  style: StyleFamily;
  /** The kingdom's seed, so two kingdoms with the same site ids still grow their own woods. */
  seed: string;
  /** Clear crown radius at the site, metres, if the caller knows it. A tree wider than this is never chosen. */
  room?: number;
}

export interface GroveTree {
  /** `tree:<site id>`. */
  id: string;
  site: string;
  zone: TreeZone;
  species: TreeSpecies;
  variant: number;
  blueprint: VoxelBlueprint;
  /** The blueprint origin, exactly as a `GroundPiece` places it. */
  position: Vec3;
  yaw: number;
  /** The trunk's root point in world metres (the site position, sunk by `TREE_SINK`). */
  root: Vec3;
  canopy: CanopyMotion;
  /** Crown radius and height in metres, for the caller's own clearance and camera checks. */
  reach: number;
  height: number;
}

/** A stable unit value per site and purpose. */
function unit(...parts: readonly (string | number)[]): number {
  let h = 2166136261;
  const text = parts.join(':');
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 2246822507); h ^= h >>> 13; h = Math.imul(h, 3266489909); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Who grows where. Court rings frame homes with light, upright trees; the woods are oak and pine with birch among
 * them and, very rarely, an elder; willows keep to the water. Tide kingdoms run to pine, Grove kingdoms to oak.
 */
const MIX: Readonly<Record<TreeZone, Readonly<Record<StyleFamily, readonly (readonly [TreeSpecies, number])[]>>>> = {
  court: {
    hearth: [['oak', 0.45], ['birch', 0.4], ['pine', 0.15]],
    tide: [['birch', 0.4], ['pine', 0.35], ['oak', 0.25]],
    grove: [['oak', 0.5], ['birch', 0.35], ['pine', 0.15]],
  },
  grove: {
    hearth: [['oak', 0.45], ['pine', 0.35], ['birch', 0.2]],
    tide: [['pine', 0.55], ['oak', 0.25], ['birch', 0.2]],
    grove: [['oak', 0.5], ['pine', 0.3], ['birch', 0.2]],
  },
  water: {
    hearth: [['willow', 0.6], ['birch', 0.25], ['oak', 0.15]],
    tide: [['willow', 0.5], ['birch', 0.3], ['pine', 0.2]],
    grove: [['willow', 0.6], ['birch', 0.2], ['oak', 0.2]],
  },
};
/** Share of woodland sites that grow an elder: a handful in a kingdom, each one remembered. */
export const ELDER_SHARE = 0.03;
/** When a site has too little room, a tree steps down to a narrower species. */
const NARROWER: Readonly<Record<TreeSpecies, TreeSpecies | null>> = { elder: 'oak', willow: 'birch', oak: 'birch', pine: 'birch', birch: null };

/** The species a site grows, before any room check. */
export function siteSpecies(site: Pick<TreeSite, 'id' | 'zone' | 'style' | 'seed'>): TreeSpecies {
  if (site.zone === 'grove' && unit(site.seed, site.id, 'elder') < ELDER_SHARE) return 'elder';
  const roll = unit(site.seed, site.id, 'species'), mix = MIX[site.zone][site.style];
  let sum = 0;
  for (const [species, share] of mix) { sum += share; if (roll < sum) return species; }
  return mix[mix.length - 1]![0];
}

function crownReach(tree: PictureTree): number { return tree.canopy.reach; }

/** One site → one tree, its blueprint placed so the trunk stands exactly on the site. */
export function plantTree(site: TreeSite): GroveTree {
  if (!(TREE_ZONES as readonly string[]).includes(site.zone)) throw new Error(`Tree site ${site.id} has unknown zone "${String(site.zone)}".`);
  if (!site.position.every(Number.isFinite) || !Number.isFinite(site.yaw)) throw new Error(`Tree site ${site.id} needs a finite position and yaw.`);
  let species: TreeSpecies | null = siteSpecies(site), tree = selectTree(site.style, species, `${site.seed}:${site.id}`);
  while (site.room !== undefined && crownReach(tree) > site.room && (species = NARROWER[tree.species]) !== null) {
    tree = selectTree(site.style, species, `${site.seed}:${site.id}`);
  }
  const [rx, , rz] = tree.root, ox = rx * CELL, oz = rz * CELL, c = Math.cos(site.yaw), s = Math.sin(site.yaw);
  const root: Vec3 = [site.position[0], site.position[1] - TREE_SINK, site.position[2]];
  return {
    id: `tree:${site.id}`, site: site.id, zone: site.zone, species: tree.species, variant: tree.variant, blueprint: tree.blueprint,
    position: [root[0] - (ox * c + oz * s), root[1], root[2] - (-ox * s + oz * c)], yaw: site.yaw, root,
    canopy: tree.canopy, reach: tree.canopy.reach, height: tree.canopy.top,
  };
}

/** Every site, in input order. Site ids must be unique; nothing is added, dropped or moved. */
export function plantGrove(sites: readonly TreeSite[]): GroveTree[] {
  const seen = new Set<string>();
  return sites.map(site => {
    if (seen.has(site.id)) throw new Error(`Tree site ${site.id} appears twice.`);
    seen.add(site.id);
    return plantTree(site);
  });
}

/** The same placement as a ground piece: origin, yaw and blueprint unchanged. */
export function toGroundPiece(tree: GroveTree): GroundPiece {
  return { id: tree.id, blueprint: tree.blueprint, position: [...tree.position], yaw: tree.yaw };
}

/**
 * Placements grouped by blueprint, ready for one instanced mesh per tree form and detail level, in a stable order
 * (first appearance). Each group carries the form's canopy motion for its mesh attributes.
 */
export function groveBatches(trees: readonly GroveTree[]): { blueprint: VoxelBlueprint; canopy: CanopyMotion; placements: { id: string; position: Vec3; yaw: number }[] }[] {
  const batches = new Map<VoxelBlueprint, { blueprint: VoxelBlueprint; canopy: CanopyMotion; placements: { id: string; position: Vec3; yaw: number }[] }>();
  for (const tree of trees) {
    let batch = batches.get(tree.blueprint);
    if (!batch) { batch = { blueprint: tree.blueprint, canopy: tree.canopy, placements: [] }; batches.set(tree.blueprint, batch); }
    batch.placements.push({ id: tree.id, position: tree.position, yaw: tree.yaw });
  }
  return [...batches.values()];
}
