import type { Vec3 } from '@chatdom/shared';
import { campfireMaterial, CAMPFIRE_VARIANTS, type CampfireBed, type CampfireCue, type CampfireMaterial } from './materials';

/**
 * voices: finite cue sources at once (overload drops the new one); sources: the hard ceiling including the three
 * bed loops; watchdog: seconds a bed may play past its last renewal; near/far: metres from the fire where the beds
 * are at full level and where they have faded out.
 */
export const CAMPFIRE_SOUND_LIMITS = Object.freeze({ voices: 6, sources: 9, watchdog: .75, near: 4, far: 25, fade: .04 });
export interface CampfireListener { feet: Vec3; forward: Vec3 }
export interface CampfirePlace { fire: Vec3 }
export interface CampfireSoundInspection {
  disposed: boolean; audible: boolean;
  /** Owned buffer sources sounding now (beds and cues), and cue voices among them. */
  sources: number; voices: number; peakSources: number; peakVoices: number;
  /** Cues started, by cue. Beds are not counted here. */
  played: Readonly<Partial<Record<CampfireCue, number>>>;
  dropped: number;
  /** Applied bed levels, 0..1: the fire's reach at the listener, and the night's darkness times that reach. */
  beds: { fire: number; night: number };
}
export interface CampfireSoundGraph {
  play(cue: CampfireCue, listener: CampfireListener): void;
  update(listener: CampfireListener, hour: number): void;
  quiet(): void;
  dispose(): void;
  inspect(): CampfireSoundInspection;
}

/** Output trim into the shared destination; the shared mixer keeps volume, mute, compression and the ceiling. */
const TRIM = .3;
const BED_LEVEL: Record<CampfireBed, number> = { flame: .55, crackle: .6, air: .32 };
const CUE_LEVEL: Record<CampfireCue, number> = {
  ask: .5, deal: .42, night: .5, snuff: .55, dawn: .45, ballot: .42, sent: .62, spared: .45,
  town: .5, wolves: .55, ember: .14, tap: .28,
};
/** How far the fire bus sinks under a cue, and for how long (seconds). Embers and taps leave the fire alone. */
const DUCK: Partial<Record<CampfireCue, { to: number; hold: number }>> = {
  night: { to: .62, hold: 3 }, sent: { to: .7, hold: .5 }, wolves: { to: .72, hold: 1.2 }, town: { to: .78, hold: 1 },
  snuff: { to: .78, hold: .45 }, ask: { to: .85, hold: .4 }, deal: { to: .85, hold: .5 }, dawn: { to: .85, hold: .6 },
  ballot: { to: .88, hold: .3 }, spared: { to: .85, hold: .35 },
};

interface Voice { source: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode; end: number; bed: CampfireBed | null }
interface Kit { buffers: Map<string, AudioBuffer>; variation: Map<CampfireMaterial, number> }
const kits = new WeakMap<BaseAudioContext, Kit>();

/** Full within `near` metres of the fire, fading on a square curve to silence at `far`. */
export function campfireReach(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  const { near, far } = CAMPFIRE_SOUND_LIMITS;
  if (distance <= near) return 1;
  if (distance >= far) return 0;
  return ((far - distance) / (far - near)) ** 2;
}

// The kingdom sky's night grade by hour (packages/render atmosphere), so the night is heard as dark as it looks.
const NIGHT_GRADE: readonly (readonly [number, number])[] = [[0, 1], [5, .62], [7, .03], [12, 0], [16, 0], [18, .1], [19.25, .72], [20.5, .88], [24, 1]];
/** 0 in full day, 1 in deep night. Below the faintest dusk the night bed is silent. */
export function campfireDarkness(hour: number): number {
  if (!Number.isFinite(hour)) return 0;
  const h = ((hour % 24) + 24) % 24;
  let grade = 0;
  for (let i = 1; i < NIGHT_GRADE.length; i++) {
    const [h0, g0] = NIGHT_GRADE[i - 1]!, [h1, g1] = NIGHT_GRADE[i]!;
    if (h <= h1) { grade = g0 + (g1 - g0) * (h - h0) / (h1 - h0); break; }
  }
  return Math.max(0, (grade - .05) / .95);
}

/**
 * Authoring entry for live and OfflineAudioContext hosts. One source per voice; it never connects to
 * context.destination itself and never creates, resumes or closes a context.
 */
