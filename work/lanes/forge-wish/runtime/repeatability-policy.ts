import { FORGE_JUDGE_POLICY_VERSION, combineForgeWishSubject, forgeMeasureDetailMatch, readForgeWishSubject, scoreForgeMeasure,
  type ForgeDetailMatch, type ForgeQualityMeasure, type ForgeQualityScore, type ForgeSubjectReading } from '../../../../apps/codex/src/providers/policy';
import { REPEATABILITY_FIXTURES } from './repeatability-fixtures';

/** One round of one fixture: the word gate on its fixed wish, then the safety-only result gate on its stored sheet. */
export interface RepeatabilityRead {
  fixture: string; repeat: number;
  words: { outcome: 'pass' | 'hold' | 'refuse'; subject: ForgeSubjectReading | undefined; records: unknown[] };
  outcome: 'pass' | 'hold' | 'refuse'; subject: ForgeSubjectReading | undefined; records: unknown[];
  measure: ForgeQualityMeasure | undefined; quality: ForgeQualityScore | undefined; detailMatch?: ForgeDetailMatch; calls: number;
}
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Every read is complete, current policy, one evidence hash per gate, and the stored reading recomputes. */
function gateRecords(records: unknown[], reading: ForgeSubjectReading | undefined): string | undefined {
  if (records.length < 1 || records.length > 2) return undefined;
  const hashes = new Set<string>(), subjects = [];
  for (const record of records) {
    if (!object(record) || record.status !== 'complete' || record.subjectStatus !== 'complete' || record.policy !== FORGE_JUDGE_POLICY_VERSION
      || typeof record.evidenceHash !== 'string' || !/^[a-f0-9]{64}$/.test(record.evidenceHash)) return undefined;
    const subject = readForgeWishSubject(record.subject);
    if (!subject) return undefined;
    hashes.add(record.evidenceHash); subjects.push(subject);
  }
  return hashes.size === 1 && same(combineForgeWishSubject(...subjects), reading) ? [...hashes][0] : undefined;
}
function verifiedRead(read: RepeatabilityRead): { words: string; result: string } | undefined {
  if (read.words.outcome !== 'pass' || read.outcome !== 'pass' || !read.measure || !read.quality
    || read.calls !== read.words.records.length + read.records.length) return undefined;
  const words = gateRecords(read.words.records, read.words.subject), result = gateRecords(read.records, read.subject);
  if (!words || !result || !same(read.measure.words, read.words.subject) || !same(read.measure.result, read.subject)) return undefined;
  return same(read.quality, scoreForgeMeasure(read.measure)) && read.detailMatch === forgeMeasureDetailMatch(read.measure) ? { words, result } : undefined;
}

/**
 * Five fixtures × three rounds. The same safety verdict every time, identical evidence per gate, recomputable
 * quality with a spread of at most 0.15 and one delivery decision per fixture. Every read, including the owl, passes.
 */
export function repeatabilityPass(reads: readonly RepeatabilityRead[]): boolean {
  if (reads.length !== REPEATABILITY_FIXTURES.length * 3) return false;
  return REPEATABILITY_FIXTURES.every(fixture => {
    const actual = reads.filter(read => read.fixture === fixture.id);
    if (actual.length !== 3 || actual.map(read => read.repeat).sort().join(',') !== '1,2,3') return false;
    const hashes = actual.map(verifiedRead);
    if (hashes.some(hash => !hash) || new Set(hashes.map(hash => hash!.words)).size !== 1 || new Set(hashes.map(hash => hash!.result)).size !== 1) return false;
    const scores = actual.map(read => read.quality!.score);
    if (new Set(actual.map(read => read.detailMatch)).size !== 1 || Math.max(...scores) - Math.min(...scores) > 0.150000001) return false;
    // The owl that flipped on 31 Oct must pass both gates every time (checked above for every fixture).
    return true;
  });
}
