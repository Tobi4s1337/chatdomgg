import { describe, expect, it } from 'vitest';
import { soulAt } from '../../../world/src/soul';
import { createSoulAudio, SOUL_AUDIO_LIMITS } from './index';

class Param {
  value: number;
  events: [string, number, number][] = [];
  constructor(value = 0) { this.value = value; }
  private log(kind: string, value: number, at: number) { this.events.push([kind, value, at]); return this; }
  setValueAtTime(value: number, at: number) { this.value = value; return this.log('set', value, at); }
  linearRampToValueAtTime(value: number, at: number) { return this.log('linear', value, at); }
  exponentialRampToValueAtTime(value: number, at: number) { if (!(value > 0)) throw new RangeError('exponential ramp to 0'); return this.log('exp', value, at); }
  setTargetAtTime(value: number, at: number, tau: number) { if (!(tau > 0)) throw new RangeError('tau'); return this.log('target', value, at); }
  setValueCurveAtTime(curve: Float32Array, at: number) { return this.log('curve', curve[curve.length - 1]!, at); }
  cancelScheduledValues(at: number) { return this.log('cancel', 0, at); }
  cancelAndHoldAtTime(at: number) { return this.log('hold', 0, at); }
  /** The last target this parameter was sent towards. */
  get target() { const e = [...this.events].reverse().find(([kind]) => kind === 'target' || kind === 'set'); return e ? e[1] : this.value; }
}

class Node {
  connections = new Set<Node>();
  disconnected = 0;
  constructor(readonly context: FakeContext) { context.nodes.push(this); }
  connect(target: Node) { this.connections.add(target); return target; }
  disconnect() { this.connections.clear(); this.disconnected++; }
}

class Source extends Node {
  onended: (() => void) | null = null;
  frequency = new Param(440);
  playbackRate = new Param(1);
  buffer: unknown = null;
  loop = false;
  type = 'sine';
  startAt = -1;
  stopAt = Infinity;
  ended = false;
  start(at = 0) {
    if (this.startAt >= 0) throw new Error('started twice');
    this.startAt = at; this.context.started.add(this);
  }
  stop(at = 0) {
    if (this.startAt < 0) throw new Error('stopped before start');
    if (this.ended) return;
    this.stopAt = at;
  }
}

class FakeContext {
  currentTime = 0;
  readonly sampleRate = 48000;
  state: AudioContextState = 'running';
  readonly nodes: Node[] = [];
  readonly started = new Set<Source>();
  readonly destination: Node;
  private listeners = new Set<() => void>();
  peakSources = 0;
  constructor() { this.destination = new Node(this); }

  /** Moves time on and ends every source whose stop time has passed, as the audio thread would. */
  advance(seconds: number) {
    if (this.state === 'running') this.currentTime += seconds;
    for (const source of [...this.started]) {
      if (source.stopAt <= this.currentTime && !source.ended) { source.ended = true; this.started.delete(source); source.onended?.(); }
    }
  }
  /** Sources that would be sounding (or waiting to) right now. */
  get live() { let n = 0; for (const s of this.started) if (!s.ended && s.stopAt > this.currentTime) n++; return n; }
  observe() { this.peakSources = Math.max(this.peakSources, this.live); }
  setState(state: AudioContextState) { this.state = state; for (const listener of this.listeners) listener(); }

  addEventListener(_: string, listener: () => void) { this.listeners.add(listener); }
  removeEventListener(_: string, listener: () => void) { this.listeners.delete(listener); }
  get listening() { return this.listeners.size; }
  createGain() { return Object.assign(new Node(this), { gain: new Param(1) }); }
  createBiquadFilter() { return Object.assign(new Node(this), { type: 'lowpass', frequency: new Param(), Q: new Param(), gain: new Param() }); }
  createStereoPanner() { return Object.assign(new Node(this), { pan: new Param() }); }
  createDynamicsCompressor() {
    return Object.assign(new Node(this), { threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param() });
  }
  createWaveShaper() { return Object.assign(new Node(this), { curve: null, oversample: 'none' }); }
  createConvolver() { return Object.assign(new Node(this), { buffer: null, normalize: true }); }
  createOscillator() { return new Source(this); }
  createBufferSource() { return new Source(this); }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (c: number) => data[c]! };
  }
}


