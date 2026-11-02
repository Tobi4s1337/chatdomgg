import { freezeGrandLandRecipe, type GrandLandRecipe } from './recipe';

// Adoption snapshot from Willowmere's public founded scene, 2026-11-01.
// Only geography and the explicitly selected woodland profile; no citizen data.
const willowmere = freezeGrandLandRecipe({
  "frame": {
    "castle": {
      "bounds": {
        "maxX": 32,
        "maxZ": -36,
        "minX": -32,
        "minZ": -84
      },
      "centre": [
        0,
        20,
        -60
      ]
    },
    "centre": [
      -3.5145833333333334,
      64.11666666666667
    ],
    "envelope": {
      "maxX": 272,
      "maxZ": 304,
      "minX": -192,
      "minZ": -112
    },
    "seaward": [
      0.7844815526596004,
      0.6201521535371645
    ],
    "waterLevel": -0.5
  },
  "generator": "grand-land-1",
  "grader": "gk11-grade-3",
  "kit": "grand-artisans-1",
  "mesher": "hosted-grand-land-2",
  "seed": {
    "biome": "woodland",
    "character": "river-valley",
    "kingdomId": "129634568",
    "minSize": 2560,
    "name": "Willowmere",
    "seedKey": "[\"installed-kingdom\",\"129634568\",\"willowmere\"]",
    "tier": "town"
  },
  "version": 1
} as const satisfies GrandLandRecipe);

/**
 * The adopted grand recipes, keyed by the full kingdom id. The realm bakes and publishes from this registry and
 * the browser accepts only these hashes. Unlisted kingdoms keep their installed terrain. Never infer a recipe
 * from somebody's homes, and never edit an entry once its land is published: a changed recipe is a new hash,
 * which the land store refuses for a founded kingdom until it is deliberately migrated.
 */
export function adoptedGrandRecipe(kingdomId: string | undefined): GrandLandRecipe | undefined {
  return kingdomId === willowmere.seed.kingdomId ? willowmere : undefined;
}
export const ADOPTED_GRAND_KINGDOMS: readonly string[] = Object.freeze([willowmere.seed.kingdomId]);
