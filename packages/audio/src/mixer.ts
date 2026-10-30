import type { CueFamily, MixTier } from './families';
import type { Mix } from './mix';
import type { AudioCueOptions } from './types';
import { VoiceGraph, type Kit } from './voice';

/** Hard bounds for one instance, counting every foley and synthesis layer. */
export const MAX_VOICES = 16;
export const MAX_SOURCES = 64;

/**
 * How far each tier may fill the whole mix (voices and source nodes, counted after admitting the new cue). The
 * room above a tier is reserved for the tiers above it: nothing below the beacon can take the mix past 40 sources,
 * so the castle beacon (18) and a control press (up to 6) always fit, and the beacon stops at 58 so a control
 * still answers during it. Footsteps (2–4 sources each) and building cues (2–6) sit lowest.
 */
export const TIER_LIMITS: Readonly<Record<MixTier, { voices: number; sources: number }>> = {
  control: { voices: MAX_VOICES, sources: MAX_SOURCES },
  beacon: { voices: 15, sources: 58 },
  ceremony: { voices: 13, sources: 40 },
  build: { voices: 12, sources: 34 },
  step: { voices: 8, sources: 28 },
};

/**
 * Footsteps give way. When the mix is full, a building cue may fade out the quietest footsteps, and a footstep may
 * fade out footsteps at least 3 dB quieter than itself (your own feet, or someone close, walking past a crowd). They fade over
 * 20 ms rather than being cut. Fading footsteps do not count against the step and build ceilings, within an
 * allowance that keeps both tiers at or below 40 sources and 14 voices including them (step 28 + 12, 8 + 6;
 * build 34 + 6, 12 + 2), so the beacon and control reserve above always holds.
 */
export const STEP_FADE_SECONDS = 0.02;
export const FADE_ALLOWANCE: Readonly<Partial<Record<MixTier, { voices: number; sources: number }>>> = {
  step: { voices: 6, sources: 12 },
  build: { voices: 2, sources: 6 },
};
/**
 * Coalescing: the same cue on the same surface within 40 ms is one sound, not two, unless the newer one is at
 * least 3 dB nearer (a footstep beside you is not a duplicate of one across the square).
 */
export const COALESCE_SECONDS = 0.04;
/** "Nearer" for coalescing and footstep replacement: at least 3 dB more placement gain. */
const NEARER = Math.SQRT2;
/** Scheduling lead so a layer's first milliseconds are never cut by the render quantum. */
const LEAD_SECONDS = 0.008;
/** Distance law: gain = 1 / (1 + distance / 8 m). Full local gain at 0 m, half (−6 dB) at 8 m, a quarter at 24 m. */
export const DISTANCE_REFERENCE = 8;
/**
 * Air: beyond a metre or so, distance also softens the top, low-pass at 18 kHz / (1 + distance / 6 m), never
 * below 1.2 kHz: about 7.7 kHz at 8 m and 3.6 kHz at 24 m. Far footsteps become dull as well as quiet.
 */
export const AIR_REFERENCE = 6;

interface LiveVoice {
  tier: MixTier;
  /** Placement gain, used to choose which footsteps a nearer one may replace. */
  gain: number;
  sources: number;
  remaining: number;
  graph: VoiceGraph;
  distance: GainNode;
  output: AudioNode[];
  stopped: boolean;
  fading: boolean;
}

export interface Placement { pan: number; gain: number; air: number | undefined }

export function placement(options: AudioCueOptions): Placement | undefined {
  const pan = options.pan ?? 0, distance = options.distance ?? 0;
  if (!Number.isFinite(pan) || !Number.isFinite(distance)) return undefined;
  const metres = Math.max(0, distance);
  return {
    pan: Math.min(1, Math.max(-1, pan)),
    gain: 1 / (1 + metres / DISTANCE_REFERENCE),
    air: metres > 1 ? Math.max(1200, 18000 / (1 + metres / AIR_REFERENCE)) : undefined,
  };
}

/**
 * Voices on one context: variation choice, duplicate coalescing, the tiered budget, placement and cleanup.
 * The live instance and the offline render both play through this, so a capture is the shipped mix.
 */
export class Mixer {
  private readonly voices = new Set<LiveVoice>();
  private readonly lastVariation = new Map<string, number>();
  private readonly lastAt = new Map<string, { at: number; gain: number }>();

  constructor(private readonly context: BaseAudioContext, private readonly mix: Mix, private readonly kit: Kit) {}

