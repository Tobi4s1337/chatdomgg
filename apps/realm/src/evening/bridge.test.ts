import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createHearthHome } from '@chatdom/content';
import { PersonIdSchema, starterCitizenLook, type ForgeChatObserver } from '@chatdom/shared';
import { WORLD_FIXTURE_KINGDOM as kingdomId, WORLD_FIXTURE_PERSON as personId } from '@chatdom/shared/world-fixtures';
import { REALM_CASTLE_SLOT, REALM_NO_HOME_SLOT, type KingdomForgeCommand, type RealmFact, type RealmHeraldChat, type RealmPrivateState, type RealmStoredOutcome, type RealmTransientMessage } from '@chatdom/shared/realm';
import { createRealmState } from '@chatdom/world/realm';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import type { ForgeProviders, JudgeVerdict } from '../../../codex/src/providers';
import { FORGE_JUDGE_POLICY_VERSION, FORGE_JUDGE_THRESHOLDS, combineForgeWishSubject, forgeJudgeQuestions,
  type ForgeWishSubject } from '../../../codex/src/providers/policy';
import { createDurableRealmServices, type DurableRepository, type RealmOutboxRow } from '../persistence';
import type { RealmOutboxStore } from '../outbox';
import { IngressGate, presenceTransition } from '../ingress';
import { FileForgeApprovals, ForgeWriteGate, forgeHomeDigest } from '../wiring';
import { RealmEveningBridge } from './bridge';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

/** Both gates read the words' catalogue subject; the host scores quality from those readings and the plan. */
function pass(image: boolean, subject: ForgeWishSubject = { motif: 'sleeping-dragon', slot: 'chimney' }): JudgeVerdict {
  const base = { backend: 'codex-cli', status: 'complete', policy: FORGE_JUDGE_POLICY_VERSION, evidenceHash: (image ? 'b' : 'a').repeat(64),
    subject, subjectStatus: 'complete' };
  return { outcome: 'pass', reason: 'controlled approval', subject: combineForgeWishSubject(subject, subject), records: [
    { ...base, judge: 'gpt-6-luna', model: 'gpt-6-luna', probabilitySource: 'model-self-estimate', thresholds: FORGE_JUDGE_THRESHOLDS,
      answers: Object.fromEntries(forgeJudgeQuestions(image).map(({ name }) => [name, 0.01])) },
    { ...base, judge: 'gpt-6.1-terra', model: 'gpt-6.1-terra', outcome: 'pass' },
  ] };
}

