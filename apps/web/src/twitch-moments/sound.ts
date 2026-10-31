import type { MomentCue } from './controller';
import type { MomentSoundPort } from './view';

/**
 * Original procedural cues behind the local sound port: no samples, recordings or downloaded audio. Main can map
 * the sound lane's mixer to the same port at integration. Times are kingdom milliseconds; `now()` maps them to
 * the audio clock. Cancelling stops every node of the cue, tails included.
 */
export interface ProceduralSoundOptions {
  readonly context: () => { context: AudioContext; destination: AudioNode } | null;
  /** Current kingdom time in ms. */
  readonly now: () => number;
  /** Mode-aware gain from the broadcast mix policy (0 when muted or hidden). */
  readonly gain: () => number;
}

/** Length of each cue including its tail, in ms. */
export const CUE_LENGTH_MS: Record<MomentCue, number> = { horn: 1700, 'cloth-unfurl': 2300 };

export function createProceduralMomentSound(options: ProceduralSoundOptions): MomentSoundPort & { readonly active: number } {
  const live = new Set<() => void>();
  let noise: AudioBuffer | null = null;

  function noiseBuffer(context: AudioContext): AudioBuffer {
    if (noise && noise.sampleRate === context.sampleRate) return noise;
    // Deterministic noise (LCG), so a cue sounds the same every time it plays.
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 2.5), context.sampleRate), data = buffer.getChannelData(0);
    let seed = 0x2f6b1a3d;
    for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; data[i] = seed / 2 ** 31 - 1; }
    noise = buffer;
    return buffer;
  }

  function horn(context: AudioContext, out: GainNode, t: number, nodes: AudioScheduledSourceNode[]): void {
    // A short brass call, a rising fourth: two voices (saw + square) through a filter that opens like a lip buzz.
    const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 2.2; filter.connect(out);
    const amp = context.createGain(); amp.gain.value = 0; amp.connect(filter);
    const notes: [number, number, number][] = [[293.66, 0, 0.3], [392, 0.32, 1.05]];
    filter.frequency.setValueAtTime(420, t);
    for (const [hz, at, length] of notes) {
      const start = t + at;
      amp.gain.setTargetAtTime(0.5, start, 0.03);
      filter.frequency.setTargetAtTime(hz * 6.5, start, 0.06);
      filter.frequency.setTargetAtTime(hz * 3.2, start + 0.12, 0.2);
      amp.gain.setTargetAtTime(at === 0 ? 0.18 : 0, start + length - (at === 0 ? 0.04 : 0.25), at === 0 ? 0.015 : 0.16);
      for (const [type, detune, level] of [['sawtooth', -4, 0.55], ['square', 5, 0.25], ['triangle', 0, 0.4]] as const) {
        const osc = context.createOscillator(), voice = context.createGain();
        osc.type = type; osc.frequency.value = type === 'triangle' ? hz / 2 : hz; osc.detune.value = detune; voice.gain.value = level;
        // A slow, slight vibrato on the held note only.
        if (at > 0) {
          const lfo = context.createOscillator(), depth = context.createGain();
          lfo.frequency.value = 5.2; depth.gain.setValueAtTime(0, start); depth.gain.linearRampToValueAtTime(6, start + 0.5);
          lfo.connect(depth); depth.connect(osc.detune); lfo.start(start); lfo.stop(start + length + 0.4); nodes.push(lfo);
        }
        osc.connect(voice); voice.connect(amp); osc.start(start); osc.stop(start + length + 0.5); nodes.push(osc);
      }
    }
  }

  function cloth(context: AudioContext, out: GainNode, t: number, nodes: AudioScheduledSourceNode[]): void {
    // Heavy cloth unrolling: band-limited noise that flutters fast then slows, and a soft knock as the roll lands.
    const source = context.createBufferSource(); source.buffer = noiseBuffer(context);
    const band = context.createBiquadFilter(); band.type = 'bandpass'; band.Q.value = 0.9;
    band.frequency.setValueAtTime(2400, t); band.frequency.exponentialRampToValueAtTime(700, t + 1.9);
    const amp = context.createGain(); amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(0.42, t + 0.08);
    amp.gain.setTargetAtTime(0.22, t + 0.5, 0.4); amp.gain.setTargetAtTime(0, t + 1.7, 0.12);
    const flutter = context.createOscillator(), depth = context.createGain(), wobble = context.createGain();
    flutter.frequency.setValueAtTime(15, t); flutter.frequency.exponentialRampToValueAtTime(4.5, t + 1.9);
    depth.gain.value = 0.5; wobble.gain.value = 0.55;
    flutter.connect(depth); depth.connect(wobble.gain);
    source.connect(band); band.connect(wobble); wobble.connect(amp); amp.connect(out);
    source.start(t); source.stop(t + 2.2); flutter.start(t); flutter.stop(t + 2.2); nodes.push(source, flutter);
    const knock = context.createOscillator(), knockAmp = context.createGain();
    knock.type = 'triangle'; knock.frequency.setValueAtTime(130, t + 1.86); knock.frequency.exponentialRampToValueAtTime(70, t + 2);
    knockAmp.gain.setValueAtTime(0, t + 1.86); knockAmp.gain.linearRampToValueAtTime(0.35, t + 1.875); knockAmp.gain.exponentialRampToValueAtTime(0.001, t + 2.1);
    knock.connect(knockAmp); knockAmp.connect(out); knock.start(t + 1.86); knock.stop(t + 2.2); nodes.push(knock);
  }

  return {
    play(cue, atMs, gain) {
      const audio = options.context(), level = Math.max(0, Math.min(1, gain * options.gain()));
      if (!audio || level === 0) return () => {};
      const { context, destination } = audio;
      const t = context.currentTime + Math.max(0, (atMs - options.now()) / 1000);
      const out = context.createGain(); out.gain.value = level; out.connect(destination);
      const nodes: AudioScheduledSourceNode[] = [];
      if (cue === 'horn') horn(context, out, t, nodes); else cloth(context, out, t, nodes);
      let done = false;
      const finish = () => { if (done) return; done = true; live.delete(cancel); out.disconnect(); };
      const timer = setTimeout(finish, Math.max(0, (t - context.currentTime) * 1000) + CUE_LENGTH_MS[cue] + 200);
      function cancel(): void {
        if (done) return;
        clearTimeout(timer);
        const now = context.currentTime;
        out.gain.cancelScheduledValues(now); out.gain.setTargetAtTime(0, now, 0.012);
        for (const node of nodes) { try { node.stop(now + 0.05); } catch { /* already stopped */ } }
        setTimeout(finish, 80);
      }
      live.add(cancel);
      return cancel;
    },
    get active() { return live.size; },
  };
}
