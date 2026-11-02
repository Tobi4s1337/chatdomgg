/** Seeded random numbers (mulberry32), so every teaser render is the same render. Values in [0, 1). */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** A white-noise buffer from a seed. */
export function noiseBuffer(context: BaseAudioContext, seconds: number, seed: number, channels = 1): AudioBuffer {
  const buffer = context.createBuffer(channels, Math.ceil(seconds * context.sampleRate), context.sampleRate);
  const random = seeded(seed);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
  }
  return buffer;
}

/** A small, warm room: decaying stereo noise, -60 dB at its end. */
export function roomImpulse(context: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
  const buffer = context.createBuffer(2, Math.ceil(seconds * context.sampleRate), context.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c), random = seeded(seed + c * 7919);
    for (let i = 0; i < data.length; i++) {
      const x = i / data.length;
      data[i] = (random() * 2 - 1) * Math.exp(-6.9 * x) * (1 - x);
    }
  }
  return buffer;
}