/** Controlled SIMULATED repository; the production bridge, coordinator, gates and registry run unchanged. */
async function fixture(royal = false, { writerHold, ...options }: { forgeChatObserver?: ForgeChatObserver; evidenceWaitMs?: number; writerHold?: () => string | null } = {}) {
  const now = Date.now(), blueprint = createHearthHome('house', 0), gate = new ForgeWriteGate();
  const ownerId = royal ? PersonIdSchema.parse(kingdomId) : personId;
  const guards = gate.install({ origin: 'simulated' as const }).guards;
  const home = { id: 'simulated-home', ownerId, slot: 7, allocationReceipt: 'simulated-deed', layoutRevision: 'simulated-layout',
    revision: 'simulated-revision', digest: forgeHomeDigest(blueprint), family: 'hearth' as const, blueprint,
    attribution: { makerName: 'SIMULATED maker', kingdomName: 'SIMULATED kingdom', approvalId: 'simulated-names' }, attachments: {} };
  const castle = { id: 'castle:simulated-keep', moduleId: 'simulated-keep', ownerId,
    slot: REALM_CASTLE_SLOT, layoutRevision: home.layoutRevision, revision: home.revision, digest: home.digest,
    family: home.family, blueprint, attribution: home.attribution, attachments: {} };
  let state: RealmPrivateState = { ...createRealmState(kingdomId, 'simulated'), homes: royal ? {} : { [home.id]: home },
    castle: royal ? castle : null, coals: royal ? {} : { [ownerId]: 1 },
    stream: royal ? { sessionId: null, startedAt: 0, liveUntil: 0 } : { sessionId: 'simulated-night', startedAt: now - 600_000, liveUntil: now + 180_000 },
    rights: { [ownerId]: { revision: 1, forge: true, build: true, blocked: false, safetyIdentifier: 'simulated-safety-identifier' } } };
  const command: KingdomForgeCommand = { kingdomId, personId: ownerId, messageId: 'simulated-message', observedAt: now, slot: 999,
    words: 'PRIVATE SIMULATED sleeping dragon chimney' };
  const stream = presenceTransition({ service: 'herald', writerEpoch: 'simulated-writer', observation: {
    version: 1, kind: 'stream', origin: 'simulated', id: 'simulated-stream', kingdomId, observedAt: now - 1_000,
    live: !royal, sessionId: royal ? null : 'simulated-night',
  } })(state, null, now - 1_000);
  const observed = presenceTransition({ service: 'herald', writerEpoch: 'simulated-writer', observation: {
    version: 1, kind: 'observe', origin: 'simulated', id: 'chat:simulated-message', kingdomId, observedAt: now,
    source: 'chat', coverage: 'activity', people: [royal
      ? { personId: ownerId, disclosure: 'named', displayName: 'SIMULATED Monarch' }
      : { personId: ownerId, disclosure: 'anonymous' }],
  } })(state, stream.checkpoint, now);
  const checkpoint = observed.checkpoint;
  const rows: RealmOutboxRow[] = [], facts: RealmFact[] = [], receipts = new Map<string, RealmStoredOutcome>();
  const repository: DurableRepository = {
    leaseMs: 15_000, acquire: vi.fn(async () => ({ kingdomId, epoch: 'simulated-writer', expiresAt: Date.now() + 15_000 })),
    renew: async lease => ({ ...lease, expiresAt: Date.now() + 15_000 }), load: async () => state, committedState: () => state,
    execute: async (_lease, id, _command, decide, current) => {
      if (!current()) throw new Error('SIMULATED fenced');
      const prior = receipts.get(id);
      if (prior?.status === 'committed' || prior?.status === 'unchanged') return prior;
      const decision = decide(state, now);
      if (decision.kind !== 'accepted') return { status: decision.kind, reason: decision.reason };
      for (const guard of guards) await guard({} as Parameters<typeof guard>[0], decision.fact, state);
      state = decision.state; facts.push(decision.fact);
      for (const message of decision.public) rows.push({ id: rows.length + 1, sequence: state.sequence, eventId: `simulated-event-${rows.length}`,
        plotId: message.type === 'forge' ? home.id : null, message });
      const result: RealmStoredOutcome = { status: 'committed', sequence: state.sequence, at: now };
      receipts.set(id, result); return result;
    },
    lookup: async (_id, commandId) => receipts.get(commandId) ?? null,
    snapshot: async () => state.sequence, release: async () => {}, loadIngress: async () => checkpoint,
    executeIngress: async () => ({ status: 'unchanged', reason: 'unused' }),
  };
  const outbox: RealmOutboxStore = { open: async () => 0, prefix: async () => ({ homes: [],
    presence: { type: 'presence', frame: observed.presence }, sequence: 0, committed: 0 }),
    read: async (_id, after) => rows.filter(row => row.id > after), acknowledge: async () => {} };
  const directory = await mkdtemp(join(tmpdir(), 'chatdom-evening-')); cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const providers: ForgeProviders = { judgeWords: vi.fn(async () => pass(false)), judgeResult: vi.fn(async () => pass(true)),
    draft: vi.fn(async () => ({ plan: { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' } as const,
      title: 'SIMULATED Dreamkeeper', plaque: 'SIMULATED warm dreams above the hearth.' })) };
  const ingress = { gate: new IngressGate({ herald: 'h'.repeat(32) }, 'simulated'), accept: vi.fn(async () => ({ http: 202 as const, body: { version: 1 as const, status: 'accepted' as const } })) };
  const bridge = new RealmEveningBridge({ origin: 'simulated', ingress, gate, approvals: new FileForgeApprovals(directory), providers, ...options });
  const services = createDurableRealmServices({ repository, outbox, ...(writerHold ? { hold: writerHold } : {}), auth: { authenticate: async () => { throw new Error('No test entry'); }, current: async () => false },
    attach: kingdom => bridge.attach(kingdom), kingdom: () => ({ world: REFERENCE_WORLD, layoutRevision: home.layoutRevision, spawn: () => [0, 0, 6] }) });
  bridge.use(services);
  const hold = await services.retain(kingdomId); cleanups.push(() => hold.release()); cleanups.push(() => bridge.stop());
  vi.spyOn(hold.kingdom, 'databaseNow').mockReturnValue(now);
  const transient: RealmTransientMessage[] = [], delivered: unknown[] = [];
  hold.kingdom.bindTransient(message => transient.push(message), () => {});
  hold.kingdom.subscribe(message => delivered.push(message));
  const privateReply = vi.spyOn(hold.kingdom, 'toOwner');
  return { bridge, command, providers, repository, state: () => state, facts, rows, transient, delivered, ingress, kingdom: hold.kingdom, castle, privateReply };
}

it('uses one held writer and real coordinator; stages are transient, audited attachments survive in the durable outbox, and retries never spend twice', async () => {
  const f = await fixture();
  const outcome = await f.bridge.run(f.command);
  expect(outcome).toMatchObject({ kind: 'committed', attachment: { slot: 7, provenance: { source: 'simulated' } } });
  expect(f.repository.acquire).toHaveBeenCalledTimes(1);
  expect(f.state().coals[personId]).toBe(0);
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(1);
  expect(f.transient.length).toBeGreaterThan(0);
  expect(f.transient.every(message => message.type === 'forge' && message.event.type === 'stage')).toBe(true);
  expect(f.rows).toHaveLength(1);
  expect(f.rows[0]?.message).toMatchObject({ type: 'forge', event: { type: 'committed' } });
  const firstStage = f.transient.find(message => message.type === 'forge');
  expect(firstStage?.type).toBe('forge');
  if (firstStage?.type === 'forge') expect(f.rows[0]?.message).toMatchObject({ type: 'forge', event: { activityId: firstStage.event.activityId } });
  expect(f.delivered).toHaveLength(1);
  expect(f.privateReply).toHaveBeenCalledExactlyOnceWith(personId, expect.objectContaining({ type: 'receipt', receipt: expect.objectContaining({ status: 'committed', message: expect.stringContaining('Your home now carries') }) }));
  expect(f.kingdom.publicCheckpoint().current).toContainEqual(expect.objectContaining({ type: 'home', attachments: [expect.objectContaining({ slot: 7 })] }));
  const publicBytes = JSON.stringify([f.rows, f.transient, f.delivered]);
  expect(publicBytes).not.toContain(f.command.words); expect(publicBytes).not.toContain(f.command.messageId);
  expect(await f.bridge.run(f.command)).toEqual({ kind: 'already-committed' });
  expect(f.providers.judgeWords).toHaveBeenCalledTimes(1); expect(f.state().coals[personId]).toBe(0);
  expect(f.privateReply).toHaveBeenCalledTimes(1);
});

it('asks the writer again when it turned an approved commit away unstarted, and lands the piece for one coal', async () => {
  // While the writer lands another maker's piece, a queued commit can be refused before it starts (nothing written).
  let busy: string | null = null;
  const f = await fixture(false, { writerHold: () => busy });
  vi.mocked(f.providers.judgeResult).mockImplementation(async () => {
    busy = 'SIMULATED writer landing another piece';
    setTimeout(() => { busy = null; }, 400);
    return pass(true);
  });
  expect(await f.bridge.run(f.command)).toMatchObject({ kind: 'committed' });
  expect(f.kingdom.commands.refused.held).toBeGreaterThan(0);
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(1);
  expect(f.facts.some(fact => fact.body.type === 'forge.release')).toBe(false);
  expect(f.state().coals[personId]).toBe(0);
  expect(f.privateReply).toHaveBeenCalledExactlyOnceWith(personId, expect.objectContaining({ receipt: expect.objectContaining({ status: 'committed' }) }));
});

it('sends the closest-shape explanation only to the maker after a real durable commit', async () => {
  const f = await fixture();
  const draft = await f.providers.draft({ words: f.command.words, family: 'hearth', availableSockets: [] });
  f.providers.draftCandidate = vi.fn(async () => ({ draft, interpretation: 'closest' as const, shared: 'family' as const }));
  // Both gates agree the words name no catalogue subject: the closest piece is final and softened for vocabulary.
  const unsupported = { motif: 'none', slot: 'chimney' } as const;
  vi.mocked(f.providers.judgeWords).mockImplementation(async () => pass(false, unsupported));
  vi.mocked(f.providers.judgeResult).mockImplementation(async () => pass(true, unsupported));
  expect(await f.bridge.run(f.command)).toMatchObject({ kind: 'committed' });
  expect(f.providers.judgeResult).toHaveBeenCalledOnce();
  expect(f.privateReply).toHaveBeenCalledWith(personId, expect.objectContaining({ receipt: expect.objectContaining({ status: 'committed', message: expect.stringMatching(/^The closest I can make .*beyond my kit\. It keeps the same family of shapes\.$/) }) }));
  expect(JSON.stringify([f.rows, f.transient, f.delivered])).not.toContain('closest');
  expect(f.state().coals[personId]).toBe(0);
});

it('waits for accepted online/chat ingress to drain before deciding whether the fire is out', async () => {
  const f = await fixture(), live = f.kingdom.privateState;
  const state = vi.spyOn(f.kingdom, 'privateState', 'get').mockReturnValue(
    { ...live, stream: { sessionId: null, startedAt: 0, liveUntil: 0 } });
  const loadIngress = f.kingdom.loadIngress.bind(f.kingdom);
  vi.spyOn(f.kingdom, 'loadIngress').mockImplementation(async () => {
    const committed = await loadIngress(); state.mockRestore(); return committed;
  });
  expect(await f.bridge.run(f.command)).toMatchObject({ kind: 'committed' });
  expect(f.kingdom.loadIngress).toHaveBeenCalled();
  expect(f.privateReply).toHaveBeenCalledExactlyOnceWith(personId, expect.objectContaining({ receipt: expect.objectContaining({ status: 'committed' }) }));
  expect(f.state().coals[personId]).toBe(0);
});

it('lets a wish wait while a busy writer has not yet committed its chat witness, and names the cause when it never does', async () => {
  // Each look at the ingress checkpoint costs the writer several seconds of (simulated) clock, as a scene rebuild does.
  let clock = 0;
  const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
  try {
    const late = await fixture(), loadIngress = late.kingdom.loadIngress.bind(late.kingdom);
    let looks = 0;
    // Three empty looks cost six seconds: longer than the old five-second bound, well inside the writer's lease.
    vi.spyOn(late.kingdom, 'loadIngress').mockImplementation(async () => { clock += 2_000; return ++looks <= 3 ? null : loadIngress(); });
    expect(await late.bridge.run(late.command)).toMatchObject({ kind: 'committed' });
    expect(looks).toBeGreaterThan(3);

    now.mockRestore();
    const never = await fixture(false, { evidenceWaitMs: 200 });
    vi.spyOn(never.kingdom, 'loadIngress').mockImplementation(async () => null);
    expect(await never.bridge.run(never.command)).toMatchObject({ kind: 'cold', privateMessage: expect.stringContaining('could not hear your wish in chat') });
    expect(never.privateReply).toHaveBeenCalledExactlyOnceWith(personId, expect.objectContaining({ receipt: expect.objectContaining({ status: 'unavailable',
      message: expect.stringContaining('Nothing was spent') }) }));
    expect(never.providers.judgeWords).not.toHaveBeenCalled();
    expect(never.state().coals[personId]).toBe(1);
  } finally { now.mockRestore(); }
});

it('explains a fresh offline wish privately without a model call or coal spent', async () => {
  const f = await fixture(true);
  expect(await f.bridge.run(f.command)).toMatchObject({ kind: 'cold', privateMessage: expect.stringContaining('stream is offline') });
  expect(f.privateReply).toHaveBeenCalledExactlyOnceWith(f.command.personId, expect.objectContaining({ receipt: expect.objectContaining({ status: 'unavailable', message: expect.stringContaining('stream is offline') }) }));
  expect(f.providers.judgeWords).not.toHaveBeenCalled(); expect(f.providers.draft).not.toHaveBeenCalled();
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toEqual([]);
  expect(f.transient).toEqual([]); expect(f.rows).toEqual([]);
  expect(f.state().coals[f.command.personId] ?? 0).toBe(0);
});

it('revokes pending provider work on authenticated cleanup and keeps unauthenticated cleanup from canceling it', async () => {
  const f = await fixture();
  let started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  vi.mocked(f.providers.judgeWords).mockImplementation(async ({ signal }) => { started(); await new Promise<void>((resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('SIMULATED canceled')), { once: true })); return pass(false); });
  const running = f.bridge.run(f.command); await waiting;
  const body = { version: 1, observation: { version: 1, kind: 'source-lost', id: 'simulated-loss', kingdomId, observedAt: f.command.observedAt,
    origin: 'simulated', sources: ['chat'], reason: 'unavailable' } };
  await f.bridge.observation('Bearer incorrect', body);
  expect(f.state().reservations).not.toEqual({});
  await f.bridge.observation(`Bearer ${'h'.repeat(32)}`, body);
  expect(await running).toEqual({ kind: 'canceled' });
  expect(f.state().coals[personId]).toBe(1); expect(f.state().reservations).toEqual({});
  expect(f.rows).toHaveLength(0);
  const stage = f.transient[0];
  expect(stage).toMatchObject({ type: 'forge', event: { type: 'stage', stage: 'judging-words' } });
  expect(f.transient.at(-1)).toEqual({ type: 'forge', event: {
    type: 'ended', activityId: stage?.type === 'forge' ? stage.event.activityId : undefined,
  } });
  const publicBytes = JSON.stringify(f.transient);
  for (const privateValue of [f.command.words, f.command.messageId, 'personId', 'source-lost', 'unavailable', 'canceled']) {
    expect(publicBytes).not.toContain(privateValue);
  }
});

