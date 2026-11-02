import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHome } from '@chatdom/content';
import { forgeStyleKit } from '@chatdom/forge';
import { KingdomIdSchema, PersonIdSchema, type ForgeRunEvent } from '@chatdom/shared';
import { createForgeProviders } from '../providers';
import { forgeJudgeQuestions } from '../providers/policy';
import { runForge, type ForgeRunRecord } from '../run';
import { FileForgeWishQueue } from '../wish-queue';
import { createQueuedForgeRunRecovery } from './index';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const words = 'A sleeping dragon on my chimney, private words';
const request = { words, family: 'hearth' as const, home: createHome('house', 'hearth', 0) };
const safetyIdentifier = 'stable-hashed-citizen-identifier';
const styleKit = forgeStyleKit('hearth');

it.each([
  { stage: 'words', phase: 'drafting', calls: ['words'] },
  { stage: 'drafting', phase: 'assembling', calls: ['words', 'draft'] },
  { stage: 'result', phase: 'selecting', calls: ['words', 'draft', 'result'] },
] as const)('reopens the exact run after completed $stage without repeating its model calls', async ({ stage, phase, calls }) => {
  const directory = await mkdtemp(join(tmpdir(), 'forge-run-restart-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  let queue = await FileForgeWishQueue.open({ directory, origin: 'simulated' });
  cleanups.push(() => queue.close());
  await queue.enqueue({ kingdomId: KingdomIdSchema.parse('123'), personId: PersonIdSchema.parse('456'),
    messageId: 'restart-message', slot: 19, observedAt: Date.now(), words });
  const claim = await queue.claimNext(); expect(claim).not.toBeNull(); if (!claim) throw new Error('Expected claim');
  const madeCalls: string[] = [];
  const providers = createForgeProviders({ runCodex: async ({ model, image }) => {
    if (!model) { madeCalls.push('draft'); return JSON.stringify({ draft: { plan: { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' },
      title: 'Sleeping keeper', plaque: 'Warm dreams above the hearth.' }, interpretation: 'as-wished', shared: 'subject' }); }
    madeCalls.push(image ? 'result' : 'words');
    return JSON.stringify({ answers: forgeJudgeQuestions(Boolean(image)).map(({ name }) => ({ type: 'predicate', name, probability: 0.01 })),
      ...(image ? { quality: { recognisability: 0.95, completeness: 1, cleanMarks: 1 }, detailMatch: 'met' } : {}) });
  } });
  const stop = new AbortController(), original = queue.checkpoint.bind(queue);
  let savedRunId: string | undefined, reached = false;
  vi.spyOn(queue, 'checkpoint').mockImplementation(async (owned, checkpoint) => {
    const result = await original(owned, checkpoint);
    const envelope = checkpoint.data as { state?: { id?: string; phase?: string } };
    if (!reached && checkpoint.stage === stage && envelope.state?.phase === phase) {
      reached = true; savedRunId = envelope.state.id; stop.abort();
    }
    return result;
  });
  await expect(runForge(request, providers, () => {}, async () => {}, stop.signal,
    { safetyIdentifier, styleKit, recovery: createQueuedForgeRunRecovery(queue, claim) })).rejects.toBeDefined();
  expect(reached).toBe(true);
  expect(savedRunId).toMatch(/^forge-/);
  expect(madeCalls).toEqual(calls);
  await queue.close();
  queue = await FileForgeWishQueue.open({ directory, origin: 'simulated' });
  const restored = await queue.claimNext(); expect(restored).not.toBeNull(); if (!restored) throw new Error('Expected restored claim');
  expect(restored.attempt).toEqual(claim.attempt);
  expect(restored.receipt.modelCalls).toBe(calls.length);
  const events: ForgeRunEvent[] = [], records: ForgeRunRecord[] = [];
  await runForge(request, providers, event => { events.push(event); }, async value => { records.push(value); }, restored.signal,
    { safetyIdentifier, styleKit, recovery: createQueuedForgeRunRecovery(queue, restored) });
  expect(madeCalls).toEqual(['words', 'draft', 'result']);
  expect(events.filter(event => event.type === 'approved')).toMatchObject([{ runId: savedRunId }]);
  expect(records.at(-1)).toMatchObject({ id: savedRunId, outcome: 'approved', modelCalls: 3 });
  expect((await queue.get(restored.attempt.key))?.modelCalls).toBe(3);
  expect(JSON.stringify(events)).not.toContain(words);
  expect(JSON.stringify(records)).not.toContain(words);
});

it('does not reuse a stored word verdict for a different authoritative home', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'forge-run-binding-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  let queue = await FileForgeWishQueue.open({ directory, origin: 'simulated' });
  cleanups.push(() => queue.close());
  await queue.enqueue({ kingdomId: KingdomIdSchema.parse('123'), personId: PersonIdSchema.parse('456'),
    messageId: 'binding-message', slot: 19, observedAt: Date.now(), words });
  const claim = await queue.claimNext(); if (!claim) throw new Error('Expected claim');
  let invocations = 0;
  const providers = createForgeProviders({ runCodex: async () => {
    invocations++;
    return JSON.stringify({ answers: forgeJudgeQuestions(false).map(({ name }) => ({ type: 'predicate', name, probability: 0.01 })) });
  } });
  const stop = new AbortController(), original = queue.checkpoint.bind(queue);
  let reached = false;
  vi.spyOn(queue, 'checkpoint').mockImplementation(async (owned, checkpoint) => {
    const result = await original(owned, checkpoint);
    const data = checkpoint.data as { state?: { phase?: string } };
    if (!reached && checkpoint.stage === 'words' && data.state?.phase === 'drafting') { reached = true; stop.abort(); }
    return result;
  });
  await expect(runForge(request, providers, () => {}, async () => {}, stop.signal,
    { safetyIdentifier, styleKit, recovery: createQueuedForgeRunRecovery(queue, claim) })).rejects.toBeDefined();
  expect(reached).toBe(true);
  expect(invocations).toBe(1);
  await queue.close();
  queue = await FileForgeWishQueue.open({ directory, origin: 'simulated' });
  const restored = await queue.claimNext(); if (!restored) throw new Error('Expected restored claim');
  await expect(runForge({ ...request, home: { ...request.home, id: 'different-home' } }, providers,
    () => {}, async () => {}, restored.signal,
    { safetyIdentifier, styleKit, recovery: createQueuedForgeRunRecovery(queue, restored) })).rejects.toMatchObject({ code: 'binding' });
  expect(invocations).toBe(1);
});

it('retains the debit for an interrupted unanswered call and only retries within the remaining budget', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'forge-run-spent-call-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  let queue = await FileForgeWishQueue.open({ directory, origin: 'simulated' });
  cleanups.push(() => queue.close());
  await queue.enqueue({ kingdomId: KingdomIdSchema.parse('123'), personId: PersonIdSchema.parse('456'),
    messageId: 'spent-call-message', slot: 19, observedAt: Date.now(), words });
  const claim = await queue.claimNext(); if (!claim) throw new Error('Expected claim');
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let interruptFirst = true;
  const madeCalls: string[] = [];
  const providers = createForgeProviders({ runCodex: async ({ model, image, signal }) => {
    if (!model) { madeCalls.push('draft'); return JSON.stringify({ draft: { plan: { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' },
      title: 'Sleeping keeper', plaque: 'Warm dreams above the hearth.' }, interpretation: 'as-wished', shared: 'subject' }); }
    madeCalls.push(image ? 'result' : 'words');
    if (interruptFirst) {
      interruptFirst = false; entered();
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('interrupted')), { once: true }));
    }
    return JSON.stringify({ answers: forgeJudgeQuestions(Boolean(image)).map(({ name }) => ({ type: 'predicate', name, probability: 0.01 })),
      ...(image ? { quality: { recognisability: 0.95, completeness: 1, cleanMarks: 1 }, detailMatch: 'met' } : {}) });
  } });
  const stop = new AbortController();
  const running = runForge(request, providers, () => {}, async () => {}, stop.signal,
    { safetyIdentifier, styleKit, recovery: createQueuedForgeRunRecovery(queue, claim) });
  await started; stop.abort();
  await expect(running).rejects.toBeDefined();
  expect((await queue.get(claim.attempt.key))?.modelCalls).toBe(1);
  await queue.close();
  queue = await FileForgeWishQueue.open({ directory, origin: 'simulated' });
  const restored = await queue.claimNext(); if (!restored) throw new Error('Expected restored claim');
  expect(restored.receipt.modelCalls).toBe(1);
  const records: ForgeRunRecord[] = [];
  await runForge(request, providers, () => {}, async value => { records.push(value); }, restored.signal,
    { safetyIdentifier, styleKit, recovery: createQueuedForgeRunRecovery(queue, restored) });
  expect(madeCalls).toEqual(['words', 'words', 'draft', 'result']);
  expect(records.at(-1)).toMatchObject({ outcome: 'approved', modelCalls: 4 });
  expect((await queue.get(restored.attempt.key))?.modelCalls).toBe(4);
});

