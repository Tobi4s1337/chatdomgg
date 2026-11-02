import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { TokenSchema } from '@chatdom/shared';
import type { KingdomForgeAudit } from '../../../codex/src/kingdom-forge/ports';
import { ForgeCandidateBindingSchema, type ForgeCandidateBinding } from '../../../codex/src/kingdom-forge/candidate';
import { FORGE_JUDGE_POLICY_VERSION, FORGE_JUDGE_THRESHOLDS, forgeJudgeQuestions, decideForgeSafety,
  primaryForgeSafetyPass, scoreForgeMeasure, forgeMeasureDetailMatch, FORGE_DETAIL_MATCHES, FORGE_SUBJECT_MOTIFS, FORGE_SUBJECT_SLOTS,
  combineForgeWishSubject } from '../../../codex/src/providers/policy';
import { ForgeQualityMeasureSchema } from '../../../codex/src/run-recovery/evidence';
import { canonicalJson } from '../persistence/codec';
import type { RealmForgeApprovals } from './types';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const qualityRead = { recognisability: z.number().finite().min(0).max(1), completeness: z.number().finite().min(0).max(1), cleanMarks: z.number().finite().min(0).max(1) };
const SubjectSchema = z.strictObject({ motif: z.enum([...FORGE_SUBJECT_MOTIFS, 'none']), slot: z.enum([...FORGE_SUBJECT_SLOTS, 'none']) });
const ReadingSchema = z.strictObject({ motif: z.enum([...FORGE_SUBJECT_MOTIFS, 'none', 'unclear']), slot: z.enum([...FORGE_SUBJECT_SLOTS, 'none', 'unclear']) });
const QualityScoreSchema = z.strictObject({ ...qualityRead, score: z.number().finite().min(0).max(1), policy: z.literal(FORGE_JUDGE_POLICY_VERSION) });
const DetailMatchSchema = z.enum(FORGE_DETAIL_MATCHES);
const SelectionSchema = z.strictObject({ verdict: z.number().int().min(1).max(2), attempt: z.number().int().min(1).max(2),
  delivery: z.enum(['delivered', 'retried', 'softened']), shared: z.enum(['subject', 'family', 'slot', 'mood', 'colour']),
  reason: z.enum(['vocabulary', 'quality', 'fit']).optional() });
const AuditSchema = z.strictObject({
  key: z.string().regex(/^forge-chat-[a-f0-9]{64}$/), runId: TokenSchema,
  at: z.number().int().nonnegative().safe(), judgment: z.enum(['approved', 'hold', 'refuse', 'cold']),
  verdicts: z.array(z.strictObject({ outcome: z.enum(['pass', 'hold', 'refuse']), records: z.array(z.unknown()).max(4),
    subject: ReadingSchema.optional(), measure: ForgeQualityMeasureSchema.optional(),
    quality: QualityScoreSchema.optional(), detailMatch: DetailMatchSchema.optional() })).max(3),
  selection: SelectionSchema.optional(), attempts: z.number().int().min(0).max(2).optional(), modelCalls: z.number().int().min(0).max(7).optional(),
  candidate: ForgeCandidateBindingSchema.optional(),
});
const base = {
  backend: z.literal('codex-cli'), policy: z.literal(FORGE_JUDGE_POLICY_VERSION),
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/), status: z.literal('complete'),
  subject: SubjectSchema.optional(), subjectStatus: z.enum(['complete', 'invalid']),
};
const PrimarySchema = z.strictObject({ ...base, judge: z.literal('gpt-6-luna'), model: z.literal('gpt-6-luna'),
  probabilitySource: z.literal('model-self-estimate'),
  thresholds: z.strictObject({ passBelow: z.literal(FORGE_JUDGE_THRESHOLDS.passBelow), refuseAbove: z.literal(FORGE_JUDGE_THRESHOLDS.refuseAbove) }),
  answers: z.record(z.string(), z.number().finite().min(0).max(1)),
});
const SecondarySchema = z.strictObject({ ...base, judge: z.literal('gpt-6.1-terra'), model: z.literal('gpt-6.1-terra'),
  outcome: z.literal('pass'), concerns: z.array(z.string()).max(0).optional(),
});

/** Verify a complete independent gate; exactly the reads actually made, never an invented second approval. */
function approvedGate(verdict: z.infer<typeof AuditSchema>['verdicts'][number], image: boolean): boolean {
    if (verdict.outcome !== 'pass' || (verdict.records.length !== 1 && verdict.records.length !== 2)) return false;
    const primary = PrimarySchema.safeParse(verdict.records[0]);
    const secondary = verdict.records.length === 2 ? SecondarySchema.safeParse(verdict.records[1]) : undefined;
    if (!primary.success || (secondary && (!secondary.success || primary.data.evidenceHash !== secondary.data.evidenceHash))) return false;
    const second = secondary?.success ? secondary.data : undefined;
    const answers = primary.data.answers, questions = forgeJudgeQuestions(image);
    if (Object.keys(answers).length !== questions.length || !questions.every(({ name }) => Object.hasOwn(answers, name))) return false;
    if (second ? decideForgeSafety(answers, { outcome: second.outcome }) !== 'pass' : !primaryForgeSafetyPass(answers)) return false;
    const reads = [primary.data, ...(second ? [second] : [])];
    if (reads.some(read => (read.subjectStatus === 'complete') !== (read.subject !== undefined))) return false;
    if (!verdict.subject || canonicalJson(verdict.subject) !== canonicalJson(combineForgeWishSubject(...reads.map(read => read.subject)))) return false;
    if (!image) return !verdict.measure && !verdict.quality && !verdict.detailMatch;
    // Quality is recomputed from its finite measure; it can never veto a safety approval, only describe it.
    if (!verdict.measure || !verdict.quality || !verdict.detailMatch
      || canonicalJson(verdict.measure.result) !== canonicalJson(verdict.subject)) return false;
    return canonicalJson(verdict.quality) === canonicalJson(scoreForgeMeasure(verdict.measure))
      && verdict.detailMatch === forgeMeasureDetailMatch(verdict.measure);
}

