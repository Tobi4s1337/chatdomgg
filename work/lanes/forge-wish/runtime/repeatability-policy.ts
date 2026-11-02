import { FORGE_JUDGE_POLICY_VERSION, FORGE_QUALITY_DIMENSIONS, scoreForgeQuality,
  type ForgeQualityRead, type ForgeQualityScore } from '../../../../apps/codex/src/providers/policy';
import { REPEATABILITY_FIXTURES } from './repeatability-fixtures';

export interface RepeatabilityRead {
  fixture: string; repeat: number; outcome: 'pass' | 'hold' | 'refuse';
  quality: ForgeQualityScore | undefined; records: unknown[]; calls: number;
}
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const qualityRead = (value: unknown): value is ForgeQualityRead => object(value) && FORGE_QUALITY_DIMENSIONS.every(name =>
  typeof value[name] === 'number' && Number.isFinite(value[name]) && value[name] >= 0 && value[name] <= 1);

/** A default zero is not a quality read. Require complete raw evidence and recompute its aggregate. */
export function repeatabilityPass(reads: readonly RepeatabilityRead[]): boolean {
  if (reads.length !== REPEATABILITY_FIXTURES.length * 3) return false;
  return REPEATABILITY_FIXTURES.every(fixture => {
    const actual = reads.filter(read => read.fixture === fixture.id);
    if (actual.length !== 3 || actual.map(read => read.repeat).sort().join(',') !== '1,2,3') return false;
    const evidence = new Set<string>();
    for (const read of actual) {
      if (read.outcome !== 'pass' || !read.quality || read.records.length < 1 || read.records.length > 2 || read.calls !== read.records.length) return false;
      const qualities: ForgeQualityRead[] = [];
      for (const record of read.records) {
        if (!object(record) || record.status !== 'complete' || record.qualityStatus !== 'complete'
          || record.policy !== FORGE_JUDGE_POLICY_VERSION || typeof record.evidenceHash !== 'string'
          || !/^[a-f0-9]{64}$/.test(record.evidenceHash) || !qualityRead(record.quality)) return false;
        evidence.add(record.evidenceHash);
        qualities.push(record.quality);
      }
      const computed = scoreForgeQuality(qualities[0]!, qualities[1]);
      if (read.quality.policy !== computed.policy || read.quality.score !== computed.score
        || !FORGE_QUALITY_DIMENSIONS.every(name => read.quality![name] === computed[name])) return false;
    }
    const scores = actual.map(read => read.quality!.score);
    return evidence.size === 1 && Math.max(...scores) - Math.min(...scores) <= 0.150000001;
  });
}
