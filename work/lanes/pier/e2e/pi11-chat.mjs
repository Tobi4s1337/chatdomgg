// PI11 end to end: chat fishing (`!fish`) on the lane's own stack. The run plays Herald over HTTP with the realm's real
// Herald secret (a fresh random one per run, never printed): it reports a live stream and two SIMULATED chatters, relays
// their chat, deletes a message and times a chatter out, and watches the public pier feed, the kingdom watch and the
// Almanac. Real Twitch is never touched. Run through ./run-chat.sh, which loads DATABASE_URL without printing it.
// Writes work/evidence/pier/pi11-chat-run.json and .log (a failed run: pi11-chat-run-failed.json and .log). See PI11.md.
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile, copyFile, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { preview as startPreview, runnerImport } from 'vite';
import { chromium } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const KINGDOM = '129634568';
const KINGDOM_NAME = 'Willowmere';
const SCHEMA = 'pier';
const STACK = process.env.PIER_E2E_STACK ?? '/tmp/chatdom-pier-stack';
const SOURCE_SCENE = process.env.PIER_FOUNDED_SCENE ?? '/tmp/chatdom-pier-founded/scene.json';
const SOURCE_MANIFEST = process.env.PIER_FOUNDED_MANIFEST ?? '/tmp/chatdom-pier-founded-manifest.json';
const SAOIRSE = { personId: process.env.PI11_FIRST_CHATTER ?? '990200001', name: 'saoirse_k' };
const QUIET = { personId: process.env.PI11_SECOND_CHATTER ?? '990200002', name: 'quiet_one' };
const EVIDENCE = join(ROOT, 'work/evidence/pier');
/** The lane's web build the stream view is served from (vite preview, proxied to this run's realm). */
const WEB_DIST = process.env.PIER_E2E_WEB_DIST ?? '/tmp/chatdom-pier-e2e-web';
const REALM_LISTENING = /SIMULATED realm on \d+: adopted durable Postgres kingdoms/;
const MAX_CASTS = Number(process.env.PI11_MAX_CASTS ?? 4);
const QUIET_CASTS = Number(process.env.PI11_QUIET_CASTS ?? 3);
const HEARTBEAT_MS = 30_000;
/** How long the run listens for a beat that must not come (a second line, a pier event for ordinary chat). */
const QUIET_WINDOW_MS = 4_000;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) { console.error('DATABASE_URL is not loaded; run work/lanes/pier/e2e/run-chat.sh.'); process.exit(2); }
if (process.env.REALM_DATABASE_SCHEMA !== SCHEMA) { console.error('REALM_DATABASE_SCHEMA must be pier; run work/lanes/pier/e2e/run-chat.sh.'); process.exit(2); }
if (!STACK.startsWith('/tmp/') || STACK.startsWith(ROOT)) { console.error('The stack directory must live outside the repository, under /tmp.'); process.exit(2); }

// The mock Herald's secret: fresh for this run, handed only to the realm child and this process's requests.
const heraldSecret = randomBytes(36).toString('base64url');
const runStarted = Date.now(), lines = [];
const scrub = text => String(text).split(databaseUrl).join('<database>').split(heraldSecret).join('<herald-secret>')
  .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '<database>');
const since = () => Date.now() - runStarted;
const log = line => { const stamped = `[${(since() / 1000).toFixed(1).padStart(6)}s] ${scrub(line)}`; lines.push(stamped); console.log(stamped); };
const evidence = { version: 1, goal: 'PI11', check: 'chat fishing end to end: a present chatter\'s `!fish` casts a light\'s float at the pier, '
  + 'the fish is caught and kept with via chat, the Almanac and Postgres show it; rate limits, a deleted `!fish`, a timeout and ordinary chat behave.',
  startedAt: new Date(runStarted).toISOString(), passed: false, simulated: 'SIMULATED: the Herald, the stream and both chatters are simulated by this run; real Twitch is never touched.',
  chatters: { first: SAOIRSE, second: QUIET }, steps: [] };
const step = async (name, run) => {
  const started = Date.now(); log(`-- ${name}`);
  try { const result = await run(); evidence.steps.push({ name, ok: true, atMs: started - runStarted, ms: Date.now() - started }); return result; }
  catch (error) { evidence.steps.push({ name, ok: false, atMs: started - runStarted, ms: Date.now() - started, error: scrub(error?.message ?? error) }); throw error; }
};
const assert = (condition, message) => { if (!condition) throw new Error(`Check failed: ${message}`); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(label, ms, probe, every = 100) {
  const ends = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > ends) throw new Error(`Timed out after ${ms} ms waiting for ${label}.`);
    await delay(every);
  }
}

// Processes (the PI10 helpers, unchanged in behaviour) ---------------------------------------------------------------