it('authenticates private Herald speech, maps the actual owned slot, hashes public IDs, and removes speech without storing text', async () => {
  const f = await fixture(), authorization = `Bearer ${'h'.repeat(32)}`;
  const chat = { version: 1, id: 'private-original-message', kingdomId, personId, origin: 'simulated',
    asOf: f.command.observedAt, expiresAt: f.command.observedAt + 5_000, parts: [{ kind: 'text', text: 'SIMULATED hello' }] };
  expect(await f.bridge.accept('Bearer wrong-key', { version: 1, chat })).toMatchObject({ http: 401 });
  expect(await f.bridge.accept(authorization, { version: 1, chat: { ...chat, origin: 'live' } })).toMatchObject({ http: 403 });
  const committed = f.kingdom.publicCheckpoint();
  const firstFrame = vi.spyOn(f.kingdom, 'publicCheckpoint').mockReturnValue({ ...committed, current: [] });
  const firstSpeech = f.bridge.accept(authorization, { version: 1, chat });
  expect(f.transient).toHaveLength(0);
  firstFrame.mockRestore();
  expect(await firstSpeech).toMatchObject({ http: 202, body: { status: 'relayed' } });
  const cue = f.transient.at(-1);
  expect(cue).toMatchObject({ type: 'chat', cue: { slot: 7, epoch: `realm:${kingdomId}`, id: expect.stringMatching(/^speech:[a-f0-9]{64}$/) } });
  expect(JSON.stringify(cue)).not.toContain(chat.id); expect(JSON.stringify(cue)).not.toContain('personId');
  expect(f.rows).toHaveLength(0); expect(f.facts).toHaveLength(0);
  expect(await f.bridge.accept(authorization, { version: 1, chat })).toMatchObject({ body: { status: 'absent' } });
  expect(f.transient).toHaveLength(1);
  await f.bridge.accept(authorization, { version: 1, chatCleanup: { type: 'remove', origin: 'simulated', kingdomId, messageIds: [chat.id] } });
  expect(f.transient.at(-1)).toEqual({ type: 'chat.remove', cueIds: [cue?.type === 'chat' ? cue.cue.id : 'missing'] });
  expect(await f.bridge.accept(authorization, { version: 1, chat })).toMatchObject({ body: { status: 'absent' } });
  await f.bridge.accept(authorization, { version: 1, chatCleanup: { type: 'clear', origin: 'simulated', kingdomId, personId } });
  expect(await f.bridge.accept(authorization, { version: 1, chat: { ...chat, id: 'simulated-reordered-message' } })).toMatchObject({ body: { status: 'absent' } });
  expect(f.rows).toHaveLength(0);
});

