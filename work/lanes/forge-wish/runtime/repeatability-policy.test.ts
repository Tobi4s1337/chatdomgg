import { describe, expect, it } from 'vitest';
import { FORGE_JUDGE_POLICY_VERSION, scoreForgeQuality, type ForgeQualityRead } from '../../../../apps/codex/src/providers/policy';
import { contrastPass, repeatabilityPass, type RepeatabilityRead } from './repeatability-policy';

const ids = ['dragon', 'moon', 'owl', 'fox', 'sunflower'];
const hash = 'a'.repeat(64);
const quality = (value: number): ForgeQualityRead => ({ recognisability: value, completeness: value, cleanMarks: value });
const record = (value = 0.7) => ({ status: 'complete', qualityStatus: 'complete', policy: FORGE_JUDGE_POLICY_VERSION,
  evidenceHash: hash, quality: quality(value), detailMatch: 'met' as const, detailMatchStatus: 'complete' });
const reads = (): RepeatabilityRead[] => ids.flatMap(fixture => [1, 2, 3].map(repeat => ({
  fixture, repeat, outcome: 'pass' as const, quality: scoreForgeQuality(quality(0.7)), detailMatch: 'met' as const, records: [record()], calls: 1,
})));

function replaceQuality(read: RepeatabilityRead, value: number) {
  read.records = [record(value)];
  read.quality = scoreForgeQuality(quality(value));
}

describe('repeatability evidence', () => {
  it('accepts all five fixed fixtures with three complete, independently scored reads', () => {
    expect(repeatabilityPass(reads())).toBe(true);
  });

  it.each([
    ['missing', undefined], ['partial', { recognisability: 0 }], ['non-number', quality('0' as unknown as number)],
    ['infinite', quality(Infinity)], ['negative', quality(-0.01)], ['over one', quality(1.01)],
  ])('rejects three stable zero scores backed by %s raw quality', (_label, raw) => {
    const sample = reads();
    for (const read of sample.filter(read => read.fixture === 'dragon')) {
      read.records = [{ ...record(), quality: raw }];
      read.quality = scoreForgeQuality(quality(0));
    }
    expect(repeatabilityPass(sample)).toBe(false);
  });

  it('rejects an aggregate that does not match its raw records', () => {
    const sample = reads();
    sample[0]!.quality = scoreForgeQuality(quality(0.8));
    expect(repeatabilityPass(sample)).toBe(false);
  });

  it.each(['hold', 'refuse'] as const)('rejects a safety %s', outcome => {
    const sample = reads();
    sample[0]!.outcome = outcome;
    expect(repeatabilityPass(sample)).toBe(false);
  });

  it('rejects a changed image hash within a fixture', () => {
    const sample = reads();
    sample[1]!.records = [{ ...record(), evidenceHash: 'b'.repeat(64) }];
    expect(repeatabilityPass(sample)).toBe(false);
  });

  it('requires repeats 1, 2 and 3 exactly once for every fixture', () => {
    const missing = reads();
    missing.pop();
    expect(repeatabilityPass(missing)).toBe(false);
    const duplicate = reads();
    duplicate[2]!.repeat = 2;
    expect(repeatabilityPass(duplicate)).toBe(false);
  });

  it('allows a score spread of exactly 0.15 and rejects a larger spread', () => {
    const sample = reads();
    replaceQuality(sample[0]!, 0.5);
    replaceQuality(sample[2]!, 0.5);
    replaceQuality(sample[1]!, 0.65);
    expect(repeatabilityPass(sample)).toBe(true);
    replaceQuality(sample[1]!, 0.6501);
    expect(repeatabilityPass(sample)).toBe(false);
  });

  it('accepts two complete model records only when calls and image evidence agree', () => {
    const sample = reads();
    sample[0]!.records = [record(0.6), record(0.8)];
    sample[0]!.calls = 2;
    sample[0]!.quality = scoreForgeQuality(quality(0.6), quality(0.8));
    expect(repeatabilityPass(sample)).toBe(true);
    sample[0]!.calls = 1;
    expect(repeatabilityPass(sample)).toBe(false);
    sample[0]!.calls = 2;
    sample[0]!.records = [record(0.6), { ...record(0.8), evidenceHash: 'b'.repeat(64) }];
    expect(repeatabilityPass(sample)).toBe(false);
  });

  it('requires complete, versioned records with a valid evidence hash', () => {
    for (const change of [{ status: 'pending' }, { qualityStatus: 'pending' }, { policy: 'old' }, { evidenceHash: 'invalid' },
      { detailMatch: undefined }, { detailMatch: 'unknown' }, { detailMatchStatus: 'invalid' }]) {
      const sample = reads();
      sample[0]!.records = [{ ...record(), ...change }];
      expect(repeatabilityPass(sample)).toBe(false);
    }
  });

  it('does not report a met-detail aggregate over an adapted or uncertain actual read', () => {
    for (const detailMatch of ['adapted', 'unclear'] as const) {
      const sample = reads();
      sample[0]!.records = [{ ...record(), detailMatch }];
      expect(repeatabilityPass(sample)).toBe(false);
      sample[0]!.detailMatch = detailMatch;
      expect(repeatabilityPass(sample)).toBe(false); // Changed exact/softened decisions are not repeatable.
      for (const read of sample.filter(read => read.fixture === sample[0]!.fixture)) {
        read.records = [{ ...record(), detailMatch }]; read.detailMatch = detailMatch;
      }
      expect(repeatabilityPass(sample)).toBe(true); // Stable adaptation is not a claim of exact delivery.
    }
  });
});

describe('unrelated-image controls', () => {
  const controls = (): RepeatabilityRead[] => ['owl-for-fox', 'fox-for-owl'].map(fixture => ({
    fixture, repeat: 1, outcome: 'pass', quality: scoreForgeQuality(quality(0.2)), detailMatch: 'adapted',
    records: [{ ...record(0.2), detailMatch: 'adapted' }], calls: 1,
  }));
  it('requires two safe complete low-identity reads that acknowledge the adaptation', () => {
    expect(contrastPass(controls())).toBe(true);
  });
  it.each(['identity', 'details', 'malformed', 'safety', 'duplicate'] as const)('rejects a control with invalid %s evidence', failure => {
    const sample = controls();
    if (failure === 'identity') { sample[0]!.quality = scoreForgeQuality(quality(0.5)); sample[0]!.records = [{ ...record(0.5), detailMatch: 'adapted' }]; }
    if (failure === 'details') { sample[0]!.detailMatch = 'met'; sample[0]!.records = [record(0.2)]; }
    if (failure === 'malformed') sample[0]!.records = [{ ...record(0.2), detailMatch: 'adapted', qualityStatus: 'invalid' }];
    if (failure === 'safety') sample[0]!.outcome = 'refuse';
    if (failure === 'duplicate') sample[1]!.fixture = sample[0]!.fixture;
    expect(contrastPass(sample)).toBe(false);
  });
});
