import knockA from '../../../../../packages/audio/src/assets/kenney/impact-wood-light-000.wav?url';
import knockB from '../../../../../packages/audio/src/assets/kenney/impact-wood-light-002.wav?url';
import knockC from '../../../../../packages/audio/src/assets/kenney/impact-wood-light-004.wav?url';
import setA from '../../../../../packages/audio/src/assets/kenney/impact-wood-medium-000.wav?url';
import setB from '../../../../../packages/audio/src/assets/kenney/impact-wood-medium-002.wav?url';
import boardA from '../../../../../packages/audio/src/assets/kenney/footstep-wood-000.wav?url';
import boardB from '../../../../../packages/audio/src/assets/kenney/footstep-wood-002.wav?url';
import boardC from '../../../../../packages/audio/src/assets/kenney/footstep-wood-004.wav?url';
import softA from '../../../../../packages/audio/src/assets/kenney/impact-soft-medium-000.wav?url';
import softB from '../../../../../packages/audio/src/assets/kenney/impact-soft-medium-002.wav?url';
import softC from '../../../../../packages/audio/src/assets/kenney/impact-soft-medium-003.wav?url';
import clothA from '../../../../../packages/audio/src/assets/kenney/cloth-1.wav?url';
import clothB from '../../../../../packages/audio/src/assets/kenney/cloth-2.wav?url';
import clothC from '../../../../../packages/audio/src/assets/kenney/cloth-3.wav?url';
import pageA from '../../../../../packages/audio/src/assets/kenney/book-flip-1.wav?url';
import pageB from '../../../../../packages/audio/src/assets/kenney/book-flip-2.wav?url';
import pageC from '../../../../../packages/audio/src/assets/kenney/book-flip-3.wav?url';
import { seeded } from './law';
import { lapLoop, pinkLoop, rainLoop, TextureJob } from './texture';

/**
 * What one audio context needs to play the pier: shared noise, the open-air reflection of the water and boards,
 * a few recorded contacts and the baked loops. Built once per context and kept with it.
 *
 * The recordings are Kenney's CC0 foley already shipped and credited by the kingdom's audio (see
 * packages/audio/THIRD_PARTY.md); the pier reads the same files, so a build carries each of them once. They are
 * only ever one layer of a cue: if one has not decoded yet, the cue still plays its own synthesis.
 */
export const PIER_SAMPLES = {
  'knock-a': knockA, 'knock-b': knockB, 'knock-c': knockC,
  'set-a': setA, 'set-b': setB,
  'board-a': boardA, 'board-b': boardB, 'board-c': boardC,
  'soft-a': softA, 'soft-b': softB, 'soft-c': softC,
  'cloth-a': clothA, 'cloth-b': clothB, 'cloth-c': clothC,
  'page-a': pageA, 'page-b': pageB, 'page-c': pageC,
} as const;

export type PierSampleId = keyof typeof PIER_SAMPLES;

/** The air beds breathe through: 24 kHz is plenty for breeze, flame and line, and halves the memory. */
const AIR_RATE = 24000;
const LAP_RATE = 22050, RAIN_RATE = 32000;
/** Two loops of different lengths per texture, panned apart: together they repeat only after minutes. */
const LAPS = [[9.3, 0x1a9f], [11.9, 0x77c3]] as const;
const RAINS = [[5.3, 0x3b61], [6.7, 0x9d05]] as const;

export interface PierKit {
  readonly context: BaseAudioContext;
  /** White noise at the context's rate, for one-shots. */
  readonly noise: AudioBuffer;
  /** Pink noise for the continuous beds. */
  readonly air: AudioBuffer;
  /** The pier's open air: a few close reflections off the boards and water, and a short, dark tail. */
  readonly impulse: AudioBuffer;
  sample(id: PierSampleId): AudioBuffer | undefined;
  /** The lapping loops on this context once baked; each call bakes one more slice until then. */
  laps(): readonly AudioBuffer[] | null;
  /** The rain loops on this context once baked; each call bakes one more slice until then. */
  rains(): readonly AudioBuffer[] | null;
}

const kits = new WeakMap<BaseAudioContext, PierKit>();

/** Baked data is shared by every context; a context copies it into its own buffers once. */
let lapJob: TextureJob | undefined, rainJob: TextureJob | undefined;

