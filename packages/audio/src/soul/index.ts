import { CALLS } from '../genesis-biomes/calls';
import { generator, hashString, mix, unit } from '../genesis-biomes/rng';
import { CueVoice, landKit } from '../genesis-biomes/voice';

export type SoulBiome = 'coastal' | 'woodland' | 'meadow' | 'highland';
export type SoulProfile = 'walk' | 'stream';
export interface SoulListener { position: readonly [number, number, number]; right: readonly [number, number, number] }
/** Structural input: a SoulFrame may contain further simulation fields. */
export interface SoulAudioFrame {
  epochMs: number; hour: number;
  weather: { wind: number; rain: number; snow: number; fog: number; wetness: number; snowCover: number; cloud: number; temperature: number };
  keepers: readonly { role: string; activity: string; position: readonly [number, number, number] }[];
}
export interface SoulAudioUpdate { frame: SoulAudioFrame; biome: SoulBiome; listener?: SoulListener; profile?: SoulProfile; presence?: number }
export interface SoulAudioOptions { seed?: string; muted?: boolean; volume?: number; /** Offline renderer only. */ rendering?: boolean }
export interface SoulAudioInspection { voices: number; sources: number; peakVoices: number; peakSources: number; played: Readonly<Record<string, number>>; muted: boolean; profile: SoulProfile }
export interface SoulAudio {
  update(input: SoulAudioUpdate): void;
  setMuted(muted: boolean): void;
  cue(cue: 'arrival'): void;
  /** Temporarily yield to a witnessed moment or Voice line. */
  duck(options?: { depthDb?: number; seconds?: number }): void;
  inspect(): SoulAudioInspection;
  dispose(): void;
}
export const SOUL_AUDIO_LIMITS = { voices: 12, sources: 28, beds: 3 } as const;
const clamp = (n: number) => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
const hold = (p: AudioParam, t: number) => { if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(t); else { const v = p.value; p.cancelScheduledValues(t); p.setValueAtTime(v, t); } };
const ease = (p: AudioParam, v: number, t: number, tau = .2) => { hold(p, t); p.setTargetAtTime(v, t, tau); };

