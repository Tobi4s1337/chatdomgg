import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createHearthHome } from '@chatdom/content';
import { PersonIdSchema, type ForgeChatObservation, type KingdomId } from '@chatdom/shared';
import { WORLD_FIXTURE_KINGDOM as kingdomId } from '@chatdom/shared/world-fixtures';
import type { KingdomForgeCommand, RealmFact, RealmPrivateState, RealmStoredOutcome, RealmTransientMessage } from '@chatdom/shared/realm';
import { createRealmState } from '@chatdom/world/realm';
import { REFERENCE_WORLD } from '@chatdom/world/realm-reference';
import { createForgeProviders } from '../../../codex/src/providers';
import { forgeJudgeQuestions } from '../../../codex/src/providers/policy';
import { createDurableRealmServices, type DurableRepository, type RealmOutboxRow } from '../persistence';
import type { RealmOutboxStore } from '../outbox';
import { IngressGate, presenceTransition } from '../ingress';
import { FileForgeApprovals, ForgeWriteGate, forgeHomeDigest } from '../wiring';
import { RealmEveningBridge } from '../evening/bridge';
import { forgeQueueView } from './http';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close().catch(() => {}); });

type Stage = 'words' | 'drafting' | 'result' | 'commit';
const people = ['7001', '7002', '7003'].map(id => PersonIdSchema.parse(id));

/**
 * A durable world shared across "processes": the repository, outbox rows, approvals and the private wish line
 * outlive each bridge. Every process runs the production bridge, durable coordinator, gates and registry.
 */
