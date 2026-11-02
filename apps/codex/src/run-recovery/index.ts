import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ForgeDraftSchema, ForgeRunRequestSchema, ForgeStyleKitSchema, TokenSchema, type ForgeDraft } from '@chatdom/shared';
import { assembleForge, checkForge, findForgeSockets } from '@chatdom/forge';
import { renderForgeContactSheet } from '../contact-sheet';
import { ForgeCallBudgetError, ForgeDraftCandidateSchema, forgeResultEvidenceHash, forgeWordsEvidenceHash,
  type ForgeCallBudget, type JudgeVerdict } from '../providers';
import { FORGE_JUDGE_POLICY_VERSION } from '../providers/policy';
import { ForgeWishQueueError, type FileForgeWishQueue, type ForgeWishClaim, type ForgeWishJson } from '../wish-queue';
import { recoverForgeVerdict } from './evidence';
import { bestForgeCandidate, forgeRunSelection, initialForgeRunState } from './state';
import { ForgeRunRecoveryError, type ForgeRecoveryStage, type ForgeRunRecovery, type ForgeRunRecoveryInput, type ForgeRunState } from './types';

export * from './types';
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const candidateSchema = ForgeDraftCandidateSchema.extend({ attempt: integer.min(1).max(2), verdict: integer.min(1).max(2) });
const stateSchema = z.strictObject({
  id: TokenSchema, at: integer,
  phase: z.enum(['words', 'drafting', 'assembling', 'selecting', 'approved', 'stopped']),
  attempts: integer.max(2), verdicts: z.array(z.unknown()).max(3), candidates: z.array(candidateSchema).max(2),
  pending: ForgeDraftCandidateSchema.optional(), best: integer.max(1).optional(), softening: z.literal('fit').optional(),
  feedback: z.enum(['fit', 'quality']).optional(),
  stop: z.strictObject({ outcome: z.enum(['hold', 'refuse', 'cold']),
    code: z.enum(['safety-hold', 'safety-refuse', 'no-slot', 'fit', 'service', 'budget']) }).optional(),
});
const envelopeSchema = z.strictObject({ version: z.literal(1), policy: z.literal(FORGE_JUDGE_POLICY_VERSION),
  binding: z.string().regex(/^[a-f0-9]{64}$/), modelCalls: integer.max(7), state: stateSchema });
const digest = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');

