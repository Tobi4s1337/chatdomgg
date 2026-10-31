import type { KingdomPhrase, PhraseVoice } from '@chatdom/audio';
import type { AmbienceTarget } from './types';

const LENGTH = 3.2;
const HALF = LENGTH / 2;

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 0;
}

/** Equal-power overlap: independent noise beds keep their level as one breath gives way to the next. */
function overlap(param: AudioParam, t: number, level: number): void {
  const curve = new Float32Array(65);
  for (let i = 0; i < curve.length; i++) {
    curve[i] = level * Math.sin(Math.PI * i / (curve.length - 1));
  }
  param.setValueCurveAtTime(curve, t, LENGTH);
}

function layer(voice: PhraseVoice, level: number, pan: number, low: number, high: number, drift: number): void {
  const t = voice.t;
  const amp = voice.gain(0);
  const colour = voice.filter('lowpass', low, 0.6);
  // Slow colour changes give the noise the motion of air or water, without a pitched oscillator.
  colour.frequency.setValueAtTime(low, t);
  colour.frequency.linearRampToValueAtTime(high, t + HALF * drift);
  colour.frequency.linearRampToValueAtTime(low, t + LENGTH);
  overlap(amp.gain, t, level);
  voice.chain(voice.noise(t, t + LENGTH), voice.filter('highpass', 90, 0.5), colour, amp, voice.pan(pan), voice.out);
}

/** A quiet, bounded breath of the installed landscape; the caller overlaps phrases every 1.6 seconds. */
export function createAmbiencePhrase(target: Readonly<AmbienceTarget>): KingdomPhrase {
  const wind = clamp(target.wind, 0, 1);
  const water = clamp(target.water, 0, 1);
  const waterPan = clamp(target.waterPan, -1, 1);
  return {
    key: 'kingdom:air',
    tier: 'ceremony',
    variations: 3,
    build(voice, variation) {
      const drift = [0.8, 1, 1.2][variation] ?? 1;
      layer(voice, wind * 0.045, 0, 340, 560, drift);
      layer(voice, water * 0.055, waterPan, 750, 1250, 2 - drift);
    },
  };
}
