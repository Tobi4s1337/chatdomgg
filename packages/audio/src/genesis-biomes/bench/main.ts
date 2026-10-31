/**
 * Listening bench: renders named scenarios through the live layer in an OfflineAudioContext and hands the result
 * to `listen.mjs`. Inputs are the observed Genesis fixtures for the three composition targets (spec 39); the
 * listener paths, forced weather and hours are SIMULATED test inputs, not anything that happened in a kingdom.
 */
import { encodeWav } from '../../forge/offline';
import { compileChannelGenesis } from '../../../../world/src/genesis';
import { OBSERVED_GENESIS_FIXTURES } from '../../../../world/src/genesis/observed-fixtures';
import { describeGenesisSoundscape } from '../scene';
import { CALLS } from '../calls';
import { BED_LEVELS } from '../mixplan';
import { renderGenesisSoundscape } from '../offline';
import type { GenesisListener, GenesisSoundFrame, GenesisWeather, LandscapeCharacter, Vec3 } from '../types';
import type { GenesisSoundscape } from '../soundscape';
import { genesisWeatherAt, weatherKind } from '../weather';

type Ear = 'plaza' | 'harbour' | 'shore' | 'river' | 'weir' | 'pass' | 'forest' | 'walk-coast' | 'walk-valley';
type Action = 'mute' | 'unmute' | 'duck' | 'stream' | 'kingdom' | 'select-river' | 'select-mountain' | 'select-coast' | 'seek-back';

export interface Scenario {
  name: string;
  channel: '63920635' | '4363967' | '154972160';
  character: LandscapeCharacter;
  seconds: number;
  hour: number | readonly [number, number];
  /** Forced weather (SIMULATED), held or swept linearly from the first to the second. */
  weather?: Partial<GenesisWeather> | readonly [Partial<GenesisWeather>, Partial<GenesisWeather>, Partial<GenesisWeather>?];
  ear?: Ear;
  profile?: 'kingdom' | 'stream';
  actions?: readonly { t: number; action: Action }[];
  /** Realm clock at t = 0. */
  realmStart?: number;
  master?: number;
  /** Calibration only: keep these beds (by `BED_LEVELS` key) and silence the rest; calls still play. */
  solo?: readonly string[];
}

const BASE = 1_793_377_944_392;
const recipes = new Map<string, ReturnType<typeof compileChannelGenesis>>(OBSERVED_GENESIS_FIXTURES.map(facts => [String(facts.broadcasterId), compileChannelGenesis(facts)]));

function recipeFor(channel: string) {
  const recipe = recipes.get(channel);
  if (!recipe) throw new Error(`no fixture for ${channel}`);
  return recipe;
}
function landFor(channel: string, character: LandscapeCharacter): string {
  const land = recipeFor(channel).landscapes.find(candidate => candidate.character === character);
  if (!land) throw new Error(`${channel} has no ${character}`);
  return land.id;
}

function lerpWeather(stops: readonly Partial<GenesisWeather>[], x: number): Partial<GenesisWeather> {
  if (stops.length === 1) return stops[0]!;
  const span = x * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(span)), f = span - i;
  const a = stops[i]!, b = stops[i + 1]!, out: Partial<GenesisWeather> = {};
  for (const key of ['wind', 'rain', 'snow', 'storm', 'fog', 'wet'] as const) {
    const va = a[key] ?? 0, vb = b[key] ?? 0;
    out[key] = va + (vb - va) * f;
  }
  return out;
}

function earFor(scenario: Scenario, landscapeId: string, t: number): GenesisListener | undefined {
  const scene = describeGenesisSoundscape(recipeFor(scenario.channel), landscapeId);
  const towards = (from: readonly [number, number], to: readonly [number, number], metres: number): [number, number] => {
    const dx = to[0] - from[0], dz = to[1] - from[1], d = Math.hypot(dx, dz) || 1;
    return [from[0] + (dx / d) * metres, from[1] + (dz / d) * metres];
  };
  const plaza: [number, number] = [scene.defaultEar[0], scene.defaultEar[2]];
  const at = (xz: readonly [number, number], y: number, right: Vec3 = [1, 0, 0]): GenesisListener => ({ position: [xz[0], y, xz[1]], right });
  switch (scenario.ear ?? 'plaza') {
    case 'plaza': return undefined;
    case 'harbour': return at(towards(scene.harbour, plaza, 12), 3);
    case 'shore': return at(towards(scene.harbour, plaza, 4), 2);
    case 'river': return at(towards(scene.weir, plaza, 9), 4);
    case 'weir': return at(towards(scene.weir, plaza, 4), 3);
    case 'pass': return at([scene.saddle[0], scene.saddle[2]], scene.saddle[1] + 2);
    case 'forest': return at(scene.clearing, 2);
    case 'walk-coast': {
      // Plaza to the harbour edge and back, facing the sea.
      const x = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / scenario.seconds);
      const point = towards(plaza, scene.harbour, Math.hypot(scene.harbour[0] - plaza[0], scene.harbour[1] - plaza[1]) * 0.92 * x);
      return at(point, 8 - x * 5);
    }
    case 'walk-valley': {
      const x = Math.min(1, t / scenario.seconds);
      const point = towards(plaza, scene.weir, Math.hypot(scene.weir[0] - plaza[0], scene.weir[1] - plaza[1]) * 0.95 * x);
      return at(point, 8 - x * 4);
    }
  }
}

