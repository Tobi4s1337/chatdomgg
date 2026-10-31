import { LandBeds } from './beds';
import { CALLS } from './calls';
import { airHz, bedTargets, STREAM_TRIM_DB, type BedTargets } from './mixplan';
import { freshTake, generator, mix, range, unit } from './rng';
import { describeGenesisSoundscape, groundAt, nearestOnPolyline, pointAlong, type CallPool, type SoundScene } from './scene';
import { bearing, habitatPresence, resolveListener, sampleSpace, type SpaceSample } from './space';
import type { GenesisRecipe, GenesisSoundFrame, GenesisSoundMix, GenesisSoundProfile, GenesisWeather, Vec3, XZ } from './types';
import { CueVoice, landKit, type LandKit } from './voice';
import { dayParts, genesisWeatherAt, mergeWeather, weatherKind, type DayParts } from './weather';

export interface GenesisSoundHost { context: BaseAudioContext; destination: AudioNode }
export interface GenesisSoundInput { recipe: GenesisRecipe; landscapeId: string }

export interface GenesisSoundscape {
  /** Every rendered frame. Schedules nothing while muted, suspended or disposed, and never replays missed time. */
  update(frame: GenesisSoundFrame): void;
  /** Cross-fades to another of the recipe's landscapes over ~3 s (the ceremony's redraw). */
  select(landscapeId: string): void;
  setMix(mix: Partial<GenesisSoundMix>): void;
  /** Dips the land under a voice line or a Chatdom moment, then lets it back over a second. */
  duck(options?: { depthDb?: number; seconds?: number }): void;
  dispose(): void;
}

/** Calls the layer may have sounding at once, and their source nodes. Beds are bounded separately (`BED_SOURCE_LIMIT`). */
export const CALL_LIMITS = { voices: 10, sources: 28, perPool: 2 } as const;
/** All calls together, against the beds: a gull at 40 m is a moment above the land, never a shout over a voice. */
export const CALL_TRIM_DB = -5;
/** How far ahead (realm seconds) waves, calls and grains are scheduled. */
export const LOOKAHEAD = 1.2;
/** Seconds between bed steering passes. */
const STEER_EVERY = 0.1;
/** Realm-to-audio clock disagreement that counts as a jump (seek, stall, paused realm). */
const DRIFT = 0.35;
const LEAD = 0.02;
const FADE = 0.03;
/** A host that stops sending frames goes quiet by itself after this long. */
const WATCHDOG = 0.9;
const SELECT_FADE = 2.5;

export interface GenesisSoundEvent { at: number; call: string; outcome: 'played' | 'full' | 'far'; take?: number; distance?: number }
export interface GenesisSoundInspection {
  state: string;
  landscapeId: string;
  character: string;
  biome: string;
  weather: GenesisWeather | null;
  weatherKind: string | null;
  day: DayParts | null;
  profile: GenesisSoundProfile;
  audible: boolean;
  beds: readonly string[];
  bedSources: number;
  callVoices: number;
  callSources: number;
  peakBedSources: number;
  peakCallSources: number;
  played: Readonly<Record<string, number>>;
  events: readonly GenesisSoundEvent[];
  kitBytes: number;
  targets: BedTargets | null;
}

interface Internal { inspect(): GenesisSoundInspection }
const internals = new WeakMap<GenesisSoundscape, Internal>();

export function inspectGenesisSoundscape(soundscape: GenesisSoundscape): GenesisSoundInspection {
  const internal = internals.get(soundscape);
  if (!internal) throw new TypeError('genesis sound: not made by createGenesisSoundscape');
  return internal.inspect();
}

interface LiveCall { voice: CueVoice; pool: number; output: AudioNode[]; end: number }

/**
 * The sound of a chosen land on the host's graph. Never creates, resumes or closes a context and never touches
 * `context.destination`; the kingdom host (`kingdomAudioHost`) gives it the kingdom's context and master, so the
 * listener's volume, the ceiling and the kingdom's lifecycle apply. `rendering` is set only by the offline renderer.
 */