describe('soul audio lifecycle', () => {
  it('bounds actual scheduled sources across weather, seek, mute, suspension and disposal', () => {
    const c = new FakeContext();
    const sound = createSoulAudio(c as unknown as BaseAudioContext, c.destination as unknown as AudioNode, { seed: 'test' });
    const base = Date.UTC(2026, 6, 15, 12);
    const tick = (seconds: number, offset = 0) => {
      for (let i = 0; i < seconds * 30; i++) {
        const frame = soulAt({ seed: 42, biome: 'coastal', population: 40 }, base + (c.currentTime + offset) * 1000);
        frame.weather.rain = .8;
        sound.update({ frame, biome: 'coastal', presence: 40 });
        c.observe(); c.advance(1 / 30);
      }
    };
    tick(20);
    const duck = c.nodes[4] as Node & { gain: Param };
    const duckAt = c.currentTime; sound.duck();
    expect(duck.gain.events).toContainEqual(['target', 10 ** (-6 / 20), duckAt]);
    expect(duck.gain.events).toContainEqual(['target', 1, duckAt + 2]);
    const duckEvents = duck.gain.events.length; tick(2, 86400);
    expect(duck.gain.events.length).toBe(duckEvents);
    expect(sound.inspect().peakSources).toBeLessThanOrEqual(SOUL_AUDIO_LIMITS.sources);
    expect(c.peakSources).toBeLessThanOrEqual(SOUL_AUDIO_LIMITS.sources + SOUL_AUDIO_LIMITS.beds);
    expect(sound.inspect().played.arrival).toBeUndefined();
    const alive = c.nodes[2] as Node & { gain: Param };
    const muteAt = c.currentTime;
    sound.setMuted(true);
    expect(alive.gain.events).toContainEqual(['linear', 0, muteAt + .03]);
    const automationCount = alive.gain.events.length;
    sound.update({ frame: soulAt({ seed: 42, biome: 'coastal', population: 40 }, base + muteAt * 1000), biome: 'coastal' });
    expect(alive.gain.events.length).toBe(automationCount);
    c.advance(.2);
    expect(c.live).toBe(SOUL_AUDIO_LIMITS.beds);
    sound.setMuted(false); tick(2);
    c.setState('suspended'); expect(sound.inspect().voices).toBe(0);
    c.setState('running'); c.advance(.1); tick(2);
    sound.dispose(); c.advance(.1);
    expect(c.live).toBe(0); expect(c.listening).toBe(0);
  });
  it('only sounds rigging when a harbour keeper exists', () => {
    const c = new FakeContext();
    const sound = createSoulAudio(c as unknown as BaseAudioContext, c.destination as unknown as AudioNode, { seed: 'harbour-test' });
    const base = Date.UTC(2026, 6, 15, 12);
    const run = (harbour: boolean) => {
      for (let i = 0; i < 300; i++) {
        const frame = soulAt({ seed: 42, biome: 'coastal', population: 1 }, base + c.currentTime * 1000);
        frame.weather.wind = .8;
        if (!harbour) frame.keepers = frame.keepers.filter(k => k.role !== 'harbour-master');
        sound.update({ frame, biome: 'coastal' }); c.advance(.5);
      }
    };
    run(false); expect(sound.inspect().played.rigging).toBeUndefined();
    run(true); expect(sound.inspect().played.rigging).toBeGreaterThan(0);
    sound.dispose();
  });

  it('schedules a valid musical contour before the Unix epoch', () => {
    const c = new FakeContext();
    const sound = createSoulAudio(c as unknown as BaseAudioContext, c.destination as unknown as AudioNode, { seed: 'past' });
    for (let i = 0; i < 100; i++) {
      const frame = soulAt({ seed: 42, biome: 'meadow', population: 1 }, -100_000 + c.currentTime * 1000);
      sound.update({ frame, biome: 'meadow' }); c.advance(.5);
    }
    expect(sound.inspect().played.lute).toBeGreaterThan(0);
    expect([...c.started].every(source => Number.isFinite(source.frequency.value) && source.frequency.value > 0)).toBe(true);
    sound.dispose();
  });

});
