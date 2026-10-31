/** What a bench URL asks for. Every capture passes these explicitly so shots compare run to run. */
/** `kingdom` raises the approved statue and standards in a lit town square; the rest are the workshop's close views. */
export const BENCH_VIEWS = ['kingdom', 'front', 'side', 'banner'] as const;
export type BenchView = typeof BENCH_VIEWS[number];
/** The workshop's close views of the statue and banner on the bench plaza. */
export type WorkshopView = Exclude<BenchView, 'kingdom'>;

export interface EmoteBenchState {
  readonly view: BenchView;
  /** Authored hour of the kingdom's light, 0–23. */
  readonly hour: number;
  /** A held animation frame for captures; null plays the emote with its own timing. */
  readonly frame: number | null;
}

export const DEFAULT_BENCH: EmoteBenchState = { view: 'front', hour: 16, frame: null };

/** Unknown or malformed values fall back to the default rather than guessing what was meant. */
export function parseEmoteBench(search: string): EmoteBenchState {
  const query = new URLSearchParams(search);
  const view = query.get('view'), hour = query.get('hour'), frame = query.get('frame');
  const parsedHour = hour !== null && /^\d{1,2}$/.test(hour) ? Number(hour) : NaN;
  const parsedFrame = frame !== null && /^\d{1,3}$/.test(frame) ? Number(frame) : NaN;
  return {
    view: BENCH_VIEWS.includes(view as BenchView) ? view as BenchView : DEFAULT_BENCH.view,
    hour: parsedHour >= 0 && parsedHour <= 23 ? parsedHour : DEFAULT_BENCH.hour,
    frame: parsedFrame >= 0 && parsedFrame < 120 ? parsedFrame : DEFAULT_BENCH.frame,
  };
}
