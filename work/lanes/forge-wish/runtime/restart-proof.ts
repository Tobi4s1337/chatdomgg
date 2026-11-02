/**
 * FW11 served restart proof. A supervisor runs the private realm as a child process on a lane port and kills either
 * the whole realm or only its warm model process while a wish is in a chosen stage (words, drafting, result, commit).
 * Every wish must end as exactly one piece or one private message, with at most one coal spent. A final case sends
 * three wishes within a second and checks that all land, in arrival order. Word-free evidence only.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { KingdomIdSchema, PersonIdSchema, type ForgeChatObservation, type KingdomId } from '../../../../packages/shared/src';
import { REALM_HERALD_ROUTE } from '../../../../packages/shared/src/realm';
import { createDurableRealmBoot } from '../../../../apps/realm/src/bootstrap/durable';
import { TenureEvidenceVerifier } from '../../../../apps/realm/src/allocation';
import { createRealmPool, migrateRealmSchema } from '../../../../apps/realm/src/persistence';
import { createRealmCitizens } from '../../../../apps/realm/src/evening/citizens';
import { RealmEveningBridge, mountEveningRoutes } from '../../../../apps/realm/src/evening';
import { INGRESS_ROUTE } from '../../../../apps/realm/src/ingress';
import { FileForgeApprovals, ForgeWriteGate, forgeMessageKey } from '../../../../apps/realm/src/wiring';
import { ownRealmShutdown } from '../../../../apps/realm/src/lifecycle';
import { mountForgeQueueRoutes } from '../../../../apps/realm/src/forge-queue/http';
import { createForgeProviders } from '../../../../apps/codex/src/providers';
import type { KingdomForgeAudit } from '../../../../apps/codex/src/kingdom-forge/ports';
import type { CodexDraftRun } from '../../../../apps/codex/src/providers/codex-cli';
import { createWarmCodexRunner } from '../../../../apps/codex/src/providers/warm';
import { forgeJudgeQuestions } from '../../../../apps/codex/src/providers/policy';
import { FW10_WISHES } from '../../../../apps/codex/src/fixtures/fw10-wishes';
import { FW11_WISHES } from '../../../../apps/codex/src/fixtures/fw11-wishes';
import { adoptProofLayout, settleProofPeople, qualifyProofPeople } from './seed';

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`Proof: ${message}`); }
type Stage = 'words' | 'drafting' | 'result' | 'commit';
type Mark = Record<string, unknown> & { readonly type: string; readonly at: number };

/** The realm process. Its marks are private, word-free and written synchronously so a kill cannot lose them. */
export async function runRestartRealm(directory: string, port: number, seed: boolean): Promise<void> {
  const secret = process.env.PROOF_SECRET!, evidenceKey = Buffer.from(process.env.PROOF_EVIDENCE_KEY!, 'hex');
  const sessionId = process.env.PROOF_SESSION!, controlled = process.env.PROOF_CONTROLLED === '1';
  check(process.env.DATABASE_URL && process.env.REALM_DATABASE_SCHEMA === 'realm_forge_wish' && secret && sessionId, 'private configuration required.');
  const mark = (value: Omit<Mark, 'at'>) => appendFileSync(join(directory, 'marks.jsonl'), JSON.stringify({ ...value, at: Date.now(), pid: process.pid }) + '\n', { mode: 0o600 });
  const pool = createRealmPool({ connectionString: process.env.DATABASE_URL!, schema: 'realm_forge_wish' });
  await migrateRealmSchema(pool, 'realm_forge_wish');
  const config = seed ? null : JSON.parse(await readFile(join(directory, 'realm.json'), 'utf8')) as { kingdomId: KingdomId };
  const kingdomId = config?.kingdomId ?? KingdomIdSchema.parse(process.env.PROOF_KINGDOM!);
  const names = new Map([[kingdomId, 'Birchlight']]);
  const gate = new ForgeWriteGate();
  class ProofApprovals extends FileForgeApprovals {
    override async record(audit: KingdomForgeAudit): Promise<void> {
      await super.record(audit);
      // Every gate decision, word-free: how many calls it took and how the piece was delivered.
      const selected = audit.selection ? audit.verdicts[audit.selection.verdict] : undefined;
      mark({ type: 'audit', key: audit.key, judgment: audit.judgment, calls: audit.modelCalls ?? null, attempts: audit.attempts ?? null,
        delivery: audit.selection?.delivery ?? null, shared: audit.selection?.shared ?? null, reason: audit.selection?.reason ?? null,
        quality: selected?.quality?.score ?? null });
      if (audit.judgment === 'approved') {
        mark({ type: 'approved', key: audit.key, calls: audit.modelCalls ?? null });
        // A short window between the approval and the commit, so the supervisor can stop the realm right there.
        if (existsSync(join(directory, 'commit-pause'))) await pause(2_500);
      }
    }
  }
  const approvals = new ProofApprovals(join(directory, 'founded', 'forge-approvals'));
  const warm = controlled ? null : createWarmCodexRunner({ stateDirectory: join(directory, 'warm') });
  const runner = async (input: CodexDraftRun): Promise<string> => {
    const stage: Stage = !input.model ? 'drafting' : input.image ? 'result' : 'words';
    mark({ type: 'call', stage, model: input.model ?? 'gpt-6.1-terra' });
    if (!warm) {
      await pause(1200 + Math.floor(Math.random() * 1800));
      if (stage === 'drafting') return JSON.stringify({ draft: { plan: { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' },
        title: 'Sleeping keeper', plaque: 'Warm dreams above the hearth.' }, interpretation: 'as-wished', shared: 'subject' });
      return JSON.stringify({ answers: forgeJudgeQuestions(Boolean(input.image)).map(({ name }) => ({ type: 'predicate', name, probability: 0.01 })),
        subject: { motif: 'sleeping-dragon', slot: 'chimney' } });
    }
    return warm({ ...input, onComplete: metric => {
      mark({ type: 'call-done', stage, outcome: metric.outcome, ms: Math.round(metric.elapsedMs), warm: warm.state,
        tokens: metric.usage?.totalTokens ?? null, input: metric.usage?.inputTokens ?? null, output: metric.usage?.outputTokens ?? null });
      input.onComplete?.(metric);
    } });
  };
  const citizens = createRealmCitizens({ db: pool, origin: 'simulated', kingdomNames: names, evidenceKey });
  const bridge: { evening?: RealmEveningBridge } = {};
  const boot = createDurableRealmBoot({ pool, origin: 'simulated', foundedDirectory: join(directory, 'founded'), log: () => {},
    verifier: new TenureEvidenceVerifier('simulated', evidenceKey), ingressCredentials: { herald: secret },
    foundedAccess: target => target.origin === 'simulated', furnish: citizens.furnish,
    repositoryOptions: { ...gate.install({ origin: 'simulated' }), leaseMs: 20_000 },
    attach: kingdom => bridge.evening!.attach(kingdom) });
  citizens.use(boot.allocation, boot.services);
  const evening = bridge.evening = new RealmEveningBridge({ origin: 'simulated', ingress: boot.ingress, gate, approvals, providers: createForgeProviders({ runCodex: runner }),
    beforeObservation: input => citizens.observe(input),
    forgeQueue: { directory: join(directory, 'line'), maxConcurrent: 3 },
    forgeChatObserver: async (observation: ForgeChatObservation) => {
      mark({ type: 'outcome', messageId: observation.messageId, status: observation.status,
        ...('attachmentId' in observation ? { attachmentId: observation.attachmentId, committedAt: observation.committedAt } : {}) });
    } });
  evening.use(boot.services);
  if (seed) await adoptProofLayout(boot, kingdomId);
  await boot.readiness.start();
  await evening.start();
  const runtime = boot.createServer({ mountIngress: app => mountEveningRoutes(app, evening) });
  mountForgeQueueRoutes(runtime.transport.app, evening.line, { pool, origin: 'simulated', secureCookies: false });
  const app = runtime.transport.app, nativeListen = app.listen.bind(app);
  type ListenCallback = Parameters<typeof app.listen>[2];
  let bound = false;
  app.listen = ((requestedPort: number, callback: ListenCallback) => nativeListen('127.0.0.1', requestedPort, socket => { bound = Boolean(socket); callback(socket); })) as typeof app.listen;
  ownRealmShutdown(runtime.server, runtime.transport, async () => {
    await evening.stop(); await warm?.close(); await boot.stop(); await pool.end();
  });
  await runtime.server.listen(port, '127.0.0.1');
  check(bound, 'the lane port did not bind.');
  const base = `http://127.0.0.1:${port}`;
  const post = (route: string, body: unknown) => fetch(base + route, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000) });
  // A killed realm's writer lease outlives it; the next process takes the kingdom once that lease lapses.
  let hold: Awaited<ReturnType<typeof boot.services.retain>> | undefined;
  for (const end = Date.now() + 90_000; !hold;) {
    try { hold = await boot.services.retain(kingdomId); }
    catch (error) { if (Date.now() > end) throw error; await pause(1_000); }
  }
  const kingdom = hold.kingdom;
  let n = 0;
  const stream = (at: number) => ({ version: 1, observation: { version: 1, id: `restart-stream-${process.pid}-${n++}`,
    kingdomId, origin: 'simulated', observedAt: at, kind: 'stream', live: true, sessionId } });
  const startedAt = Number(process.env.PROOF_STARTED ?? '0') || Math.floor(kingdom.databaseNow()) - 660_000;
  check((await post(INGRESS_ROUTE, stream(seed ? startedAt : Math.floor(kingdom.databaseNow()) - 25))).status === 202, 'stream evidence refused.');
  const committed = async () => { const end = Date.now() + 15_000; while (Date.now() < end) {
    if (kingdom.privateState.stream.sessionId === sessionId && kingdom.privateState.stream.liveUntil > kingdom.databaseNow()) return; await pause(50); }
  throw new Error('Proof: stream evidence did not commit.'); };
  if (seed) {
    await post(INGRESS_ROUTE, stream(Math.floor(kingdom.databaseNow()) - 25));
    await committed();
    // One citizen per wish: eight restart cases, six typical wishes and three together; or the fifty.
    const fifty = (process.env.PROOF_PHASES ?? '').split(',').includes('fifty');
    const ids = Array.from({ length: fifty ? FW11_WISHES.length : 17 }, () => PersonIdSchema.parse((BigInt('0x' + randomBytes(12).toString('hex')) + 1n).toString()));
    const people = await settleProofPeople(boot, citizens, kingdomId, ids, false);
    await qualifyProofPeople(boot, kingdomId, people, sessionId);
    await writeFile(join(directory, 'realm.json'), JSON.stringify({ kingdomId, people }), { mode: 0o600 });
  } else await committed();
  await hold.release();
  const heartbeat = setInterval(() => { void post(INGRESS_ROUTE, stream(Date.now() - 25)).catch(() => {}); }, 15_000);
  heartbeat.unref?.();
  mark({ type: 'ready', seed });
}

