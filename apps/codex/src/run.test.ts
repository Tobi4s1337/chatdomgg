import { describe, it, expect, vi } from 'vitest';
import { createHome } from '@chatdom/content';
import { forgeStyleKit } from '@chatdom/forge';
import type { ForgeDraft, ForgeRunEvent } from '@chatdom/shared';
import { runForge, type ForgeRunRecord } from './run';
import { createForgeProviders, ForgeProviderColdError, type ForgeProviders, type ForgeDraftInput, type ForgeResultInput,
  type JudgeVerdict } from './providers';
import { forgeJudgeQuestions, type ForgeSubjectReading } from './providers/policy';
import type { CodexDraftRunner } from './providers/codex-cli';
import { forgeResultMeasure, withForgeQuality } from './quality';
import { FORGE_WAIT_MESSAGES } from './wish-decision';

// Every judged candidate renders a real contact sheet, which is slow on a shared software renderer.
vi.setConfig({ testTimeout: 60_000 });
const home = createHome('house', 'hearth', 0);
const request = { words: 'A chimney for a little dragon who fell asleep guarding my home', family: 'hearth', home };
const plan = (motif: ForgeDraft['plan']['motif'], finish: ForgeDraft['plan']['finish'] = 'native', kind: ForgeDraft['plan']['kind'] = 'chimney') =>
  ({ version: 2 as const, kind, motif, finish, accent: 'none' as const });
const draft: ForgeDraft = { plan: plan('sleeping-dragon'), title: 'The sleepy keeper', plaque: 'A quiet watch over a warm hearth.' };
const second: ForgeDraft = { ...draft, title: 'The hearth keeper', plan: plan('sleeping-dragon', 'copper') };
const owlDraft: ForgeDraft = { plan: plan('watchful-owl'), title: 'The night watcher', plaque: 'An owl keeps the chimney company.' };
const dragon = { motif: 'sleeping-dragon', slot: 'chimney' } as const;
const owl = { motif: 'watchful-owl', slot: 'chimney' } as const;
const unsupported = { motif: 'none', slot: 'none' } as const;
const read = (subject: ForgeSubjectReading, outcome: JudgeVerdict['outcome'] = 'pass'): JudgeVerdict =>
  ({ outcome, reason: 'private provider reason', records: [], subject });
const words = read(dragon);
const sockets = [{ kind: 'chimney' as const }, { kind: 'weathervane' as const }, { kind: 'lantern' as const }];
/** What the host stores for a result read: the raw safety verdict plus the deterministic measure and score. */
const scored = (verdict: JudgeVerdict, piece: ForgeDraft, wordSubject: ForgeSubjectReading = dragon, family: 'hearth' | 'grove' = 'hearth') =>
  withForgeQuality(verdict, forgeResultMeasure({ words: wordSubject, result: verdict.subject, draft: piece, styleKit: forgeStyleKit(family), sockets }));
const stages = (events: ForgeRunEvent[]) => events.map(e => e.type === 'stage' ? e.stage : e.type);
function setup(wordVerdict: JudgeVerdict = words) {
  const events: ForgeRunEvent[] = [], records: ForgeRunRecord[] = [];
  const providers: ForgeProviders = { judgeWords: vi.fn(async () => wordVerdict), draft: vi.fn(async () => draft), judgeResult: vi.fn(async () => read(dragon)) };
  return { events, records, providers, emit: (e: ForgeRunEvent) => events.push(e), record: async (r: ForgeRunRecord) => { records.push(r); } };
}
/** Every mocked stage debits the shared ledger exactly as the real providers do. */
function charged(s: ReturnType<typeof setup>, wordCalls = 1) {
  const inner = s.providers;
  s.providers = {
    judgeWords: vi.fn(async input => { for (let i = 0; i < wordCalls; i++) await input.budget!.take(); return inner.judgeWords(input); }),
    draft: vi.fn(async (input: ForgeDraftInput) => { await input.budget!.take(); return inner.draft(input); }),
    ...(inner.draftCandidate ? { draftCandidate: vi.fn(async (input: ForgeDraftInput) => { await input.budget!.take(); return inner.draftCandidate!(input); }) } : {}),
    judgeResult: vi.fn(async (input: ForgeResultInput) => { await input.budget!.take(); return inner.judgeResult(input); }),
  };
  return s;
}