/** Resume only this admitted wish's exact run. Nothing here is shared across wishes or independent judges. */
export function createQueuedForgeRunRecovery(queue: FileForgeWishQueue, claim: ForgeWishClaim): ForgeRunRecovery {
  let started = false, initialized = false, binding = '', revision = 0, calls = 0, ceiling: 5 | 7 = 5;
  let context: ForgeRunRecoveryInput | undefined;
  let identity: { id: string; at: number } | undefined;
  let debit: Promise<unknown> = Promise.resolve();
  let debitFailure: ForgeRunRecoveryError | undefined;
  const sheetHashes = new Map<string, string>();

  const current = () => { if (!claim.current() || claim.signal.aborted) throw new ForgeRunRecoveryError('interrupted'); };
  const guarded = async <T>(work: () => Promise<T>): Promise<T> => {
    try { current(); return await work(); }
    catch (error) {
      if (error instanceof ForgeRunRecoveryError || error instanceof ForgeCallBudgetError) throw error;
      if (error instanceof ForgeWishQueueError && error.code === 'budget') throw new ForgeCallBudgetError();
      if (!claim.current() || error instanceof ForgeWishQueueError && (error.code === 'closed' || error.code === 'stale'))
        throw new ForgeRunRecoveryError('interrupted');
      // No filesystem path, provider body or original wish may travel in a cause.
      throw new ForgeRunRecoveryError('unavailable');
    }
  };
  function hashFor(draft: ForgeDraft): string {
    if (!context) throw new ForgeRunRecoveryError('binding');
    const parsed = ForgeDraftSchema.parse(draft), key = JSON.stringify(parsed), cached = sheetHashes.get(key);
    if (cached) return cached;
    const socket = findForgeSockets(context.request.home, context.request.hostProfile, context.styleKit.revision)
      .find(socket => socket.kind === parsed.plan.kind);
    if (!socket) throw new ForgeRunRecoveryError('corrupt');
    const assembled = assembleForge(parsed.plan, context.styleKit, socket);
    checkForge(assembled, context.request.home, context.request.hostProfile);
    const sheet = renderForgeContactSheet(assembled.blueprint, { home: context.request.home, origin: socket.origin });
    const hash = forgeResultEvidenceHash(context.request.words, parsed, sheet); sheetHashes.set(key, hash); return hash;
  }
  function validate(raw: unknown, spent: number): ForgeRunState {
    try {
      if (!context) throw new Error();
      const parsed = stateSchema.parse(raw);
      if (identity && (parsed.id !== identity.id || parsed.at !== identity.at)) throw new Error();
      const verdicts: JudgeVerdict[] = [];
      if (parsed.verdicts.length) verdicts.push(recoverForgeVerdict(parsed.verdicts[0], false, forgeWordsEvidenceHash(context.request.words)));
      if (parsed.verdicts.length !== parsed.candidates.length + (parsed.verdicts.length ? 1 : 0)) throw new Error();
      let previousAttempt = 0;
      for (const [index, candidate] of parsed.candidates.entries()) {
        if (candidate.verdict !== index + 1 || candidate.attempt <= previousAttempt || candidate.attempt > parsed.attempts
          || candidate.interpretation === 'as-wished' && candidate.shared !== 'subject') throw new Error();
        previousAttempt = candidate.attempt;
        verdicts.push(recoverForgeVerdict(parsed.verdicts[index + 1], true, hashFor(candidate.draft)));
      }
      if (parsed.pending && (parsed.pending.interpretation === 'as-wished' && parsed.pending.shared !== 'subject'
        || previousAttempt >= parsed.attempts)) throw new Error();
      const state: ForgeRunState = { id: parsed.id, at: parsed.at, phase: parsed.phase,
        attempts: parsed.attempts, verdicts, candidates: parsed.candidates,
        ...(parsed.pending ? { pending: parsed.pending } : {}), ...(parsed.best !== undefined ? { best: parsed.best } : {}),
        ...(parsed.softening ? { softening: parsed.softening } : {}), ...(parsed.feedback ? { feedback: parsed.feedback } : {}),
        ...(parsed.stop ? { stop: parsed.stop } : {}) };
      if (state.best !== bestForgeCandidate(state)) throw new Error();
      if (state.phase === 'words' && (state.attempts !== 0 || verdicts.length || state.pending || state.stop || state.feedback || state.softening)) throw new Error();
      if (state.phase !== 'words' && state.phase !== 'stopped' && (verdicts[0]?.outcome !== 'pass' || state.attempts < 1)) throw new Error();
      if ((state.phase === 'assembling') !== (state.pending !== undefined)) throw new Error();
      if ((state.phase === 'stopped') !== (state.stop !== undefined)) throw new Error();
      if (state.phase === 'drafting' && previousAttempt >= state.attempts) throw new Error();
      if (state.attempts > 1 && !state.feedback) throw new Error();
      if (state.feedback === 'fit' && state.softening !== 'fit') throw new Error();
      if (state.phase === 'approved') forgeRunSelection(state);
      if (state.stop) {
        if (state.best !== undefined) throw new Error();
        const expected = state.stop.code === 'safety-refuse' ? 'refuse'
          : state.stop.code === 'service' || state.stop.code === 'budget' ? 'cold' : 'hold';
        if (state.stop.outcome !== expected) throw new Error();
        if (state.stop.code === 'safety-refuse' || state.stop.code === 'safety-hold') {
          if (verdicts.at(-1)?.outcome !== state.stop.outcome) throw new Error();
        }
      }
      // Every retained read and returned draft requires a real debit. Extra unanswered debits remain spent.
      const minimumCalls = verdicts.reduce((sum, verdict) => sum + verdict.records.length, 0)
        + state.candidates.length + (state.pending ? 1 : 0);
      if (minimumCalls > spent) throw new Error();
      return state;
    } catch { throw new ForgeRunRecoveryError('corrupt'); }
  }
  async function saveState(state: ForgeRunState, stage: ForgeRecoveryStage) {
    if (!initialized) throw new ForgeRunRecoveryError('binding');
    // A provider deadline can settle while its pre-call filesystem debit is still completing. Wait for
    // that exact debit before snapshotting calls; swallowing it would make the next reopen disagree.
    let settled: Promise<unknown>;
    do { settled = debit; await settled; } while (settled !== debit);
    if (debitFailure) throw debitFailure;
    current();
    const safe = validate(state, calls);
    const snapshot = { version: 1, policy: FORGE_JUDGE_POLICY_VERSION, binding, modelCalls: calls, state: safe };
    await queue.checkpoint(claim, { id: `run-state-${revision}`, stage,
      data: JSON.parse(JSON.stringify(snapshot)) as ForgeWishJson });
    revision += 1; current();
  }
  return {
    restore: input => guarded(async () => {
      if (started) throw new ForgeRunRecoveryError('binding');
      started = true;
      try {
        context = { request: ForgeRunRequestSchema.parse(input.request), styleKit: ForgeStyleKitSchema.parse(input.styleKit),
          safetyIdentifier: input.safetyIdentifier };
        if (context.request.words !== claim.command.words || !/^[A-Za-z0-9_-]{16,128}$/.test(context.safetyIdentifier))
          throw new Error();
      } catch { throw new ForgeRunRecoveryError('binding'); }
      binding = digest(['forge-run-recovery-v1', FORGE_JUDGE_POLICY_VERSION, claim.attempt,
        context.request, context.styleKit, context.safetyIdentifier]);
      const receipt = await queue.get(claim.receipt.key);
      if (!receipt || receipt.state !== 'running' || receipt.generation !== claim.receipt.generation
        || receipt.attemptId !== claim.attempt.attemptId) throw new ForgeRunRecoveryError('interrupted');
      calls = receipt.modelCalls; ceiling = receipt.callLimit;
      let latest: ForgeRunState | undefined, savedCalls = 0;
      const snapshots = claim.checkpoints.filter(checkpoint => checkpoint.id.startsWith('run-state-'));
      for (const checkpoint of snapshots) {
        if (checkpoint.id !== `run-state-${revision}`) throw new ForgeRunRecoveryError('corrupt');
        let parsed: z.infer<typeof envelopeSchema>;
        try { parsed = envelopeSchema.parse(checkpoint.data); }
        catch { throw new ForgeRunRecoveryError('corrupt'); }
        if (parsed.binding !== binding) throw new ForgeRunRecoveryError('binding');
        if (parsed.modelCalls !== checkpoint.modelCalls || parsed.modelCalls < savedCalls || parsed.modelCalls > calls)
          throw new ForgeRunRecoveryError('corrupt');
        const safe = validate(parsed.state, parsed.modelCalls);
        if (!identity) identity = { id: safe.id, at: safe.at };
        latest = safe; savedCalls = parsed.modelCalls; revision += 1;
      }
      initialized = true;
      if (!latest) {
        if (calls !== 0 || ceiling !== 5) throw new ForgeRunRecoveryError('corrupt');
        latest = initialForgeRunState(); identity = { id: latest.id, at: latest.at };
        await saveState(latest, 'words');
      }
      current(); return structuredClone(latest);
    }),
    save: (state, stage) => guarded(() => saveState(state, stage)),
    budget(stage, exact = false): ForgeCallBudget {
      return {
        get calls() { return calls; },
        get remaining() { return Math.max(0, (exact ? Math.min(5, ceiling) : ceiling) - calls); },
        take() {
          const operation = debit.then(() => guarded(async () => {
            if (!initialized) throw new ForgeRunRecoveryError('binding');
            if (calls >= (exact ? Math.min(5, ceiling) : ceiling)) throw new ForgeCallBudgetError();
            const ordinal = await queue.beginModelCall(claim, stage);
            if (ordinal !== calls + 1) throw new ForgeRunRecoveryError('corrupt');
            calls = ordinal; current();
          }));
          debit = operation.catch(error => {
            // Exhausted budget is a normal finite run outcome. Lost/failed durable accounting suspends
            // the entire run, even when a provider deadline raced and hid the original rejection.
            if (error instanceof ForgeRunRecoveryError) debitFailure = error;
          });
          return operation;
        },
        increaseLimit(limit) { if (limit !== 5) throw new ForgeRunRecoveryError('binding'); },
      };
    },
    extend: reason => guarded(async () => {
      if (!initialized) throw new ForgeRunRecoveryError('binding');
      const receipt = await queue.extendBudget(claim, reason); ceiling = receipt.callLimit; current();
    }),
    verdict(value, image, draft, sheet) {
      current();
      if (!initialized || !context || image && (!draft || !sheet)) throw new ForgeRunRecoveryError('binding');
      const hash = image ? forgeResultEvidenceHash(context.request.words, draft!, sheet!) : forgeWordsEvidenceHash(context.request.words);
      if (draft && image) sheetHashes.set(JSON.stringify(ForgeDraftSchema.parse(draft)), hash);
      return recoverForgeVerdict(value, image, hash);
    },
  };
}
