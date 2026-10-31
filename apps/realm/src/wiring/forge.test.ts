import { afterEach, expect, it, vi } from 'vitest';
import { createHearthHome } from '@chatdom/content';
import { assembleForge, findForgeSockets, forgeStyleKit, homeFingerprint } from '@chatdom/forge';
import { WORLD_FIXTURE_KINGDOM as kingdomId, WORLD_FIXTURE_PERSON as personId } from '@chatdom/shared/world-fixtures';
import { PersonIdSchema } from '@chatdom/shared';
import type { ForgeAttachment, ForgeAttempt, ForgeReservation, KingdomForgeLease, RealmFact, RealmOwnedHome, RealmPrivateState,
  RealmStoredOutcome } from '@chatdom/shared/realm';
import { createRealmState } from '@chatdom/world/realm';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import { createDurableRealmServices, RealmCommitUncertainError, type DurableRepository, type RealmCommitGuard } from '../persistence';
import type { RealmOutboxStore } from '../outbox';
import { createForgeAuthority, forgeHomeDigest, forgeMessageKey } from './forge';
import { ForgeWriteGate } from './gate';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
const caller = () => {
  const controller = new AbortController();
  const lease: KingdomForgeLease = { signal: controller.signal, current: () => !controller.signal.aborted };
  return { lease, cancel: () => controller.abort() };
};

