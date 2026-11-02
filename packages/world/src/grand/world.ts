import type { GenesisBiome, GenesisLandmark, GenesisTier } from '../genesis/contracts';
import { hashString, mix32 } from './noise';
import type { GrandCharacter, GrandLandSeed } from './types';

/**
 * What makes one channel's world its own (generator `grand-land-2`). Genesis compiles a channel's real facts (its
 * categories, profile colours and identity) into a biome, a landscape character, a landmark and colour targets; this
 * module turns those into the land's large form, its forest and its crest. Every choice is a pure function of the
 * Genesis recipe and the channel's full seed key, so the same channel always gets the same world and two channels
 * with the same categories still get different ones.
 *
 * A seed without `world` is a `grand-land-1` seed and raises exactly the land it always raised (Willowmere's pinned
 * recipe has none). Never add a trait to a published recipe: a changed recipe is a new land.
 */
export const GRAND_LANDFORMS = ['island', 'mountain-valley', 'river-delta', 'lake-country', 'cliff-coast', 'highland'] as const;
export type GrandLandform = typeof GRAND_LANDFORMS[number];

/** The grove species a world can be known by; hero trees and shrubs follow the forest. */
export const GRAND_GROVE_SPECIES = ['oak', 'lime', 'birch', 'autumn-gold', 'autumn-red', 'pine', 'spruce', 'cherry', 'teal', 'willow'] as const;
export type GrandGroveSpecies = typeof GRAND_GROVE_SPECIES[number];

export interface GrandWorldTraits {
  readonly landform: GrandLandform;
  /** The signature forest: the species most of the groves carry, then the one that mixes into them. */
  readonly forest: readonly [GrandGroveSpecies, GrandGroveSpecies];
  /** The kingdom's colours on banners, sails and roofs: the field and the charge, already in the clay palette. */
  readonly crest: { readonly field: string; readonly charge: string };
  readonly landmark: GenesisLandmark;
}

/**
 * Which large forms suit a channel's biome and landscape character. Two per pair, so that channels which share both
 * still divide between two worlds, and every landform is reachable from several kinds of channel.
 */
const LANDFORMS: Record<GenesisBiome, Record<GrandCharacter, readonly [GrandLandform, GrandLandform]>> = {
  coastal: { 'coastal-harbour': ['island', 'cliff-coast'], 'river-valley': ['river-delta', 'island'], 'mountain-pass': ['cliff-coast', 'mountain-valley'] },
  woodland: { 'coastal-harbour': ['island', 'lake-country'], 'river-valley': ['lake-country', 'mountain-valley'], 'mountain-pass': ['mountain-valley', 'highland'] },
  meadow: { 'coastal-harbour': ['river-delta', 'island'], 'river-valley': ['river-delta', 'lake-country'], 'mountain-pass': ['lake-country', 'mountain-valley'] },
  highland: { 'coastal-harbour': ['cliff-coast', 'highland'], 'river-valley': ['mountain-valley', 'highland'], 'mountain-pass': ['highland', 'mountain-valley'] },
};

/** Signature forests per biome: a dominant species and its companion, distinct in silhouette, not just in hue. */
const FORESTS: Record<GenesisBiome, readonly (readonly [GrandGroveSpecies, GrandGroveSpecies])[]> = {
  woodland: [['autumn-gold', 'teal'], ['autumn-red', 'oak'], ['oak', 'autumn-gold'], ['autumn-gold', 'birch'], ['teal', 'autumn-red']],
  highland: [['pine', 'birch'], ['spruce', 'autumn-gold'], ['pine', 'autumn-red'], ['spruce', 'birch']],
  meadow: [['cherry', 'lime'], ['lime', 'cherry'], ['birch', 'cherry'], ['willow', 'lime'], ['oak', 'cherry']],
  coastal: [['pine', 'willow'], ['willow', 'autumn-gold'], ['pine', 'cherry'], ['teal', 'pine'], ['oak', 'willow']],
};

/**
 * Banner clay: saturated enough to read as a kingdom's colour across a valley, soft enough to sit beside Chatdom's
 * fired-clay homes. A channel's own colours snap to the nearest of these; neon never reaches the land.
 */
export const GRAND_CREST_CLAY = [
  '#b8463f', '#c8663a', '#d29a3a', '#a8a24a', '#5d8a4a', '#3f7f6e', '#3f7391', '#4a5f9a', '#6e5296', '#9a4f7f', '#b7758c', '#7a4a3a',
] as const;
/** Charges sit on a field: bone, gilt, iron or the deep ink of a night banner. */
const CHARGE_CLAY = ['#efe4cc', '#e2b64e', '#3a3b46', '#f3d9a4'] as const;

