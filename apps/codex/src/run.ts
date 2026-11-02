import { randomUUID, createHash } from 'node:crypto';
import { ForgeDraftSchema, ForgeRunRequestSchema, ForgeStyleKitSchema, type ForgeRunEvent, type ForgeDraft, type ForgeStyleKit } from '@chatdom/shared';
import { assembleForge, checkForge, findForgeSockets, forgeStyleKit, homeFingerprint } from '@chatdom/forge';
import { renderForgeContactSheet } from './contact-sheet';
import { createForgeCallBudget, ForgeCallBudgetError, type ForgeCallBudget, type ForgeProviders, type JudgeVerdict, type ForgeDraftCandidate } from './providers';
import { FORGE_WAIT_MESSAGES, type ForgeRunSelection } from './wish-decision';

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
export interface ForgeRunContext { readonly safetyIdentifier: string; readonly styleKit?: ForgeStyleKit }
interface Candidate { draft: ForgeDraft; interpretation: ForgeDraftCandidate['interpretation']; shared: ForgeDraftCandidate['shared']; verdict: number; attempt: number }
const quality = (verdict: JudgeVerdict) => verdict.quality?.score ?? 0;
const goodQuality = (verdict: JudgeVerdict) => quality(verdict) >= 0.72
  && (verdict.quality?.completeness ?? 0) >= 0.7 && (verdict.quality?.cleanMarks ?? 0) >= 0.7;

