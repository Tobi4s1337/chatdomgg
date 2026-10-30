import { describe, expect, it } from 'vitest';
import { createAudioEngine, inspectKingdomAudio } from './engine';
import { AUDIO_MATERIALS } from './types';

/**
 * A step flood against the real families and mixer. The fake context below only keeps time and counts the source
 * nodes that are actually started and not yet ended, so the bound is checked on what Web Audio would be running,
 * not on the mixer's own bookkeeping.
 */
class Param {
  value: number;
  constructor(value = 0) { this.value = value; }
  setValueAtTime(value: number) { this.value = value; return this; }
  linearRampToValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  setTargetAtTime() { return this; }
  setValueCurveAtTime() { return this; }
  cancelScheduledValues() { return this; }
}

class Node {
  connect(target: Node) { return target; }
  disconnect() {}
}

class Source extends Node {
  onended: (() => void) | null = null;
  playbackRate = new Param(1);
  frequency = new Param(440);
  buffer: unknown = null;
  loop = false;
  type = 'sine';
  startAt = -1;
  stopAt = Infinity;
  ended = false;
  constructor(private readonly context: FakeContext) { super(); }
  start(at = 0) {
    if (this.startAt >= 0) throw new Error('started twice');
    this.startAt = at;
    this.context.live.add(this);
  }
  stop(at = 0) {
    if (this.startAt < 0) throw new Error('stopped before start');
    this.stopAt = at;
  }
}

class FakeContext {
  currentTime = 0;
  readonly sampleRate = 48000;
  state: AudioContextState = 'suspended';
  readonly destination = new Node();
  readonly live = new Set<Source>();
  peakSources = 0;

  /** Moves time on and ends every source whose stop time has passed, as the audio thread would. */
  advance(seconds: number) {
    this.currentTime += seconds;
    for (const source of [...this.live]) {
      if (source.stopAt <= this.currentTime) { source.ended = true; this.live.delete(source); source.onended?.(); }
    }
  }

  observe() { this.peakSources = Math.max(this.peakSources, this.live.size); }

  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  addEventListener() {}
  removeEventListener() {}
  createGain() { return Object.assign(new Node(), { gain: new Param(1) }); }
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

describe('kingdom audio budget', () => {
  it('keeps control and beacon feedback through a footstep flood, inside 16 voices and 64 sources', async () => {
    const context = new FakeContext();
    let seed = 11;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const audio = createAudioEngine({}, {
      createContext: () => context as unknown as AudioContext,
      loadSample: async (_id, owner) => owner.createBuffer(1, 0.45 * 48000, 48000),
      random,
    });
    expect(await audio.unlock()).toBe(true);
    const inspect = () => inspectKingdomAudio(audio);

    let steps = 0, stepsPlayed = 0, maxVoices = 0;
    const answers: Record<string, boolean> = {};
    // Two seconds of a crowd walking 12–40 m away on every surface, one footstep request every 5 ms.
    for (let tick = 0; tick < 400; tick++) {
      context.advance(0.005);
      const material = AUDIO_MATERIALS[tick % AUDIO_MATERIALS.length]!;
      steps++;
      if (audio.cue('step', { material, distance: 12 + (tick % 8) * 4, pan: ((tick % 9) - 4) / 4 })) stepsPlayed++;

      if (tick === 120) answers.control = audio.cue('wood');
      if (tick === 160) answers.beacon = audio.cue('beacon');
      if (tick === 200) answers.ownStep = audio.cue('step', { material: 'stone' });
      if (tick === 230) answers.brassDuringBeacon = audio.cue('wood', { ui: 'brass' });
      if (tick === 232) answers.ownStepBesideBeaconAndControl = audio.cue('step', { material: 'wood', pan: 0.1 });
      if (tick === 260) answers.place = audio.cue('place', { material: 'glass' });

      context.observe();
      maxVoices = Math.max(maxVoices, inspect().voices);
      expect(context.live.size).toBeLessThanOrEqual(64);
      expect(inspect().voices).toBeLessThanOrEqual(16);
    }

    expect(answers).toEqual({
      control: true, beacon: true, ownStep: true, brassDuringBeacon: true, ownStepBesideBeaconAndControl: true, place: true,
    });
    // The flood was bounded, not silenced: steps kept playing, most requests were held back.
    expect(stepsPlayed).toBeGreaterThan(20);
    expect(stepsPlayed).toBeLessThan(steps / 2);
    expect(context.peakSources).toBeLessThanOrEqual(64);
    expect(maxVoices).toBeLessThanOrEqual(16);

    // Everything that started also ends and is released.
    context.advance(6);
    expect(context.live.size).toBe(0);
    expect(inspect()).toMatchObject({ voices: 0, sources: 0 });
    audio.dispose();
  });
});