const pick = <T>(items: readonly T[], key: string): T => items[mix32(hashString(key)) % items.length]!;

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Perceptual-ish distance (redmean), enough to snap a target to a curated palette. */
function distance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b), rm = (r1 + r2) / 2;
  return (2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2;
}
const nearest = <T extends string>(palette: readonly T[], target: string): T =>
  palette.reduce((best, colour) => distance(colour, target) < distance(best, target) ? colour : best, palette[0]!);
const luminance = (hex: string) => { const [r, g, b] = rgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

/** The input a world is chosen from: the parts of a compiled Genesis recipe that describe the channel. */
export type GrandWorldSource = {
  readonly seedKey: string;
  readonly identity: Pick<GrandGenesisSource['identity'], 'biome' | 'landmark' | 'profileColourTargets'>;
  readonly character: GrandCharacter;
};

export function grandWorldTraits(source: GrandWorldSource): GrandWorldTraits {
  const { seedKey, identity, character } = source;
  if (!seedKey) throw new Error('A world needs its channel identity');
  const landform = pick(LANDFORMS[identity.biome][character], `${seedKey}:grand-world/landform`);
  const forest = pick(FORESTS[identity.biome], `${seedKey}:grand-world/forest`);
  const targets = identity.profileColourTargets.filter(colour => /^#[0-9a-fA-F]{6}$/.test(colour));
  const field = targets[0] ? nearest(GRAND_CREST_CLAY, targets[0].toLowerCase()) : pick(GRAND_CREST_CLAY, `${seedKey}:grand-world/crest`);
  // The charge contrasts with the field: a second channel colour when it reads against it, else bone or ink.
  const second = targets[1] ? nearest(GRAND_CREST_CLAY, targets[1].toLowerCase()) : null;
  const charge = second && second !== field && Math.abs(luminance(second) - luminance(field)) > 40 ? second
    : luminance(field) > 120 ? CHARGE_CLAY[2] : pick([CHARGE_CLAY[0], CHARGE_CLAY[1], CHARGE_CLAY[3]], `${seedKey}:grand-world/charge`);
  return { landform, forest: [forest[0], forest[1]], crest: { field, charge }, landmark: identity.landmark };
}

/**
 * A channel's land seed from its compiled Genesis recipe: its full identity, biome, tier, the chosen landscape's
 * character and its world traits. `character` is the landscape the founding ceremony chose (else the recommended one).
 */
export interface GrandGenesisSource {
  /** The compiled recipe's branded kingdom id (or its deep-readonly form). */
  readonly kingdomId: unknown;
  readonly seedKey: string;
  readonly identity: { readonly biome: GenesisBiome; readonly landmark: GenesisLandmark; readonly profileColourTargets: readonly string[] };
  readonly size: { readonly tier: GenesisTier };
  readonly landscapes: readonly { readonly id: string; readonly character: GrandCharacter }[];
  readonly recommendedLandscapeId: string;
}

export function grandSeedFromGenesis(genesis: GrandGenesisSource,
  name: string, options: { readonly character?: GrandCharacter; readonly tier?: GenesisTier } = {}): GrandLandSeed {
  const kingdomId = String(genesis.kingdomId);
  if (!genesis.seedKey.includes(kingdomId)) throw new Error('A world needs its full channel identity');
  const landscape = genesis.landscapes.find(row => row.id === genesis.recommendedLandscapeId) ?? genesis.landscapes[0];
  if (!landscape) throw new Error('A world needs a Genesis landscape');
  const character = options.character ?? landscape.character;
  return {
    seedKey: genesis.seedKey, kingdomId, name, biome: genesis.identity.biome, tier: options.tier ?? genesis.size.tier, character,
    world: grandWorldTraits({ seedKey: genesis.seedKey, identity: genesis.identity, character }),
  };
}

/** Grove weights for a world: its signature pair carries the woods, the rest only seasons them. */
export function worldGroves(traits: GrandWorldTraits, base: Readonly<Record<string, number>>): Record<string, number> {
  const groves: Record<string, number> = {};
  for (const [species, weight] of Object.entries(base)) groves[species] = weight * 0.22;
  groves[traits.forest[0]] = 2.4;
  groves[traits.forest[1]] = Math.max(groves[traits.forest[1]] ?? 0, 1.15);
  return groves;
}
