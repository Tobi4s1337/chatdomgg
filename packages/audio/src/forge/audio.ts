import type { ForgePublicBeat, ForgeRitualFrame } from '../../../shared/src/forge';
import { budgetFor, FORGE_AUDIO_LIMITS, type Admission, type BudgetVoice } from './budget';
import { CUE_PRIORITY, ForgeConductor, type BedTarget, type ForgeAttack } from './conductor';
import { FORGE_CUES, refusalCue } from './cues';
import { ForgeVoice, forgeKit } from './voice';

export type RefusalBeat = Extract<ForgePublicBeat, { kind: 'refusal' }>;
export interface ForgeAudioMix { muted: boolean; volume: number }
export interface ForgeAudio {
  update(frame: ForgeRitualFrame | null): void;
  refusal(beat: RefusalBeat): void;
  setMix(settings: ForgeAudioMix): void;
  dispose(): void;
}

/** What happened to one sound, for the bench, the checks and the demo. Never shown to viewers. */
export interface ForgeAudioEvent {
  cue: string;
  at: number; // audio-clock seconds
  outcome: 'played' | Admission | 'expired' | 'seek' | 'silent';
  late?: number;
}
export interface ForgeAudioInspection {
  state: AudioContextState | 'disposed';
  mix: Readonly<ForgeAudioMix>;
  audible: boolean;
  held: boolean;
  bed: boolean;
  /** This adapter's live voices and source nodes, then the whole layer on its destination. */
  voices: number; sources: number;
  /** The cues this adapter is still sounding, by name. */
  sounding: string[];
  layerVoices: number; layerSources: number; peakVoices: number; peakSources: number;
  played: Record<string, number>;
  events: readonly ForgeAudioEvent[];
}

/** A few milliseconds of lead so a new sound never starts in the render quantum already being computed. */
const LEAD = .006;
/** How long a bed keeps sounding without a new observation before it fades itself: a stalled host goes quiet. */
const BED_WATCHDOG = .5;
/** Mute and zero volume: the master falls ~60 dB within FADE, then owned sources stop. */
const FADE = .03;

interface Internal { inspect(): ForgeAudioInspection }
const internals = new WeakMap<ForgeAudio, Internal>();
let adapters = 0;

export function inspectForgeAudio(audio: ForgeAudio): ForgeAudioInspection {
  const internal = internals.get(audio);
  if (!internal) throw new Error('forge audio: not an adapter made by createForgeAudio');
  return internal.inspect();
}

interface Bed {
  voice: ForgeVoice;
  low: BiquadFilterNode; lowGain: GainNode;
  high: BiquadFilterNode; highGain: GainNode;
  slot: BudgetVoice;
}

/**
 * The Forge layer on the host's graph. `rendering` is set only by the offline renderer, whose context reports
 * `suspended` while it hands control back between render steps.
 */
