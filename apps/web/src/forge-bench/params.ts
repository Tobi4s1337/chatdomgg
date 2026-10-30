import { FORGE_FAMILIES, type ForgeFamilyId } from '../../../../packages/content/src/forge';

export type ForgeView = 'assembly' | 'door' | 'window';
export interface ForgeBenchState {
  family: ForgeFamilyId;
  view: ForgeView;
  door: 'open' | 'closed';
  presence: 'off' | 'on';
  hour: number;
}

const pick = <T extends string>(params: URLSearchParams, name: string, allowed: readonly T[], fallback: T): T => {
  const raw = params.get(name);
  if (raw === null) return fallback;
  if (!(allowed as readonly string[]).includes(raw)) throw new Error(`Unknown ${name} "${raw}". Choose ${allowed.join(', ')}.`);
  return raw as T;
};

/** Every review input is finite; anything else fails visibly instead of falling back to a default family. */
export function parseForgeBench(search: string): ForgeBenchState {
  const params = new URLSearchParams(search);
  const known = new Set(['family', 'view', 'door', 'presence', 'hour', 'seed']);
  for (const key of params.keys()) if (!known.has(key)) throw new Error(`Unknown review input "${key}".`);
  const family = pick(params, 'family', FORGE_FAMILIES, 'hearthfold');
  const view = pick(params, 'view', ['assembly', 'door', 'window'] as const, 'assembly');
  const door = pick(params, 'door', ['open', 'closed'] as const, 'open');
  const presence = pick(params, 'presence', ['off', 'on'] as const, 'off');
  const rawHour = params.get('hour') ?? '19';
  if (!/^(?:1?\d|2[0-3])$/.test(rawHour)) throw new Error(`Unknown hour "${rawHour}". Choose a whole hour 0..23.`);
  if (presence === 'on' && view !== 'window') throw new Error('Window presence is reviewed only in the window view, where it is labelled SIMULATED.');
  return { family, view, door, presence, hour: Number(rawHour) };
}