it('runs the observation prerequisite only after Herald admission and leaves failed prerequisites retryable', async () => {
  const f = await fixture(), beforeObservation = vi.fn(async () => { throw new Error('SIMULATED prerequisite unavailable'); });
  const bridge = new RealmEveningBridge({ ...f.bridge.options, beforeObservation });
  const body = { version: 1, observation: { version: 1, kind: 'observe', id: 'chat:simulated-prerequisite', kingdomId, observedAt: f.command.observedAt,
    origin: 'simulated', source: 'chat', coverage: 'activity', people: [{ personId, disclosure: 'anonymous' }] } };
  await bridge.observation('Bearer incorrect', body);
  expect(beforeObservation).not.toHaveBeenCalled();
  f.ingress.accept.mockClear();
  expect(await bridge.observation(`Bearer ${'h'.repeat(32)}`, body)).toMatchObject({ http: 503, body: { status: 'unavailable' } });
  expect(beforeObservation).toHaveBeenCalledOnce();
  expect(f.ingress.accept).not.toHaveBeenCalled();
});

it('links the actual monarch walker and offline named chat to the owned keep, with ordinary moderation and no street deed or coal (SIMULATED)', async () => {
  const f = await fixture(true), monarch = f.command.personId, now = f.command.observedAt;
  const presentWalker = vi.fn(), placeWalker = vi.fn(() => true), allowWalking = vi.fn();
  const detach = f.kingdom.bindRoom({ close: vi.fn(), readWalker: () => null, placeWalker, allowWalking, presentWalker, adoptWorld: vi.fn() });
  cleanups.push(async () => detach());
  const principal = { kingdomId, personId: monarch, origin: 'simulated' as const, sessionId: 'SIMULATED-royal-session',
    expiresAt: now + 60_000, publicName: 'SIMULATED Monarch', look: 'neutral' };
  f.kingdom.lifecycle('join', principal, 'SIMULATED-royal-walker', now);
  expect(presentWalker).toHaveBeenLastCalledWith('SIMULATED-royal-walker', { homeSlot: REALM_CASTLE_SLOT, look: starterCitizenLook(monarch) });
  f.kingdom.lifecycle('join', { ...principal, personId }, 'SIMULATED-visitor-walker', now);
  expect(presentWalker).toHaveBeenLastCalledWith('SIMULATED-visitor-walker', { homeSlot: REALM_NO_HOME_SLOT, look: starterCitizenLook(personId) });
  expect(placeWalker).not.toHaveBeenCalled(); expect(allowWalking).not.toHaveBeenCalled();
  const frame = f.kingdom.publicCheckpoint().current.find(message => message.type === 'presence')?.frame;
  expect(frame).toMatchObject({ streamLive: false, connection: 'offline', windows: [
    { slot: REALM_CASTLE_SLOT, present: true, publicName: 'SIMULATED Monarch' },
  ] });
  const chat: RealmHeraldChat = { version: 1, id: 'SIMULATED-royal-chat', kingdomId, personId: monarch, origin: 'simulated',
    asOf: now, expiresAt: now + 5_000, parts: [{ kind: 'text', text: 'SIMULATED royal hello' }] };
  const authorization = `Bearer ${'h'.repeat(32)}`;
  expect(await f.bridge.accept(authorization, { version: 1, chat })).toMatchObject({ body: { status: 'relayed' } });
  const cue = f.transient.at(-1);
  expect(cue).toMatchObject({ type: 'chat', cue: { slot: REALM_CASTLE_SLOT, origin: 'simulated' } });
  expect(f.bridge.speech(personId, { ...chat, id: 'SIMULATED-unowned-cue', epoch: `realm:${kingdomId}`, slot: REALM_CASTLE_SLOT })).toBe(false);
  await f.bridge.accept(authorization, { version: 1, chatCleanup: { type: 'clear', origin: 'simulated', kingdomId, personId: monarch } });
  expect(f.transient.at(-1)).toEqual({ type: 'chat.remove', cueIds: [cue?.type === 'chat' ? cue.cue.id : 'missing'] });
  expect(f.bridge.chat({ ...chat, id: 'SIMULATED-hidden-royal-chat', origin: 'simulated', version: 1, parts: [{ kind: 'text', text: 'SIMULATED hidden' }] })).toBe(false);
  expect(f.state().homes).toEqual({}); expect(f.state().coals).toEqual({});
  expect(f.facts).toEqual([]); expect(f.rows).toEqual([]);
});