it('charges an interrupted second judge read and repeats the incomplete gate only within the remaining five calls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'forge-run-escalated-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  let queue = await FileForgeWishQueue.open({ directory, origin: 'simulated' });
  cleanups.push(() => queue.close());
  await queue.enqueue({ kingdomId: KingdomIdSchema.parse('123'), personId: PersonIdSchema.parse('456'),
    messageId: 'escalated-message', slot: 19, observedAt: Date.now(), words });
  const first = await queue.claimNext(); if (!first) throw new Error('Expected claim');
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let primaryWords = 0;
  const calls: string[] = [];
  const providers = createForgeProviders({ runCodex: async ({ model, image, signal }) => {
    if (!model) { calls.push('draft'); return JSON.stringify({ draft: { plan: { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' },
      title: 'Sleeping keeper', plaque: 'Warm dreams above the hearth.' }, interpretation: 'as-wished', shared: 'subject' }); }
    if (model === 'gpt-6.1-terra') {
      calls.push('secondary'); entered();
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('interrupted')), { once: true }));
    }
    calls.push(image ? 'result' : 'words');
    const uncertain = !image && primaryWords++ === 0;
    return JSON.stringify({ answers: forgeJudgeQuestions(Boolean(image)).map(({ name }) => ({ type: 'predicate', name, probability: uncertain && name === 'hate' ? 0.4 : 0.01 })),
      ...(image ? { quality: { recognisability: 0.95, completeness: 1, cleanMarks: 1 }, detailMatch: 'met' } : {}) });
  } });
  const stop = new AbortController();
  const running = runForge(request, providers, () => {}, async () => {}, stop.signal,
    { safetyIdentifier, styleKit, recovery: createQueuedForgeRunRecovery(queue, first) });
  await started; stop.abort();
  await expect(running).rejects.toBeDefined();
  expect(calls).toEqual(['words', 'secondary']);
  expect((await queue.get(first.attempt.key))?.modelCalls).toBe(2);
  await queue.close();
  queue = await FileForgeWishQueue.open({ directory, origin: 'simulated' });
  const restored = await queue.claimNext(); if (!restored) throw new Error('Expected restored claim');
  const records: ForgeRunRecord[] = [];
  await runForge(request, providers, () => {}, async value => { records.push(value); }, restored.signal,
    { safetyIdentifier, styleKit, recovery: createQueuedForgeRunRecovery(queue, restored) });
  expect(calls).toEqual(['words', 'secondary', 'words', 'draft', 'result']);
  expect(records.at(-1)).toMatchObject({ outcome: 'approved', modelCalls: 5 });
  expect((await queue.get(restored.attempt.key))?.modelCalls).toBe(5);
});

