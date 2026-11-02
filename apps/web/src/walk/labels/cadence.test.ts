import { expect, it } from 'vitest';
import { createSpeechCadence, SPEECH_FRAME_STALE_MAX_MS, SPEECH_FRAME_STALE_MS } from './bus';

it('keeps a fast scene at the 400 ms floor', () => {
  const cadence = createSpeechCadence();
  for (let at = 0; at < 2_000; at += 16) cadence.heard(at);
  expect(cadence.staleAfter).toBe(SPEECH_FRAME_STALE_MS);
});

it('keeps a slow scene\'s last frame until well past its next one', () => {
  const cadence = createSpeechCadence();
  // A scene drawing about 0.7 frames a second, as headless software rendering does: every frame must still count
  // when the layer lays out just before the next one arrives.
  for (let at = 0; at < 20_000; at += 1_400) cadence.heard(at);
  expect(cadence.staleAfter).toBeGreaterThan(1_400 * 1.5);
  expect(cadence.staleAfter).toBeLessThanOrEqual(SPEECH_FRAME_STALE_MAX_MS);
});

it('never waits longer than 3 s for a scene that stopped, and starts over for a new scene', () => {
  const cadence = createSpeechCadence();
  cadence.heard(0); cadence.heard(60_000);
  expect(cadence.staleAfter).toBe(SPEECH_FRAME_STALE_MAX_MS);
  cadence.reset();
  expect(cadence.staleAfter).toBe(SPEECH_FRAME_STALE_MS);
  cadence.heard(100); cadence.heard(100);
  expect(cadence.staleAfter).toBe(SPEECH_FRAME_STALE_MS);
});
