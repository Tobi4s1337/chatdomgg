import type { SoundScene } from './scene';
import type { Bearing, SpaceSample } from './space';
import type { GenesisSoundProfile, GenesisWeather } from './types';
import type { DayParts } from './weather';

/**
 * What every bed should be doing now: pure numbers from the land, the weather, the hour, where the ear is and the
 * mix profile. Gains are linear, into the layer before its master. The graph eases towards these over seconds,
 * so a change of weather, hour or place is a slow cross-fade, never a step.
 */
export interface Placed { level: number; pan: number; air: number }
export interface BedTargets {
  wind: { level: number; whistle: number; whistlePan: number; whistleHz: number };
  sea: { left: Placed; right: Placed; swell: number };
  lap: Placed;
  river: Placed & { flow: number; rush: Placed };
  rain: { level: number; ground: number; leaves: number; water: number };
  foliage: { level: number; pan: number; grass: boolean };
  crickets: number;
  grasshoppers: number;
  floor: number;
  /** Low-pass over the whole land, Hz: snow and fog soften the world. */
  muffle: number;
  /** Share of each call sent into the land's space (open air, valley, the mountain's echo). */
  space: number;
}

/** Authored bed levels (linear). Calibrated on rendered loudness; see README "Levels". */
export const BED_LEVELS = {
  wind: 0.18, whistle: 0.2, sea: 0.79, lap: 0.46, river: 0.085, rush: 0.18, rain: 0.53, foliage: 0.15,
  crickets: 0.113, grasshoppers: 0.083, floor: 0.011,
} as const;

/** The stream profile: the land sits 5 dB lower overall and talkative layers thin further. */
export const STREAM_TRIM_DB = -5;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** Distance law for a broad source (a shore, a river): 1 / (1 + d / reach). */
const reach = (distance: number, metres: number) => 1 / (1 + Math.max(0, distance) / metres);
/** Air absorption: far things lose their top first. */
export const airHz = (distance: number) => Math.max(500, Math.min(18000, 18000 / (1 + Math.max(0, distance) / 70)));

function placed(level: number, bearing: Bearing): Placed {
  return { level, pan: bearing.pan, air: airHz(bearing.distance) };
}

export function bedTargets(scene: SoundScene, weather: GenesisWeather, day: DayParts, space: SpaceSample, profile: GenesisSoundProfile): BedTargets {
  const { emphasis } = scene, stream = profile === 'stream';
  const wind = clamp01(weather.wind * space.exposure * emphasis.wind * (1 - weather.snow * 0.2));
  const swell = clamp01(0.3 + weather.wind * 0.45 + weather.storm * 0.5 - weather.fog * 0.15);
  const seaLevel = BED_LEVELS.sea * emphasis.sea * (0.55 + swell * 0.6);
  const seaReach = 70;

  // The whistle lives where wind meets an edge: the pass, the stone circle, a harbour's masts.
  const passNear = reach(space.pass.distance, 120) * emphasis.whistle;
  const circle = scene.landmark === 'stone-circle' ? reach(space.landmark.distance, 60) * 0.6 : 0;
  const whistleSource = passNear >= circle ? space.pass : space.landmark;
  const whistle = clamp01(Math.max(passNear, circle) * smoothstep(0.35, 0.8, wind + space.altitude * 0.25));

  const riverNear = reach(space.river.near.distance, 28 + space.river.flow * 30);
  const flow = clamp01(space.river.flow + weather.wet * 0.25 + weather.rain * 0.15);
  const rushNear = reach(space.river.rush.distance, 35) * space.river.rushWeight;

  const forestNear = space.forest.inside ? 1 : reach(space.forest.near.distance, 40);
  const rainOn = clamp01(weather.rain);
  const waterNear = Math.max(reach(space.sea.near.distance, 60), riverNear);

  const insectWeather = (1 - weather.rain) * (1 - weather.snow) * (1 - weather.storm) * (1 - smoothstep(0.55, 0.9, weather.wind));
  const open = clamp01(1 - space.town * 0.5) * (1 - space.altitude * 0.5);
  const cricketsBiome = scene.biome === 'woodland' ? 0.6 : scene.biome === 'coastal' ? 0.55 : 1;
  const hopperBiome = scene.biome === 'meadow' ? 1 : scene.biome === 'highland' ? 0.6 : 0.25;
  const talk = stream ? 0.6 : 1;

  return {
    wind: {
      level: BED_LEVELS.wind * (0.18 + wind * 0.95),
      whistle: BED_LEVELS.whistle * whistle,
      whistlePan: whistleSource.pan,
      whistleHz: whistleSource === space.landmark ? 230 : 520 + 60 * (scene.passWidth > 20 ? -1 : 1),
    },
    sea: {
      left: placed(seaLevel * reach(space.sea.left.distance, seaReach), space.sea.left),
      right: placed(seaLevel * reach(space.sea.right.distance, seaReach), space.sea.right),
      swell,
    },
    lap: placed(emphasis.harbour * BED_LEVELS.lap * reach(space.harbour.distance, 14) * (0.6 + weather.wind * 0.5) * talk, space.harbour),
    river: {
      ...placed(BED_LEVELS.river * emphasis.river * riverNear * (0.55 + flow * 0.6) * (1 - space.altitude * 0.4), space.river.near),
      flow,
      rush: placed(BED_LEVELS.rush * rushNear * (0.6 + flow * 0.5) * (stream ? 0.7 : 1), space.river.rush),
    },
    rain: {
      level: BED_LEVELS.rain * Math.sqrt(rainOn) * (0.6 + weather.storm * 0.2),
      ground: clamp01(1 - forestNear * 0.6),
      leaves: clamp01(forestNear * 1.2),
      water: clamp01(waterNear * 1.4),
    },
    foliage: {
      // Leaves move with the wind above the canopy, not the sheltered air at the ear.
      level: BED_LEVELS.foliage * clamp01(Math.max(forestNear, scene.biome === 'woodland' ? 0.35 : 0.15)) * smoothstep(0.05, 0.6, weather.wind),
      pan: space.forest.near.pan,
      grass: !space.forest.inside && forestNear < 0.3 && (scene.biome === 'highland' || scene.biome === 'coastal' || scene.biome === 'meadow'),
    },
    crickets: BED_LEVELS.crickets * clamp01(day.night + day.dusk * 0.7) * insectWeather * open * cricketsBiome * talk,
    grasshoppers: BED_LEVELS.grasshoppers * clamp01(day.day - day.dawn) * insectWeather * open * hopperBiome * talk,
    floor: BED_LEVELS.floor * (0.45 + 0.55 * day.day) * (stream ? 0.6 : 1),
    muffle: Math.max(3800, 19000 * (1 - weather.snow * 0.72) * (1 - weather.fog * 0.38)),
    space: Math.min(1.2, 0.5 + emphasis.echo * 0.6 + space.altitude * 0.2) * (1 - weather.snow * 0.5),
  };
}

function smoothstep(low: number, high: number, x: number): number {
  const t = clamp01((x - low) / (high - low));
  return t * t * (3 - 2 * t);
}