describe('Forge run: delivered', () => {
  it('delivers a certified known motif when both word readings agree, with the audit saved before approval', async () => {
    const s = charged(setup());
    const selection = await runForge(request, s.providers, e => { if (e.type === 'approved') expect(s.records.at(-1)?.outcome).toBe('approved'); s.emit(e); }, s.record, undefined, { safetyIdentifier: 'trusted-citizen-opaque-hash-0001' });
    expect(selection).toEqual({ verdict: 1, attempt: 1, delivery: 'delivered', shared: 'subject' });
    expect(stages(s.events)).toEqual(['judging-words', 'drafting', 'assembling', 'judging-piece', 'approved']);
    expect(s.providers.judgeResult).toHaveBeenCalledWith(expect.objectContaining({ contactSheet: expect.stringMatching(/^data:image\/png;base64,/) }));
    const stored = s.records[0]!.verdicts[1]!;
    expect(stored).toMatchObject({ subject: dragon, detailMatch: 'met',
      measure: { words: dragon, result: dragon, plan: { motif: 'sleeping-dragon', kind: 'chimney' }, certificate: 'reads', slotAvailable: true },
      quality: { recognisability: 1, completeness: 1, cleanMarks: 1, score: 1 } });
    expect(s.records[0]).toMatchObject({ outcome: 'approved', modelCalls: 3, attempts: 1, verdicts: [words, scored(read(dragon), draft)] });
    expect(JSON.stringify(s.records)).not.toContain(request.words);
    expect(JSON.stringify(s.records)).not.toContain(JSON.stringify(home));
    expect(JSON.stringify(s.events)).not.toContain(request.words);
  });
});

