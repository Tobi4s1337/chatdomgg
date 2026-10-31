import type { EmoteVoxelFrame } from '../types';

/**
 * Which frame of an emote shows at `elapsedMs` (caller time, never a clock or a frame counter).
 * Frames keep their own normalized durations, so variable timing plays as authored and the same
 * elapsed time always selects the same frame in review, on stream and in a replay. A static emote
 * (one frame, period 0) always returns frame 0. Negative or non-finite times start the loop.
 */
export function sampleEmoteFrame<F extends Pick<EmoteVoxelFrame, 'durationMs'>>(visual: { frames: readonly F[]; periodMs: number }, elapsedMs: number): { index: number; frame: F } {
  const frames = visual.frames;
  if (!frames.length) throw new Error('An emote has at least one frame.');
  if (frames.length === 1 || !(visual.periodMs > 0)) return { index: 0, frame: frames[0]! };
  let t = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs % visual.periodMs : 0;
  for (let index = 0; index < frames.length; index++) {
    const duration = frames[index]!.durationMs;
    if (t < duration) return { index, frame: frames[index]! };
    t -= duration;
  }
  return { index: frames.length - 1, frame: frames[frames.length - 1]! };
}
