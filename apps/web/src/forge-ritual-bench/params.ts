import type { StyleKey } from '@chatdom/content';
import { FORGE_RITUAL_SECONDS } from '@chatdom/forge';
import type { HousePartPlan } from '@chatdom/shared';

export type BenchPart = HousePartPlan['kind'];
export interface RitualBenchState {
  part: BenchPart;
  family: StyleKey;
  hour: number;
  /** Seek to this ritual second and pause; absent means play from the start. */
  t: number | null;
  /** Simulated gate: the reported phase holds here while time keeps passing. */
  gate: number | null;
  motion: 'system' | 'reduce' | 'full';
}

/** The authored local wishes the bench forges; the grammar parses them, the bench never models geometry. */
export const BENCH_WISHES: Record<BenchPart, string> = {
  chimney: '!forge a chimney shaped like a sleeping dragon',
  lantern: '!forge a crescent moon lantern',
  weathervane: '!forge an owl weathervane',
};

/** The whole simulated ceremony, words to landed. */
export const RITUAL_SECONDS = FORGE_RITUAL_SECONDS;

const pick = <T extends string>(params: URLSearchParams, name: string, allowed: readonly T[], fallback: T): T => {
  const raw = params.get(name);
  if (raw === null) return fallback;
  if (!(allowed as readonly string[]).includes(raw)) throw new Error(`Unknown ${name} "${raw}". Choose ${allowed.join(', ')}.`);
  return raw as T;
};
const seconds = (params: URLSearchParams, name: string, max: number): number | null => {
  const raw = params.get(name);
  if (raw === null) return null;
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(value) || value < 0 || value > max) throw new Error(`${name} must be seconds between 0 and ${max}.`);
  return value;
};

/** Every review input is finite and known; anything else fails visibly. */
export function parseRitualBench(search: string): RitualBenchState {
  const params = new URLSearchParams(search);
  const known = new Set(['part', 'family', 'hour', 't', 'gate', 'motion']);
  for (const key of params.keys()) if (!known.has(key)) throw new Error(`Unknown bench input "${key}".`);
  const hour = params.has('hour') ? Number(params.get('hour')) : 19.5;
  if (!Number.isFinite(hour) || hour < 0 || hour >= 24) throw new Error('hour must be between 0 and 24.');
  return {
    part: pick(params, 'part', ['chimney', 'lantern', 'weathervane'] as const, 'chimney'),
    family: pick(params, 'family', ['hearth', 'tide', 'grove'] as const, 'hearth'),
    hour,
    t: seconds(params, 't', 3600),
    gate: seconds(params, 'gate', RITUAL_SECONDS),
    motion: pick(params, 'motion', ['system', 'reduce', 'full'] as const, 'system'),
  };
}
