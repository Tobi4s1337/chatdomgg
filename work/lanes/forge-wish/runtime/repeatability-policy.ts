import { FORGE_JUDGE_POLICY_VERSION, FORGE_QUALITY_DIMENSIONS, scoreForgeQuality, FORGE_DETAIL_MATCHES, combineForgeDetailMatch,
  type ForgeDetailMatch, type ForgeQualityRead, type ForgeQualityScore } from '../../../../apps/codex/src/providers/policy';
import { REPEATABILITY_FIXTURES } from './repeatability-fixtures';

export interface RepeatabilityRead {
  fixture: string; repeat: number; outcome: 'pass' | 'hold' | 'refuse';
  quality: ForgeQualityScore | undefined; detailMatch?: ForgeDetailMatch; records: unknown[]; calls: number;
}
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const qualityRead = (value: unknown): value is ForgeQualityRead => object(value) && FORGE_QUALITY_DIMENSIONS.every(name =>
  typeof value[name] === 'number' && Number.isFinite(value[name]) && value[name] >= 0 && value[name] <= 1);

function verifiedRead(read: RepeatabilityRead): boolean {
  if (read.outcome !== 'pass' || !read.quality || read.records.length < 1 || read.records.length > 2 || read.calls !== read.records.length) return false;
  const qualities: ForgeQualityRead[] = [], details: ForgeDetailMatch[] = [], evidence = new Set<string>();
  for (const record of read.records) {
    if (!object(record) || record.status !== 'complete' || record.qualityStatus !== 'complete'
      || record.policy !== FORGE_JUDGE_POLICY_VERSION || typeof record.evidenceHash !== 'string'
      || !/^[a-f0-9]{64}$/.test(record.evidenceHash) || !qualityRead(record.quality)
      || record.detailMatchStatus !== 'complete' || !FORGE_DETAIL_MATCHES.includes(record.detailMatch as ForgeDetailMatch)) return false;
    evidence.add(record.evidenceHash); qualities.push(record.quality); details.push(record.detailMatch as ForgeDetailMatch);
  }
  const computed = scoreForgeQuality(qualities[0]!, qualities[1]);
  return evidence.size === 1 && read.quality.policy === computed.policy && read.quality.score === computed.score
    && FORGE_QUALITY_DIMENSIONS.every(name => read.quality![name] === computed[name])
    && read.detailMatch === combineForgeDetailMatch(details[0]!, details[1]);
}

/** A default zero is not a quality read. Require complete raw evidence and recompute its aggregate. */
export function repeatabilityPass(reads: readonly RepeatabilityRead[]): boolean {
  if (reads.length !== REPEATABILITY_FIXTURES.length * 3) return false;
  return REPEATABILITY_FIXTURES.every(fixture => {
    const actual = reads.filter(read => read.fixture === fixture.id);
    if (actual.length !== 3 || actual.map(read => read.repeat).sort().join(',') !== '1,2,3') return false;
    const evidence = new Set<string>();
    for (const read of actual) {
      if (!verifiedRead(read)) return false;
      for (const record of read.records) {
        evidence.add((record as { evidenceHash: string }).evidenceHash);
      }
    }
    const scores = actual.map(read => read.quality!.score);
    return evidence.size === 1 && new Set(actual.map(read => read.detailMatch)).size === 1
      && Math.max(...scores) - Math.min(...scores) <= 0.150000001;
  });
}

/** Deliberately unrelated pictures with flattering requested-subject text must still score low. */
export function contrastPass(reads: readonly RepeatabilityRead[]): boolean {
  const expected = ['owl-for-fox', 'fox-for-owl'];
  return reads.length === expected.length && expected.every(id => {
    const matches = reads.filter(read => read.fixture === id), read = matches[0];
    return matches.length === 1 && read?.repeat === 1 && verifiedRead(read)
      && read.quality!.recognisability <= 0.25 && read.detailMatch === 'adapted';
  });
}