export function createGenesisSoundscapeGraph(host: GenesisSoundHost, input: GenesisSoundInput, rendering = false): GenesisSoundscape {
  const { context, destination } = host;
  if (!context || typeof context.createGain !== 'function') throw new TypeError('genesis sound: a host AudioContext is required');
  if (!destination || destination.context !== context) throw new TypeError('genesis sound: the destination must belong to the same context');
  const recipe = input.recipe;
  let scene = describeGenesisSoundscape(recipe, input.landscapeId);
  let kit: LandKit | null = null;
  const mixState: Required<GenesisSoundMix> = { muted: false, volume: 1, profile: 'kingdom' };

  // Calls and beds → bus ─┬─▶ alive (watchdog) ─▶ muffle ─▶ guard ─▶ speech pocket ─▶ duck ─▶ master ─▶ ceiling ─▶ host
  //                 send ─┴─▶ space (open air / valley / mountain echo) ─▲
  const muffle = context.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = 19000; muffle.Q.value = 0.5;
  const guard = context.createBiquadFilter(); guard.type = 'highpass'; guard.frequency.value = 70; guard.Q.value = 0.7;
  const pocket = context.createBiquadFilter(); pocket.type = 'peaking'; pocket.frequency.value = 2100; pocket.Q.value = 0.8;
  const duckGain = context.createGain(), master = context.createGain(), ceiling = context.createWaveShaper();
  ceiling.curve = ceilingCurve(); ceiling.oversample = '2x';
  muffle.connect(guard); guard.connect(pocket); pocket.connect(duckGain); duckGain.connect(master); master.connect(ceiling); ceiling.connect(destination);
  const fixed: AudioNode[] = [muffle, guard, pocket, duckGain, master, ceiling];
  let bus!: GainNode, alive!: GainNode, send!: GainNode, space!: ConvolverNode, wet!: GainNode;
  let spaceCharacter = '';
  buildFront();
  applyProfile(0);
  master.gain.value = level();

  let beds: LandBeds | null = null;
  const fading = new Set<LandBeds>();
  const markers = new Set<ConstantSourceNode>();
  const retiring = new Map<ConstantSourceNode, AudioNode[]>();
  const calls = new Set<LiveCall>();
  let lastTake = new Map<number, number>();
  let anchor: number | null = null, scheduledUntil: number | null = null, lastSteer = -Infinity;
  let disposed = false, frontDirty = false;
  let state: { weather: GenesisWeather; day: DayParts; space: SpaceSample; targets: BedTargets } | null = null;
  let peakBedSources = 0, peakCallSources = 0;
  const played: Record<string, number> = {};
  const events: GenesisSoundEvent[] = [];

  function buildFront(): void {
    bus = context.createGain(); alive = context.createGain(); alive.gain.value = 0;
    send = context.createGain(); space = context.createConvolver(); wet = context.createGain();
    space.normalize = false; space.buffer = landSpace(context, scene.character, scene.seed); spaceCharacter = scene.character;
    wet.gain.value = 0.55;
    bus.connect(alive); send.connect(space); space.connect(wet); wet.connect(alive); alive.connect(muffle);
  }
  /**
   * A redraw to a land of another character needs another space. The old front lives on beside the new one until
   * the old land has faded and its space has rung out, so the redraw is a cross-fade, never a cut.
   */
  function retireFront(): void {
    const now = context.currentTime, oldAlive = alive;
    hold(oldAlive.gain, now);
    oldAlive.gain.setTargetAtTime(1, now, 0.05);
    oldAlive.gain.setTargetAtTime(0, now + SELECT_FADE, 0.3);
    const marker = context.createConstantSource(), mute = context.createGain();
    mute.gain.value = 0; marker.connect(mute); mute.connect(oldAlive);
    const nodes: AudioNode[] = [bus, oldAlive, send, space, wet, mute, marker];
    marker.onended = () => { for (const node of nodes) node.disconnect(); retiring.delete(marker); };
    retiring.set(marker, nodes);
    marker.start(now); marker.stop(now + SELECT_FADE + 2.6);
    buildFront();
  }
  function dropRetiring(now: number): void {
    for (const [marker, nodes] of retiring) {
      marker.onended = null;
      try { marker.stop(now); } catch { /* ended */ }
      for (const node of nodes) node.disconnect();
    }
    retiring.clear();
  }
  /** Everything that remembers sound (the space's tail) is replaced: nothing from before comes back. */
  function replaceFront(): void {
    for (const node of [bus, alive, send, space, wet]) node.disconnect();
    buildFront();
    frontDirty = false;
  }

  function level(): number { return mixState.muted || !(mixState.volume > 0) ? 0 : mixState.volume * mixState.volume * 10 ** ((mixState.profile === 'stream' ? STREAM_TRIM_DB : 0) / 20); }
  function applyProfile(at: number): void {
    const stream = mixState.profile === 'stream';
    ease(pocket.gain, stream ? -5 : -2, at, 0.3);
    ease(guard.frequency, stream ? 110 : 70, at, 0.3);
  }
  const running = () => context.state === 'running' || (rendering && context.state === 'suspended');
  const audible = () => !disposed && running() && level() > 0;
  function note(event: GenesisSoundEvent): void { events.push(event); if (events.length > 128) events.shift(); }

  /** Stops every owned sound: `immediate` for a context that is not rendering, otherwise under a short fade. */
  function silence(immediate: boolean): void {
    const now = context.currentTime, stopAt = immediate ? now : now + FADE;
    for (const call of [...calls]) { call.voice.stop(stopAt); if (immediate) retireCall(call); }
    for (const old of [beds, ...fading]) {
      if (!old) continue;
      old.stop(stopAt);
      if (immediate) old.release(); else releaseWhenQuiet(old, FADE);
    }
    beds = null; fading.clear(); state = null; anchor = null;
    if (immediate) { dropRetiring(now); replaceFront(); } else frontDirty = true;
  }

  function releaseWhenQuiet(old: LandBeds, fade: number): void {
    // A silent marker on the context ends after the fade in render time (live or offline), then the beds let go.
    const marker = context.createConstantSource(), mute = context.createGain();
    mute.gain.value = 0; marker.connect(mute); mute.connect(old.output);
    marker.onended = () => { marker.disconnect(); mute.disconnect(); old.release(); fading.delete(old); markers.delete(marker); };
    markers.add(marker);
    marker.start(context.currentTime); marker.stop(context.currentTime + fade + 0.1);
  }

  function retireCall(call: LiveCall): void {
    calls.delete(call);
    call.voice.release();
    for (const node of call.output) node.disconnect();
  }

  const onState = () => { if (!disposed && !running()) silence(true); };
  if (!rendering) context.addEventListener('statechange', onState);

  function ensureKit(): LandKit { return (kit ??= landKit(context, scene.seed)); }

  function steer(frame: GenesisSoundFrame, realm: number, now: number): void {
    const weather = mergeWeather(genesisWeatherAt(scene.weatherSeedKey, scene.character, frame.realmMs), frame.weather);
    const day = dayParts(frame.hour);
    const listener = resolveListener(scene, frame.listener);
    const sampled = sampleSpace(scene, listener);
    const targets = bedTargets(scene, weather, day, sampled, mixState.profile);
    state = { weather, day, space: sampled, targets };
    beds ??= new LandBeds(context, ensureKit(), bus, scene.seed, waveSlots(scene));
    beds.steer(targets, realm, now);
    ease(muffle.frequency, targets.muffle, now, 3);
    ease(send.gain, targets.space, now, 1);
    // The watchdog: alive while frames arrive; a stalled host fades to silence by itself.
    hold(alive.gain, now);
    alive.gain.setTargetAtTime(1, now, 0.25);
    alive.gain.setTargetAtTime(0, now + WATCHDOG, 0.25);
    lastSteer = now;
  }

  function scheduleCalls(from: number, to: number): void {
    if (!state) return;
    const { weather, day, space: sampled } = state;
    const stream = mixState.profile === 'stream';
    scene.pools.forEach((pool, index) => {
      const presence = habitatPresence(pool.habitat, sampled, scene);
      if (presence <= 0.01) return;
      const chance = Math.min(0.95, (pool.rate * pool.slot / 60) * pool.activity(day, weather) * presence * (stream ? pool.stream : 1));
      if (chance <= 0) return;
      const seed = mix(scene.seed, 0xca11, index);
      for (let k = Math.floor(from / pool.slot); k * pool.slot < to; k++) {
        const at = (k + unit(seed, k, 1)) * pool.slot;
        if (at < from || at >= to || unit(seed, k, 2) >= chance) continue;
        playCall(pool, index, seed, k, at, sampled, weather, day);
      }
    });
  }

  function playCall(pool: CallPool, index: number, seed: number, k: number, realmAt: number, sampled: SpaceSample, weather: GenesisWeather, day: DayParts): void {
    const listener = { position: sampled.ear, right: sampled.right };
    const where = placeCall(scene, pool, sampled, seed, k);
    const heard = bearing(listener, where);
    const gain = 1 / (1 + heard.distance / pool.carry);
    if (gain < 0.03) { note({ at: realmAt, call: pool.key, outcome: 'far', distance: heard.distance }); return; }
    const now = context.currentTime, start = Math.max(now + LEAD, anchor! + realmAt);
    const design = CALLS[pool.key];
    const take = freshTake(seed, k, design.takes, lastTake.get(index));
    const voice = new CueVoice(context, start, ensureKit(), generator(mix(seed, k, 7)));
    design.build(voice, generator(mix(seed, k, 99)), take, { weather, night: day.night, kingdom: scene.seed });
    const sounding = [...calls].filter(call => call.end > now);
    const sources = sounding.reduce((sum, call) => sum + call.voice.sourcesAt(start), 0);
    if (sounding.length + 1 > CALL_LIMITS.voices || sources + voice.scheduled.length > CALL_LIMITS.sources
      || sounding.filter(call => call.pool === index).length >= CALL_LIMITS.perPool) {
      voice.release();
      note({ at: realmAt, call: pool.key, outcome: 'full', take });
      return;
    }
    const trim = context.createGain(), air = context.createBiquadFilter(), pan = context.createStereoPanner(), wetSend = context.createGain();
    trim.gain.value = gain * 10 ** ((design.level + CALL_TRIM_DB) / 20);
    air.type = 'lowpass'; air.frequency.value = airHz(heard.distance); air.Q.value = 0.5;
    pan.pan.value = heard.pan;
    wetSend.gain.value = voice.send * (0.6 + Math.min(1, heard.distance / 150) * 0.6);
    voice.out.connect(trim); trim.connect(air); air.connect(pan); pan.connect(bus); pan.connect(wetSend); wetSend.connect(send);
    const call: LiveCall = { voice, pool: index, output: [trim, air, pan, wetSend], end: voice.end };
    calls.add(call);
    voice.start(() => retireCall(call));
    lastTake.set(index, take);
    played[pool.key] = (played[pool.key] ?? 0) + 1;
    note({ at: realmAt, call: pool.key, outcome: 'played', take, distance: Math.round(heard.distance) });
  }

  function cancelPending(now: number): void {
    // Calls scheduled for the future that have not sounded yet are dropped on a seek.
    for (const call of [...calls]) if (call.voice.t > now + LEAD) { call.voice.stop(call.voice.t); retireCall(call); }
    beds?.cancelFuture(now);
  }

  const soundscape: GenesisSoundscape = {
    update(frame) {
      if (disposed || !frame || !Number.isFinite(frame.realmMs) || !Number.isFinite(frame.hour)) return;
      if (!running()) { if (beds || calls.size || retiring.size) silence(true); return; }
      if (level() <= 0) return;
      if (frontDirty) replaceFront();
      const now = context.currentTime, realm = frame.realmMs / 1000;
      if (anchor === null || Math.abs(anchor + realm - now) > DRIFT) {
        const seekBack = scheduledUntil !== null && realm < scheduledUntil - LOOKAHEAD - 0.25;
        if (anchor !== null && seekBack) cancelPending(now);
        if (scheduledUntil === null || seekBack) scheduledUntil = realm;
        anchor = now + LEAD - realm;
      }
      if (now - lastSteer >= STEER_EVERY || !state || !beds) steer(frame, realm, now);
      // Never earlier than now: time that passed while muted, suspended or stalled is consumed, not replayed.
      const from = Math.max(scheduledUntil!, realm), to = realm + LOOKAHEAD;
      if (to > from) {
        beds!.scheduleWaves(from, to, state!.targets.sea.swell, { toContext: t => Math.max(now + LEAD, anchor! + t) });
        scheduleCalls(from, to);
        scheduledUntil = to;
      }
      beds!.feed(now + LOOKAHEAD + 0.4);
      peakBedSources = Math.max(peakBedSources, beds!.sources(now));
      peakCallSources = Math.max(peakCallSources, [...calls].reduce((sum, call) => sum + call.voice.sourcesAt(now), 0));
    },
    select(landscapeId) {
      if (disposed) return;
      const next = describeGenesisSoundscape(recipe, landscapeId);
      if (next.landscapeId === scene.landscapeId) return;
      scene = next; kit = null; lastTake = new Map(); state = null;
      if (beds) { beds.fadeOut(context.currentTime, SELECT_FADE); fading.add(beds); releaseWhenQuiet(beds, SELECT_FADE); beds = null; }
      if (spaceCharacter !== scene.character) { if (frontDirty) replaceFront(); else retireFront(); }
    },
    setMix(next) {
      if (disposed || !next) return;
      const was = level();
      if (next.muted !== undefined) mixState.muted = next.muted !== false;
      if (next.volume !== undefined) {
        const volume = Number(next.volume);
        mixState.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
      }
      if (next.profile === 'kingdom' || next.profile === 'stream') mixState.profile = next.profile;
      const now = context.currentTime, value = level();
      hold(master.gain, now);
      master.gain.setTargetAtTime(value, now, value === 0 ? FADE / 7 : 0.012);
      applyProfile(now);
      if (value === 0 && was > 0) silence(false);
    },
    duck(options = {}) {
      if (disposed) return;
      const depth = Math.max(0, Math.min(24, Number.isFinite(options.depthDb) ? options.depthDb! : 6));
      const seconds = Math.max(0.2, Math.min(30, Number.isFinite(options.seconds) ? options.seconds! : 2));
      const now = context.currentTime;
      hold(duckGain.gain, now);
      duckGain.gain.setTargetAtTime(10 ** (-depth / 20), now, 0.06);
      duckGain.gain.setTargetAtTime(1, now + seconds, 0.4);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (!rendering) context.removeEventListener('statechange', onState);
      const now = context.currentTime;
      for (const call of [...calls]) { call.voice.stop(now); retireCall(call); }
      for (const old of [beds, ...fading]) { old?.stop(now); old?.release(); }
      for (const marker of markers) { marker.onended = null; try { marker.stop(now); } catch { /* ended */ } marker.disconnect(); }
      beds = null; fading.clear(); markers.clear();
      dropRetiring(now);
      for (const node of [...fixed, bus, alive, send, space, wet]) node.disconnect();
    },
  };

  internals.set(soundscape, {
    inspect() {
      const now = context.currentTime, sounding = [...calls].filter(call => call.end > now);
      return {
        state: disposed ? 'disposed' : context.state,
        landscapeId: scene.landscapeId, character: scene.character, biome: scene.biome,
        weather: state?.weather ?? null, weatherKind: state ? weatherKind(state.weather) : null, day: state?.day ?? null,
        profile: mixState.profile, audible: audible(),
        beds: beds?.made ?? [], bedSources: (beds?.sources(now) ?? 0) + [...fading].reduce((sum, old) => sum + old.sources(now), 0),
        callVoices: sounding.length, callSources: sounding.reduce((sum, call) => sum + call.voice.sourcesAt(now), 0),
        peakBedSources, peakCallSources, played: { ...played }, events: [...events],
        kitBytes: kit?.bytes() ?? 0, targets: state?.targets ?? null,
      };
    },
  });
  return soundscape;
}