it('observes witnessed work before judging and delivery only from the actual committed attachment', async () => {
  const observations: Parameters<ForgeChatObserver>[0][] = [];
  const observer = vi.fn<ForgeChatObserver>(async observation => { observations.push(observation); });
  const f = await fixture(false, { forgeChatObserver: observer });
  vi.mocked(f.providers.judgeWords).mockImplementation(async () => {
    expect(observations.map(item => item.status)).toEqual(['working']);
    return pass(false);
  });
  const outcome = await f.bridge.run(f.command);
  expect(outcome.kind).toBe('committed');
  if (outcome.kind !== 'committed') throw new Error('Expected a real committed attachment');
  expect(observations).toEqual([
    expect.objectContaining({ origin: 'simulated', kingdomId, personId, messageId: f.command.messageId, status: 'working', at: expect.any(Number) }),
    expect.objectContaining({ origin: 'simulated', kingdomId, personId, messageId: f.command.messageId, status: 'delivered',
      attachmentId: outcome.attachment.id, committedAt: outcome.attachment.committedAt, at: expect.any(Number) }),
  ]);
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(1);
  const bytes = JSON.stringify([observations, f.rows, f.transient, f.delivered]);
  for (const value of [f.command.words, 'simulated-safety-identifier', 'controlled approval', 'codex-cli', 'gpt-6-luna']) expect(bytes).not.toContain(value);
  expect(await f.bridge.run(f.command)).toEqual({ kind: 'already-committed' });
  expect(observations.filter(item => item.status === 'delivered')).toHaveLength(1);
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(1);
});

