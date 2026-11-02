import { createHash } from 'node:crypto';
import { ForgeDraftCandidateSchema, createForgeCallBudget, ForgeCallBudgetError, ForgeProviderColdError, type ForgeCallBudget,
  type ForgeProviders, type JudgeVerdict } from './providers';
import { ForgeRunRequestSchema, ForgeStyleKitSchema, type ForgeRunEvent, type ForgeDraft, type ForgeStyleKit } from '@chatdom/shared';
import { assembleForge, checkForge, findForgeSockets, forgeStyleKit, homeFingerprint } from '@chatdom/forge';
import { renderForgeContactSheetCooperatively } from './contact-sheet';
import type { ForgeRunSelection } from './wish-decision';
import { bestForgeCandidate, forgeRunSelection, forgeRunStopMessage, goodForgeQuality, initialForgeRunState } from './run-recovery/state';
import { forgeEarlyRedraft, forgeQualityRetryUseful, forgeRedraftFeedback, forgeResultMeasure, withForgeQuality } from './quality';
import { forgeReadableFinishes } from './certificates';
import { ForgeRunRecoveryError, type ForgeRecoveryStage, type ForgeRunRecovery, type ForgeRunStopCode } from './run-recovery/types';

/** Audit metadata deliberately omits the original wish and the whole home. */
export interface ForgeRunRecord {
  id: string;
  at: number;
  draft?: ForgeDraft;
  verdicts: JudgeVerdict[];
  outcome: 'running' | 'approved' | 'hold' | 'refuse' | 'cold';
  attempts: number;
  modelCalls: number;
  selection?: ForgeRunSelection;
}
/** Supplied by trusted server identity, never by a browser or model plan. */
export interface ForgeRunContext {
  readonly safetyIdentifier: string;
  readonly styleKit?: ForgeStyleKit;
  readonly recovery?: ForgeRunRecovery;
}

