import type { AudioMaterial } from '../../types';
import type { MaterialAction } from '../materials/handling';
import { COBBLE_STEP } from './cobble';
import { GRASS_STEP, MEADOW_STEP } from './grass';
import { GRAVEL_STEP } from './gravel';
import { PLANK_STEP } from './plank';
import { ROCK_STEP } from './rock';
import { SAND_STEP } from './sand';
import { SHALLOWS_STEP } from './shallows';
import { SNOW_STEP } from './snow';

/**
 * Ground a foot meets outdoors beyond the six building materials, named as the land paints it: lawn grass, taller
 * meadow grass, loose gravel, cobbled setts, timber boards out of doors (bridges, docks, jetties), sand, snow,
 * ankle-deep water at a shore or ford, and bare rock. Only `step` takes them; a building cue given one throws.
 */
export type StepGround = 'grass' | 'meadow' | 'gravel' | 'cobble' | 'plank' | 'sand' | 'snow' | 'shallows' | 'rock';
/** Everything a `step` can land on: the land's grounds plus the six materials as floors (earth paths, flagstones…). */
export type StepSurface = AudioMaterial | StepGround;
export const STEP_GROUNDS: readonly StepGround[] = ['grass', 'meadow', 'gravel', 'cobble', 'plank', 'sand', 'snow', 'shallows', 'rock'];
/** Every surface `step` plays: the land's grounds in the order the land names them, then the indoor floors. */
export const STEP_SURFACES: readonly StepSurface[] = [
  'grass', 'meadow', 'earth', 'gravel', 'cobble', 'stone', 'plank', 'sand', 'snow', 'shallows', 'rock',
  'wood', 'fabric', 'glass', 'metal',
];

/** A step on every outdoor ground. Earth paths and flagstones are the `earth` and `stone` material steps. */
export const GROUND_STEPS: Readonly<Record<StepGround, MaterialAction>> = {
  grass: GRASS_STEP,
  meadow: MEADOW_STEP,
  gravel: GRAVEL_STEP,
  cobble: COBBLE_STEP,
  plank: PLANK_STEP,
  sand: SAND_STEP,
  snow: SNOW_STEP,
  shallows: SHALLOWS_STEP,
  rock: ROCK_STEP,
};

/**
 * Other names the land and the voxel palette use for what is underfoot, mapped to the step that sounds like them.
 * The voxel `grass` block is turf, so it already is `grass`.
 */
const ALIASES: Readonly<Record<string, StepSurface>> = {
  paving: 'cobble', 'packed-earth': 'earth', 'trodden-grass': 'grass', planks: 'plank', plaster: 'stone',
  water: 'shallows', dirt: 'earth', path: 'earth',
};

/**
 * Any surface name, including one this library has never heard of, as a step surface. Unknown, empty or non-string
 * values become `fallback` (grass by default: off-road ground is grass), so mapping data from the land can never
 * make a step throw. `cue('step', …)` itself stays strict and throws on an unknown material.
 */
export function stepSurfaceOf(value: unknown, fallback: StepSurface = 'grass'): StepSurface {
  if (typeof value !== 'string') return fallback;
  if ((STEP_SURFACES as readonly string[]).includes(value)) return value as StepSurface;
  return Object.hasOwn(ALIASES, value) ? ALIASES[value]! : fallback;
}
