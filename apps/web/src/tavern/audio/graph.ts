import type { Vec3 } from '@chatdom/shared';
import { tavernMaterial, type TavernBed, type TavernMaterial } from './materials';
import type { TavernCue } from './observer';

export const TAVERN_SOUND_LIMITS = Object.freeze({ sources: 12, voices: 6, watchdog: .75 });
export interface TavernListener { feet: Vec3; forward: Vec3 }
export interface TavernSoundPlaces { hearth: Vec3; tables: readonly { id: string; centre: Vec3 }[] }
export interface TavernSoundInspection {
  disposed: boolean; audible: boolean; activeSources: number; activeVoices: number;
  peakSources: number; peakVoices: number; played: Readonly<Partial<Record<TavernMaterial, number>>>;
  dropped: number; murmur: number;
}
export interface TavernSoundGraph {
  play(cue: TavernCue, position: Vec3, listener: TavernListener, delay?: number): void;
  update(listener: TavernListener, walkers: number): void;
  quiet(): void;
  dispose(): void;
  inspect(): TavernSoundInspection;
}
interface Voice { source: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode; end: number; bed: TavernBed | null }
interface Kit { buffers: Map<string, AudioBuffer>; variation: Map<TavernMaterial, number> }
const kits = new WeakMap<BaseAudioContext, Kit>();

/**
 * Authoring entry for live and OfflineAudioContext hosts. One source per voice; the shared destination retains
 * sole ownership of volume, mute, compression and limiting. Never connects to context.destination itself.
 */
