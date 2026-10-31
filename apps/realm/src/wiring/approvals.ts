import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { TokenSchema } from '@chatdom/shared';
import type { KingdomForgeAudit } from '../../../codex/src/kingdom-forge/ports';
import { FORGE_JUDGE_POLICY_VERSION, FORGE_JUDGE_THRESHOLDS, forgeJudgeQuestions } from '../../../codex/src/providers/policy';
import { canonicalJson } from '../persistence/codec';
import type { RealmForgeApprovals } from './types';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const AuditSchema = z.strictObject({
  key: z.string().regex(/^forge-chat-[a-f0-9]{64}$/), runId: TokenSchema,
  at: z.number().int().nonnegative().safe(), judgment: z.enum(['approved', 'hold', 'refuse', 'cold']),
  verdicts: z.array(z.strictObject({ outcome: z.enum(['pass', 'hold', 'refuse']), records: z.array(z.unknown()).max(4) })).max(3),
});
const base = {
  backend: z.literal('codex-cli'), policy: z.literal(FORGE_JUDGE_POLICY_VERSION),
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/), status: z.literal('complete'),
};
const PrimarySchema = z.strictObject({ ...base, judge: z.literal('gpt-6-luna'), model: z.literal('gpt-6-luna'),
  probabilitySource: z.literal('model-self-estimate'),
  thresholds: z.strictObject({ passBelow: z.literal(FORGE_JUDGE_THRESHOLDS.passBelow), refuseAbove: z.literal(FORGE_JUDGE_THRESHOLDS.refuseAbove) }),
  answers: z.record(z.string(), z.number().finite().min(0).max(1)),
});
const SecondarySchema = z.strictObject({ ...base, judge: z.literal('gpt-6.1-terra'), model: z.literal('gpt-6.1-terra'),
  outcome: z.literal('pass'), imageUncertaintyCleared: z.literal(true).optional(),
});

/** Check the actual registered independent judges at BOTH coordinator gates, without retaining provider text. */
function approvedAudit(audit: KingdomForgeAudit): boolean {
  if (audit.judgment !== 'approved' || audit.verdicts.length !== 2) return false;
  return audit.verdicts.every((verdict, index) => {
    if (verdict.outcome !== 'pass' || verdict.records.length !== 2) return false;
    const primary = PrimarySchema.safeParse(verdict.records[0]), secondary = SecondarySchema.safeParse(verdict.records[1]);
    if (!primary.success || !secondary.success || primary.data.evidenceHash !== secondary.data.evidenceHash) return false;
    const answers = primary.data.answers, questions = forgeJudgeQuestions(index === 1);
    if (Object.keys(answers).length !== questions.length || !questions.every(({ name }) => Object.hasOwn(answers, name))) return false;
    if (answers.uncertain_language! >= FORGE_JUDGE_THRESHOLDS.passBelow) return false;
    if (Object.values(answers).some(value => value > FORGE_JUDGE_THRESHOLDS.refuseAbove)) return false;
    const uncertain = Object.values(answers).some(value => value >= FORGE_JUDGE_THRESHOLDS.passBelow);
    return uncertain ? index === 1 && secondary.data.imageUncertaintyCleared === true : secondary.data.imageUncertaintyCleared === undefined;
  });
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
    // Approved records must contain the complete, allowlisted two-judge evidence; malformed approval is a hold.
    if (parsed.judgment === 'approved' && !approvedAudit(parsed)) throw new Error('The Forge approval lacks both independent judge gates');
    const audit = parsed.judgment === 'approved' ? parsed : { ...parsed, verdicts: parsed.verdicts.map(verdict => ({ outcome: verdict.outcome, records: [] })) };
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

  async approved(key: string, runId: string): Promise<string | null> {
    if (!/^forge-chat-[a-f0-9]{64}$/.test(key) || !TokenSchema.safeParse(runId).success) return null;
    let bytes: string;
    try {
      const file = await open(this.path(key, runId), 'r');
      try { if ((await file.stat()).size > 32_768) return null; bytes = await file.readFile('utf8'); }
      finally { await file.close(); }
    } catch (error) { if (isCode(error, 'ENOENT')) return null; throw error; }
    let audit: z.infer<typeof AuditSchema>;
    try { audit = AuditSchema.parse(JSON.parse(bytes)); } catch { return null; }
    if (audit.key !== key || audit.runId !== runId || !approvedAudit(audit)) return null;
    return `forge-judges-${hash(bytes)}`;
  }

  private path(key: string, runId: string) { return join(this.directory, `${hash(JSON.stringify([key, runId]))}.json`); }
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
