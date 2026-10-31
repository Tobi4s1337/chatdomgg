import type { EffectsQuality } from './types';

/**
 * Independent budgets per tier. Every family bounds its sources, particles per source and reach on its own, and
 * lower tiers keep a strict subset of the higher tiers' particles (slot i exists on every tier that has at least
 * i + 1 slots, and the nearest sources are always kept first), so a tier change thins the air instead of
 * reshuffling it. `reach` is the camera distance in metres at which a source has fully faded.
 *
 * Coverage: glints are clamped to `glow.max` pixels across and at most `glow.streak` extra pixels along their
 * motion; smoke voxels are clamped to `smoke.max` pixels. Capacity times those clamps bounds screen coverage and
 * overdraw on every tier, independent of the camera.
 */
export const EFFECTS_BUDGET = {
  low: {
    fireflies: { sources: 4, perSource: 3, reach: 50 },
    embers: { sources: 3, perSource: 4, reach: 60 },
    smoke: { sources: 4, perSource: 7, reach: 140 },
    dust: { sources: 2, perSource: 8, reach: 40 },
    sparks: { sources: 2, perSource: 14, reach: 90 },
    /** Trail glints are one per `step` base ticks of the trail clock (see cues.ts); `motes` circle the piece. */
    flight: { trail: 9, step: 3, motes: 2, reach: 160 },
    glow: { min: 1.25, max: 4, streak: 9 },
    smokePixels: { min: 3, max: 44 },
  },
  balanced: {
    fireflies: { sources: 8, perSource: 5, reach: 80 },
    embers: { sources: 6, perSource: 7, reach: 90 },
    smoke: { sources: 8, perSource: 9, reach: 220 },
    dust: { sources: 3, perSource: 14, reach: 50 },
    sparks: { sources: 3, perSource: 22, reach: 120 },
    flight: { trail: 14, step: 2, motes: 3, reach: 220 },
    glow: { min: 1.5, max: 5, streak: 13 },
    smokePixels: { min: 3.5, max: 60 },
  },
  high: {
    fireflies: { sources: 14, perSource: 6, reach: 110 },
    embers: { sources: 10, perSource: 10, reach: 120 },
    smoke: { sources: 14, perSource: 12, reach: 300 },
    dust: { sources: 5, perSource: 20, reach: 60 },
    sparks: { sources: 4, perSource: 32, reach: 160 },
    flight: { trail: 27, step: 1, motes: 5, reach: 300 },
    glow: { min: 1.5, max: 6, streak: 18 },
    smokePixels: { min: 4, max: 76 },
  },
} as const satisfies Record<EffectsQuality, {
  fireflies: FamilyBudget; embers: FamilyBudget; smoke: FamilyBudget; dust: FamilyBudget; sparks: FamilyBudget;
  flight: { trail: number; step: number; motes: number; reach: number };
  glow: { min: number; max: number; streak: number };
  smokePixels: { min: number; max: number };
}>;

export interface FamilyBudget { sources: number; perSource: number; reach: number }

export const EFFECTS_QUALITIES = Object.keys(EFFECTS_BUDGET) as EffectsQuality[];

/** The flight's glints: its trail, the motes around the piece and the piece's own glint. */
export function flightCapacity(quality: EffectsQuality): number {
  const f = EFFECTS_BUDGET[quality].flight;
  return f.trail + f.motes + 1;
}

/** Every glint the tier can draw in one frame: fireflies, embers, dust, sparks and the flight. */
export function glowCapacity(quality: EffectsQuality): number {
  const b = EFFECTS_BUDGET[quality];
  return b.fireflies.sources * b.fireflies.perSource + b.embers.sources * b.embers.perSource
    + b.dust.sources * b.dust.perSource + b.sparks.sources * b.sparks.perSource + flightCapacity(quality);
}

/** Every smoke voxel the tier can draw in one frame. */
export function smokeCapacity(quality: EffectsQuality): number {
  const b = EFFECTS_BUDGET[quality].smoke;
  return b.sources * b.perSource;
}

/** Upper bound of covered screen pixels when every slot is drawn at its largest permitted size. */
export function maxCoveragePixels(quality: EffectsQuality, glints = glowCapacity(quality), voxels = smokeCapacity(quality)): number {
  const b = EFFECTS_BUDGET[quality];
  // A smoke voxel's silhouette spans at most √3 × its edge in each screen direction.
  return glints * b.glow.max * (b.glow.max + b.glow.streak) + voxels * 3 * b.smokePixels.max ** 2;
}

export function isQuality(value: unknown): value is EffectsQuality {
  return typeof value === 'string' && Object.hasOwn(EFFECTS_BUDGET, value);
}
