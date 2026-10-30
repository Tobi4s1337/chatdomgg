import type { AudioSettings } from './types';

/**
 * The one mix path every cue goes through:
 *
 *   voices ─▶ bus ─▶ rumble guard (35 Hz) ─▶ glue compressor ─▶ front fader ─▶ master volume ─▶ ceiling ─▶ output
 *   voices ─▶ room send ─▶ 180 Hz high-pass ─▶ small-room convolver ─▲
 *
 * Headroom comes from conservative cue gains and the voice budget first. The compressor only glues stacked cues;
 * the ceiling is a soft-knee waveshaper after the master fader that is linear up to 0.7 and can never exceed
 * 0.91, so even a pathological stack cannot clip. Muting ramps the master fader to exactly zero.
 *
 * Everything before the master that remembers sound (the room's 0.8 s convolution, the filters, the compressor's
 * gain reduction) is the "front". A mute or a browser interruption retires the front and builds a fresh one, so
 * nothing from before the interruption, not even the room's tail, can be heard afterwards.
 */
interface Front {
  bus: GainNode;
  room: GainNode;
  fader: GainNode;
  nodes: AudioNode[];
}

export const RAMP_SECONDS = 0.03;
const CEILING_KNEE = 0.7, CEILING_RANGE = 0.25;

export function masterLevel(settings: Readonly<AudioSettings>): number {
  return settings.muted ? 0 : settings.volume * settings.volume;
}

export class Mix {
  readonly master: GainNode;
  readonly analyser: AnalyserNode;
  private readonly ceiling: WaveShaperNode;
  private readonly impulse: AudioBuffer;
  private front: Front;
  /** Fronts fading out after a renewal, released once their fade has passed in render time. */
  private readonly retired = new Set<Front>();

  constructor(private readonly context: BaseAudioContext, settings: Readonly<AudioSettings>, random: () => number) {
    this.master = context.createGain();
    this.master.gain.value = masterLevel(settings);
    this.ceiling = context.createWaveShaper();
    this.ceiling.curve = ceilingCurve(); this.ceiling.oversample = '2x';
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.master.connect(this.ceiling);
    this.ceiling.connect(context.destination); this.ceiling.connect(this.analyser);
    this.impulse = smallRoom(context, random);
    this.front = this.build();
  }

  /** Where a new voice connects its dry signal. */
  get bus(): GainNode { return this.front.bus; }
  /** Where a new voice sends to the room. */
  get room(): GainNode { return this.front.room; }

  /** Moves the master fader over 30 ms from wherever it is now, so mute and volume never click. */
  rampMaster(settings: Readonly<AudioSettings>): void {
    const gain = this.master.gain, now = this.context.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(masterLevel(settings), now + RAMP_SECONDS);
  }

  /**
   * Builds a fresh front for new voices and retires the old one: faded to zero over `fade` seconds (with the
   * voices still on it), or cut at once when `fade` is 0, which is only used while the context is not rendering.
   */
  renew(fade: number): void {
    const old = this.front;
    this.front = this.build();
    if (fade <= 0) { release(old); return; }
    const now = this.context.currentTime, gain = old.fader.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + fade);
    this.retired.add(old);
    // A silent marker on the old front ends when its fade has passed, in render time, live or offline.
    const marker = this.context.createOscillator(), mute = this.context.createGain();
    mute.gain.value = 0;
    marker.connect(mute); mute.connect(old.fader);
    marker.onended = () => { marker.disconnect(); mute.disconnect(); this.retired.delete(old); release(old); };
    marker.start(now);
    marker.stop(now + fade + 0.01);
  }

  /** Disconnects every node of the mix path, current and retired. */
  close(): void {
    release(this.front);
    for (const front of this.retired) release(front);
    this.retired.clear();
    for (const node of [this.master, this.ceiling, this.analyser]) node.disconnect();
  }

  private build(): Front {
    const context = this.context;
    const bus = context.createGain(), room = context.createGain(), fader = context.createGain();
    const guard = context.createBiquadFilter();
    guard.type = 'highpass'; guard.frequency.value = 35; guard.Q.value = 0.6;

    const glue = context.createDynamicsCompressor();
    glue.threshold.value = -12; glue.knee.value = 8; glue.ratio.value = 4;
    glue.attack.value = 0.003; glue.release.value = 0.15;

    // The room is small and wooden: it should not boom, so nothing below ~180 Hz reaches it.
    const roomTone = context.createBiquadFilter();
    roomTone.type = 'highpass'; roomTone.frequency.value = 180; roomTone.Q.value = 0.6;
    const convolver = context.createConvolver();
    convolver.normalize = true;
    convolver.buffer = this.impulse;
    const roomReturn = context.createGain();
    roomReturn.gain.value = 0.55;

    bus.connect(guard); guard.connect(glue); glue.connect(fader); fader.connect(this.master);
    room.connect(roomTone); roomTone.connect(convolver); convolver.connect(roomReturn); roomReturn.connect(guard);
    return { bus, room, fader, nodes: [bus, room, guard, glue, fader, roomTone, convolver, roomReturn] };
  }
}

function release(front: Front): void {
  for (const node of front.nodes) node.disconnect();
}

function ceilingCurve(): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(4097);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1, size = Math.abs(x);
    const y = size <= CEILING_KNEE ? size : CEILING_KNEE + CEILING_RANGE * Math.tanh((size - CEILING_KNEE) / CEILING_RANGE);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

/**
 * A short, dark wooden room authored here: a few early reflections then 0.8 s of decaying, softened noise.
 * It gives cues a place to sit without washing them out.
 */
function smallRoom(context: BaseAudioContext, random: () => number): AudioBuffer {
  const rate = context.sampleRate, length = Math.round(rate * 0.8);
  const impulse = context.createBuffer(2, length, rate);
  const reflections = [[0.009, 0.5], [0.013, 0.42], [0.019, 0.35], [0.027, 0.28], [0.034, 0.22]] as const;
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    let soft = 0;
    for (let i = 0; i < length; i++) {
      const time = i / rate, damping = 0.55 + Math.min(time / 0.6, 1) * 0.35;
      soft += (1 - damping) * ((random() * 2 - 1) - soft);
      data[i] = time < 0.006 ? 0 : soft * Math.exp(-time / 0.15) * 0.6;
    }
    for (const [time, level] of reflections) {
      const index = Math.round((time + channel * 0.0017) * rate);
      if (index < length) data[index] = (data[index] ?? 0) + level * (channel ? -1 : 1);
    }
  }
  return impulse;
}
