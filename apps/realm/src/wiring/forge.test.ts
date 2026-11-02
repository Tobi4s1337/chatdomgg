import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCastle, createHearthHome } from '@chatdom/content';
import { assembleForge, findForgeSockets, forgeStyleKit, homeFingerprint } from '@chatdom/forge';
import { WORLD_FIXTURE_KINGDOM as kingdomId, WORLD_FIXTURE_PERSON as personId } from '@chatdom/shared/world-fixtures';
import { PersonIdSchema } from '@chatdom/shared';
import type { ForgeAttachment, ForgeAttempt, ForgeReservation, KingdomForgeLease, RealmFact, RealmOwnedCastle, RealmOwnedForgeHost, RealmPrivateState,
  RealmStoredOutcome } from '@chatdom/shared/realm';
import { applyRealmFact, createRealmState } from '@chatdom/world/realm';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import { createDurableRealmServices, digestOf, RealmCommitUncertainError, type DurableRepository, type RealmCommitGuard } from '../persistence';
import type { RealmOutboxStore } from '../outbox';
import { createForgeAuthority, forgeHomeDigest, forgeMessageKey } from './forge';
import { ForgeWriteGate } from './gate';
import { FileForgeApprovals } from './approvals';
import type { RealmForgeApprovals } from './types';
import { bindForgeCandidate } from '../../../codex/src/kingdom-forge/candidate';
import { createForgeProviders } from '../../../codex/src/providers';
import { forgeJudgeQuestions } from '../../../codex/src/providers/policy';
import { renderForgeContactSheet } from '../../../codex/src/contact-sheet';
import { forgeAuthorityDeferred } from '../../../codex/src/kingdom-forge/defer';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
const caller = () => {
  const controller = new AbortController();
  const lease: KingdomForgeLease = { signal: controller.signal, current: () => !controller.signal.aborted };
  return { lease, cancel: () => controller.abort() };
};

