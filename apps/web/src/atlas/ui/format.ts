/** Wording and numbers for the Atlas surfaces. Dates are survey dates, so they are given in UTC and say so. */
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });
const NUMBER = new Intl.NumberFormat('en-GB');

export function formatCount(value: number): string {
  return NUMBER.format(Math.round(value));
}

function parts(at: number): { day: number; month: string; year: number } {
  const date = new Date(at);
  return { day: date.getUTCDate(), month: MONTH.format(date), year: date.getUTCFullYear() };
}

/** "30 Oct 2026" */
export function formatDay(at: number): string {
  const p = parts(at);
  return `${p.day} ${p.month} ${p.year}`;
}

/** "30 Oct 2026, 01:59 UTC" */
export function formatMoment(at: number): string {
  const date = new Date(at);
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${formatDay(at)}, ${hh}:${mm} UTC`;
}

/** "29–30 Oct 2026", "30 Oct – 2 Nov 2026", "30 Dec 2026 – 2 Jan 2027", or one day. */
export function formatDayRange(from: number, to: number): string {
  const a = parts(from);
  const b = parts(to);
  if (a.year !== b.year) return `${formatDay(from)} – ${formatDay(to)}`;
  if (a.month !== b.month) return `${a.day} ${a.month} – ${b.day} ${b.month} ${b.year}`;
  if (a.day !== b.day) return `${a.day}–${b.day} ${b.month} ${b.year}`;
  return formatDay(to);
}

/** "9.7 hours", "1 hour", "3 days" */
export function formatSpan(hours: number): string {
  if (hours >= 48) return `${Math.floor(hours / 24)} days`;
  const rounded = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10;
  return `${rounded} ${rounded === 1 ? 'hour' : 'hours'}`;
}

/** The average gap between sweeps, rounded to whole minutes ("every 3 minutes"). */
export function sweepCadence(hours: number, sweeps: number): string | null {
  if (sweeps < 2 || hours <= 0) return null;
  const minutes = Math.max(1, Math.round((hours * 60) / (sweeps - 1)));
  return minutes === 1 ? 'every minute' : `every ${minutes} minutes`;
}

export const TIER_NAMES = ['Capital', 'City', 'Town', 'Village'] as const;

/** Twitch logins are lower-case ASCII letters, digits and underscores; anything else gets no link. */
export function watchUrl(login: string): string | null {
  return /^[a-z0-9_]{1,25}$/.test(login) ? `https://www.twitch.tv/${login}` : null;
}

/** A tidy distance for the scale bar: 1, 2 or 5 times a power of ten, between `minPx` and `maxPx` long. */
export function scaleBar(pxPerUnit: number, minPx = 56, maxPx = 140): { units: number; px: number } {
  const target = minPx / pxPerUnit;
  const power = 10 ** Math.floor(Math.log10(target));
  for (const step of [1, 2, 5, 10]) {
    const units = step * power;
    const px = units * pxPerUnit;
    if (px >= minPx && px <= maxPx) return { units, px };
  }
  const units = 10 * power;
  return { units, px: units * pxPerUnit };
}
