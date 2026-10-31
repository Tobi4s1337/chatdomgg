import { VOXEL_METRES } from '../deps';
import type { EmoteWeatherInstance } from '../chat/presentation';
import type { ApprovedEmoteVisual } from '../types';
import { sampleEmoteFrame } from './sample';

/**
 * How chant weather moves. Small carved emotes lift off the chanters like lanterns, tumble slowly as
 * they spread on one shared breeze, hang over the street and shrink away; the emission is spread over
 * the weather so the cloud breathes instead of bursting once.
 */
export const EMOTE_WEATHER_SHAPE = {
  /** Height of one carved emote in the air, metres, before its own variation. */
  size: .8,
  sizeJitter: .18,
  /** Each particle's flight, ms. Emission ends early enough for the last to land before the weather ends. */
  lifeMs: [4_600, 6_400] as const,
  /** Starts above the head of the person it rises from. */
  headMetres: 1.75,
  rise: [2.4, 6.2] as const,
  spread: [1, 4.4] as const,
  /** Shared breeze, metres across a flight. */
  breeze: 1.4,
  /** Turns per second about the vertical, either way. */
  spin: [.35, 1.1] as const,
  /** In with an overshoot over this share of the flight; shrinks away over the last share. */
  growIn: .09,
  fadeOut: .22,
} as const;

/** Deterministic unit noise from a seed and an index (an integer hash, no Math.random). */
function unit(seed: number, index: number, salt: number): number {
  let h = Math.imul(seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b), 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const easeOutCubic = (x: number): number => 1 - (1 - x) ** 3;
const easeOutBack = (x: number): number => { const c = 1.9; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };

/**
 * Writes the weather's live particles at caller time as column-major 4×4 matrices (three.js order)
 * into `matrices`, with a 0–1 visibility per particle in `fades`, and returns how many it wrote.
 * Each matrix carries the carved emote from its own cell origin to its place: centred on its
 * middle, spun about Y, rocked about Z and scaled from build cells to its size in the air.
 */
export function emoteWeatherParticles(weather: EmoteWeatherInstance, atMs: number, matrices: Float32Array, fades?: Float32Array): number {
  const S = EMOTE_WEATHER_SHAPE;
  const [w, h, d] = weather.visual.frames[0]!.blueprint.size;
  const cell = VOXEL_METRES.build, heightMetres = h * cell;
  const elapsed = atMs - weather.startedAt;
  const total = weather.endsAt - weather.startedAt;
  if (!(elapsed >= 0) || elapsed >= total || weather.spawn.length === 0) return 0;
  const emitFor = Math.max(1, total - S.lifeMs[1]);
  const windAngle = unit(weather.seed, 0, 99) * Math.PI * 2;
  const windX = Math.cos(windAngle) * S.breeze, windZ = Math.sin(windAngle) * S.breeze;
  const capacity = Math.min(weather.particles, Math.floor(matrices.length / 16), fades ? fades.length : Infinity);
  let count = 0;
  for (let i = 0; i < weather.particles && count < capacity; i++) {
    const r = (salt: number) => unit(weather.seed, i, salt);
    const launch = (i + r(1) * .8) / weather.particles * emitFor;
    const life = lerp(S.lifeMs[0], S.lifeMs[1], r(2));
    const u = (elapsed - launch) / life;
    if (u < 0 || u >= 1) continue;
    const from = weather.spawn[i % weather.spawn.length]!;
    const angle = r(3) * Math.PI * 2, out = lerp(S.spread[0], S.spread[1], r(4)) * easeOutCubic(u);
    const seconds = (elapsed - launch) / 1000;
    const flutter = .18 * Math.sin(seconds * lerp(1.6, 2.6, r(5)) + r(6) * 6.283);
    const x = from[0] + Math.cos(angle) * (.25 + out) + windX * u + flutter * Math.sin(angle);
    const z = from[2] + Math.sin(angle) * (.25 + out) + windZ * u - flutter * Math.cos(angle);
    // Lifts quickly, then hangs and sinks a little as it slows: weather, not a firework.
    const rise = lerp(S.rise[0], S.rise[1], r(7));
    const y = from[1] + S.headMetres + rise * easeOutCubic(Math.min(1, u * 1.35)) - rise * .12 * Math.max(0, u - .7) / .3;
    const grow = u < S.growIn ? easeOutBack(u / S.growIn) : u > 1 - S.fadeOut ? Math.max(0, (1 - u) / S.fadeOut) ** .7 : 1;
    const size = S.size * (1 + (r(8) - .5) * 2 * S.sizeJitter) * Math.max(0, grow);
    if (size <= 1e-4) continue;
    const yaw = r(9) * 6.283 + (r(10) < .5 ? -1 : 1) * lerp(S.spin[0], S.spin[1], r(11)) * 6.283 * seconds * .25;
    const roll = .32 * Math.sin(seconds * lerp(1.1, 1.9, r(12)) + r(13) * 6.283);
    // The voxel material turns cells into metres of the carved emote before this matrix, so:
    // M = T(position) · Ry(yaw) · Rz(roll) · S(k) · T(-centre), centre and k in those metres.
    const k = size / heightMetres;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll);
    // Columns of Ry·Rz.
    const ax = cy * cr, ay = sr, az = -sy * cr;
    const bx = -cy * sr, by = cr, bz = sy * sr;
    const zx = sy, zy = 0, zz = cy;
    const cx = -w / 2 * cell, cyo = -h / 2 * cell, cz = -d / 2 * cell;
    const o = count * 16;
    matrices[o] = ax * k; matrices[o + 1] = ay * k; matrices[o + 2] = az * k; matrices[o + 3] = 0;
    matrices[o + 4] = bx * k; matrices[o + 5] = by * k; matrices[o + 6] = bz * k; matrices[o + 7] = 0;
    matrices[o + 8] = zx * k; matrices[o + 9] = zy * k; matrices[o + 10] = zz * k; matrices[o + 11] = 0;
    matrices[o + 12] = x + (ax * cx + bx * cyo + zx * cz) * k;
    matrices[o + 13] = y + (ay * cx + by * cyo + zy * cz) * k;
    matrices[o + 14] = z + (az * cx + bz * cyo + zz * cz) * k;
    matrices[o + 15] = 1;
    if (fades) fades[count] = u > 1 - S.fadeOut ? Math.max(.05, (1 - u) / S.fadeOut) : 1;
    count++;
  }
  return count;
}

