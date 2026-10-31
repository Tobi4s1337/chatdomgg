/** What a bench URL asks for. Every capture passes these explicitly so shots compare run to run. */
export const BENCH_VIEWS = ['front', 'side', 'banner'] as const;
export type BenchView = typeof BENCH_VIEWS[number];

export interface EmoteBenchState {
  readonly view: BenchView;
  /** Authored hour of the kingdom's light, 0–23. */
  readonly hour: number;
}

export const DEFAULT_BENCH: EmoteBenchState = { view: 'front', hour: 16 };

/** Unknown or malformed values fall back to the default rather than guessing what was meant. */
export function parseEmoteBench(search: string): EmoteBenchState {
  const query = new URLSearchParams(search);
  const view = query.get('view'), hour = query.get('hour');
  const parsedHour = hour !== null && /^\d{1,2}$/.test(hour) ? Number(hour) : NaN;
  return {
    view: BENCH_VIEWS.includes(view as BenchView) ? view as BenchView : DEFAULT_BENCH.view,
    hour: parsedHour >= 0 && parsedHour <= 23 ? parsedHour : DEFAULT_BENCH.hour,
  };
}