export function createCampfireSoundGraph(host: Readonly<{ context: BaseAudioContext; destination: AudioNode }>, place: CampfirePlace, rendering = false): CampfireSoundGraph {
  const { context, destination } = host;
  if (destination.context !== context) throw new TypeError('campfire sound: destination must belong to the host context');
  let kit = kits.get(context);
  if (!kit) { kit = { buffers: new Map(), variation: new Map() }; kits.set(context, kit); }
  const sounds = kit;
  const bus = context.createGain(), fireBus = context.createGain();
  bus.gain.value = TRIM; fireBus.gain.value = 1;
  fireBus.connect(bus); bus.connect(destination);
  const live = new Set<Voice>(), played: Partial<Record<CampfireCue, number>> = {};
  let disposed = false, peakSources = 0, peakVoices = 0, dropped = 0, duckUntil = 0;
  const levels = { fire: 0, night: 0 };
  const running = () => !disposed && (context.state === 'running' || rendering && context.state === 'suspended');
  const voices = () => { let n = 0; for (const voice of live) if (!voice.bed) n++; return n; };

  function retire(voice: Voice) {
    if (!live.delete(voice)) return;
    voice.source.onended = null;
    voice.source.disconnect(); voice.gain.disconnect(); voice.pan.disconnect();
  }
  // Stopping fades: a voice cut mid-wave clicks, so it ramps out over a few milliseconds, then lets go of its nodes.
  // A context that no longer runs makes no sound to click, so it lets go at once.
  const fading = new Set<Voice>();
  function unplug() { fireBus.disconnect(); bus.disconnect(); }
  function stop(voice: Voice) {
    if (!live.has(voice)) return;
    if (!running()) { voice.source.stop(context.currentTime); retire(voice); return; }
    live.delete(voice); fading.add(voice);
    const now = context.currentTime;
    hold(voice.gain.gain, now);
    voice.gain.gain.setTargetAtTime(0, now, CAMPFIRE_SOUND_LIMITS.fade / 5);
    voice.source.onended = () => {
      voice.source.onended = null;
      fading.delete(voice);
      voice.source.disconnect(); voice.gain.disconnect(); voice.pan.disconnect();
      if (disposed && !fading.size) unplug();
    };
    voice.source.stop(now + CAMPFIRE_SOUND_LIMITS.fade);
  }
  function prune() { for (const voice of live) if (voice.end <= context.currentTime) retire(voice); }
  function buffer(material: CampfireMaterial, variant: number) {
    const key = `${material}:${variant}`;
    let result = sounds.buffers.get(key);
    if (!result) { result = campfireMaterial(context, material, variant); sounds.buffers.set(key, result); }
    return result;
  }
  /** Horizontal distance and stereo position of the fire for this listener. */
  function locate(listener: CampfireListener) {
    const dx = place.fire[0] - listener.feet[0], dz = place.fire[2] - listener.feet[2];
    const distance = Math.hypot(dx, dz);
    const rightX = -listener.forward[2], rightZ = listener.forward[0], length = Math.hypot(rightX, rightZ) || 1;
    const pan = (dx * rightX + dz * rightZ) / length / Math.max(2, distance);
    return { distance: Number.isFinite(distance) ? distance : Infinity, pan: Number.isFinite(pan) ? pan : 0 };
  }
  function steer(voice: Voice, level: number, pan: number) {
    const now = context.currentTime;
    voice.pan.pan.setTargetAtTime(pan, now, .05);
    hold(voice.gain.gain, now);
    if (voice.bed) {
      voice.gain.gain.setTargetAtTime(level, now, .12);
      // The watchdog: without another renewal the bed fades and stops on its own, even with no timers running.
      voice.gain.gain.setTargetAtTime(0, now + .42, .065);
      voice.end = now + CAMPFIRE_SOUND_LIMITS.watchdog;
      voice.source.stop(voice.end);
    } else voice.gain.gain.setTargetAtTime(level, now, .003);
  }
  function start(material: CampfireMaterial, bed: CampfireBed | null, level: number, pan: number): Voice | null {
    prune();
    if (!running()) return null;
    if (live.size >= CAMPFIRE_SOUND_LIMITS.sources || !bed && voices() >= CAMPFIRE_SOUND_LIMITS.voices) { dropped++; return null; }
    const variant = bed ? 0 : (sounds.variation.get(material) ?? -1) + 1;
    if (!bed) sounds.variation.set(material, variant % CAMPFIRE_VARIANTS);
    const source = context.createBufferSource(), gain = context.createGain(), pan2 = context.createStereoPanner();
    source.buffer = buffer(material, variant % CAMPFIRE_VARIANTS); source.loop = bed !== null;
    gain.gain.value = 0;
    source.connect(gain); gain.connect(pan2); pan2.connect(bed === 'flame' || bed === 'crackle' ? fireBus : bus);
    const lead = .006;
    const voice: Voice = { source, gain, pan: pan2, bed,
      end: context.currentTime + (bed ? CAMPFIRE_SOUND_LIMITS.watchdog : source.buffer.duration + lead) };
    live.add(voice); source.onended = () => retire(voice);
    // Loops begin at a different point each time so a return to the fire never restarts the same crackle.
    const offset = bed ? (context.currentTime * 7.31) % source.buffer.duration : 0;
    source.start(context.currentTime + lead, offset); source.stop(voice.end);
    steer(voice, level, pan);
    peakSources = Math.max(peakSources, live.size); peakVoices = Math.max(peakVoices, voices());
    if (!bed) played[material as CampfireCue] = (played[material as CampfireCue] ?? 0) + 1;
    return voice;
  }
  function bed(material: CampfireBed, level: number, pan: number) {
    let voice: Voice | undefined;
    for (const item of live) if (item.bed === material) { voice = item; break; }
    if (!(level > 1e-4)) { if (voice) stop(voice); return; }
    if (!voice) start(material, material, level, pan);
    else steer(voice, level, pan);
  }
  function quiet() {
    for (const voice of [...live]) stop(voice);
    duckUntil = 0; levels.fire = 0; levels.night = 0;
    fireBus.gain.cancelScheduledValues(context.currentTime); fireBus.gain.value = 1;
  }
  const onState = () => { if (!running()) quiet(); };
  if (!rendering) context.addEventListener('statechange', onState);
  return {
    play(cue, listener) {
      prune();
      if (!running()) return;
      const { distance, pan } = locate(listener), reach = campfireReach(distance);
      // Out of earshot is not a dropped voice: nothing would be heard.
      if (!(reach > 0)) return;
      if (!start(cue, null, CUE_LEVEL[cue] * reach, Math.max(-.85, Math.min(.85, pan)))) return;
      const duck = DUCK[cue];
      if (duck) {
        const now = context.currentTime;
        duckUntil = Math.max(duckUntil, now + duck.hold);
        hold(fireBus.gain, now);
        fireBus.gain.setTargetAtTime(duck.to, now, cue === 'night' ? .35 : .02);
        fireBus.gain.setTargetAtTime(1, duckUntil, cue === 'night' ? .6 : .2);
      }
    },
    update(listener, hour) {
      prune();
      if (!running()) { quiet(); return; }
      const { distance, pan } = locate(listener), reach = campfireReach(distance), dark = campfireDarkness(hour);
      levels.fire = reach; levels.night = reach * dark;
      // Close to the fire it surrounds you; only from a few metres does it sit to one side.
      const side = Math.max(-.6, Math.min(.6, pan));
      bed('flame', BED_LEVEL.flame * reach, side);
      bed('crackle', BED_LEVEL.crackle * reach, side * .9);
      bed('air', BED_LEVEL.air * levels.night, 0);
    },
    quiet,
    dispose() {
      if (disposed) return;
      quiet(); disposed = true;
      if (!rendering) context.removeEventListener('statechange', onState);
      // The last fading voice lets the buses go; with none fading, or a context that no longer plays, they go now.
      if (context.state !== 'running' && !rendering) for (const voice of [...fading]) voice.source.onended?.(new Event('ended'));
      if (!fading.size) unplug();
    },
    inspect() {
      prune();
      return { disposed, audible: running(), sources: live.size, voices: voices(), peakSources, peakVoices,
        played: { ...played }, dropped, beds: { ...levels } };
    },
  };
}

function hold(parameter: AudioParam, at: number) {
  if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(at);
  else { const value = parameter.value; parameter.cancelScheduledValues(at); parameter.setValueAtTime(value, at); }
}
