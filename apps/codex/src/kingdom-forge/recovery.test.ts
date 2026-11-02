import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHearthHome } from '@chatdom/content';
import { PersonIdSchema } from '@chatdom/shared';
import { WORLD_FIXTURE_KINGDOM as kingdomId, WORLD_FIXTURE_PERSON as personId } from '@chatdom/shared/world-fixtures';
import type { RealmFact, RealmOwnedForgeHost, RealmPrivateState, RealmStoredOutcome } from '@chatdom/shared/realm';
import { createRealmState } from '../../../../packages/world/src/realm/reducer';
import { REFERENCE_WORLD } from '../../../../packages/world/src/realm/reference';
import { createDurableRealmServices, digestOf, type DurableRepository, type RealmCommitGuard } from '../../../realm/src/persistence';
import type { RealmOutboxStore } from '../../../realm/src/outbox';
import { FileForgeApprovals } from '../../../realm/src/wiring/approvals';
import { createForgeAuthority, forgeHomeDigest } from '../../../realm/src/wiring/forge';
import { ForgeWriteGate } from '../../../realm/src/wiring/gate';
import { createForgeProviders } from '../providers';
import { forgeJudgeQuestions } from '../providers/policy';
import { FileForgeWishQueue } from '../wish-queue';
import { ForgeWishWorker } from '../wish-worker';
import { createQueuedKingdomForgeApplication } from './recovery';
import { forgeMessageKey } from '../../../realm/src/wiring/forge';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** Real authority, reducer, write guard and immutable approval reader over a controlled repository. */
async function fixture(makers = 1) {
  const directory = await mkdtemp(join(tmpdir(), 'forge-coordinator-recovery-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  let now = Date.now();
  const blueprint = createHearthHome('house', 0);
  const home: RealmOwnedForgeHost = { id: 'recovery-plot', ownerId: personId, layoutRevision: 'founded-test',
    revision: 'home-initial', digest: forgeHomeDigest(blueprint), family: 'hearth', blueprint,
    attribution: { makerName: 'Juniper', kingdomName: 'Emberwick', approvalId: 'approved-names' },
    attachments: {}, slot: 7, allocationReceipt: 'recovery-deed' };
  let state: RealmPrivateState = { ...createRealmState(kingdomId, 'simulated'), homes: { [home.id]: home },
    coals: { [personId]: 2 }, stream: { sessionId: 'night', startedAt: now - 10_000, liveUntil: now + 900_000 },
    rights: { [personId]: { revision: 1, forge: true, build: true, blocked: false, safetyIdentifier: 'stable-hashed-citizen-identifier' } } };
  const people = [personId];
  for (let i = 1; i < makers; i++) {
    const person = PersonIdSchema.parse(String(910100 + i)); people.push(person);
    const id = `recovery-plot-${i}`;
    state = { ...state, homes: { ...state.homes, [id]: { ...home, id, slot: 7 + i, ownerId: person,
      allocationReceipt: `recovery-deed-${i}`, attribution: { ...home.attribution, makerName: `Citizen ${i}` } } },
    coals: { ...state.coals, [person]: 2 }, rights: { ...state.rights, [person]: state.rights[personId]! } };
  }
  const gate = new ForgeWriteGate(), guards = gate.install({ origin: 'simulated' }).guards;
  const facts: RealmFact[] = [], receipts = new Map<string, RealmStoredOutcome>(), payloads = new Map<string, string>();
  const repository: DurableRepository = {
    leaseMs: 15_000, acquire: async () => ({ kingdomId, epoch: 'recovery-writer', expiresAt: Date.now() + 15_000 }),
    renew: async lease => ({ ...lease, expiresAt: Date.now() + 15_000 }), load: async () => state, committedState: () => state,
    execute: async (_lease, id, command, decide, current) => {
      if (!current()) throw new Error('fenced');
      const prior = receipts.get(id);
      if (prior && payloads.get(id) !== digestOf(command)) return { status: 'rejected', reason: 'conflict' };
      if (prior?.status === 'committed' || prior?.status === 'unchanged') return prior;
      const decision = decide(state, now);
      if (decision.kind !== 'accepted') {
        const result: RealmStoredOutcome = { status: decision.kind, reason: decision.reason };
        payloads.set(id, digestOf(command)); receipts.set(id, result); return result;
      }
      for (const guard of guards) await guard({} as Parameters<RealmCommitGuard>[0], decision.fact, state);
      state = decision.state; facts.push(decision.fact);
      const result: RealmStoredOutcome = { status: 'committed', sequence: state.sequence, at: now };
      payloads.set(id, digestOf(command)); receipts.set(id, result); return result;
    },
    lookup: async (_kingdom, id) => receipts.get(id) ?? null,
    snapshot: async () => state.sequence, release: async () => {}, loadIngress: async () => null,
    executeIngress: async () => ({ status: 'unchanged', reason: 'unused' }),
  };
  const outbox: RealmOutboxStore = { open: async () => 0, prefix: async () => ({ homes: [], presence: null, sequence: 0, committed: 0 }),
    read: async () => [], acknowledge: async () => {} };
  const services = createDurableRealmServices({ repository, outbox,
    auth: { authenticate: async () => { throw new Error('No entry'); }, current: async () => false },
    kingdom: () => ({ world: REFERENCE_WORLD, layoutRevision: home.layoutRevision, spawn: () => [0, 0, 6] }) });
  const retained = await services.retain(kingdomId); cleanups.push(() => retained.release());
  vi.spyOn(retained.kingdom, 'databaseNow').mockImplementation(() => now);
  const approvals = new FileForgeApprovals(join(directory, 'approvals'));
  let denyRetain = false;
  const actualAuthority = createForgeAuthority({ kingdomId, origin: 'simulated', retain: () => {
    if (denyRetain) { denyRetain = false; return Promise.resolve(null); }
    return services.retain(kingdomId);
  } }, { approvals, gate });
  let statusUnavailable = false, loseCommitReply = false, failCommit = false, failRelease = false, loseReleaseReply = false;
  const authority = { ...actualAuthority,
    status: vi.fn(async (...args: Parameters<typeof actualAuthority.status>) => {
      if (statusUnavailable) throw new Error('private dependency failure');
      return actualAuthority.status(...args);
    }),
    release: vi.fn(async (...args: Parameters<typeof actualAuthority.release>) => {
      if (failRelease) throw new Error('release unavailable');
      const result = await actualAuthority.release(...args);
      if (loseReleaseReply) { loseReleaseReply = false; throw new Error('lost release reply'); }
      return result;
    }),
    commit: vi.fn(async (...args: Parameters<typeof actualAuthority.commit>) => {
      if (failCommit) throw new Error('commit unavailable');
      const result = await actualAuthority.commit(...args);
      if (loseCommitReply && result.kind === 'committed') { loseCommitReply = false; statusUnavailable = true; throw new Error('lost commit reply'); }
      return result;
    }),
  };
  const stages: string[] = [];
  const runner = vi.fn(async ({ model, image }: { model?: string; image?: string }) => {
    if (!model) { stages.push('draft'); return JSON.stringify({ draft: { plan: { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' },
      title: 'Sleeping keeper', plaque: 'Warm dreams above the hearth.' }, interpretation: 'as-wished', shared: 'subject' }); }
    stages.push(image ? 'result' : 'words');
    // Every gate read is safety plus a reading of the words; the host computes quality from the readings.
    return JSON.stringify({ answers: forgeJudgeQuestions(Boolean(image)).map(({ name }) => ({ type: 'predicate', name, probability: 0.01 })),
      subject: { motif: 'sleeping-dragon', slot: 'chimney' } });
  });
  const providers = createForgeProviders({ runCodex: runner });
  const published: unknown[] = [];
  const spool = join(directory, 'queue');
  let queue = await FileForgeWishQueue.open({ directory: spool, origin: 'simulated' });
  cleanups.push(async () => queue.close());
  const command = { kingdomId, personId, messageId: 'recovery-message', slot: 19, observedAt: now,
    words: 'A small sleeping dragon chimney, private words' };
  const admitted = await queue.enqueue(command);
  const openAgain = async () => { await queue.close(); queue = await FileForgeWishQueue.open({ directory: spool, origin: 'simulated' }); return queue; };
  const claim = async () => { const value = await queue.claimNext(); expect(value).not.toBeNull(); if (!value) throw new Error('Expected claim'); return value; };
  const application = () => createQueuedKingdomForgeApplication({ queue, authority, providers,
    now: () => now, record: value => approvals.record(value), publish: event => { published.push(event); } });
  return { get queue() { return queue; }, command, admitted, claim, application, openAgain, authority, actualAuthority, people, approvals,
    denyNextRetain: () => { denyRetain = true; },
    facts, stages, runner, published, spool, state: () => state, loseCommitReply: () => { loseCommitReply = true; },
    recoverStatus: () => { statusUnavailable = false; }, advance: (milliseconds: number) => { now += milliseconds; },
    failCommit: (value: boolean) => { failCommit = value; }, failRelease: (value: boolean) => { failRelease = value; },
    loseReleaseReply: () => { loseReleaseReply = true; } };
}

it('recovers an unknown commit through the real authority without another model call, release or coal spend', async () => {
  const f = await fixture(), first = await f.claim();
  f.loseCommitReply();
  const uncertain = await f.application()(first);
  expect(uncertain).toMatchObject({ kind: 'recovery-needed', ...first.attempt });
  expect(f.stages).toEqual(['words', 'draft', 'result']);
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(1);
  expect(f.state().coals[personId]).toBe(1);
  expect(f.authority.release).not.toHaveBeenCalled();
  await f.openAgain();
  const pending = await f.claim();
  expect(pending.attempt).toEqual(first.attempt);
  expect(await f.application()(pending)).toMatchObject({ kind: 'recovery-needed', ...first.attempt });
  expect(f.authority.release).not.toHaveBeenCalled();
  expect(f.stages).toHaveLength(3);
  f.recoverStatus();
  const outcome = await f.application()(pending);
  expect(outcome).toMatchObject({ kind: 'committed' });
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(1);
  expect(f.state().coals[personId]).toBe(1);
  expect(f.stages).toHaveLength(3);
  expect(f.authority.release).not.toHaveBeenCalled();
  expect(f.published.filter(event => typeof event === 'object' && event !== null && 'type' in event && event.type === 'committed')).toHaveLength(0);
  expect(JSON.stringify(f.published)).not.toContain(f.command.words);
  const receipt = await f.queue.finish(pending, { kind: 'committed', runId: outcome.kind === 'committed' ? outcome.attachment.runId : 'invalid',
    committedAt: outcome.kind === 'committed' ? outcome.attachment.committedAt : 0 });
  expect(receipt.state).toBe('finished');
  for (const file of await readdir(f.spool)) expect(await readFile(join(f.spool, file), 'utf8')).not.toContain(f.command.words);
});

it.each([
  { stage: 'words', phase: 'drafting', calls: ['words'] },
  { stage: 'drafting', phase: 'assembling', calls: ['words', 'draft'] },
  { stage: 'result', phase: 'selecting', calls: ['words', 'draft', 'result'] },
] as const)('resumes a reserved wish after shutdown at $stage with its actual authority and approval', async ({ stage, phase, calls }) => {
  const f = await fixture(), first = await f.claim(), stop = new AbortController();
  const checkpoint = f.queue.checkpoint.bind(f.queue);
  let runId: string | undefined, reached = false;
  vi.spyOn(f.queue, 'checkpoint').mockImplementation(async (owned, value) => {
    const result = await checkpoint(owned, value);
    const envelope = value.data as { state?: { id?: string; phase?: string } };
    if (!reached && value.stage === stage && envelope.state?.phase === phase) {
      reached = true; runId = envelope.state.id; stop.abort();
    }
    return result;
  });
  const interrupted = await f.application()(first, { lease: { signal: stop.signal, current: () => !stop.signal.aborted } });
  expect(reached).toBe(true);
  expect(interrupted).toMatchObject({ kind: 'recovery-needed', ...first.attempt });
  expect(f.stages).toEqual(calls);
  expect(f.state().coals[personId]).toBe(2);
  expect(f.authority.release).not.toHaveBeenCalled();
  await f.openAgain();
  const restored = await f.claim();
  expect(restored.attempt).toEqual(first.attempt);
  expect(restored.receipt.modelCalls).toBe(calls.length);
  const outcome = await f.application()(restored);
  expect(outcome).toMatchObject({ kind: 'committed', attachment: { runId } });
  expect(f.stages).toEqual(['words', 'draft', 'result']);
  expect((await f.queue.get(restored.attempt.key))?.modelCalls).toBe(3);
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(1);
  expect(f.state().coals[personId]).toBe(1);
  expect(f.authority.release).not.toHaveBeenCalled();
  expect(JSON.stringify(f.published)).not.toContain(f.command.words);
});

it('treats an explicit withdrawal as terminal cleanup, unlike shutdown, and does not restart it', async () => {
  const f = await fixture(), first = await f.claim(), withdrawal = new AbortController();
  const checkpoint = f.queue.checkpoint.bind(f.queue);
  let reached = false;
  vi.spyOn(f.queue, 'checkpoint').mockImplementation(async (owned, value) => {
    const result = await checkpoint(owned, value);
    const envelope = value.data as { state?: { phase?: string } };
    if (!reached && value.stage === 'words' && envelope.state?.phase === 'drafting') {
      reached = true; withdrawal.abort();
    }
    return result;
  });
  expect(await f.application()(first, { withdrawal: withdrawal.signal })).toMatchObject({ kind: 'canceled' });
  expect(reached).toBe(true);
  expect(f.stages).toEqual(['words']);
  expect(f.authority.release).toHaveBeenCalledTimes(1);
  expect(f.state().coals[personId]).toBe(2);
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(0);
  await f.openAgain();
  const restored = await f.claim();
  expect(restored.attempt).toEqual(first.attempt);
  expect(await f.application()(restored)).toMatchObject({ kind: 'canceled' });
  expect(f.stages).toEqual(['words']);
  expect(f.state().coals[personId]).toBe(2);
});

it('recovers an exact committed payload after reservation expiry and a dead service lease, even if replay first fails', async () => {
  const f = await fixture(), first = await f.claim();
  f.loseCommitReply();
  expect(await f.application()(first)).toMatchObject({ kind: 'recovery-needed', ...first.attempt });
  await f.openAgain();
  const restored = await f.claim(), stopped = new AbortController();
  stopped.abort();
  f.advance(400_000);
  f.recoverStatus();
  f.failCommit(true);
  const lease = { signal: stopped.signal, current: () => false };
  await expect(f.application()(restored, { lease })).resolves.toMatchObject({ kind: 'recovery-needed', ...first.attempt });
  expect(f.authority.release).not.toHaveBeenCalled();
  f.failCommit(false);
  const outcome = await f.application()(restored, { lease });
  expect(outcome).toMatchObject({ kind: 'committed' });
  expect(f.stages).toEqual(['words', 'draft', 'result']);
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(1);
  expect(f.state().coals[personId]).toBe(1);
  expect(f.authority.release).not.toHaveBeenCalled();
});

it('retains a withdrawal when release is unavailable, then recovers a lost release acknowledgment without another call', async () => {
  const f = await fixture(), first = await f.claim(), withdrawn = new AbortController();
  withdrawn.abort();
  f.failRelease(true);
  await expect(f.application()(first, { withdrawal: withdrawn.signal })).resolves.toMatchObject({ kind: 'recovery-needed', ...first.attempt });
  expect(f.stages).toEqual([]);
  expect(f.state().coals[personId]).toBe(2);
  await f.openAgain();
  const second = await f.claim();
  f.failRelease(false); f.loseReleaseReply();
  await expect(f.application()(second)).resolves.toMatchObject({ kind: 'recovery-needed', ...first.attempt });
  expect(f.stages).toEqual([]);
  expect(f.state().coals[personId]).toBe(2);
  await f.openAgain();
  const third = await f.claim();
  expect(third.attempt).toEqual(first.attempt);
  await expect(f.application()(third)).resolves.toMatchObject({ kind: 'canceled' });
  expect(f.stages).toEqual([]);
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(0);
  expect(f.state().coals[personId]).toBe(2);
});

it('does not return a committed recovery to a claim revoked while its exact commit reply was pending', async () => {
  const f = await fixture(), first = await f.claim();
  f.loseCommitReply();
  expect(await f.application()(first)).toMatchObject({ kind: 'recovery-needed' });
  await f.openAgain(); f.recoverStatus();
  const restored = await f.claim();
  f.authority.commit.mockImplementationOnce(async (...args) => {
    const result = await f.actualAuthority.commit(...args);
    await f.queue.close();
    return result;
  });
  await expect(f.application()(restored)).resolves.toMatchObject({ kind: 'recovery-needed', ...first.attempt });
  expect(f.stages).toEqual(['words', 'draft', 'result']);
  expect(f.state().coals[personId]).toBe(1);
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(1);
  expect(f.authority.release).not.toHaveBeenCalled();
});

it('parks a fully judged later commit without releasing or spending, then commits the exact saved candidate in order', async () => {
  const f = await fixture(), first = await f.claim();
  expect(await f.application()(first, { canCommit: () => false })).toMatchObject({ kind: 'recovery-needed' });
  expect(f.stages).toEqual(['words', 'draft', 'result']);
  expect(f.state().coals[personId]).toBe(2);
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(0);
  expect(f.published).toHaveLength(0);
  expect(f.authority.release).not.toHaveBeenCalled();
  await f.queue.retry(first); const resumed = await f.claim();
  expect(await f.application()(resumed, { canCommit: () => true })).toMatchObject({ kind: 'committed' });
  expect(resumed.attempt).toEqual(first.attempt);
  expect(f.stages).toHaveLength(3); expect(f.state().coals[personId]).toBe(1);
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(1);
});

it('reconciles a proven exact commit even while a newer first-commit barrier is closed or withdrawn', async () => {
  const f = await fixture(), first = await f.claim(); f.loseCommitReply();
  expect(await f.application()(first)).toMatchObject({ kind: 'recovery-needed' });
  await f.openAgain(); f.recoverStatus(); const resumed = await f.claim();
  await f.queue.withdraw({ kingdomId, reason: 'deleted', scope: { kind: 'message', messageId: f.command.messageId } });
  expect(f.queue.canCommit(resumed)).toBe(false);
  expect(await f.application()(resumed, { canCommit: () => false, canReserve: () => false })).toMatchObject({ kind: 'committed' });
  expect(f.stages).toHaveLength(3); expect(f.state().coals[personId]).toBe(1);
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(1);
  expect(f.authority.release).not.toHaveBeenCalled();
});

it.each(['reserve', 'revalidate', 'commit', 'approval'] as const)('suspends a transient actual %s dependency outage without terminal cleanup', async operation => {
  const f = await fixture(), first = await f.claim();
  if (operation === 'reserve') vi.spyOn(f.authority, 'reserve').mockImplementationOnce((...args) => {
    f.denyNextRetain(); return f.actualAuthority.reserve(...args);
  });
  if (operation === 'revalidate') vi.spyOn(f.authority, 'revalidate').mockImplementationOnce((...args) => {
    f.denyNextRetain(); return f.actualAuthority.revalidate(...args);
  });
  if (operation === 'commit') f.authority.commit.mockImplementationOnce((...args) => {
    f.denyNextRetain(); return f.actualAuthority.commit(...args);
  });
  if (operation === 'approval') vi.spyOn(f.approvals, 'approved').mockRejectedValueOnce(new Error('approval storage unavailable'));
  expect(await f.application()(first)).toMatchObject({ kind: 'recovery-needed' });
  expect(f.authority.release).not.toHaveBeenCalled();
  expect(f.state().coals[personId]).toBe(2);
  await f.queue.retry(first); const resumed = await f.claim();
  expect(await f.application()(resumed)).toMatchObject({ kind: 'committed' });
  expect(resumed.attempt).toEqual(first.attempt); expect(f.stages).toEqual(['words', 'draft', 'result']);
  expect(f.state().coals[personId]).toBe(1);
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(1);
});

it('keeps an actual capacity hold retryable under the same attempt without starting a model call', async () => {
  const f = await fixture(), first = await f.claim(), messageId = 'prior-reservation';
  const occupied = { ...f.command, ...{ key: forgeMessageKey(kingdomId, messageId), attemptId: 'prior-attempt', messageId } };
  const lease = { signal: new AbortController().signal, current: () => true };
  expect(await f.actualAuthority.reserve(occupied, lease)).toMatchObject({ kind: 'reserved' });
  expect(await f.application()(first)).toMatchObject({ kind: 'recovery-needed' });
  expect(f.stages).toEqual([]); expect(f.authority.release).not.toHaveBeenCalled();
  await f.actualAuthority.release(occupied); await f.queue.retry(first);
  expect(await f.application()(await f.claim())).toMatchObject({ kind: 'committed' });
  expect(f.stages).toHaveLength(3); expect(f.state().coals[personId]).toBe(1);
});

it('runs three queued wishes through actual authority with two anvils, parallel drafts and arrival-ordered commits', async () => {
  const f = await fixture(3);
  const commands = [f.command, ...f.people.slice(1).map((who, index) => ({ ...f.command, personId: who, messageId: `ordered-${index}` }))];
  // The head is unavailable before reserve. Later claims must not fill both anvils behind it.
  f.authority.status.mockRejectedValueOnce(new Error('head prerequisite unavailable'));
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const original = f.runner.getMockImplementation()!;
  let drafts = 0;
  f.runner.mockImplementation(async request => {
    const value = await original(request);
    if (!request.model && ++drafts === 1) await held;
    return value;
  });
  const worker = new ForgeWishWorker({ queue: f.queue, retryMs: 100, maxConcurrent: 2,
    execute: (claim, control) => f.application()(claim, control) });
  // Register shutdown before registry/queue cleanup, even when an assertion fails with the head paused.
  cleanups.push(async () => { release(); await worker.stop(); });
  for (const command of commands) await worker.admit(command);
  await worker.start();
  const until = async (test: () => boolean | Promise<boolean>) => {
    const deadline = Date.now() + 90_000;
    while (!await test()) {
      if (Date.now() > deadline) throw new Error(JSON.stringify({ drafts, stages: f.stages,
        queue: (await f.queue.list()).map(({ sequence, state, stage, modelCalls, outcome }) => ({ sequence, state, stage, modelCalls, outcome })),
        facts: f.facts.map(fact => fact.body.type), active: worker.activeCount }));
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  await until(() => drafts >= 2);
  expect(Object.keys(f.state().reservations)).toHaveLength(2);
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(0);
  release();
  await until(async () => (await f.queue.list()).every(receipt => receipt.state === 'finished'));
  const facts = f.facts.filter(fact => fact.body.type === 'forge.commitApproved');
  expect(facts.map(fact => fact.body.type === 'forge.commitApproved' ? fact.body.attempt.key : '')).toEqual(commands.map(command => forgeMessageKey(kingdomId, command.messageId)));
  expect(f.people.map(who => f.state().coals[who])).toEqual([1, 1, 1]);
  expect(f.stages).toHaveLength(9);
  expect((await f.queue.list()).map(receipt => receipt.delivery?.acknowledged)).toEqual([false, false, false]);
  expect(f.authority.release).not.toHaveBeenCalled();
});
