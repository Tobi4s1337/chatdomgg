import type { KingdomTier } from '@chatdom/world';
import type { CameraName } from '../kingdom/scene';

export type StreamLayout = 'stage' | 'window' | 'strip';
export type StreamMood = 'calm' | 'show';
export type StreamSeam = 'starting' | 'break' | 'ending';
export type StreamSource = 'simulated' | 'herald';

export interface StreamParams {
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
  const seed = /^[a-z][a-z0-9-]{0,39}$/i.test(query.get('seed') ?? '') ? query.get('seed')!.toLowerCase() : 'willowmere';
  return {
    layout,
    mood: pick(query.get('mood'), ['calm', 'show'] as const, 'calm'),
    seam: (['starting', 'break', 'ending'] as const).find(seam => seam === query.get('seam')) ?? null,
    preview: query.get('preview') === '1',
    seed,
    tier: query.get('tier') === 'hamlet' ? 'hamlet' : 'town',
    hour: Number.isFinite(rawHour) ? ((rawHour % 24) + 24) % 24 : 19.5,
    time: query.has('time') && Number.isFinite(rawTime) ? Math.max(0, Math.min(3600, rawTime)) : null,
    // The small formats are close views of a window and its street; the stage may hold either shot.
    camera: layout !== 'stage' ? 'window' : query.get('camera') === 'window' ? 'window' : 'hero',
    source: query.get('source') === 'simulated' ? 'simulated' : 'herald',
    presenceOrigin: query.get('presenceOrigin') === 'simulated' ? 'simulated' : 'live',
    kingdomName: query.get('source') !== 'simulated' && !query.has('seed')
      ? 'Kingdom'
      : seed.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
  };
}
