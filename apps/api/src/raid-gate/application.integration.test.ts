/**
 * The Raid Gate application end to end (spec 23, Acceptance): strict commands through the real handler with a
 * server-supplied principal, the transactional repository, and controlled transports. Every Twitch answer and every
 * raid observation here is SIMULATED; nothing reaches Twitch or the Atlas.
 *
 * This file grows with the lane. RG08 covers the first portion: preview, join, start, a lost start reply, a restart,
 * reconcile without a second Twitch write, the verified raid delivered twice, and its one road handoff.
 */
import { describe, expect, it } from 'vitest';
import { AtlasRaidSchema, type AtlasRaid } from '../../../../packages/shared/src/atlas-raids';
import { KingdomIdSchema, PersonIdSchema, type PersonId } from '../../../../packages/shared/src/identity';
import { createRaidGateApplication, type RaidGateApplication } from './application';
import { readGateReply, type GateContext, type GateReply } from './contracts';
import { createMemoryRaidGateRepository, type MemoryRaidGateRepository } from './memory-repository';
import type { AtlasRoadIngress, AuthorizedRaidTransport, GatePolicy, RaidWrite, RaidWriteOutcome, TrustedRaidObservation } from './ports';
import { outboxId } from './repository';

const SOURCE = KingdomIdSchema.parse('41000001');
const MIRA = KingdomIdSchema.parse('41000002');
const FERN = KingdomIdSchema.parse('41000003');
const MONARCH = PersonIdSchema.parse('41000001');
const WREN = PersonIdSchema.parse('52000001');
const OAK = PersonIdSchema.parse('52000002');
const T0 = 1_800_000_000_000;

/**
 * SIMULATED Twitch raid authority. It keeps its own record of each write by key, as main's transport must, so
 * `reconcile` can answer for a write whose reply was lost. `lose` makes the next write happen on "Twitch" while its
 * reply never reaches the gate.
 */
function simulatedTwitch(clock: () => number) {
  const ledger = new Map<string, RaidWriteOutcome>();
  const writes: { kind: 'start' | 'cancel'; write: RaidWrite }[] = [];
  const reconciles: string[] = [];
  let lose = false;
  let refuse: string | null = null;
  let cancelAnswer: RaidWriteOutcome | null = null;
  const transport: AuthorizedRaidTransport = {
    origin: 'simulated',
    async start(write) {
      writes.push({ kind: 'start', write });
      const outcome: RaidWriteOutcome = refuse ? { kind: 'rejected', code: refuse } : { kind: 'accepted', createdAt: clock() };
      ledger.set(write.key, outcome);
      if (lose) { lose = false; throw new Error('SIMULATED: the reply was lost on the way back'); }
      return outcome;
    },
    async cancel(write) {
      writes.push({ kind: 'cancel', write });
      const outcome = cancelAnswer ?? { kind: 'accepted', createdAt: clock() };
      ledger.set(write.key, outcome);
      return outcome;
    },
    async reconcile(write) {
      reconciles.push(write.key);
      return ledger.get(write.key) ?? { kind: 'unknown' };
    },
  };
  return {
    transport, writes, reconciles, ledger,
    loseNextReply() { lose = true; },
    refuseWith(code: string) { refuse = code; },
    answerCancel(outcome: RaidWriteOutcome) { cancelAnswer = outcome; },
  };
}

/** SIMULATED Atlas road ingestion: idempotent by raid ID, like the Atlas ledger. */
function simulatedRoads() {
  const roads = new Map<string, AtlasRaid>();
  const calls: string[] = [];
  let failing = false;
  const ingress: AtlasRoadIngress = {
    origin: 'simulated',
    async observe(raid) {
      calls.push(raid.id);
      if (failing) throw new Error('SIMULATED: the Atlas is unreachable');
      roads.set(raid.id, raid);
    },
  };
  return { ingress, roads, calls, fail(on: boolean) { failing = on; } };
}

