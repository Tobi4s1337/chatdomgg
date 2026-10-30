import type { KingdomTier } from '@chatdom/world';
import type { CameraName } from '../kingdom/scene';
import { KingdomIdSchema, type KingdomId } from '@chatdom/shared';

export interface KingdomPresentationParams {
  firstYear: number;
  year: number;
  kingdomId?: KingdomId;
  focusSlot?: number;
}

/** Public presentation coordinates only; none of these grant ownership or identity. */
export function parseKingdomPresentationParams(query: URLSearchParams, tier: KingdomTier): KingdomPresentationParams {
  const fallbackFirst = tier === 'hamlet' ? 2025 : 2022;
  const parseYear = (raw: string | null, fallback: number) => raw !== null && /^[1-9][0-9]{3}$/.test(raw) ? Number(raw) : fallback;
  let firstYear = parseYear(query.get('firstYear'), fallbackFirst), year = parseYear(query.get('year'), 2026);
  if (year < firstYear || year - firstYear > 30) { firstYear = fallbackFirst; year = 2026; }
  const kingdom = KingdomIdSchema.safeParse(query.get('kingdom'));
  const rawSlot = query.get('focusSlot') ?? query.get('slot');
  const focusSlot = rawSlot !== null && /^(0|[1-9][0-9]{0,4})$/.test(rawSlot) && Number(rawSlot) <= 65534 ? Number(rawSlot) : undefined;
  return { firstYear, year, ...(kingdom.success ? { kingdomId: kingdom.data } : {}), ...(focusSlot !== undefined ? { focusSlot } : {}) };
}

export type StreamLayout = 'stage' | 'window' | 'strip';
export type StreamMood = 'calm' | 'show';
export type StreamSeam = 'starting' | 'break' | 'ending';
export type StreamSource = 'simulated' | 'herald';

export interface StreamParams extends KingdomPresentationParams {
  layout: StreamLayout;
  mood: StreamMood;
  seam: StreamSeam | null;
  preview: boolean;
  /** Renderer parameters, passed through unchanged in meaning from the kingdom route. */
  seed: string;
  tier: KingdomTier;
  hour: number;
  time: number | null;
  camera: CameraName;
  source: StreamSource;
  presenceOrigin: 'live' | 'simulated';
  /** The kingdom's own name, never a brand. */
  kingdomName: string;
}

function pick<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(raw as T) ? raw as T : fallback;
}

/**
 * Unknown values fall back to the calm defaults. A bare `/stream` asks for the real
 * kingdom: only an explicit `source=simulated` selects the demonstration night, so an
 * OBS source never presents a fixture as tonight's kingdom without saying so.
 */
export function parseStreamParams(search: string): StreamParams {
  const query = new URLSearchParams(search);
  const layout = pick(query.get('layout'), ['stage', 'window', 'strip'] as const, 'stage');
  const rawHour = Number(query.get('hour') ?? 19.5), rawTime = Number(query.get('time'));
  const seed = /^[a-z][a-z0-9_-]{0,39}$/i.test(query.get('seed') ?? '') ? query.get('seed')!.toLowerCase() : 'willowmere';
  const tier = query.get('tier') === 'hamlet' ? 'hamlet' : 'town';
  return {
    ...parseKingdomPresentationParams(query, tier),
    layout,
    mood: pick(query.get('mood'), ['calm', 'show'] as const, 'calm'),
    seam: (['starting', 'break', 'ending'] as const).find(seam => seam === query.get('seam')) ?? null,
    preview: query.get('preview') === '1',
    seed,
    tier,
    hour: Number.isFinite(rawHour) ? ((rawHour % 24) + 24) % 24 : 19.5,
    time: query.has('time') && Number.isFinite(rawTime) ? Math.max(0, Math.min(3600, rawTime)) : null,
    // Small formats stay at a window; the stage may also follow its citizen.
    camera: layout !== 'stage' ? 'window' : pick(query.get('camera'), ['hero', 'window', 'citizen'] as const, 'hero'),
    source: query.get('source') === 'simulated' ? 'simulated' : 'herald',
    presenceOrigin: query.get('presenceOrigin') === 'simulated' ? 'simulated' : 'live',
    kingdomName: query.get('source') !== 'simulated' && !query.has('seed')
      ? 'Kingdom'
      : seed.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
  };
}