function lapTexture(): TextureJob {
  return lapJob ??= new TextureJob(LAPS.map(([seconds, seed]) => lapLoop(LAP_RATE, seconds, seed)));
}

function rainTexture(): TextureJob {
  return rainJob ??= new TextureJob(RAINS.map(([seconds, seed]) => rainLoop(RAIN_RATE, seconds, seed)));
}

function buffer(context: BaseAudioContext, data: Float32Array, sampleRate: number): AudioBuffer {
  const made = context.createBuffer(1, data.length, sampleRate);
  made.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
  return made;
}

function whiteNoise(context: BaseAudioContext): AudioBuffer {
  const rate = context.sampleRate, made = context.createBuffer(1, Math.round(rate * 3), rate), data = made.getChannelData(0);
  const random = seeded(0x5eed0f1e);
  for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
  return made;
}

/**
 * Open air over water, beside a wooden deck: early reflections from the boards under the feet and the water a
 * little further off, then a short diffuse tail that darkens as it goes (the air takes the top first).
 */
function openAir(context: BaseAudioContext): AudioBuffer {
  const rate = context.sampleRate, seconds = 0.75, length = Math.round(rate * seconds);
  const made = context.createBuffer(2, length, rate);
  const taps: readonly (readonly [number, number, number])[] = [
    [0.0065, 0.55, 0.42], [0.0118, 0.36, 0.48], [0.0187, 0.3, 0.22], [0.0291, 0.18, 0.26], [0.0413, 0.14, 0.1], [0.0577, 0.07, 0.11],
  ];
  for (let channel = 0; channel < 2; channel++) {
    const data = made.getChannelData(channel), random = seeded(channel ? 0x0d1ce5 : 0x0a1e5);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const time = i / rate, fade = Math.min(1, time / 0.012);
      // -60 dB at the end, and a low-pass that closes from ~7 kHz to ~1.5 kHz across the tail.
      const decay = Math.exp((-6.9 * time) / seconds), cutoff = 7000 - 5500 * (time / seconds);
      const k = 1 - Math.exp((-2 * Math.PI * cutoff) / rate);
      low += (random() * 2 - 1 - low) * k;
      data[i] = low * decay * fade * 0.5;
    }
    for (const [at, left, right] of taps) {
      const index = Math.round(at * rate * (channel ? 1.03 : 1));
      if (index < length) data[index] = data[index]! + (channel ? right : left);
    }
  }
  return made;
}

/** Fetches and decodes the recordings into this context; a recording that fails is simply never layered. */
function loadSamples(context: BaseAudioContext, into: Map<PierSampleId, AudioBuffer>): void {
  if (typeof fetch !== 'function') return;
  for (const id of Object.keys(PIER_SAMPLES) as PierSampleId[]) {
    void fetch(PIER_SAMPLES[id])
      .then(response => { if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`); return response.arrayBuffer(); })
      .then(data => context.decodeAudioData(data))
      .then(decoded => { into.set(id, decoded); }, () => undefined);
  }
}

export function pierKit(context: BaseAudioContext): PierKit {
  const existing = kits.get(context);
  if (existing) return existing;
  const samples = new Map<PierSampleId, AudioBuffer>();
  let laps: AudioBuffer[] | null = null, rains: AudioBuffer[] | null = null;
  const kit: PierKit = {
    context,
    noise: whiteNoise(context),
    air: buffer(context, pinkLoop(AIR_RATE, 8.7, 0x41e), AIR_RATE),
    impulse: openAir(context),
    sample: id => samples.get(id),
    laps() {
      if (laps) return laps;
      const job = lapTexture();
      if (!job.step()) return null;
      laps = job.result!.map(data => buffer(context, data, LAP_RATE));
      // The context holds its own copy now; a later context bakes again rather than every page keeping two.
      lapJob = undefined;
      return laps;
    },
    rains() {
      if (rains) return rains;
      const job = rainTexture();
      if (!job.step()) return null;
      rains = job.result!.map(data => buffer(context, data, RAIN_RATE));
      rainJob = undefined;
      return rains;
    },
  };
  loadSamples(context, samples);
  kits.set(context, kit);
  return kit;
}
