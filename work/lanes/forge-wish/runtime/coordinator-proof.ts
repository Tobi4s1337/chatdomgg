import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmod, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KingdomIdSchema, PersonIdSchema } from '../../../../packages/shared/src';
import { createDurableRealmBoot } from '../../../../apps/realm/src/bootstrap/durable';
import { TenureEvidenceVerifier } from '../../../../apps/realm/src/allocation';
import { createRealmPool, migrateRealmSchema } from '../../../../apps/realm/src/persistence';
import { createRealmCitizens } from '../../../../apps/realm/src/evening/citizens';
import { RealmEveningBridge, mountEveningRoutes } from '../../../../apps/realm/src/evening';
import { INGRESS_ROUTE } from '../../../../apps/realm/src/ingress';
import { createForgeAuthority, FileForgeApprovals, ForgeWriteGate } from '../../../../apps/realm/src/wiring';
import { createForgeProviders } from '../../../../apps/codex/src/providers';
import { forgeJudgeQuestions } from '../../../../apps/codex/src/providers/policy';
import { createQueuedKingdomForgeApplication } from '../../../../apps/codex/src/kingdom-forge/recovery';
import { FileForgeWishQueue } from '../../../../apps/codex/src/wish-queue';
import { adoptProofLayout, settleProofPeople, qualifyProofPeople } from './seed';

const words = 'A small sleeping dragon chimney beside my hearth.';
const stages = ['words', 'drafting', 'result', 'commit', 'after-commit'] as const;
type Stage = typeof stages[number];
const phase: Record<Stage, string> = { words: 'drafting', drafting: 'assembling', result: 'selecting', commit: '', 'after-commit': '' };
const realmSocket = (directory: string, restarting: boolean) => join(directory, restarting ? 'realm-restart.sock' : 'realm-first.sock');
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function requireProof(value: unknown): asserts value { if (!value) throw new Error('Coordinator proof assertion failed.'); }
const identity = () => (BigInt('0x' + randomBytes(12).toString('hex')) + 1n).toString();
const send = (value: unknown) => process.send?.(value);
const privateWrite = (path: string, value: unknown) => writeFile(path, JSON.stringify(value), { mode: 0o600 });

