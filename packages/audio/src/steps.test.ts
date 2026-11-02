import { describe, expect, it } from 'vitest';
import { createAudioEngine, inspectKingdomAudio } from './engine';
import { FINISHED_FAMILIES, resolveFamily } from './families';
import { GROUND_STEPS, STEP_GROUNDS, STEP_SURFACES, stepSurfaceOf, type StepSurface } from './cues/steps';
import { placement, TIER_LIMITS } from './mixer';
import { SAMPLE_IDS } from './samples';
import { AUDIO_MATERIALS, type AudioCue, type AudioCueOptions, type AudioMaterial, type KingdomAudio } from './types';

/**
 * Steps on every ground and other walkers' steps, against the real families, mixer and engine, which keep their
 * behaviour. The ground steps live in `cues/steps`; registering them as `step:<ground>` families (two lines in
 * `types.ts` and `families.ts`) is the audio owner's, written out in `work/lanes/play/patches/audio-step-grounds.patch`.
 * Until it lands, the engine tests below run on the six material steps and the ground cases wait for the
 * registration; the ground cues themselves are checked here either way. The fake context keeps time, counts the sources Web Audio would be running, and records what is
 * scheduled on every gain, so levels and ramps are checked on the graph itself.
 */
class Param {
  value: number;
  readonly events: [kind: string, value: number, at: number][] = [];
  constructor(value = 0) { this.value = value; }
  setValueAtTime(value: number, at: number) { this.events.push(['set', value, at]); return this; }
  linearRampToValueAtTime(value: number, at: number) { this.events.push(['ramp', value, at]); return this; }
  exponentialRampToValueAtTime(value: number, at: number) { this.events.push(['exp', value, at]); return this; }
  setTargetAtTime(value: number, at: number) { this.events.push(['target', value, at]); return this; }
  setValueCurveAtTime() { return this; }
  cancelScheduledValues(at: number) { this.events.push(['cancel', 0, at]); return this; }
}

class Node {
  readonly connections = new Set<Node>();
  connect(target: Node) { this.connections.add(target); return target; }
  disconnect() { this.connections.clear(); }
}

class Gain extends Node { readonly gain: Param; constructor(value = 1) { super(); this.gain = new Param(value); } }

class Source extends Node {
  onended: (() => void) | null = null;
  playbackRate = new Param(1);
  frequency = new Param(440);
  buffer: unknown = null;
  loop = false;
  type = 'sine';
  startAt = -1;
  stopAt = Infinity;
  constructor(private readonly context: FakeContext) { super(); }
  start(at = 0) { this.startAt = at; this.context.live.add(this); }
  stop(at = 0) { this.stopAt = at; }
}

class FakeContext {
  currentTime = 0;
  readonly sampleRate = 48000;
  state: AudioContextState = 'suspended';
  readonly destination = new Node();
  readonly live = new Set<Source>();
  readonly gains: Gain[] = [];

  advance(seconds: number) {
    this.currentTime += seconds;
    for (const source of [...this.live]) {
      if (source.stopAt <= this.currentTime) { this.live.delete(source); source.onended?.(); }
    }
  }

  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  addEventListener() {}
  removeEventListener() {}
  createGain() { const node = new Gain(); this.gains.push(node); return node; }
  createBiquadFilter() { return Object.assign(new Node(), { type: 'lowpass', frequency: new Param(), Q: new Param(), gain: new Param() }); }
  createStereoPanner() { return Object.assign(new Node(), { pan: new Param() }); }
  createDynamicsCompressor() {
    return Object.assign(new Node(), { threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param() });
  }
  createWaveShaper() { return Object.assign(new Node(), { curve: null, oversample: 'none' }); }
  createConvolver() { return Object.assign(new Node(), { buffer: null, normalize: true }); }
  createAnalyser() { return Object.assign(new Node(), { fftSize: 1024, getFloatTimeDomainData() {} }); }
  createOscillator() { return new Source(this); }
  createBufferSource() { return new Source(this); }
  createBuffer(channels: number, length: number, rate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { duration: length / rate, length, sampleRate: rate, numberOfChannels: channels, getChannelData: (channel: number) => data[channel]! };
  }
}