it('tells the maker a landed piece was delivered even when the commit reply is lost', async () => {
  const observations: Parameters<ForgeChatObserver>[0][] = [];
  const f = await fixture(false, { forgeChatObserver: async observation => { observations.push(observation); } });
  const execute = f.repository.execute;
  let lost = 0;
  f.repository.execute = async (lease, id, command, decide, current) => {
    let committing = false;
    const result = await execute(lease, id, command, (state, at) => {
      const decision = decide(state, at);
      if (decision.kind === 'accepted' && decision.fact.body.type === 'forge.commitApproved') committing = true;
      return decision;
    }, current);
    // The durable transaction applied; only its answer is lost on the way back.
    if (committing && !lost++) throw new Error('SIMULATED lost commit reply');
    return result;
  };
  const outcome = await f.bridge.run(f.command);
  expect(lost).toBe(1);
  expect(outcome).toMatchObject({ kind: 'committed', published: false, privateMessage: expect.stringContaining('Your home now carries') });
  expect(observations.map(item => item.status)).toEqual(['working', 'delivered']);
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(1);
  expect(f.state().coals[personId]).toBe(0);
  expect(f.privateReply).toHaveBeenCalledExactlyOnceWith(personId, expect.objectContaining({ receipt: expect.objectContaining({ status: 'committed' }) }));
  expect(JSON.stringify(observations)).not.toContain('unchanged');
});