const children = new Set();
async function freePort(taken) {
  for (let port = 5170; port <= 5186; port++) {
    if (taken.includes(port)) continue;
    let ok = true;
    for (const host of ['127.0.0.1', '0.0.0.0']) {
      const probe = createServer();
      try { await new Promise((ready, reject) => { probe.once('error', reject); probe.listen({ port, host, exclusive: true }, ready); }); }
      catch { ok = false; }
      finally { await new Promise(ready => probe.listening ? probe.close(() => ready()) : ready()); }
      if (!ok) break;
    }
    if (ok) return port;
  }
  return null;
}
async function waitForPort() {
  const ends = Date.now() + Number(process.env.PIER_E2E_PORT_WAIT_MS ?? 30 * 60_000);
  let said = false;
  for (;;) {
    const port = await freePort([]);
    if (port !== null) return port;
    if (Date.now() > ends) throw new Error('No free lane port in 5170-5186.');
    if (!said) { log('waiting for a free port in 5170-5186'); said = true; }
    await delay(10_000);
  }
}
async function run(label, command, args, options = {}) {
  log(`$ ${[command, ...args].join(' ')}`);
  const child = spawn('nice', ['-n', '10', command, ...args], { cwd: options.cwd ?? ROOT, env: options.env ?? childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  const out = [];
  child.stdout.on('data', d => out.push(String(d))); child.stderr.on('data', d => out.push(String(d)));
  const code = await new Promise(resolve => child.on('exit', resolve));
  for (const line of out.join('').split('\n').filter(Boolean).slice(-20)) log(`  ${label}: ${line}`);
  if (code !== 0) throw new Error(`${label} exited ${code}.`);
}
function childEnv(extra = {}) {
  // Only what the processes need: no other variable from the loaded environment file is passed on.
  return { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8', DATABASE_URL: databaseUrl, REALM_DATABASE_SCHEMA: SCHEMA, ...extra };
}
async function serve(label, script, cwd, env, ready, listening = null) {
  await mkdir(join(STACK, 'logs'), { recursive: true });
  const file = await open(join(STACK, 'logs', `${label}.log`), 'a');
  const child = spawn('nice', ['-n', '10', process.execPath, script], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  const output = [];
  let heard = listening === null;
  const take = data => { const text = scrub(data); output.push(text); if (listening?.test(text)) heard = true; void file.write(text); for (const line of text.split('\n').filter(Boolean)) log(`  ${label}: ${line}`); };
  child.stdout.on('data', take); child.stderr.on('data', take);
  const exited = new Promise(resolve => child.on('exit', (code, signal) => { children.delete(child); void file.close(); resolve({ code, signal }); }));
  const started = Date.now();
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const text = output.join(''), error = new Error(`${label} exited before it was ready${/EADDRINUSE|already in use/.test(text) ? ': its port is already in use' : ''}.`);
      throw Object.assign(error, { output: text });
    }
    if (heard) { try { if (await ready()) break; } catch { /* not answering yet */ } }
    if (Date.now() - started > 15 * 60_000) throw new Error(`${label} was not ready in 15 minutes.`);
    await delay(500);
  }
  log(`${label} ready in ${Date.now() - started} ms (pid ${child.pid})`);
  return { child, exited, readyMs: Date.now() - started,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return exited;
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
      const result = await exited; clearTimeout(timer); return result;
    } };
}
const cleanup = async () => { for (const child of [...children]) child.kill('SIGTERM'); };
process.on('SIGINT', () => { void cleanup().then(() => process.exit(130)); });

// Server-sent events -------------------------------------------------------------------------------------------------

/** One SSE connection: named events with their JSON data. Reconnects are the caller's choice. */
function sse(url, onEvent) {
  const controller = new AbortController();
  const done = (async () => {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'text/event-stream' } });
    if (!response.ok || !/text\/event-stream/.test(response.headers.get('content-type') ?? '')) {
      const body = await response.text().catch(() => '');
      throw Object.assign(new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`), { status: response.status });
    }
    onEvent({ event: 'open', data: null });
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        let event = 'message'; const data = [];
        for (const line of block.split('\n')) {
          if (line.startsWith(':')) continue;
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (!data.length) continue;
        let parsed; try { parsed = JSON.parse(data.join('\n')); } catch { parsed = data.join('\n'); }
        onEvent({ event, data: parsed });
      }
    }
  })();
  return { close: () => controller.abort(), done };
}

// The run ----------------------------------------------------------------------------------------------------------

let realm = null, db = null, kingdomWatch = null, pierFeed = null, heartbeat = null, stopping = false;
/** The stream view: the lane's web build in a browser, drawing the realm's real public pier feed. */
let web = null, browser = null, streamPage = null;
/** What the public kingdom watch and the public pier feed showed; both go into the evidence, passing or failing. */
const watch = { frames: [], latest: null, cues: [], connections: [], revisions: [], closed: [] };
const feed = { events: [], connections: [] };
const slots = new Map();
try {
  const imp = async path => (await runnerImport(join(ROOT, path), { root: ROOT, configFile: false, logLevel: 'warn' })).module;
  const source = await step('verify the copied founded scene', async () => {
    const bytes = await readFile(SOURCE_SCENE), manifest = JSON.parse(await readFile(SOURCE_MANIFEST, 'utf8'));
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert(hash === manifest.sceneHash, 'the copied scene matches the live receipt it was fetched with');
    const scene = JSON.parse(bytes);
    assert(scene.kingdomId === KINGDOM && manifest.kingdomId === KINGDOM, 'the copy is tobi4s_\'s kingdom');
    evidence.sourceScene = { sceneHash: hash, origin: scene.origin, kingdomId: scene.kingdomId, layoutRevision: scene.layoutRevision, placements: scene.placements.length };
    log(`copied scene ${hash.slice(0, 16)}…: kingdom ${scene.kingdomId}, ${scene.placements.length} placements`);
    return scene;
  });

  await step('build the realm', async () => {
    if (process.env.PIER_E2E_SKIP_BUILD === '1' && existsSync(join(ROOT, 'apps/realm/dist/realm.mjs'))) { log('reusing the existing build (PIER_E2E_SKIP_BUILD=1)'); return; }
    await run('realm build', 'pnpm', ['--filter', '@chatdom/realm', 'build']);
  });
  await step('build the lane\'s web client for the stream view', async () => {
    if (process.env.PIER_E2E_SKIP_BUILD === '1' && existsSync(join(WEB_DIST, 'index.html'))) { log(`reusing the existing web build in ${WEB_DIST} (PIER_E2E_SKIP_BUILD=1)`); return; }
    await run('web build', 'npx', ['vite', 'build', 'apps/web', '--outDir', WEB_DIST, '--emptyOutDir', '--logLevel', 'warn'],
      { env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8' } });
  });
  await step('migrate schema pier', () => run('migrate', process.execPath, ['apps/realm/scripts/migrate.mjs', '--schema', SCHEMA]));

  const support = await imp('work/lanes/pier/e2e/pi11-support.ts');
  evidence.seed = await step('adopt the copied plan for kingdom 129634568 (simulated origin, schema pier)', async () => {
    const seeded = await support.seedKingdom({ databaseUrl, schema: SCHEMA, kingdomId: KINGDOM, plan: source.plan });
    log(`layout ${seeded.status}: ${seeded.revision}, plan sha256 ${seeded.planDigest.slice(0, 16)}…`);
    return seeded;
  });

  db = support.readOnlyDatabase(databaseUrl, SCHEMA);
  const people = [SAOIRSE.personId, QUIET.personId];
  let clock = { offsetMs: 0, rttMs: 0 };
  /** Herald stamps with its own clock; this run stamps with the database's, a little behind, so it is never in the future. */
  const stamp = () => Math.floor(Date.now() + clock.offsetMs) - 250;
  evidence.before = await step('read the starting state (read-only, schema pier)', async () => {
    clock = await db.clockOffset();
    const state = { clock, deeds: await db.deeds(KINGDOM, people), hidden: await db.hidden(KINGDOM, people), catches: await db.catchCounts(KINGDOM),
      saoirseCatches: await db.catchesOf(KINGDOM, SAOIRSE.personId), quietCatches: await db.catchesOf(KINGDOM, QUIET.personId) };
    log(`database clock offset ${clock.offsetMs} ms (rtt ${clock.rttMs} ms); deeds ${state.deeds.length}; hidden ${state.hidden.length}; catches ${JSON.stringify(state.catches)}`);
    return state;
  });

  // The realm --------------------------------------------------------------------------------------------------------
  const foundedDirectory = join(STACK, 'founded');
  await mkdir(foundedDirectory, { recursive: true }); await mkdir(join(STACK, 'source'), { recursive: true });
  await copyFile(SOURCE_SCENE, join(STACK, 'source', 'scene.json'));
  let realmUrl = '';
  evidence.realm = await step('start the realm with a fresh Herald secret on a free lane port', async () => {
    for (let attempt = 1; ; attempt++) {
      const port = await waitForPort();
      realmUrl = `http://127.0.0.1:${port}`;
      log(`attempt ${attempt}: realm 127.0.0.1:${port}`);
      try {
        realm = await serve('realm', join(ROOT, 'apps/realm/dist/realm.mjs'), join(ROOT, 'apps/realm'), childEnv({
          REALM_SIMULATED: '1', REALM_STORAGE: 'postgres', REALM_PIER_FISHING: '1', REALM_FOUNDED_DIRECTORY: foundedDirectory,
          REALM_PORT: String(port), REALM_HOST: '127.0.0.1', REALM_EVIDENCE_KEY: randomBytes(32).toString('hex'),
          // A chatter's home is furnished only under an approved kingdom name (evening/citizens.ts `furnish`).
          REALM_ENTRY_KINGDOM_ID: KINGDOM, REALM_ENTRY_KINGDOM_NAME: KINGDOM_NAME, REALM_INGRESS_HERALD_SECRET: heraldSecret,
        }), async () => (await fetch(`${realmUrl}/readyz`, { signal: AbortSignal.timeout(1500) })).ok, REALM_LISTENING);
        return { port, readyMs: realm.readyMs, kingdomName: KINGDOM_NAME, flags: ['REALM_SIMULATED=1', 'REALM_STORAGE=postgres', 'REALM_PIER_FISHING=1', 'REALM_INGRESS_HERALD_SECRET=<fresh, 48 chars>'] };
      } catch (error) { realm = null; if (attempt < 6 && /in use/.test(error.message)) continue; throw error; }
    }
  });

  // The mock Herald ----------------------------------------------------------------------------------------------------
  evidence.herald = [];
  const post = async (route, body, label) => {
    const started = Date.now();
    for (let attempt = 1; ; attempt++) {
      let status = 0, reply = null;
      try {
        const response = await fetch(`${realmUrl}${route}`, { method: 'POST', headers: { authorization: `Bearer ${heraldSecret}`, 'content-type': 'application/json' },
          body: JSON.stringify(body), signal: AbortSignal.timeout(240_000) });
        status = response.status; reply = await response.json().catch(() => null);
      } catch (error) { status = 0; reply = { error: scrub(error.message) }; }
      const record = { label, route, attempt, atMs: started - runStarted, ms: Date.now() - started, http: status, reply };
      evidence.herald.push(record);
      // A cold kingdom open can fail inside its writer lease; Herald sends the same idempotent observation again.
      if (status === 503 && route === support.routes.ingress && attempt < 12) { log(`${label}: 503 (${reply?.message ?? ''}); sending again in 16 s`); await delay(16_000); continue; }
      return record;
    }
  };
  const observe = async (input, label) => post(support.routes.ingress, { version: 1, observation: support.checkPresence({ version: 1, kingdomId: KINGDOM, origin: 'simulated', ...input }) }, label);
  const sessionToken = `pi11-${runStarted}`;
  const streamLive = () => { const at = stamp(); return observe({ id: `stream:${sessionToken}.${at}`, observedAt: at, kind: 'stream', live: true, sessionId: `session:${sessionToken}` }, 'stream live'); };
  const chatters = () => observe({ id: `sweep:${randomUUID()}`, observedAt: stamp(), kind: 'observe', source: 'chatters', coverage: 'partial',
    people: people.map(personId => ({ personId, disclosure: 'anonymous' })) }, 'chatters sweep');
  /** One chat message as Herald delivers it: the presence observation for the message, then the relay to the realm. */
  const say = async (who, text, label) => {
    const messageId = randomUUID(), at = stamp();
    const seen = await observe({ id: `chat:${messageId}`, observedAt: at, kind: 'observe', source: 'chat', coverage: 'activity',
      people: [{ personId: who.personId, disclosure: 'named', displayName: who.name }] }, `${label}: presence`);
    assert(seen.http === 202, `${label}: the chat observation is accepted (got ${seen.http} ${JSON.stringify(seen.reply)})`);
    const relay = await post(support.routes.herald, support.checkHerald({ version: 1, chat: { version: 1, id: messageId, kingdomId: KINGDOM, personId: who.personId,
      origin: 'simulated', asOf: at, expiresAt: at + 10_000, parts: [{ kind: 'text', text }] } }), `${label}: chat`);
    log(`${label}: ${who.name} says "${text}" (message ${messageId.slice(0, 8)}) -> ${relay.http} ${relay.reply?.status ?? JSON.stringify(relay.reply)}`);
    return { messageId, at, sentAtMs: since(), relay };
  };
  const cleanupChat = async (body, label) => {
    const reply = await post(support.routes.herald, support.checkHerald({ version: 1, chatCleanup: { origin: 'simulated', kingdomId: KINGDOM, ...body } }), label);
    // Herald pairs every chat cleanup with the Forge's (realm-delivery/delivery.ts `remove`/`clear`).
    const forge = body.type === 'remove' ? { type: 'cancel', origin: 'simulated', kingdomId: KINGDOM, messageId: body.messageIds[0] }
      : { type: 'clear', origin: 'simulated', kingdomId: KINGDOM, ...(body.personId ? { personId: body.personId } : {}) };
    const paired = await post(support.routes.herald, support.checkHerald({ version: 1, forge }), `${label} (forge)`);
    log(`${label}: ${reply.http} ${reply.reply?.status}; forge ${paired.http} ${paired.reply?.status}`);
    return reply;
  };

  // The public kingdom watch: it holds the kingdom open, and its frames show whose windows are lit ----------------------
  const remember = frame => {
    if (!frame?.windows || (watch.latest && frame.sequence <= watch.latest.sequence && frame.epoch === watch.latest.epoch)) return;
    watch.latest = frame;
    const ours = frame.windows.filter(w => w.publicName === SAOIRSE.name || w.publicName === QUIET.name || slots.has(w.slot));
    watch.frames.push({ atMs: since(), sequence: frame.sequence, asOf: frame.asOf, streamLive: frame.streamLive, connection: frame.connection, ours });
  };
  const connectWatch = () => {
    const opened = Date.now(), connection = { startedMs: opened - runStarted, ok: false };
    watch.connections.push(connection);
    const handle = sse(`${realmUrl}${support.routes.watch(KINGDOM)}`, ({ event, data }) => {
      if (event === 'checkpoint') {
        connection.ok = true; connection.checkpointMs = Date.now() - opened;
        connection.collisionRevision = data.checkpoint.collisionRevision; connection.sceneHash = data.manifest.sceneHash;
        for (const message of data.checkpoint.current) if (message.type === 'presence') remember(message.frame);
        log(`kingdom watch: checkpoint after ${connection.checkpointMs} ms (scene ${data.manifest.sceneHash.slice(0, 12)}…, collision ${data.checkpoint.collisionRevision})`);
      } else if (event === 'world' && data?.message?.type === 'presence') remember(data.message.frame);
      else if (event === 'transient' && data?.type === 'chat') watch.cues.push({ atMs: since(), slot: data.cue.slot, id: data.cue.id, asOf: data.cue.asOf, parts: data.cue.parts });
      else if (event === 'transient' && (data?.type === 'chat.remove' || data?.type === 'chat.clear')) watch.cues.push({ atMs: since(), type: data.type });
      else if (event === 'revision') { watch.revisions.push({ atMs: since(), ...data }); log(`kingdom watch: new revision ${JSON.stringify(data)}`); }
      else if (event === 'closed') { watch.closed.push({ atMs: since(), ...data }); log(`kingdom watch: closed (${data?.reason})`); }
    });
    handle.done.then(() => { connection.endedMs = since(); }, error => { connection.endedMs = since(); connection.error = scrub(error.message); if (!stopping) log(`kingdom watch: ${scrub(error.message)}`); })
      .finally(() => { if (!stopping && kingdomWatch === handle) { setTimeout(() => { if (!stopping) kingdomWatch = connectWatch(); }, connection.ok ? 1_000 : 16_000); } });
    return handle;
  };
  await step('open the public kingdom watch (it holds the kingdom open; first open is cold)', async () => {
    kingdomWatch = connectWatch();
    await until('the kingdom watch checkpoint', 20 * 60_000, () => watch.connections.some(c => c.ok), 500);
  });

  // The public pier feed: every event, stamped -----------------------------------------------------------------------
  const connectFeed = () => {
    const connection = { startedMs: since(), ok: false };
    feed.connections.push(connection);
    const handle = sse(`${realmUrl}${support.routes.pierWatch(KINGDOM)}`, ({ event, data }) => {
      if (event === 'open') { connection.ok = true; return; }
      if (event !== 'pier') return;
      feed.events.push({ atMs: since(), wall: new Date().toISOString(), event: data });
      const e = data, who = e.who ?? e.line?.who;
      log(`pier: ${e.kind}${e.line ? ` ${e.line.phase} ${e.line.id.slice(0, 8)}` : e.id ? ` ${e.id.slice(0, 8)}` : ''}${who ? ` ${who.name ?? '(no name)'} slot ${who.slot} ${who.colour}` : ''}`
        + `${e.reason ? ` ${e.reason}` : ''}${e.fish ? ` ${e.fish.speciesId} ${e.fish.weightG} g ${e.fish.lengthMm} mm first ${e.kingdomFirst} keepsake ${e.keepsake}` : ''}${e.kind === 'lines' ? ` ${e.lines.length}/${e.cap}` : ''}`);
    });
    handle.done.then(() => { connection.endedMs = since(); }, error => { connection.endedMs = since(); connection.error = scrub(error.message); if (!stopping) log(`pier feed: ${scrub(error.message)}`); })
      .finally(() => { if (!stopping && pierFeed === handle) setTimeout(() => { if (!stopping) pierFeed = connectFeed(); }, 1_000); });
    return handle;
  };
  const eventsAfter = index => feed.events.slice(index).map(e => e.event);
  const nextEvent = (label, from, match, ms) => until(label, ms, () => feed.events.slice(from).find(e => match(e.event)), 50);

  // Steps ------------------------------------------------------------------------------------------------------------
  await step('report a live SIMULATED stream', async () => {
    const reply = await streamLive();
    assert(reply.http === 202, `the stream observation is accepted (got ${reply.http} ${JSON.stringify(reply.reply)})`);
  });
  heartbeat = setInterval(() => { void streamLive(); void chatters(); }, HEARTBEAT_MS);

  evidence.presence = await step('observe saoirse_k and quiet_one chatting: they are settled and their windows lit', async () => {
    for (const who of [SAOIRSE, QUIET]) {
      const at = stamp(), messageId = randomUUID();
      const reply = await observe({ id: `chat:${messageId}`, observedAt: at, kind: 'observe', source: 'chat', coverage: 'activity',
        people: [{ personId: who.personId, disclosure: 'named', displayName: who.name }] }, `${who.name} arrives in chat`);
      assert(reply.http === 202, `${who.name}'s chat observation is accepted (got ${reply.http} ${JSON.stringify(reply.reply)})`);
      log(`${who.name} observed in chat: ${reply.reply?.status} after ${reply.ms} ms (${reply.attempt} attempt(s))`);
    }
    const lit = await until('both windows lit in the presence frame', 15 * 60_000, () => {
      const frame = watch.latest;
      if (!frame || !frame.streamLive) return null;
      const a = frame.windows.find(w => w.present && w.publicName === SAOIRSE.name), b = frame.windows.find(w => w.present && w.publicName === QUIET.name);
      return a && b ? { frame, a, b } : null;
    }, 250);
    slots.set(lit.a.slot, SAOIRSE.name); slots.set(lit.b.slot, QUIET.name);
    const deeds = await db.deeds(KINGDOM, people);
    log(`lit: saoirse_k slot ${lit.a.slot} since ${lit.a.since}, quiet_one slot ${lit.b.slot} since ${lit.b.since} (frame ${lit.frame.sequence}, ${lit.frame.windows.length} windows, ${lit.frame.windows.filter(w => w.present).length} present)`);
    assert(deeds.length === 2 && deeds.find(d => d.person_id === SAOIRSE.personId)?.slot === lit.a.slot && deeds.find(d => d.person_id === QUIET.personId)?.slot === lit.b.slot,
      'each chatter holds a home whose slot is the lit window');
    return { saoirse: { slot: lit.a.slot, since: lit.a.since }, quiet: { slot: lit.b.slot, since: lit.b.since }, frame: { sequence: lit.frame.sequence, asOf: lit.frame.asOf,
      windows: lit.frame.windows.length, present: lit.frame.windows.filter(w => w.present).length }, deeds };
  });
  const saoirseSlot = evidence.presence.saoirse.slot, quietSlot = evidence.presence.quiet.slot;

  await step('open the pier feed', async () => {
    pierFeed = connectFeed();
    const first = await nextEvent('the pier feed\'s first snapshot', 0, e => e.kind === 'lines', 60_000);
    log(`pier feed open: ${first.event.lines.length} line(s) in the water, cap ${first.event.cap}`);
  });

  // The stream view on the lane's own build: the chat floats drawn from this realm's public feed, as a stream hears it.
  const STREAM_ROUTE = `/-/pier?view=chat&feed=live&kingdom=${KINGDOM}`;
  evidence.streamView = await step('open the stream view on the lane\'s build, on this realm\'s public pier feed', async () => {
    const port = await waitForPort();
    // The vite config reads the realm target from the process, so the preview's proxy reaches this run's realm.
    process.env.CHATDOM_REALM_TARGET = realmUrl;
    web = await startPreview({ root: join(ROOT, 'apps/web'), logLevel: 'warn', build: { outDir: WEB_DIST },
      preview: { host: '127.0.0.1', port, strictPort: true } });
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
    streamPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    streamPage.on('pageerror', error => log(`  stream view: ${error.message}`));
    streamPage.on('console', message => { if (/^pier feed/.test(message.text()) || message.type() === 'error') log(`  stream view: ${message.text()}`); });
    await streamPage.goto(`http://127.0.0.1:${port}${STREAM_ROUTE}`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await streamPage.waitForFunction(() => window.__chatdomReady === true || !!window.__chatdomPierError, null, { timeout: 600_000, polling: 500 });
    const failed = await streamPage.evaluate(() => window.__chatdomPierError ?? null);
    assert(!failed, `the stream view draws the pier (${failed})`);
    log(`stream view drawing on 127.0.0.1:${port} (SwiftShader: no GPU on this host)`);
    return { port, route: STREAM_ROUTE, viewport: '1920x1080', renderer: 'SwiftShader' };
  });
  // A still of one beat on the stream view. The page was armed to stop its own clock the moment that beat arrives
  // (a little ahead, so it has fully entered): software frames here can outlast a card's few seconds.
  const streamShot = async (name, key, timeout) => {
    const stats = await streamPage.waitForFunction(field => {
      const now = window.__chatdomChat?.stats();
      return now && now[field] > 0 ? now : null;
    }, key, { timeout, polling: 100 }).then(handle => handle.jsonValue());
    const path = join(EVIDENCE, `${name}@1920x1080.png`);
    await mkdir(EVIDENCE, { recursive: true });
    await streamPage.screenshot({ path, timeout: 180_000 });
    await streamPage.evaluate(() => window.__chatdomChat.hold(null));
    log(`stream view: ${JSON.stringify(stats)} -> work/evidence/pier/${name}@1920x1080.png`);
    return { still: `work/evidence/pier/${name}@1920x1080.png`, stats };
  };

  const almanac = async () => {
    const response = await fetch(`${realmUrl}${support.routes.almanac(KINGDOM)}`, { signal: AbortSignal.timeout(60_000) });
    assert(response.ok, `the Almanac answers (got ${response.status})`);
    return response.json();
  };
  evidence.almanacBefore = await step('read the Almanac before', async () => {
    const page = await almanac();
    log(`Almanac before: ${page.kingdom}, water ${page.water}, ${page.caught} species caught, ${page.catches} catches, ${page.entries.length} pages`);
    return page;
  });

  /** Follows one chat line from its float to its end and returns every event about it. */
  const follow = async (line, ms = 120_000) => {
    const ended = await nextEvent(`line ${line.id.slice(0, 8)} to end`, 0, e => (e.kind === 'caught' || e.kind === 'gone' || e.kind === 'broken') && e.id === line.id, ms);
    return ended.event;
  };
  const beatsOf = id => feed.events.filter(e => (e.event.line?.id ?? e.event.id) === id).map(e => ({ atMs: e.atMs, kind: e.event.kind, phase: e.event.line?.phase, reason: e.event.reason }));
  const castFor = async (who, slot, label) => {
    const from = feed.events.length;
    const said = await say(who, '!fish', label);
    assert(said.relay.http === 202 && said.relay.reply?.status === 'relayed', `${label}: the realm claims the \`!fish\` (got ${said.relay.http} ${JSON.stringify(said.relay.reply)})`);
    const got = await nextEvent(`${label}: a float on the water`, from, e => e.kind === 'line' && e.line.phase === 'float' && e.line.who.slot === slot, 30_000);
    return { said, line: got.event.line, lineAtMs: got.atMs, from };
  };

  // 4 + 5: saoirse_k fishes; a second `!fish` while her line is out, and one inside the rest, cast nothing ----------------
  const rateLimits = [];
  const casts = [];
  // Armed before her first `!fish`: her float in the water, then her catch's card.
  await streamPage.evaluate(() => { window.__chatdomChat.holdOn('line', 2.2); window.__chatdomChat.holdOn('caught', 1.0); });
  const streamBeats = (async () => ({
    float: await streamShot('pi11-chat-run-float', 'floats', 300_000),
    caught: await streamShot('pi11-chat-run-stream', 'cards', 900_000),
  }))();
  streamBeats.catch(() => undefined);
  evidence.saoirse = await step('saoirse_k: `!fish` until a fish is caught (with the rate limits checked on the way)', async () => {
    for (let attempt = 1; attempt <= MAX_CASTS; attempt++) {
      const cast = await castFor(SAOIRSE, saoirseSlot, `saoirse_k !fish #${attempt}`);
      const { line } = cast;
      log(`float ${line.id.slice(0, 8)} for ${line.who.name} at ${line.float.map(n => n.toFixed(2)).join(', ')} in ${line.who.colour}, ${cast.lineAtMs - cast.said.sentAtMs} ms after the message`);
      assert(line.via === 'chat' && line.who.name === SAOIRSE.name && line.who.slot === saoirseSlot && line.who.colour === support.pier.colour(saoirseSlot)
        && Array.isArray(line.float) && line.float.length === 3, 'the float is hers: via chat, her name, her window slot and its light colour');
      if (attempt === 1) {
        // 5a. While the line is out.
        const from = feed.events.length, cuesFrom = watch.cues.length;
        const again = await say(SAOIRSE, '!fish', 'saoirse_k !fish while her line is out');
        await delay(QUIET_WINDOW_MS);
        const extra = feed.events.slice(from).filter(e => (e.event.kind === 'line' && e.event.line.id !== line.id) || e.event.kind === 'full');
        const bubbles = watch.cues.slice(cuesFrom).filter(c => c.slot === saoirseSlot);
        rateLimits.push({ case: 'line out', relay: again.relay.reply?.status, http: again.relay.http, newLines: extra.length, bubbles: bubbles.length, listenedMs: QUIET_WINDOW_MS });
        assert(again.relay.http === 202 && again.relay.reply?.status === 'relayed', 'the second `!fish` is claimed (no speech bubble)');
        assert(extra.length === 0, 'the second `!fish` makes no second line');
        assert(bubbles.length === 0, 'the claimed `!fish` makes no speech bubble');
      }
      const end = await follow(line);
      const endAtMs = since();
      casts.push({ attempt, lineId: line.id.slice(0, 8), float: line.float, colour: line.who.colour, ended: end.kind, reason: end.reason ?? null,
        fish: end.fish ?? null, speciesId: end.speciesId ?? end.fish?.speciesId ?? null, beats: beatsOf(line.id) });
      log(`line ${line.id.slice(0, 8)} ended ${end.kind}${end.reason ? ` (${end.reason})` : ''}`);
      if (attempt === 1 || end.kind === 'caught') {
        // 5b. Inside the 45 s rest after a line comes in.
        const from = feed.events.length;
        const rest = await say(SAOIRSE, '!fish', 'saoirse_k !fish inside the rest');
        await delay(QUIET_WINDOW_MS);
        const extra = feed.events.slice(from).filter(e => e.event.kind === 'line' || e.event.kind === 'full');
        rateLimits.push({ case: 'resting', afterEnd: end.kind, sentMsAfterEnd: rest.sentAtMs - endAtMs, relay: rest.relay.reply?.status, http: rest.relay.http, newLines: extra.length, listenedMs: QUIET_WINDOW_MS });
        assert(rest.relay.http === 202 && rest.relay.reply?.status === 'relayed', 'a `!fish` inside the rest is claimed');
        assert(extra.length === 0, 'a `!fish` inside the rest makes no line');
      }
      if (end.kind === 'caught') return { line, end, endAtMs, attempts: attempt };
      if (attempt < MAX_CASTS) { const wait = support.pier.cooldownMs + 2_000 - (since() - endAtMs); log(`resting ${Math.max(0, wait)} ms before the next cast`); if (wait > 0) await delay(wait); }
    }
    throw new Error(`No fish was caught in ${MAX_CASTS} casts.`);
  });
  evidence.streamBeats = await step('the stream view showed her float and her catch at the pier', () => streamBeats);
  evidence.saoirseCasts = casts;
  evidence.rateLimits = rateLimits;
  const caught = evidence.saoirse.end;

  evidence.catchChecks = await step('the catch: Almanac page and Postgres rows (read-only)', async () => {
    assert(caught.via === 'chat' && caught.who.name === SAOIRSE.name && caught.who.slot === saoirseSlot, 'the caught beat is hers, via chat');
    const speciesId = caught.fish.speciesId;
    const row = await db.catchRow(KINGDOM, caught.id);
    assert(row, 'the realm_fishing_catches row exists for the cast');
    assert(row.via === 'chat' && row.owner_id === SAOIRSE.personId && row.species_id === speciesId && Number(row.fish.weightG) === caught.fish.weightG,
      'the catch row is hers, via chat, the same fish');
    assert(row.kingdom_first === caught.kingdomFirst, 'the feed\'s kingdom first matches the row');
    const item = await db.item(row.item_id);
    assert(item && item.owner_id === SAOIRSE.personId && item.def_id === speciesId && item.kingdom_id === KINGDOM, 'the fish item is in her bag records');
    const mounts = await db.mountFor(caught.id);
    const mountDef = support.pier.mountId(speciesId), mountNumber = await db.mountNumber(KINGDOM, mountDef);
    if (row.kingdom_first) assert(mounts.length === 1 && mounts[0].owner_id === SAOIRSE.personId && mounts[0].def_id === mountDef, 'a kingdom first gives her the numbered mount');
    // The Almanac is cached briefly; a caught beat drops the cache.
    const page = await almanac(), entry = page.entries.find(e => e.speciesId === speciesId);
    const before = evidence.almanacBefore.entries.find(e => e.speciesId === speciesId);
    log(`Almanac ${speciesId}: ${JSON.stringify(entry)}`);
    assert(entry && entry.status === 'caught' && entry.count === (before?.count ?? 0) + 1, 'the species\' page is caught and counts this catch');
    if (row.kingdom_first) {
      assert(entry.first?.name === SAOIRSE.name && entry.first.via === 'chat', 'the kingdom\'s first is saoirse_k, via chat');
      assert(entry.mounts >= 1 && entry.mounts === mountNumber, 'the page counts the mount');
    } else {
      log(`not the kingdom's first ${speciesId}: the page keeps its first (${JSON.stringify(entry.first)})`);
      assert(JSON.stringify(entry.first) === JSON.stringify(before.first), 'an earlier first stays the first');
      if (caught.fish.weightG > (before.biggest?.weightG ?? 0)) assert(entry.biggest?.name === SAOIRSE.name && entry.biggest.via === 'chat', 'her bigger fish is the biggest, via chat');
    }
    const text = JSON.stringify(page);
    assert(!text.includes(SAOIRSE.personId) && !text.includes(QUIET.personId), 'the Almanac carries no person ids');
    return { speciesId, kingdomFirst: row.kingdom_first, personalFirst: row.personal_first, almanacEntry: entry,
      catchRow: { ...row, environment: row.environment }, item, mounts, mountNumber };
  });

  // 6: a deleted `!fish` pulls its float ------------------------------------------------------------------------------
  evidence.deletion = await step('quiet_one: `!fish`, then the message is deleted: the float is pulled', async () => {
    const cast = await castFor(QUIET, quietSlot, 'quiet_one !fish (to be deleted)');
    const from = feed.events.length;
    const removed = await cleanupChat({ type: 'remove', messageIds: [cast.said.messageId] }, 'Herald: message deleted');
    assert(removed.http === 202 && removed.reply?.status === 'accepted', 'the cleanup is accepted');
    const gone = await nextEvent('the float pulled', from, e => e.kind === 'gone' && e.id === cast.line.id, 15_000);
    assert(gone.event.reason === 'pulled', `the float is pulled (got ${gone.event.reason})`);
    log(`deleted message ${cast.said.messageId.slice(0, 8)}: line ${cast.line.id.slice(0, 8)} gone (${gone.event.reason}) ${gone.atMs - removed.atMs - removed.ms} ms after the cleanup answered`);
    return { messageId: cast.said.messageId.slice(0, 8), lineId: cast.line.id.slice(0, 8), name: cast.line.who.name, gone: gone.event, beats: beatsOf(cast.line.id) };
  });

  // 7: a timeout clears her line and hides her name --------------------------------------------------------------------
  evidence.timeout = await step('quiet_one: `!fish`, then a timeout clears her: the line is cleared and her name hidden', async () => {
    const cast = await castFor(QUIET, quietSlot, 'quiet_one !fish (to be timed out)');
    const from = feed.events.length;
    const cleared = await cleanupChat({ type: 'clear', personId: QUIET.personId }, 'Herald: quiet_one timed out');
    assert(cleared.http === 202 && cleared.reply?.status === 'accepted', 'the cleanup is accepted');
    const gone = await nextEvent('the line cleared', from, e => e.kind === 'gone' && e.id === cast.line.id, 15_000);
    assert(gone.event.reason === 'cleared', `the line is cleared (got ${gone.event.reason})`);
    const hidden = await until('her hidden-name row', 30_000, async () => (await db.hidden(KINGDOM, [QUIET.personId]))[0] ?? null, 250);
    assert(hidden.origin === 'simulated', 'the hidden-name row is this origin\'s');
    const page = await almanac();
    assert(!JSON.stringify(page).includes(QUIET.name), 'her name is nowhere in the Almanac');
    log(`timed out: line ${cast.line.id.slice(0, 8)} gone (${gone.event.reason}); realm_pier_hidden_names row at ${hidden.hidden_ms}`);
    return { lineId: cast.line.id.slice(0, 8), nameOnLine: cast.line.who.name, gone: gone.event, hiddenRow: hidden, beats: beatsOf(cast.line.id), clearedAtMs: since() };
  });

  // 7b: after the rest, her later catch never shows her name ------------------------------------------------------------
  evidence.hiddenAfter = await step('quiet_one fishes again after the rest: no name on the stream or in the Almanac', async () => {
    const tries = [];
    const wait = support.pier.cooldownMs + 2_000 - (since() - evidence.timeout.clearedAtMs);
    if (wait > 0) { log(`resting ${wait} ms`); await delay(wait); }
    for (let attempt = 1; attempt <= QUIET_CASTS; attempt++) {
      const cast = await castFor(QUIET, quietSlot, `quiet_one !fish after the timeout #${attempt}`);
      assert(cast.line.who.name === null && cast.line.who.slot === quietSlot, 'her light fishes without a name');
      const end = await follow(cast.line);
      tries.push({ attempt, lineId: cast.line.id.slice(0, 8), ended: end.kind, reason: end.reason ?? null, fish: end.fish ?? null, who: end.who ?? null, beats: beatsOf(cast.line.id) });
      if (end.kind === 'caught') {
        assert(end.who.name === null, 'her caught beat carries no name');
        const row = await db.catchRow(KINGDOM, end.id);
        const page = await almanac(), entry = page.entries.find(e => e.speciesId === end.fish.speciesId);
        assert(row && row.owner_id === QUIET.personId && row.via === 'chat', 'her catch is kept, via chat');
        assert(!JSON.stringify(page).includes(QUIET.name), 'her name is nowhere in the Almanac');
        const hers = [];
        if (row.kingdom_first) { assert(entry.first && entry.first.name === null && entry.first.via === 'chat', 'her kingdom first reads as a fisher (null)'); hers.push('first'); }
        const biggest = (await db.query(`SELECT owner_id FROM realm_fishing_catches WHERE kingdom_id=$1 AND origin='simulated' AND species_id=$2
          ORDER BY (record->'fish'->>'weightG')::integer DESC, caught_ms ASC LIMIT 1`, [KINGDOM, end.fish.speciesId]))[0];
        if (biggest?.owner_id === QUIET.personId) { assert(entry.biggest && entry.biggest.name === null, 'her biggest reads as a fisher (null)'); hers.push('biggest'); }
        log(`quiet_one caught ${end.fish.speciesId}: page ${JSON.stringify(entry)} (hers: ${hers.join(', ') || 'neither first nor biggest'})`);
        return { tries, caught: { speciesId: end.fish.speciesId, kingdomFirst: row.kingdom_first, almanacEntry: entry, hersOnPage: hers, rowName: row.name } };
      }
      if (attempt < QUIET_CASTS) { log(`resting ${support.pier.cooldownMs + 2_000} ms before her next cast`); await delay(support.pier.cooldownMs + 2_000); }
    }
    log(`quiet_one landed nothing in ${QUIET_CASTS} casts; every line of hers carried no name`);
    return { tries, caught: null };
  });

  // 8: ordinary chat is not claimed: it becomes speech, and the pier hears nothing ------------------------------------
  evidence.ordinary = await step('saoirse_k says "hello": not claimed by the pier, it is a speech bubble', async () => {
    const from = feed.events.length, cuesFrom = watch.cues.length;
    const said = await say(SAOIRSE, 'hello', 'saoirse_k hello');
    assert(said.relay.http === 202 && said.relay.reply?.status === 'relayed', 'ordinary chat is relayed as speech');
    const bubble = await until('her speech bubble on the kingdom watch', 10_000, () => watch.cues.slice(cuesFrom).find(c => c.slot === saoirseSlot && c.parts?.[0]?.text === 'hello'), 50);
    await delay(QUIET_WINDOW_MS);
    const pierEvents = eventsAfter(from);
    assert(pierEvents.length === 0, `the pier hears nothing (got ${JSON.stringify(pierEvents)})`);
    log(`"hello" became a speech bubble at slot ${bubble.slot}; the pier feed stayed quiet for ${QUIET_WINDOW_MS} ms`);
    return { relay: said.relay.reply?.status, bubble: { slot: bubble.slot, asOf: bubble.asOf, parts: bubble.parts }, pierEvents: pierEvents.length };
  });

  evidence.almanacAfter = await step('read the Almanac after', async () => {
    const page = await almanac();
    const text = JSON.stringify(page);
    assert(!text.includes(QUIET.name), 'quiet_one\'s name is nowhere in the Almanac');
    assert(!text.includes(SAOIRSE.personId) && !text.includes(QUIET.personId), 'no person ids');
    log(`Almanac after: ${page.caught} species caught, ${page.catches} catches`);
    return page;
  });
  await step('the public feed never carries a person id', async () => {
    const text = JSON.stringify(feed.events);
    assert(!text.includes(SAOIRSE.personId) && !text.includes(QUIET.personId), 'no person id on the pier feed');
  });
  evidence.after = { hidden: await db.hidden(KINGDOM, people), catches: await db.catchCounts(KINGDOM) };
  evidence.passed = true;
  log('PASS: PI11 chat fishing end to end');
} catch (error) {
  evidence.passed = false;
  evidence.failure = scrub(error?.stack ?? error);
  log(`FAIL: ${scrub(error?.message ?? error)}`);
  process.exitCode = 1;
} finally {
  stopping = true;
  if (heartbeat) clearInterval(heartbeat);
  try { pierFeed?.close(); } catch { /* closed */ }
  try { kingdomWatch?.close(); } catch { /* closed */ }
  try { await browser?.close(); } catch { /* closed */ }
  try { await web?.close(); } catch { /* closed */ }
  await delay(300);
  if (realm) { const s = await realm.stop(); log(`realm stopped (${s.signal ?? `exit ${s.code}`})`); }
  await cleanup();
  if (db) await db.end().catch(() => {});
  evidence.finishedAt = new Date().toISOString();
  evidence.durationMs = Date.now() - runStarted;
  evidence.feed = feed;
  evidence.kingdomWatch = { connections: watch.connections, revisions: watch.revisions, closed: watch.closed,
    frames: watch.frames, speechCues: watch.cues };
  const text = scrub(JSON.stringify(evidence, null, 2));
  if (text.includes(databaseUrl) || text.includes(heraldSecret)) throw new Error('Refusing to write evidence containing a secret.');
  await mkdir(EVIDENCE, { recursive: true });
  const name = evidence.passed ? 'pi11-chat-run' : 'pi11-chat-run-failed';
  await writeFile(join(EVIDENCE, `${name}.json`), text + '\n');
  await writeFile(join(EVIDENCE, `${name}.log`), lines.join('\n') + '\n');
  console.log(`evidence: work/evidence/pier/${name}.json, ${name}.log`);
  setTimeout(() => process.exit(), 500).unref();
}