describe('Forge run: quietly retried', () => {
  it.each([
    ['another motif', dragon, owlDraft, draft],
    ['another available slot', { motif: 'sleeping-dragon', slot: 'weathervane' } as const, draft, { ...draft, plan: plan('sleeping-dragon', 'native', 'weathervane') }],
  ] as const)('redrafts unjudged when the drafter picked %s than the word gate read', async (_case, subject, first, retry) => {
    const s = charged(setup(read(subject)));
    vi.mocked(s.providers.judgeResult).mockImplementation(async input => { await input.budget!.take(); return read(subject); });
    const inner = vi.fn<(input: ForgeDraftInput) => Promise<ForgeDraft>>().mockResolvedValueOnce(first).mockResolvedValueOnce(retry);
    s.providers.draft = vi.fn(async (input: ForgeDraftInput) => { await input.budget!.take(); return inner(input); });
    const selection = await runForge(request, s.providers, s.emit, s.record);
    expect(s.providers.draft).toHaveBeenCalledTimes(2);
    expect(s.providers.judgeResult).toHaveBeenCalledTimes(1);
    expect(s.providers.judgeResult).toHaveBeenCalledWith(expect.objectContaining({ draft: retry }));
    expect(inner.mock.calls[0]![0].feedback).toBeUndefined();
    expect(inner.mock.calls[1]![0].feedback).toContain(subject.motif);
    if (subject.slot === 'weathervane') expect(inner.mock.calls[1]![0].feedback).toContain('kind weathervane');
    expect(selection).toEqual({ verdict: 1, attempt: 2, delivery: 'retried', shared: 'subject' });
    expect(stages(s.events)).toEqual(['judging-words', 'drafting', 'drafting', 'assembling', 'judging-piece', 'approved']);
    expect(s.records[0]).toMatchObject({ outcome: 'approved', attempts: 2, modelCalls: 4, draft: retry, verdicts: [read(subject), scored(read(subject), retry, subject)] });
    expect(JSON.stringify(s.events)).not.toContain(JSON.stringify(first.plan));
  });

  it('does not redraft early when the word gate names no kit subject', async () => {
    for (const subject of [unsupported, { motif: 'unclear', slot: 'unclear' } as const]) {
      const s = setup(read(subject)); vi.mocked(s.providers.draft).mockResolvedValue(owlDraft);
      vi.mocked(s.providers.judgeResult).mockResolvedValue(read(subject));
      await runForge(request, s.providers, s.emit, s.record);
      // The first draft is judged as drafted; any later redraft follows that result read.
      expect(vi.mocked(s.providers.judgeResult).mock.calls[0]![0].draft).toEqual(owlDraft);
      expect(vi.mocked(s.providers.draft).mock.calls[0]![0].feedback).toBeUndefined();
    }
  });

  it('retries after the result read when the two word readings disagree, and selects the agreed exact retry', async () => {
    const s = charged(setup()); const disputed = read({ motif: 'none', slot: 'chimney' });
    const inner = vi.fn<(input: ForgeDraftInput) => Promise<ForgeDraft>>().mockResolvedValueOnce(draft).mockResolvedValueOnce(second);
    s.providers.draft = vi.fn(async (input: ForgeDraftInput) => { await input.budget!.take(); return inner(input); });
    vi.mocked(s.providers.judgeResult).mockReset()
      .mockImplementationOnce(async input => { await input.budget!.take(); return disputed; })
      .mockImplementationOnce(async input => { await input.budget!.take(); return read(dragon); });
    const selection = await runForge(request, s.providers, s.emit, s.record);
    expect(selection).toEqual({ verdict: 2, attempt: 2, delivery: 'retried', shared: 'subject' });
    expect(inner.mock.calls[1]![0].feedback).toContain('sleeping-dragon');
    const [, first, retry] = s.records[0]!.verdicts;
    expect(first).toMatchObject({ detailMatch: 'unclear', quality: { recognisability: 0.7, score: 0.82 } });
    expect(retry).toMatchObject({ detailMatch: 'met', quality: { score: 1 } });
    expect(s.records[0]).toMatchObject({ outcome: 'approved', modelCalls: 5, verdicts: [words, scored(disputed, draft), scored(read(dragon), second)] });
    expect(s.events.at(-1)).toMatchObject({ type: 'approved', draft: second });
    expect(JSON.stringify(s.events)).not.toContain(draft.title);
  });

  it('retries an unread finish toward a certified readable finish', async () => {
    const copperOwl = { ...owlDraft, plan: plan('watchful-owl', 'copper') };
    const s = setup(read(owl)); vi.mocked(s.providers.judgeResult).mockResolvedValue(read(owl));
    vi.mocked(s.providers.draft).mockResolvedValueOnce(copperOwl).mockResolvedValueOnce(owlDraft);
    const selection = await runForge(request, s.providers, s.emit, s.record);
    expect(selection).toEqual({ verdict: 2, attempt: 2, delivery: 'retried', shared: 'subject' });
    const retryInput = vi.mocked(s.providers.draft).mock.calls[1]![0];
    expect(retryInput.readableFinishes?.['watchful-owl']).toEqual(['native']);
    expect(retryInput.feedback).toContain('readable finishes');
    expect(s.records[0]!.verdicts[1]).toMatchObject({ detailMatch: 'adapted', measure: { certificate: 'unread' }, quality: { recognisability: 0.6 } });
    expect(s.records[0]!.verdicts[2]).toMatchObject({ detailMatch: 'met', measure: { certificate: 'reads' } });
  });
});

