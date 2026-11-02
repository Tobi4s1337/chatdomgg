// PI10 end to end on the lane's own stack: own Postgres schema `pier`, own realm and API processes, the simulated
// sign-in provider, and tobi4s_'s real founded plan. Run through ./run.sh, which loads DATABASE_URL without
// printing it. Writes work/evidence/pier/pi10-e2e-run.json and pi10-e2e-run.log. See README.md.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile, copyFile, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runnerImport } from 'vite';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const KINGDOM = '129634568';
const SCHEMA = 'pier';
const STACK = process.env.PIER_E2E_STACK ?? '/tmp/chatdom-pier-stack';
const SOURCE_SCENE = process.env.PIER_FOUNDED_SCENE ?? '/tmp/chatdom-pier-founded/scene.json';
const SOURCE_MANIFEST = process.env.PIER_FOUNDED_MANIFEST ?? '/tmp/chatdom-pier-founded-manifest.json';
const FISHER = { name: 'Wren', personId: process.env.PIER_E2E_FISHER ?? '990100001' };
const OBSERVER = { name: 'Tamsin', personId: process.env.PIER_E2E_OBSERVER ?? '990100002' };
const EVIDENCE = join(ROOT, 'work/evidence/pier');
const REALM_LISTENING = /SIMULATED realm on \d+: adopted durable Postgres kingdoms/;
const JOIN_ATTEMPTS = Number(process.env.PIER_E2E_JOIN_ATTEMPTS ?? 30);
const MAX_CASTS = Number(process.env.PIER_E2E_MAX_CASTS ?? 12), MAX_FISHING_MS = Number(process.env.PIER_E2E_MAX_FISHING_MS ?? 6 * 60_000);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) { console.error('DATABASE_URL is not loaded; run work/lanes/pier/e2e/run.sh.'); process.exit(2); }
if (process.env.REALM_DATABASE_SCHEMA !== SCHEMA) { console.error('REALM_DATABASE_SCHEMA must be pier; run work/lanes/pier/e2e/run.sh.'); process.exit(2); }
if (!STACK.startsWith('/tmp/') || STACK.startsWith(ROOT)) { console.error('The stack directory must live outside the repository, under /tmp.'); process.exit(2); }

const runStarted = Date.now(), lines = [];
const scrub = text => String(text).split(databaseUrl).join('<database>');
const log = line => { const stamped = `[${((Date.now() - runStarted) / 1000).toFixed(1).padStart(6)}s] ${scrub(line)}`; lines.push(stamped); console.log(stamped); };
const evidence = { version: 1, goal: 'PI10', check: 'signed-in walker walks onto the pier, takes a rod, catches a fish, sees it in the bag with its story; '
  + 'the realm restarts and the fish is still there; a second walker in the same room sees the first one\'s line and catch.',
  startedAt: new Date(runStarted).toISOString(), passed: false, steps: [] };
const step = async (name, run) => {
  const started = Date.now(); log(`-- ${name}`);
  try { const result = await run(); evidence.steps.push({ name, ok: true, ms: Date.now() - started }); return result; }
  catch (error) { evidence.steps.push({ name, ok: false, ms: Date.now() - started, error: scrub(error?.message ?? error) }); throw error; }
};
const assert = (condition, message) => { if (!condition) throw new Error(`Check failed: ${message}`); };

