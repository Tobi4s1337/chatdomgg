import { expect, it } from 'vitest';
import { SPEECH_MAX_HOLD_MS, speechHoldUntil, speechReadingMs } from './timing';

const text = (value: string) => [{ kind: 'text' as const, text: value }];

it('gives longer lines longer to read, within a cap, and never less than the server allows', () => {
  expect(speechReadingMs(text('hi'))).toBe(2_620);
  expect(speechReadingMs(text('a'.repeat(50)))).toBe(5_500);
  expect(speechReadingMs(text('a'.repeat(100)))).toBeGreaterThan(speechReadingMs(text('a'.repeat(50))));
  expect(speechReadingMs(text('a'.repeat(240)))).toBe(SPEECH_MAX_HOLD_MS);
  // An emote reads like a short word, not like its alt text.
  expect(speechReadingMs([{ kind: 'emote', id: '25', alt: 'Kappa' }])).toBe(2_740);
  // Characters, not UTF-16 units.
  expect(speechReadingMs(text('🌿🌿'))).toBe(2_620);
  const shown = 1_000;
  expect(speechHoldUntil({ parts: text('hi'), expiresAt: 9_000 }, shown)).toBe(9_000);
  expect(speechHoldUntil({ parts: text('a'.repeat(120)), expiresAt: 3_000 }, shown)).toBe(shown + 9_700);
  // Reading time counts from when the line was first seen, not from when it was sent.
  expect(speechHoldUntil({ parts: text('a'.repeat(120)), expiresAt: 3_000 }, 5_000)).toBe(14_700);
});
