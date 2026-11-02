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
function rig(context = new FakeContext(), afterPaint: (run: () => void) => () => void = (run) => { run(); return () => {}; }) {
  let at = 0;
  const factory = vi.fn(() => context as unknown as AudioContext);
  const sound = new AtlasMaterialSound({ now: () => at, contextFactory: factory, afterPaint });
  return { sound, context, factory, advance: (ms = 50) => { at += ms; } };
}
/** A painted frame that arrives only when the test says so. */
function frames() {
  const queue: Array<{ run: () => void; cancelled: boolean }> = [];
  const afterPaint = (run: () => void) => {
    const entry = { run, cancelled: false };
    queue.push(entry);
    return () => { entry.cancelled = true; };
  };
  const paint = () => { for (const entry of queue.splice(0)) if (!entry.cancelled) entry.run(); };
  return { afterPaint, paint, waiting: () => queue.filter(entry => !entry.cancelled).length };
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
    // Each gesture asks for its own unlock; only the latest cue is kept.
    expect(context.resume).toHaveBeenCalledTimes(2);
    advance(200); unlock(); await settle();
    expect(context.sources).toHaveLength(0);
    advance(); sound.play('wax');
    expect(context.sources).toHaveLength(1);
    sound.dispose();
  });

  it('survives an unavailable or rejected audio device without an unhandled failure', async () => {
    const factory = vi.fn((): AudioContext => { throw new Error('Device unavailable'); });
    const absent = new AtlasMaterialSound({ contextFactory: factory, afterPaint: (run) => { run(); return () => {}; } });
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

  it('opens no audio device inside a selection gesture: the first cue follows the painted answer', () => {
    const clock = frames();
    const { sound, context, factory, advance } = rig(new FakeContext(), clock.afterPaint);
    sound.play('wax');
    expect(factory).not.toHaveBeenCalled();
    expect(context.sources).toHaveLength(0);
    advance(); sound.play('press');
    expect(clock.waiting()).toBe(1);
    advance(20); clock.paint();
    expect(factory).toHaveBeenCalledTimes(1);
    // The latest cue asked for before the frame is the one struck, once.
    expect(context.sources).toHaveLength(1);
    expect(context.oscillators[0]!.frequency.setValueAtTime.mock.calls[0]![0]).toBeGreaterThan(400);
    advance(); sound.play('wax');
    expect(context.sources).toHaveLength(2);
    expect(clock.waiting()).toBe(0);
    sound.dispose();
  });

  it('still strikes a first cue whose answer took a finger-lift and two frames to paint', () => {
    const clock = frames();
    const { sound, context, advance } = rig(new FakeContext(), clock.afterPaint);
    sound.play('wax');
    advance(300); clock.paint();
    expect(context.sources).toHaveLength(1);
    sound.dispose();
  });

  it('drops a deferred first cue that is muted, stale or disposed before its frame', () => {
    const muted = frames();
    const a = rig(new FakeContext(), muted.afterPaint);
    a.sound.play('wax');
    a.sound.setMuted(true);
    muted.paint();
    expect(a.factory).not.toHaveBeenCalled();

    const late = frames();
    const b = rig(new FakeContext(), late.afterPaint);
    b.sound.play('wax');
    b.advance(1_000); late.paint();
    expect(b.factory).toHaveBeenCalledTimes(1);
    expect(b.context.sources).toHaveLength(0);
    b.sound.dispose();

    const gone = frames();
    const c = rig(new FakeContext(), gone.afterPaint);
    c.sound.play('wax');
    c.sound.dispose();
    expect(gone.waiting()).toBe(0);
    gone.paint();
    expect(c.factory).not.toHaveBeenCalled();
  });

  it('prime opens and unlocks the device inside a quiet gesture without sounding, then cues strike at once', async () => {
    const context = new FakeContext();
    context.state = 'suspended';
    const clock = frames();
    const { sound, factory, advance } = rig(context, clock.afterPaint);
    sound.prime();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(context.sources).toHaveLength(0);
    await settle();
    advance(); sound.play('wax');
    expect(clock.waiting()).toBe(0);
    expect(context.sources).toHaveLength(1);
    sound.prime();
    expect(factory).toHaveBeenCalledTimes(1);
    sound.dispose();
    sound.prime();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('a deferred open that a strict browser keeps suspended never blocks the next gesture from unlocking it', async () => {
    // Safari and strict autoplay settings start audio only inside a gesture: a resume asked for after the painted
    // answer stays pending for ever. The first cue is silent, never late; the next gesture's own request unlocks.
    const context = new FakeContext(); context.state = 'suspended';
    const unlocks: Array<() => void> = [];
    let gesture = false;
    context.resume.mockImplementation(() => new Promise<void>(resolve => {
      if (gesture) unlocks.push(() => { context.state = 'running'; resolve(); });
    }));
    const clock = frames();
    const { sound, factory, advance } = rig(context, clock.afterPaint);
    gesture = true; sound.play('wax'); gesture = false;
    advance(30); clock.paint(); await settle();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(unlocks).toHaveLength(0);
    expect(context.sources).toHaveLength(0);

    advance(2_000);
    gesture = true; sound.play('press'); gesture = false;
    expect(context.resume).toHaveBeenCalledTimes(2);
    advance(40); unlocks[0]!(); await settle();
    expect(context.sources).toHaveLength(1);
    expect(context.oscillators[0]!.frequency.setValueAtTime.mock.calls[0]![0]).toBeGreaterThan(400);
    advance(); sound.play('wax');
    expect(context.sources).toHaveLength(2);
    expect(factory).toHaveBeenCalledTimes(1);
    sound.dispose();
  });

  it('one unlock strikes the latest cue once, however many requests settle', async () => {
    const context = new FakeContext(); context.state = 'suspended';
    const unlocks: Array<() => void> = [];
    context.resume.mockImplementation(() => new Promise<void>(resolve => { unlocks.push(() => { context.state = 'running'; resolve(); }); }));
    const { sound, advance } = rig(context);
    sound.play('press'); advance(); sound.play('wax');
    for (const unlock of unlocks) unlock();
    await settle();
    expect(context.sources).toHaveLength(1);
    expect(context.oscillators[0]!.frequency.setValueAtTime.mock.calls[0]![0]).toBeLessThan(200);
    sound.dispose();
  });

  it('a refused request drops only its own cue, not a newer one', async () => {
    const context = new FakeContext(); context.state = 'suspended';
    const answers: Array<{ ok: () => void; no: () => void }> = [];
    context.resume.mockImplementation(() => new Promise<void>((resolve, reject) => {
      answers.push({ ok: () => { context.state = 'running'; resolve(); }, no: () => reject(new Error('NotAllowedError')) });
    }));
    const { sound, advance } = rig(context);
    sound.play('press'); advance(); sound.play('wax');
    answers[0]!.no(); await settle();
    answers[1]!.ok(); await settle();
    expect(context.sources).toHaveLength(1);
    sound.dispose();
  });

  it('never primes while muted', () => {
    const { sound, factory } = rig();
    sound.setMuted(true);
    sound.prime();
    expect(factory).not.toHaveBeenCalled();
  });
});
