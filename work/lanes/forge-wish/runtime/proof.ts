import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { createServer as reservePort } from 'node:net';
import { join } from 'node:path';
import { FORGE_CHAT_LIMITS, KingdomIdSchema, PersonIdSchema, type ForgeChatObservation } from '../../../../packages/shared/src';
import { REALM_HERALD_ROUTE } from '../../../../packages/shared/src/realm';
import { createDurableRealmBoot } from '../../../../apps/realm/src/bootstrap/durable';
import { TenureEvidenceVerifier } from '../../../../apps/realm/src/allocation';
import { createRealmPool, migrateRealmSchema, describeStorageFailure } from '../../../../apps/realm/src/persistence';
import { createRealmCitizens } from '../../../../apps/realm/src/evening/citizens';
import { RealmEveningBridge, mountEveningRoutes } from '../../../../apps/realm/src/evening';
import { INGRESS_ROUTE } from '../../../../apps/realm/src/ingress';
import { FileForgeApprovals, ForgeWriteGate, forgeMessageKey } from '../../../../apps/realm/src/wiring';
import { ownRealmShutdown } from '../../../../apps/realm/src/lifecycle';
import { createForgeProviders, type ForgeResultInput } from '../../../../apps/codex/src/providers';
import type { KingdomForgeAudit } from '../../../../apps/codex/src/kingdom-forge/ports';
import { runCodexDraft, type CodexDraftCompletion } from '../../../../apps/codex/src/providers/codex-cli';
import { forgeJudgeQuestions } from '../../../../apps/codex/src/providers/policy';
import { adoptProofLayout, settleProofPeople, qualifyProofPeople } from './seed';
import { probeCliLaunch } from './cli-probe';
import { FW10_WISHES } from '../../../../apps/codex/src/fixtures/fw10-wishes';
import { renderForgeCertificationSheet } from '../../../../apps/codex/src/contact-sheet';
import { assembleForge, findForgeSockets, forgeStyleKit } from '../../../../packages/forge/src';

// Lane-authored pilot, outside the unchanged twenty-wish set. Never read live wish records here.
const pilotWords = 'A crescent moon lantern beside my front door, please.';
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`Proof: ${message}`); }
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(test: () => boolean | Promise<boolean>, ms: number, label: string) {
  const end = performance.now() + ms;
  while (performance.now() < end) { if (await test()) return; await pause(50); }
  throw new Error(`Proof: ${label} exceeded its bounded wait.`);
}
const identity = () => (BigInt('0x' + randomBytes(12).toString('hex')) + 1n).toString();