async function engine(settings = {}): Promise<{ audio: KingdomAudio; context: FakeContext }> {
  const context = new FakeContext();
  let seed = 23;
  const audio = createAudioEngine(settings, {
    createContext: () => context as unknown as AudioContext,
    loadSample: async (_id, owner) => owner.createBuffer(1, 0.3 * 48000, 48000),
    random: () => (seed = (seed * 16807) % 2147483647) / 2147483647,
  });
  expect(await audio.unlock()).toBe(true);
  return { audio, context };
}

/**
 * The placement gain of the newest voice. A voice makes its input gain, then its own layers, then its distance gain
 * and its room send, so the distance gain is the second-newest gain on the context.
 */
function placed(context: FakeContext): Gain {
  return context.gains.at(-2)!;
}

/** Whether the library registers the grounds as their own step families yet; never half of them. */
const GROUNDS_REGISTERED = STEP_GROUNDS.every(ground => FINISHED_FAMILIES.includes(`step:${ground}`));
/** Every step surface the engine plays in this build. */
const PLAYABLE: readonly StepSurface[] = GROUNDS_REGISTERED ? STEP_SURFACES : AUDIO_MATERIALS;
/** A step cue's options for any surface; a ground is a valid `material` for `step` once it is registered. */
const step = (surface: StepSurface, rest: Omit<AudioCueOptions, 'material'> = {}) => ({ material: surface, ...rest }) as AudioCueOptions;

describe('ground step cues', () => {
  it('registers every ground or none of them', () => {
    expect(STEP_GROUNDS.filter(ground => FINISHED_FAMILIES.includes(`step:${ground}`)).length % STEP_GROUNDS.length).toBe(0);
  });

  it('gives every ground three takes of recordings the library ships, each a short footstep', () => {
    for (const ground of STEP_GROUNDS) {
      const cue = GROUND_STEPS[ground];
      expect(cue.variations, ground).toBe(3);
      expect(cue.samples.length, ground).toBeGreaterThan(0);
      for (const sample of cue.samples) expect(SAMPLE_IDS, `${ground} ${sample}`).toContain(sample);
      expect(typeof cue.build).toBe('function');
    }
  });
});