/** SIMULATED command port under the actual DurableKingdom registry/queue; no Postgres or live grant claim. */
async function fixture(options: { coal?: number; installed?: boolean; anvils?: number; castle?: boolean } = {}) {
  let now = Date.now();
  const ownerId = options.castle ? PersonIdSchema.parse(kingdomId) : personId;
  const blueprint = options.castle ? createCastle('hearth') : createHearthHome('house', 0);
  const common = { ownerId, layoutRevision: 'founded-test', revision: 'home-initial', digest: forgeHomeDigest(blueprint),
    family: 'hearth' as const, blueprint, attribution: { makerName: 'Juniper', kingdomName: 'Emberwick', approvalId: 'simulated-names' }, attachments: {} };
  const home: RealmOwnedForgeHost = options.castle ? { ...common, id: 'castle:simulated-keep', moduleId: 'simulated-keep', slot: 65534 }
    : { ...common, id: 'simulated-plot', slot: 7, allocationReceipt: 'simulated-deed' };
  let state: RealmPrivateState = { ...createRealmState(kingdomId, 'simulated'),
    homes: 'moduleId' in home ? {} : { [home.id]: home }, coals: { [ownerId]: options.coal ?? 2 },
    stream: { sessionId: 'simulated-night', startedAt: now - 700_000, liveUntil: now + 900_000 },
    rights: { [ownerId]: { revision: 1, forge: true, build: true, blocked: false, safetyIdentifier: 'simulated-safe-citizen-identifier' } } };
  const initial = structuredClone(state);
  const gate = new ForgeWriteGate(), guards = options.installed === false ? [] : gate.install({ origin: 'simulated' as const }).guards;
  const facts: RealmFact[] = [], receipts = new Map<string, RealmStoredOutcome>(), payloads = new Map<string, string>();
  let beforeGuard: (() => void | Promise<void>) | undefined;
  let loseReply = false, unavailable = false;
  const repository: DurableRepository = {
    leaseMs: 15_000, acquire: vi.fn(async () => ({ kingdomId, epoch: 'simulated-writer', expiresAt: Date.now() + 15_000 })),
    renew: async lease => ({ ...lease, expiresAt: Date.now() + 15_000 }), load: async () => state, committedState: () => state,
    execute: async (_lease, id, command, decide, current) => {
      if (!current()) throw new Error('SIMULATED fenced');
      const prior = receipts.get(id);
      // Match the real repository's exact command binding before returning a retained receipt.
      if (prior && payloads.get(id) !== digestOf(command)) return { status: 'rejected', reason: 'conflict' };
      if (prior?.status === 'committed' || prior?.status === 'unchanged') return prior;
      const decision = decide(state, now);
      if (decision.kind !== 'accepted') {
        const result: RealmStoredOutcome = { status: decision.kind, reason: decision.reason };
        payloads.set(id, digestOf(command)); receipts.set(id, result); return result;
      }
      await beforeGuard?.();
      for (const guard of guards) await guard({} as Parameters<RealmCommitGuard>[0], decision.fact, state);
      state = decision.state; facts.push(decision.fact);
      const result: RealmStoredOutcome = { status: 'committed', sequence: state.sequence, at: now };
      payloads.set(id, digestOf(command)); receipts.set(id, result);
      if (loseReply) { loseReply = false; throw new RealmCommitUncertainError(kingdomId, id); }
      return result;
    },
    lookup: async (_kingdom, id) => { if (unavailable) throw new Error('SIMULATED unavailable lookup'); return receipts.get(id) ?? null; },
    snapshot: async () => state.sequence, release: async () => {}, loadIngress: async () => null,
    executeIngress: async () => ({ status: 'unchanged', reason: 'unused' }),
  };
  const outbox: RealmOutboxStore = { open: async () => 0, prefix: async () => ({ homes: [], presence: null, sequence: 0, committed: 0 }),
    read: async () => [], acknowledge: async () => {} };
  const services = createDurableRealmServices({ repository, outbox, auth: { authenticate: async () => { throw new Error('No entry'); }, current: async () => false },
    kingdom: () => ({ world: REFERENCE_WORLD, layoutRevision: home.layoutRevision, spawn: () => [0, 0, 6] }) });
  const retained = await services.retain(kingdomId); cleanup.push(() => retained.release());
  vi.spyOn(retained.kingdom, 'databaseNow').mockImplementation(() => now);
  if (options.castle) await retained.kingdom.execute('simulated:install-castle', { type: 'castle.installNative', castle: home as RealmOwnedCastle }, 'allocation');
  const approvals = { approved: vi.fn<RealmForgeApprovals['approved']>(async () => 'simulated-judge-receipt' as string | null) };
  const authority = createForgeAuthority({ kingdomId, origin: 'simulated', retain: () => services.retain(kingdomId) },
    { approvals, gate, ...(options.anvils ? { anvils: options.anvils } : {}) });
  let number = 0;
  const wish = () => { const messageId = `simulated-message-${++number}`; return { key: forgeMessageKey(kingdomId, messageId), attemptId: `attempt-${number}`,
    kingdomId, personId: ownerId, messageId, slot: 999, observedAt: now }; };
  const reserve = async (attempt: ReturnType<typeof wish>, lease = caller().lease) => {
    const answer = await authority.reserve(attempt, lease); expect(answer.kind).toBe('reserved');
    if (answer.kind !== 'reserved') throw new Error('Expected SIMULATED reservation');
    return answer.reservation;
  };
  return { authority, approvals, gate, services, kingdom: retained.kingdom, facts, home, ownerId, initial, wish, reserve, state: () => state,
    replace: (next: RealmPrivateState) => { state = next; }, advance: (ms: number) => { now += ms; },
    pause: (callback: () => void | Promise<void>) => { beforeGuard = callback; },
    lose: (unknown = false) => { loseReply = true; unavailable = unknown; }, recover: () => { unavailable = false; },
  };
}