describe('Forge run: softened', () => {
  it.each([
    ['closest', 'family', unsupported, 'family'],
    ['as-wished', 'subject', { motif: 'none', slot: 'chimney' }, 'slot'],
    ['as-wished', 'subject', unsupported, 'mood'],
  ] as const)('softens an unsupported subject as vocabulary with no retry call (drafter %s/%s)', async (interpretation, claimed, subject, shared) => {
    const s = setup(read(subject)); vi.mocked(s.providers.judgeResult).mockResolvedValue(read(subject));
    s.providers.draftCandidate = vi.fn(async () => ({ draft, interpretation, shared: claimed }));
    charged(s);
    const selection = await runForge(request, s.providers, s.emit, s.record);
    expect(selection).toEqual({ verdict: 1, attempt: 1, delivery: 'softened', reason: 'vocabulary', shared });
    expect(s.providers.draftCandidate).toHaveBeenCalledTimes(1);
    expect(s.providers.judgeResult).toHaveBeenCalledTimes(1);
    expect(s.records[0]).toMatchObject({ outcome: 'approved', modelCalls: 3 });
    expect(s.records[0]!.verdicts[1]).toMatchObject({ detailMatch: 'adapted', quality: { recognisability: 0.3 } });
    expect(s.events.some(e => e.type === 'stopped')).toBe(false);
  });

  it('softens a motif whose certificate is unread in this kingdom (the grove sleeping fox) as quality', async () => {
    const grove = createHome('house', 'grove', 0), fox = { motif: 'sleeping-fox', slot: 'chimney' } as const;
    const foxDraft: ForgeDraft = { plan: plan('sleeping-fox'), title: 'The curled sleeper', plaque: 'A fox dreams beside the chimney.' };
    const s = setup(read(fox)); vi.mocked(s.providers.draft).mockResolvedValue(foxDraft);
    vi.mocked(s.providers.judgeResult).mockResolvedValue(read(fox));
    const selection = await runForge({ ...request, family: 'grove', home: grove }, s.providers, s.emit, s.record);
    // No grove fox finish reads in the blind certificate, so another draft cannot do better.
    expect(s.providers.draft).toHaveBeenCalledTimes(1);
    expect(s.providers.judgeResult).toHaveBeenCalledTimes(1);
    expect(selection).toEqual({ verdict: 1, attempt: 1, delivery: 'softened', reason: 'quality', shared: 'subject' });
    expect(s.records[0]).toMatchObject({ outcome: 'approved', verdicts: [read(fox), scored(read(fox), foxDraft, fox, 'grove')] });
    expect(s.records[0]!.verdicts[1]).toMatchObject({ detailMatch: 'adapted', measure: { certificate: 'unread' } });
    expect(s.events.some(e => e.type === 'stopped')).toBe(false);
  });

  it.each([
    ['the better retry', read({ motif: 'none', slot: 'chimney' }), 2],
    ['the better first candidate', read(owl), 1],
  ] as const)('softens two safe shortfalls within five calls, selecting %s', async (_case, retryRead, attempt) => {
    const copperOwl = { ...owlDraft, plan: plan('watchful-owl', 'copper') };
    const s = setup(read(owl));
    vi.mocked(s.providers.draft).mockResolvedValueOnce(attempt === 2 ? copperOwl : owlDraft).mockResolvedValueOnce(attempt === 2 ? owlDraft : copperOwl);
    vi.mocked(s.providers.judgeResult).mockResolvedValueOnce(attempt === 2 ? read(owl) : read({ motif: 'none', slot: 'chimney' })).mockResolvedValueOnce(retryRead);
    charged(s);
    const selection = await runForge(request, s.providers, s.emit, s.record);
    expect(s.providers.judgeResult).toHaveBeenCalledTimes(2);
    expect(selection).toMatchObject({ verdict: attempt, attempt, delivery: 'softened', reason: 'quality' });
    expect(s.records[0]).toMatchObject({ outcome: 'approved', modelCalls: 5 });
    expect(s.events.at(-1)).toMatchObject({ type: 'approved', draft: owlDraft });
    expect(s.events.some(e => e.type === 'stopped')).toBe(false);
  });

  it('never stops a run for a quality shortfall, even when every read disagrees', async () => {
    const s = setup(read({ motif: 'unclear', slot: 'unclear' }));
    vi.mocked(s.providers.judgeResult).mockResolvedValue(read({ motif: 'shooting-star', slot: 'weathervane' }));
    vi.mocked(s.providers.draft).mockResolvedValueOnce(draft).mockResolvedValueOnce(second);
    const selection = await runForge(request, s.providers, s.emit, s.record);
    expect(selection).toMatchObject({ delivery: 'softened', reason: 'quality' });
    expect(s.records.map(record => record.outcome)).toEqual(['approved']);
    expect(s.events.some(e => e.type === 'stopped')).toBe(false);
    expect(s.events.at(-1)).toMatchObject({ type: 'approved' });
  });
});