it('reports an offline witnessed wish as cold with the real private reason and no working or delivery', async () => {
  const observer = vi.fn<ForgeChatObserver>(async () => {});
  const f = await fixture(true, { forgeChatObserver: observer });
  const result = await f.bridge.run(f.command);
  expect(result).toMatchObject({ kind: 'cold', privateMessage: expect.stringContaining('stream is offline') });
  expect(observer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'cold', kingdomId,
    personId: f.command.personId, messageId: f.command.messageId, message: expect.stringContaining('stream is offline') }));
  expect(f.providers.judgeWords).not.toHaveBeenCalled();
  expect(f.rows).toEqual([]);
});

it('isolates observer failures from the real commit and cannot repeat the authority on retry', async () => {
  const observer = vi.fn<ForgeChatObserver>(async () => { throw new Error('SIMULATED observer failure'); });
  const f = await fixture(false, { forgeChatObserver: observer });
  expect(await f.bridge.run(f.command)).toMatchObject({ kind: 'committed' });
  expect(observer.mock.calls.map(([item]) => item.status)).toEqual(['working', 'delivered']);
  expect(f.rows).toHaveLength(1);
  expect(f.state().coals[personId]).toBe(0);
  expect(f.privateReply).toHaveBeenCalledExactlyOnceWith(personId, expect.objectContaining({ receipt: expect.objectContaining({ status: 'committed' }) }));
  expect(await f.bridge.run(f.command)).toEqual({ kind: 'already-committed' });
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toHaveLength(1);
  expect(f.providers.judgeWords).toHaveBeenCalledOnce();
  expect(observer.mock.calls.filter(([item]) => item.status === 'delivered')).toHaveLength(1);
});