export async function runPrivateForgeProof(mode: 'prepare' | 'pilot' | 'twenty' | 'stress', port: number): Promise<void> {
  check(process.env.DATABASE_URL && process.env.REALM_DATABASE_SCHEMA === 'realm_forge_wish', 'explicit private database/schema required.');
  check(Number.isInteger(port) && port >= 5170 && port <= 5189 && port !== 5187, 'port outside lane allowance.');
  const directory = join('/tmp/chatdom-forge-wish', `proof-${randomUUID()}`);
  await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
  const cliBefore = await probeCliLaunch(directory);
  const pool = createRealmPool({ connectionString: process.env.DATABASE_URL!, schema: 'realm_forge_wish' });
  const metrics: CodexDraftCompletion[] = [], observations: ForgeChatObservation[] = [];
  // Private operational codes from the authority and the run; never words, people or drafts.
  const operations: Record<string, unknown>[] = [], proofStarted = performance.now(), realmLines: string[] = [];
  const summary: Record<string, unknown> = { version: 1, mode, port, origin: 'simulated', stage: 'database', realWishes: 0, cliBefore };
  const evidenceKey = randomBytes(32), secret = randomBytes(32).toString('hex');
  const kingdomId = KingdomIdSchema.parse(identity());
  const ids = Array.from({ length: mode === 'twenty' || mode === 'stress' ? FW10_WISHES.length : 2 }, () => PersonIdSchema.parse(identity()));
  const audits = new Map<string, KingdomForgeAudit>();
  const names = new Map([[kingdomId, 'Birchlight']]);
  class ProofApprovals extends FileForgeApprovals {
    override async record(audit: KingdomForgeAudit): Promise<void> {
      await super.record(audit);
      audits.set(audit.key, audit);
      summary.audit = { judgment: audit.judgment, attempts: audit.attempts ?? 0, modelCalls: audit.modelCalls ?? 0,
        delivery: audit.selection?.delivery ?? null, quality: audit.verdicts[audit.selection?.verdict ?? 1]?.quality ?? null };
    }
  }
  const gate = new ForgeWriteGate(), approvals = new ProofApprovals(join(directory, 'founded', 'forge-approvals'));
  let usageLimit = false, listening = false;
  let stopping: Promise<void> | undefined;
  const httpAbort = new AbortController(), activeModelCalls = new Set<Promise<string>>();
  let boot: ReturnType<typeof createDurableRealmBoot> | undefined;
  let evening: RealmEveningBridge | undefined;
  let runtime: ReturnType<ReturnType<typeof createDurableRealmBoot>['createServer']> | undefined;
  let hold: Awaited<ReturnType<ReturnType<typeof createDurableRealmBoot>['services']['retain']>> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined, beat: Promise<void> | undefined, heartbeatFailed = false;
  let off: (() => void) | undefined;
  const reservation = reservePort(); let reserved = false;
  const closeReservation = async () => { if (reserved) { reserved = false; await new Promise<void>(resolve => reservation.close(() => resolve())); } };
  const flush = async () => {
    await writeFile(join(directory, 'summary.json'), JSON.stringify(summary, null, 2), { mode: 0o600 });
    if (realmLines.length) await writeFile(join(directory, 'realm.log'), realmLines.join('\n') + '\n', { mode: 0o600 });
    if (operations.length) await writeFile(join(directory, 'operations.jsonl'), operations.map(o => JSON.stringify(o)).join('\n') + '\n', { mode: 0o600 });
    if (metrics.length) await writeFile(join(directory, 'calls.jsonl'), metrics.map(m => JSON.stringify(m)).join('\n') + '\n', { mode: 0o600 });
  };
  const cleanup = (): Promise<void> => stopping ??= (async () => {
    httpAbort.abort(); if (heartbeat) clearInterval(heartbeat); off?.();
    if (summary.ok === undefined) { summary.ok = false; summary.interrupted = true; }
    const stopEvening = evening?.stop();
    void stopEvening?.catch(() => {});
    try {
      // stop() cancels synchronously but may then wait on a database hold. Preserve finished call
      // accounting before that wait; signal shutdown has a five-second ceiling.
      await Promise.allSettled([...activeModelCalls]); await flush(); await stopEvening;
    } finally {
      try { await beat?.catch(() => {}); await hold?.release(); }
      finally {
        try { await boot?.stop(); }
        finally {
          try { await pool.end(); }
          // Signal-owned shutdown can exit without returning through this function's lexical finally.
          finally { await flush(); }
        }
      }
    }
  })();
  try {
    const path = await pool.query<{ isolated: boolean }>("select current_setting('search_path')='realm_forge_wish' as isolated");
    check(path.rows[0]?.isolated, 'connection search path is not isolated.');
    await migrateRealmSchema(pool, 'realm_forge_wish');
    check((await pool.query<{ isolated: boolean }>("select current_schema()='realm_forge_wish' as isolated")).rows[0]?.isolated, 'current schema is not isolated.');
    await new Promise<void>((resolve, reject) => {
      reservation.once('error', () => reject(new Error('Proof: requested port is occupied.')));
      reservation.listen({ port, host: '127.0.0.1', exclusive: true }, () => { reserved = true; resolve(); });
    });
    const citizens = createRealmCitizens({ db: pool, origin: 'simulated', kingdomNames: names, evidenceKey });
    // Stress: the same served realm, two wishes in flight and every authority step, with controlled answers in
    // place of model calls. It reproduces writer contention without spending real wishes.
    const controlled = createForgeProviders({ runCodex: async ({ model, image }) => {
      await pause(1500 + Math.floor(Math.random() * 2500));
      if (!model) return JSON.stringify({ draft: { plan: { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' },
        title: 'Sleeping keeper', plaque: 'Warm dreams above the hearth.' }, interpretation: 'as-wished', shared: 'subject' });
      return JSON.stringify({ answers: forgeJudgeQuestions(Boolean(image)).map(({ name }) => ({ type: 'predicate', name, probability: 0.01 })),
        subject: { motif: 'sleeping-dragon', slot: 'chimney' } });
    } });
    const baseProviders = mode === 'stress' ? controlled : createForgeProviders({ runCodex: async input => {
      check(mode !== 'prepare' && !usageLimit, 'model calls are disabled or a usage limit stopped this run.');
      const call = runCodexDraft({ ...input, onComplete: metric => {
        metrics.push(metric); if (metric.outcome === 'usage-limit') usageLimit = true;
      } });
      activeModelCalls.add(call);
      void call.finally(() => activeModelCalls.delete(call)).catch(() => {});
      return call;
    } });
    let sheetNumber = 0;
    const providers = { ...baseProviders, async judgeResult(input: ForgeResultInput) {
      const index = ++sheetNumber;
      check(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(input.contactSheet), 'rendered contact sheet is malformed.');
      await writeFile(join(directory, `sheet-${index}.png`), Buffer.from(input.contactSheet.split(',')[1]!, 'base64'), { mode: 0o600 });
      const verdict = await baseProviders.judgeResult(input);
      await writeFile(join(directory, `sheet-${index}.json`), JSON.stringify({ draft: input.draft, outcome: verdict.outcome, quality: verdict.quality ?? null }), { mode: 0o600 });
      return verdict;
    } };
    boot = createDurableRealmBoot({ pool, origin: 'simulated', foundedDirectory: join(directory, 'founded'),
      // The realm's own operational lines (storage failures are already described without connection details).
      log: line => { if (realmLines.length < 2_000) realmLines.push(`${Math.round(performance.now() - proofStarted)} ${line.slice(0, 400)}`); },
      verifier: new TenureEvidenceVerifier('simulated', evidenceKey), ingressCredentials: { herald: secret },
      foundedAccess: target => target.origin === 'simulated', furnish: citizens.furnish,
      // The shared development host runs at load 25 to 35; a fresh kingdom repeatedly failed to open inside a 15 s
      // writer lease there. The private proof holds its kingdom on a 60 s lease; production keeps REALM_LEASE_MS.
      repositoryOptions: { ...gate.install({ origin: 'simulated' }), leaseMs: 60_000 },
      attach: kingdom => evening!.attach(kingdom),
    });
    citizens.use(boot.allocation, boot.services);
    evening = new RealmEveningBridge({ origin: 'simulated', ingress: boot.ingress, gate, approvals, providers,
      forgeLog: event => { operations.push({ ...event, kingdomId: undefined, ms: Math.round(performance.now() - proofStarted) }); },
      beforeObservation: input => citizens.observe(input), forgeChatObserver: async observation => { observations.push(observation); } });
    evening.use(boot.services);
    summary.stage = 'layout';
    await adoptProofLayout(boot, kingdomId);
    await boot.readiness.start();
    summary.stage = 'citizens';
    const people = await settleProofPeople(boot, citizens, kingdomId, ids, mode !== 'twenty');
    hold = await boot.services.retain(kingdomId);
    const kingdom = hold.kingdom;
    let publicCommits = 0, publicLeak = false;
    off = kingdom.subscribe(delivery => {
      const text = JSON.stringify(delivery);
      if (text.includes(pilotWords) || FW10_WISHES.some(wish => text.includes(wish.words))) publicLeak = true;
      if (delivery.message.type === 'forge' && delivery.message.event.type === 'committed') publicCommits++;
    });
    runtime = boot.createServer({ mountIngress: app => mountEveningRoutes(app, evening!) });
    // This installed transport drops the hostname argument. Bind only this proof's native app;
    // keep transport.listen in charge of its socket so normal shutdown still closes it.
    const app = runtime.transport.app, nativeListen = app.listen.bind(app);
    type ListenCallback = Parameters<typeof app.listen>[2];
    let bound = false;
    app.listen = ((requestedPort: number, callback: ListenCallback) =>
      nativeListen('127.0.0.1', requestedPort, socket => { bound = Boolean(socket); callback(socket); })) as typeof app.listen;
    ownRealmShutdown(runtime.server, runtime.transport, cleanup);
    await closeReservation(); await runtime.server.listen(port, '127.0.0.1'); listening = true;
    check(bound, 'native loopback listener did not bind.'); summary.listenerHost = '127.0.0.1';
    const base = `http://127.0.0.1:${port}`;
    const post = async (route: string, body: unknown, authorized = true) => fetch(base + route, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: `Bearer ${secret}` } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.any([httpAbort.signal, AbortSignal.timeout(12_000)]),
    });
    check((await fetch(base + '/readyz', { signal: AbortSignal.timeout(5000) })).status === 200, 'served realm is not ready.');
    const sessionId = `proof-night-${randomUUID()}`, startedAt = Math.floor(kingdom.databaseNow()) - 660_000;
    let observationNumber = 0;
    const stream = (at: number) => ({ version: 1, observation: { version: 1, id: `proof-stream-${observationNumber++}`,
      kingdomId, origin: 'simulated', observedAt: at, kind: 'stream', live: true, sessionId } });
    check((await post(INGRESS_ROUTE, stream(startedAt), false)).status === 401, 'unauthenticated ingress was accepted.');
    check((await post(REALM_HERALD_ROUTE, { version: 1 }, false)).status === 401, 'unauthenticated private Forge ingress was accepted.');
    check((await post(INGRESS_ROUTE, { version: 1, command: { type: 'coal.creditQualifiedNight', personId: ids[0] } })).status === 400,
      'HTTP ingress accepted a balance command.');
    summary.stage = 'stream';
    check((await post(INGRESS_ROUTE, stream(startedAt))).status === 202, 'authenticated stream start was not accepted.');
    const sendHeartbeat = async () => {
      check((await post(INGRESS_ROUTE, stream(Math.floor(kingdom.databaseNow()) - 25))).status === 202, 'stream heartbeat was not accepted.');
    };
    await sendHeartbeat();
    await until(() => kingdom.privateState.stream.sessionId === sessionId && kingdom.privateState.stream.liveUntil > kingdom.databaseNow(), 15_000, 'committed stream evidence');
    summary.stage = 'coal';
    summary.qualification = await qualifyProofPeople(boot, kingdomId, people, sessionId);
    check(Object.keys(kingdom.privateState.attachments).length === 0 && Object.keys(kingdom.privateState.reservations).length === 0,
      'preparation created a piece or reservation.');
    summary.homes = people.length;
    // Keep this private configuration for the next served proof; it contains no database URL or copied credentials.
    await writeFile(join(directory, 'realm.json'), JSON.stringify({ kingdomId, people, foundedDirectory: join(directory, 'founded') }), { mode: 0o600 });
    summary.cliLaunch = await probeCliLaunch(directory);
    if (mode === 'pilot') {
      check((summary.cliLaunch as { started: boolean }).started, 'the served process cannot launch the CLI executable.');
      heartbeat = setInterval(() => {
        if (beat || heartbeatFailed) return;
        beat = sendHeartbeat().catch(() => { heartbeatFailed = true; }).finally(() => { beat = undefined; });
      }, 20_000); heartbeat.unref?.();
      const person = people[0]!, messageId = `proof-pilot-${randomUUID()}`, at = Math.floor(kingdom.databaseNow()) - 25;
      const observation = { version: 1, observation: { version: 1, id: `proof-chat-${randomUUID()}`, kingdomId,
        origin: 'simulated', observedAt: at, kind: 'observe', source: 'chat', coverage: 'activity',
        people: [{ personId: person.personId, disclosure: 'anonymous' }] } };
      check((await post(INGRESS_ROUTE, observation)).status === 202, 'chat witness was not accepted.');
      const command = { kingdomId, personId: person.personId, messageId, slot: person.slot, words: pilotWords, observedAt: at };
      summary.stage = 'wish'; summary.realWishes = 1;
      const began = performance.now();
      check((await post(REALM_HERALD_ROUTE, { version: 1, forge: { type: 'wish', origin: 'simulated', command } })).status === 202,
        'private Herald-shaped wish was not accepted.');
      await until(() => observations.some(o => o.messageId === messageId && o.status !== 'working'), 220_000, 'real Forge outcome');
      const outcome = observations.filter(o => o.messageId === messageId).at(-1)!;
      summary.outcome = outcome.status; summary.seconds = Math.round((performance.now() - began) / 10) / 100;
      summary.modelCalls = metrics.length; summary.usageLimit = usageLimit; summary.heartbeatFailed = heartbeatFailed;
      const made = Object.values(kingdom.privateState.attachments).filter(a => a.forgeKey === forgeMessageKey(kingdomId, messageId));
      const ledger = await pool.query<{ delta: number }>('select delta from realm_coal_ledger where kingdom_id=$1 and person_id=$2 order by seq', [kingdomId, person.personId]);
      summary.attachments = made.length; summary.spent = ledger.rows.filter(row => row.delta === -1).length;
      check(!publicLeak && !heartbeatFailed, 'public privacy or stream heartbeat check failed.');
      if (outcome.status === 'delivered') {
        check(made.length === 1 && summary.spent === 1 && kingdom.privateState.coals[person.personId] === 0, 'delivered piece did not spend exactly one earned coal.');
        await until(() => publicCommits === 1, 15_000, 'durable public commit');
        check((await post(REALM_HERALD_ROUTE, { version: 1, forge: { type: 'wish', origin: 'simulated', command } })).status === 202,
          'duplicate Herald wish was not accepted.');
        // The existing authority, not a sleep or local success timer, proves no second model run or coal spend.
        const duplicate = await evening.run(command);
        check(duplicate.kind === 'already-committed', 'duplicate wish was not recovered from actual committed authority.');
        check(metrics.length === summary.modelCalls && publicCommits === 1, 'duplicate wish reran the model or public completion.');
      } else check(made.length === 0 && summary.spent === 0 && kingdom.privateState.coals[person.personId] === 1,
        'a private non-delivery made a piece or spent coal.');
      summary.publicCommits = publicCommits;
      check(metrics.length > 0, 'pilot finished without invoking a real model.');
      if (usageLimit) {
        summary.stage = 'blocked'; summary.blocked = 'codex limit'; summary.ok = false; process.exitCode = 3;
        return;
      }
      check(metrics.some(metric => metric.outcome === 'complete'), 'pilot could not complete a model call.');
      check(outcome.status === 'delivered', 'the real pilot did not produce an authoritative delivery.');
    }
    if (mode === 'twenty' || mode === 'stress') {
      if (mode === 'twenty') check((summary.cliLaunch as { started: boolean }).started, 'the served process cannot launch the CLI executable.');
      heartbeat = setInterval(() => {
        if (beat || heartbeatFailed) return;
        beat = sendHeartbeat().catch(() => { heartbeatFailed = true; }).finally(() => { beat = undefined; });
      }, 20_000); heartbeat.unref?.();
      summary.stage = 'twenty';
      const rows: Record<string, unknown>[] = [], landed: { id: string; blueprint: Parameters<typeof renderForgeCertificationSheet>[0][number] }[] = [];
      const wishes = FW10_WISHES.map((wish, index) => ({ wish, person: people[index]! }));
      let next = 0;
      // At most two wishes in flight, as the lane's test rules require.
      const worker = async () => {
        while (next < wishes.length && !usageLimit) {
          const { wish, person } = wishes[next++]!;
          const messageId = `proof-twenty-${wish.id}-${randomUUID()}`, at = Math.floor(kingdom.databaseNow()) - 25;
          const row: Record<string, unknown> = { id: wish.id, category: wish.category, family: person.family, length: wish.words.length,
            startedMs: Math.round(performance.now() - proofStarted) };
          rows.push(row);
          if (wish.words.length > FORGE_CHAT_LIMITS.words) {
            // The frozen overlong wish exceeds the shared 240-character intake contract; nothing is posted.
            row.outcome = 'not-admitted'; row.reason = 'exceeds the shared 240-character wish contract'; continue;
          }
          const observation = { version: 1, observation: { version: 1, id: `proof-chat-${randomUUID()}`, kingdomId,
            origin: 'simulated', observedAt: at, kind: 'observe', source: 'chat', coverage: 'activity',
            people: [{ personId: person.personId, disclosure: 'anonymous' }] } };
          const witnessBegan = performance.now();
          // As Herald does: the same observation is resent on any other answer or a lost reply (idempotent by id).
          let witness = '';
          for (let send = 0; send < 4 && witness !== '202' && !httpAbort.signal.aborted; send++) {
            if (send) await pause(1000);
            witness = await post(INGRESS_ROUTE, observation).then(response => String(response.status), error => error instanceof Error ? error.name : 'error');
            row.witnessSends = send + 1;
          }
          row.witnessSeconds = Math.round((performance.now() - witnessBegan) / 100) / 10;
          if (witness !== '202') { row.outcome = 'not-admitted'; row.reason = `chat witness ${witness}`; continue; }
          const command = { kingdomId, personId: person.personId, messageId, slot: person.slot, words: wish.words, observedAt: at };
          const began = performance.now();
          if (mode === 'twenty') summary.realWishes = (summary.realWishes as number) + 1;
          const response = await post(REALM_HERALD_ROUTE, { version: 1, forge: { type: 'wish', origin: 'simulated', command } });
          if (response.status !== 202) { row.outcome = 'not-admitted'; row.reason = `herald route ${response.status}`; continue; }
          try { await until(() => observations.some(o => o.messageId === messageId && o.status !== 'working'), 240_000, 'real Forge outcome'); }
          catch { row.outcome = 'timeout'; continue; }
          const outcome = observations.filter(o => o.messageId === messageId).at(-1)!;
          const key = forgeMessageKey(kingdomId, messageId), audit = audits.get(key);
          const made = Object.values(kingdom.privateState.attachments).filter(a => a.forgeKey === key);
          const selected = audit?.verdicts[audit.selection?.verdict ?? 1];
          Object.assign(row, { outcome: outcome.status, seconds: Math.round((performance.now() - began) / 100) / 10,
            attempts: audit?.attempts ?? null, modelCalls: audit?.modelCalls ?? null, delivery: audit?.selection?.delivery ?? null,
            reason: audit?.selection?.reason ?? null, shared: audit?.selection?.shared ?? null, quality: selected?.quality?.score ?? null,
            recognisability: selected?.quality?.recognisability ?? null, detailMatch: selected?.detailMatch ?? null,
            wordsReading: audit?.verdicts[0]?.subject ?? null, resultReading: selected?.subject ?? null,
            plan: made[0] ? { motif: made[0].attachment.draft.plan.motif, kind: made[0].attachment.draft.plan.kind, finish: made[0].attachment.draft.plan.finish } : null,
            certificate: selected?.measure?.certificate ?? null, attachments: made.length,
            message: 'message' in outcome ? outcome.message : null, endedMs: Math.round(performance.now() - proofStarted) });
          if (made[0]) {
            const home = Object.values(kingdom.privateState.homes).find(home => home.ownerId === person.personId)!;
            const piece = made[0].attachment;
            const socket = findForgeSockets(home.blueprint, 'street-home', piece.kitRevision).find(socket => socket.id === piece.socketId)!;
            landed.push({ id: wish.id, blueprint: assembleForge(piece.draft.plan, forgeStyleKit(home.family, piece.kitRevision), socket).blueprint });
          }
          await writeFile(join(directory, 'twenty.json'), JSON.stringify(rows, null, 2), { mode: 0o600 });
        }
      };
      await Promise.all([worker(), worker()]);
      rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      landed.sort((a, b) => a.id.localeCompare(b.id));
      summary.twenty = rows; summary.landedOrder = landed.map(piece => piece.id);
      if (landed.length) await writeFile(join(directory, 'landed.png'),
        Buffer.from(renderForgeCertificationSheet(landed.map(piece => piece.blueprint), 5).split(',')[1]!, 'base64'), { mode: 0o600 });
      const ledger = await pool.query<{ person_id: string; delta: number }>('select person_id, delta from realm_coal_ledger where kingdom_id=$1 and delta=-1', [kingdomId]);
      summary.spent = ledger.rows.length; summary.modelCalls = metrics.length; summary.usageLimit = usageLimit;
      summary.publicCommits = publicCommits; summary.heartbeatFailed = heartbeatFailed;
      check(!publicLeak, 'a wish reached a public delivery.');
      if (usageLimit) { summary.stage = 'blocked'; summary.blocked = 'codex limit'; summary.ok = false; process.exitCode = 3; return; }
    }
    summary.stage = 'complete'; summary.ok = true;
  } catch (error) {
    summary.ok = false;
    summary.error = error instanceof Error && error.message.startsWith('Proof:') ? error.message : describeStorageFailure(error);
    // A database SQLSTATE or Node error code only: never a message that could carry connection details.
    const code = (error as { code?: unknown; cause?: { code?: unknown } } | undefined)?.code ?? (error as { cause?: { code?: unknown } } | undefined)?.cause?.code;
    if (typeof code === 'string' && /^[A-Z0-9_]{2,32}$/.test(code)) summary.errorCode = code;
    if (error instanceof Error) summary.errorName = error.name;
    // Application errors only: anything that could name a host, user or address stays out.
    if (error instanceof Error && !code && !/postgres|:\/\/|password|@|host/i.test(error.message)) summary.errorDetail = error.message.slice(0, 200);
    process.exitCode = 1;
  } finally {
    try { await closeReservation(); }
    finally {
      try { if (runtime && listening) await runtime.server.gracefullyShutdown(false); else await cleanup(); }
      finally {
        await cleanup();
        await flush();
        console.info(JSON.stringify({ ...summary, directory }));
      }
    }
  }
}