describe('Forge run: refused, held and cold', () => {
  const lunaJson = (image: boolean, hate: number) => JSON.stringify({ subject: dragon,
    answers: forgeJudgeQuestions(image).map(({ name }) => ({ type: 'predicate', name, probability: name === 'hate' ? hate : 0.01 })) });
  const draftJson = JSON.stringify({ draft, interpretation: 'as-wished', shared: 'subject' });
  it.each([
    ['words', true, 'refuse'], ['words', false, 'hold'], ['result', true, 'refuse'], ['result', false, 'hold'],
  ] as const)('at the %s gate, refuses only when two independent reads agree on one floor concern (agree=%s)', async (gate, agree, outcome) => {
    const calls: string[] = [];
    const runCodex = vi.fn<CodexDraftRunner>(async ({ model, image }) => {
      calls.push(model ?? 'draft');
      if (!model) return draftJson;
      const concerning = gate === 'result' ? Boolean(image) : !image;
      if (model === 'gpt-6-luna') return lunaJson(Boolean(image), concerning ? 0.99 : 0.01);
      return JSON.stringify(agree ? { outcome: 'refuse', concerns: ['hate'], subject: dragon } : { outcome: 'pass', concerns: [], subject: dragon });
    });
    const s = setup();
    await runForge(request, createForgeProviders({ runCodex }), s.emit, s.record, undefined, { safetyIdentifier: 'trusted-citizen-opaque-hash-0001' });
    expect(s.events.at(-1)).toMatchObject({ type: 'stopped', outcome });
    expect(s.events.some(e => e.type === 'approved')).toBe(false);
    expect(s.records.at(-1)).toMatchObject({ outcome });
    expect(calls).toEqual(gate === 'words' ? ['gpt-6-luna', 'gpt-6.1-terra'] : ['gpt-6-luna', 'draft', 'gpt-6-luna', 'gpt-6.1-terra']);
  });

  it.each(['hold', 'refuse'] as const)('stops a provider safety %s at either gate', async outcome => {
    for (const gate of ['judgeWords', 'judgeResult'] as const) {
      const s = setup(); vi.mocked(s.providers[gate]).mockResolvedValue(read(dragon, outcome));
      await runForge(request, s.providers, s.emit, s.record);
      expect(s.events.at(-1)).toMatchObject({ type: 'stopped', outcome });
      expect(s.events.some(e => e.type === 'approved')).toBe(false);
      if (gate === 'judgeWords') expect(s.providers.draft).not.toHaveBeenCalled();
    }
  });

  it.each(['judgeWords', 'judgeResult'] as const)('goes cold when the provider is cold at %s, without exposing the error', async gate => {
    const s = setup(); vi.mocked(s.providers[gate]).mockRejectedValue(new ForgeProviderColdError([{ status: 'unavailable', detail: 'raw provider secret error' }]));
    await runForge(request, s.providers, s.emit, s.record);
    expect(s.events.at(-1)).toEqual({ type: 'stopped', outcome: 'cold', message: FORGE_WAIT_MESSAGES.service });
    expect(s.records.at(-1)).toMatchObject({ outcome: 'cold' });
    expect(JSON.stringify([s.events, s.records])).not.toContain('raw provider secret error');
    if (gate === 'judgeWords') expect(s.providers.draft).not.toHaveBeenCalled();
  });

  it('goes cold on any first service failure without exposing the error', async () => {
    const s = setup(); vi.mocked(s.providers.judgeWords).mockRejectedValue(new Error('raw provider secret error'));
    await runForge(request, s.providers, s.emit, s.record);
    expect(s.events.at(-1)).toMatchObject({ type: 'stopped', outcome: 'cold' });
    expect(JSON.stringify([s.events, s.records])).not.toContain('raw provider secret error');
    expect(s.providers.draft).not.toHaveBeenCalled();
  });

  it('goes cold for budget when the word gate leaves no room for a judged draft', async () => {
    const s = charged(setup(), 4);
    await runForge(request, s.providers, s.emit, s.record);
    expect(s.providers.draft).not.toHaveBeenCalled();
    expect(s.events.at(-1)).toEqual({ type: 'stopped', outcome: 'cold', message: FORGE_WAIT_MESSAGES.budget });
    expect(s.records.at(-1)).toMatchObject({ outcome: 'cold', modelCalls: 4 });
  });
});