it('reports authenticated cancellation without claiming a delivery', async () => {
  const observer = vi.fn<ForgeChatObserver>(async () => {});
  const f = await fixture(false, { forgeChatObserver: observer });
  let started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  vi.mocked(f.providers.judgeWords).mockImplementation(async ({ signal }) => {
    started();
    await new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('SIMULATED canceled')), { once: true }));
    return pass(false);
  });
  const running = f.bridge.run(f.command); await waiting;
  f.bridge.cancel(kingdomId, { messageId: f.command.messageId });
  expect(await running).toEqual({ kind: 'canceled' });
  expect(observer.mock.calls.map(([item]) => item.status)).toEqual(['working', 'canceled']);
  expect(observer).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'canceled', message: expect.any(String), messageId: f.command.messageId }));
  expect(f.rows).toEqual([]); expect(f.state().coals[personId]).toBe(1);
});

it('reports a wish deleted before arrival as canceled without starting Forge work', async () => {
  const observer = vi.fn<ForgeChatObserver>(async () => {});
  const f = await fixture(false, { forgeChatObserver: observer });
  f.bridge.cancel(kingdomId, { messageId: f.command.messageId });
  expect(await f.bridge.run(f.command)).toEqual({ kind: 'canceled' });
  expect(observer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ origin: 'simulated', kingdomId,
    personId, messageId: f.command.messageId, status: 'canceled', message: expect.stringContaining('stopped') }));
  expect(f.providers.judgeWords).not.toHaveBeenCalled();
  expect(f.providers.draft).not.toHaveBeenCalled();
  expect(f.facts.filter(fact => fact.body.type === 'forge.commitApproved')).toEqual([]);
  expect(f.rows).toEqual([]);
  expect(f.state().coals[personId]).toBe(1);
});