async function world() {
  const now = Date.now(), blueprint = createHearthHome('house', 0), gate = new ForgeWriteGate();
  const guards = gate.install({ origin: 'simulated' as const }).guards;
  const homes = Object.fromEntries(people.map((ownerId, index) => {
    const id = `home-${index}`;
    return [id, { id, ownerId, slot: 7 + index, allocationReceipt: `deed-${index}`, layoutRevision: 'layout', revision: 'revision',
      digest: forgeHomeDigest(blueprint), family: 'hearth' as const, blueprint,
      attribution: { makerName: `Maker ${index + 1}`, kingdomName: 'Kingdom', approvalId: `names-${index}` }, attachments: {} }];
  }));
  let state: RealmPrivateState = { ...createRealmState(kingdomId, 'simulated'), homes, castle: null,
    coals: Object.fromEntries(people.map(id => [id, 1])),
    stream: { sessionId: 'night', startedAt: now - 600_000, liveUntil: now + 180_000 },
    rights: Object.fromEntries(people.map(id => [id, { revision: 1, forge: true, build: true, blocked: false, safetyIdentifier: `safety-identifier-${id}` }])) };
  const stream = presenceTransition({ service: 'herald', writerEpoch: 'writer', observation: {
    version: 1, kind: 'stream', origin: 'simulated', id: 'stream', kingdomId, observedAt: now - 1_000, live: true, sessionId: 'night' } })(state, null, now - 1_000);
  const observed = presenceTransition({ service: 'herald', writerEpoch: 'writer', observation: {
    version: 1, kind: 'observe', origin: 'simulated', id: 'chat:wishes', kingdomId, observedAt: now, source: 'chat', coverage: 'activity',
    people: people.map(personId => ({ personId, disclosure: 'anonymous' as const })) } })(state, stream.checkpoint, now);
  const rows: RealmOutboxRow[] = [], facts: RealmFact[] = [], receipts = new Map<string, RealmStoredOutcome>();
  /** Test hook around each durable command: may throw after the write lands (a lost reply). */
  let afterExecute: ((fact: RealmFact) => void) | undefined;
  const repository: DurableRepository = {
    leaseMs: 15_000, acquire: async () => ({ kingdomId, epoch: 'writer', expiresAt: Date.now() + 15_000 }),
    renew: async lease => ({ ...lease, expiresAt: Date.now() + 15_000 }), load: async () => state, committedState: () => state,
    execute: async (_lease, id, _command, decide, current) => {
      if (!current()) throw new Error('fenced');
      const prior = receipts.get(id);
      if (prior?.status === 'committed' || prior?.status === 'unchanged') return prior;
      const decision = decide(state, now);
      if (decision.kind !== 'accepted') return { status: decision.kind, reason: decision.reason };
      for (const guard of guards) await guard({} as Parameters<typeof guard>[0], decision.fact, state);
      state = decision.state; facts.push(decision.fact);
      for (const message of decision.public) rows.push({ id: rows.length + 1, sequence: state.sequence, eventId: `event-${rows.length}`,
        plotId: null, message });
      const result: RealmStoredOutcome = { status: 'committed', sequence: state.sequence, at: now };
      receipts.set(id, result);
      afterExecute?.(decision.fact);
      return result;
    },
    lookup: async (_id, commandId) => receipts.get(commandId) ?? null,
    snapshot: async () => state.sequence, release: async () => {}, loadIngress: async () => observed.checkpoint,
    executeIngress: async () => ({ status: 'unchanged', reason: 'unused' }),
  };
  const outbox: RealmOutboxStore = { open: async () => 0, prefix: async () => ({ homes: [],
    presence: { type: 'presence', frame: observed.presence }, sequence: 0, committed: 0 }),
    read: async (_id, after) => rows.filter(row => row.id > after), acknowledge: async () => {} };
  const directory = await mkdtemp(join(tmpdir(), 'chatdom-forge-line-')); cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const approvals = new FileForgeApprovals(join(directory, 'approvals'));
  const calls: Stage[] = [], observations: ForgeChatObservation[] = [];
  /** A stage that hangs until its process stops, so a "kill" lands exactly there. */
  let hangAt: Stage | undefined, reached: (() => void) | undefined, failAt: Stage | undefined;
  const hang = (stage: Stage, signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
    reached?.();
    signal?.addEventListener('abort', () => reject(new Error(`stopped during ${stage}`)), { once: true });
  });
  /** The production providers over a controlled Codex runner: every call is debited from the wish's ledger. */
  const runner = vi.fn(async ({ model, image, signal }: { model?: string; image?: string; signal: AbortSignal }) => {
    const stage: Stage = !model ? 'drafting' : image ? 'result' : 'words';
    calls.push(stage);
    if (hangAt === stage) return hang(stage, signal);
    if (failAt === stage) { failAt = undefined; throw new Error('The model process went away.'); }
    if (stage === 'drafting') return JSON.stringify({ draft: { plan: { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' },
      title: 'Dreamkeeper', plaque: 'Warm dreams above the hearth.' }, interpretation: 'as-wished', shared: 'subject' });
    return JSON.stringify({ answers: forgeJudgeQuestions(Boolean(image)).map(({ name }) => ({ type: 'predicate', name, probability: 0.01 })),
      subject: { motif: 'sleeping-dragon', slot: 'chimney' } });
  });
  const providers = createForgeProviders({ runCodex: runner });
  const command = (index: number, at = now): KingdomForgeCommand => ({ kingdomId, personId: people[index]!, messageId: `message-${index}`,
    observedAt: at, slot: 999, words: `PRIVATE sleeping dragon chimney ${index}` });

  /** One realm process over the shared durable world. */
  async function realm(options: { ritualMs?: number; revealMs?: number } = {}) {
    const ingress = { gate: new IngressGate({ herald: 'h'.repeat(32) }, 'simulated'), accept: vi.fn(async () => ({ http: 202 as const, body: { version: 1 as const, status: 'accepted' as const } })) };
    const bridge = new RealmEveningBridge({ origin: 'simulated', ingress, gate, approvals, providers,
      forgeChatObserver: async observation => { observations.push(observation); },
      forgeQueue: { directory: join(directory, 'line'), retryMs: 100, ritualMs: options.ritualMs ?? 0, revealMs: options.revealMs ?? 0 } });
    const services = createDurableRealmServices({ repository, outbox, auth: { authenticate: async () => { throw new Error('No entry'); }, current: async () => false },
      attach: kingdom => bridge.attach(kingdom), kingdom: () => ({ world: REFERENCE_WORLD, layoutRevision: 'layout', spawn: () => [0, 0, 6] }) });
    bridge.use(services);
    const hold = await services.retain(kingdomId);
    vi.spyOn(hold.kingdom, 'databaseNow').mockReturnValue(now);
    const transient: RealmTransientMessage[] = [];
    hold.kingdom.bindTransient(message => transient.push(message), () => {});
    const toOwner = vi.spyOn(hold.kingdom, 'toOwner');
    await bridge.start();
    let stopped = false;
    const stop = async () => { if (stopped) return; stopped = true; await bridge.stop(); await hold.release(); };
    cleanups.push(stop);
    const accept = (value: KingdomForgeCommand) => bridge.accept(`Bearer ${'h'.repeat(32)}`, { version: 1, forge: { type: 'wish', origin: 'simulated', command: value } });
    return { bridge, transient, toOwner, stop, accept, kingdom: hold.kingdom };
  }
  const committed = () => facts.filter(fact => fact.body.type === 'forge.commitApproved');
  const until = async (test: () => boolean, ms = 20_000) => {
    const end = Date.now() + ms;
    while (!test()) { if (Date.now() > end) throw new Error('timed out'); await new Promise(resolve => setTimeout(resolve, 20)); }
  };
  return { process: realm, command, state: () => state, facts, rows, committed, calls, observations, providers, directory, until,
    hangAt: (stage: Stage | undefined) => new Promise<void>(resolve => { hangAt = stage; reached = () => { reached = undefined; resolve(); }; }),
    release: () => { hangAt = undefined; reached = undefined; },
    failNext: (stage: Stage) => { failAt = stage; },
    loseNextCommitReply: () => { afterExecute = fact => { if (fact.body.type === 'forge.commitApproved') { afterExecute = undefined; throw new Error('lost reply'); } }; } };
}

