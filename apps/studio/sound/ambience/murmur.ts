import { roomImpulse, seeded } from './rng';

/**
 * Distant town voices, authored for the teaser. The Genesis land deliberately has no people in it
 * (`population: 'real-presence-only'`), and the moment cues' crowd is a single reaction ("ooh", "aah"), so the
 * evening's background talk is made here. Original synthesis, the same technique as the moment crowd
 * (apps/web/src/twitch-moments/sound.ts `voices`): a soft glottal tone through moving formant band-passes.
 *
 * Each talker speaks in phrases of syllables (vowel formant targets, a falling pitch line, small jitter), takes
 * turns with pauses, and now and then laughs. Everything is far: low-passed, panned across the street and sent
 * into a long, dark room, so it reads as people talking a street away, never as words.
 */
export interface MurmurOptions {
  seconds: number;
  seed: number;
  talkers?: number;
  sampleRate?: number;
  /** Top of the distance low-pass, Hz. */
  air?: number;
}

const VOWELS: readonly (readonly [number, number, number])[] = [
  [730, 1090, 2440], [530, 1840, 2480], [390, 1990, 2550], [570, 840, 2410], [440, 1020, 2240], [660, 1720, 2410], [490, 1350, 2500],
];

export async function renderMurmur(options: MurmurOptions): Promise<AudioBuffer> {
  const rate = options.sampleRate ?? 48000, seconds = options.seconds, talkers = options.talkers ?? 12;
  const context = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
  const random = seeded(options.seed);

  // A soft voice source: harmonics falling at about 8 dB per octave; the formants and the distance do the rest.
  const harmonics = 40, real = new Float32Array(harmonics), imag = new Float32Array(harmonics);
  for (let n = 1; n < harmonics; n++) imag[n] = 1 / Math.pow(n, 1.3);
  const glottal = context.createPeriodicWave(real, imag);

  const street = context.createGain(); street.gain.value = 1;
  const top = context.createBiquadFilter(); top.type = 'lowpass'; top.frequency.value = options.air ?? 1500; top.Q.value = 0.5;
  const top2 = context.createBiquadFilter(); top2.type = 'lowpass'; top2.frequency.value = (options.air ?? 1500) * 1.6; top2.Q.value = 0.5;
  const low = context.createBiquadFilter(); low.type = 'highpass'; low.frequency.value = 230; low.Q.value = 0.7;
  const low2 = context.createBiquadFilter(); low2.type = 'highpass'; low2.frequency.value = 230; low2.Q.value = 0.7;
  const dry = context.createGain(); dry.gain.value = 0.45;
  const send = context.createGain(); send.gain.value = 0.9;
  const room = context.createConvolver(); room.buffer = roomImpulse(context, 1.8, options.seed ^ 0x7a11);
  const roomTone = context.createBiquadFilter(); roomTone.type = 'lowpass'; roomTone.frequency.value = 1300;
  street.connect(low).connect(low2).connect(top).connect(top2);
  top2.connect(dry).connect(context.destination);
  top2.connect(send).connect(room).connect(roomTone).connect(context.destination);

  for (let k = 0; k < talkers; k++) {
    const high = random() < 0.45;
    const f0 = high ? 175 + random() * 60 : 98 + random() * 40;
    const osc = context.createOscillator(); osc.setPeriodicWave(glottal); osc.frequency.value = f0;
    const vibrato = context.createOscillator(), vibratoDepth = context.createGain();
    vibrato.frequency.value = 4.5 + random() * 1.5; vibratoDepth.gain.value = f0 * 0.012;
    vibrato.connect(vibratoDepth).connect(osc.frequency);
    const formants = [0, 1, 2].map(i => {
      const node = context.createBiquadFilter(); node.type = 'bandpass'; node.Q.value = [5, 9, 12][i]!; node.frequency.value = VOWELS[0]![i]!;
      const amp = context.createGain(); amp.gain.value = [1.6, 1.0, 0.45][i]!;
      osc.connect(node).connect(amp);
      return { node, amp };
    });
    const voice = context.createGain(); voice.gain.value = 0;
    const distance = 0.35 + random() * 0.65;
    const level = context.createGain(); level.gain.value = (0.5 + 0.5 * (1 - distance)) * (high ? 0.8 : 1) / Math.sqrt(talkers);
    const place = context.createStereoPanner(); place.pan.value = (random() * 2 - 1) * 0.85;
    for (const { amp } of formants) amp.connect(voice);
    voice.connect(level).connect(place).connect(street);

    // Phrases and pauses, from a moment before the render so the street is already talking at the start.
    let t = -random() * 3;
    while (t < seconds) {
      const laugh = random() < 0.06;
      const syllables = laugh ? 4 + Math.floor(random() * 4) : 3 + Math.floor(random() * 10);
      const rateHz = laugh ? 5.2 + random() * 0.8 : 3.6 + random() * 1.8;
      const lift = laugh ? 1.35 : 1.08 + random() * 0.12;
      for (let s = 0; s < syllables; s++) {
        const at = t + s / rateHz, length = (laugh ? 0.55 : 0.5 + random() * 0.35) / rateHz;
        if (at < 0 || at + length > seconds) continue;
        const vowel = laugh ? VOWELS[0]! : VOWELS[Math.floor(random() * VOWELS.length)]!;
        formants.forEach(({ node }, i) => node.frequency.setTargetAtTime(vowel[i]! * (high ? 1.12 : 1), at, 0.025));
        // The phrase falls in pitch towards its end; each syllable a little up or down.
        const fall = lift - (lift - 0.88) * (s / Math.max(1, syllables - 1));
        osc.frequency.setTargetAtTime(f0 * fall * (1 + (random() * 2 - 1) * 0.06), at, 0.04);
        const stress = laugh ? 1 - s / (syllables + 2) : 0.55 + random() * 0.45;
        voice.gain.setTargetAtTime(stress, at, 0.018);
        voice.gain.setTargetAtTime(0, at + length, 0.03);
      }
      t += syllables / rateHz + 0.35 + random() * (random() < 0.3 ? 4 : 1.6);
    }
    osc.start(0); vibrato.start(0); osc.stop(seconds); vibrato.stop(seconds);
  }
  return context.startRendering();
}
