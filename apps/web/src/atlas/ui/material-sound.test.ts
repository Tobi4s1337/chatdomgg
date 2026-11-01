import { describe, expect, it, vi } from 'vitest';
import { AtlasMaterialSound } from './material-sound';

class FakeParam {
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
}
class FakeNode {
  connect = vi.fn();
  disconnect = vi.fn();
}
class FakeSource extends FakeNode {
  frequency = new FakeParam();
  type = '';
  buffer: unknown;
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
}
class FakeContext {
  state: AudioContextState = 'running';
  currentTime = 0;
  sampleRate = 8_000;
  destination = new FakeNode();
  sources: FakeSource[] = [];
  oscillators: FakeSource[] = [];
  createBufferSource = () => { const node = new FakeSource(); this.sources.push(node); return node; };
  createOscillator = () => { const node = new FakeSource(); this.oscillators.push(node); return node; };
  createBuffer = (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) });
  createBiquadFilter = () => Object.assign(new FakeNode(), { type: '', frequency: new FakeParam(), Q: new FakeParam() });
  createGain = () => Object.assign(new FakeNode(), { gain: new FakeParam() });
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => { this.state = 'closed'; });
}
function rig(context = new FakeContext()) {
  let at = 0;
  const factory = vi.fn(() => context as unknown as AudioContext);
  const sound = new AtlasMaterialSound({ now: () => at, contextFactory: factory });
  return { sound, context, factory, advance: (ms = 50) => { at += ms; } };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('Atlas material sound ownership', () => {
  it('allocates nothing until a control gesture and never opens audio while muted', () => {
    const { sound, factory } = rig();
    expect(factory).not.toHaveBeenCalled();
    sound.setMuted(true);
    sound.play('press');
    expect(factory).not.toHaveBeenCalled();
    sound.setMuted(false);
    sound.play('press');
    expect(factory).toHaveBeenCalledTimes(1);
    sound.dispose();
  });

  it('bounds a rapid burst and evicts the oldest of three overlapping cues', () => {
    const { sound, context, advance } = rig();
    sound.play('shutter');
    for (let i = 0; i < 20; i++) sound.play('press');
    expect(context.sources).toHaveLength(1);
    for (let i = 0; i < 3; i++) { advance(); sound.play('shutter'); }
    expect(context.sources).toHaveLength(4);
    expect(context.sources[0]!.stop).toHaveBeenLastCalledWith();
    expect(context.sources[0]!.disconnect).toHaveBeenCalledTimes(1);
    expect(context.sources[1]!.disconnect).not.toHaveBeenCalled();
    sound.dispose();
    expect(context.sources.every(source => source.disconnect.mock.calls.length === 1)).toBe(true);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('mute kills the current voices immediately and unmuting never replays them', () => {
    const { sound, context, advance } = rig();
    sound.play('wax');
    sound.setMuted(true);
    expect(context.sources[0]!.stop).toHaveBeenLastCalledWith();
    expect(context.close).not.toHaveBeenCalled();
    advance(); sound.play('wax');
    expect(context.sources).toHaveLength(1);
    sound.setMuted(false);
    expect(context.sources).toHaveLength(1);
    advance(); sound.play('press');
    expect(context.sources).toHaveLength(2);
    sound.dispose();
  });

  it('disposes a suspended unlock without a late cue or a second context', async () => {
    const context = new FakeContext(); context.state = 'suspended';
    let unlock!: () => void;
    context.resume.mockImplementation(() => new Promise<void>(resolve => { unlock = () => { context.state = 'running'; resolve(); }; }));
    const { sound, factory } = rig(context);
    sound.play('wax');
    expect(context.resume).toHaveBeenCalledTimes(1);
    sound.dispose(); sound.dispose();
    unlock(); await settle();
    sound.play('press');
    expect(context.sources).toHaveLength(0);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('coalesces suspended requests to the latest intent and drops a stale unlock', async () => {
    const context = new FakeContext(); context.state = 'suspended';
    let unlock!: () => void;
    context.resume.mockImplementation(() => new Promise<void>(resolve => { unlock = () => { context.state = 'running'; resolve(); }; }));
    const { sound, advance } = rig(context);
    sound.play('press'); advance(); sound.play('shutter');
    expect(context.resume).toHaveBeenCalledTimes(1);
    advance(200); unlock(); await settle();
    expect(context.sources).toHaveLength(0);
    advance(); sound.play('wax');
    expect(context.sources).toHaveLength(1);
    sound.dispose();
  });

  it('survives an unavailable or rejected audio device without an unhandled failure', async () => {
    const factory = vi.fn((): AudioContext => { throw new Error('Device unavailable'); });
    const absent = new AtlasMaterialSound({ contextFactory: factory });
    expect(() => { absent.play('press'); absent.play('wax'); absent.dispose(); }).not.toThrow();
    expect(factory).toHaveBeenCalledTimes(1);
    const context = new FakeContext(); context.state = 'suspended';
    context.resume.mockRejectedValue(new Error('Autoplay refused'));
    const { sound } = rig(context);
    sound.play('press'); await settle();
    expect(context.sources).toHaveLength(0);
    expect(() => sound.dispose()).not.toThrow();
  });

  it('varies consecutive strikes and releases naturally ended sources', () => {
    const { sound, context, advance } = rig();
    sound.play('press'); advance(); sound.play('press');
    expect(context.oscillators[0]!.frequency.setValueAtTime.mock.calls[0]![0]).not.toBe(context.oscillators[1]!.frequency.setValueAtTime.mock.calls[0]![0]);
    context.sources[0]!.onended?.();
    expect(context.sources[0]!.disconnect).toHaveBeenCalledTimes(1);
    sound.dispose();
    expect(context.sources[0]!.disconnect).toHaveBeenCalledTimes(1);
  });
});
