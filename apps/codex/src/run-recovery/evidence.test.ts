import { describe, expect, it } from 'vitest';
import { FORGE_JUDGE_MESSAGES } from '../providers';
import { FORGE_JUDGE_POLICY_VERSION, FORGE_JUDGE_THRESHOLDS, forgeJudgeQuestions, forgeMeasureDetailMatch, scoreForgeMeasure,
  type ForgeQualityMeasure } from '../providers/policy';
import { ForgeQualityMeasureSchema, recoverForgeVerdict } from './evidence';

const omit = <T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key as K))) as Omit<T, K>;

const evidenceHash = 'a'.repeat(64);
const dragon = { motif: 'sleeping-dragon', slot: 'chimney' } as const;
const measure = (): ForgeQualityMeasure => ({ words: { ...dragon }, result: { ...dragon },
  plan: { motif: 'sleeping-dragon', kind: 'chimney' }, certificate: 'reads', slotAvailable: true });
const secondary = (outcome: 'pass' | 'refuse', concerns: string[]) => ({ backend: 'codex-cli', judge: 'gpt-6.1-terra', model: 'gpt-6.1-terra',
  policy: FORGE_JUDGE_POLICY_VERSION, evidenceHash, status: 'complete', outcome, concerns, subject: { ...dragon }, subjectStatus: 'complete' });
/** A stored verdict: raw safety reads, the combined subject and, on a result, the host's measure and score. */
function fixture(image = false) {
  const primary: Record<string, unknown> & { answers: Record<string, number> } = { backend: 'codex-cli', judge: 'gpt-6-luna', model: 'gpt-6-luna',
    policy: FORGE_JUDGE_POLICY_VERSION, evidenceHash, status: 'complete', probabilitySource: 'model-self-estimate', thresholds: FORGE_JUDGE_THRESHOLDS,
    answers: Object.fromEntries(forgeJudgeQuestions(image).map(({ name }) => [name, 0.01])), subject: { ...dragon }, subjectStatus: 'complete' };
  return { outcome: 'pass', reason: 'Private original provider prose is discarded', records: [primary] as (typeof primary)[],
    subject: { ...dragon } as Record<string, string>,
    ...(image ? { measure: measure() as unknown as Record<string, unknown>, quality: scoreForgeMeasure(measure()), detailMatch: forgeMeasureDetailMatch(measure()) } : {}) };
}

