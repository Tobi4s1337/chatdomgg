import { expect, it } from 'vitest';
import { initialOf, isoDay, longDate, monthSpan, stampDate } from './format';

it('writes the witnessed UTC day, whatever the reader’s timezone', () => {
  const lateNight = Date.UTC(2026, 9, 12, 23, 30);
  expect(longDate(lateNight)).toBe('12 October 2026');
  expect(isoDay(lateNight)).toBe('2026-10-12');
  expect(stampDate(lateNight)).toBe('12 OCT 2026');
  expect(stampDate(Date.UTC(2026, 8, 3))).toBe('03 SEP 2026');
});

it('heads a page with the months its stamps span, newest first as supplied', () => {
  expect(monthSpan([Date.UTC(2026, 9, 20), Date.UTC(2026, 9, 2)])).toBe('October 2026');
  expect(monthSpan([Date.UTC(2026, 9, 2), Date.UTC(2026, 8, 20)])).toBe('September – October 2026');
  expect(monthSpan([Date.UTC(2026, 0, 2), Date.UTC(2025, 11, 20)])).toBe('December 2025 – January 2026');
  expect(monthSpan([])).toBe('');
});

it('takes a whole first character for a monogram, including non-Latin names', () => {
  expect(initialOf('linnet')).toBe('L');
  expect(initialOf('Ысолта')).toBe('Ы');
  expect(initialOf('霧の港')).toBe('霧');
  expect(initialOf('  é-clair')).toBe('É');
});
