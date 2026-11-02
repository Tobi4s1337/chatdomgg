import type { TavernCue } from './observer';

export type TavernBed = 'hearth' | 'murmur';
export type TavernMaterial = TavernCue | TavernBed;
const lengths: Record<TavernMaterial, number> = {
  paddle: .15, rail: .11, stone: .24, dice: .62, bank: .46, start: .52,
  point: .45, finish: 1.05, sit: .38, stand: .34, wood: .12, hearth: 2, murmur: 2,
};

/** Original modal/filtered-noise synthesis. No recordings, samples, speech model or external media. */
export function tavernMaterial(context: BaseAudioContext, material: TavernMaterial, variant: number): AudioBuffer {
  const rate = context.sampleRate, buffer = context.createBuffer(1, Math.ceil(rate * lengths[material]), rate);
  const data = buffer.getChannelData(0), random = seeded(0x74a3 + variant * 3019 + Object.keys(lengths).indexOf(material) * 7919);
  const pitch = 1 + (variant - 1.5) * .027;
  let low = 0, dark = 0;
  for (let i = 0; i < data.length; i++) {
    const white = random() * 2 - 1;
    low = low * .91 + white * .09;
    dark = dark * .986 + white * .014;
    if (material === 'hearth') {
      // A low ember body with tiny dry splinters. Low-pass character is written into the PCM.
      data[i] = low * .31 + dark * .6 + (random() < .0008 ? white * .16 : 0);
    } else if (material === 'murmur') {
      // Abstract timber room air; deliberately no voice formants, syllables or phantom conversation.
      const t = i / rate;
      data[i] = (dark * .8 + low * .10) * (.6 + .15 * Math.cos(t * Math.PI * 2));
    }
  }
  function impact(at: number, fundamental: number, decay: number, gain: number, hard = false) {
    const start = Math.floor(at * rate), duration = Math.min(data.length - start, Math.ceil(decay * 8 * rate));
    const modes = hard ? [1, 1.67, 2.79, 4.13] : [1, 2.73, 5.38];
    let grain = 0;
    for (let i = 0; i < duration; i++) {
      const t = i / rate, attack = Math.min(1, t / .0012), white = random() * 2 - 1;
      grain = .6 * grain + .4 * white;
      let sample = grain * Math.exp(-t / (hard ? .003 : .006)) * .38;
      for (let mode = 0; mode < modes.length; mode++) {
        const f = fundamental * modes[mode]! * pitch;
        sample += Math.sin(2 * Math.PI * f * t) * Math.exp(-t / (decay / (1 + mode * .8))) / (1.8 + mode);
      }
      data[start + i]! += sample * gain * attack;
    }
  }
  function scrape(duration: number, level: number) {
    let grain = 0;
    for (let i = 0; i < Math.min(data.length, duration * rate); i++) {
      const t = i / rate;
      grain = grain * .88 + (random() * 2 - 1) * .12;
      data[i]! += grain * level * Math.sin(Math.PI * t / duration) ** 2 * (.6 + .4 * Math.sin(t * 78) ** 2);
    }
  }
  switch (material) {
    case 'paddle': impact(0, 202, .023, .51); impact(.006, 93, .016, .15); break;
    case 'rail': impact(0, 352, .012, .39); break;
    case 'stone': impact(0, 732, .035, .46, true); impact(.024 + variant * .001, 510, .014, .12, true); break;
    case 'dice':
      scrape(.26, .20); impact(0, 174, .035, .22);
      for (let i = 0; i < 9; i++) impact(.07 + i * .043 + random() * .018, 740 + random() * 490, .011 + i * .0007, .12 + random() * .13, true);
      impact(.47, 260, .018, .18); break;
    case 'bank': impact(0, 386, .025, .23, true); impact(.08, 574, .035, .23, true); impact(.13, 1430, .04, .11, true); break;
    case 'start': impact(0, 189, .022, .28); impact(.12, 265, .025, .28); impact(.15, 880, .055, .15, true); break;
    case 'point': impact(0, 224, .024, .24); impact(.025, 1174, .065, .18, true); break;
    case 'finish': impact(0, 194, .03, .22); impact(.05, 659, .10, .16, true); impact(.17, 988, .12, .14, true); impact(.30, 1318, .10, .12, true); break;
    case 'sit': scrape(.26, .38); impact(.08, 109, .038, .25); break;
    case 'stand': scrape(.22, .32); impact(0, 147, .025, .22); break;
    case 'wood': impact(0, 305, .017, .25); break;
  }
  if (material === 'hearth' || material === 'murmur') {
    // Join the loop without a waveform step. The host fader owns the audible entrance and watchdog exit.
    const join = Math.min(256, data.length / 2);
    for (let i = 0; i < join; i++) {
      const weight = i / join;
      data[data.length - join + i] = data[data.length - join + i]! * (1 - weight) + data[0]! * weight;
    }
  } else {
    // A tiny, dark room reflection belongs to each finite buffer, so quiet() can cut every tail.
    for (let i = data.length - 1; i >= Math.round(rate * .023); i--) data[i]! += data[i - Math.round(rate * .023)]! * .12;
    const fade = Math.min(Math.round(rate * .012), data.length);
    for (let i = 0; i < fade; i++) data[data.length - 1 - i]! *= i / fade;
  }
  return buffer;
}

function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