/** The supervisor. It never loads the realm's modules' state; it only starts, kills and reads private marks. */
export async function runRestartSupervisor(port: number, entry: string): Promise<void> {
  check(process.env.DATABASE_URL && process.env.REALM_DATABASE_SCHEMA === 'realm_forge_wish', 'private configuration required.');
  check(Number.isInteger(port) && port >= 5170 && port <= 5189 && port !== 5187, 'port outside lane allowance.');
  const controlled = process.env.PROOF_CONTROLLED === '1';
  const directory = join('/tmp/chatdom-forge-wish', `restart-${randomUUID()}`);
  await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
  const env = { ...process.env, PROOF_SECRET: randomBytes(32).toString('hex'), PROOF_EVIDENCE_KEY: randomBytes(32).toString('hex'),
    PROOF_SESSION: `restart-night-${randomUUID()}`, PROOF_KINGDOM: (BigInt('0x' + randomBytes(12).toString('hex')) + 1n).toString() };
  const marks = (): Mark[] => { try { return readFileSync(join(directory, 'marks.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Mark); } catch { return []; } };
  const waitFor = async (test: (all: Mark[]) => boolean, ms: number, label: string) => {
    const end = Date.now() + ms; while (Date.now() < end) { if (test(marks())) return; await pause(40); }
    throw new Error(`Proof: ${label} did not happen in time.`);
  };
  let child: ChildProcess | undefined;
  const start = async (seed: boolean) => {
    const readies = marks().filter(m => m.type === 'ready').length;
    child = spawn(process.execPath, [entry, 'realm', directory, String(port), seed ? 'seed' : 'resume'], { env, stdio: ['ignore', 'ignore', 'inherit'] });
    await waitFor(all => all.filter(m => m.type === 'ready').length > readies, seed ? 600_000 : 120_000, 'the realm start');
  };
  const descendants = (pid: number): number[] => {
    const all: { pid: number; ppid: number }[] = [];
    for (const name of readdirSync('/proc').filter(entry => /^\d+$/.test(entry))) {
      try { const stat = readFileSync(`/proc/${name}/stat`, 'utf8'); all.push({ pid: Number(name), ppid: Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]) }); } catch { /* gone */ }
    }
    const found: number[] = [], queue = [pid];
    while (queue.length) { const parent = queue.shift()!; for (const p of all) if (p.ppid === parent) { found.push(p.pid); queue.push(p.pid); } }
    return found;
  };
  const isModel = (pid: number) => { try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('app-server'); } catch { return false; } };
  const killRealm = async () => {
    const owned = child?.pid ? descendants(child.pid) : [];
    const closed = new Promise<void>(resolve => child?.once('close', () => resolve()));
    child?.kill('SIGKILL'); await closed;
    // A killed realm cannot close its model process; the supervisor reaps whatever the realm owned.
    for (const pid of owned) try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  };
  const killForge = () => {
    const models = child?.pid ? descendants(child.pid).filter(isModel) : [];
    for (const pid of models) try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    return models.length;
  };
  const summary: Record<string, unknown> = { version: 1, controlled, port, cases: [] as unknown[] };
  const flush = () => writeFile(join(directory, 'summary.json'), JSON.stringify(summary, null, 2), { mode: 0o600 });
  try {
    await start(true);
    const realm = JSON.parse(await readFile(join(directory, 'realm.json'), 'utf8')) as { kingdomId: string; people: { personId: string; slot: number }[] };
    const base = `http://127.0.0.1:${port}`;
    const post = (route: string, body: unknown) => fetch(base + route, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.PROOF_SECRET}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000) });
    const known = FW10_WISHES.filter(wish => wish.category === 'known');
    let person = 0;
    const send = async (words: string) => {
      const who = realm.people[person++]!, messageId = `restart-${randomUUID()}`, observedAt = Date.now() - 25;
      const witness = { version: 1, observation: { version: 1, id: `restart-chat-${randomUUID()}`, kingdomId: realm.kingdomId, origin: 'simulated',
        observedAt, kind: 'observe', source: 'chat', coverage: 'activity', people: [{ personId: who.personId, disclosure: 'anonymous' }] } };
      check((await post(INGRESS_ROUTE, witness)).status === 202, 'chat witness refused.');
      const command = { kingdomId: realm.kingdomId, personId: who.personId, messageId, slot: who.slot, words, observedAt };
      const response = await post(REALM_HERALD_ROUTE, { version: 1, forge: { type: 'wish', origin: 'simulated', command } });
      check(response.status === 202, `wish not accepted (${response.status}).`);
      return { messageId, personId: who.personId, sentAt: Date.now() };
    };
    const settle = async (wish: { messageId: string; personId: string; sentAt: number }, label: Record<string, unknown>) => {
      const limited = () => marks().some(m => m.type === 'call-done' && m.outcome === 'usage-limit');
      await waitFor(all => limited() || all.some(m => m.type === 'outcome' && m.messageId === wish.messageId && m.status !== 'working'), 300_000, 'the wish outcome');
      if (limited()) { summary.blocked = 'codex limit'; throw new Error('Proof: a usage limit stopped the run.'); }
      await pause(1500);
      const all = marks(), outcomes = all.filter(m => m.type === 'outcome' && m.messageId === wish.messageId && m.status !== 'working');
      const pool = createRealmPool({ connectionString: process.env.DATABASE_URL!, schema: 'realm_forge_wish' });
      try {
        const spent = await pool.query<{ n: string }>('select count(*) as n from realm_coal_ledger where kingdom_id=$1 and person_id=$2 and delta=-1', [realm.kingdomId, wish.personId]);
        const statuses = [...new Set(outcomes.map(m => String(m.status)))], attachments = new Set(outcomes.map(m => m.attachmentId).filter(Boolean));
        const row = { ...label, statuses, attachments: attachments.size, spent: Number(spent.rows[0]?.n ?? 0), replies: outcomes.length,
          seconds: Math.round(((outcomes[0]?.at ?? Date.now()) - wish.sentAt) / 100) / 10 };
        (summary.cases as unknown[]).push(row);
        check(statuses.length === 1, 'a wish ended in more than one way.');
        check(row.spent <= 1 && row.spent === (statuses[0] === 'delivered' ? 1 : 0) && row.attachments === row.spent, 'coal and pieces disagree.');
        return outcomes[0]!;
      } finally { await pool.end(); await flush(); }
    };
    // PROOF_PHASES (matrix,typical,three) and PROOF_TYPICAL (6) let a later run finish only what an earlier one did not.
    const phases = new Set((process.env.PROOF_PHASES ?? 'matrix,typical,three').split(','));
    const typicalCount = Number(process.env.PROOF_TYPICAL ?? 6);
    summary.phases = [...phases];
    const stages: Stage[] = phases.has('matrix') ? ['words', 'drafting', 'result', 'commit'] : [];
    for (const target of ['realm', 'forge'] as const) for (const stage of stages) {
      if (controlled && target === 'forge') continue;
      if (stage === 'commit') await writeFile(join(directory, 'commit-pause'), '', { mode: 0o600 });
      const callsBefore = marks().filter(m => m.type === 'call').length, approvedBefore = marks().filter(m => m.type === 'approved').length;
      const wish = await send(known[(person) % known.length]!.words);
      await waitFor(all => stage === 'commit' ? all.filter(m => m.type === 'approved').length > approvedBefore
        : all.filter(m => m.type === 'call').slice(callsBefore).some(m => m.stage === stage), 240_000, `stage ${stage}`);
      await pause(stage === 'commit' ? 300 : 700);
      if (target === 'realm') { await killRealm(); await start(false); }
      else summary[`forgeKilled-${stage}`] = killForge();
      await settle(wish, { target, stage });
      await rm(join(directory, 'commit-pause'), { force: true });
    }
    // Typical wishes, one at a time with nothing killed: the warm worker's submit-to-reveal time and calls.
    const typical: number[] = [];
    for (let index = 0; phases.has('typical') && index < typicalCount; index++) {
      const callsBefore = marks().filter(m => m.type === 'call-done').length;
      const outcome = await settle(await send(known[(person + 3) % known.length]!.words), { target: 'none', stage: 'typical' });
      const rows = summary.cases as { seconds: number }[];
      typical.push(rows.at(-1)!.seconds);
      (rows.at(-1) as Record<string, unknown>).calls = marks().filter(m => m.type === 'call-done').length - callsBefore;
      void outcome;
    }
    summary.typicalSeconds = typical;
    // Three wishes within a second: all land, in the order they arrived.
    const three = [];
    for (let index = 0; phases.has('three') && index < 3; index++) three.push(await send(known[(person + index) % known.length]!.words));
    const outcomes = [];
    for (const wish of three) outcomes.push(await settle(wish, { target: 'none', stage: 'three' }));
    const landed = outcomes.filter(m => m.status === 'delivered').map(m => Number(m.committedAt));
    summary.threeInOrder = landed.every((at, index) => index === 0 || at >= landed[index - 1]!);
    summary.threeLanded = landed.length;
    const calls = marks().filter(m => m.type === 'call-done');
    summary.calls = calls.length;
    summary.warmCalls = calls.filter(m => m.warm === 'warm').length;
    summary.callMs = calls.map(m => Number(m.ms)).sort((a, b) => a - b);
    summary.tokens = calls.reduce((sum, m) => sum + Number(m.tokens ?? 0), 0);
    // FW11's fifty (PROOF_PHASES=fifty, once, at the end): the fixed set through the warm worker, two in flight.
    if (phases.has('fifty')) {
      const callsBefore = calls.length, waiting = [...FW11_WISHES], rows: Record<string, unknown>[] = [];
      const lane = async () => {
        for (let wish = waiting.shift(); wish; wish = waiting.shift()) {
          const sent = await send(wish.words);
          const outcome = await settle(sent, { target: 'none', stage: 'fifty', id: wish.id });
          const key = forgeMessageKey(KingdomIdSchema.parse(realm.kingdomId), sent.messageId);
          const audit = marks().filter(m => m.type === 'audit' && m.key === key).at(-1);
          const row = (summary.cases as Record<string, unknown>[]).find(item => item.id === wish.id);
          rows.push({ id: wish.id, category: wish.category, status: outcome.status, seconds: row?.seconds ?? null, judgment: audit?.judgment ?? null,
            calls: audit?.calls ?? null, attempts: audit?.attempts ?? null, delivery: audit?.delivery ?? null, shared: audit?.shared ?? null,
            reason: audit?.reason ?? null, quality: audit?.quality ?? null });
          await flush();
        }
      };
      await Promise.all([lane(), lane()]);
      rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const done = marks().filter(m => m.type === 'call-done').slice(callsBefore);
      const seconds = rows.filter(row => row.status === 'delivered').map(row => Number(row.seconds)).sort((a, b) => a - b);
      const at = (q: number) => seconds.length ? seconds[Math.min(seconds.length - 1, Math.ceil(q * seconds.length) - 1)]! : null;
      summary.fifty = { rows, landed: seconds.length, total: rows.length, median: at(.5), p95: at(.95),
        refusedForQuality: rows.filter(row => row.status !== 'delivered' && row.reason === 'quality').length,
        calls: done.length, completeCalls: done.filter(m => m.outcome === 'complete').length, warmCalls: done.filter(m => m.warm === 'warm').length,
        tokens: done.reduce((sum, m) => sum + Number(m.tokens ?? 0), 0), callMedianMs: done.map(m => Number(m.ms)).sort((a, b) => a - b)[Math.floor(done.length / 2)] ?? null };
      const table = ['| wish | kind | outcome | calls | seconds to reveal | quality | delivery |', '|---|---|---|---|---|---|---|',
        ...rows.map(row => `| ${row.id} | ${row.category} | ${row.status} | ${row.calls ?? '—'} | ${row.seconds ?? '—'} | ${row.quality ?? '—'} | ${row.delivery ?? '—'}${row.reason ? ` (${row.reason}: shares ${row.shared})` : ''} |`)];
      await writeFile(join(directory, 'fifty.md'), table.join('\n') + '\n', { mode: 0o600 });
    }
    summary.ok = (!phases.has('three') || (summary.threeInOrder === true && summary.threeLanded === 3))
      && (!phases.has('fifty') || Number((summary.fifty as { landed: number }).landed) >= Math.ceil(FW11_WISHES.length * .9));
  } catch (error) {
    summary.ok = false; summary.error = error instanceof Error && error.message.startsWith('Proof:') ? error.message : 'unexpected failure';
    // The cause, with every fixture wish's words taken out: never words in the summary.
    if (error instanceof Error && !error.message.startsWith('Proof:'))
      summary.detail = FW10_WISHES.reduce((text, wish) => text.split(wish.words).join('[wish]'), `${error.name}: ${error.message}`).slice(0, 200);
    process.exitCode = 1;
  } finally {
    if (child && child.exitCode === null) {
      const closed = new Promise<void>(resolve => child?.once('close', () => resolve()));
      child.kill('SIGTERM');
      await Promise.race([closed, pause(15_000)]);
      if (child.exitCode === null) await killRealm();
    }
    await flush();
    console.info(JSON.stringify({ ...summary, directory }));
  }
}