const policy: GatePolicy = {
  async readStanding(principal) {
    return { session: 'current', broadcaster: principal.personId === MONARCH, live: true, raids: 'granted', actions: 'enabled' };
  },
  async readTarget(_from, target) {
    if (target !== MIRA && target !== FERN) return null;
    return { target: { kingdomId: target, founded: target === MIRA, live: true, classification: 'general' }, permitted: true };
  },
};

/** One server: the repository and the simulated outside world survive a restart; the application does not. */
function world() {
  let now = T0;
  const clock = () => now;
  const repository = createMemoryRaidGateRepository();
  const twitch = simulatedTwitch(clock);
  const atlas = simulatedRoads();
  let issued = 0;
  const boot = (options: { raids?: boolean } = {}): RaidGateApplication => createRaidGateApplication({
    repository, policy, origin: 'simulated', clock,
    raids: options.raids === false ? null : twitch.transport, roads: atlas.ingress,
    tokens: { issue: () => `preview${++issued}`, hash: async value => value.replace(/\D/g, '').padStart(64, 'b') },
  });
  let app = boot();
  const as = (personId: PersonId) => async (command: unknown): Promise<GateReply> => {
    const context: GateContext = {
      principal: { personId, sessionId: `session-${personId}`, sourceKingdomId: SOURCE, sourceRole: personId === MONARCH ? 'monarch' : 'citizen' },
      now, signal: new AbortController().signal,
    };
    const reply = await app.handle(context, command);
    expect(readGateReply(structuredClone(reply))).toEqual(reply);
    return reply;
  };
  return {
    repository, twitch, atlas, clock,
    get app() { return app; },
    restart(options?: { raids?: boolean }) { app = boot(options); },
    advance(ms: number) { now += ms; },
    monarch: as(MONARCH), wren: as(WREN), oak: as(OAK),
  };
}

/** A SIMULATED `channel.raid` as main's verified ingress would hand it over. */
function observed(options: { requestId: string | null; eventId?: string | null; at: number; to?: typeof MIRA; viewers?: number }): TrustedRaidObservation {
  const raid = AtlasRaidSchema.parse({
    version: 1, id: `simulated-raid-${options.eventId ?? 'none'}`, fromKingdomId: SOURCE, toKingdomId: options.to ?? MIRA,
    viewers: options.viewers ?? 14, observedAt: options.at, occurredAt: options.at,
    evidence: { kind: 'simulated', asOf: options.at, label: 'SIMULATED' }, delivery: 'resumable', source: 'simulation',
  });
  return { raid, upstreamEventId: options.eventId === undefined ? 'evt-1' : options.eventId, actionRequestId: options.requestId, receivedAt: options.at };
}

async function previewToken(reply: GateReply): Promise<string> {
  if (reply.kind !== 'preview') throw new Error(`expected a preview, got ${JSON.stringify(reply)}`);
  return reply.value.token;
}

const action = (repository: MemoryRaidGateRepository, requestId = 'r1') => repository.snapshot().actions.find(each => each.requestId === requestId);
const outbox = (repository: MemoryRaidGateRepository, requestId = 'r1') =>
  Object.fromEntries(repository.snapshot().outbox.filter(each => each.requestId === requestId).map(each => [each.kind, each]));

