import type { GenesisBiome, GenesisTier, GenesisLandscape } from '../genesis/contracts';
import type { GrandPaletteStyle } from './palette';

/** The grand land uses the terrain lattice: one voxel is half a metre. */
export const GRAND_VOXEL_METRES = 0.5;
/** Mesh chunks are 32³ voxels at every level; a coarser level's chunk covers 32·2^level source voxels. */
export const GRAND_CHUNK = 32;
/** A streaming region is 256×256 columns (128 m) at every level. */
export const GRAND_REGION = 256;
export const GRAND_LEVELS = 4;

export type GrandCharacter = GenesisLandscape['character'];

/** Everything the land is seeded from. Built from the Genesis recipe; never from presence or time. */
export interface GrandLandSeed {
  /** The recipe's seed key (broadcaster identity); the only source of randomness. */
  readonly seedKey: string;
  readonly kingdomId: string;
  readonly name: string;
  readonly biome: GenesisBiome;
  readonly tier: GenesisTier;
  readonly character: GrandCharacter;
}

export type TreeSpecies =
  | 'oak' | 'lime' | 'birch' | 'autumn-gold' | 'autumn-red' | 'pine' | 'spruce' | 'cherry' | 'teal' | 'willow'
  | 'shrub' | 'hero-gold' | 'hero-teal' | 'hero-cherry';
export const TREE_SPECIES: readonly TreeSpecies[] = ['oak', 'lime', 'birch', 'autumn-gold', 'autumn-red', 'pine', 'spruce', 'cherry', 'teal', 'willow', 'shrub', 'hero-gold', 'hero-teal', 'hero-cherry'];

/**
 * One tree as sparse voxels relative to its base (the ground cell under the trunk centre is dy = 0).
 * dy may go a few voxels negative so roots sit into a slope. Materials are grand palette ids.
 */
