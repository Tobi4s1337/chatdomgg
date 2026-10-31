/** The four primary views, plus `anvil-mark`: the cheek face-on, for comparison with the official SVG. */
export const BENCH_VIEWS = ['anvil-close', 'anvil-square', 'dragon-close', 'dragon-square', 'anvil-mark'] as const;
export type BenchView = typeof BENCH_VIEWS[number];
/** Views whose geometry exists. The others fail visibly rather than showing an old stand-in. */
export const BUILT_VIEWS: readonly BenchView[] = ['anvil-close', 'anvil-square', 'dragon-close', 'dragon-square', 'anvil-mark'];
export const BENCH_STYLES = ['hearth', 'tide', 'grove'] as const;
export type BenchStyle = typeof BENCH_STYLES[number];

export interface BenchState {
  view: BenchView;
  style: BenchStyle;
  hour: number;
  heat: number;
  time: number;
  /** The ritual's shaping flag, fed unchanged to the anvil and the engraving. */
  shaping: boolean;
}

const pick = <T extends string>(params: URLSearchParams, name: string, allowed: readonly T[], fallback: T): T => {
  const raw = params.get(name);
  if (raw === null) return fallback;
  if (!(allowed as readonly string[]).includes(raw)) throw new Error(`Unknown ${name} "${raw}". Choose ${allowed.join(', ')}.`);
  return raw as T;
};

/** Every bench input is finite and named; anything else is refused instead of quietly defaulted. */
export function parseBench(search: string): BenchState {
  const params = new URLSearchParams(search);
  const known = new Set(['view', 'style', 'hour', 'heat', 'time', 'shaping']);
  for (const key of params.keys()) if (!known.has(key)) throw new Error(`Unknown bench input "${key}". Use view, style, hour, heat, time or shaping.`);
  for (const key of known) if (params.getAll(key).length > 1) throw new Error(`Give ${key} once.`);
  const view = pick(params, 'view', BENCH_VIEWS, 'anvil-close');
  if (!BUILT_VIEWS.includes(view)) throw new Error(`The ${view} view is not carved yet. Choose ${BUILT_VIEWS.join(', ')}.`);
  const style = pick(params, 'style', BENCH_STYLES, 'hearth');
  const hour = params.get('hour') ?? '19';
  if (!/^(?:1?\d|2[0-3])$/.test(hour)) throw new Error(`Unknown hour "${hour}". Choose a whole hour 0..23.`);
  const heat = params.get('heat') ?? '0';
  if (!/^(?:[01](?:\.\d+)?|\.\d+)$/.test(heat) || Number(heat) > 1) throw new Error(`Unknown heat "${heat}". Choose a number from 0 to 1.`);
  const time = params.get('time') ?? '0';
  if (!/^\d{1,5}(?:\.\d+)?$/.test(time)) throw new Error(`Unknown time "${time}". Choose seconds from 0.`);
  const shaping = params.get('shaping') ?? '0';
  if (shaping !== '0' && shaping !== '1') throw new Error(`Unknown shaping "${shaping}". Choose 0 or 1.`);
  return { view, style, hour: Number(hour), heat: Number(heat), time: Number(time), shaping: shaping === '1' };
}
