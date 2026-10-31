import type { EffectsQuality } from './types';

/**
 * Independent budgets per tier. Lower tiers keep a strict subset of the higher tiers' particles (slot i exists on
 * every tier that has at least i + 1 slots), so a tier change thins the air instead of reshuffling it.
 * `reach` is the camera distance in metres at which a source has fully faded; `pixels` clamps one quad's edge on
 * screen, which, times the capacity, bounds coverage and overdraw.
 */
export const EFFECTS_BUDGET = {
  low: {
    fireflies: { sources: 4, perSource: 3, reach: 50 },
    embers: { sources: 3, perSource: 4, reach: 60 },
    pixels: { min: 1.25, max: 4 },
  },
  balanced: {
    fireflies: { sources: 8, perSource: 5, reach: 80 },
    embers: { sources: 6, perSource: 7, reach: 90 },
    pixels: { min: 1.5, max: 5 },
  },
  high: {
    fireflies: { sources: 14, perSource: 6, reach: 110 },
    embers: { sources: 10, perSource: 10, reach: 120 },
    pixels: { min: 1.5, max: 6 },
  },
} as const satisfies Record<EffectsQuality, {
  fireflies: { sources: number; perSource: number; reach: number };
  embers: { sources: number; perSource: number; reach: number };
  pixels: { min: number; max: number };
}>;

export const EFFECTS_QUALITIES = Object.keys(EFFECTS_BUDGET) as EffectsQuality[];

export function glowCapacity(quality: EffectsQuality): number {
  const b = EFFECTS_BUDGET[quality];
  return b.fireflies.sources * b.fireflies.perSource + b.embers.sources * b.embers.perSource;
}

export function isQuality(value: unknown): value is EffectsQuality {
  return typeof value === 'string' && Object.hasOwn(EFFECTS_BUDGET, value);
}
