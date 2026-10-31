import { createGenesisSoundscapeGraph, inspectGenesisSoundscape, type GenesisSoundInspection, type GenesisSoundscape } from './soundscape';
import type { GenesisRecipe, GenesisSoundFrame, GenesisSoundMix } from './types';

/**
 * Renders the land through exactly the live layer, beds, calls and mix in an OfflineAudioContext. `frame(t)` is
 * asked for every host frame (default 30 a second), as a render loop would; `at` lets a script mute, duck, select
 * another landscape or change profile at a moment. The destination stands in for the kingdom master at `master`
 * (default 0.4225, the kingdom's default volume 0.65 squared), so levels read as they would in the kingdom.
 * For the bench, the listening renders and the checks; consumers only need `createGenesisSoundscape`.
 */
export interface GenesisRenderOptions {
  recipe: GenesisRecipe;
  landscapeId: string;
  duration: number;
  frame(t: number): GenesisSoundFrame | null;
  sampleRate?: number;
  fps?: number;
  master?: number;
  mix?: Partial<GenesisSoundMix>;
  at?: readonly { t: number; run(soundscape: GenesisSoundscape): void }[];
  /** Seconds at which to take an inspection snapshot. */
  inspectAt?: readonly number[];
}

export interface GenesisRender {
  buffer: AudioBuffer;
  inspections: { t: number; inspection: GenesisSoundInspection }[];
}

export async function renderGenesisSoundscape(options: GenesisRenderOptions): Promise<GenesisRender> {
  const rate = options.sampleRate ?? 48000, fps = options.fps ?? 30;
  if (!(options.duration > 0 && options.duration <= 600)) throw new RangeError('genesis sound: render 0–600 s');
  const context = new OfflineAudioContext(2, Math.ceil(options.duration * rate), rate);
  const destination = context.createGain();
  destination.gain.value = options.master ?? 0.4225;
  destination.connect(context.destination);
  const soundscape = createGenesisSoundscapeGraph({ context, destination }, { recipe: options.recipe, landscapeId: options.landscapeId }, true);
  if (options.mix) soundscape.setMix(options.mix);
  const quantum = 128 / rate, steps = new Map<number, (() => void)[]>();
  const add = (t: number, run: () => void) => {
    const slot = Math.round(Math.ceil(t / quantum) * quantum * rate);
    if (slot / rate >= options.duration) return;
    steps.set(slot, [...(steps.get(slot) ?? []), run]);
  };
  const inspections: GenesisRender['inspections'] = [];
  let failure: unknown = null;
  for (const action of options.at ?? []) add(action.t, () => action.run(soundscape));
  for (let i = 1; i / fps < options.duration; i++) {
    const t = i / fps;
    add(t, () => { const frame = options.frame(t); if (frame) soundscape.update(frame); });
  }
  for (const t of options.inspectAt ?? []) add(t, () => inspections.push({ t, inspection: inspectGenesisSoundscape(soundscape) }));
  for (const [slot, runs] of steps) {
    void context.suspend(slot / rate).then(() => {
      for (const run of runs) { try { run(); } catch (error) { failure ??= error; } }
      void context.resume();
    });
  }
  const buffer = await context.startRendering();
  soundscape.dispose();
  if (failure) throw failure;
  return { buffer, inspections };
}