// Processes -------------------------------------------------------------------------------------------------------

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
/** Other lanes share 5170-5186: wait for two free ports rather than borrowing a reserved one. */
async function freePorts() {
  const ends = Date.now() + Number(process.env.PIER_E2E_PORT_WAIT_MS ?? 30 * 60_000);
  let said = false;
  for (;;) {
    const first = await freePort([]), second = first === null ? null : await freePort([first]);
    if (first !== null && second !== null) return [first, second];
    if (Date.now() > ends) throw new Error('No two free lane ports in 5170-5186.');
    if (!said) { log(`waiting for two free ports in 5170-5186 (free now: ${first ?? 'none'})`); said = true; }
    await new Promise(resolve => setTimeout(resolve, 10_000));
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
    // Probe only once the process says it listens: the realm holds its port with a bare socket while it boots,
    // and a connection made to that socket keeps the reservation from closing (see README, findings).
    if (heard) { try { if (await ready()) break; } catch { /* not answering yet */ } }
    if (Date.now() - started > 15 * 60_000) throw new Error(`${label} was not ready in 15 minutes.`);
    await new Promise(resolve => setTimeout(resolve, 500));
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
const cleanup = async () => { for (const child of [...children]) { child.kill('SIGTERM'); } };
process.on('SIGINT', () => { void cleanup().then(() => process.exit(130)); });

// The run ---------------------------------------------------------------------------------------------------------

let realm = null, api = null, walkers = [];
try {
  const imp = async path => (await runnerImport(join(ROOT, path), { root: ROOT, configFile: false, logLevel: 'warn' })).module;
  evidence.source = await step('verify the copied founded scene', async () => {
    const bytes = await readFile(SOURCE_SCENE), manifest = JSON.parse(await readFile(SOURCE_MANIFEST, 'utf8'));
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert(hash === manifest.sceneHash, 'the copied scene matches the live receipt it was fetched with');
    const scene = JSON.parse(bytes);
    assert(scene.kingdomId === KINGDOM && manifest.kingdomId === KINGDOM, 'the copy is tobi4s_\'s kingdom');
    log(`copied scene ${hash.slice(0, 16)}…: kingdom ${scene.kingdomId}, ${scene.origin}, layout ${scene.layoutRevision}, collision ${scene.collisionRevision}, ${scene.placements.length} placements`);
    return { scene, info: { sceneHash: hash, origin: scene.origin, kingdomId: scene.kingdomId, layoutRevision: scene.layoutRevision, collisionRevision: scene.collisionRevision,
      placements: scene.placements.length, pierPlacements: scene.placements.filter(p => p.id.startsWith('pier:')).length, fetchedFrom: 'live public founded GET route (receipt + hash-addressed scene)' } };
  }).then(({ scene, info }) => { evidence.sourceScene = info; return scene; });
  const source = evidence.source;
  delete evidence.source;

  await step('build realm and API', async () => {
    if (process.env.PIER_E2E_SKIP_BUILD === '1' && existsSync(join(ROOT, 'apps/realm/dist/realm.mjs')) && existsSync(join(ROOT, 'apps/api/dist/api.mjs'))) { log('reusing existing builds (PIER_E2E_SKIP_BUILD=1)'); return; }
    await run('realm build', 'pnpm', ['--filter', '@chatdom/realm', 'build']);
    await run('api build', 'pnpm', ['--filter', '@chatdom/api', 'build']);
  });

  await step('migrate schema pier', () => run('migrate', process.execPath, ['apps/realm/scripts/migrate.mjs', '--schema', SCHEMA]));

  const drive = await imp('work/lanes/pier/e2e/drive.ts');
  drive.useLog(log);
  evidence.seed = await step('adopt the copied plan for kingdom 129634568 (simulated origin, schema pier)', async () => {
    const seeded = await drive.seedKingdom({ databaseUrl, schema: SCHEMA, kingdomId: KINGDOM, plan: source.plan });
    log(`layout ${seeded.status}: ${seeded.revision}, plan sha256 ${seeded.planDigest.slice(0, 16)}…`);
    return seeded;
  });

  const foundedDirectory = join(STACK, 'founded');
  await mkdir(foundedDirectory, { recursive: true }); await mkdir(join(STACK, 'source'), { recursive: true });
  await copyFile(SOURCE_SCENE, join(STACK, 'source', 'scene.json'));
  const evidenceKey = randomBytes(32).toString('hex');
  let realmUrl = '', apiOrigin = '';
  const realmEnvFor = port => childEnv({ REALM_SIMULATED: '1', REALM_STORAGE: 'postgres', REALM_PIER_FISHING: '1', REALM_FOUNDED_DIRECTORY: foundedDirectory,
    REALM_PORT: String(port), REALM_HOST: '127.0.0.1', REALM_EVIDENCE_KEY: evidenceKey });
  // Bounded probes: the realm holds its port with a plain socket while it boots, and an unanswered probe left
  // open would keep that reservation from closing.
  const realmReady = async () => (await fetch(`${realmUrl}/readyz`, { signal: AbortSignal.timeout(1500) })).ok;
  const startRealm = async port => {
    realmUrl = `http://127.0.0.1:${port}`;
    return serve('realm', join(ROOT, 'apps/realm/dist/realm.mjs'), join(ROOT, 'apps/realm'), realmEnvFor(port), realmReady, REALM_LISTENING);
  };
  // The first receipt opens the kingdom cold. On this shared host that open can outlast the writer lease and
  // answer 503; the page would ask again, and so does the run. Every attempt is recorded.
  evidence.sceneOpens = [];
  const openScene = async label => {
    for (let attempt = 1; ; attempt++) {
      const started = Date.now();
      try {
        const got = await drive.fetchScene(realmUrl, KINGDOM);
        evidence.sceneOpens.push({ label, attempt, ms: Date.now() - started, ok: true });
        return got;
      } catch (error) {
        evidence.sceneOpens.push({ label, attempt, ms: Date.now() - started, ok: false, error: scrub(error.message) });
        log(`${label}: attempt ${attempt} failed after ${Date.now() - started} ms: ${error.message}`);
        if (attempt >= 4) throw error;
        await new Promise(resolve => setTimeout(resolve, 16_000));
      }
    }
  };
  // Other lanes share 5170-5186 and start servers at any moment: a port taken between the probe and the bind is
  // probed again rather than borrowed.
  const ports = await step('start the realm and the API (simulated sign-in) on free lane ports', async () => {
    for (let attempt = 1; ; attempt++) {
      const [realmPort, apiPort] = await freePorts();
      log(`attempt ${attempt}: realm 127.0.0.1:${realmPort}, API 127.0.0.1:${apiPort}`);
      try { realm = await startRealm(realmPort); }
      catch (error) { realm = null; if (attempt < 6 && /in use/.test(error.message)) continue; throw error; }
      apiOrigin = `http://127.0.0.1:${apiPort}`;
      try {
        api = await serve('api', join(ROOT, 'apps/api/dist/api.mjs'), join(ROOT, 'apps/api'),
          childEnv({ REALM_AUTH_MODE: 'simulated', API_PORT: String(apiPort), API_HOST: '127.0.0.1', REALM_PUBLIC_ORIGIN: apiOrigin }),
          async () => (await fetch(`${apiOrigin}/healthz`, { signal: AbortSignal.timeout(1500) })).ok);
      } catch (error) {
        api = null; await realm.stop(); realm = null;
        if (attempt < 6 && /in use/.test(error.message)) continue;
        throw error;
      }
      return { realm: realmPort, api: apiPort };
    }
  });
  evidence.ports = ports;
  evidence.realmBoot = { readyMs: realm.readyMs };

  // The realm opens a kingdom on demand and closes it when the last hold goes, and each cold open assembles and
  // compiles the whole town inside its writer lease. Wren's room seat is the hold that keeps it open, so she joins
  // first (the client holds still until it has the collision world), and the scene is read while she is in.
  const collision = { world: null };
  const lazyWorld = { world: revision => collision.world?.revision === revision ? collision.world : null };
  await step('warm the collision compiler on the copied scene (before any socket is open)', async () => {
    const started = Date.now(); drive.compileWorld(source);
    log(`warm-up compile in ${Date.now() - started} ms`);
  });
  const wren = new drive.Browser(apiOrigin), tamsin = new drive.Browser(apiOrigin);
  const returnTo = `/?walk=1&kingdom=${KINGDOM}`;
  const signed = await step('sign Wren and Tamsin in through the HTTP OIDC flow', async () => {
    const a = await wren.signIn(FISHER.personId, returnTo), b = await tamsin.signIn(OBSERVER.personId, returnTo);
    log(`Wren landed on ${a.landed}; Tamsin landed on ${b.landed}`);
    evidence.signIn = { returnTo, fisher: { personId: FISHER.personId, landed: a.landed }, observer: { personId: OBSERVER.personId, landed: b.landed } };
    return { a, b };
  });
  // Stops the realm and starts it again on the same schema and founded directory (another free port only if a
  // lane took this one in the gap).
  let realmPort = ports.realm;
  const restartRealm = async () => {
    const stopped = await realm.stop();
    log(`realm stopped (${stopped.signal ?? `exit ${stopped.code}`})`);
    for (let attempt = 1; ; attempt++) {
      try { realm = await startRealm(realmPort); break; }
      catch (error) {
        realm = null;
        if (attempt >= 6 || !/in use/.test(error.message)) throw error;
        realmPort = (await freePorts())[0];
        log(`realm port taken during the restart; restarting on ${realmPort}`);
      }
    }
    return { stopped: stopped.signal ?? `exit ${stopped.code}`, readyMs: realm.readyMs, port: realmPort };
  };
  evidence.joins = []; evidence.recoveries = [];
  const joinUntilOpen = async (label, options) => {
    for (let attempt = 1; ; attempt++) {
      const started = Date.now();
      try {
        const walker = await drive.joinWalker(options);
        evidence.joins.push({ label, attempt, ms: Date.now() - started, ok: true });
        return walker;
      } catch (error) {
        evidence.joins.push({ label, attempt, ms: Date.now() - started, ok: false, error: scrub(error.message) });
        log(`${label}: join attempt ${attempt} failed after ${Date.now() - started} ms: ${error.message}`);
        if (attempt >= JOIN_ATTEMPTS) throw error;
        if (/already open on this server/.test(error.message)) {
          // A room whose creation failed after the kingdom opened keeps its room hold (see README, findings):
          // nothing can join this kingdom again until the realm restarts.
          log(`${label}: the realm holds a dead room for the kingdom; restarting it`);
          const recovery = await restartRealm();
          evidence.recoveries.push({ label, attempt, reason: 'leaked room hold after a failed room creation', ...recovery });
          options = { ...options, realm: realmUrl };
          continue;
        }
        // An expired writer lease is free again after 15 s.
        await new Promise(resolve => setTimeout(resolve, 16_000));
      }
    }
  };
  const A = await step('Wren joins the kingdom room with a fresh ticket (opening the kingdom)', () => joinUntilOpen('Wren', { name: 'Wren', personId: FISHER.personId,
    realm: realmUrl, kingdomId: KINGDOM, browser: wren, resumeScope: signed.a.resumeScope, collision: lazyWorld }));
  walkers = [A];
  const fetched = await step('read the realm\'s founded scene as the browser does', async () => {
    const got = await openScene('scene with the kingdom held open');
    const sourceIds = new Map(source.placements.map(p => [p.id, p]));
    const same = got.scene.placements.filter(p => { const q = sourceIds.get(p.id); return q && q.assetHash === p.assetHash && q.rotation === p.rotation && q.position.every((n, i) => n === p.position[i]); }).length;
    const pier = got.scene.placements.filter(p => p.id.startsWith('pier:'));
    const planSame = JSON.stringify(got.scene.plan) === JSON.stringify(source.plan);
    assert(got.scene.origin === 'simulated', 'the realm serves its own simulated copy');
    assert(planSame, 'the realm\'s scene carries the copied plan exactly');
    assert(pier.length > 0, 'the realm\'s scene carries the pier');
    log(`realm scene ${got.manifest.sceneHash.slice(0, 16)}…: ${got.scene.placements.length} placements (${same} identical to the live copy, ${pier.length} pier pieces), collision ${got.manifest.collisionRevision}, ${got.bytes} bytes`);
    evidence.realmScene = { sceneHash: got.manifest.sceneHash, origin: got.scene.origin, layoutRevision: got.manifest.layoutRevision, collisionRevision: got.manifest.collisionRevision,
      bytes: got.bytes, placements: got.scene.placements.length, identicalToLiveCopy: same, pierPieces: pier.map(p => p.id), planIdenticalToLiveCopy: planSame,
      note: 'The realm assembles the scene from the adopted plan and its own committed state; homes the live kingdom has replaced or forged are native here, because no live private state is copied.' };
    return got;
  });
  const world = await step('compile the collision world (shared founded compiler)', async () => {
    const started = Date.now(), compiled = drive.compileWorld(fetched.scene);
    log(`compiled revision ${compiled.revision} in ${Date.now() - started} ms`);
    assert(compiled.revision === A.client.room.state.collisionRevision, 'the compiled world is the room\'s current revision');
    collision.world = compiled;
    return compiled;
  });
  const plan = fetched.scene.plan;
  // Phase one: walk on, take, fish, bag, while an observer watches. ------------------------------------------------
  const B = await step('Tamsin joins the same room with a fresh ticket', () => joinUntilOpen('Tamsin', { name: 'Tamsin', personId: OBSERVER.personId,
    realm: realmUrl, kingdomId: KINGDOM, browser: tamsin, resumeScope: signed.b.resumeScope, collision: lazyWorld }));
  walkers = [A, B];
  await drive.until('Wren to predict on the compiled world', 15_000, () => A.client.predicting && B.client.predicting);
  for (const w of [A, B]) { const p = w.pose(); log(`${w.name} placed at ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)} as walker ${drive.tag(w.client.selfId)} (revision ${p.revision})`); }
  evidence.walkers = { fisher: drive.tag(A.client.selfId), observer: drive.tag(B.client.selfId), arrival: A.pose() };
  const watching = drive.observe(B, () => A.client.selfId);

  const pier = await step('read the pier from the fishing channel', async () => {
    A.controller.sync(); B.controller.sync();
    const state = await drive.until('the pier state', 15_000, () => A.controller.state().ready && A.controller.state());
    assert(state.site && state.rack, 'the room offers a fishing pier (REALM_PIER_FISHING=1 and the adopted pier verified)');
    log(`pier ${state.site.id} turn ${state.site.turn} walk ${state.site.walk} m deck ${state.site.deckY}; rack at ${state.rack.join(', ')}; water ${JSON.stringify(state.water)}`);
    evidence.pier = { site: state.site, rack: state.rack, water: state.water, revision: state.revision };
    return state;
  });
  const site = pier.site, rack = pier.rack;

  const routes = [];
  await step('walk Wren and Tamsin from the market onto the pier landing, Wren to the rod rack', async () => {
    const nearRack = p => Math.hypot(p[0] - rack[0], p[2] - rack[2]) <= 1.5 && Math.abs(p[1] - rack[1]) <= .5;
    // Tamsin stands on the bank by the landing, three metres inland of the pier root, where she can see the head.
    const shore = drive.lipPoint(site, 0);
    const root = site.root, out = [shore[0] - root[0], shore[2] - root[2]], length = Math.hypot(out[0], out[1]);
    const bank = [root[0] - out[0] / length * 3, root[1], root[2] - out[1] / length * 3];
    const nearBank = p => Math.hypot(p[0] - bank[0], p[2] - bank[2]) <= 1.5;
    const [a, b] = await Promise.all([
      drive.walkTo(A, world, plan, rack, nearRack, { label: 'market to rack', sprint: true }),
      drive.walkTo(B, world, plan, bank, nearBank, { label: 'market to bank', sprint: true }),
    ]);
    routes.push(a, b);
    log(`Wren at the rack after ${a.walkedMs} ms; Tamsin on the bank after ${b.walkedMs} ms`);
  });

  const rod = await step('take a willow rod from the rack', async () => {
    const before = A.controller.state().rod;
    A.controller.take();
    const item = await drive.until('the rod', 15_000, () => A.controller.state().rod);
    log(`rod ${item.defId} in ${item.place} slot ${item.slot} (${before ? 'already held' : 'taken now'}): "${item.story.line}"`);
    return { item, alreadyHeld: !!before };
  });

  await step('walk Wren out to the fishing lip and face the water', async () => {
    const lip = drive.lipPoint(site, -.6);
    const onLip = p => drive.onLip(site, { x: p[0], y: p[1], z: p[2] }, world.revision) && Math.hypot(p[0] - lip[0], p[2] - lip[2]) <= .45;
    routes.push(await drive.walkTo(A, world, plan, lip, onLip, { label: 'rack to lip', corridor: 12, finish: lip }));
    await drive.face(A, drive.outByte(site));
    const p = A.pose();
    assert(drive.onLip(site, p, world.revision), 'Wren stands grounded on the lip at the current revision');
    log(`Wren on the lip at ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}, yaw ${drive.outByte(site)}`);
  });
  evidence.routes = routes;

  const fishing = await step('fish with the fair player until a catch is kept', async () => {
    const result = await drive.fishUntilKept(A, { maxCasts: MAX_CASTS, maxMs: MAX_FISHING_MS });
    for (const cast of result.endedCasts) log(`cast ${cast.castId.slice(0, 8)} ended ${cast.outcome} after ${cast.ms} ms`);
    log(`kept ${result.kept.fish.speciesId} ${result.kept.fish.weightG} g ${result.kept.fish.lengthMm} mm after ${result.totalMs} ms (personal first ${result.kept.personalFirst}, kingdom first ${result.kept.kingdomFirst})`);
    return result;
  });
  // Let the observer's last public frames arrive.
  await new Promise(resolve => setTimeout(resolve, 1500));

  const bag = await step('open Wren\'s bag over the items channel', async () => {
    const items = await drive.listBag(A);
    const fish = items.find(item => item.id === fishing.kept.item.id), rodNow = items.find(item => item.id === rod.item.id);
    assert(fish, 'the kept fish is in the bag');
    assert(fish.defId === `fish:${fishing.kept.fish.speciesId}` || fish.defId === fishing.kept.item.defId, 'the bag record is the kept species');
    assert(fish.story && fish.story.by?.personId === FISHER.personId && fish.story.kingdomId === KINGDOM && fish.story.line && Number.isSafeInteger(fish.story.at), 'the fish carries its story: who, where, when and the line');
    assert(rodNow && rodNow.place === 'hotbar', 'the rod sits in the hotbar');
    const history = await drive.itemHistory(A, fish.id);
    const card = drive.card(fish);
    log(`bag: ${items.length} records; ${card.title} ×${card.count}: "${card.story.line}" by ${card.story.by?.name} at ${card.story.where}, ${new Date(card.story.at).toISOString()}`);
    return { items, fish, rodNow, history, card };
  });

  const seen = watching.seen;
  await step('check Tamsin saw Wren\'s rod, line and catch', async () => {
    const castId = fishing.kept.castId, of = kind => seen.filter(beat => beat.castId === castId && beat.kind === kind);
    assert(seen.some(beat => beat.kind === 'rod' && beat.detail.equipped), 'Tamsin saw Wren take up the rod');
    assert(of('cast').length && of('float').length, 'Tamsin saw the line go out and the float land');
    assert(of('line').some(beat => beat.detail.float), 'Tamsin saw Wren\'s line with its float on the water');
    assert(of('bite').length && of('hook').length && of('landing').length, 'Tamsin saw the bite, the hook and the landing');
    const caught = of('caught')[0];
    assert(caught && caught.detail.fish.speciesId === fishing.kept.fish.speciesId && caught.detail.fish.weightG === fishing.kept.fish.weightG, 'Tamsin saw the same fish caught');
    const visible = B.client.room.state.walkers.get(A.client.selfId);
    assert(visible, 'Wren\'s walker is in Tamsin\'s room view');
    log(`Tamsin saw ${seen.length} public beats of Wren's fishing; Wren visible to her at ${visible.x.toFixed(2)}, ${visible.y.toFixed(2)}, ${visible.z.toFixed(2)}`);
    evidence.observer = { walker: drive.tag(B.client.selfId), saw: seen.map(beat => ({ ...beat, ...(beat.castId ? { castId: beat.castId.slice(0, 8) } : {}) })),
      fisherVisibleAt: [visible.x, visible.y, visible.z].map(n => Math.round(n * 100) / 100) };
  });
  watching.dispose();

  evidence.catch = { fish: fishing.kept.fish, personalFirst: fishing.kept.personalFirst, kingdomFirst: fishing.kept.kingdomFirst, replayed: fishing.kept.replayed,
    castsBeforeKeep: fishing.endedCasts.map(c => ({ castId: c.castId.slice(0, 8), outcome: c.outcome, ms: c.ms })), fishingMs: fishing.totalMs,
    beats: fishing.keptCastBeats.map(beat => ({ ...beat, ...(beat.castId ? { castId: beat.castId.slice(0, 8) } : {}) })),
    caughtBroadcastToSelf: !!fishing.caught,
    allFisherBeats: fishing.beats.map(beat => ({ ...beat, ...(beat.castId ? { castId: beat.castId.slice(0, 8) } : {}) })),
    fisherRequests: A.sent.filter(r => r.type !== 'pier.reel' && r.t >= fishing.startedAt).map(r => ({ ...r, t: Math.round(r.t - fishing.startedAt), ...(r.castId ? { castId: r.castId.slice(0, 8) } : {}) })),
    reelEdgesSent: A.sent.filter(r => r.type === 'pier.reel').length };
  evidence.bagBeforeRestart = { records: bag.items.length, fish: bag.card, rod: drive.card(bag.rodNow), fishHistory: bag.history, rodAlreadyHeldBeforeRun: rod.alreadyHeld };

  // Phase two: the realm restarts; Wren signs in again and opens the bag. -------------------------------------------
  await step('leave and restart the realm on the same schema and founded directory', async () => {
    for (const w of walkers) w.dispose();
    walkers = [];
    const restarted = await restartRealm();
    evidence.restart = { ...restarted, samePort: restarted.port === ports.realm };
  });

  await step('sign Wren in again, join with a new ticket and open the bag', async () => {
    const browser = new drive.Browser(apiOrigin), again = await browser.signIn(FISHER.personId, returnTo);
    const A2 = await joinUntilOpen('Wren after restart', { name: 'Wren', personId: FISHER.personId, realm: realmUrl, kingdomId: KINGDOM, browser,
      resumeScope: again.resumeScope, collision: lazyWorld });
    walkers = [A2];
    const scene = await openScene('scene after restart');
    assert(scene.manifest.sceneHash === fetched.manifest.sceneHash && scene.manifest.collisionRevision === world.revision, 'the restarted realm serves the same adopted scene');
    log(`Wren back as walker ${drive.tag(A2.client.selfId)} (a new entry)`);
    const items = await drive.listBag(A2);
    const fish = items.find(item => item.id === bag.fish.id), rodAfter = items.find(item => item.id === bag.rodNow.id);
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    const checks = {
      fishPresent: !!fish,
      sameItemId: fish?.id === bag.fish.id,
      sameDefinition: fish?.defId === bag.fish.defId,
      sameCount: fish?.count === bag.fish.count,
      sameStory: !!fish && same(fish.story, bag.fish.story),
      sameSource: !!fish && same(fish.source, bag.fish.source),
      sameDetail: !!fish && same(fish.detail, bag.fish.detail),
      sameRecord: !!fish && same(fish, bag.fish),
      rodInHotbar: rodAfter?.place === 'hotbar' && rodAfter.slot === bag.rodNow.slot,
      newWalkerEntry: drive.tag(A2.client.selfId) !== evidence.walkers.fisher,
    };
    const history = fish ? await drive.itemHistory(A2, fish.id) : [];
    checks.sameHistory = same(history, bag.history);
    evidence.afterRestart = { sceneHash: scene.manifest.sceneHash, walker: drive.tag(A2.client.selfId), records: items.length, fish: fish ? drive.card(fish) : null,
      rod: rodAfter ? drive.card(rodAfter) : null, checks };
    log(`after restart: ${JSON.stringify(checks)}`);
    for (const [name, ok] of Object.entries(checks)) assert(ok, `after the restart: ${name}`);
  });
  evidence.passed = true;
  log('PASS: PI10 end to end');
} catch (error) {
  evidence.passed = false;
  evidence.failure = scrub(error?.stack ?? error);
  log(`FAIL: ${error?.message ?? error}`);
  process.exitCode = 1;
} finally {
  for (const w of walkers) { try { w.dispose(); } catch { /* already gone */ } }
  await new Promise(resolve => setTimeout(resolve, 300));
  if (api) { const s = await api.stop(); log(`API stopped (${s.signal ?? `exit ${s.code}`})`); }
  if (realm) { const s = await realm.stop(); log(`realm stopped (${s.signal ?? `exit ${s.code}`})`); }
  await cleanup();
  evidence.finishedAt = new Date().toISOString();
  evidence.durationMs = Date.now() - runStarted;
  evidence.commit = await new Promise(resolve => { const c = spawn('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }); let o = ''; c.stdout.on('data', d => o += d); c.on('exit', () => resolve(o.trim())); });
  const text = scrub(JSON.stringify(evidence, null, 2));
  if (text.includes(databaseUrl)) throw new Error('Refusing to write evidence containing the connection string.');
  await mkdir(EVIDENCE, { recursive: true });
  // A failed run never replaces the last passing evidence; it is kept beside it for diagnosis.
  const name = evidence.passed ? 'pi10-e2e-run' : 'pi10-e2e-run-failed';
  await writeFile(join(EVIDENCE, `${name}.json`), text + '\n');
  await writeFile(join(EVIDENCE, `${name}.log`), lines.join('\n') + '\n');
  console.log(`evidence: work/evidence/pier/${name}.json, ${name}.log`);
  setTimeout(() => process.exit(), 500).unref();
}
