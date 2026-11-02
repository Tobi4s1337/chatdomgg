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
export type StreamSource = 'simulated' | 'herald' | 'realm';
/** The composition rectangle on the stage, in percent of the output: x, y, width, height. */
export type SafeArea = readonly [number, number, number, number];

/** Named rectangles the preview offers: room left for a chat column, a camera column or a lower band. */
export const SAFE_PRESETS = {
  full: null,
  chat: [0, 0, 74, 100],
  camera: [26, 0, 74, 100],
  band: [0, 0, 100, 78],
} as const satisfies Record<string, SafeArea | null>;

export interface StreamParams extends KingdomPresentationParams {
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
 * Public streams always require a founded realm receipt. Staged playback belongs
 * only to the explicit development bench; query strings cannot turn it on elsewhere.
 */
export function parseStreamParams(search: string, pathname = '/stream'): StreamParams {
  const query = new URLSearchParams(search);
  const source: StreamSource = pathname === '/-/stream' && query.get('source') !== 'realm' ? 'simulated' : 'realm';
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
    safe: layout === 'stage' ? parseSafeArea(query.get('safe')) : null,
    seed,
    tier,
    hour: Number.isFinite(rawHour) ? ((rawHour % 24) + 24) % 24 : 19.5,
    time: query.has('time') && Number.isFinite(rawTime) ? Math.max(0, Math.min(3600, rawTime)) : null,
    // The small formats are close views of a window and its street; the stage may hold any supported shot.
    camera: layout !== 'stage' ? 'window' : pick(query.get('camera'), ['hero', 'window', 'citizen'] as const, 'hero'),
    source,
    presenceOrigin: source === 'simulated' ? 'simulated' : 'live',
    kingdomName: source === 'realm'
      ? 'Kingdom'
      : seed.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
  };
}

/** Authoring controls preserve the source's route and never publish a fixture as a public stream. */
export function browserSourcePath(location: { pathname: string; search: string }, layout: StreamLayout, mood: StreamMood, seam: StreamSeam | null, safe: SafeArea | null): string {
  const query = new URLSearchParams(location.search);
  query.delete('preview');
  if (location.pathname !== '/-/stream') {
    query.set('source', 'realm');
    for (const key of ['presenceOrigin', 'dockFixture', 'forgeFixture', 'fixture']) query.delete(key);
  }
  for (const [key, value] of [['layout', layout === 'stage' ? null : layout], ['mood', mood === 'calm' ? null : mood],
    ['seam', layout === 'stage' ? seam : null], ['safe', layout === 'stage' && safe ? safeAreaName(safe) ?? safe.join(',') : null]] as const) {
    if (value) query.set(key, value); else query.delete(key);
  }
  const search = query.toString();
  return `${location.pathname}${search ? `?${search}` : ''}`;
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