/** Each shore gets its own fixed wave slot, so the two stretches of sea never break in step. */
function waveSlots(scene: SoundScene): readonly [number, number] {
  return [range(unit(scene.seed, 0x5ea), 8.2, 9.4), range(unit(scene.seed, 0x5eb), 9.6, 11)];
}

/** Where a call comes from: a seeded spot in its habitat, near enough to the ear to matter. */
function placeCall(scene: SoundScene, pool: CallPool, sampled: SpaceSample, seed: number, k: number): Vec3 {
  const u = (salt: number) => unit(seed, k, salt);
  const ear = sampled.ear, here: XZ = [ear[0], ear[2]];
  const lift = range(u(3), pool.lift[0], pool.lift[1]);
  const on = (point: XZ, extra = 0): Vec3 => [point[0], groundAt(scene.hills, point) + lift + extra, point[1]];
  switch (pool.habitat) {
    case 'sea': case 'shore': {
      const along = pointAlong(scene.shoreline, sampled.sea.arc + (u(4) - 0.5) * (pool.habitat === 'sea' ? 340 : 260));
      const out = pool.habitat === 'sea' ? range(u(5), 10, 140) : range(u(5), -6, 14);
      return [along[0] + scene.seaward[0] * out, lift, along[1] + scene.seaward[1] * out];
    }
    case 'offshore': return [scene.buoy[0], 0.5, scene.buoy[1]];
    case 'harbour': return on([scene.harbour[0] + (u(4) - 0.5) * 30, scene.harbour[1] + (u(5) - 0.5) * 30], 0);
    case 'river': {
      const stream = scene.streams[0];
      if (!stream) return on([scene.weir[0], scene.weir[1]]);
      const line = stream.points.map(point => point.position), near = nearestOnPolyline(line, sampled.river.at);
      const point = pointAlong(line, near.arc + (u(4) - 0.5) * 120);
      return [point[0] + (u(5) - 0.5) * 6, Math.max(0, groundAt(scene.hills, point) - 1) + lift, point[1] + (u(6) - 0.5) * 6];
    }
    case 'forest': {
      if (sampled.forest.inside) return on([here[0] + (u(4) - 0.5) * 90, here[1] + (u(5) - 0.5) * 90]);
      const ring = [...scene.forest, scene.forest[0] ?? here], near = nearestOnPolyline(ring, here);
      const edge = pointAlong(ring, (near.arc + (u(4) - 0.5) * 160 + near.length) % Math.max(1, near.length));
      const inward = range(u(5), 4, 30), dx = scene.clearing[0] - edge[0], dz = scene.clearing[1] - edge[1], d = Math.hypot(dx, dz) || 1;
      return on([edge[0] + (dx / d) * inward, edge[1] + (dz / d) * inward]);
    }
    case 'open': {
      const angle = u(4) * Math.PI * 2, radius = range(u(5), 30, 170);
      return on([here[0] + Math.cos(angle) * radius, here[1] + Math.sin(angle) * radius]);
    }
    case 'ridge': {
      const hills = scene.hills.filter(hill => hill.height >= 15);
      const choices = hills.length ? hills : scene.hills;
      const hill = choices[Math.floor(u(4) * choices.length) % Math.max(1, choices.length)];
      if (!hill) return on(here);
      const angle = u(5) * Math.PI * 2, radius = u(6) * hill.radius * 0.4;
      return on([hill.centre[0] + Math.cos(angle) * radius, hill.centre[1] + Math.sin(angle) * radius]);
    }
    case 'pass': return [scene.saddle[0] + (u(4) - 0.5) * scene.passWidth, scene.saddle[1] + lift, scene.saddle[2] + (u(5) - 0.5) * scene.passWidth];
    case 'town': {
      const t = scene.town, x = Math.max(t.minX, Math.min(t.maxX, here[0])), z = Math.max(t.minZ, Math.min(t.maxZ, here[1]));
      return [x + (u(4) - 0.5) * 22, ear[1] - 1.6 + lift, z + (u(5) - 0.5) * 22];
    }
    case 'landmark': return on([scene.landmarkAt[0] + (u(4) - 0.5) * 4, scene.landmarkAt[1] + (u(5) - 0.5) * 4]);
    case 'sky': {
      const angle = u(4) * Math.PI * 2, radius = range(u(5), 900, 2600);
      return [here[0] + Math.cos(angle) * radius, lift, here[1] + Math.sin(angle) * radius];
    }
  }
}

