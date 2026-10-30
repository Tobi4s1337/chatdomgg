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
import woodStepA from './assets/kenney/footstep-wood-000.wav?url';
import woodStepB from './assets/kenney/footstep-wood-002.wav?url';
import woodStepC from './assets/kenney/footstep-wood-004.wav?url';
import woodSetA from './assets/kenney/impact-wood-medium-000.wav?url';
import woodSetB from './assets/kenney/impact-wood-medium-002.wav?url';
import woodSetC from './assets/kenney/impact-wood-medium-004.wav?url';
import stoneStepA from './assets/kenney/footstep-concrete-000.wav?url';
import stoneStepB from './assets/kenney/footstep-concrete-002.wav?url';
import stoneStepC from './assets/kenney/footstep-concrete-003.wav?url';
import earthStepA from './assets/kenney/footstep-earth-00.wav?url';
import earthStepB from './assets/kenney/footstep-earth-02.wav?url';
import earthStepC from './assets/kenney/footstep-earth-07.wav?url';
import softA from './assets/kenney/impact-soft-medium-000.wav?url';
import softB from './assets/kenney/impact-soft-medium-002.wav?url';
import softC from './assets/kenney/impact-soft-medium-003.wav?url';
import ironA from './assets/kenney/impact-metal-medium-000.wav?url';
import ironB from './assets/kenney/impact-metal-medium-001.wav?url';
import ironC from './assets/kenney/impact-metal-medium-002.wav?url';
import ironD from './assets/kenney/impact-metal-medium-003.wav?url';
import ironE from './assets/kenney/impact-metal-medium-004.wav?url';
import glassBlockA from './assets/kenney/impact-glass-medium-000.wav?url';
import glassBlockB from './assets/kenney/impact-glass-medium-001.wav?url';
import glassBlockC from './assets/kenney/impact-glass-medium-004.wav?url';
import fabricStepA from './assets/kenney/footstep-carpet-000.wav?url';
import fabricStepB from './assets/kenney/footstep-carpet-001.wav?url';
import fabricStepC from './assets/kenney/footstep-carpet-003.wav?url';
import clothA from './assets/kenney/cloth-1.wav?url';
import clothB from './assets/kenney/cloth-2.wav?url';
import clothC from './assets/kenney/cloth-3.wav?url';

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
  'step-wood-a': { url: woodStepA, peakHz: 0 },
  'step-wood-b': { url: woodStepB, peakHz: 0 },
  'step-wood-c': { url: woodStepC, peakHz: 0 },
  'timber-a': { url: woodSetA, peakHz: 0 },
  'timber-b': { url: woodSetB, peakHz: 0 },
  'timber-c': { url: woodSetC, peakHz: 0 },
  'step-stone-a': { url: stoneStepA, peakHz: 0 },
  'step-stone-b': { url: stoneStepB, peakHz: 0 },
  'step-stone-c': { url: stoneStepC, peakHz: 0 },
  'step-earth-a': { url: earthStepA, peakHz: 0 },
  'step-earth-b': { url: earthStepB, peakHz: 0 },
  'step-earth-c': { url: earthStepC, peakHz: 0 },
  'soft-a': { url: softA, peakHz: 0 },
  'soft-b': { url: softB, peakHz: 0 },
  'soft-c': { url: softC, peakHz: 0 },
  'iron-a': { url: ironA, peakHz: 996 },
  'iron-b': { url: ironB, peakHz: 1044 },
  'iron-c': { url: ironC, peakHz: 1023 },
  'iron-d': { url: ironD, peakHz: 1093 },
  'iron-e': { url: ironE, peakHz: 1007 },
  'glass-block-a': { url: glassBlockA, peakHz: 903 },
  'glass-block-b': { url: glassBlockB, peakHz: 1033 },
  'glass-block-c': { url: glassBlockC, peakHz: 899 },
  'step-fabric-a': { url: fabricStepA, peakHz: 0 },
  'step-fabric-b': { url: fabricStepB, peakHz: 0 },
  'step-fabric-c': { url: fabricStepC, peakHz: 0 },
  'cloth-a': { url: clothA, peakHz: 0 },
  'cloth-b': { url: clothB, peakHz: 0 },
  'cloth-c': { url: clothC, peakHz: 0 },
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
  /** Memory the decoded recordings hold: frames × channels × 4 bytes, at the context's own sample rate. */
  decodedBytes: number;
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
    let decodedBytes = 0;
    for (const buffer of this.buffers.values()) decodedBytes += buffer.length * buffer.numberOfChannels * 4;
    return { state, loaded, total, failures, decodedBytes };
  }
}