describe('Raid Gate journey (SIMULATED transports)', () => {
  it('starts once, survives a lost reply and a restart, and sets out only on the witnessed raid', async () => {
    const w = world();
    const token = await previewToken(await w.monarch({ op: 'preview', requestId: 'r1', target: MIRA }));
    await w.wren({ op: 'join', requestId: 'r1' });
    await w.oak({ op: 'join', requestId: 'r1' });

    // The press reaches Twitch, but its reply is lost: the gate says it is checking, and holds the write as claimed.
    w.twitch.loseNextReply();
    w.advance(2_000);
    expect(await w.monarch({ op: 'start', requestId: 'r1', previewToken: token })).toMatchObject({ kind: 'action', value: { state: 'unknown', raid: null } });
    expect(w.twitch.writes).toHaveLength(1);
    expect(outbox(w.repository).start).toMatchObject({ state: 'claimed', attempts: 1 });
    expect(await w.wren({ op: 'gate' })).toMatchObject({ value: { open: { state: 'unknown', joined: true, optedIn: 2 } } });

    // A double press and a reload resume the same request; neither reaches Twitch again.
    expect(await w.monarch({ op: 'start', requestId: 'r1', previewToken: token })).toMatchObject({ value: { state: 'unknown' } });
    w.restart();
    expect(await w.monarch({ op: 'start', requestId: 'r1', previewToken: token })).toMatchObject({ value: { state: 'unknown' } });
    expect(w.twitch.writes).toHaveLength(1);

    // Reconcile asks the transport about that one write and learns Twitch holds the countdown.
    w.advance(3_000);
    expect(await w.monarch({ op: 'reconcile', requestId: 'r1' })).toMatchObject({ value: { state: 'pending' } });
    expect(w.twitch.reconciles).toEqual([outboxId('r1', 'start')]);
    expect(w.twitch.writes).toHaveLength(1);
    const gathering = await w.oak({ op: 'gate' });
    expect(gathering).toMatchObject({ value: { open: { state: 'pending', countdownEndsAt: T0 + 2_000 + 90_000 } } });
    // People may still choose during the countdown.
    expect(await w.oak({ op: 'leave', requestId: 'r1' })).toMatchObject({ value: { joined: false, optedIn: 1 } });

    // Twitch's acceptance is not a departure: nothing has left, and no road exists yet.
    expect(action(w.repository)).toMatchObject({ state: 'pending', raid: null });
    expect(w.atlas.calls).toEqual([]);

    // The verified raid arrives, then arrives again (EventSub delivers at least once).
    w.advance(85_000);
    const raid = observed({ requestId: 'r1', at: w.clock() });
    expect(await w.app.ingestRaid(raid)).toEqual({ kind: 'landed', requestId: 'r1' });
    expect(await w.app.ingestRaid(raid)).toEqual({ kind: 'duplicate', requestId: 'r1' });
    w.restart();
    expect(await w.app.ingestRaid(raid)).toEqual({ kind: 'duplicate', requestId: 'r1' });

    const departed = await w.wren({ op: 'gate' });
    expect(departed).toMatchObject({ value: { open: { state: 'landed', joined: true, optedIn: 1, countdownEndsAt: null, raid: { id: raid.raid.id, viewers: 14 } } } });
    // Exactly one Twitch write, one landing, one road handed to the Atlas with its provenance intact.
    expect(w.twitch.writes).toHaveLength(1);
    expect(action(w.repository)).toMatchObject({ state: 'landed', raidEventId: 'evt-1' });
    expect(outbox(w.repository)).toMatchObject({ start: { state: 'settled', outcome: 'accepted' }, road: { state: 'settled', outcome: 'delivered', attempts: 1 } });
    expect([...w.atlas.roads.values()]).toEqual([raid.raid]);
    expect(w.atlas.roads.get(raid.raid.id)?.evidence).toEqual({ kind: 'simulated', asOf: raid.raid.observedAt, label: 'SIMULATED' });

    // Recovery after all this finds nothing to do, and a joined walker cannot join a party that already left.
    expect(await w.app.recover(w.clock(), 50)).toEqual({ reconciled: 0, sent: 0, lapsed: 0, delivered: 0, overdue: 0 });
    expect(await w.oak({ op: 'join', requestId: 'r1' })).toEqual({ kind: 'denied', code: 'stale' });
    expect(w.twitch.writes).toHaveLength(1);
  });

  it('turns the party back on a confirmed cancel, and keeps a raid that already left', async () => {
    const w = world();
    const token = await previewToken(await w.monarch({ op: 'preview', requestId: 'r1', target: MIRA }));
    await w.wren({ op: 'join', requestId: 'r1' });
    expect(await w.monarch({ op: 'start', requestId: 'r1', previewToken: token })).toMatchObject({ value: { state: 'pending' } });
    expect(await w.wren({ op: 'cancel', requestId: 'r1' })).toEqual({ kind: 'denied', code: 'unauthorized' });
    expect(await w.monarch({ op: 'cancel', requestId: 'r1' })).toMatchObject({ value: { state: 'cancelled' } });
    expect(await w.monarch({ op: 'cancel', requestId: 'r1' })).toMatchObject({ value: { state: 'cancelled' } });
    expect(w.twitch.writes.map(each => each.kind)).toEqual(['start', 'cancel']);
    expect(action(w.repository)).toMatchObject({ endReason: 'withdrawn' });
    expect(await w.wren({ op: 'gate' })).toMatchObject({ value: { open: { state: 'cancelled', joined: true } } });
    // A raid seen after Twitch confirmed the cancel is not this request's.
    expect(await w.app.ingestRaid(observed({ requestId: 'r1', at: w.clock() }))).toEqual({ kind: 'ignored', reason: 'settled' });
    // The monarch may call the realm again at once.
    expect(await w.monarch({ op: 'preview', requestId: 'r2', target: FERN })).toMatchObject({ kind: 'preview' });

    // Twitch held nothing to cancel: the raid may already have left, so the gate checks rather than turning back.
    const again = world();
    const second = await previewToken(await again.monarch({ op: 'preview', requestId: 'r1', target: MIRA }));
    await again.monarch({ op: 'start', requestId: 'r1', previewToken: second });
    again.twitch.answerCancel({ kind: 'rejected', code: 'no-pending-raid' });
    expect(await again.monarch({ op: 'cancel', requestId: 'r1' })).toMatchObject({ value: { state: 'unknown' } });
    expect(await again.app.ingestRaid(observed({ requestId: 'r1', at: again.clock() }))).toMatchObject({ kind: 'landed' });
  });
});

