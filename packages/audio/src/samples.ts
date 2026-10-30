import woodKnockA from './assets/kenney/impact-wood-light-000.wav?url';
import woodKnockB from './assets/kenney/impact-wood-light-002.wav?url';
import woodKnockC from './assets/kenney/impact-wood-light-004.wav?url';
import glassTapA from './assets/kenney/impact-glass-light-004.wav?url';
import glassTapB from './assets/kenney/impact-glass-light-003.wav?url';
import glassTapC from './assets/kenney/impact-glass-light-000.wav?url';
import brassTickA from './assets/kenney/impact-metal-light-001.wav?url';
import brassTickB from './assets/kenney/impact-metal-light-004.wav?url';
import brassTickC from './assets/kenney/impact-metal-light-002.wav?url';
import pageA from './assets/kenney/book-flip-3.wav?url';
import pageB from './assets/kenney/book-flip-2.wav?url';
import pageC from './assets/kenney/book-flip-1.wav?url';
import plankA from './assets/kenney/impact-plank-medium-000.wav?url';
import plankB from './assets/kenney/impact-plank-medium-002.wav?url';
import plankC from './assets/kenney/impact-plank-medium-004.wav?url';

/**
 * Selected foley, decoded once per instance. Sources and edits are recorded in packages/audio/THIRD_PARTY.md.
 * `peakHz` is the measured strongest partial, used to tune a tonal sample into the palette (0: not tonal, never tuned).
 */
export const SAMPLES = {
  'wood-knock-a': { url: woodKnockA, peakHz: 324 },
  'wood-knock-b': { url: woodKnockB, peakHz: 308 },
  'wood-knock-c': { url: woodKnockC, peakHz: 345 },
  'glass-tap-a': { url: glassTapA, peakHz: 919 },
  'glass-tap-b': { url: glassTapB, peakHz: 981 },
  'glass-tap-c': { url: glassTapC, peakHz: 1081 },
  'brass-tick-a': { url: brassTickA, peakHz: 2343 },
  'brass-tick-b': { url: brassTickB, peakHz: 2404 },
  'brass-tick-c': { url: brassTickC, peakHz: 2998 },
  'page-a': { url: pageA, peakHz: 0 },
  'page-b': { url: pageB, peakHz: 0 },
  'page-c': { url: pageC, peakHz: 0 },
  'beam-a': { url: plankA, peakHz: 0 },
  'beam-b': { url: plankB, peakHz: 0 },
  'beam-c': { url: plankC, peakHz: 0 },
} as const;

export type SampleId = keyof typeof SAMPLES;
export const SAMPLE_IDS = Object.keys(SAMPLES) as SampleId[];

export type SampleLoader = (id: SampleId, context: BaseAudioContext) => Promise<AudioBuffer>;

export const fetchSample: SampleLoader = async (id, context) => {
  const response = await fetch(SAMPLES[id].url);
  if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
  return context.decodeAudioData(await response.arrayBuffer());
};

export interface SampleBankReport {
  state: 'idle' | 'loading' | 'ready' | 'failed';
  loaded: number;
  total: number;
  failures: string[];
}

/** Decoded buffers shared by every voice of one instance. A failed sample stays failed and is reported. */
export class SampleBank {
  private readonly buffers = new Map<SampleId, AudioBuffer>();
  private readonly failures = new Map<SampleId, string>();
  private pending: Promise<void> | undefined;

  constructor(private readonly loader: SampleLoader) {}

  load(context: BaseAudioContext): Promise<void> {
    this.pending ??= Promise.all(SAMPLE_IDS.map(async id => {
      try { this.buffers.set(id, await this.loader(id, context)); }
      catch (error) { this.failures.set(id, error instanceof Error ? error.message : String(error)); }
    })).then(() => undefined);
    return this.pending;
  }

  get(id: SampleId): AudioBuffer | undefined { return this.buffers.get(id); }

  has(ids: readonly SampleId[]): boolean { return ids.every(id => this.buffers.has(id)); }

  report(): SampleBankReport {
    const total = SAMPLE_IDS.length, loaded = this.buffers.size, failures = [...this.failures.values()];
    const state = !this.pending ? 'idle' : failures.length ? 'failed' : loaded === total ? 'ready' : 'loading';
    return { state, loaded, total, failures };
  }
}
