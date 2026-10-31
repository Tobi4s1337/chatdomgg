import { hashString, valueNoise } from './rng';
import type { GenesisWeather, GenesisWeatherKind, LandscapeCharacter } from './types';

const MINUTE = 60_000;

/** How each land takes the same sky: the pass is windier and can snow, the coast catches storms, valleys hold mist. */
const CLIMATE: Readonly<Record<LandscapeCharacter, { wind: number; storm: number; fog: number; snow: boolean }>> = {
  'coastal-harbour': { wind: 1.12, storm: 1.15, fog: 1.0, snow: false },
  'river-valley': { wind: 0.8, storm: 0.85, fog: 1.25, snow: false },
  'mountain-pass': { wind: 1.3, storm: 1.0, fog: 0.9, snow: true },
};

const smooth = (low: number, high: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - low) / (high - low)));
  return t * t * (3 - 2 * t);
};
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Three octaves of value noise: slow fronts over hours, showers over tens of minutes. Mean 0.5. */
function field(seed: number, t: number, periods: readonly [number, number, number]): number {
  return valueNoise(seed, t, periods[0]) * 0.5 + valueNoise(seed ^ 0x51ed, t, periods[1]) * 0.3
    + valueNoise(seed ^ 0xa3c5, t, periods[2]) * 0.2;
}

/**
 * Raw sky for a realm moment: continuous in time, so the weather never jumps; a front takes realm minutes to arrive
 * and to clear. About two thirds of the time is fair, a sixth wet, a few percent storm (measured over a realm year
 * in the tests).
 */
function sky(seed: number, character: LandscapeCharacter, realmMs: number): Omit<GenesisWeather, 'wet'> {
  const climate = CLIMATE[character];
  const t = realmMs / MINUTE;
  const pressure = field(seed ^ 0x1001, t, [190, 70, 23]);
  const humidity = field(seed ^ 0x2002, t, [160, 55, 17]);
  const cold = field(seed ^ 0x3003, t, [300, 110, 40]);
  const wind = clamp01((0.12 + 0.95 * smooth(0.3, 0.82, pressure)) * climate.wind * 0.82);
  const precipitation = smooth(0.6, 0.76, humidity);
  const storm = clamp01(smooth(0.7, 0.82, humidity) * smooth(0.48, 0.66, pressure) * climate.storm);
  const snowShare = climate.snow ? smooth(0.42, 0.6, 1 - cold) : 0;
  const fog = clamp01(smooth(0.5, 0.62, humidity) * (1 - smooth(0.35, 0.6, pressure)) * (1 - precipitation * 0.6) * climate.fog);
  return {
    wind: clamp01(wind + storm * 0.35),
    rain: clamp01(precipitation * (1 - snowShare)),
    snow: clamp01(precipitation * snowShare * (1 - storm)),
    storm,
    fog,
  };
}

/**
 * The seeded weather of a kingdom at a realm moment (`soul.weatherSeedKey`, `soul.clock: 'realm-time'`). Pure:
 * the same key, land and moment always give the same weather, for every viewer.
 */
export function genesisWeatherAt(weatherSeedKey: string, character: LandscapeCharacter, realmMs: number): GenesisWeather {
  if (!Number.isFinite(realmMs)) throw new RangeError('genesis sound: realmMs must be finite');
  const seed = hashString(weatherSeedKey);
  const now = sky(seed, character, realmMs);
  // Wetness remembers the last few minutes of rain: eaves and leaves keep dripping after a shower stops.
  let wet = now.rain;
  for (const minutes of [1, 2, 3.5, 5]) wet = Math.max(wet, sky(seed, character, realmMs - minutes * MINUTE).rain * (1 - minutes / 6));
  return { ...now, wet: clamp01(wet) };
}

/** A short name for the weather, for the bench and diagnostics. */
export function weatherKind(weather: Readonly<GenesisWeather>): GenesisWeatherKind {
  if (weather.storm > 0.35) return 'storm';
  if (weather.snow > 0.2) return 'snow';
  if (weather.rain > 0.55) return 'rain';
  if (weather.rain > 0.15) return 'drizzle';
  if (weather.fog > 0.35) return 'mist';
  if (weather.wind > 0.62) return 'windy';
  if (weather.wind > 0.36) return 'breezy';
  return 'clear';
}

/** Applies a host's own weather over the seeded one, clamping every field. Non-finite values are ignored. */
export function mergeWeather(seeded: Readonly<GenesisWeather>, host: Partial<GenesisWeather> | undefined): GenesisWeather {
  const result = { ...seeded };
  if (!host) return result;
  for (const key of Object.keys(result) as (keyof GenesisWeather)[]) {
    const value = host[key];
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = clamp01(value);
  }
  if (host.rain !== undefined && host.wet === undefined) result.wet = Math.max(result.wet, result.rain);
  return result;
}

/**
 * The time of day as overlapping weights. `night` follows the picture's sky (dark by 20:30, light by 07:00);
 * `dawn` and `dusk` are the choruses either side of it.
 */
export interface DayParts { night: number; day: number; dawn: number; dusk: number }

export function dayParts(hour: number): DayParts {
  if (!Number.isFinite(hour)) throw new RangeError('genesis sound: hour must be finite');
  const h = ((hour % 24) + 24) % 24;
  const night = h < 12 ? 1 - smooth(4.6, 7, h) : smooth(18.4, 20.6, h);
  const bump = (centre: number, half: number) => {
    const d = Math.min(Math.abs(h - centre), 24 - Math.abs(h - centre));
    return d >= half ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * d) / half);
  };
  return { night, day: 1 - night, dawn: bump(6.1, 1.9), dusk: bump(19.4, 1.7) };
}