describe('Raid Gate departure guards', () => {
  it('refuses a walker, a crown or a foreign token before anything reaches Twitch', async () => {
    const w = world();
    const token = await previewToken(await w.monarch({ op: 'preview', requestId: 'r1', target: MIRA }));
    expect(await w.wren({ op: 'start', requestId: 'r1', previewToken: token })).toEqual({ kind: 'denied', code: 'unauthorized' });
    expect(await w.monarch({ op: 'start', requestId: 'r1', previewToken: 'preview999' })).toEqual({ kind: 'denied', code: 'stale' });
    // A rotated preview retires the old token.
    const fresh = await previewToken(await w.monarch({ op: 'preview', requestId: 'r1', target: MIRA }));
    expect(await w.monarch({ op: 'start', requestId: 'r1', previewToken: token })).toEqual({ kind: 'denied', code: 'stale' });
    // A lapsed preview cannot start.
    w.advance(120_000);
    expect(await w.monarch({ op: 'start', requestId: 'r1', previewToken: fresh })).toEqual({ kind: 'denied', code: 'stale' });
    expect(w.twitch.writes).toEqual([]);
  });

  it('lands only on a correlated raid for this pair, inside this request\'s window, from a trusted source', async () => {
    const w = world();
    const token = await previewToken(await w.monarch({ op: 'preview', requestId: 'r1', target: MIRA }));
    w.advance(1_000);
    const pressed = w.clock();
    await w.monarch({ op: 'start', requestId: 'r1', previewToken: token });
    w.advance(30_000);
    // Ambiguous: main could not tie it to a request, or it has no upstream identity.
    expect(await w.app.ingestRaid(observed({ requestId: null, at: w.clock() }))).toEqual({ kind: 'ignored', reason: 'uncorrelated' });
    expect(await w.app.ingestRaid(observed({ requestId: 'r1', eventId: null, at: w.clock() }))).toEqual({ kind: 'ignored', reason: 'uncorrelated' });
    // Another destination, or a same-pair raid from before the press.
    expect(await w.app.ingestRaid(observed({ requestId: 'r1', to: FERN, at: w.clock() }))).toEqual({ kind: 'ignored', reason: 'mismatch' });
    expect(await w.app.ingestRaid(observed({ requestId: 'r1', at: pressed - 3_600_000 }))).toEqual({ kind: 'ignored', reason: 'out-of-window' });
    expect(await w.app.ingestRaid(observed({ requestId: 'r1', at: pressed + 90_000 + 60_000 }))).toEqual({ kind: 'ignored', reason: 'out-of-window' });
    // A replayed recording is history, never a departure.
    const replay = observed({ requestId: 'r1', at: w.clock() });
    const replayed = { ...replay, raid: AtlasRaidSchema.parse({ ...replay.raid, evidence: { kind: 'replay', asOf: replay.raid.observedAt, recordingId: 'rec1' }, source: 'surveyor-recorder' }) };
    expect(await w.app.ingestRaid(replayed)).toEqual({ kind: 'ignored', reason: 'untrusted' });
    expect(await w.app.ingestRaid({ ...replay, actionRequestId: 'r1', extra: true } as TrustedRaidObservation)).toEqual({ kind: 'ignored', reason: 'invalid' });
    expect(action(w.repository)).toMatchObject({ state: 'pending', raid: null });
    expect(w.atlas.calls).toEqual([]);
    // A different event for a request that already landed is a conflict, not a second landing.
    expect(await w.app.ingestRaid(observed({ requestId: 'r1', at: w.clock() }))).toMatchObject({ kind: 'landed' });
    expect(await w.app.ingestRaid(observed({ requestId: 'r1', eventId: 'evt-2', at: w.clock() }))).toEqual({ kind: 'ignored', reason: 'conflict' });
  });

  it('records a refusal, and calls an unexplained countdown unknown rather than gone or landed', async () => {
    const w = world();
    w.twitch.refuseWith('target-not-accepting');
    const token = await previewToken(await w.monarch({ op: 'preview', requestId: 'r1', target: MIRA }));
    expect(await w.monarch({ op: 'start', requestId: 'r1', previewToken: token })).toMatchObject({ value: { state: 'rejected' } });
    expect(action(w.repository)).toMatchObject({ rejection: 'target-not-accepting' });
    expect(await w.wren({ op: 'gate' })).toMatchObject({ value: { open: { state: 'rejected' } } });

    const v = world();
    const second = await previewToken(await v.monarch({ op: 'preview', requestId: 'r1', target: MIRA }));
    await v.wren({ op: 'join', requestId: 'r1' });
    await v.monarch({ op: 'start', requestId: 'r1', previewToken: second });
    v.advance(90_000 + 60_000);
    // Viewers are told the truth at once; recovery writes it down.
    expect(await v.wren({ op: 'gate' })).toMatchObject({ value: { open: { state: 'unknown', countdownEndsAt: null, joined: true } } });
    expect(await v.app.recover(v.clock(), 50)).toMatchObject({ overdue: 1 });
    expect(action(v.repository)).toMatchObject({ state: 'unknown' });
    // Staying home is always possible; the party waits a while, then the gate is quiet, and nothing pretends to have left.
    expect(await v.wren({ op: 'leave', requestId: 'r1' })).toMatchObject({ value: { joined: false } });
    v.advance(15 * 60_000);
    expect(await v.wren({ op: 'gate' })).toMatchObject({ value: { open: null } });
    expect(await v.monarch({ op: 'preview', requestId: 'r2', target: FERN })).toMatchObject({ kind: 'preview' });
  });

  it('sends a start that provably never left, and only reconciles one that may have', async () => {
    const w = world();
    const token = await previewToken(await w.monarch({ op: 'preview', requestId: 'r1', target: MIRA }));
    // The press is recorded while no Twitch authority is bound (a process that crashed before claiming it).
    w.restart({ raids: false });
    expect(await w.monarch({ op: 'start', requestId: 'r1', previewToken: token })).toEqual({ kind: 'denied', code: 'unavailable' });
    expect(action(w.repository)).toMatchObject({ state: 'prepared' });
    // Simulate the crash window directly: the intent is stored, the claim never happened.
    const stored = action(w.repository)!;
    await w.repository.transaction(async tx => {
      await tx.putAction({ ...stored, revision: stored.revision + 1, state: 'dispatching', dispatchedAt: w.clock(), updatedAt: w.clock() }, stored.revision);
      await tx.putOutbox({ id: outboxId('r1', 'start'), revision: 1, requestId: 'r1', kind: 'start', state: 'queued', createdAt: w.clock(), claimedAt: null, settledAt: null, outcome: null, attempts: 0, origin: 'simulated' }, 0);
    }, new AbortController().signal);
    w.restart();
    expect(await w.app.recover(w.clock(), 50)).toMatchObject({ sent: 1 });
    expect(await w.app.recover(w.clock(), 50)).toMatchObject({ sent: 0, reconciled: 0 });
    expect(w.twitch.writes).toHaveLength(1);
    expect(action(w.repository)).toMatchObject({ state: 'pending' });

    // A claimed write whose answer never came is asked about until someone can tell, and never sent again.
    const v = world();
    const second = await previewToken(await v.monarch({ op: 'preview', requestId: 'r1', target: MIRA }));
    v.twitch.loseNextReply();
    await v.monarch({ op: 'start', requestId: 'r1', previewToken: second });
    v.twitch.ledger.clear();
    expect(await v.app.recover(v.clock(), 50)).toMatchObject({ reconciled: 0, sent: 0 });
    expect(v.twitch.writes).toHaveLength(1);
    expect(outbox(v.repository).start).toMatchObject({ state: 'claimed' });

    // An unsent start whose preview ran out is abandoned, and nothing reaches Twitch.
    const u = world();
    const third = await previewToken(await u.monarch({ op: 'preview', requestId: 'r1', target: MIRA }));
    const prepared = action(u.repository)!;
    await u.repository.transaction(async tx => {
      await tx.putAction({ ...prepared, revision: prepared.revision + 1, state: 'dispatching', dispatchedAt: u.clock(), updatedAt: u.clock() }, prepared.revision);
      await tx.putOutbox({ id: outboxId('r1', 'start'), revision: 1, requestId: 'r1', kind: 'start', state: 'queued', createdAt: u.clock(), claimedAt: null, settledAt: null, outcome: null, attempts: 0, origin: 'simulated' }, 0);
    }, new AbortController().signal);
    expect(third).toBeTruthy();
    u.advance(120_000);
    expect(await u.app.recover(u.clock(), 50)).toMatchObject({ lapsed: 1, sent: 0 });
    expect(u.twitch.writes).toEqual([]);
    expect(action(u.repository)).toMatchObject({ state: 'cancelled', endReason: 'expired' });
  });

  it('keeps a witnessed raid for the Atlas until its road ingestion takes it', async () => {
    const w = world();
    const token = await previewToken(await w.monarch({ op: 'preview', requestId: 'r1', target: MIRA }));
    await w.monarch({ op: 'start', requestId: 'r1', previewToken: token });
    w.atlas.fail(true);
    const raid = observed({ requestId: 'r1', at: w.clock() });
    expect(await w.app.ingestRaid(raid)).toMatchObject({ kind: 'landed' });
    expect(outbox(w.repository).road).toMatchObject({ state: 'claimed', attempts: 1 });
    w.atlas.fail(false);
    expect(await w.app.recover(w.clock(), 50)).toMatchObject({ delivered: 0 });
    w.advance(30_000);
    expect(await w.app.recover(w.clock(), 50)).toMatchObject({ delivered: 1 });
    expect([...w.atlas.roads.keys()]).toEqual([raid.raid.id]);
    expect(outbox(w.repository).road).toMatchObject({ state: 'settled', outcome: 'delivered', attempts: 2 });
  });

  it('refuses a live gate wired to a controlled transport', () => {
    const repository = createMemoryRaidGateRepository();
    const twitch = simulatedTwitch(() => T0);
    expect(() => createRaidGateApplication({
      repository, policy, origin: 'live', clock: () => T0, raids: twitch.transport,
      tokens: { issue: () => 'x', hash: async () => 'a'.repeat(64) },
    })).toThrow(/simulated/);
  });
});
