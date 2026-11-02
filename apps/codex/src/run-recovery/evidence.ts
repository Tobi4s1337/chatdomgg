import { z } from 'zod';
import { FORGE_JUDGE_MESSAGES, type JudgeVerdict } from '../providers';
import { FORGE_DETAIL_MATCHES, FORGE_JUDGE_POLICY_VERSION, FORGE_JUDGE_THRESHOLDS, combineForgeDetailMatch,
  decideForgeSafety, forgeJudgeQuestions, primaryForgeSafetyPass, scoreForgeQuality } from '../providers/policy';
import { ForgeRunRecoveryError } from './types';

const unit = z.number().finite().min(0).max(1);
const dimensions = { recognisability: unit, completeness: unit, cleanMarks: unit };
const quality = z.strictObject(dimensions);
const score = z.strictObject({ ...dimensions, score: unit, policy: z.literal(FORGE_JUDGE_POLICY_VERSION) });
const detail = z.enum(FORGE_DETAIL_MATCHES);
const metadata = {
  backend: z.literal('codex-cli'), policy: z.literal(FORGE_JUDGE_POLICY_VERSION),
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/), status: z.enum(['complete', 'invalid']),
  quality: quality.optional(), qualityStatus: z.enum(['complete', 'invalid']).optional(),
  detailMatch: detail.optional(), detailMatchStatus: z.enum(['complete', 'invalid']).optional(),
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
  records: z.array(z.unknown()).min(1).max(2), quality: score.optional(), detailMatch: detail.optional() });

/** Recompute both decisions from bounded actual read records. Original provider reasons are discarded. */
export function recoverForgeVerdict(input: unknown, image: boolean, evidenceHash: string): JudgeVerdict {
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
    if (!image) {
      for (const value of [verdict, ...reads]) for (const key of ['quality', 'qualityStatus', 'detailMatch', 'detailMatchStatus'])
        if (Object.hasOwn(value, key)) throw new Error();
      return { outcome, reason: FORGE_JUDGE_MESSAGES[outcome], records: reads };
    }
    for (const read of reads) {
      if (!read.quality || !read.qualityStatus || !read.detailMatch || !read.detailMatchStatus) throw new Error();
      if (read.qualityStatus === 'invalid' && Object.values(read.quality).some(value => value !== 0)) throw new Error();
      if (read.detailMatchStatus === 'invalid' && read.detailMatch !== 'unclear') throw new Error();
    }
    const computed = scoreForgeQuality(primary.quality!, secondary?.quality);
    const details = combineForgeDetailMatch(primary.detailMatch!, secondary?.detailMatch);
    if (!verdict.quality || Object.keys(computed).some(key =>
      computed[key as keyof typeof computed] !== verdict.quality![key as keyof typeof computed]) || verdict.detailMatch !== details) throw new Error();
    return { outcome, reason: FORGE_JUDGE_MESSAGES[outcome], records: reads, quality: computed, detailMatch: details };
  } catch { throw new ForgeRunRecoveryError('corrupt'); }
}
