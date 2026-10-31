/** Dates in the book are UTC days: the witnessed day, the same for every reader in every timezone. */
const long = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
const month = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const short = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });

/** "12 October 2026" */
export const longDate = (ms: number) => long.format(ms);
/** "October 2026", the running head over a page of stamps. */
export const monthOf = (ms: number) => month.format(ms);
/** "12 OCT 2026", the date cut into a stamp's ring. Decorative: the caption always carries the long date. */
export const stampDate = (ms: number) => short.format(ms).replace(/\.$/, '').replace(/Sept/, 'Sep').toUpperCase();
/** "2026-10-12" for `<time datetime>`. */
export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** "October 2026" or "September – October 2026": the months a page of stamps spans, newest first as supplied. */
export function monthSpan(times: readonly number[]): string {
  if (times.length === 0) return '';
  const months = [...new Set(times.map(monthOf))];
  if (months.length === 1) return months[0]!;
  const first = months[months.length - 1]!, last = months[0]!;
  const [firstMonth, firstYear] = first.split(' '), [lastMonth, lastYear] = last.split(' ');
  return firstYear === lastYear ? `${firstMonth} – ${lastMonth} ${lastYear}` : `${first} – ${last}`;
}

/** The first visible character of a name for a monogram, whole even for combining marks and emoji. */
export function initialOf(name: string): string {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  for (const { segment } of segmenter.segment(name.trim())) return segment.toLocaleUpperCase();
  return '';
}

/** The printed page number: the flyleaf is page 1, as the reader counts them. */
export const folio = (index: number) => String(index + 1);
