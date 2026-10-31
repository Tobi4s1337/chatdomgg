/**
 * The whole Forge layer's budget on one destination. Every adapter feeding the same destination (one per active
 * anvil) shares it, so two anvils together still stay within 12 sounding voices and 32 scheduled sources.
 */
export const FORGE_AUDIO_LIMITS = { voices: 12, sources: 32, coalesce: .05 } as const;

export interface BudgetVoice {
  key: string;
  priority: number;
  /** Source nodes this voice still has scheduled or running at `now` (partials end one by one). */
  sources(now: number): number;
  start: number;
  /** When the last source stops; Infinity for a bed until it is told to stop. */
  end: number;
  owner: object;
  /** Fades the voice out by `at` (a few milliseconds: a freed slot is free at once) and releases it. */
  evict(at: number): void;
}

export type Admission = 'admitted' | 'coalesced' | 'budget';

export class ForgeBudget {
  readonly voices = new Set<BudgetVoice>();
  peakVoices = 0;
  peakSources = 0;

  sources(now: number): number { let n = 0; for (const voice of this.voices) n += voice.sources(now); return n; }

  prune(now: number): void { for (const voice of [...this.voices]) if (voice.end <= now) this.voices.delete(voice); }

  /**
   * Admits a voice if it fits, evicting quieter-ranked voices first (oldest first among equals that rank below it).
   * The same attack from two anvils within 50 ms is heard once.
   */
  admit(voice: BudgetVoice, now: number): Admission {
    this.prune(now);
    for (const other of this.voices) if (other.key === voice.key && Math.abs(other.start - voice.start) < FORGE_AUDIO_LIMITS.coalesce) return 'coalesced';
    const needs = voice.sources(now);
    if (needs > FORGE_AUDIO_LIMITS.sources) return 'budget';
    while (this.voices.size + 1 > FORGE_AUDIO_LIMITS.voices || this.sources(now) + needs > FORGE_AUDIO_LIMITS.sources) {
      let weakest: BudgetVoice | undefined;
      for (const other of this.voices) {
        if (other.priority >= voice.priority) continue;
        if (!weakest || other.priority < weakest.priority || (other.priority === weakest.priority && other.start < weakest.start)) weakest = other;
      }
      if (!weakest) return 'budget';
      this.voices.delete(weakest);
      weakest.evict(now + .004);
    }
    this.voices.add(voice);
    this.peakVoices = Math.max(this.peakVoices, this.voices.size);
    this.peakSources = Math.max(this.peakSources, this.sources(now));
    return 'admitted';
  }

  remove(voice: BudgetVoice): void { this.voices.delete(voice); }
}

const budgets = new WeakMap<AudioNode, ForgeBudget>();

export function budgetFor(destination: AudioNode): ForgeBudget {
  let budget = budgets.get(destination);
  if (!budget) { budget = new ForgeBudget(); budgets.set(destination, budget); }
  return budget;
}