it('selects the earlier checked candidate when an interrupted second result has spent the last call', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'forge-run-final-call-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  let queue = await FileForgeWishQueue.open({ directory, origin: 'simulated' });
  cleanups.push(() => queue.close());
  await queue.enqueue({ kingdomId: KingdomIdSchema.parse('123'), personId: PersonIdSchema.parse('456'),
    messageId: 'last-call-message', slot: 19, observedAt: Date.now(), words });
  const first = await queue.claimNext(); if (!first) throw new Error('Expected claim');
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let drafts = 0, results = 0;
  const calls: string[] = [];
  const providers = createForgeProviders({ runCodex: async ({ model, image, signal }) => {
    if (!model) { calls.push('draft'); drafts++; return JSON.stringify({ draft: { plan: { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' },
      title: drafts === 1 ? 'First keeper' : 'Second keeper', plaque: 'Warm dreams above the hearth.' }, interpretation: 'as-wished', shared: 'subject' }); }
    calls.push(image ? 'result' : 'words');
    if (image && ++results === 2) {
      entered();
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('interrupted')), { once: true }));
    }
    return JSON.stringify({ answers: forgeJudgeQuestions(Boolean(image)).map(({ name }) => ({ type: 'predicate', name, probability: 0.01 })),
      ...(image ? { quality: { recognisability: 0.3, completeness: 1, cleanMarks: 1 }, detailMatch: 'unclear' } : {}) });
  } });
  const stop = new AbortController();
  const running = runForge(request, providers, () => {}, async () => {}, stop.signal,
    { safetyIdentifier, styleKit, recovery: createQueuedForgeRunRecovery(queue, first) });
  await started; stop.abort();
  await expect(running).rejects.toBeDefined();
  expect(calls).toEqual(['words', 'draft', 'result', 'draft', 'result']);
  expect((await queue.get(first.attempt.key))?.modelCalls).toBe(5);
  await queue.close();
  queue = await FileForgeWishQueue.open({ directory, origin: 'simulated' });
  const restored = await queue.claimNext(); if (!restored) throw new Error('Expected restored claim');
  const records: ForgeRunRecord[] = [];
  await runForge(request, providers, () => {}, async value => { records.push(value); }, restored.signal,
    { safetyIdentifier, styleKit, recovery: createQueuedForgeRunRecovery(queue, restored) });
  expect(calls).toEqual(['words', 'draft', 'result', 'draft', 'result']);
  expect(records.at(-1)).toMatchObject({ outcome: 'approved', modelCalls: 5, draft: { title: 'First keeper' },
    selection: { delivery: 'softened', reason: 'quality' } });
});