const delivered = (w: Awaited<ReturnType<typeof world>>, messageId: string) => w.observations.filter(o => o.messageId === messageId && o.status === 'delivered');

it('accepts a wish only once it is written down, delivers it once, and acknowledges the private reply', async () => {
  const w = await world(), p = await w.process();
  expect(await p.accept(w.command(0))).toMatchObject({ http: 202 });
  await w.until(() => delivered(w, 'message-0').length > 0);
  expect(w.committed()).toHaveLength(1);
  expect(w.state().coals[people[0]!]).toBe(0);
  expect(p.toOwner).toHaveBeenCalledWith(people[0], expect.objectContaining({ type: 'receipt', receipt: expect.objectContaining({ status: 'committed' }) }));
  // A duplicate from Herald is the same wish: no second run, coal or reveal.
  expect(await p.accept(w.command(0))).toMatchObject({ http: 202 });
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(w.committed()).toHaveLength(1);
  expect(w.calls.filter(stage => stage === 'words')).toHaveLength(1);
  await p.stop();
  // After the wish ends, its words live only with the made piece: nothing in the line's files.
  const files = await readdir(join(w.directory, 'line'));
  for (const name of files.filter(name => name.startsWith('wish-'))) expect(await readFile(join(w.directory, 'line', name), 'utf8')).not.toContain('PRIVATE');
  const again = await w.process();
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(delivered(w, 'message-0')).toHaveLength(1);
  expect(w.committed()).toHaveLength(1);
  await again.stop();
});

it.each(['words', 'drafting', 'result'] as const)('a realm that dies during %s resumes the wish: one piece, at most one coal, one reveal', async stage => {
  const w = await world();
  const reached = w.hangAt(stage);
  const first = await w.process();
  expect(await first.accept(w.command(0))).toMatchObject({ http: 202 });
  await reached;
  await first.stop();
  expect(w.committed()).toHaveLength(0);
  w.release();
  const second = await w.process();
  await w.until(() => delivered(w, 'message-0').length > 0);
  expect(w.committed()).toHaveLength(1);
  expect(w.rows.filter(row => row.message.type === 'forge')).toHaveLength(1);
  expect(w.state().coals[people[0]!]).toBe(0);
  // The interrupted call stays spent; a resumed wish never exceeds its five-call ceiling.
  expect(w.calls.length).toBeLessThanOrEqual(5);
  await second.stop();
});

