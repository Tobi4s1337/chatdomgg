import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createHearthHome } from '@chatdom/content';
import { PersonIdSchema, starterCitizenLook } from '@chatdom/shared';
import { WORLD_FIXTURE_KINGDOM as kingdomId, WORLD_FIXTURE_PERSON as personId } from '@chatdom/shared/world-fixtures';
import { REALM_CASTLE_SLOT, REALM_NO_HOME_SLOT, type KingdomForgeCommand, type RealmFact, type RealmHeraldChat, type RealmPrivateState, type RealmStoredOutcome, type RealmTransientMessage } from '@chatdom/shared/realm';
import { createRealmState } from '@chatdom/world/realm';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import type { ForgeProviders, JudgeVerdict } from '../../../codex/src/providers';
import { FORGE_JUDGE_POLICY_VERSION, FORGE_JUDGE_THRESHOLDS, forgeJudgeQuestions } from '../../../codex/src/providers/policy';
import { createDurableRealmServices, type DurableRepository, type RealmOutboxRow } from '../persistence';
import type { RealmOutboxStore } from '../outbox';
import { IngressGate, presenceTransition } from '../ingress';
import { FileForgeApprovals, ForgeWriteGate, forgeHomeDigest } from '../wiring';
import { RealmEveningBridge } from './bridge';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

function pass(image: boolean): JudgeVerdict {
  const base = { backend: 'codex-cli', status: 'complete', policy: FORGE_JUDGE_POLICY_VERSION, evidenceHash: (image ? 'b' : 'a').repeat(64) };
  return { outcome: 'pass', reason: 'SIMULATED controlled approval', records: [
    { ...base, judge: 'gpt-6-luna', model: 'gpt-6-luna', probabilitySource: 'model-self-estimate', thresholds: FORGE_JUDGE_THRESHOLDS,
      answers: Object.fromEntries(forgeJudgeQuestions(image).map(({ name }) => [name, 0.01])) },
    { ...base, judge: 'gpt-6.1-terra', model: 'gpt-6.1-terra', outcome: 'pass' },
  ] };
}

/** Controlled SIMULATED repository; the production bridge, coordinator, gates and registry run unchanged. */
async function fixture(royal = false) {
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
  const bridge = new RealmEveningBridge({ origin: 'simulated', ingress, gate, approvals: new FileForgeApprovals(directory), providers });
  const services = createDurableRealmServices({ repository, outbox, auth: { authenticate: async () => { throw new Error('No test entry'); }, current: async () => false },
    attach: kingdom => bridge.attach(kingdom), kingdom: () => ({ world: REFERENCE_WORLD, layoutRevision: home.layoutRevision, spawn: () => [0, 0, 6] }) });
  bridge.use(services);
  const hold = await services.retain(kingdomId); cleanups.push(() => hold.release()); cleanups.push(() => bridge.stop());
  vi.spyOn(hold.kingdom, 'databaseNow').mockReturnValue(now);
  const transient: RealmTransientMessage[] = [], delivered: unknown[] = [];
  hold.kingdom.bindTransient(message => transient.push(message), () => {});
  hold.kingdom.subscribe(message => delivered.push(message));
  return { bridge, command, providers, repository, state: () => state, facts, rows, transient, delivered, ingress, kingdom: hold.kingdom, castle };
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
  expect(f.kingdom.publicCheckpoint().current).toContainEqual(expect.objectContaining({ type: 'home', attachments: [expect.objectContaining({ slot: 7 })] }));
  const publicBytes = JSON.stringify([f.rows, f.transient, f.delivered]);
  expect(publicBytes).not.toContain(f.command.words); expect(publicBytes).not.toContain(f.command.messageId);
  expect(await f.bridge.run(f.command)).toEqual({ kind: 'already-committed' });
  expect(f.providers.judgeWords).toHaveBeenCalledTimes(1); expect(f.state().coals[personId]).toBe(0);
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
