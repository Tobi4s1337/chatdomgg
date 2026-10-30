import type { AudioSettings } from './types';

/**
 * The one mix path every cue goes through:
 *
 *   voices ─▶ bus ─▶ rumble guard (35 Hz) ─▶ glue compressor ─▶ master volume ─▶ ceiling ─▶ output
 *   voices ─▶ room send ─▶ 180 Hz high-pass ─▶ small-room convolver ─────▲
 *
 * Headroom comes from conservative cue gains and the voice budget first. The compressor only glues stacked cues;
 * the ceiling is a soft-knee waveshaper after the master fader that is linear up to 0.7 and can never exceed
 * 0.91, so even a pathological stack cannot clip. Muting ramps the master fader to exactly zero.
 */
export interface Mix {
  bus: GainNode;
  room: GainNode;
  master: GainNode;
  analyser: AnalyserNode;
  nodes: AudioNode[];
}

export const RAMP_SECONDS = 0.03;
const CEILING_KNEE = 0.7, CEILING_RANGE = 0.25;

export function masterLevel(settings: Readonly<AudioSettings>): number {
  return settings.muted ? 0 : settings.volume * settings.volume;
}

export function createMix(context: BaseAudioContext, settings: Readonly<AudioSettings>, random: () => number): Mix {
  const bus = context.createGain(), room = context.createGain(), master = context.createGain();
  const guard = context.createBiquadFilter();
  guard.type = 'highpass'; guard.frequency.value = 35; guard.Q.value = 0.6;

  const glue = context.createDynamicsCompressor();
  glue.threshold.value = -12; glue.knee.value = 8; glue.ratio.value = 4;
  glue.attack.value = 0.003; glue.release.value = 0.15;

  const ceiling = context.createWaveShaper();
  ceiling.curve = ceilingCurve(); ceiling.oversample = '2x';

  // The room is small and wooden: it should not boom, so nothing below ~180 Hz reaches it.
  const roomTone = context.createBiquadFilter();
  roomTone.type = 'highpass'; roomTone.frequency.value = 180; roomTone.Q.value = 0.6;
  const convolver = context.createConvolver();
  convolver.normalize = true;
  convolver.buffer = smallRoom(context, random);
  const roomReturn = context.createGain();
  roomReturn.gain.value = 0.55;

  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;

  master.gain.value = masterLevel(settings);
  bus.connect(guard); guard.connect(glue); glue.connect(master); master.connect(ceiling);
  ceiling.connect(context.destination); ceiling.connect(analyser);
  room.connect(roomTone); roomTone.connect(convolver); convolver.connect(roomReturn); roomReturn.connect(guard);

  return { bus, room, master, analyser, nodes: [bus, room, master, guard, glue, ceiling, roomTone, convolver, roomReturn, analyser] };
}

/** Moves the master fader over 30 ms from wherever it is now, so mute and volume never click. */
export function rampMaster(mix: Mix, context: BaseAudioContext, settings: Readonly<AudioSettings>): void {
  const gain = mix.master.gain, now = context.currentTime;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(gain.value, now);
  gain.linearRampToValueAtTime(masterLevel(settings), now + RAMP_SECONDS);
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
