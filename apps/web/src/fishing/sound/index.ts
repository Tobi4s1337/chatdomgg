import { PIER_RECIPES } from './cues';
import { PierGraph, type PierSoundReport } from './graph';
import { ambienceShape, clamp01, emptyAmbienceShape, emptyReelShape, emptyTensionShape, reelShape, tensionShape } from './law';
import type { PierAmbience, PierCue, PierCueOptions, PierSound, PierSoundHost } from './types';

export type { PierAmbience, PierCue, PierCueOptions, PierMood, PierSound, PierSoundHost } from './types';
export { PIER_CUES } from './types';
export type { PierSoundReport } from './graph';

const reports = new WeakMap<PierSound, () => PierSoundReport | null>();

/** What the pier is sounding right now, for the bench and checks; null before any sound has had a context. */
export function inspectPierSound(sound: PierSound): PierSoundReport | null {
  return reports.get(sound)?.() ?? null;
}

/**
 * The pier's sound through the kingdom's audio host, at the world volume. `host` is asked lazily on every call;
 * while it answers null (sound locked, muted or hidden) every call is a cheap no-op and the beds go quiet, and
 * they come back on their own when it answers again. `reel`, `tension` and `ambience` are made to be called every
 * animation frame: at rest they do not even ask the host, and when sounding they only move AudioParams.
 */
export function createPierSound(host: () => PierSoundHost | null): PierSound {
  let graph: PierGraph | null = null, disposed = false;
  const reelState = emptyReelShape(), tensionState = emptyTensionShape(), ambienceState = emptyAmbienceShape();

  /** The graph for the host's current context, made or remade as needed; null when nothing may sound. */
  function resolve(): PierGraph | null {
    if (disposed) return null;
    let current: PierSoundHost | null;
    try { current = host(); } catch { current = null; }
    if (!current) { graph?.sleep(); graph?.settle(); return null; }
    if (graph && (graph.context !== current.context || (current.context.state as string) === 'closed')) { graph.dispose(); graph = null; }
    if ((current.context.state as string) === 'closed') return null;
    if (!graph) graph = new PierGraph(current.context, current.destination);
    else graph.retarget(current.destination);
    // A suspended context would queue sound and play it late; nothing is scheduled until it runs again.
    if (current.context.state !== 'running') { graph.sleep(); return null; }
    return graph;
  }

  const sound: PierSound = {
    cue(kind: PierCue, options?: PierCueOptions): void {
      const recipe = PIER_RECIPES[kind];
      if (!recipe) return;
      resolve()?.play(kind, recipe, options);
    },

    reel(rate: number): void {
      if (disposed) return;
      const r = clamp01(rate);
      if (r === 0 && !graph?.reelBed.live) { graph?.settle(); return; }
      const live = resolve();
      if (!live) return;
      const now = live.context.currentTime;
      if (r > 0) live.wake();
      if (live.reelBed.drive(r > 0, now)) live.reelBed.set(reelShape(r, reelState), now);
      live.settle(now);
    },

    tension(value: number): void {
      if (disposed) return;
      const t = clamp01(value);
      if (t === 0 && !graph?.tensionBed.live) { graph?.settle(); return; }
      const live = resolve();
      if (!live) return;
      const now = live.context.currentTime;
      if (t > 0) live.wake();
      if (live.tensionBed.drive(t > 0, now)) live.tensionBed.set(tensionShape(t, tensionState), now);
      live.settle(now);
    },

    ambience(value: PierAmbience): void {
      if (disposed || !value) return;
      const near = clamp01(value.near);
      if (near === 0 && !graph?.ambienceLive) { graph?.settle(); return; }
      const live = resolve();
      if (!live) return;
      const now = live.context.currentTime, shape = ambienceShape(near, value.mood, value.hour, ambienceState);
      if (near > 0) live.wake();
      if (live.lap.drive(shape.lap > 0, now)) live.lap.set(shape, now);
      if (live.rain.drive(shape.rain > 0, now)) live.rain.set(shape, now);
      if (live.breeze.drive(shape.breeze > 0, now)) live.breeze.set(shape, now);
      if (live.mist.drive(shape.mist > 0, now)) live.mist.set(shape, now);
      if (live.lantern.drive(shape.lantern > 0, now)) live.lantern.set(shape, now);
      live.settle(now);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      graph?.dispose();
      graph = null;
    },
  };
  reports.set(sound, () => graph?.report() ?? null);
  return sound;
}