export function createForgeAudioGraph(options: { context: BaseAudioContext; destination: AudioNode }, rendering = false): ForgeAudio {
  const { context, destination } = options;
  if (!context || typeof context.createGain !== 'function') throw new TypeError('forge audio: a host AudioContext is required');
  if (!destination || destination.context !== context) throw new TypeError('forge audio: the destination must belong to the same context');
  const kit = forgeKit(context), budget = budgetFor(destination), conductor = new ForgeConductor(), owner = {};
  const bedKey = `bed:${++adapters}`; // each anvil keeps its own air; only the budget can turn one away
  const mix: ForgeAudioMix = { muted: false, volume: .65 };
  const live = new Set<{ voice: ForgeVoice; slot: BudgetVoice }>();
  const played: Record<string, number> = {};
  const events: ForgeAudioEvent[] = [];
  let disposed = false, bed: Bed | null = null, held = false, frontDirty = false;

  // Voices → bus → (dry + workshop room) → front → 30 Hz guard → glue → master (volume²) → soft ceiling → host.
  const bus = context.createGain(), roomIn = context.createGain();
  const guard = context.createBiquadFilter();
  guard.type = 'highpass'; guard.frequency.value = 30; guard.Q.value = .7;
  const glue = context.createDynamicsCompressor();
  glue.threshold.value = -16; glue.knee.value = 8; glue.ratio.value = 3; glue.attack.value = .004; glue.release.value = .22;
  const master = context.createGain();
  master.gain.value = level();
  const ceiling = context.createWaveShaper();
  ceiling.curve = ceilingCurve(); ceiling.oversample = '2x';
  guard.connect(glue); glue.connect(master); master.connect(ceiling); ceiling.connect(destination);
  let front!: GainNode, room!: ConvolverNode, wet!: GainNode;
  const fixed: AudioNode[] = [bus, roomIn, guard, glue, master, ceiling];
  buildFront();

  function buildFront() {
    front = context.createGain(); room = context.createConvolver(); wet = context.createGain();
    room.normalize = false; room.buffer = kit.room; wet.gain.value = .6;
    bus.connect(front); roomIn.connect(room); room.connect(wet); wet.connect(front); front.connect(guard);
  }
  /** Everything that remembers sound (the room's tail) is replaced, so nothing from before comes back. */
  function replaceFront() {
    bus.disconnect(); roomIn.disconnect();
    for (const node of [room, wet, front]) node.disconnect();
    buildFront(); frontDirty = false;
  }

  function level() { return mix.muted || !(mix.volume > 0) ? 0 : mix.volume * mix.volume; }
  const running = () => context.state === 'running' || (rendering && context.state === 'suspended');
  const audible = () => !disposed && running() && level() > 0;
  function note(event: ForgeAudioEvent) { events.push(event); if (events.length > 96) events.shift(); }

  function connect(voice: ForgeVoice) { voice.panner.connect(bus); voice.send.connect(roomIn); }

  function retire(entry: { voice: ForgeVoice; slot: BudgetVoice }) {
    live.delete(entry); budget.remove(entry.slot); entry.voice.release();
    if (bed?.voice === entry.voice) bed = null;
  }

  function start(cue: string, priority: number, build: (voice: ForgeVoice) => void, at = context.currentTime + LEAD): Admission | 'played' {
    const voice = new ForgeVoice(context, at, kit);
    build(voice);
    const entry = { voice, slot: undefined as unknown as BudgetVoice };
    entry.slot = {
      key: cue, priority, sources: now => voice.sourcesAt(now), start: at, end: voice.end, owner,
      evict(stopAt) { voice.out.gain.setTargetAtTime(0, context.currentTime, .001); voice.stop(stopAt); entry.slot.end = stopAt; },
    };
    const admission = budget.admit(entry.slot, context.currentTime);
    if (admission !== 'admitted') { voice.release(); return admission; }
    connect(voice);
    live.add(entry);
    voice.start(() => retire(entry));
    played[cue] = (played[cue] ?? 0) + 1;
    return 'played';
  }

  function attack(item: ForgeAttack, late: number) {
    const outcome = start(item.cue, CUE_PRIORITY[item.cue], voice => FORGE_CUES[item.cue](voice, item.variation));
    note({ cue: item.cue, at: context.currentTime, outcome, late });
  }

  function ensureBed(): Bed | null {
    if (bed) return bed;
    const now = context.currentTime, voice = new ForgeVoice(context, now + LEAD, kit);
    const noise = voice.noise(now + LEAD, now + 3600);
    const low = voice.filter('bandpass', 300, .8), lowGain = voice.gain(0);
    const high = voice.filter('bandpass', 3000, 1), highGain = voice.gain(0);
    voice.chain(noise, low, lowGain, voice.out);
    voice.chain(noise, high, highGain, voice.out);
    voice.room = .12;
    const slot: BudgetVoice = {
      key: bedKey, priority: CUE_PRIORITY.bed, sources: at => voice.sourcesAt(at), start: now, end: Infinity, owner,
      evict(stopAt) { voice.out.gain.setTargetAtTime(0, context.currentTime, .001); voice.stop(stopAt); slot.end = stopAt; if (bed?.voice === voice) bed = null; },
    };
    const admission = budget.admit(slot, now);
    if (admission !== 'admitted') { voice.release(); note({ cue: 'bed', at: now, outcome: admission }); return null; }
    connect(voice);
    const entry = { voice, slot };
    live.add(entry);
    voice.start(() => retire(entry));
    bed = { voice, low, lowGain, high, highGain, slot };
    return bed;
  }

  function stopBed(fade = .12) {
    if (!bed) return;
    const now = context.currentTime, { voice, slot } = bed;
    hold(voice.out.gain, now); voice.out.gain.setTargetAtTime(0, now, fade / 3);
    voice.stop(now + fade * 2.5); slot.end = now + fade * 2.5;
    bed = null;
  }

  function steer(target: BedTarget) {
    // Nothing to play (the landed stage): never spend a voice on silence.
    if (target.low.level + target.high.level < 1e-4) { stopBed(.2); return; }
    const b = ensureBed();
    if (!b) return;
    const now = context.currentTime;
    for (const [param, value] of [[b.low.frequency, target.low.frequency], [b.low.Q, target.low.q], [b.high.frequency, target.high.frequency], [b.high.Q, target.high.q]] as const) {
      hold(param, now); param.setTargetAtTime(value, now, .08);
    }
    for (const [param, value] of [[b.lowGain.gain, target.low.level], [b.highGain.gain, target.high.level]] as const) {
      hold(param, now); param.setTargetAtTime(value, now, .07);
      param.setTargetAtTime(0, now + BED_WATCHDOG, .15);
    }
  }

  /** Silences and stops every owned sound now (mute, zero volume, suspension, closing); the room is renewed. */
  function interrupt(immediate: boolean) {
    const now = context.currentTime;
    for (const entry of [...live]) {
      if (immediate) { entry.voice.stop(now); retire(entry); }
      else { entry.voice.stop(now + FADE); entry.slot.end = now + FADE; }
    }
    bed = null;
    if (immediate) replaceFront(); else frontDirty = true;
  }

  const onState = () => { if (!disposed && !running()) interrupt(true); };
  if (!rendering) context.addEventListener('statechange', onState);

  const audio: ForgeAudio = {
    update(frame) {
      if (disposed) return;
      const now = context.currentTime, step = conductor.step(frame ?? null, now);
      if (!step) return; // an unreadable observation: hold, and let the bed's watchdog fade it
      held = step.held;
      for (const { attack: item, reason } of step.skipped) note({ cue: item.cue, at: now, outcome: reason });
      if (!audible()) {
        if (!running() && live.size) interrupt(true);
        for (const { attack: item } of step.play) note({ cue: item.cue, at: now, outcome: 'silent' });
        return;
      }
      if (frontDirty) replaceFront();
      budget.prune(now);
      for (const { attack: item, late } of step.play) attack(item, late);
      if (step.bed) steer(step.bed); else stopBed(frame ? .2 : .06);
    },
    refusal(beat) {
      if (disposed || !beat || beat.kind !== 'refusal') return;
      const variant = beat.variant === 1 || beat.variant === 2 ? beat.variant : 0, now = context.currentTime;
      if (!audible()) { note({ cue: 'refusal', at: now, outcome: 'silent' }); return; }
      if (frontDirty) replaceFront();
      const outcome = start('refusal', CUE_PRIORITY.refusal, voice => refusalCue(voice, variant));
      note({ cue: 'refusal', at: now, outcome });
    },
    setMix(settings) {
      if (disposed) return;
      const was = level();
      mix.muted = settings?.muted !== false;
      const volume = Number(settings?.volume);
      mix.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
      const next = level(), now = context.currentTime;
      hold(master.gain, now);
      master.gain.setTargetAtTime(next, now, next === 0 ? FADE / 7 : .012);
      if (next === 0 && was > 0) interrupt(false);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (!rendering) context.removeEventListener('statechange', onState);
      const now = context.currentTime;
      for (const entry of [...live]) { entry.voice.stop(now); retire(entry); }
      bed = null;
      for (const node of [...fixed, room, wet, front]) node.disconnect();
    },
  };

  internals.set(audio, {
    inspect: () => {
      budget.prune(context.currentTime);
      let sources = 0;
      for (const entry of live) if (entry.slot.end > context.currentTime) sources += entry.slot.sources(context.currentTime);
      return {
        state: disposed ? 'disposed' : context.state, mix: { ...mix }, audible: audible(), held, bed: bed !== null,
        voices: [...live].filter(entry => entry.slot.end > context.currentTime).length, sources,
        sounding: [...live].filter(entry => entry.slot.end > context.currentTime).map(entry => entry.slot.key),
        layerVoices: budget.voices.size, layerSources: budget.sources(context.currentTime), peakVoices: budget.peakVoices, peakSources: budget.peakSources,
        played: { ...played }, events: [...events],
      };
    },
  });
  return audio;
}

/** Holds an automated parameter at its current value so a new ramp starts from where it is (no step, no click). */
function hold(param: AudioParam, at: number) {
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(at);
  else { const value = param.value; param.cancelScheduledValues(at); param.setValueAtTime(value, at); }
}

/** Linear to 0.7, then a smooth knee that never passes 0.92: a guarantee, never the level control. */
function ceilingCurve(): Float32Array<ArrayBuffer> {
  const n = 2049, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    const y = a <= .7 ? a : .7 + .22 * Math.tanh((a - .7) / .22);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

export { FORGE_AUDIO_LIMITS };