export interface TreeShape {
  readonly count: number;
  readonly dx: Int16Array;
  readonly dy: Int16Array;
  readonly dz: Int16Array;
  readonly material: Uint8Array;
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** Stride of the placed-tree table: x, z, groundY, species index, seed (u32 as float), scale. */
export const TREE_STRIDE = 6;

/** Cover classes per column; the voxeliser turns these and height into materials. */
export const Cover = {
  sea: 0, sand: 1, shingle: 2, grass: 3, meadow: 4, forest: 5, field: 6, rock: 7, scree: 8, snow: 9,
  riverbed: 10, lakebed: 11, cliff: 12, reserved: 13, hedge: 14, lava: 15,
} as const;
export type CoverId = typeof Cover[keyof typeof Cover];

/** A patchwork field: an axis-aligned plot with one crop and its rows. */
export interface FieldPlot {
  readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number;
  readonly crop: number;
  /** Rows run along x (0) or z (1). */
  readonly rows: 0 | 1;
}

/** Places the land is composed around. The kingdom (GK11) builds on these; the land already shapes them. */
export interface GrandSites {
  /** The castle rock: a raised plateau with cliff sides. */
  readonly castle: { readonly x: number; readonly z: number; readonly radius: number; readonly top: number };
  /** The town flat below the castle: gentle land, cleared of forest, inside this ellipse. */
  readonly town: { readonly x: number; readonly z: number; readonly rx: number; readonly rz: number; readonly angle: number; readonly level: number };
  /** The harbour: a sheltered bay; the quay line faces `facing` (radians, toward open sea). */
  readonly harbour: { readonly x: number; readonly z: number; readonly facing: number };
  /** The lighthouse headland: the most convex point of coast near the harbour. */
  readonly headland: { readonly x: number; readonly z: number; readonly y: number };
  /** The mere: the lake's centre and level. */
  readonly mere: { readonly x: number; readonly z: number; readonly level: number } | null;
  /** The patchwork fields' zone (for windmills). */
  readonly fields: { readonly x: number; readonly z: number; readonly radius: number };
  /** The highest peak. */
  readonly summit: { readonly x: number; readonly z: number; readonly y: number };
  /** Hero viewpoints for the orbit director: eye-free focus points, in voxels. */
  readonly focus: readonly { readonly id: string; readonly x: number; readonly y: number; readonly z: number }[];
}

export interface GrandLandStats {
  readonly size: number;
  readonly solidVoxels: number;
  readonly trees: number;
  readonly treesBySpecies: Readonly<Record<string, number>>;
  readonly riverCells: number;
  readonly lakeCells: number;
  readonly waterfalls: number;
  readonly fieldPlots: number;
  readonly seaStacks: number;
  readonly landCells: number;
  readonly millis: number;
}

/** The generated land: plain typed arrays, transferable to workers. */
export interface GrandLand {
  readonly seed: GrandLandSeed;
  readonly style: GrandPaletteStyle;
  /** Columns per side. */
  readonly size: number;
  /** World height in voxels. */
  readonly height: number;
  readonly seaLevel: number;
  readonly snowline: number;
  readonly treeline: number;
  /** Top solid y + 1 per column (so 0 is no ground). */
  readonly ground: Uint16Array;
  /** Water surface y + 1 per column, 0 where dry. Sea columns carry seaLevel. */
  readonly water: Uint16Array;
  readonly cover: Uint8Array;
  /** Field plot index + 1 per column, 0 outside fields. */
  readonly plot: Uint16Array;
  readonly plots: readonly FieldPlot[];
  /** Distance to the coast in columns, signed: positive inland, negative at sea, clamped to ±127. */
  readonly coast: Int8Array;
  readonly trees: Float32Array;
  readonly treeCount: number;
  readonly sites: GrandSites;
  /** Placed kit boxes, STRUCTURE_STRIDE ints each: x0, y0, z0, x1, y1, z1 (exclusive, land voxels), material. */
  readonly structures: Int32Array;
  readonly structureCount: number;
  /** Colours of the structure materials, M.structureBase + index. */
  readonly structureColours: readonly string[];
  readonly stats: GrandLandStats;
}

export const STRUCTURE_STRIDE = 7;
/** Structure materials share one byte with the land: 128 slots from M.structureBase. */
export const STRUCTURE_COLOURS = 128;

// ── Dressing kits ──────────────────────────────────────────────────────────────────────────────────────
// The plug-in point for the kits the land is dressed with (lane grand-artisans). A kit module at
// `packages/world/src/grand/artisans/index.ts` that exports `GRAND_ARTISAN_KITS: Partial<GrandDressingKits>`
// is picked up by `./kits.ts`; anything it leaves out keeps the built-in default. Kits run inside the pure,
// deterministic generator (in a worker), so they take everything from the land they are given and its seed
// key; no clocks, no Math.random. Units are land voxels (0.5 m), +Y up; boxes are render data only and
// grant no physical support, ownership or citizen light.

export type GrandKitPoint = readonly [number, number, number];
/** One solid box of a piece, in the piece's own frame; `colour` is a #rrggbb clay colour. */
export interface GrandKitBox { readonly min: GrandKitPoint; readonly size: GrandKitPoint; readonly colour: string }
/** A built piece (a windmill, a quay, a castle wing): boxes plus named anchors in the piece's frame. */
export interface GrandKitPiece { readonly id: string; readonly boxes: readonly GrandKitBox[]; readonly anchors: Readonly<Record<string, GrandKitPoint>> }
/** A piece placed on the land: its origin in land voxels and quarter turns about +Y (same rule as KitBuilder.add). */
export interface GrandKitPlacement { readonly piece: GrandKitPiece; readonly at: GrandKitPoint; readonly turns: number }
/** A tree kit: the species' extent (used for spacing, buckets and bounds) and its voxel shape for a seed. */
export interface GrandTreeKit {
  extent(species: TreeSpecies, scale: number): { radius: number; height: number };
  shape(species: TreeSpecies, seed: number, scale: number): TreeShape;
}
/** What a composer reads: the finished land before any structure is placed. */
export type GrandComposeInput = Omit<GrandLand, 'structures' | 'structureCount' | 'structureColours'>;
export type GrandComposer = (land: GrandComposeInput) => readonly GrandKitPlacement[];
export interface GrandDressingKits {
  readonly trees: GrandTreeKit;
  /** Composers run in order on the finished land; each returns placed pieces (harbour, windmills, landmarks …). */
  readonly compose: readonly GrandComposer[];
}
