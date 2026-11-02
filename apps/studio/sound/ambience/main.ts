/**
 * The teaser's ambience bench. Renders, in an OfflineAudioContext, the layers of the two town beds and the hero
 * sounds the kingdom already has, and hands each back to `render.mjs` as raw Float32 samples. Mixing, looping,
 * loudness and the files themselves are done in Node by `render.mjs`.
 *
 * Sources:
 * - the land (sea, harbour, birds, crickets, the bell buoy): packages/audio/src/genesis-biomes, renderGenesisSoundscape;
 * - footsteps, window lights, the street wave, the beacon: packages/audio/src/offline.ts, renderKingdomAudio;
 * - horn, cart, crowd, drum: apps/web/src/twitch-moments/sound.ts, createProceduralMomentSound;
 * - the Forge strike and landing: packages/audio/src/forge, renderForgeAudio;
 * - the fire and the distant talk: authored for the teaser here (fire.ts, murmur.ts).
 * Inputs (hours, weather, where the ear stands, the ritual schedule) are chosen for the teaser's shots.
 */
import { renderGenesisSoundscape } from '../../../../packages/audio/src/genesis-biomes/offline';
import { describeGenesisSoundscape } from '../../../../packages/audio/src/genesis-biomes/scene';
import type { GenesisListener, GenesisWeather, LandscapeCharacter } from '../../../../packages/audio/src/genesis-biomes/types';
import { compileChannelGenesis } from '../../../../packages/world/src/genesis';
import { OBSERVED_GENESIS_FIXTURES } from '../../../../packages/world/src/genesis/observed-fixtures';
import { renderKingdomAudio, type ScriptStep } from '../../../../packages/audio/src/offline';
import { renderForgeAudio } from '../../../../packages/audio/src/forge/offline';
import { FORGE_SPANS } from '../../../../packages/audio/src/forge/conductor';
import type { ForgePhase, ForgeRitualFrame } from '../../../../packages/shared/src/forge';
import type { MomentCue } from '../../../../apps/web/src/twitch-moments/controller';
import { createProceduralMomentSound, CUE_LENGTH_MS } from '../../../../apps/web/src/twitch-moments/sound';
import { renderFire, type FireOptions } from './fire';
import { renderMurmur, type MurmurOptions } from './murmur';
import { seeded } from './rng';

const RATE = 48000;
/** The realm clock at the start of every land render (the Genesis bench's own base). */
const REALM_BASE = 1_793_377_944_392;

const recipes = new Map(OBSERVED_GENESIS_FIXTURES.map(facts => [String(facts.broadcasterId), compileChannelGenesis(facts)]));
function recipeFor(channel: string) {
  const recipe = recipes.get(channel);
  if (!recipe) throw new Error(`no Genesis fixture for ${channel}`);
  return recipe;
}

export interface LandTask {
  kind: 'land';
  channel: string;
  character: LandscapeCharacter;
  hour: number;
  weather: GenesisWeather;
  /** Metres from the harbour's shore point towards the plaza; omitted = the plaza ear. */
  fromHarbour?: number;
  /** Instead: metres from the harbour's shore point towards the nearest forest edge (birds in the trees). */
  towardsForest?: number;
  height?: number;
  seconds: number;
  /** Moves the realm clock's start (seconds), so two beds from the same land do not share their seeded events. */
  realmOffsetSeconds?: number;
  /** Rendered before the kept audio so every bed has eased in. */
  preroll: number;
}
export interface KingdomTask { kind: 'kingdom'; script: ScriptStep[]; seconds: number; seed: number; volume?: number }
export interface MomentTask { kind: 'moment'; cues: { cue: MomentCue; at: number; gain?: number }[]; seconds: number }
export interface ForgeTask { kind: 'forge'; from: number; to: number; lead: number; seconds: number }
export type Task = LandTask | KingdomTask | MomentTask | ForgeTask
  | ({ kind: 'fire' } & FireOptions) | ({ kind: 'murmur' } & MurmurOptions);