it('a realm that dies after the piece landed but before it heard so delivers that piece without forging again', async () => {
  const w = await world();
  w.loseNextCommitReply();
  const first = await w.process();
  expect(await first.accept(w.command(0))).toMatchObject({ http: 202 });
  await w.until(() => w.committed().length === 1);
  await first.stop();
  const callsBefore = w.calls.length;
  const second = await w.process();
  await w.until(() => delivered(w, 'message-0').length > 0);
  expect(w.committed()).toHaveLength(1);
  expect(w.rows.filter(row => row.message.type === 'forge')).toHaveLength(1);
  expect(w.state().coals[people[0]!]).toBe(0);
  expect(w.calls.length).toBe(callsBefore);
  await second.stop();
});

it('three wishes sent together all land, in order, and the room sees one ritual at a time', async () => {
  const w = await world(), p = await w.process({ ritualMs: 120, revealMs: 120 });
  for (const index of [0, 1, 2]) expect(await p.accept(w.command(index))).toMatchObject({ http: 202 });
  const line = forgeQueueView(p.bridge.line, kingdomId as KingdomId, people[2]!);
  expect(line).toMatchObject({ total: 3, waiting: 2, yours: { position: 2, state: 'waiting' } });
  expect(forgeQueueView(p.bridge.line, kingdomId as KingdomId, kingdomId).makers?.map(maker => maker.name)).toEqual(['Maker 1', 'Maker 2', 'Maker 3']);
  expect(JSON.stringify(forgeQueueView(p.bridge.line, kingdomId as KingdomId, kingdomId))).not.toContain('PRIVATE');
  await w.until(() => people.every((_, index) => delivered(w, `message-${index}`).length === 1), 30_000);
  const landings = w.committed().map(fact => (fact.body as { readonly ownerId?: string }).ownerId ?? JSON.stringify(fact.body));
  expect(w.committed()).toHaveLength(3);
  expect(people.every(id => w.state().coals[id] === 0)).toBe(true);
  // The order of landing follows the order of arrival.
  const order = people.map(id => landings.findIndex(entry => entry.includes(id)));
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  // Stage events never interleave: once an activity's ritual has begun, no other activity appears until it is done.
  const activities = p.transient.flatMap(message => message.type === 'forge' ? [message.event.activityId] : []);
  const runs = activities.filter((id, index) => index === 0 || activities[index - 1] !== id);
  expect(new Set(runs).size).toBe(runs.length);
  expect(forgeQueueView(p.bridge.line, kingdomId as KingdomId, null)).toMatchObject({ total: 0, waiting: 0, forgingSince: null });
  await p.stop();
});

it('a stream that goes offline stops a waiting wish privately, spends nothing and says why', async () => {
  const w = await world();
  const reached = w.hangAt('drafting');
  const p = await w.process();
  await p.accept(w.command(0));
  await reached;
  await p.bridge.observation(`Bearer ${'h'.repeat(32)}`, { version: 1, observation: { version: 1, kind: 'stream', origin: 'simulated', id: 'offline', kingdomId,
    observedAt: Date.now(), live: false, sessionId: null } });
  await w.until(() => w.observations.some(o => o.messageId === 'message-0' && o.status === 'canceled'));
  expect(w.observations.find(o => o.status === 'canceled')).toMatchObject({ message: expect.stringContaining('offline') });
  expect(w.committed()).toHaveLength(0);
  expect(w.state().coals[people[0]!]).toBe(1);
  w.release();
  await p.stop();
});

it('a model process that dies mid-call pauses the wish, which resumes on its own within its call ceiling', async () => {
  const w = await world();
  w.failNext('drafting');
  const p = await w.process();
  await p.accept(w.command(0));
  await w.until(() => delivered(w, 'message-0').length > 0);
  expect(w.committed()).toHaveLength(1);
  expect(w.state().coals[people[0]!]).toBe(1 - 1);
  // The lost drafting call stays spent: words, drafting (lost), drafting, result.
  expect(w.calls).toEqual(['words', 'drafting', 'drafting', 'result']);
  expect(w.observations.filter(o => o.messageId === 'message-0' && o.status !== 'working').map(o => o.status)).toEqual(['delivered']);
  await p.stop();
});