async function worker(directory: string, port: number, stage: Stage, restarting: boolean) {
  let step = 'boot';
  const configPath = join(directory, 'fixture.json');
  const config = restarting ? JSON.parse(await readFile(configPath, 'utf8')) as { kingdomId: string; personId: string; key: string; secret: string; session: string; message: string; observedAt: number; slot: number }
    : { kingdomId: identity(), personId: identity(), key: randomBytes(32).toString('hex'), secret: randomBytes(32).toString('hex'), session: `proof-${randomUUID()}`, message: `proof-${randomUUID()}`, observedAt: 0, slot: 0 };
  const kingdomId = KingdomIdSchema.parse(config.kingdomId), personId = PersonIdSchema.parse(config.personId);
  const pool = createRealmPool({ connectionString: process.env.DATABASE_URL!, schema: 'realm_forge_wish' });
  let boot: ReturnType<typeof createDurableRealmBoot> | undefined;
  let bridge: RealmEveningBridge | undefined;
  let queue: FileForgeWishQueue | undefined;
  let hold: Awaited<ReturnType<ReturnType<typeof createDurableRealmBoot>['services']['retain']>> | undefined;
  let runtime: ReturnType<ReturnType<typeof createDurableRealmBoot>['createServer']> | undefined;
  let listening = false;
  try {
    requireProof((await pool.query<{ isolated: boolean }>("select current_setting('search_path')='realm_forge_wish' as isolated")).rows[0]?.isolated);
    await migrateRealmSchema(pool, 'realm_forge_wish');
    requireProof((await pool.query<{ isolated: boolean }>("select current_schema()='realm_forge_wish' as isolated")).rows[0]?.isolated);
    const gate = new ForgeWriteGate(), approvals = new FileForgeApprovals(join(directory, 'founded', 'forge-approvals'));
    const citizens = createRealmCitizens({ db: pool, origin: 'simulated', kingdomNames: new Map([[kingdomId, 'Birchlight']]), evidenceKey: Buffer.from(config.key, 'hex') });
    const providers = createForgeProviders({ runCodex: async ({ model, image }) => {
      const stageName = !model ? 'draft' : image ? 'result' : 'words';
      const file = await open(join(directory, 'calls'), 'a', 0o600);
      try { await file.writeFile(stageName + '\n'); await file.sync(); } finally { await file.close(); }
      if (!model) return JSON.stringify({ draft: { plan: { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' }, title: 'Sleeping keeper', plaque: 'Warm dreams above the hearth.' }, interpretation: 'as-wished', shared: 'subject' });
      return JSON.stringify({ answers: forgeJudgeQuestions(Boolean(image)).map(({ name }) => ({ type: 'predicate', name, probability: 0.01 })), subject: { motif: 'sleeping-dragon', slot: 'chimney' } });
    } });
    boot = createDurableRealmBoot({ pool, origin: 'simulated', foundedDirectory: join(directory, 'founded'), verifier: new TenureEvidenceVerifier('simulated', Buffer.from(config.key, 'hex')), ingressCredentials: { herald: config.secret }, foundedAccess: target => target.origin === 'simulated', furnish: citizens.furnish, repositoryOptions: gate.install({ origin: 'simulated' }), attach: kingdom => bridge!.attach(kingdom) });
    citizens.use(boot.allocation, boot.services);
    bridge = new RealmEveningBridge({ origin: 'simulated', ingress: boot.ingress, gate, approvals, providers, beforeObservation: input => citizens.observe(input) });
    bridge.use(boot.services);
    if (!restarting) await adoptProofLayout(boot, kingdomId);
    await boot.readiness.start();
    let people: Awaited<ReturnType<typeof settleProofPeople>> = [];
    step = 'writer';
    const deadline = Date.now() + 45_000;
    while (!hold) {
      try { hold = await boot.services.retain(kingdomId); }
      catch { if (!restarting || Date.now() >= deadline) throw new Error('Writer unavailable.'); await pause(300); }
    }
    const kingdom = hold.kingdom;
    // Keep this owner's writer held while the native citizen seed briefly acquires its own share.
    // Otherwise the seed's final release needlessly closes/reopens the kingdom before the proof begins.
    if (!restarting) { step = 'citizens'; people = await settleProofPeople(boot, citizens, kingdomId, [personId]); }
    step = 'listen';
    runtime = boot.createServer({ mountIngress: app => mountEveningRoutes(app, bridge!) });
    const app = runtime.transport.app;
    type ListenCallback = Parameters<typeof app.listen>[2];
    let bound = false;
    app.listen = ((_requestedPort: number, callback: ListenCallback) => app.listen_unix(socket => { bound = Boolean(socket); callback(socket); }, realmSocket(directory, restarting))) as typeof app.listen;
    await runtime.server.listen(port, '127.0.0.1'); listening = true; requireProof(bound);
    if (!restarting) {
      step = 'seed';
      const stream = (observedAt: number) => ({ version: 1, observation: { version: 1, id: `proof-${randomUUID()}`, kingdomId, origin: 'simulated', observedAt, kind: 'stream', live: true, sessionId: config.session } });
      const post = (body: unknown, auth: boolean) => fetch(`http://127.0.0.1:${port}${INGRESS_ROUTE}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${config.secret}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000) });
      const now = Math.floor(kingdom.databaseNow());
      requireProof((await post(stream(now - 660_000), false)).status === 401);
      requireProof((await post(stream(now - 660_000), true)).status === 202);
      requireProof((await post(stream(now - 25), true)).status === 202);
      const until = Date.now() + 15_000;
      while (kingdom.privateState.stream.sessionId !== config.session || kingdom.privateState.stream.liveUntil <= kingdom.databaseNow()) { requireProof(Date.now() < until); await pause(50); }
      await qualifyProofPeople(boot, kingdomId, people, config.session);
      config.slot = people[0]!.slot; config.observedAt = Math.floor(kingdom.databaseNow()) - 25;
      await privateWrite(configPath, config);
    }
    step = 'queue';
    queue = await FileForgeWishQueue.open({ directory: join(directory, 'queue'), origin: 'simulated' });
    const command = { kingdomId, personId, messageId: config.message, slot: config.slot, observedAt: config.observedAt, words };
    await queue.enqueue(command);
    const claim = await queue.claimNext(); requireProof(claim);
    const markPath = join(directory, 'barrier.json');
    if (restarting) {
      const mark = JSON.parse(await readFile(markPath, 'utf8')) as { attemptId: string; runId: string; calls: number };
      requireProof(claim.attempt.attemptId === mark.attemptId && claim.receipt.modelCalls === mark.calls);
    }
    const original = queue.checkpoint.bind(queue);
    if (!restarting) queue.checkpoint = async (owned, checkpoint) => {
      const receipt = await original(owned, checkpoint);
      const envelope = checkpoint.data as { state?: { id?: string; phase?: string }; input?: { attachment?: { runId?: string } } };
      if ((stage === 'commit' && checkpoint.id === 'application-commit') || (checkpoint.stage === stage && envelope.state?.phase === phase[stage])) {
        const runId = stage === 'commit' ? envelope.input?.attachment?.runId : envelope.state?.id;
        requireProof(runId);
        await privateWrite(markPath, { attemptId: claim.attempt.attemptId, runId, calls: receipt.modelCalls });
        send({ kind: 'barrier', stage });
        await new Promise<never>(() => {});
      }
      return receipt;
    };
    const actualAuthority = createForgeAuthority({ kingdomId, origin: 'simulated', retain: () => boot!.services.retain(kingdomId) }, { gate, approvals });
    const authority = { ...actualAuthority, commit: async (...args: Parameters<typeof actualAuthority.commit>) => {
      const result = await actualAuthority.commit(...args);
      if (!restarting && stage === 'after-commit' && result.kind === 'committed') {
        const receipt = await queue!.get(claim.attempt.key); requireProof(receipt);
        await privateWrite(markPath, { attemptId: claim.attempt.attemptId, runId: args[0].attachment.runId, calls: receipt.modelCalls });
        send({ kind: 'barrier', stage });
        await new Promise<never>(() => {});
      }
      return result;
    } };
    const run = createQueuedKingdomForgeApplication({ queue, authority, providers, now: () => Math.floor(kingdom.databaseNow()), record: value => approvals.record(value), publish: () => {} });
    step = 'coordinator';
    let activeClaim = claim, recoveries = 0;
    let outcome = await run(activeClaim);
    const recoveryDeadline = Date.now() + 45_000;
    while (restarting && outcome.kind === 'recovery-needed' && Date.now() < recoveryDeadline) {
      // A deadline is uncertainty, not rollback. Reclaim before another execution so saved snapshots
      // and debits are current; let the real authority reconcile a transaction that finished late.
      const actual = await queue.get(activeClaim.attempt.key); requireProof(actual);
      await queue.retry(activeClaim); await pause(50);
      const next = await queue.claimNext(); requireProof(next);
      requireProof(next.attempt.attemptId === claim.attempt.attemptId && next.receipt.modelCalls === actual.modelCalls);
      activeClaim = next; recoveries += 1; outcome = await run(activeClaim);
    }
    requireProof(restarting && outcome.kind === 'committed');
    const mark = JSON.parse(await readFile(markPath, 'utf8')) as { runId: string };
    requireProof(outcome.attachment.runId === mark.runId);
    const calls = (await readFile(join(directory, 'calls'), 'utf8')).trim().split('\n');
    requireProof(calls.join(',') === 'words,draft,result');
    requireProof((await queue.get(claim.attempt.key))?.modelCalls === 3);
    const attachments = Object.values(kingdom.privateState.attachments);
    requireProof(attachments.length === 1 && attachments[0]!.attachment.id === mark.runId);
    const spent = await pool.query<{ count: string }>('select count(*)::text as count from realm_coal_ledger where kingdom_id=$1 and person_id=$2 and delta=-1', [kingdomId, personId]);
    const facts = await pool.query<{ count: string }>("select count(*)::text as count from realm_facts where kingdom_id=$1 and fact::jsonb->'body'->>'type'='forge.commitApproved'", [kingdomId]);
    const outbox = await pool.query<{ count: string }>("select count(*)::text as count from realm_outbox where kingdom_id=$1 and kind='forge' and message::jsonb->'event'->>'type'='committed'", [kingdomId]);
    requireProof(Number(spent.rows[0]?.count) === 1 && Number(facts.rows[0]?.count) === 1 && Number(outbox.rows[0]?.count) === 1);
    await queue.finish(activeClaim, { kind: 'committed', runId: outcome.attachment.runId, committedAt: outcome.attachment.committedAt });
    send({ kind: 'complete', stage, calls: calls.length, facts: 1, outbox: 1, coal: 1, recoveries });
  } catch { send({ kind: 'error', stage, step }); process.exitCode = 1; }
  finally {
    await queue?.close().catch(() => {}); await bridge?.stop().catch(() => {}); await hold?.release().catch(() => {});
    if (runtime && listening) await runtime.server.gracefullyShutdown(false).catch(() => {});
    await boot?.stop().catch(() => {}); await pool.end().catch(() => {});
    process.disconnect?.();
  }
}

type Exit = { code: number | null; signal: NodeJS.Signals | null };
interface Message { kind: 'barrier' | 'complete' | 'error'; stage: Stage; step?: string; calls?: number; facts?: number; outbox?: number; coal?: number; recoveries?: number }
const children = new Map<ChildProcess, Promise<Exit>>();
let stopped = false;
function launch(args: string[]) {
  requireProof(!stopped);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args], { env: process.env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout?.resume(); child.stderr?.resume();
  const closed = new Promise<Exit>((resolve, reject) => {
    child.once('error', () => reject(new Error('Proof child failed to start.')));
    child.once('close', (code, signal) => { children.delete(child); resolve({ code, signal }); });
  });
  children.set(child, closed);
  const message = new Promise<Message>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Proof child deadline exceeded.')); }, 100_000);
    child.on('message', value => {
      if (!value || typeof value !== 'object' || !('kind' in value) || !('stage' in value)
        || !['barrier', 'complete', 'error'].includes(String(value.kind)) || value.stage !== args[3]) return;
      clearTimeout(timer); resolve(value as Message);
    });
    void closed.then(() => { clearTimeout(timer); reject(new Error('Proof child exited before its checkpoint.')); }, reject);
  });
  return { child, closed, message };
}

export async function runCoordinatorProof(args: string[]) {
  if (args[0] === 'worker') {
    const [, directory, port, stage, restart] = args;
    requireProof(directory && stages.includes(stage as Stage) && port && (restart === 'first' || restart === 'restart'));
    await worker(directory, Number(port), stage as Stage, restart === 'restart'); return;
  }
  const [directory, port] = args; requireProof(directory && port);
  const stop = () => { stopped = true; for (const child of children.keys()) child.kill('SIGTERM'); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const summaries: Message[] = [];
  try {
    for (const stage of stages) {
      const fixture = join(directory, stage); await mkdir(fixture, { mode: 0o700 }); await chmod(fixture, 0o700);
      send({ kind: 'target', path: realmSocket(fixture, false) });
      const first = launch(['worker', fixture, port, stage, 'first']);
      const barrier = await first.message;
      if (barrier.kind !== 'barrier') throw new Error(`Proof failed at ${stage}/${barrier.step ?? barrier.kind}.`);
      first.child.kill('SIGKILL'); const killed = await first.closed; requireProof(killed.signal === 'SIGKILL');
      send({ kind: 'target', path: realmSocket(fixture, true) });
      const second = launch(['worker', fixture, port, stage, 'restart']);
      const result = await second.message;
      if (result.kind !== 'complete') throw new Error(`Proof failed at ${stage}/${result.step ?? result.kind}.`);
      const exit = await second.closed; requireProof(exit.code === 0); summaries.push(result);
    }
    requireProof(!stopped && summaries.length === stages.length);
    const evidence = { version: 1, scenarios: summaries.length, callsPerScenario: 3, commitFactsPerScenario: 1, outboxPerScenario: 1, coalsPerScenario: 1, sameAttemptAndRun: true, separateKilledOwners: true, pendingRecoveries: summaries.reduce((sum, item) => sum + (item.recoveries ?? 0), 0), simulated: true };
    const evidenceDirectory = 'work/evidence/forge-wish'; await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(join(evidenceDirectory, 'fw11-coordinator-process.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.info(JSON.stringify(evidence));
  } finally {
    stopped = true; for (const child of children.keys()) child.kill('SIGKILL');
    await Promise.allSettled([...children.values()]);
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