function toBase64(data: Float32Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function ear(task: LandTask): GenesisListener | undefined {
  if (task.fromHarbour === undefined && task.towardsForest === undefined) return undefined;
  const recipe = recipeFor(task.channel), land = recipe.landscapes.find(l => l.character === task.character)!;
  const scene = describeGenesisSoundscape(recipe, land.id), harbour = scene.harbour;
  if (task.towardsForest !== undefined) {
    const edge = [...scene.forest].sort((a, b) => Math.hypot(a[0] - harbour[0], a[1] - harbour[1]) - Math.hypot(b[0] - harbour[0], b[1] - harbour[1]))[0]!;
    const dx = edge[0] - harbour[0], dz = edge[1] - harbour[1], d = Math.hypot(dx, dz) || 1, m = Math.min(task.towardsForest, d);
    return { position: [harbour[0] + (dx / d) * m, task.height ?? 3, harbour[1] + (dz / d) * m], right: [1, 0, 0] };
  }
  const plaza = [scene.defaultEar[0], scene.defaultEar[2]] as const;
  const dx = plaza[0] - harbour[0], dz = plaza[1] - harbour[1], d = Math.hypot(dx, dz) || 1, m = Math.min(task.fromHarbour ?? 0, d);
  return { position: [harbour[0] + (dx / d) * m, task.height ?? 3, harbour[1] + (dz / d) * m], right: [1, 0, 0] };
}

/** The realm clock at t = 0: the evening and the night beds start at different realm moments, so their seeded events differ. */
const realmStart = (task: LandTask) => REALM_BASE + (task.realmOffsetSeconds ?? 0) * 1000;

async function renderLand(task: LandTask) {
  const recipe = recipeFor(task.channel), land = recipe.landscapes.find(l => l.character === task.character);
  if (!land) throw new Error(`${task.channel} has no ${task.character}`);
  const listener = ear(task), total = task.seconds + task.preroll;
  const result = await renderGenesisSoundscape({
    recipe, landscapeId: land.id, duration: total, sampleRate: RATE,
    frame: t => ({ realmMs: realmStart(task) + t * 1000, hour: task.hour, weather: task.weather, ...(listener ? { listener } : {}) }),
    inspectAt: Array.from({ length: Math.floor(total / 2) }, (_, i) => (i + 1) * 2 - 0.05),
  });
  const skip = Math.round(task.preroll * RATE), inspection = result.inspections[result.inspections.length - 1]?.inspection;
  // Every call event over the render (the inspection keeps only recent ones), counted by call and outcome, kept part only.
  const seen = new Map<string, { at: number; call: string; outcome: string; distance?: number }>();
  for (const { inspection: snap } of result.inspections) for (const e of snap.events) seen.set(`${e.at}:${e.call}`, e);
  const start = realmStart(task) / 1000 + task.preroll, calls: Record<string, Record<string, number>> = {};
  const kept = [...seen.values()].filter(e => e.at >= start).sort((a, b) => a.at - b.at);
  for (const e of kept) { const row = calls[e.call] ??= {}; row[e.outcome] = (row[e.outcome] ?? 0) + 1; }
  return {
    channels: [result.buffer.getChannelData(0).subarray(skip), result.buffer.getChannelData(1).subarray(skip)],
    info: {
      landscape: land.id, biome: inspection?.biome, weather: inspection?.weatherKind, day: inspection?.day, beds: inspection?.beds,
      targets: inspection?.targets, calls, timeline: kept.filter(e => e.outcome === 'played').map(e => ({ t: Number((e.at - start).toFixed(2)), call: e.call, distance: e.distance })),
      listener: listener ?? 'plaza (default ear)',
    },
  };
}

async function renderKingdom(task: KingdomTask) {
  const result = await renderKingdomAudio(task.script, { duration: task.seconds, sampleRate: RATE, random: seeded(task.seed), settings: { volume: task.volume ?? 0.65 } });
  return { channels: [result.buffer.getChannelData(0), result.buffer.getChannelData(1)], info: { played: result.played } };
}

async function renderMoment(task: MomentTask) {
  const context = new OfflineAudioContext(2, Math.ceil(task.seconds * RATE), RATE);
  const port = createProceduralMomentSound({ context: () => ({ context: context as unknown as AudioContext, destination: context.destination }), now: () => 0, gain: () => 1 });
  // The live port disconnects a cue on a wall-clock timer after its length. Offline rendering runs on its own
  // clock, so the timer is held back while the cues are scheduled; the cue graph itself is untouched.
  const realTimeout = globalThis.setTimeout;
  (globalThis as { setTimeout: unknown }).setTimeout = () => 0;
  try { for (const item of task.cues) port.play(item.cue, item.at * 1000, item.gain ?? 1); }
  finally { globalThis.setTimeout = realTimeout; }
  const buffer = await context.startRendering();
  return { channels: [buffer.getChannelData(0), buffer.getChannelData(1)], info: { cues: task.cues, lengthsMs: task.cues.map(c => CUE_LENGTH_MS[c.cue]) } };
}

const SPANS = Object.entries(FORGE_SPANS) as [ForgePhase, readonly [number, number]][];
/** The authored local schedule (FORGE_SPANS) at `elapsed` nominal seconds, as the host's ritual clock reports it. */
function forgeFrame(elapsed: number): ForgeRitualFrame {
  const [phase, [from, to]] = SPANS.find(([, [a, b]]) => elapsed >= a && elapsed < b) ?? SPANS[SPANS.length - 1]!;
  return { ritualId: 'teaser-forge', phase, elapsed, phaseProgress: Math.min(1, Math.max(0, (elapsed - from) / (to - from))), duration: 21, source: 'simulated' };
}

async function renderForge(task: ForgeTask) {
  let mixed = false;
  const result = await renderForgeAudio({
    duration: task.seconds, sampleRate: RATE,
    drive(t, adapters) {
      const forge = adapters[0]!;
      if (!mixed) { forge.setMix({ muted: false, volume: 1 }); mixed = true; }
      if (t < task.lead) return;
      const elapsed = task.from + (t - task.lead);
      // Past `to` the anvil is clear (a null frame): what is ringing rings out, nothing new starts.
      forge.update(elapsed <= task.to ? forgeFrame(elapsed) : (task.to >= 21 ? forgeFrame(21) : null));
    },
  });
  const played = result.inspections[0]?.played;
  return { channels: [result.buffer.getChannelData(0), result.buffer.getChannelData(1)], info: { played } };
}

async function renderTask(task: Task) {
  const started = performance.now();
  let out: { channels: Float32Array[]; info: unknown };
  switch (task.kind) {
    case 'land': out = await renderLand(task); break;
    case 'kingdom': out = await renderKingdom(task); break;
    case 'moment': out = await renderMoment(task); break;
    case 'forge': out = await renderForge(task); break;
    case 'fire': { const b = await renderFire(task); out = { channels: [b.getChannelData(0), b.getChannelData(1)], info: {} }; break; }
    case 'murmur': { const b = await renderMurmur(task); out = { channels: [b.getChannelData(0), b.getChannelData(1)], info: {} }; break; }
  }
  return { sampleRate: RATE, frames: out.channels[0]!.length, channels: out.channels.map(toBase64), info: out.info, renderMs: Math.round(performance.now() - started) };
}

/** Where things are in one land, to choose where the ear stands. */
function sceneOf(channel: string, character: LandscapeCharacter) {
  const recipe = recipeFor(channel), land = recipe.landscapes.find(l => l.character === character)!;
  const scene = describeGenesisSoundscape(recipe, land.id), plaza = [scene.defaultEar[0], scene.defaultEar[2]] as const;
  const dist = (a: readonly [number, number], b: readonly [number, number]) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]));
  const forest = scene.forest.length ? Math.min(...scene.forest.map(f => dist(f, plaza))) : null;
  const forestFromHarbour = scene.forest.length ? Math.min(...scene.forest.map(f => dist(f, scene.harbour))) : null;
  return { plaza: scene.defaultEar, harbour: scene.harbour, plazaToHarbour: dist(plaza, scene.harbour), buoyFromHarbour: dist(scene.buoy, scene.harbour),
    nearestForestFromPlaza: forest, nearestForestFromHarbour: forestFromHarbour, town: scene.town, pools: scene.pools.map(p => p.key) };
}

/** Which biome and landscapes each observed channel has, to pick the land for a bed. */
function probe() {
  return [...recipes.entries()].map(([channel, recipe]) => ({
    channel, biome: recipe.soul.soundscape,
    landscapes: recipe.landscapes.map(l => l.character),
  }));
}

/** Renders land tasks and reports only what was heard (no audio), to choose the ear and the hour. */
async function survey(tasks: LandTask[]) {
  const rows = [];
  for (const task of tasks) { const r = await renderLand(task); rows.push({ task, info: r.info }); }
  return rows;
}

Object.assign(window, { surveyAmbience: survey, renderAmbience: renderTask, probeAmbience: probe, sceneAmbience: sceneOf, ambienceReady: true });
