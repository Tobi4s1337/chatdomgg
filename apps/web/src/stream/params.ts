import type { KingdomTier } from '@chatdom/world';
import type { CameraName } from '../kingdom/scene';

export type StreamLayout = 'stage' | 'window' | 'strip';
export type StreamMood = 'calm' | 'show';
export type StreamSeam = 'starting' | 'break' | 'ending';
export type StreamSource = 'simulated' | 'herald';
/** The composition rectangle on the stage, in percent of the output: x, y, width, height. */
export type SafeArea = readonly [number, number, number, number];

/** Named rectangles the preview offers: room left for a chat column, a camera column or a lower band. */
export const SAFE_PRESETS = {
  full: null,
  chat: [0, 0, 74, 100],
  camera: [26, 0, 74, 100],
  band: [0, 0, 100, 78],
} as const satisfies Record<string, SafeArea | null>;

export interface StreamParams {
  layout: StreamLayout;
  mood: StreamMood;
  seam: StreamSeam | null;
  preview: boolean;
  /** Stage only: where the kingdom and its captions sit, leaving the rest of the source clear. */
  safe: SafeArea | null;
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
    safe: layout === 'stage' ? parseSafeArea(query.get('safe')) : null,
    seed,
    tier: query.get('tier') === 'hamlet' ? 'hamlet' : 'town',
    hour: Number.isFinite(rawHour) ? ((rawHour % 24) + 24) % 24 : 19.5,
    time: query.has('time') && Number.isFinite(rawTime) ? Math.max(0, Math.min(3600, rawTime)) : null,
    // The small formats are close views of a window and its street; the stage may hold any supported shot.
    camera: layout !== 'stage' ? 'window' : pick(query.get('camera'), ['hero', 'window', 'citizen'] as const, 'hero'),
    source: query.get('source') === 'simulated' ? 'simulated' : 'herald',
    presenceOrigin: query.get('presenceOrigin') === 'simulated' ? 'simulated' : 'live',
    kingdomName: query.get('source') !== 'simulated' && !query.has('seed')
      ? 'Kingdom'
      : seed.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
  };
}

/**
 * `safe=x,y,w,h` in percent of the output. A rectangle that leaves the frame or would
 * squeeze the kingdom below a third of either side is ignored rather than guessed at.
 */
export function parseSafeArea(raw: string | null): SafeArea | null {
  if (!raw) return null;
  if (raw in SAFE_PRESETS) return SAFE_PRESETS[raw as keyof typeof SAFE_PRESETS];
  const parts = raw.split(',').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isFinite(part))) return null;
  const [x, y, w, h] = parts as [number, number, number, number];
  if (x < 0 || y < 0 || w < 33 || h < 33 || x + w > 100.001 || y + h > 100.001) return null;
  if (x === 0 && y === 0 && w >= 100 && h >= 100) return null;
  return [x, y, w, h];
}

export function safeAreaName(safe: SafeArea | null): keyof typeof SAFE_PRESETS | null {
  for (const [name, area] of Object.entries(SAFE_PRESETS)) {
    if (area === safe || (area && safe && area.every((value, i) => value === safe[i]))) return name as keyof typeof SAFE_PRESETS;
  }
  return null;
}
