import { forgeRitualFrame } from '@chatdom/forge';
import type { ForgeRitualFrame } from '@chatdom/shared';
import { createForgeAudio, type ForgeAudio } from '../../../../packages/audio/src/forge/index';
import { inspectForgeAudio, type ForgeAudioInspection } from '../../../../packages/audio/src/forge/audio';
import { encodeWav, renderForgeAudio } from '../../../../packages/audio/src/forge/offline';
import { RITUAL_SECONDS } from './params';

/**
 * The bench is the host here: it owns the one AudioContext (made in the click that turns sound on), a host bus to
 * the speakers, and the Forge adapter on it, exactly as main will hand them over. The second anvil is SIMULATED,
 * heard only, to review two ceremonies overlapping on one layer.
 */
export interface BenchSoundReport {
  state: AudioContextState | 'off';
  muted: boolean; volume: number; second: number | null;
  forge: ForgeAudioInspection | null;
  secondForge: ForgeAudioInspection | null;
  /** The host bus's live peak since the last report, read from the real output. */
  peak: number;
}

/** A serialisable offline script for the demo: what each anvil is shown, and when the mix or a refusal changes. */
export interface BenchRenderPlan {
  duration: number;
  anvils: { ritual: string; segments: { from: number; to: number; start: number; gate?: number }[] }[];
  actions: ({ at: number; anvil: number } & ({ kind: 'refusal'; variant: 0 | 1 | 2 } | { kind: 'mix'; muted: boolean; volume: number }))[];
}

export function createBenchSound() {
  let context: AudioContext | null = null, bus: GainNode | null = null, meter: AnalyserNode | null = null;
  let forge: ForgeAudio | null = null, second: ForgeAudio | null = null, secondOffset: number | null = null;
  let muted = false, volume = .65;
  const samples = new Float32Array(2048);

  /** Must run inside a user gesture: makes and resumes the context, then mounts the Forge layer on its bus. */
  async function enable(): Promise<boolean> {
    if (!context) {
      context = new AudioContext({ latencyHint: 'interactive' });
      bus = context.createGain();
      meter = context.createAnalyser(); meter.fftSize = 2048;
      bus.connect(context.destination); bus.connect(meter);
      forge = createForgeAudio({ context, destination: bus });
      forge.setMix({ muted, volume });
    }
    if (context.state !== 'running') await context.resume().catch(() => undefined);
    return context.state === 'running';
  }

  function setMix(next: { muted?: boolean; volume?: number }) {
    if (next.muted !== undefined) muted = next.muted;
    if (next.volume !== undefined) volume = next.volume;
    forge?.setMix({ muted, volume }); second?.setMix({ muted, volume });
  }

  function setSecond(offset: number | null) {
    secondOffset = offset;
    if (offset === null) { second?.dispose(); second = null; return; }
    if (context && bus && !second) { second = createForgeAudio({ context, destination: bus }); second.setMix({ muted, volume }); }
  }

  /** Called with the very frame the picture was given; the second anvil runs the same ceremony `offset` later. */
  function update(frame: ForgeRitualFrame | null, t: number) {
    forge?.update(frame);
    if (second && secondOffset !== null) {
      const at = t - secondOffset;
      second.update(frame && at >= 0 && at <= RITUAL_SECONDS ? forgeRitualFrame('bench-simulated-second-anvil', at) : null);
    }
  }

  /** A SIMULATED refusal beat, as main would pass the one it admitted to the refusal visual. */
  function refusal(variant: 0 | 1 | 2) { forge?.refusal({ kind: 'refusal', variant }); }

  function report(): BenchSoundReport {
    let peak = 0;
    if (meter) { meter.getFloatTimeDomainData(samples); for (const v of samples) peak = Math.max(peak, Math.abs(v)); }
    return {
      state: context ? context.state : 'off', muted, volume, second: secondOffset,
      forge: forge ? inspectForgeAudio(forge) : null, secondForge: second ? inspectForgeAudio(second) : null, peak,
    };
  }

  /** Renders a plan through the same adapters offline and returns the WAV and its level facts. */
  async function render(plan: BenchRenderPlan, rate = 48000) {
    const frameOf = (anvil: BenchRenderPlan['anvils'][number], t: number): ForgeRitualFrame | null => {
      const segment = anvil.segments.find(s => t >= s.from && t < s.to);
      if (!segment) return null;
      const local = segment.start + (t - segment.from);
      if (segment.gate === undefined || local < segment.gate) return forgeRitualFrame(anvil.ritual, local);
      const at = forgeRitualFrame(anvil.ritual, segment.gate);
      return { ...at, elapsed: local };
    };
    const done = new Set<number>();
    const rendered = await renderForgeAudio({
      duration: plan.duration, sampleRate: rate, adapters: plan.anvils.length,
      drive(t, adapters) {
        plan.actions.forEach((action, i) => {
          if (done.has(i) || t < action.at) return;
          done.add(i);
          const adapter = adapters[action.anvil]!;
          if (action.kind === 'refusal') adapter.refusal({ kind: 'refusal', variant: action.variant });
          else adapter.setMix({ muted: action.muted, volume: action.volume });
        });
        plan.anvils.forEach((anvil, i) => adapters[i]!.update(frameOf(anvil, t)));
      },
    });
    const channels = [rendered.buffer.getChannelData(0), rendered.buffer.getChannelData(1)];
    const wav = encodeWav(channels, rate);
    let binary = '';
    for (let i = 0; i < wav.length; i += 0x8000) binary += String.fromCharCode(...wav.subarray(i, i + 0x8000));
    return { wav: btoa(binary), rate, frames: channels[0]!.length, inspections: rendered.inspections };
  }

  function dispose() {
    second?.dispose(); forge?.dispose(); second = forge = null;
    bus?.disconnect(); meter?.disconnect();
    void context?.close().catch(() => undefined);
    context = null;
  }

  return {
    enable, setMix, setSecond, update, refusal, report, render, dispose,
    get on() { return context !== null; },
    /** Host-side handles for the demo's live recorder and its suspension check. */
    get host() { return context && bus ? { context, bus } : null; },
  };
}
export type BenchSound = ReturnType<typeof createBenchSound>;