function commitInput(attempt: ForgeAttempt, reservation: ForgeReservation, id = 'simulated-run') {
  const plan = { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' } as const;
  const socket = findForgeSockets(reservation.home, reservation.hostProfile).find(candidate => candidate.kind === plan.kind)!;
  const assembled = assembleForge(plan, forgeStyleKit(reservation.family), socket);
  const attachment: ForgeAttachment = { version: 1, id, runId: id, kingdomId, slot: reservation.slot, hostId: reservation.home.id,
    ...(reservation.hostProfile ? { hostProfile: reservation.hostProfile } : {}),
    hostFingerprint: homeFingerprint(reservation.home), socketId: socket.id, origin: socket.origin, kitId: assembled.kit.id,
    kitRevision: assembled.kit.revision, family: reservation.family, draft: { plan, title: 'The Dreaming Chimney', plaque: 'Warm dreams above the hearth.' },
    provenance: { source: 'simulated', makerName: reservation.attribution.makerName, kingdomName: reservation.attribution.kingdomName, designId: `design-${id}` } };
  return { ...attempt, reservationId: reservation.reservationId, expectedRevision: reservation.revision,
    expectedHomeDigest: forgeHomeDigest(reservation.home), attachment, creation: { words: 'PRIVATE SIMULATED dragon chimney' } };
}

it('shares one retained writer; ignores slot hints, reserves without spending, and commits once with private provenance', async () => {
  const f = await fixture(), wish = f.wish(), lease = caller().lease;
  const reservation = await f.reserve(wish, lease);
  expect(reservation.slot).toBe(f.home.slot); expect(f.state().coals[personId]).toBe(2);
  expect(await f.authority.reserve(wish, lease)).toEqual({ kind: 'reserved', reservation });
  expect(f.services.kingdoms.get(kingdomId)).toBe(f.kingdom);
  const input = commitInput(wish, reservation), result = await f.authority.commit(input, lease);
  expect(result).toMatchObject({ kind: 'committed' });
  expect(f.approvals.approved).toHaveBeenCalledWith(wish.key, input.attachment.runId, {
    ...bindForgeCandidate(input.attachment.draft, reservation.home), kitId: input.attachment.kitId, kitRevision: input.attachment.kitRevision,
  });
  expect(await f.authority.commit(input, lease)).toEqual(result);
  await f.authority.release(wish);
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(1);
  expect(f.state().coals[personId]).toBe(1);
  const item = f.state().attachments[input.attachment.id]!;
  expect(item.creation.words).toContain('PRIVATE SIMULATED'); expect(item.approvalReceipt).toBe('simulated-judge-receipt');
  expect(item.attachment.committedAt).toBe(item.attachment.provenance.firstForgedAt);
});

it('replays only the exact committed payload when its historical approval no longer authorizes new work', async () => {
  const f = await fixture(), attempt = f.wish(), lease = caller().lease, reservation = await f.reserve(attempt, lease);
  const input = commitInput(attempt, reservation), result = await f.authority.commit(input, lease);
  expect(result).toMatchObject({ kind: 'committed' });
  const committed = structuredClone(f.state()), facts = structuredClone(f.facts);
  // SIMULATED policy rollover: the current reader no longer accepts the historical audit.
  f.approvals.approved.mockResolvedValue(null);
  f.advance(1_000);
  expect(await f.authority.commit(input, lease)).toEqual(result);
  expect(f.approvals.approved).toHaveBeenCalledTimes(1);
  for (const changed of [
    { ...input, expectedRevision: 'another-revision' },
    { ...input, expectedHomeDigest: 'a'.repeat(64) },
    { ...input, reservationId: 'another-reservation' },
    { ...input, attachment: { ...input.attachment, id: 'another-run', runId: 'another-run' } },
    { ...input, attachment: { ...input.attachment, draft: { ...input.attachment.draft, title: 'An unjudged title' } } },
    { ...input, attachment: { ...input.attachment, provenance: { ...input.attachment.provenance, source: 'live' as const } } },
    { ...input, creation: { words: 'PRIVATE SIMULATED changed wish' } },
  ]) expect(await f.authority.commit(changed, lease)).toEqual({ kind: 'held' });
  expect(await f.authority.commit({ ...input, attemptId: 'competing-attempt' }, lease)).toEqual({ kind: 'already-committed' });
  expect(await f.authority.commit({ ...input, key: `${input.key}-changed` }, lease)).toEqual({ kind: 'held' });
  expect(await f.authority.commit(input, lease)).toEqual(result);
  expect(f.state()).toEqual(committed); expect(f.facts).toEqual(facts);
  expect(f.state().coals[personId]).toBe(1);
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(1);

  const pending = f.wish(), next = await f.reserve(pending, lease), before = structuredClone(f.state()), beforeFacts = structuredClone(f.facts);
  expect(await f.authority.commit(commitInput(pending, next, 'simulated-pending-run'), lease)).toEqual({ kind: 'held' });
  expect(f.state()).toEqual(before); expect(f.facts).toEqual(beforeFacts);
  expect(f.state().coals[personId]).toBe(1);
});

it('holds unconfirmed replay payloads while status can recover the exact durable attempt independently', async () => {
  const f = await fixture(), attempt = f.wish(), lease = caller().lease, reservation = await f.reserve(attempt, lease);
  const input = commitInput(attempt, reservation), lagged = f.kingdom.privateState;
  const result = await f.authority.commit(input, lease), committed = structuredClone(f.state()), facts = structuredClone(f.facts);
  expect(result).toMatchObject({ kind: 'committed' });
  f.approvals.approved.mockResolvedValue(null);
  const view = vi.spyOn(f.kingdom, 'privateState', 'get').mockReturnValue(lagged);
  expect(await f.authority.commit(input, lease)).toEqual({ kind: 'held' });
  expect(await f.authority.status(attempt)).toEqual(result);
  view.mockRestore();

  const execute = vi.spyOn(f.kingdom, 'execute').mockRejectedValueOnce(new Error('SIMULATED payload check unavailable'));
  expect(await f.authority.commit({ ...input, creation: { words: 'PRIVATE SIMULATED changed wish' } }, lease)).toEqual({ kind: 'held' });
  expect(await f.authority.status(attempt)).toEqual(result);
  execute.mockRestore();
  const canceled = caller(); canceled.cancel();
  expect(await f.authority.commit(input, canceled.lease)).toEqual({ kind: 'cold' });
  const delayed = caller(), lookup = f.kingdom.lookup.bind(f.kingdom);
  const cancelOnLookup = vi.spyOn(f.kingdom, 'lookup').mockImplementationOnce(async id => {
    const answer = await lookup(id); delayed.cancel(); return answer;
  });
  expect(await f.authority.commit(input, delayed.lease)).toEqual({ kind: 'cold' });
  cancelOnLookup.mockRestore();
  const otherOrigin = createForgeAuthority({ kingdomId, origin: 'live', retain: () => f.services.retain(kingdomId) }, { approvals: f.approvals, gate: f.gate });
  expect(await otherOrigin.commit(input, lease)).toEqual({ kind: 'cold' });
  expect(await f.authority.commit(input, lease)).toEqual(result);
  expect(f.approvals.approved).toHaveBeenCalledTimes(1);
  expect(f.state()).toEqual(committed); expect(f.facts).toEqual(facts);
});

it.each(['rejected', 'thrown'] as const)('does not turn a %s concurrent payload conflict into exact commit success', async mode => {
  const f = await fixture(), attempt = f.wish(), lease = caller().lease, reservation = await f.reserve(attempt, lease);
  const input = commitInput(attempt, reservation), otherWords = 'PRIVATE SIMULATED competing payload';
  const execute = f.kingdom.execute.bind(f.kingdom);
  const competing = vi.spyOn(f.kingdom, 'execute').mockImplementationOnce(async (id, command, capability, meta) => {
    if (command.type !== 'forge.commitApproved') throw new Error('Expected SIMULATED Forge commit');
    // SIMULATED interleaving: another caller committed this attempt with different creation before the check.
    expect(await execute(id, { ...command, creation: { words: otherWords } }, capability, meta)).toMatchObject({ status: 'committed' });
    if (mode === 'thrown') throw new Error('SIMULATED payload check failed');
    return { status: 'rejected', reason: 'conflict' };
  });
  expect(await f.authority.commit(input, lease)).toEqual({ kind: 'held' });
  competing.mockRestore();
  const known = await f.authority.status(attempt);
  expect(known).toMatchObject({ kind: 'committed' });
  f.approvals.approved.mockResolvedValue(null);
  expect(await f.authority.commit(input, lease)).toEqual({ kind: 'held' });
  expect(await f.authority.commit({ ...input, creation: { words: otherWords } }, lease)).toEqual(known);
  expect(f.state().coals[personId]).toBe(1);
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(1);
  expect(f.state().attachments[input.attachment.id]?.creation.words).toBe(otherWords);
});

it('fails closed for missing gate, room origin, coal, real ownership, rights, moderation and offline stream', async () => {
  const ungated = await fixture({ installed: false }); expect(await ungated.authority.reserve(ungated.wish(), caller().lease)).toEqual({ kind: 'cold' });
  const empty = await fixture({ coal: 0 }); expect(await empty.authority.reserve(empty.wish(), caller().lease)).toMatchObject({ kind: 'held', privateMessage: expect.stringContaining('scuttle is empty') });
  const f = await fixture(), initial = f.state();
  for (const [state, kind] of [
    [{ ...initial, homes: {} }, 'cold'], [{ ...initial, rights: {} }, 'cold'],
    [{ ...initial, rights: { [personId]: { ...initial.rights[personId]!, blocked: true } } }, 'held'],
    [{ ...initial, stream: { sessionId: null, startedAt: 0, liveUntil: 0 } }, 'cold'],
  ] as const) {
    f.replace(state); await f.kingdom.execute(`refresh-${kind}-${Object.keys(state.homes).length}-${Object.keys(state.rights).length}-${state.stream.sessionId}`, { type: 'forge.release', attempt: { key: 'unused', attemptId: 'unused' } }, 'forge');
    const answer = await f.authority.reserve(f.wish(), caller().lease);
    expect(answer).toMatchObject({ kind, privateMessage: expect.any(String) });
    if (state.stream.sessionId === null) expect(answer).toMatchObject({ privateMessage: expect.stringContaining('stream is offline') });
  }
  const otherOrigin = createForgeAuthority({ kingdomId, origin: 'live', retain: () => f.services.retain(kingdomId) }, { approvals: f.approvals, gate: f.gate });
  expect(await otherOrigin.reserve(f.wish(), caller().lease)).toEqual({ kind: 'cold' }); expect(f.facts).toHaveLength(0);
});

it('requires audited approval and verifies the exact current host, socket, kit, origin and approved names', async () => {
  const f = await fixture(), wish = f.wish(), lease = caller().lease, reservation = await f.reserve(wish, lease), input = commitInput(wish, reservation);
  f.approvals.approved.mockResolvedValueOnce(null);
  expect(await f.authority.commit(input, lease)).toEqual({ kind: 'held' });
  for (const attachment of [
    { ...input.attachment, hostFingerprint: 'wrong' }, { ...input.attachment, socketId: 'wrong' },
    { ...input.attachment, kitRevision: 2 }, { ...input.attachment, kitRevision: 99 },
    { ...input.attachment, kitId: 'tide-native' }, { ...input.attachment, origin: [1, 2, 3] as const },
    { ...input.attachment, provenance: { ...input.attachment.provenance, source: 'live' as const } },
    { ...input.attachment, provenance: { ...input.attachment.provenance, makerName: 'Other' } },
  ]) expect(await f.authority.commit({ ...input, attachment }, lease)).toEqual({ kind: 'held' });
  expect(await f.authority.commit({ ...input, expectedHomeDigest: 'a'.repeat(64) }, lease)).toEqual({ kind: 'held' });
  expect(f.state().coals[personId]).toBe(2); expect(f.state().attachments).toEqual({});
});

it('holds a registered revision-two attachment even with a successful approval while the current kit is revision one', async () => {
  const f = await fixture(), attempt = f.wish(), lease = caller().lease, reservation = await f.reserve(attempt, lease);
  const input = commitInput(attempt, reservation), preview = forgeStyleKit(reservation.family, 2);
  expect(input.attachment.kitRevision).toBe(1);
  expect(await f.authority.commit({ ...input, attachment: { ...input.attachment, kitId: preview.id, kitRevision: preview.revision } }, lease))
    .toEqual({ kind: 'held' });
  expect(await f.approvals.approved.mock.results.at(-1)!.value).toBe('simulated-judge-receipt');
  expect(f.state().coals[personId]).toBe(2);
  expect(f.state().attachments).toEqual({});
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toEqual([]);
  expect(await f.authority.commit(input, lease)).toMatchObject({ kind: 'committed' });
  expect(f.state().coals[personId]).toBe(1);
});

it('binds the real private approval to the selected draft, host and exact kit before spending coal', async () => {
  const f = await fixture(), attempt = f.wish(), lease = caller().lease, reservation = await f.reserve(attempt, lease);
  const input = commitInput(attempt, reservation, 'bound-selected-run');
  const directory = await mkdtemp(join(tmpdir(), 'chatdom-selected-forge-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const approvals = new FileForgeApprovals(directory), quality = { recognisability: 0.9, completeness: 0.9, cleanMarks: 0.9 };
  const providers = createForgeProviders({ runCodex: async ({ image }) => JSON.stringify({
    answers: forgeJudgeQuestions(Boolean(image)).map(({ name }) => ({ type: 'predicate', name, probability: 0.01 })), ...(image ? { quality, detailMatch: 'met' } : {}),
  }) });
  const socket = findForgeSockets(reservation.home).find(socket => socket.kind === input.attachment.draft.plan.kind)!;
  const piece = assembleForge(input.attachment.draft.plan, forgeStyleKit(reservation.family), socket);
  const words = await providers.judgeWords({ words: input.creation.words, safetyIdentifier: reservation.safetyIdentifier });
  const result = await providers.judgeResult({ wish: input.creation.words, draft: input.attachment.draft, safetyIdentifier: reservation.safetyIdentifier,
    contactSheet: renderForgeContactSheet(piece.blueprint, { home: reservation.home, origin: socket.origin }) });
  await approvals.record({ key: attempt.key, runId: input.attachment.runId, at: Date.now(), judgment: 'approved',
    verdicts: [words, result].map(({ outcome, records, quality, detailMatch }) => ({ outcome, records,
      ...(quality ? { quality } : {}), ...(detailMatch ? { detailMatch } : {}) })),
    candidate: bindForgeCandidate(input.attachment.draft, reservation.home, piece.kit) });
  f.approvals.approved.mockImplementation((key, id, expected) => approvals.approved(key, id, expected));
  for (const attachment of [
    { ...input.attachment, kitRevision: 2 }, { ...input.attachment, kitId: 'tide-native' },
  ]) {
    expect(await f.authority.commit({ ...input, attachment }, lease)).toEqual({ kind: 'held' });
    expect(await f.approvals.approved.mock.results.at(-1)!.value).toBeNull();
    expect(f.state().coals[personId]).toBe(2);
  }
  for (const draft of [
    { ...input.attachment.draft, title: 'An unjudged retry title' },
    { ...input.attachment.draft, plaque: 'An unjudged retry plaque.' },
    { ...input.attachment.draft, plan: { ...input.attachment.draft.plan, motif: 'sleeping-fox' as const } },
  ]) {
    expect(await f.authority.commit({ ...input, attachment: { ...input.attachment, draft } }, lease)).toEqual({ kind: 'held' });
    expect(f.state().coals[personId]).toBe(2);
    expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toEqual([]);
  }
  expect(await f.authority.commit(input, lease)).toMatchObject({ kind: 'committed' });
  expect(f.state().coals[personId]).toBe(1);
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(1);
  expect(JSON.stringify(f.facts)).not.toContain('unjudged retry');
});

it('isolates competing attempts; release retains coal and a released message remains terminal', async () => {
  const f = await fixture({ anvils: 1 }), wish = f.wish(), other = { ...wish, attemptId: 'other-attempt' };
  await f.reserve(wish);
  expect(await f.authority.reserve(other, caller().lease)).toEqual({ kind: 'held' });
  expect(await f.authority.reserve(f.wish(), caller().lease)).toMatchObject({ kind: 'held', privateMessage: expect.stringContaining('already have a wish') });
  await f.authority.release(other); expect(await f.authority.status(wish)).toEqual({ kind: 'reserved' });
  await f.authority.release(wish); expect(await f.authority.status(wish)).toEqual({ kind: 'released' });
  expect(f.state().coals[personId]).toBe(2); expect(await f.authority.reserve(wish, caller().lease)).toEqual({ kind: 'cold' });
});

it('cancels at the repository guard after asynchronous waits, and expires abandoned reservations', async () => {
  const f = await fixture(), canceled = caller(), wish = f.wish();
  f.pause(canceled.cancel);
  expect(await f.authority.reserve(wish, canceled.lease)).toEqual({ kind: 'cold' });
  expect(f.state().reservations).toEqual({});
  await f.authority.release(wish);
  expect(await f.authority.reserve(wish, caller().lease)).toEqual({ kind: 'cold' });
  f.pause(() => {});
  const next = f.wish(), lease = caller(), reservation = await f.reserve(next, lease.lease);
  f.pause(lease.cancel);
  expect(await f.authority.commit(commitInput(next, reservation), lease.lease)).toEqual({ kind: 'cold' });
  expect(f.state().coals[personId]).toBe(2); expect(f.state().attachments).toEqual({});
  f.pause(() => {}); f.advance(300_001);
  expect(await f.authority.revalidate(next, reservation.reservationId, caller().lease)).toEqual({ kind: 'cold' });
  await f.reserve(f.wish()); expect(f.state().forgeOutcomes[next.key]?.status).toBe('released');
});

it('resolves lost commit replies by receipt and preserves uncertainty until durable lookup recovers', async () => {
  const f = await fixture(), wish = f.wish(), lease = caller().lease;
  f.lose(); const reservation = await f.reserve(wish, lease);
  f.lose(true); await expect(f.authority.commit(commitInput(wish, reservation), lease)).rejects.toThrow('could not confirm');
  // The same writer can prove cleanup is unchanged even while receipt lookup is unavailable.
  await f.authority.release(wish);
  f.recover(); expect(await f.authority.status(wish)).toMatchObject({ kind: 'committed' });
  await f.authority.release(wish);
  expect(f.state().coals[personId]).toBe(1); expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(1);
});

it('returns the current owned home on revalidation and atomically retains displaced attachments', async () => {
  const f = await fixture(), first = f.wish(), reservation = await f.reserve(first), lease = caller().lease;
  await f.authority.commit(commitInput(first, reservation, 'simulated-first'), lease);
  const second = f.wish(), newer = await f.reserve(second);
  expect(newer.revision).not.toBe(reservation.revision);
  expect(await f.authority.revalidate(second, newer.reservationId, lease)).toMatchObject({ kind: 'current', native: { revision: newer.revision } });
  await f.authority.commit(commitInput(second, newer, 'simulated-second'), lease);
  expect(f.state().attachments['simulated-first']?.attached).toBe(false);
  expect(f.state().attachments['simulated-second']?.attached).toBe(true);
  expect(f.state().coals[personId]).toBe(0);
  expect(await f.authority.reserve({ ...f.wish(), personId: PersonIdSchema.parse('990000009') }, lease)).toMatchObject({ kind: 'cold', privateMessage: expect.stringContaining('own home') });
});


it('forges onto the real native keep after evidenced qualification and replays without inventing a street deed', async () => {
  const f = await fixture({ castle: true, coal: 0 }), wish = f.wish(), lease = caller().lease;
  expect(await f.authority.reserve(wish, lease)).toMatchObject({ kind: 'held', privateMessage: expect.stringContaining('scuttle is empty') });
  expect(f.state().homes).toEqual({}); expect(f.state().coals[f.ownerId]).toBe(0);
  const from = f.state().stream.startedAt;
  const credit = { type: 'coal.creditQualifiedNight' as const, personId: f.ownerId, streamSessionId: 'simulated-night', qualificationReceipt: 'simulated:actual-intervals' };
  expect(await f.kingdom.execute('simulated:credit-castle', credit, 'presence')).toMatchObject({ status: 'rejected', reason: 'held' });
  await f.kingdom.execute('simulated:interval-castle', { type: 'presence.confirmInterval', personId: f.ownerId, streamSessionId: 'simulated-night',
    from, through: from + 600_000, evidenceReceipt: 'simulated:closed-observations' }, 'presence');
  expect(await f.kingdom.execute('simulated:credit-castle', credit, 'presence')).toMatchObject({ status: 'committed' });
  const reservation = await f.reserve(wish, lease);
  expect(reservation).toMatchObject({ slot: 65534, hostProfile: 'castle-keep', home: { id: f.home.blueprint.id, kind: 'civic', size: [256, 248, 256] } });
  expect(await f.authority.revalidate(wish, reservation.reservationId, lease)).toMatchObject({ kind: 'current', native: { hostProfile: 'castle-keep', slot: 65534 } });
  const input = commitInput(wish, reservation, 'simulated-castle-run');
  expect(await f.authority.commit({ ...input, attachment: { ...input.attachment, hostProfile: 'street-home' } }, lease)).toEqual({ kind: 'held' });
  expect(await f.authority.commit(input, lease)).toMatchObject({ kind: 'committed' });
  expect(f.state().coals[f.ownerId]).toBe(0); expect(f.state().homes).toEqual({});
  expect(f.state().castle?.attachments[input.attachment.socketId]).toBe(input.attachment.id);
  expect(f.state().attachments[input.attachment.id]?.attachment.hostProfile).toBe('castle-keep');
  expect(f.facts.reduce(applyRealmFact, f.initial)).toEqual(f.state());
});

it.each([false, true])('retries a capacity-raced reserve when the competing slot has already cleared: %s', async clearBeforeReply => {
  const f = await fixture(), first = f.wish(), other = f.wish(), lease = caller().lease;
  const execute = f.kingdom.execute.bind(f.kingdom);
  vi.spyOn(f.kingdom, 'execute').mockImplementationOnce(async (...args) => {
    const [, command, source, meta] = args;
    if (command.type !== 'forge.reserve') throw new Error('Expected reserve proposal');
    const competing = { ...command, record: { ...command.record,
      attempt: { key: other.key, attemptId: other.attemptId },
      reservation: { ...command.record.reservation, reservationId: 'competing-reservation' } } };
    expect(await execute('controlled:reserve-race', competing, source, meta)).toMatchObject({ status: 'committed' });
    const rejected = await execute(...args);
    if (clearBeforeReply) await f.authority.release(other);
    return rejected;
  });
  const waiting = await f.authority.reserve(first, lease);
  expect(waiting).toMatchObject({ kind: 'held' });
  expect(forgeAuthorityDeferred(waiting)).toBe(true);
  expect(f.state().reservations[first.key]).toBeUndefined();
  if (!clearBeforeReply) await f.authority.release(other);
  f.advance(1_000);
  const resumed = await f.reserve(first, lease);
  expect(resumed.expiresAt).toBeGreaterThan(f.state().stream.startedAt);
  expect(f.state().reservations[first.key]?.attempt).toEqual({ key: first.key, attemptId: first.attemptId });
  expect(f.facts.filter(fact => fact.body.type === 'forge.reserve')).toHaveLength(2);
  expect(f.state().coals[personId]).toBe(2);
});

it('reconciles concurrent changed reserve proposals to one actual reservation and one reserve fact', async () => {
  const f = await fixture(), wish = f.wish(), lease = caller().lease;
  const execute = f.kingdom.execute.bind(f.kingdom);
  let reached!: () => void, resume!: () => void;
  const entered = new Promise<void>(resolve => { reached = resolve; });
  const waiting = new Promise<void>(resolve => { resume = resolve; });
  vi.spyOn(f.kingdom, 'execute').mockImplementationOnce(async (...args) => {
    reached(); await waiting; return execute(...args);
  });
  const earlier = f.authority.reserve(wish, lease); await entered;
  f.advance(1_000);
  const later = await f.reserve(wish, lease); resume();
  expect(await earlier).toEqual({ kind: 'reserved', reservation: later });
  expect(f.facts.filter(fact => fact.body.type === 'forge.reserve')).toHaveLength(1);
  expect(Object.keys(f.state().reservations)).toEqual([wish.key]);
  expect(f.state().coals[personId]).toBe(2);
});