/**
 * The land's own space, authored per character and seeded per kingdom (unit energy, so a send means what it says):
 * the coast is open air with a few low reflections off the cliffs; the valley answers from both sides; the
 * mountain pass throws discrete, darkening echoes back from the ridges, left and right.
 */
const spaces = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();
export function landSpace(context: BaseAudioContext, character: SoundScene['character'], seed: number): AudioBuffer {
  let perContext = spaces.get(context);
  if (!perContext) { perContext = new Map(); spaces.set(context, perContext); }
  const key = `${character}:${seed}`, cached = perContext.get(key);
  if (cached) return cached;
  const rate = context.sampleRate, random = generator(mix(seed, 0x5bace));
  const shape = character === 'mountain-pass'
    ? { seconds: 2.4, tau: 0.42, diffuse: 0.35, echoes: [[0.31, 0.5, -1], [0.58, 0.38, 1], [0.94, 0.27, -1], [1.37, 0.18, 1], [1.86, 0.11, -1]] as const }
    : character === 'river-valley'
      ? { seconds: 1.4, tau: 0.26, diffuse: 0.7, echoes: [[0.09, 0.35, -1], [0.16, 0.3, 1], [0.27, 0.2, -1], [0.41, 0.12, 1]] as const }
      : { seconds: 0.9, tau: 0.14, diffuse: 0.8, echoes: [[0.035, 0.3, 1], [0.071, 0.22, -1], [0.12, 0.12, 1]] as const };
  const length = Math.round(rate * shape.seconds), buffer = context.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const t = i / rate, darken = Math.min(0.95, 0.4 + t * 0.9);
      low = low * darken + (random() * 2 - 1) * (1 - darken);
      data[i] = low * Math.exp(-t / shape.tau) * shape.diffuse * Math.min(1, t / 0.01);
    }
    for (const [time, gain, side] of shape.echoes) {
      // An echo is a short smeared burst, louder on its own side, dulled by the distance it travelled.
      const at = Math.round((time + (channel ? 0.004 : 0)) * rate), here = side < 0 === (channel === 0) ? 1 : 0.45;
      let smear = 0;
      for (let i = 0; i < Math.round(rate * 0.025) && at + i < length; i++) {
        smear = smear * 0.8 + (random() * 2 - 1) * 0.2;
        data[at + i]! += smear * gain * here * Math.exp(-i / (rate * 0.008)) * 6;
      }
    }
    let energy = 0;
    for (const v of data) energy += v * v;
    const scale = 1 / Math.sqrt(energy || 1);
    for (let i = 0; i < length; i++) data[i]! *= scale;
  }
  perContext.set(key, buffer);
  return buffer;
}

export function hold(param: AudioParam, at: number): void {
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(at);
  else { const value = param.value; param.cancelScheduledValues(at); param.setValueAtTime(value, at); }
}
function ease(param: AudioParam, value: number, at: number, tau: number): void { hold(param, at); param.setTargetAtTime(value, at, tau); }

/** Linear to 0.7, then a smooth knee that never passes 0.92: a guarantee, never the level control. */
function ceilingCurve(): Float32Array<ArrayBuffer> {
  const n = 2049, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    curve[i] = Math.sign(x) * (a <= 0.7 ? a : 0.7 + 0.22 * Math.tanh((a - 0.7) / 0.22));
  }
  return curve;
}