/** Connect to the existing kingdom master. Does not create, resume, or close a context. */
export function createSoulAudio(context: BaseAudioContext, destination: AudioNode, options: SoulAudioOptions = {}): SoulAudio {
  if (destination.context !== context) throw new TypeError('soul audio: destination belongs to another context');
  const seed = hashString(options.seed ?? 'kingdom-soul');
  const kit = landKit(context, seed), bus = context.createGain(), alive = context.createGain(), pocket = context.createBiquadFilter(), duckGain = context.createGain(), master = context.createGain();
  pocket.type = 'peaking'; pocket.frequency.value = 2000; pocket.Q.value = .8;
  bus.connect(alive); alive.connect(pocket); pocket.connect(duckGain); duckGain.connect(master); master.connect(destination); alive.gain.value = 0;
  const volume = clamp(options.volume ?? 1);
  let muted = options.muted ?? false, disposed = false, profile: SoulProfile = 'walk', lastRealm: number | null = null, lastAudio = 0, next = 0;
  let peakVoices = 0, peakSources = 0;
  const played: Record<string, number> = {};
  const voices = new Set<CueVoice>();
  const lastTake = new Map<string, number>();
  const beds: { source: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode }[] = [];
  // Three differently coloured, independently moving layers; stopped and disconnected on disposal.
  for (const [colour, hz] of [['brown', 520], ['pink', 1800], ['white', 6500]] as const) {
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
    source.buffer = kit[colour]; source.loop = true; filter.type = 'lowpass'; filter.frequency.value = hz; gain.gain.value = 0;
    source.connect(filter); filter.connect(gain); gain.connect(bus); source.start(); beds.push({ source, filter, gain });
  }
  const counts = () => { const now = context.currentTime; const active = [...voices].filter(v => v.sourcesAt(now) > 0); return { voices: active.length, sources: active.reduce((n, v) => n + v.sourcesAt(now), 0) }; };
  function play(key: string, at: number, build: (v: CueVoice, r: () => number) => void, level: number, pan = 0) {
    const r = generator(mix(seed, Math.floor(at * 1000), hashString(key)));
    const v = new CueVoice(context, at, kit, r); build(v, r);
    const c = { voices: voices.size, sources: [...voices].reduce((n, voice) => n + voice.scheduled.length, 0) }, total = v.scheduled.length;
    if (c.voices >= SOUL_AUDIO_LIMITS.voices || c.sources + total > SOUL_AUDIO_LIMITS.sources) { v.release(); return false; }
    const gain = context.createGain(), panner = context.createStereoPanner(); gain.gain.value = level; panner.pan.value = Math.max(-1, Math.min(1, pan));
    v.out.connect(gain); gain.connect(panner); panner.connect(bus); voices.add(v);
    peakVoices = Math.max(peakVoices, c.voices + 1); peakSources = Math.max(peakSources, c.sources + total);
    played[key] = (played[key] ?? 0) + 1;
    v.start(() => { voices.delete(v); v.release(); gain.disconnect(); panner.disconnect(); });
    return true;
  }
  function call(key: keyof typeof CALLS, at: number, frame: SoulAudioFrame, pan: number, level = .24) {
    const design = CALLS[key], prev = lastTake.get(key), candidate = Math.floor(unit(seed, Math.floor(at * 10), hashString(key)) * design.takes);
    const take = candidate === prev && design.takes > 1 ? (candidate + 1) % design.takes : candidate;
    const w = frame.weather;
    if (play(key, at, (v, r) => design.build(v, r, take, { weather: { wind: clamp(w.wind), rain: clamp(w.rain), snow: clamp(w.snow), fog: clamp(w.fog), wet: clamp(w.wetness), storm: 0 }, night: frame.hour < 6 || frame.hour >= 20 ? 1 : 0, kingdom: seed }), level * 10 ** (design.level / 20), pan)) lastTake.set(key, take);
  }
  function note(at: number, index: number, layer: number, biome: SoulBiome, hour: number) {
    // Related modes and a short repeating contour, transposed at long irregular phrase boundaries.
    const scales: Record<SoulBiome, readonly number[]> = {
      coastal: [146.83, 164.81, 185, 220, 246.94, 293.66],
      woodland: [130.81, 146.83, 174.61, 196, 220, 261.63],
      meadow: [164.81, 185, 207.65, 246.94, 277.18, 329.63],
      highland: [146.83, 174.61, 196, 220, 261.63, 293.66],
    };
    const phrase = Math.floor(index / 32), step = Math.floor(((index % 32 + 32) % 32) / 3);
    const contour = [0, 2, 3, 2, 4, 1, 0, 2, 1, 0, 3];
    const hourColour = hour < 6 || hour >= 20 ? 3 : hour < 9 ? 0 : hour < 17 ? 1 : 2;
    const scale = scales[biome], degree = (contour[step % contour.length]! + hourColour + Math.floor(unit(seed, phrase, 44) * 2)) % scale.length;
    const octave = hour < 6 || hour >= 20 ? .5 : 1;
    const hz = scale[degree]! * octave * (layer === 1 ? .5 : layer === 2 ? 2 : 1);
    const length = layer === 0 ? 1.8 : layer === 3 ? 5 : 3.2;
    play(['lute', 'strings', 'woodwind', 'choir'][layer]!, at, (v) => {
      const osc = v.osc(layer === 0 ? 'triangle' : layer === 1 ? 'sawtooth' : layer === 2 ? 'triangle' : 'sine', hz, at, at + length);
      const amp = v.gain(0), filter = v.filter('lowpass', layer === 0 ? 1800 : 900);
      amp.gain.setValueAtTime(0, at); amp.gain.linearRampToValueAtTime(layer === 0 ? .23 : .1, at + (layer === 0 ? .025 : .6));
      amp.gain.setTargetAtTime(0, at + (layer === 0 ? .08 : length - 1), layer === 0 ? .4 : .35);
      v.chain(osc, filter, amp, v.out);
    }, .13, unit(seed, index, layer) * .5 - .25);
  }
  const running = () => context.state === 'running' || (options.rendering && context.state === 'suspended');
  function quiet(immediate: boolean) {
    const t = context.currentTime, end = t + (immediate ? 0 : .03);
    hold(alive.gain, t);
    if (immediate) alive.gain.setValueAtTime(0, t); else alive.gain.linearRampToValueAtTime(0, end);
    for (const v of voices) v.stop(end);
    lastRealm = null; next = 0;
  }
  const stateChange = () => { if (!running()) quiet(true); };
  context.addEventListener('statechange', stateChange);
  const api: SoulAudio = {
    update({ frame, biome, listener, profile: nextProfile, presence = 0 }) {
      if (disposed || !Number.isFinite(frame.epochMs) || !Number.isFinite(frame.hour)) return;
      if (nextProfile) profile = nextProfile;
      const t = context.currentTime, realm = frame.epochMs / 1000;
      if (!running()) { quiet(true); return; }
      if (muted || volume === 0) return;
      // A missing frame fades the whole graph on the audio clock, even when the UI has stalled.
      ease(alive.gain, 1, t, .15); alive.gain.setTargetAtTime(0, t + .9, .25);
      ease(master.gain, volume * volume * (profile === 'stream' ? .48 : 1), t);
      ease(pocket.gain, profile === 'stream' ? -6 : -2, t);
      const w = frame.weather, night = frame.hour < 6 || frame.hour >= 20;
      const snow = clamp(w.snowCover), rain = clamp(w.rain), wind = clamp(w.wind);
      ease(beds[0]!.gain.gain, (.018 + wind * .035 + (biome === 'coastal' ? .035 : biome === 'highland' ? .02 : 0)) * (1 - snow * .4), t, 1);
      ease(beds[1]!.gain.gain, (.012 + wind * .015 + (biome === 'woodland' ? .013 : 0)) * (1 - snow * .5), t, 1);
      ease(beds[2]!.gain.gain, rain * .027 + (night && w.temperature > 8 && !rain ? .003 : 0), t, 1);
      ease(beds[2]!.filter.frequency, night && !rain ? 8500 : 6500, t, 1);
      beds.forEach((bed, i) => ease(bed.source.playbackRate, .85 + .3 * unit(seed, Math.floor(realm / (17 + i * 7)), i), t, 4));
      if (lastRealm === null || Math.abs((realm - lastRealm) - (t - lastAudio)) > .5) { next = realm; for (const v of voices) if (v.t > t + .01) v.stop(t); }
      lastRealm = realm; lastAudio = t;
      // Deterministic decisions in small slots; jumps consume missed events instead of replaying them.
      const spatial = (position: readonly [number, number, number]) => {
        const dx = position[0] - (listener?.position[0] ?? 0), dz = position[2] - (listener?.position[2] ?? 0), distance = Math.hypot(dx, dz);
        return { gain: 1 / (1 + distance / 18), pan: listener ? (dx * listener.right[0] + dz * listener.right[2]) / Math.max(1, distance) : 0 };
      };
      const end = realm + .18;
      for (let slot = Math.ceil(Math.max(next, realm) * 2); slot / 2 < end; slot++) {
        const rt = slot / 2, at = t + Math.max(.02, rt - realm), rnd = unit(seed, slot, 3), pan = unit(seed, slot, 4) * 1.6 - .8;
        const day = !night, dawn = frame.hour >= 5 && frame.hour < 9;
        if (day && rnd < (dawn ? .13 : .05) * (1 - rain) * (1 - clamp(w.fog) * .5)) call(biome === 'coastal' ? 'gull' : biome === 'highland' ? 'skylark' : 'blackbird', at, frame, pan);
        const harbour = frame.keepers.find(k => k.role === 'harbour-master');
        if (biome === 'coastal' && harbour && rnd > .96 && wind > .15) { const location = spatial(harbour.position); call('rigging', at, frame, location.pan, .17 * location.gain); }
        if (rain > .15 && rnd > .92) call('drip', at, frame, pan, .13 * rain);
        const forge = frame.keepers.find(k => /forge|smith/i.test(k.role) && /work|forge|smith/i.test(k.activity));
        if (forge && rnd > .97) {
          const location = spatial(forge.position);
          play('forge', at, v => { const osc = v.osc('triangle', 900 + unit(seed, slot) * 250, at, at + .8), g = v.gain(0); v.envelope(g.gain, at, .002, .35, .12); v.chain(osc, g, v.out); }, .12 * location.gain, location.pan);
        }
        if ((slot % 32 + 32) % 32 < 21 && slot % (night ? 6 : 3) === 0 && unit(seed, Math.floor(slot / 32), 77) < .82) { note(at, slot, 0, biome, frame.hour); if (presence >= 3 && slot % 6 === 0) note(at + .12, slot, 1, biome, frame.hour); if (presence >= 10 && slot % 6 === 3) note(at + .25, slot, 2, biome, frame.hour); if (presence >= 30 && slot % 12 === 0) note(at + .4, slot, 3, biome, frame.hour); }
        if (night && w.temperature > 8 && rain < .2 && rnd < .12) play('cricket', at, v => { const osc = v.osc('sine', 4100 + unit(seed, slot) * 900, at, at + .18), g = v.gain(0); v.envelope(g.gain, at, .005, .12, .035); v.chain(osc, g, v.out); }, .12, pan);
      }
      next = end;
    },
    setMuted(value) { if (muted === value) return; muted = value; if (value) quiet(!running()); },
    duck(options = {}) {
      if (disposed) return;
      const now = context.currentTime, depth = Number.isFinite(options.depthDb) ? Math.max(0, Math.min(24, options.depthDb!)) : 6;
      const seconds = Number.isFinite(options.seconds) ? Math.max(.05, Math.min(30, options.seconds!)) : 2;
      hold(duckGain.gain, now);
      duckGain.gain.setTargetAtTime(10 ** (-depth / 20), now, .08);
      duckGain.gain.setTargetAtTime(1, now + seconds, .4);
    },
    cue(cue) { if (cue !== 'arrival' || disposed || muted || !running()) return; const t = context.currentTime + .02; play('arrival', t, v => { const osc = v.osc('sine', 440, t, t + 2), g = v.gain(0); v.envelope(g.gain, t, .01, .2, .5); v.chain(osc, g, v.out); }, .2); },
    inspect() { return { ...counts(), peakVoices, peakSources, played: { ...played }, muted, profile }; },
    dispose() { if (disposed) return; disposed = true; context.removeEventListener('statechange', stateChange); quiet(true); for (const v of voices) v.release(); voices.clear(); for (const b of beds) { try { b.source.stop(); } catch { /* Already stopped. */ } b.source.disconnect(); b.filter.disconnect(); b.gain.disconnect(); } for (const n of [bus, alive, pocket, duckGain, master]) n.disconnect(); },
  };
  return api;
}
export { renderSoulAudio } from './offline';