/** Only the selected result can approve the piece; previous draft outcomes remain private summaries. */
function approvedAudit(audit: z.infer<typeof AuditSchema>): boolean {
  if (audit.judgment !== 'approved' || audit.verdicts.length < 2 || !audit.candidate) return false;
  const selected = audit.selection?.verdict ?? 1;
  if (!audit.selection && audit.verdicts.length !== 2) return false;
  if (!audit.verdicts[selected] || !approvedGate(audit.verdicts[0]!, false) || !approvedGate(audit.verdicts[selected]!, true)) return false;
  // The measured word reading must be the word gate's own recorded reading.
  if (canonicalJson(audit.verdicts[selected]!.measure!.words) !== canonicalJson(audit.verdicts[0]!.subject)) return false;
  if (audit.selection) {
    if ((audit.selection.delivery === 'softened') !== (audit.selection.reason !== undefined)) return false;
    if (audit.selection.attempt > (audit.attempts ?? 2) || (audit.selection.delivery === 'retried' && audit.attempts === 1)) return false;
  }
  if ((audit.modelCalls ?? 0) > 5 && audit.selection?.delivery !== 'softened') return false;
  return audit.verdicts.every((verdict, index) => index === 0 || index === selected || verdict.records.length === 0);
}

/**
 * Private immutable audit files, not world state. The trusted coordinator writes the record before asking the
 * durable room to commit. No route accepts these records from browsers. A receipt never claims world commit.
 * Use a persistent host-configured directory shared by the coordinator and realm authority.
 */
export class FileForgeApprovals implements RealmForgeApprovals {
  private readonly directory: string;
  constructor(directory: string) {
    if (!directory.trim()) throw new TypeError('A private Forge audit directory is required');
    this.directory = resolve(directory);
  }

  async record(input: KingdomForgeAudit): Promise<void> {
    const parsed = AuditSchema.parse(input);
    // Refusals/holds carry no approval receipt. Keep only bounded outcome codes, never arbitrary provider records.
    // Approved records require complete evidence at both independent gates; malformed approval cannot mint.
    if (parsed.judgment === 'approved' && !approvedAudit(parsed)) throw new Error('The Forge approval lacks both independent judge gates');
    const audit = parsed.judgment === 'approved' ? parsed : { ...parsed, verdicts: parsed.verdicts.map(verdict => ({ outcome: verdict.outcome, records: [],
      ...(verdict.measure ? { measure: verdict.measure } : {}),
      ...(verdict.quality ? { quality: verdict.quality } : {}), ...(verdict.detailMatch ? { detailMatch: verdict.detailMatch } : {}) })) };
    const bytes = canonicalJson(audit), path = this.path(audit.key, audit.runId);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = join(this.directory, `.pending-${randomUUID()}`);
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(bytes, 'utf8'); await file.sync(); await file.close();
      try { await link(temporary, path); }
      catch (error) {
        if (!isCode(error, 'EEXIST')) throw error;
        if (await readFile(path, 'utf8') !== bytes) throw new Error('The Forge audit run is immutable', { cause: error });
      }
      // Also sync on an idempotent retry: a prior caller may have linked the file before losing its reply.
      const directory = await open(this.directory, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
  }

  /** Production supplies the attachment's exact kit. An omitted/digest-only expectation can inspect legacy evidence only. */
  async approved(key: string, runId: string, expected?: ForgeCandidateBinding): Promise<string | null> {
    if (!/^forge-chat-[a-f0-9]{64}$/.test(key) || !TokenSchema.safeParse(runId).success) return null;
    const expectation = expected === undefined ? undefined : ForgeCandidateBindingSchema.safeParse(expected);
    if (expectation && !expectation.success) return null;
    let bytes: string;
    try {
      const file = await open(this.path(key, runId), 'r');
      try { if ((await file.stat()).size > 32_768) return null; bytes = await file.readFile('utf8'); }
      finally { await file.close(); }
    } catch (error) { if (isCode(error, 'ENOENT')) return null; throw error; }
    let audit: z.infer<typeof AuditSchema>;
    try { audit = AuditSchema.parse(JSON.parse(bytes)); } catch { return null; }
    if (audit.key !== key || audit.runId !== runId || !approvedAudit(audit)) return null;
    const candidate = audit.candidate!, bound = expectation?.success ? expectation.data : undefined;
    if (bound && (candidate.draftDigest !== bound.draftDigest || candidate.homeDigest !== bound.homeDigest)) return null;
    if ('kitId' in candidate && 'kitRevision' in candidate) {
      // New evidence can only authorize the exact assembly whose image was inspected, even if draft/home are identical.
      if (!bound || !('kitId' in bound) || !('kitRevision' in bound) || candidate.kitId !== bound.kitId || candidate.kitRevision !== bound.kitRevision) return null;
    } else if (bound && 'kitId' in bound && 'kitRevision' in bound && bound.kitRevision !== 1) {
      // Immutable pre-kit audits remain valid only for the historical kit. Never infer a later revision from the caller.
      return null;
    }
    return `forge-judges-${hash(bytes)}`;
  }

  private path(key: string, runId: string) { return join(this.directory, `${hash(JSON.stringify([key, runId]))}.json`); }
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
