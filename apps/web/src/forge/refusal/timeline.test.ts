import { describe, expect, it } from 'vitest';
import { captionPose, FORGE_MOOD_DURATION, forgeMoodPhase } from './timeline';

describe('forge mood timing', () => {
  it('moves through one short beat and clears its caption before settling', () => {
    expect([0.1, 0.5, 1.2, 2.6, FORGE_MOOD_DURATION].map(forgeMoodPhase))
      .toEqual(['anticipation', 'cough', 'sulk', 'recovery', 'settled']);
    expect(captionPose(0.2).visible).toBe(false);
    expect(captionPose(1.2)).toMatchObject({ visible: true, opacity: 1 });
    expect(captionPose(3.4).visible).toBe(false);
    expect(FORGE_MOOD_DURATION).toBeLessThanOrEqual(4);
  });
});