/** The host's instanced batch for one approved revision: it meshes the frames with its own workers and material. */
export interface EmoteWeatherBatch {
  /** Shows `count` instances of frame `frameIndex` with these matrices and fades. */
  show(frameIndex: number, matrices: Float32Array, fades: Float32Array, count: number): void;
  hide(): void;
  dispose(): void;
}

export interface EmoteWeatherHost {
  createBatch(visual: ApprovedEmoteVisual, capacity: number): EmoteWeatherBatch;
}

export interface EmoteWeatherStats {
  readonly batches: number;
  readonly particles: number;
  readonly motifs: readonly { readonly id: string; readonly revision: string; readonly frame: number; readonly particles: number }[];
}

export interface EmoteWeather {
  /** Draws these weathers at caller time; batches for revisions no longer raining are released. */
  update(weather: readonly EmoteWeatherInstance[], atMs: number): EmoteWeatherStats;
  dispose(): void;
}

/**
 * Drives chant weather through the host's instanced batches: one batch per raining revision (one
 * draw), the whole cloud on the emote's own frame timing so an animated emote keeps waving in the air.
 * The batch cache holds at most `maxBatches` revisions; anything not raining is disposed at once.
 */
export function createEmoteWeather(host: EmoteWeatherHost, options: { readonly capacity: number; readonly maxBatches?: number }): EmoteWeather {
  const capacity = Math.max(1, Math.floor(options.capacity));
  const maxBatches = options.maxBatches ?? 2;
  const batches = new Map<string, { batch: EmoteWeatherBatch; matrices: Float32Array; fades: Float32Array }>();
  let disposed = false;
  return {
    update(list, atMs) {
      if (disposed) return { batches: 0, particles: 0, motifs: [] };
      const live = list.slice(0, maxBatches);
      const wanted = new Set(live.map(w => w.visual.revision));
      for (const [revision, entry] of batches) if (!wanted.has(revision)) { entry.batch.dispose(); batches.delete(revision); }
      const motifs: { id: string; revision: string; frame: number; particles: number }[] = [];
      let particles = 0;
      for (const weather of live) {
        let entry = batches.get(weather.visual.revision);
        if (!entry) {
          entry = { batch: host.createBatch(weather.visual, capacity), matrices: new Float32Array(capacity * 16), fades: new Float32Array(capacity) };
          batches.set(weather.visual.revision, entry);
        }
        const count = emoteWeatherParticles(weather, atMs, entry.matrices, entry.fades);
        const frame = sampleEmoteFrame(weather.visual, atMs - weather.startedAt).index;
        if (count > 0) entry.batch.show(frame, entry.matrices, entry.fades, count); else entry.batch.hide();
        particles += count;
        motifs.push({ id: weather.id, revision: weather.visual.revision, frame, particles: count });
      }
      return { batches: batches.size, particles, motifs };
    },
    dispose() {
      disposed = true;
      for (const entry of batches.values()) entry.batch.dispose();
      batches.clear();
    },
  };
}
