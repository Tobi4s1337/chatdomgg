import { freezeGrandLandRecipe, type GrandLandRecipe } from '../../../../../packages/world/src/grand/recipe';

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

/** Unlisted kingdoms keep their installed terrain. Never infer a recipe from their homes. */
export function grandRecipeFor(kingdomId: string | undefined): GrandLandRecipe | undefined {
  return kingdomId === willowmere.seed.kingdomId ? willowmere : undefined;
}
