import { z } from 'zod';
import { FORGE_JUDGE_MESSAGES, type JudgeVerdict } from '../providers';
import { FORGE_DETAIL_MATCHES, FORGE_JUDGE_POLICY_VERSION, FORGE_JUDGE_THRESHOLDS, FORGE_SUBJECT_MOTIFS, FORGE_SUBJECT_SLOTS,
  combineForgeWishSubject, decideForgeSafety, forgeJudgeQuestions, forgeMeasureDetailMatch, primaryForgeSafetyPass,
  scoreForgeMeasure, type ForgeQualityMeasure } from '../providers/policy';
import { ForgeRunRecoveryError } from './types';

/** Key order differs between host-built values and schema-parsed ones; evidence compares content, never order. */
const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
const canonical = (value: unknown): string => value && typeof value === 'object' && !Array.isArray(value)
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : JSON.stringify(value) ?? 'undefined';
const unit = z.number().finite().min(0).max(1);
const subject = z.strictObject({ motif: z.enum([...FORGE_SUBJECT_MOTIFS, 'none']), slot: z.enum([...FORGE_SUBJECT_SLOTS, 'none']) });
const reading = z.strictObject({ motif: z.enum([...FORGE_SUBJECT_MOTIFS, 'none', 'unclear']), slot: z.enum([...FORGE_SUBJECT_SLOTS, 'none', 'unclear']) });
const score = z.strictObject({ recognisability: unit, completeness: unit, cleanMarks: unit, score: unit, policy: z.literal(FORGE_JUDGE_POLICY_VERSION) });
export const ForgeQualityMeasureSchema = z.strictObject({ words: reading, result: reading,
  plan: z.strictObject({ motif: z.enum(FORGE_SUBJECT_MOTIFS), kind: z.enum(FORGE_SUBJECT_SLOTS) }),
  certificate: z.enum(['reads', 'weak', 'unread', 'uncertified']), slotAvailable: z.boolean() });
const metadata = {
  backend: z.literal('codex-cli'), policy: z.literal(FORGE_JUDGE_POLICY_VERSION),
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/), status: z.enum(['complete', 'invalid']),
  subject: subject.optional(), subjectStatus: z.enum(['complete', 'invalid']),
};
const primarySchema = z.strictObject({ ...metadata, judge: z.literal('gpt-6-luna'), model: z.literal('gpt-6-luna'),
  probabilitySource: z.literal('model-self-estimate'),
  thresholds: z.strictObject({ passBelow: z.literal(FORGE_JUDGE_THRESHOLDS.passBelow), refuseAbove: z.literal(FORGE_JUDGE_THRESHOLDS.refuseAbove) }),
  answers: z.record(z.string(), unit),
});
const secondarySchema = z.strictObject({ ...metadata, judge: z.literal('gpt-6.1-terra'), model: z.literal('gpt-6.1-terra'),
  outcome: z.enum(['pass', 'hold', 'refuse']).optional(), concerns: z.array(z.string()).max(8).optional(),
});
const verdictSchema = z.strictObject({ outcome: z.enum(['pass', 'hold', 'refuse']), reason: z.string().max(240),
  records: z.array(z.unknown()).min(1).max(2), subject: reading,
  measure: ForgeQualityMeasureSchema.optional(), quality: score.optional(), detailMatch: z.enum(FORGE_DETAIL_MATCHES).optional() });

/**
 * Recompute safety, the subject reading and (when the host has measured it) quality from bounded actual read
 * records. Original provider reasons are discarded. A provider's raw result carries no measure; a stored one
 * must carry exactly the measure the caller recomputed from this run's own evidence.
 */
export function recoverForgeVerdict(input: unknown, image: boolean, evidenceHash: string, expected?: ForgeQualityMeasure): JudgeVerdict {
  try {
    const verdict = verdictSchema.parse(input), primary = primarySchema.parse(verdict.records[0]);
    const secondary = verdict.records.length === 2 ? secondarySchema.parse(verdict.records[1]) : undefined;
    const questions = forgeJudgeQuestions(image).map(question => question.name);
    if (primary.evidenceHash !== evidenceHash || secondary && secondary.evidenceHash !== evidenceHash) throw new Error();
    const answers = primary.answers;
    if (primary.status === 'complete'
      ? Object.keys(answers).length !== questions.length || !questions.every(name => Object.hasOwn(answers, name))
      : Object.keys(answers).length !== 0) throw new Error();
    if (secondary) {
      const concerns = secondary.concerns;
      if (concerns && (new Set(concerns).size !== concerns.length || concerns.some(name => !questions.some(question => question === name)))) throw new Error();
      if (secondary.status === 'complete') {
        if (!secondary.outcome || secondary.outcome === 'refuse' && !concerns?.length
          || secondary.outcome === 'pass' && concerns?.length) throw new Error();
      } else if (secondary.outcome !== undefined || concerns !== undefined) throw new Error();
    }
    let outcome: JudgeVerdict['outcome'];
    if (!secondary) {
      if (primary.status !== 'complete' || !primaryForgeSafetyPass(answers)) throw new Error();
      outcome = 'pass';
    } else outcome = primary.status !== 'complete' || secondary.status !== 'complete' || !secondary.outcome ? 'hold'
      : decideForgeSafety(answers, { outcome: secondary.outcome,
        ...(secondary.concerns ? { concerns: secondary.concerns as NonNullable<Parameters<typeof decideForgeSafety>[1]['concerns']> } : {}) });
    if (verdict.outcome !== outcome) throw new Error();
    const reads = [primary, ...(secondary ? [secondary] : [])];
    for (const read of reads) if ((read.subjectStatus === 'complete') !== (read.subject !== undefined)
      || read.status === 'invalid' && read.subject !== undefined) throw new Error();
    const combined = combineForgeWishSubject(...reads.map(read => read.subject));
    if (!same(combined, verdict.subject)) throw new Error();
    const recovered: JudgeVerdict = { outcome, reason: FORGE_JUDGE_MESSAGES[outcome], records: reads, subject: combined };
    if (!image || !expected) {
      if (verdict.measure || verdict.quality || verdict.detailMatch) throw new Error();
      return recovered;
    }
    if (!same(ForgeQualityMeasureSchema.parse(expected), verdict.measure) || !same(expected.result, combined)) throw new Error();
    const quality = scoreForgeMeasure(expected), detailMatch = forgeMeasureDetailMatch(expected);
    if (!same(quality, verdict.quality) || detailMatch !== verdict.detailMatch) throw new Error();
    return { ...recovered, measure: expected, quality, detailMatch };
  } catch { throw new ForgeRunRecoveryError('corrupt'); }
}
