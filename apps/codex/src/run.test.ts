import { describe, it, expect, vi } from 'vitest';
import { createHome } from '@chatdom/content';
import type { ForgeDraft, ForgeRunEvent } from '@chatdom/shared';
import { runForge, type ForgeRunRecord } from './run';
import type { ForgeProviders, ForgeDraftInput, ForgeResultInput, JudgeVerdict } from './providers';

const home = createHome('house', 'hearth', 0);
const request = { words: 'A chimney for a little dragon who fell asleep guarding my home', family: 'hearth', home };
const draft: ForgeDraft = { plan: { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' }, title: 'The sleepy keeper', plaque: 'A quiet watch over a warm hearth.' };
const second: ForgeDraft = { ...draft, title: 'The hearth keeper', plan: { ...draft.plan, finish: 'copper' } };
const words: JudgeVerdict = { outcome: 'pass', reason: 'passed', records: [] };
const result = (score: number): JudgeVerdict => ({ ...words, quality: { policy: 'test', score, recognisability: score, completeness: score, cleanMarks: score } });
function setup() {
 const events: ForgeRunEvent[] = [], records: ForgeRunRecord[] = [];
 const providers: ForgeProviders = { judgeWords: vi.fn(async () => words), draft: vi.fn(async () => draft), judgeResult: vi.fn(async () => result(0.9)) };
 return { events, records, providers, emit: (e: ForgeRunEvent) => events.push(e), record: async (r: ForgeRunRecord) => { records.push(r); } };
}

describe('Forge run', () => {
 it('delivers a real assembled sheet, with the audit saved before approval', async () => {
  const s = setup();
  const selection = await runForge(request, s.providers, e => { if (e.type === 'approved') expect(s.records.at(-1)?.outcome).toBe('approved'); s.emit(e); }, s.record, undefined, { safetyIdentifier: 'trusted-citizen-opaque-hash-0001' });
  expect(selection).toMatchObject({ delivery: 'delivered', attempt: 1, verdict: 1 });
  expect(s.events.map(e => e.type === 'stage' ? e.stage : e.type)).toEqual(['judging-words', 'drafting', 'assembling', 'judging-piece', 'approved']);
  expect(s.providers.judgeResult).toHaveBeenCalledWith(expect.objectContaining({ contactSheet: expect.stringMatching(/^data:image\/png;base64,/) }));
  expect(JSON.stringify(s.records)).not.toContain(request.words);
  expect(JSON.stringify(s.records)).not.toContain(JSON.stringify(home));
  expect(JSON.stringify(s.events)).not.toContain(request.words);
 });
 it.each([[0.3, 0.9, 2], [0.6, 0.4, 1]])('quietly retries and selects the best checked candidate (%s, %s)', async (first, next, attempt) => {
  const s = setup(); vi.mocked(s.providers.draft).mockResolvedValueOnce(draft).mockResolvedValueOnce(second);
  vi.mocked(s.providers.judgeResult).mockResolvedValueOnce(result(first)).mockResolvedValueOnce(result(next));
  const selected = await runForge(request, s.providers, s.emit, s.record);
  expect(selected).toMatchObject({ attempt, verdict: attempt, delivery: attempt === 2 ? 'retried' : 'softened' });
  expect(s.records[0]?.verdicts).toEqual([words, result(first), result(next)]);
  const approved = s.events.find(e => e.type === 'approved');
  expect(approved).toMatchObject({ draft: attempt === 1 ? draft : second });
  expect(JSON.stringify(s.events)).not.toContain(attempt === 1 ? second.title : draft.title);
  expect(s.events.some(e => e.type === 'stopped')).toBe(false);
 });
 it('softens an explicitly closest candidate', async () => {
  const s = setup(); s.providers.draftCandidate = vi.fn(async () => ({ draft, interpretation: 'closest' as const, shared: 'family' as const }));
  expect(await runForge(request, s.providers, s.emit, s.record)).toMatchObject({ delivery: 'softened', reason: 'vocabulary', shared: 'family' });
 });
 it.each(['hold', 'refuse'] as const)('stops a safety %s at either gate', async outcome => {
  for (const gate of ['judgeWords', 'judgeResult'] as const) {
   const s = setup(); vi.mocked(s.providers[gate]).mockResolvedValue({ ...words, outcome, reason: 'private safety reason' });
   await runForge(request, s.providers, s.emit, s.record);
   expect(s.events.at(-1)).toMatchObject({ type: 'stopped', outcome });
   expect(s.events.some(e => e.type === 'approved')).toBe(false);
   if (gate === 'judgeWords') expect(s.providers.draft).not.toHaveBeenCalled();
  }
 });
 it('goes cold on first service failure without exposing the error', async () => {
  const s = setup(); vi.mocked(s.providers.judgeWords).mockRejectedValue(new Error('raw provider secret error'));
  await runForge(request, s.providers, s.emit, s.record);
  expect(s.events.at(-1)).toMatchObject({ type: 'stopped', outcome: 'cold' });
  expect(JSON.stringify([s.events, s.records])).not.toContain('raw provider secret error');
  expect(s.providers.draft).not.toHaveBeenCalled();
 });
 it('falls back to the first safe draft and its own evidence if retry fails', async () => {
  const s = setup(); vi.mocked(s.providers.draft).mockResolvedValueOnce(draft).mockRejectedValueOnce(new Error('raw retry error'));
  vi.mocked(s.providers.judgeResult).mockResolvedValueOnce(result(0.3));
  const selection = await runForge(request, s.providers, s.emit, s.record);
  expect(selection).toMatchObject({ verdict: 1, attempt: 1, delivery: 'softened', reason: 'quality' });
  expect(s.records[0]).toMatchObject({ draft, verdicts: [words, result(0.3)], selection });
  expect(s.events.at(-1)).toMatchObject({ type: 'approved', draft });
  expect(JSON.stringify([s.events, s.records])).not.toContain('raw retry error');
 });
 it.each(['hold', 'refuse'] as const)('never releases a retry with safety %s, retaining the first safe evidence', async outcome => {
  const s = setup(); vi.mocked(s.providers.draft).mockResolvedValueOnce(draft).mockResolvedValueOnce(second);
  vi.mocked(s.providers.judgeResult).mockResolvedValueOnce(result(0.3)).mockResolvedValueOnce({ ...words, outcome });
  const selection = await runForge(request, s.providers, s.emit, s.record);
  expect(selection).toMatchObject({ verdict: 1, attempt: 1 });
  expect(s.records[0]?.verdicts[selection!.verdict]?.outcome).toBe('pass');
  expect(s.events.at(-1)).toMatchObject({ type: 'approved', draft });
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
  const s = setup();
  s.providers.judgeWords = vi.fn(async ({ budget }) => { budget!.take(); budget!.take(); return words; });
  s.providers.draftCandidate = vi.fn()
   .mockImplementationOnce(async ({ budget }: ForgeDraftInput) => { budget!.take(); return { draft, interpretation: 'closest', shared: 'family' }; })
   .mockImplementationOnce(async ({ budget }: ForgeDraftInput) => { budget!.take(); return { draft: second, interpretation: 'as-wished', shared: 'subject' }; });
  s.providers.judgeResult = vi.fn(async ({ budget }) => { budget!.take(); budget!.take(); return result(0.2); });
  const selection = await runForge(request, s.providers, s.emit, s.record);
  expect(s.providers.draftCandidate).toHaveBeenCalledTimes(2);
  expect(s.providers.judgeResult).toHaveBeenCalledTimes(1);
  expect(selection).toMatchObject({ verdict: 1, attempt: 1, delivery: 'softened', reason: 'vocabulary', shared: 'family' });
  expect(s.records[0]).toMatchObject({ modelCalls: 6, draft, verdicts: [words, result(0.2)], selection });
  expect(s.events.at(-1)).toMatchObject({ type: 'approved', draft });
  expect(JSON.stringify(s.events)).not.toContain(second.title);
 });
 it('enforces the shared normal and softened model call budgets', async () => {
  for (const closest of [false, true]) {
   const s = setup();
   s.providers.judgeWords = vi.fn(async ({ budget }) => { budget!.take(); budget!.take(); return words; });
   s.providers.draftCandidate = vi.fn(async ({ budget }) => { budget!.take(); return { draft, interpretation: closest ? 'closest' as const : 'as-wished' as const, shared: 'subject' as const }; });
   s.providers.judgeResult = vi.fn(async ({ budget }) => { budget!.take(); budget!.take(); return result(0.9); });
   const selection = await runForge(request, s.providers, s.emit, s.record);
   expect(selection?.delivery).toBe(closest ? 'softened' : 'delivered');
   expect(s.records[0]?.modelCalls).toBe(5);
  }
  const s = setup();
  s.providers.judgeWords = vi.fn(async ({ budget }) => { budget!.take(); budget!.take(); return words; });
  s.providers.draft = vi.fn(async ({ budget }) => { budget!.take(); return draft; });
  s.providers.judgeResult = vi.fn()
   .mockImplementationOnce(async ({ budget }: ForgeResultInput) => { budget!.take(); budget!.take(); return result(0.2); })
   .mockImplementationOnce(async ({ budget }: ForgeResultInput) => { budget!.take(); budget!.take(); return result(0.95); });
  await runForge(request, s.providers, s.emit, s.record);
  expect(s.records[0]?.modelCalls).toBe(5);
  expect(s.providers.draft).toHaveBeenCalledTimes(1);
  expect(s.providers.judgeResult).toHaveBeenCalledTimes(1);
  expect(s.records[0]?.selection).toMatchObject({ attempt: 1, delivery: 'softened', reason: 'quality' });
  expect(s.records[0]?.outcome).toBe('approved');
 });
});