  play(family: CueFamily, options: AudioCueOptions): boolean {
    const place = placement(options);
    if (!place || !this.kit.samples.has(family.samples)) return false;
    const context = this.context, now = context.currentTime;
    const last = this.lastAt.get(family.key);
    if (last && now - last.at < COALESCE_SECONDS && place.gain < last.gain * NEARER) return false;

    const input = context.createGain();
    input.gain.value = 10 ** ((family.fader ?? 0) / 20);
    const graph = new VoiceGraph(context, input, now + LEAD_SECONDS, this.kit);
    const variation = this.pickVariation(family.key, family.variations);
    family.build(graph, variation);
    const sources = graph.scheduled.length;
    if (!this.admit(family.tier, sources, place.gain)) {
      for (const node of graph.nodes) node.disconnect();
      input.disconnect();
      return false;
    }

    const distance = context.createGain(), panner = context.createStereoPanner(), send = context.createGain();
    distance.gain.value = place.gain; panner.pan.value = place.pan; send.gain.value = graph.room;
    const output: AudioNode[] = [input, distance, panner, send];
    input.connect(distance);
    if (place.air === undefined) distance.connect(panner);
    else {
      const air = context.createBiquadFilter();
      air.type = 'lowpass'; air.frequency.value = place.air; air.Q.value = 0.5;
      distance.connect(air); air.connect(panner); output.push(air);
    }
    panner.connect(this.mix.bus);
    if (graph.room > 0) { panner.connect(send); send.connect(this.mix.room); }

    const voice: LiveVoice = {
      tier: family.tier, gain: place.gain, sources, remaining: sources, graph, distance, output, stopped: false, fading: false,
    };
    for (const { node } of graph.scheduled) {
      node.onended = () => { if (--voice.remaining === 0) this.release(voice); };
    }
    graph.start();
    this.voices.add(voice);
    this.lastAt.set(family.key, { at: now, gain: place.gain });
    this.lastVariation.set(family.key, variation);
    return true;
  }

  /** Stops every voice at `at`. Used on mute, suspension and disposal so nothing resumes or replays later. */
  silence(at: number): void {
    for (const voice of this.voices) {
      if (voice.stopped) continue;
      voice.stopped = true;
      for (const { node, stop } of voice.graph.scheduled) {
        try { node.stop(Math.min(stop, at)); } catch { /* a source that already ended */ }
      }
    }
  }

  /** Disconnects everything this mixer made, including the shared mix path. */
  close(): void {
    this.silence(0);
    for (const voice of [...this.voices]) this.release(voice);
    for (const node of this.mix.nodes) node.disconnect();
  }

  get voiceCount(): number { return this.voices.size; }

  get sourceCount(): number {
    let sources = 0;
    for (const voice of this.voices) sources += voice.remaining;
    return sources;
  }

  get variations(): Readonly<Record<string, number>> { return Object.fromEntries(this.lastVariation); }

  level(): number {
    const buffer = new Float32Array(this.mix.analyser.fftSize);
    this.mix.analyser.getFloatTimeDomainData(buffer);
    return buffer.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
  }

  /** Never the same variation twice in a row for one family on one surface. */
  private pickVariation(key: string, count: number): number {
    const last = this.lastVariation.get(key);
    if (count < 2 || last === undefined) return Math.floor(this.kit.random() * count) % count;
    return (last + 1 + Math.floor(this.kit.random() * (count - 1))) % count;
  }

  /**
   * Whether a cue of `tier` with `sources` layers fits. Every live layer counts against the hard bounds and against
   * the ceremony, beacon and control ceilings. Footsteps already fading out (or about to) are left out of the step
   * and build ceilings only, within the fade allowance.
   */
  private fits(tier: MixTier, sources: number, leaving: ReadonlySet<LiveVoice> = new Set()): boolean {
    const limit = TIER_LIMITS[tier], allowance = FADE_ALLOWANCE[tier];
    let voices = 0, counted = 0, all = 0, fadingVoices = 0, fadingSources = 0;
    for (const voice of this.voices) {
      all += voice.remaining;
      if (allowance && voice.tier === 'step' && (voice.fading || leaving.has(voice))) {
        fadingVoices++; fadingSources += voice.remaining;
        continue;
      }
      voices++; counted += voice.remaining;
    }
    return voices + 1 <= limit.voices && counted + sources <= limit.sources
      && fadingVoices <= (allowance?.voices ?? 0) && fadingSources <= (allowance?.sources ?? 0)
      && this.voices.size + 1 <= MAX_VOICES && all + sources <= MAX_SOURCES;
  }

  /** Admits a cue; when the mix is full, footsteps give way to building and to much nearer footsteps. */
  private admit(tier: MixTier, sources: number, gain: number): boolean {
    if (this.fits(tier, sources)) return true;
    if (!FADE_ALLOWANCE[tier]) return false;
    const quieter = [...this.voices]
      .filter(voice => voice.tier === 'step' && !voice.fading && (tier === 'build' || voice.gain * NEARER <= gain))
      .sort((a, b) => a.gain - b.gain);
    const leaving = new Set<LiveVoice>();
    for (const voice of quieter) {
      leaving.add(voice);
      if (this.fits(tier, sources, leaving)) {
        for (const replaced of leaving) this.fade(replaced);
        return true;
      }
    }
    return false;
  }

  private fade(voice: LiveVoice): void {
    const now = this.context.currentTime, gain = voice.distance.gain;
    voice.fading = true;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + STEP_FADE_SECONDS);
    for (const { node, stop } of voice.graph.scheduled) {
      try { node.stop(Math.min(stop, now + STEP_FADE_SECONDS + 0.002)); } catch { /* a source that already ended */ }
    }
  }

  private release(voice: LiveVoice): void {
    this.voices.delete(voice);
    for (const node of voice.graph.nodes) node.disconnect();
    for (const node of voice.output) node.disconnect();
  }
}

/** The per-context white-noise buffer every noise layer reads from. */
export function noiseBuffer(context: BaseAudioContext, random: () => number): AudioBuffer {
  const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate), data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
  return noise;
}