describe('Forge run: evidence and budgets', () => {
  it('falls back to the first safe draft and its own evidence if retry fails', async () => {
    const s = setup(); const disputed = read({ motif: 'none', slot: 'chimney' });
    vi.mocked(s.providers.draft).mockResolvedValueOnce(draft).mockRejectedValueOnce(new Error('raw retry error'));
    vi.mocked(s.providers.judgeResult).mockResolvedValueOnce(disputed);
    const selection = await runForge(request, s.providers, s.emit, s.record);
    expect(selection).toMatchObject({ verdict: 1, attempt: 1, delivery: 'softened', reason: 'quality' });
    expect(s.records[0]).toMatchObject({ draft, verdicts: [words, scored(disputed, draft)], selection });
    expect(s.events.at(-1)).toMatchObject({ type: 'approved', draft });
    expect(JSON.stringify([s.events, s.records])).not.toContain('raw retry error');
  });

  it.each(['hold', 'refuse'] as const)('never releases a retry with safety %s, retaining the first safe evidence', async outcome => {
    const s = setup(); vi.mocked(s.providers.draft).mockResolvedValueOnce(draft).mockResolvedValueOnce(second);
    vi.mocked(s.providers.judgeResult).mockResolvedValueOnce(read({ motif: 'none', slot: 'chimney' })).mockResolvedValueOnce(read(dragon, outcome));
    const selection = await runForge(request, s.providers, s.emit, s.record);
    expect(selection).toMatchObject({ verdict: 1, attempt: 1, delivery: 'softened', reason: 'quality' });
    expect(s.records[0]?.verdicts[selection!.verdict]?.outcome).toBe('pass');
    expect(s.events.at(-1)).toMatchObject({ type: 'approved', draft });
    expect(s.events.some(e => e.type === 'stopped')).toBe(false);
    expect(JSON.stringify(s.events)).not.toContain(second.title);
  });

  it('does not approve or issue a second verdict when recording fails', async () => {
    const s = setup();
    await expect(runForge(request, s.providers, s.emit, async () => { throw new Error('audit unavailable'); })).rejects.toThrow('audit unavailable');
    expect(s.events.some(e => e.type === 'approved' || e.type === 'stopped')).toBe(false);
  });

  it('does not release or record an aborted run', async () => {
    const s = setup(), controller = new AbortController();
    vi.mocked(s.providers.judgeWords).mockImplementation(async () => { controller.abort(); return words; });
    await expect(runForge(request, s.providers, s.emit, s.record, controller.signal)).rejects.toBeDefined();
    expect(s.events.some(e => e.type === 'approved' || e.type === 'stopped')).toBe(false);
    expect(s.records).toHaveLength(0);
  });

  it('does not spend the closest candidate budget judging an exact retry', async () => {
    const s = setup(read({ motif: 'unclear', slot: 'unclear' }));
    s.providers.judgeWords = vi.fn(async ({ budget }) => { budget!.take(); budget!.take(); return read({ motif: 'unclear', slot: 'unclear' }); });
    s.providers.draftCandidate = vi.fn()
      .mockImplementationOnce(async ({ budget }: ForgeDraftInput) => { budget!.take(); return { draft, interpretation: 'closest', shared: 'family' }; })
      .mockImplementationOnce(async ({ budget }: ForgeDraftInput) => { budget!.take(); return { draft: second, interpretation: 'as-wished', shared: 'subject' }; });
    s.providers.judgeResult = vi.fn(async ({ budget }) => { budget!.take(); budget!.take(); return read(dragon); });
    const selection = await runForge(request, s.providers, s.emit, s.record);
    // The disputed first piece earns a quality retry, but its exact retry may not use the closest piece's extra calls.
    expect(s.providers.draftCandidate).toHaveBeenCalledTimes(2);
    expect(s.providers.judgeResult).toHaveBeenCalledTimes(1);
    expect(selection).toMatchObject({ verdict: 1, attempt: 1, delivery: 'softened', reason: 'quality', shared: 'family' });
    expect(s.records[0]).toMatchObject({ modelCalls: 6, draft, selection });
    expect(s.events.at(-1)).toMatchObject({ type: 'approved', draft });
    expect(JSON.stringify(s.events)).not.toContain(second.title);
  });

  it('keeps normal wishes within five calls and softened wishes within seven', async () => {
    for (const closest of [false, true]) {
      const subject = closest ? unsupported : dragon;
      const s = setup(read(subject));
      s.providers.judgeWords = vi.fn(async ({ budget }) => { budget!.take(); budget!.take(); return read(subject); });
      s.providers.draftCandidate = vi.fn(async ({ budget }) => { budget!.take(); return { draft, interpretation: closest ? 'closest' as const : 'as-wished' as const, shared: closest ? 'mood' as const : 'subject' as const }; });
      // The result read tries to spend up to the softened ceiling; only a closest piece may.
      s.providers.judgeResult = vi.fn(async ({ budget }) => { for (let i = 0; i < 4; i++) budget!.take(); return read(subject); });
      const selection = await runForge(request, s.providers, s.emit, s.record);
      if (closest) {
        expect(selection).toMatchObject({ delivery: 'softened', reason: 'vocabulary' });
        expect(s.records[0]).toMatchObject({ outcome: 'approved', modelCalls: 7 });
      } else {
        expect(selection).toBeUndefined();
        expect(s.records[0]).toMatchObject({ outcome: 'cold', modelCalls: 5 });
        expect(s.events.at(-1)).toEqual({ type: 'stopped', outcome: 'cold', message: FORGE_WAIT_MESSAGES.budget });
      }
    }
    for (const closest of [false, true]) {
      const subject = closest ? unsupported : dragon;
      const s = setup(read(subject));
      s.providers.judgeWords = vi.fn(async ({ budget }) => { budget!.take(); budget!.take(); return read(subject); });
      s.providers.draftCandidate = vi.fn(async ({ budget }) => { budget!.take(); return { draft, interpretation: closest ? 'closest' as const : 'as-wished' as const, shared: closest ? 'mood' as const : 'subject' as const }; });
      s.providers.judgeResult = vi.fn(async ({ budget }) => { budget!.take(); budget!.take(); return read(subject); });
      const selection = await runForge(request, s.providers, s.emit, s.record);
      expect(selection?.delivery).toBe(closest ? 'softened' : 'delivered');
      expect(s.records[0]?.modelCalls).toBe(5);
    }
    const s = setup();
    s.providers.judgeWords = vi.fn(async ({ budget }) => { budget!.take(); budget!.take(); return words; });
    s.providers.draft = vi.fn(async ({ budget }) => { budget!.take(); return draft; });
    s.providers.judgeResult = vi.fn()
      .mockImplementationOnce(async ({ budget }: ForgeResultInput) => { budget!.take(); budget!.take(); return read({ motif: 'none', slot: 'chimney' }); })
      .mockImplementationOnce(async ({ budget }: ForgeResultInput) => { budget!.take(); budget!.take(); return read(dragon); });
    await runForge(request, s.providers, s.emit, s.record);
    expect(s.records[0]?.modelCalls).toBe(5);
    expect(s.providers.draft).toHaveBeenCalledTimes(1);
    expect(s.providers.judgeResult).toHaveBeenCalledTimes(1);
    expect(s.records[0]?.selection).toMatchObject({ attempt: 1, delivery: 'softened', reason: 'quality' });
    expect(s.records[0]?.outcome).toBe('approved');
  });
});