export function createTavernSoundGraph(host: Readonly<{ context: BaseAudioContext; destination: AudioNode }>, places: TavernSoundPlaces, rendering = false): TavernSoundGraph {
  const { context, destination } = host;
  if (destination.context !== context) throw new TypeError('tavern sound: destination must belong to the host context');
  let kit = kits.get(context);
  if (!kit) { kit = { buffers: new Map(), variation: new Map() }; kits.set(context, kit); }
  const sounds = kit;
  const bus = context.createGain(), bedBus = context.createGain();
  bus.gain.value = .25; bedBus.gain.value = 1;
  bedBus.connect(bus); bus.connect(destination);
  const live = new Set<Voice>(), played: Partial<Record<TavernMaterial, number>> = {};
  let disposed = false, peak = 0, dropped = 0, murmur = 0, duckUntil = 0;
  const room: Vec3 = places.tables.length ? [
    places.tables.reduce((n, table) => n + table.centre[0], 0) / places.tables.length, 1,
    places.tables.reduce((n, table) => n + table.centre[2], 0) / places.tables.length,
  ] : places.hearth;
  const running = () => !disposed && (context.state === 'running' || rendering && context.state === 'suspended');

  function retire(voice: Voice) {
    if (!live.delete(voice)) return;
    voice.source.onended = null;
    voice.source.disconnect(); voice.gain.disconnect(); voice.pan.disconnect();
  }
  function stop(voice: Voice) { voice.source.stop(context.currentTime); retire(voice); }
  function prune() { for (const voice of live) if (voice.end <= context.currentTime) retire(voice); }
  function buffer(material: TavernMaterial, variant: number) {
    const key = `${material}:${variant}`;
    let result = sounds.buffers.get(key);
    if (!result) { result = tavernMaterial(context, material, variant); sounds.buffers.set(key, result); }
    return result;
  }
  function steer(voice: Voice, position: Vec3, listener: TavernListener, level: number, bed: boolean) {
    const dx = position[0] - listener.feet[0], dz = position[2] - listener.feet[2];
    const distance = Math.hypot(dx, position[1] - listener.feet[1] - 1, dz);
    const rightX = -listener.forward[2], rightZ = listener.forward[0], length = Math.hypot(rightX, rightZ) || 1;
    const pan = Math.max(-.85, Math.min(.85, (dx * rightX + dz * rightZ) / length / Math.max(2, distance)));
    voice.pan.pan.setTargetAtTime(pan, context.currentTime, .04);
    const target = level / (1 + distance * (bed ? .10 : .14));
    hold(voice.gain.gain, context.currentTime);
    voice.gain.gain.setTargetAtTime(target, context.currentTime, bed ? .09 : .003);
    if (bed) {
      voice.gain.gain.setTargetAtTime(0, context.currentTime + .42, .065);
      voice.end = context.currentTime + TAVERN_SOUND_LIMITS.watchdog;
      voice.source.stop(voice.end);
    }
  }
  function start(material: TavernMaterial, position: Vec3, listener: TavernListener, level: number, bed: TavernBed | null, delay = 0): Voice | null {
    prune();
    if (!running()) return null;
    if (live.size >= TAVERN_SOUND_LIMITS.voices) { dropped++; return null; }
    const variant = (sounds.variation.get(material) ?? -1) + 1;
    sounds.variation.set(material, variant % 4);
    const source = context.createBufferSource(), gain = context.createGain(), pan = context.createStereoPanner();
    source.buffer = buffer(material, variant % 4); source.loop = bed !== null;
    gain.gain.value = 0;
    source.connect(gain); gain.connect(pan); pan.connect(bed ? bedBus : bus);
    const lead = .006 + Math.max(0, Math.min(.1, Number.isFinite(delay) ? delay : 0));
    const voice: Voice = { source, gain, pan, end: context.currentTime + (bed ? TAVERN_SOUND_LIMITS.watchdog : source.buffer.duration + lead), bed };
    live.add(voice); source.onended = () => retire(voice);
    source.start(context.currentTime + lead); source.stop(voice.end);
    steer(voice, position, listener, level, bed !== null);
    peak = Math.max(peak, live.size); played[material] = (played[material] ?? 0) + 1;
    return voice;
  }
  function bed(material: TavernBed, position: Vec3, listener: TavernListener, level: number) {
    let voice: Voice | undefined;
    for (const item of live) if (item.bed === material) { voice = item; break; }
    if (!(level > 0)) { if (voice) stop(voice); return; }
    if (!voice) start(material, position, listener, level, material);
    else steer(voice, position, listener, level, true);
  }
  function quiet() {
    for (const voice of [...live]) stop(voice);
    murmur = 0; duckUntil = 0;
    bedBus.gain.cancelScheduledValues(context.currentTime); bedBus.gain.value = 1;
  }
  const onState = () => { if (!running()) quiet(); };
  if (!rendering) context.addEventListener('statechange', onState);
  const graph: TavernSoundGraph = {
    play(cue, position, listener, delay = 0) {
      if (!running()) return;
      const level = cue === 'wood' ? .34 : cue === 'finish' ? .7 : .8;
      if (start(cue, position, listener, level, null, delay) && cue !== 'wood') {
        const now = context.currentTime; duckUntil = Math.max(duckUntil, now + (cue === 'dice' ? .58 : .28));
        hold(bedBus.gain, now); bedBus.gain.setTargetAtTime(.42, now, .012);
        bedBus.gain.setTargetAtTime(1, duckUntil, .16);
      }
    },
    update(listener, walkers) {
      prune();
      if (!running()) { quiet(); return; }
      // Only other walkers produce room air. No fake crowd for the first person in the room.
      murmur = Number.isFinite(walkers) ? Math.min(1, Math.max(0, Math.floor(walkers) - 1) / 7) : 0;
      bed('hearth', places.hearth, listener, .12);
      bed('murmur', room, listener, murmur * .28);
    },
    quiet,
    dispose() {
      if (disposed) return;
      quiet(); disposed = true;
      if (!rendering) context.removeEventListener('statechange', onState);
      bedBus.disconnect(); bus.disconnect();
    },
    inspect() {
      prune();
      return { disposed, audible: running(), activeSources: live.size, activeVoices: live.size,
        peakSources: peak, peakVoices: peak, played: { ...played }, dropped, murmur };
    },
  };
  return graph;
}

function hold(parameter: AudioParam, at: number) {
  if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(at);
  else { const value = parameter.value; parameter.cancelScheduledValues(at); parameter.setValueAtTime(value, at); }
}