/** Both gates surround each candidate. Durable runs resume completed stages within their original call budget. */
export async function runForge(input: unknown, providers: ForgeProviders, emit: (event: ForgeRunEvent) => void,
  record: (value: ForgeRunRecord) => Promise<void>, signal?: AbortSignal, context?: ForgeRunContext): Promise<ForgeRunSelection | undefined> {
  const request = ForgeRunRequestSchema.parse(input), recovery = context?.recovery;
  const safetyIdentifier = context?.safetyIdentifier ?? createHash('sha256').update('chatdom-local-development-citizen').digest('hex');
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(safetyIdentifier)) throw new Error('Invalid trusted Forge identity.');
  const styleKit = ForgeStyleKitSchema.parse(context?.styleKit ?? forgeStyleKit(request.family));
  const registeredKit = forgeStyleKit(request.family, styleKit.revision);
  if (styleKit.family !== request.family || styleKit.id !== registeredKit.id || styleKit.styleId !== registeredKit.styleId)
    throw new Error('The trusted Forge style kit does not match this home.');
  const state = recovery ? await recovery.restore({ request, styleKit, safetyIdentifier }) : initialForgeRunState();
  const localBudget = createForgeCallBudget();
  const budgetFor = (stage: ForgeRecoveryStage, exact = false): ForgeCallBudget => {
    if (recovery) return recovery.budget(stage, exact);
    if (!exact) return localBudget;
    // A previous closest candidate may have opened seven calls. An exact retry still has only five.
    return { get calls() { return localBudget.calls; },
      get remaining() { return Math.max(0, Math.min(localBudget.remaining, 5 - localBudget.calls)); },
      take() { if (localBudget.calls >= 5) throw new ForgeCallBudgetError(); return localBudget.take(); },
      increaseLimit(limit) { if (limit !== 5) throw new ForgeCallBudgetError(); },
    };
  };
  const extend = async (reason: 'fit' | 'vocabulary') => {
    if (recovery) await recovery.extend(reason); else localBudget.increaseLimit(7);
  };
  const abort = () => signal?.throwIfAborted();
  let lastStage: ForgeRecoveryStage = 'words';
  let transientStopMessage: string | undefined;
  const save = async (stage: ForgeRecoveryStage) => { lastStage = stage; if (recovery) await recovery.save(state, stage); abort(); };
  const audit = async (outcome: ForgeRunRecord['outcome'], selection?: ForgeRunSelection) => {
    const draft = selection ? state.candidates[state.best!]!.draft : undefined;
    await record(structuredClone({ id: state.id, at: state.at, verdicts: state.verdicts, outcome,
      attempts: state.attempts, modelCalls: budgetFor(lastStage).calls,
      ...(draft ? { draft } : {}), ...(selection ? { selection } : {}) }));
  };
  const publishStop = async () => {
    if (!state.stop) throw new ForgeRunRecoveryError('corrupt');
    await audit(state.stop.outcome); abort();
    emit({ type: 'stopped', outcome: state.stop.outcome, message: transientStopMessage ?? forgeRunStopMessage(state) });
  };
  const stop = async (outcome: 'hold' | 'refuse' | 'cold', code: ForgeRunStopCode, stage = lastStage, message?: string) => {
    // Existing in-memory callers keep their private provider wording. Durable snapshots retain only
    // fixed host codes, so recovery never persists arbitrary provider prose or turns it into public copy.
    transientStopMessage = recovery ? undefined : message;
    state.phase = 'stopped'; state.stop = { outcome, code }; delete state.pending;
    await save(stage); await publishStop();
  };
  const approve = async (): Promise<ForgeRunSelection> => {
    const selection = forgeRunSelection(state);
    if (state.phase !== 'approved') { state.phase = 'approved'; delete state.pending; await save('result'); }
    await audit('approved', selection); abort();
    emit({ type: 'approved', runId: state.id, draft: state.candidates[state.best!]!.draft, hostFingerprint: homeFingerprint(request.home) });
    return selection;
  };
  try {
    abort();
    if (state.phase === 'approved') return await approve();
    if (state.phase === 'stopped') { await publishStop(); return; }
    const sockets = findForgeSockets(request.home, request.hostProfile, styleKit.revision);
    /** Whether a plan the words name would actually assemble on this home; redrafts never chase a piece that cannot land. */
    const fits = (plan: ForgeDraft['plan']) => {
      const socket = sockets.find(socket => socket.kind === plan.kind);
      if (!socket) return false;
      try { checkForge(assembleForge(plan, styleKit, socket), request.home, request.hostProfile); return true; } catch { return false; }
    };
    if (state.phase === 'words') {
      lastStage = 'words'; emit({ type: 'stage', stage: 'judging-words' });
      const raw = await providers.judgeWords({ words: request.words, safetyIdentifier, budget: budgetFor('words'), ...(signal ? { signal } : {}) });
      const words = recovery ? recovery.verdict(raw, false) : raw;
      state.verdicts.push(words);
      if (words.outcome !== 'pass') { await stop(words.outcome, words.outcome === 'refuse' ? 'safety-refuse' : 'safety-hold', 'words', words.reason); return; }
      if (!sockets.length) { await stop('hold', 'no-slot', 'words'); return; }
      state.phase = 'drafting'; state.attempts = 1; await save('words');
    }
    while (state.phase === 'drafting' || state.phase === 'assembling') {
      abort();
      if (state.phase === 'drafting') {
        lastStage = 'drafting';
        // A draft that cannot receive an independent result read must not start, including after recovery.
        if (budgetFor('drafting').remaining < 2) {
          if (state.best !== undefined) { state.phase = 'selecting'; break; }
          throw new ForgeCallBudgetError();
        }
        emit({ type: 'stage', stage: 'drafting' });
        const readableFinishes = forgeReadableFinishes(request.family, styleKit.revision);
        const lastVerdict = state.candidates.length ? state.verdicts[state.candidates.at(-1)!.verdict] : undefined;
        const draftInput = { words: request.words, family: request.family, availableSockets: sockets, budget: budgetFor('drafting'),
          ...(Object.keys(readableFinishes).length ? { readableFinishes } : {}),
          ...(state.feedback ? { feedback: forgeRedraftFeedback(state.feedback, state.verdicts[0]?.subject, lastVerdict) } : {}),
          ...(signal ? { signal } : {}) };
        const candidate = providers.draftCandidate ? await providers.draftCandidate(draftInput)
          : { draft: await providers.draft(draftInput), interpretation: 'as-wished' as const, shared: 'subject' as const };
        const parsed = ForgeDraftCandidateSchema.parse(candidate);
        // The word gate named a kit subject or an available slot the draft missed: redraft quietly, unjudged.
        if (state.attempts < 2 && forgeEarlyRedraft(state.verdicts[0]?.subject, parsed.draft, sockets, fits)
          && budgetFor('drafting').remaining >= 2) {
          state.feedback = 'subject'; state.attempts += 1; await save('drafting'); continue;
        }
        state.pending = parsed; state.phase = 'assembling';
        await save('drafting');
      }
      const candidate = state.pending;
      if (!candidate) throw new ForgeRunRecoveryError('corrupt');
      if (candidate.interpretation === 'closest') await extend('vocabulary');
      const resultBudget = budgetFor('result', candidate.interpretation === 'as-wished' && !state.softening);
      if (!resultBudget.remaining) {
        if (state.best !== undefined) { state.phase = 'selecting'; break; }
        throw new ForgeCallBudgetError();
      }
      emit({ type: 'stage', stage: 'assembling' });
      let sheet: string;
      try {
        const socket = sockets.find(socket => socket.kind === candidate.draft.plan.kind);
        if (!socket) throw new Error('No matching socket.');
        const assembled = assembleForge(candidate.draft.plan, styleKit, socket);
        checkForge(assembled, request.home, request.hostProfile);
        // In slices, so the realm's rooms keep moving while the sheet is drawn (contact-sheet.ts).
        sheet = await renderForgeContactSheetCooperatively(assembled.blueprint, { home: request.home, origin: socket.origin }, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        abort(); state.feedback = 'fit'; state.softening = 'fit'; delete state.pending;
        await extend('fit');
        if (state.attempts < 2) { state.attempts += 1; state.phase = 'drafting'; }
        else state.phase = 'selecting';
        await save('drafting'); continue;
      }
      abort(); lastStage = 'result'; emit({ type: 'stage', stage: 'judging-piece' });
      const raw = await providers.judgeResult({ draft: candidate.draft, wish: request.words, contactSheet: sheet,
        safetyIdentifier, budget: resultBudget, ...(signal ? { signal } : {}) });
      const checked = recovery ? recovery.verdict(raw, true, candidate.draft, sheet) : raw;
      // Quality is computed, never read: the two independent word readings, the plan and the kit certificate.
      const judged = withForgeQuality(checked, forgeResultMeasure({ words: state.verdicts[0]?.subject, result: checked.subject,
        draft: candidate.draft, styleKit, sockets }));
      state.verdicts.push(judged);
      state.candidates.push({ ...candidate, verdict: state.verdicts.length - 1, attempt: state.attempts });
      delete state.pending;
      const best = bestForgeCandidate(state);
      if (best === undefined) delete state.best; else state.best = best;
      if (judged.outcome !== 'pass' && state.best === undefined) {
        await stop(judged.outcome, judged.outcome === 'refuse' ? 'safety-refuse' : 'safety-hold', 'result', judged.reason); return;
      }
      if (judged.outcome === 'pass' && !goodForgeQuality(judged) && state.attempts < 2
        && forgeQualityRetryUseful(judged, request.family, styleKit.revision,
          partial => fits({ ...candidate.draft.plan, ...partial })) && budgetFor('drafting').remaining >= 2) {
        state.feedback = 'quality'; state.attempts += 1; state.phase = 'drafting';
      } else state.phase = 'selecting';
      await save('result');
    }
    if (state.best !== undefined) return await approve();
    await stop('hold', 'fit');
  } catch (error) {
    if (signal?.aborted || error instanceof ForgeRunRecoveryError) throw error;
    // A failed retry cannot erase a checked safe candidate. Only that candidate's exact evidence can publish.
    if (state.best !== undefined && state.phase !== 'approved' && state.phase !== 'stopped') return await approve();
    if (state.phase === 'approved' || state.phase === 'stopped') throw error;
    // A queued wish whose model process went away mid-call pauses and resumes from its saved stage. The lost call stays
    // spent, so the wish's five- or seven-call ceiling still bounds how often it can try; it is never told "cold" for it.
    if (recovery && error instanceof ForgeProviderColdError)
      throw new ForgeRunRecoveryError('interrupted');
    await stop('cold', error instanceof ForgeCallBudgetError ? 'budget' : 'service');
  }
}