describe('steps on every surface', () => {
  it('exports every ground and every floor, the land names first', () => {
    expect(STEP_SURFACES).toEqual(['grass', 'meadow', 'earth', 'gravel', 'cobble', 'stone', 'plank', 'sand', 'snow', 'shallows', 'rock',
      'wood', 'fabric', 'glass', 'metal']);
    expect(new Set(STEP_SURFACES).size).toBe(STEP_SURFACES.length);
    for (const material of AUDIO_MATERIALS) expect(STEP_SURFACES).toContain(material);
    for (const ground of STEP_GROUNDS) expect(STEP_SURFACES).toContain(ground);
  });

  it('schedules a footstep on every surface, every take, inside the footstep budget, and releases it', async () => {
    const { audio, context } = await engine();
    for (const surface of PLAYABLE) {
      const family = resolveFamily('step', step(surface));
      expect(family).toMatchObject({ key: `step:${surface}`, tier: 'step', variations: 3 });
      expect(FINISHED_FAMILIES).toContain(`step:${surface}`);
      const played = new Set<number>();
      let previous = -1;
      for (let i = 0; i < 9; i++) {
        expect(audio.cue('step', step(surface, { pan: 0.2, distance: 3 }))).toBe(true);
        const take = inspectKingdomAudio(audio).variations[`step:${surface}`]!;
        expect(take).not.toBe(previous);
        played.add(take); previous = take;
        // A step is a short contact: at most 5 layers, all gone within half a second.
        expect(inspectKingdomAudio(audio).sources).toBeLessThanOrEqual(5);
        context.advance(0.5);
        expect(inspectKingdomAudio(audio)).toMatchObject({ voices: 0, sources: 0 });
      }
      expect(played.size).toBe(3);
    }
    audio.dispose();
  });

  it('never plays a ground as a building material, and keeps unknown materials strict', () => {
    for (const ground of STEP_GROUNDS) {
      for (const kind of ['place', 'remove', 'material'] as const) {
        expect(() => resolveFamily(kind, { material: ground as never })).toThrow(TypeError);
      }
    }
    expect(() => resolveFamily('step', step('lava' as StepSurface))).toThrow(/unknown material lava/);
    expect(() => resolveFamily('place', { material: 'lava' as never })).toThrow(/unknown material lava/);
  });

  it('turns any surface name into a step surface, so land data can never make a step throw', async () => {
    for (const surface of STEP_SURFACES) expect(stepSurfaceOf(surface)).toBe(surface);
    expect(stepSurfaceOf('paving')).toBe('cobble');
    expect(stepSurfaceOf('packed-earth')).toBe('earth');
    expect(stepSurfaceOf('trodden-grass')).toBe('grass');
    expect(stepSurfaceOf('planks')).toBe('plank');
    expect(stepSurfaceOf('water')).toBe('shallows');
    const { audio } = await engine();
    for (const unknown of ['lava', '', 'toString', '__proto__', undefined, null, 7, {}, Symbol('x')]) {
      const surface = stepSurfaceOf(unknown);
      expect(surface).toBe('grass');
      if (GROUNDS_REGISTERED) expect(() => audio.cue('step', step(surface))).not.toThrow();
    }
    expect(stepSurfaceOf('lava', 'earth')).toBe('earth');
    audio.dispose();
  });

  it('keeps every existing family exactly as it was', () => {
    const existing: Record<string, number> = {
      'step:wood': -8.6, 'step:stone': -1.2, 'step:earth': -3.3, 'place:earth': -4.8, 'remove:earth': -0.7, 'material:earth': 1.1,
      'place:stone': 1.8, 'remove:stone': 4.5, 'material:stone': 10.5,
    };
    for (const [key, fader] of Object.entries(existing)) {
      const [kind, material] = key.split(':') as [AudioCue, AudioMaterial];
      expect(resolveFamily(kind, { material })).toMatchObject({ key, fader, variations: 3 });
    }
    for (const key of ['wood:wood', 'wood:brass', 'wood:parchment', 'light', 'wave', 'beacon']) expect(FINISHED_FAMILIES).toContain(key);
    expect(resolveFamily('step', {}).key).toBe('step:wood');
    expect(resolveFamily('step', { material: 'earth' }).samples).toEqual(['step-earth-a', 'step-earth-b', 'step-earth-c']);
  });

  it.runIf(GROUNDS_REGISTERED)('places a ground step by the same distance law as every other step', async () => {
    const { audio, context } = await engine();
    expect(audio.cue('step', step('grass', { distance: 6 }))).toBe(true);
    expect(placed(context).gain.value).toBe(placement({ distance: 6 })!.gain);
    audio.dispose();
  });
});

describe('other walkers within 12 m', () => {
  it('stay inside the footstep tier while you walk through a crowd on mixed ground', async () => {
    const { audio, context } = await engine();
    let own = 0, ownPlayed = 0, theirs = 0, theirsPlayed = 0;
    // Ten seconds of six walkers 2.5–12 m away, placed as the walk places them (8 + 2d m: 6 dB under yours), and you walking at a run, a step every 0.3 s, in first person on the shallows'
    // five-layer step, the heaviest there is.
    const walkers = Array.from({ length: 6 }, (_, index) => ({
      distance: 2.5 + index * 1.9, every: 0.42 + index * 0.02, next: index * 0.05, surface: PLAYABLE[(index * 4) % PLAYABLE.length]!,
    }));
    let nextOwn = 0;
    for (let tick = 0; tick < 2000; tick++) {
      context.advance(0.005);
      const now = context.currentTime;
      for (const walker of walkers) {
        if (now < walker.next) continue;
        walker.next += walker.every;
        theirs++;
        if (audio.cue('step', step(walker.surface, { distance: 8 + 2 * walker.distance, pan: 0.3 }))) theirsPlayed++;
      }
      if (now >= nextOwn) {
        nextOwn += 0.3;
        own++;
        if (audio.cue('step', step(GROUNDS_REGISTERED ? 'shallows' : 'stone', { distance: 0.4 }))) ownPlayed++;
      }
      expect(inspectKingdomAudio(audio).voices).toBeLessThanOrEqual(TIER_LIMITS.step.voices + 6);
      expect(context.live.size).toBeLessThanOrEqual(64);
    }
    // Your nearer steps take the room of quieter ones; the crowd is heard, not silenced.
    expect(ownPlayed).toBe(own);
    expect(theirsPlayed).toBeGreaterThan(theirs * 0.5);
    audio.dispose();
  });
});
