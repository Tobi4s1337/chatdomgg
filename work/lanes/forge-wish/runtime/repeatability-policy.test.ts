import { describe, expect, it } from 'vitest';
import { FORGE_JUDGE_POLICY_VERSION, scoreForgeQuality, type ForgeQualityRead } from '../../../../apps/codex/src/providers/policy';
import { repeatabilityPass, type RepeatabilityRead } from './repeatability-policy';

const ids = ['dragon', 'moon', 'owl', 'fox', 'sunflower'];
const hash = 'a'.repeat(64);
const quality = (value: number): ForgeQualityRead => ({ recognisability: value, completeness: value, cleanMarks: value });
const record = (value = 0.7) => ({ status: 'complete', qualityStatus: 'complete', policy: FORGE_JUDGE_POLICY_VERSION,
  evidenceHash: hash, quality: quality(value) });
const reads = (): RepeatabilityRead[] => ids.flatMap(fixture => [1, 2, 3].map(repeat => ({
  fixture, repeat, outcome: 'pass' as const, quality: scoreForgeQuality(quality(0.7)), records: [record()], calls: 1,
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
    for (const change of [{ status: 'pending' }, { qualityStatus: 'pending' }, { policy: 'old' }, { evidenceHash: 'invalid' }]) {
      const sample = reads();
      sample[0]!.records = [{ ...record(), ...change }];
      expect(repeatabilityPass(sample)).toBe(false);
    }
  });
});