function frameFor(scenario: Scenario, landscapeId: () => string, t: number): GenesisSoundFrame {
  const x = t / scenario.seconds;
  const hour = typeof scenario.hour === 'number' ? scenario.hour : scenario.hour[0] + (scenario.hour[1] - scenario.hour[0]) * x;
  const frame: GenesisSoundFrame = { realmMs: (scenario.realmStart ?? BASE) + t * 1000, hour };
  const listener = earFor(scenario, landscapeId(), t);
  if (listener) frame.listener = listener;
  if (scenario.weather) {
    frame.weather = Array.isArray(scenario.weather)
      ? lerpWeather(scenario.weather as readonly Partial<GenesisWeather>[], x)
      : scenario.weather as Partial<GenesisWeather>;
  }
  return frame;
}

async function render(scenario: Scenario) {
  const recipe = recipeFor(scenario.channel);
  let current = landFor(scenario.channel, scenario.character);
  const select = (character: LandscapeCharacter) => (soundscape: GenesisSoundscape) => {
    current = landFor(scenario.channel, character);
    soundscape.select(current);
  };
  const run: Record<Action, (soundscape: GenesisSoundscape) => void> = {
    mute: s => s.setMix({ muted: true }), unmute: s => s.setMix({ muted: false }), duck: s => s.duck({ depthDb: 8, seconds: 3 }),
    stream: s => s.setMix({ profile: 'stream' }), kingdom: s => s.setMix({ profile: 'kingdom' }),
    'select-river': select('river-valley'), 'select-mountain': select('mountain-pass'), 'select-coast': select('coastal-harbour'),
    'seek-back': () => { offset -= 20_000; },
  };
  let offset = 0;
  const started = performance.now();
  const levels = { ...BED_LEVELS } as Record<string, number>;
  if (scenario.solo) for (const key of Object.keys(levels)) if (!scenario.solo.includes(key)) (BED_LEVELS as Record<string, number>)[key] = 0;
  const builds = Object.fromEntries(Object.entries(CALLS).map(([key, design]) => [key, design.build]));
  if (scenario.solo && !scenario.solo.includes('calls')) for (const design of Object.values(CALLS)) (design as { build: unknown }).build = () => undefined;
  const result = await renderGenesisSoundscape({
    recipe, landscapeId: current, duration: scenario.seconds,
    master: scenario.master ?? 0.4225,
    mix: { profile: scenario.profile ?? 'kingdom' },
    frame: t => { const frame = frameFor(scenario, () => current, t); frame.realmMs += offset; return frame; },
    at: (scenario.actions ?? []).map(item => ({ t: item.t, run: run[item.action] })),
    inspectAt: Array.from({ length: Math.floor(scenario.seconds / 5) }, (_, i) => (i + 1) * 5 - 0.01),
  }).finally(() => {
    Object.assign(BED_LEVELS, levels);
    for (const [key, build] of Object.entries(builds)) (CALLS as Record<string, { build: unknown }>)[key]!.build = build;
  });
  const channels = [result.buffer.getChannelData(0), result.buffer.getChannelData(1)];
  const wav = encodeWav(channels, result.buffer.sampleRate);
  let binary = '';
  for (let i = 0; i < wav.length; i += 0x8000) binary += String.fromCharCode(...wav.subarray(i, i + 0x8000));
  let peak = 0;
  for (const data of channels) for (const v of data) peak = Math.max(peak, Math.abs(v));
  const last = result.inspections[result.inspections.length - 1]?.inspection;
  return {
    name: scenario.name, seconds: scenario.seconds, renderMs: Math.round(performance.now() - started), peak,
    wav: btoa(binary),
    played: last?.played ?? {},
    events: last?.events ?? [],
    snapshots: result.inspections.map(({ t, inspection }) => ({
      t, landscape: inspection.character, biome: inspection.biome, weather: inspection.weatherKind, beds: inspection.beds,
      bedSources: inspection.bedSources, callVoices: inspection.callVoices, callSources: inspection.callSources,
      peakBedSources: inspection.peakBedSources, peakCallSources: inspection.peakCallSources, kitBytes: inspection.kitBytes,
      targets: inspection.targets,
    })),
  };
}

/** The seeded weather of each target over a realm day, sampled every 10 realm minutes (for the README). */
function seededDay(channel: string, character: LandscapeCharacter) {
  const recipe = recipeFor(channel);
  return Array.from({ length: 144 }, (_, i) => weatherKind(genesisWeatherAt(recipe.soul.weatherSeedKey, character, BASE + i * 600_000)));
}

Object.assign(window, { renderGenesis: render, seededDay, genesisReady: true });
