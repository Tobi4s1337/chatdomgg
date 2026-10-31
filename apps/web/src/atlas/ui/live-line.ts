import type { LiveStatus } from '../live/feed';
import { formatCount, formatTime } from './format';

/** Live classes by average audience (R8): what a pennant says about the holding flying it. */
export const LIVE_CLASS_NAMES = ['', 'double long pennant', 'long pennant', 'medium pennant', 'short pennant', 'pencil flag'] as const;

export interface LiveSummary {
  status: LiveStatus;
  /** Holdings on air and small streams pencilled in, from the frame shown. */
  holdings: number;
  dabs: number;
}

/**
 * The live seal under the title: when the vermilion on the map was observed, and whether that is still the present.
 * A held (stale, skewed or incomplete) view says so and keeps its own time; it never claims to be now.
 */
export function liveLine(summary: LiveSummary): { tone: 'fresh' | 'held' | 'quiet'; text: string } {
  const { status } = summary;
  const asOf = status.frameAsOf;
  if (asOf === null) {
    if (status.refused === 'alignment') return { tone: 'quiet', text: 'Live paint is being redrawn for this survey.' };
    if (status.refused === 'unreachable' || status.refused === 'corrupt') return { tone: 'quiet', text: 'Who is on air could not be read just now.' };
    const state = status.source?.state;
    if (state && state !== 'complete') return { tone: 'quiet', text: 'No complete sweep of who is on air has been observed yet.' };
    return { tone: 'quiet', text: 'Reading who is on air…' };
  }
  const when = formatTime(asOf);
  const counts = `${formatCount(summary.holdings)} holdings and ${formatCount(summary.dabs)} small streams on air`;
  if (status.freshness === 'stale') return { tone: 'held', text: `Live as of ${when}. The surveyors are late; the map holds that sweep.` };
  if (status.freshness === 'clock-skew') return { tone: 'held', text: `Live as of ${when}. This device’s clock disagrees with the survey; the map holds that sweep.` };
  const source = status.source?.state;
  if (source && source !== 'complete' && status.source?.sweepAt && status.source.sweepAt > asOf) {
    return { tone: 'held', text: `Live as of ${when}: the latest sweep was incomplete, so the map holds the last whole one.` };
  }
  return { tone: 'fresh', text: `Live as of ${when} · ${counts}` };
}