describe('saved Forge evidence', () => {
  it('retains exact bounded evidence and the recomputed measure while replacing arbitrary reason prose', () => {
    const input = fixture(true), result = recoverForgeVerdict(input, true, evidenceHash, measure());
    expect(result).toEqual({ outcome: 'pass', reason: FORGE_JUDGE_MESSAGES.pass, records: input.records, subject: dragon,
      measure: measure(), quality: { policy: FORGE_JUDGE_POLICY_VERSION, recognisability: 1, completeness: 1, cleanMarks: 1, score: 1 }, detailMatch: 'met' });
    expect(JSON.stringify(result)).not.toContain(input.reason);
  });

  it('accepts a raw provider result and a word verdict only without any measure or score', () => {
    const raw = omit(fixture(true), 'measure', 'quality', 'detailMatch');
    expect(recoverForgeVerdict(raw, true, evidenceHash)).toEqual({ outcome: 'pass', reason: FORGE_JUDGE_MESSAGES.pass, records: raw.records, subject: dragon });
    expect(recoverForgeVerdict(fixture(), false, evidenceHash)).toMatchObject({ outcome: 'pass', subject: dragon });
    expect(() => recoverForgeVerdict(fixture(true), true, evidenceHash)).toThrow(expect.objectContaining({ code: 'corrupt' }));
    expect(() => recoverForgeVerdict({ ...fixture(), measure: measure() }, false, evidenceHash, measure())).toThrow(expect.objectContaining({ code: 'corrupt' }));
    expect(() => recoverForgeVerdict(raw, true, evidenceHash, measure())).toThrow(expect.objectContaining({ code: 'corrupt' }));
  });

  it('exports a strict measure schema', () => {
    expect(ForgeQualityMeasureSchema.parse(measure())).toEqual(measure());
    expect(() => ForgeQualityMeasureSchema.parse({ ...measure(), score: 1 })).toThrow();
    expect(() => ForgeQualityMeasureSchema.parse({ ...measure(), certificate: 'excellent' })).toThrow();
  });

  it.each(['aggregate', 'dimension', 'details', 'measure', 'reading', 'subject', 'record-subject', 'subject-status', 'old-quality',
    'policy', 'hash', 'extra'] as const)('refuses %s changes to a saved result', kind => {
    const input = fixture(true);
    if (kind === 'aggregate') input.quality!.score = 0.99;
    if (kind === 'dimension') input.quality!.recognisability = 0.9;
    if (kind === 'details') input.detailMatch = 'adapted';
    if (kind === 'measure') input.measure!.certificate = 'weak';
    if (kind === 'reading') input.measure!.result = { motif: 'watchful-owl', slot: 'chimney' };
    if (kind === 'subject') input.subject = { motif: 'unclear', slot: 'chimney' };
    if (kind === 'record-subject') input.records[0]!.subject = { motif: 'watchful-owl', slot: 'chimney' };
    if (kind === 'subject-status') input.records[0]!.subjectStatus = 'invalid';
    if (kind === 'old-quality') Object.assign(input.records[0]!, { quality: { recognisability: 1, completeness: 1, cleanMarks: 1 }, qualityStatus: 'complete' });
    if (kind === 'policy') input.records[0]!.policy = 'older-policy';
    if (kind === 'hash') input.records[0]!.evidenceHash = 'b'.repeat(64);
    if (kind === 'extra') Object.assign(input.records[0]!, { rawProviderText: 'Never retain this private body' });
    expect(() => recoverForgeVerdict(input, true, evidenceHash, measure())).toThrow(expect.objectContaining({ code: 'corrupt' }));
  });

  it('refuses a stored measure that differs from the one recomputed from the run', () => {
    const input = fixture(true), other = { ...measure(), slotAvailable: false };
    expect(() => recoverForgeVerdict(input, true, evidenceHash, other)).toThrow(expect.objectContaining({ code: 'corrupt' }));
    // A recomputed measure whose result reading is not this verdict's own combined reading cannot bind either.
    const foreign = { ...measure(), result: { motif: 'none', slot: 'none' } } as ForgeQualityMeasure;
    expect(() => recoverForgeVerdict({ ...input, measure: foreign, quality: scoreForgeMeasure(foreign), detailMatch: forgeMeasureDetailMatch(foreign) },
      true, evidenceHash, foreign)).toThrow(expect.objectContaining({ code: 'corrupt' }));
  });

  it('keeps an invalid read subject invalid, combining only the valid readings', () => {
    const input = fixture(); const withoutSubject = omit(input.records[0]!, 'subject');
    const value = { ...input, records: [{ ...withoutSubject, subjectStatus: 'invalid' }], subject: { motif: 'unclear', slot: 'unclear' } };
    expect(recoverForgeVerdict(value, false, evidenceHash).subject).toEqual({ motif: 'unclear', slot: 'unclear' });
    expect(() => recoverForgeVerdict({ ...value, subject: dragon }, false, evidenceHash)).toThrow(expect.objectContaining({ code: 'corrupt' }));
  });

  it('recomputes a disputed subject from two reads field by field', () => {
    const input = fixture(); input.records[0]!.answers.hate = 0.4;
    const other = { ...secondary('pass', []), subject: { motif: 'none', slot: 'chimney' } };
    const value = { ...input, outcome: 'hold', records: [input.records[0], other], subject: { motif: 'unclear', slot: 'chimney' } };
    expect(recoverForgeVerdict(value, false, evidenceHash)).toMatchObject({ outcome: 'hold', subject: { motif: 'unclear', slot: 'chimney' } });
    expect(() => recoverForgeVerdict({ ...value, subject: dragon }, false, evidenceHash)).toThrow(expect.objectContaining({ code: 'corrupt' }));
  });

  it('recomputes a matching two-read safety refusal instead of believing a forged pass', () => {
    const input = fixture(); input.records[0]!.answers.hate = 0.99;
    const value = { ...input, records: [input.records[0], secondary('refuse', ['hate'])] };
    expect(() => recoverForgeVerdict(value, false, evidenceHash)).toThrow(expect.objectContaining({ code: 'corrupt' }));
    expect(recoverForgeVerdict({ ...value, outcome: 'refuse' }, false, evidenceHash).outcome).toBe('refuse');
  });

  it('keeps uncertain primary evidence held even when the second read passes', () => {
    const input = fixture(); input.records[0]!.answers.uncertain_language = 0.2;
    const value = { ...input, outcome: 'hold', records: [input.records[0], secondary('pass', [])] };
    expect(recoverForgeVerdict(value, false, evidenceHash).outcome).toBe('hold');
    expect(() => recoverForgeVerdict({ ...value, outcome: 'pass' }, false, evidenceHash)).toThrow();
  });

  it('does not turn one concerning read into a persisted safety refusal', () => {
    const input = fixture(); input.records[0]!.answers.hate = 0.99; input.outcome = 'refuse';
    expect(() => recoverForgeVerdict(input, false, evidenceHash)).toThrow();
  });
});
