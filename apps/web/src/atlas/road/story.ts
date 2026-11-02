import { roadFaded } from './network';

/**
 * The words a remembered road says of itself. A count is what was witnessed; a road the raid watch never saw is
 * "not seen since", never "no raids", because the watch began on a known day and follows only so many channels.
 * Dates are survey dates, in UTC.
 */

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' });
const NUMBER = new Intl.NumberFormat('en-GB');

/** "30 October", or "30 October 2025" outside the year of `now`. */
export function dayMonth(at: number, now = Date.now()): string {
  const date = new Date(at);
  const year = date.getUTCFullYear();
  return `${date.getUTCDate()} ${MONTH.format(date)}${year === new Date(now).getUTCFullYear() ? '' : ` ${year}`}`;
}

const raids = (n: number) => `${NUMBER.format(n)} ${n === 1 ? 'raid' : 'raids'}`;

export interface StoryFacts {
  raids: number;
  firstAt: number | null;
  lastAt: number | null;
  basis: 'observations' | 'at-least' | 'none';
}

/** "7 raids since 30 October", "At least 7 raids, the last on 1 November", "1 raid on 31 October". */
export function roadStory(road: StoryFacts, now = Date.now()): string {
  if (road.basis === 'none' || road.raids < 1 || road.lastAt === null) return 'No raid seen yet';
  if (road.basis === 'observations' && road.firstAt !== null) {
    if (road.raids === 1) return `1 raid on ${dayMonth(road.firstAt, now)}`;
    return `${raids(road.raids)} since ${dayMonth(road.firstAt, now)}`;
  }
  return `At least ${raids(road.raids)}, the last on ${dayMonth(road.lastAt, now)}`;
}

/** A second line for a road unused for a season: it fades to dotted, and says since when. */
export function roadRest(lastAt: number | null, now = Date.now()): string | null {
  return lastAt !== null && roadFaded(lastAt, now) ? `Unused since ${dayMonth(lastAt, now)}` : null;
}

/** What may be said of two channels (or one) with no witnessed raid: since when the watch has looked. */
export function roadSilence(since: number, now = Date.now(), who = 'between them'): string {
  return `No raid ${who} seen since ${dayMonth(since, now)}`;
}

/** "3 sent · 4 received" from one end's point of view. */
export function roadWays(sent: number, received: number): string {
  return [sent ? `${NUMBER.format(sent)} sent` : '', received ? `${NUMBER.format(received)} received` : ''].filter(Boolean).join(' · ');
}