/** SIMULATED command port under the actual DurableKingdom registry/queue; no Postgres or live grant claim. */
async function fixture(options: { coal?: number; installed?: boolean; anvils?: number } = {}) {
  let now = Date.now();
  const blueprint = createHearthHome('house', 0);
  const home: RealmOwnedHome = { id: 'simulated-plot', ownerId: personId, slot: 7, allocationReceipt: 'simulated-deed', layoutRevision: 'founded-test',
    revision: 'home-initial', digest: forgeHomeDigest(blueprint), family: 'hearth', blueprint,
    attribution: { makerName: 'Juniper', kingdomName: 'Emberwick', approvalId: 'simulated-names' }, attachments: {} };
  let state: RealmPrivateState = { ...createRealmState(kingdomId, 'simulated'), homes: { [home.id]: home }, coals: { [personId]: options.coal ?? 2 },
    stream: { sessionId: 'simulated-night', startedAt: now - 700_000, liveUntil: now + 900_000 },
    rights: { [personId]: { revision: 1, forge: true, build: true, blocked: false, safetyIdentifier: 'simulated-safe-citizen-identifier' } } };
  const gate = new ForgeWriteGate(), guards = options.installed === false ? [] : gate.install({ origin: 'simulated' as const }).guards;
  const facts: RealmFact[] = [], receipts = new Map<string, RealmStoredOutcome>();
  let beforeGuard: (() => void | Promise<void>) | undefined;
  let loseReply = false, unavailable = false;
  const repository: DurableRepository = {
    leaseMs: 15_000, acquire: vi.fn(async () => ({ kingdomId, epoch: 'simulated-writer', expiresAt: Date.now() + 15_000 })),
    renew: async lease => ({ ...lease, expiresAt: Date.now() + 15_000 }), load: async () => state, committedState: () => state,
    execute: async (_lease, id, _command, decide, current) => {
      if (!current()) throw new Error('SIMULATED fenced');
      const prior = receipts.get(id);
      if (prior?.status === 'committed' || prior?.status === 'unchanged') return prior;
      const decision = decide(state, now);
      if (decision.kind !== 'accepted') {
        const result: RealmStoredOutcome = { status: decision.kind, reason: decision.reason };
        receipts.set(id, result); return result;
      }
      await beforeGuard?.();
      for (const guard of guards) await guard({} as Parameters<RealmCommitGuard>[0], decision.fact, state);
      state = decision.state; facts.push(decision.fact);
      const result: RealmStoredOutcome = { status: 'committed', sequence: state.sequence, at: now };
      receipts.set(id, result);
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
  const approvals = { approved: vi.fn(async () => 'simulated-judge-receipt' as string | null) };
  const authority = createForgeAuthority({ kingdomId, origin: 'simulated', retain: () => services.retain(kingdomId) },
    { approvals, gate, ...(options.anvils ? { anvils: options.anvils } : {}) });
  let number = 0;
  const wish = () => { const messageId = `simulated-message-${++number}`; return { key: forgeMessageKey(kingdomId, messageId), attemptId: `attempt-${number}`,
    kingdomId, personId, messageId, slot: 999, observedAt: now }; };
  const reserve = async (attempt: ReturnType<typeof wish>, lease = caller().lease) => {
    const answer = await authority.reserve(attempt, lease); expect(answer.kind).toBe('reserved');
    if (answer.kind !== 'reserved') throw new Error('Expected SIMULATED reservation');
    return answer.reservation;
  };
  return { authority, approvals, gate, services, kingdom: retained.kingdom, facts, home, wish, reserve, state: () => state,
    replace: (next: RealmPrivateState) => { state = next; }, advance: (ms: number) => { now += ms; },
    pause: (callback: () => void | Promise<void>) => { beforeGuard = callback; },
    lose: (unknown = false) => { loseReply = true; unavailable = unknown; }, recover: () => { unavailable = false; },
  };
}

function commitInput(attempt: ForgeAttempt, reservation: ForgeReservation, id = 'simulated-run') {
  const plan = { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' } as const;
  const socket = findForgeSockets(reservation.home).find(candidate => candidate.kind === plan.kind)!;
  const assembled = assembleForge(plan, forgeStyleKit(reservation.family), socket);
  const attachment: ForgeAttachment = { version: 1, id, runId: id, kingdomId, slot: reservation.slot, hostId: reservation.home.id,
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
  expect(await f.authority.commit(input, lease)).toEqual(result);
  await f.authority.release(wish);
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(1);
  expect(f.state().coals[personId]).toBe(1);
  const item = f.state().attachments[input.attachment.id]!;
  expect(item.creation.words).toContain('PRIVATE SIMULATED'); expect(item.approvalReceipt).toBe('simulated-judge-receipt');
  expect(item.attachment.committedAt).toBe(item.attachment.provenance.firstForgedAt);
});

it('fails closed for missing gate, room origin, coal, real ownership, rights, moderation and offline stream', async () => {
  const ungated = await fixture({ installed: false }); expect(await ungated.authority.reserve(ungated.wish(), caller().lease)).toEqual({ kind: 'cold' });
  const empty = await fixture({ coal: 0 }); expect(await empty.authority.reserve(empty.wish(), caller().lease)).toEqual({ kind: 'held' });
  const f = await fixture(), initial = f.state();
  for (const [state, kind] of [
    [{ ...initial, homes: {} }, 'cold'], [{ ...initial, rights: {} }, 'cold'],
    [{ ...initial, rights: { [personId]: { ...initial.rights[personId]!, blocked: true } } }, 'held'],
    [{ ...initial, stream: { sessionId: null, startedAt: 0, liveUntil: 0 } }, 'cold'],
  ] as const) {
    f.replace(state); await f.kingdom.execute(`refresh-${kind}-${Object.keys(state.homes).length}-${Object.keys(state.rights).length}-${state.stream.sessionId}`, { type: 'forge.release', attempt: { key: 'unused', attemptId: 'unused' } }, 'forge');
    expect(await f.authority.reserve(f.wish(), caller().lease)).toEqual({ kind });
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
    { ...input.attachment, kitRevision: 99 }, { ...input.attachment, origin: [1, 2, 3] as const },
    { ...input.attachment, provenance: { ...input.attachment.provenance, source: 'live' as const } },
    { ...input.attachment, provenance: { ...input.attachment.provenance, makerName: 'Other' } },
  ]) expect(await f.authority.commit({ ...input, attachment }, lease)).toEqual({ kind: 'held' });
  expect(await f.authority.commit({ ...input, expectedHomeDigest: 'a'.repeat(64) }, lease)).toEqual({ kind: 'held' });
  expect(f.state().coals[personId]).toBe(2); expect(f.state().attachments).toEqual({});
});

it('isolates competing attempts; release retains coal and a released message remains terminal', async () => {
  const f = await fixture({ anvils: 1 }), wish = f.wish(), other = { ...wish, attemptId: 'other-attempt' };
  await f.reserve(wish);
  expect(await f.authority.reserve(other, caller().lease)).toEqual({ kind: 'held' });
  expect(await f.authority.reserve(f.wish(), caller().lease)).toEqual({ kind: 'held' });
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
  expect(await f.authority.reserve({ ...f.wish(), personId: PersonIdSchema.parse('990000009') }, lease)).toEqual({ kind: 'cold' });
});