/** Both gates surround each candidate. Only a safe, assembled candidate can reach the approval sink. */
export async function runForge(input: unknown, providers: ForgeProviders, emit: (event: ForgeRunEvent) => void,
  record: (value: ForgeRunRecord) => Promise<void>, signal?: AbortSignal, context?: ForgeRunContext): Promise<ForgeRunSelection | undefined> {
  const request = ForgeRunRequestSchema.parse(input), id = `forge-${randomUUID()}`, verdicts: JudgeVerdict[] = [];
  const entry: ForgeRunRecord = { id, at: Date.now(), verdicts, outcome: 'running', attempts: 0, modelCalls: 0 };
  const budget = createForgeCallBudget();
  // A previous closest candidate may have opened seven calls. An exact retry still has only five.
  const normalBudget: ForgeCallBudget = { get calls() { return budget.calls; },
    get remaining() { return Math.max(0, Math.min(budget.remaining, 5 - budget.calls)); },
    take() { if (budget.calls >= 5) throw new ForgeCallBudgetError(); budget.take(); },
    increaseLimit(limit) { if (limit !== 5) throw new ForgeCallBudgetError(); },
  };
  const safetyIdentifier = context?.safetyIdentifier ?? createHash('sha256').update('chatdom-local-development-citizen').digest('hex');
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(safetyIdentifier)) throw new Error('Invalid trusted Forge identity.');
  const styleKit = ForgeStyleKitSchema.parse(context?.styleKit ?? forgeStyleKit(request.family));
  const registeredKit = forgeStyleKit(request.family, styleKit.revision);
  if (styleKit.family !== request.family || styleKit.id !== registeredKit.id || styleKit.styleId !== registeredKit.styleId)
    throw new Error('The trusted Forge style kit does not match this home.');
  const abort = () => signal?.throwIfAborted();
  const persist = async () => { entry.modelCalls = budget.calls; await record(structuredClone(entry)); };
  const stop = async (outcome: 'hold' | 'refuse' | 'cold', message: string) => {
    entry.outcome = outcome; await persist(); abort(); emit({ type: 'stopped', outcome, message });
  };
  let best: Candidate | undefined;
  let softening: 'fit' | 'quality' | undefined;
  let feedback: string | undefined;
  const approve = async (): Promise<ForgeRunSelection> => {
    if (!best || verdicts[best.verdict]?.outcome !== 'pass') throw new Error('A safe Forge candidate is required.');
    const selected = best;
    const poor = !goodQuality(verdicts[selected.verdict]!);
    const reason = selected.interpretation === 'closest' ? 'vocabulary' : poor ? 'quality' : softening;
    const delivery = reason ? 'softened' : entry.attempts > 1 ? 'retried' : 'delivered';
    const selection: ForgeRunSelection = { verdict: selected.verdict, attempt: selected.attempt, delivery,
      shared: selected.shared, ...(reason ? { reason } : {}) };
    entry.draft = selected.draft; entry.selection = selection; entry.outcome = 'approved';
    await persist(); abort();
    // Failed drafts, their scores and private explanations never enter the public approval event.
    emit({ type: 'approved', runId: id, draft: selected.draft, hostFingerprint: homeFingerprint(request.home) });
    return selection;
  };
  try {
    abort(); emit({ type: 'stage', stage: 'judging-words' });
    const words = await providers.judgeWords({ words: request.words, safetyIdentifier, budget, ...(signal ? { signal } : {}) });
    verdicts.push(words); abort();
    if (words.outcome !== 'pass') { await stop(words.outcome, words.reason); return; }
    const sockets = findForgeSockets(request.home, request.hostProfile, styleKit.revision);
    if (!sockets.length) { await stop('hold', FORGE_WAIT_MESSAGES.noSlot); return; }
    for (let attempt = 1; attempt <= 2; attempt++) {
      abort();
      // A second draft needs an independent result read. Never start work that cannot be checked.
      if (attempt > 1 && budget.remaining < 2) break;
      entry.attempts = attempt;
      emit({ type: 'stage', stage: 'drafting' });
      const draftInput = { words: request.words, family: request.family, availableSockets: sockets, budget,
        ...(feedback ? { feedback } : {}), ...(signal ? { signal } : {}) };
      const candidate: ForgeDraftCandidate = providers.draftCandidate
        ? await providers.draftCandidate(draftInput)
        : { draft: await providers.draft(draftInput), interpretation: 'as-wished', shared: 'subject' };
      abort();
      const draft = ForgeDraftSchema.parse(candidate.draft);
      if (candidate.interpretation === 'closest') budget.increaseLimit(7);
      const resultBudget = candidate.interpretation === 'as-wished' && !softening ? normalBudget : budget;
      if (!resultBudget.remaining) { if (best) break; throw new ForgeCallBudgetError(); }
      emit({ type: 'stage', stage: 'assembling' });
      let sheet: string;
      try {
        const socket = sockets.find(socket => socket.kind === draft.plan.kind);
        if (!socket) throw new Error('No matching socket.');
        const assembled = assembleForge(draft.plan, styleKit, socket);
        checkForge(assembled, request.home, request.hostProfile);
        sheet = renderForgeContactSheet(assembled.blueprint, { home: request.home, origin: socket.origin });
      } catch {
        abort();
        feedback = 'The first shape did not fit the available house socket. Choose a simpler authored part that fits; preserve the original subject where the kit allows it.';
        softening = 'fit';
        budget.increaseLimit(7);
        continue;
      }
      abort(); emit({ type: 'stage', stage: 'judging-piece' });
      const judged = await providers.judgeResult({ draft, wish: request.words, contactSheet: sheet, safetyIdentifier, budget: resultBudget, ...(signal ? { signal } : {}) });
      verdicts.push(judged); abort();
      if (judged.outcome !== 'pass') {
        if (best) break;
        await stop(judged.outcome, judged.reason); return;
      }
      const current: Candidate = { draft, interpretation: candidate.interpretation, shared: candidate.shared, verdict: verdicts.length - 1, attempt };
      if (!best || quality(judged) > quality(verdicts[best.verdict]!)) best = current;
      if (goodQuality(judged)) break;
      feedback = 'The result is safe, but its subject or small details were hard to read. Strengthen the original subject using the authored kit, try a simpler finish and fewer accents, or explicitly choose the closest related shape. Do not claim an absent subject in the title or plaque.';
    }
    if (best) return await approve();
    await stop('hold', FORGE_WAIT_MESSAGES.fit);
  } catch (error) {
    if (signal?.aborted) throw error;
    // A failed retry cannot erase a checked safe candidate. Reuse only that candidate’s own evidence.
    if (best && entry.outcome === 'running') return await approve();
    if (entry.outcome !== 'running') throw error; // Failed audit/publication never becomes a second verdict.
    await stop('cold', error instanceof ForgeCallBudgetError ? FORGE_WAIT_MESSAGES.budget : FORGE_WAIT_MESSAGES.service);
  }
}
