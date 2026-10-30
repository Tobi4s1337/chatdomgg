import type { CueFamily, MixTier } from './families';
import type { Mix } from './mix';
import type { AudioCueOptions } from './types';
import { VoiceGraph, type Kit } from './voice';

/** Hard bounds for one instance, counting every foley and synthesis layer. */
export const MAX_VOICES = 16;
export const MAX_SOURCES = 64;

/** How far each tier may fill the mix. The headroom above a tier is reserved for the tiers above it. */
export const TIER_LIMITS: Readonly<Record<MixTier, { voices: number; sources: number }>> = {
  control: { voices: MAX_VOICES, sources: MAX_SOURCES },
  ceremony: { voices: 14, sources: 56 },
  build: { voices: 12, sources: 48 },
  step: { voices: 8, sources: 32 },
};

/** The same cue on the same surface within this window is one sound, not two. */
export const COALESCE_SECONDS = 0.04;
/** Scheduling lead so a layer's first milliseconds are never cut by the render quantum. */
const LEAD_SECONDS = 0.008;
/** Distance law: gain = 1 / (1 + distance / 8 m). Full local gain at 0 m, half (−6 dB) at 8 m, a quarter at 24 m. */
export const DISTANCE_REFERENCE = 8;

interface LiveVoice {
  sources: number;
  remaining: number;
  graph: VoiceGraph;
  output: AudioNode[];
  stopped: boolean;
}

export function placement(options: AudioCueOptions): { pan: number; gain: number } | undefined {
  const pan = options.pan ?? 0, distance = options.distance ?? 0;
  if (!Number.isFinite(pan) || !Number.isFinite(distance)) return undefined;
  return { pan: Math.min(1, Math.max(-1, pan)), gain: 1 / (1 + Math.max(0, distance) / DISTANCE_REFERENCE) };
}

/**
 * Voices on one context: variation choice, duplicate coalescing, the tiered budget, placement and cleanup.
 * The live instance and the offline render both play through this, so a capture is the shipped mix.
 */
export class Mixer {
  private readonly voices = new Set<LiveVoice>();
  private readonly lastVariation = new Map<string, number>();
  private readonly lastAt = new Map<string, number>();

  constructor(private readonly context: BaseAudioContext, private readonly mix: Mix, private readonly kit: Kit) {}

  play(family: CueFamily, options: AudioCueOptions): boolean {
    const place = placement(options);
    if (!place || !this.kit.samples.has(family.samples)) return false;
    const context = this.context, now = context.currentTime;
    if (now - (this.lastAt.get(family.key) ?? -Infinity) < COALESCE_SECONDS) return false;

    const input = context.createGain();
    const graph = new VoiceGraph(context, input, now + LEAD_SECONDS, this.kit);
    const variation = this.pickVariation(family.key, family.variations);
    family.build(graph, variation);
    const sources = graph.scheduled.length;
    if (!this.admit(family.tier, sources)) {
      for (const node of graph.nodes) node.disconnect();
      input.disconnect();
      return false;
    }

    const distance = context.createGain(), panner = context.createStereoPanner(), send = context.createGain();
    distance.gain.value = place.gain; panner.pan.value = place.pan; send.gain.value = graph.room;
    input.connect(distance); distance.connect(panner); panner.connect(this.mix.bus);
    if (graph.room > 0) { panner.connect(send); send.connect(this.mix.room); }

    const voice: LiveVoice = { sources, remaining: sources, graph, output: [input, distance, panner, send], stopped: false };
    for (const { node } of graph.scheduled) {
      node.onended = () => { if (--voice.remaining === 0) this.release(voice); };
    }
    graph.start();
    this.voices.add(voice);
    this.lastAt.set(family.key, now);
    this.lastVariation.set(family.key, variation);
    return true;
  }

  /** Stops every voice at `at`. Used on mute, suspension and disposal so nothing resumes or replays later. */
  silence(at: number): void {
    for (const voice of this.voices) {
      if (voice.stopped) continue;
      voice.stopped = true;
      for (const { node } of voice.graph.scheduled) {
        try { node.stop(at); } catch { /* a source that already ended */ }
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

  private admit(tier: MixTier, sources: number): boolean {
    const limit = TIER_LIMITS[tier];
    return this.voices.size + 1 <= limit.voices && this.sourceCount + sources <= limit.sources;
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
