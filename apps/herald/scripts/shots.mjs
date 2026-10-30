// Herald's screenshot pass. Plays each SIMULATED replay scenario (and, with --live, the real source for the
// configured channel) on 127.0.0.1:5194, opens main's kingdom page through its one presence adapter and
// `/presence-data` proxy, checks what the kingdom claims against Herald's own health, and captures the
// standard sizes into shots/herald/. It never writes to Twitch; --live only reads, like `dev`.
//
//   pnpm --filter @chatdom/herald shots -- [--base-url http://127.0.0.1:5190] [--scenarios evening,quiet,...]
//                                         [--live] [--tier town|hamlet] [--seed willowmere] [--hour 21.5]
//
// `restart` plays the SIMULATED evening twice over one scratch binding table (a temporary directory, never
// Herald's real data directory), listing connected people in reverse order the second time, and requires the
// public frames to put every lit window and name on the same slot. A control run without the table must
// move them, or the comparison would prove nothing.
//
// The base URL must serve main's web build with its `/presence-data` → 127.0.0.1:5194 proxy.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, URLSearchParams } from 'node:url';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HERALD = resolve(HERE, '..');
const OUT = resolve(HERALD, '../../shots/herald');
const HEALTH = 'http://127.0.0.1:5194/health';
const STREAM = 'http://127.0.0.1:5194/presence-data/stream';
const SCENARIOS = ['evening', 'quiet', 'offline', 'stale', 'unavailable', 'restart'];
/** Synthetic talkers in the replay (apps/herald/src/source/simulation.ts); no other name may appear. */
const SYNTHETIC_NAMES = new Set(['Juniper', 'MossLantern', 'quietbaker', 'Wrenfield', 'tallowmoth']);

const args = process.argv.slice(2).filter(arg => arg !== '--');
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};
const base = option('--base-url', 'http://127.0.0.1:5190').replace(/\/$/, '');
const tier = option('--tier', 'town');
const seed = option('--seed', 'willowmere');
const hour = Number(option('--hour', '21.5'));
// Both surfaces and Herald use the same settlement configuration, including its founding years.
const firstYear = option('--first-year', tier === 'hamlet' ? '2025' : '2022');
const year = option('--year', '2026');
const scenarios = option('--scenarios', SCENARIOS.join(',')).split(',').filter(Boolean);
const live = args.includes('--live');
if (!['town', 'hamlet'].includes(tier) || !Number.isFinite(hour) || !/^[1-9][0-9]{3}$/.test(firstYear) || !/^[1-9][0-9]{3}$/.test(year)
  || Number(year) < Number(firstYear) || Number(year) - Number(firstYear) > 30 || scenarios.some(name => !SCENARIOS.includes(name))) {
  process.stderr.write('Usage: shots [--base-url <url>] [--scenarios evening,quiet,offline,stale,unavailable,restart] [--live] [--tier town|hamlet] [--seed <seed>] [--first-year <yyyy>] [--year <yyyy>] [--hour <h>]\n');
  process.exit(2);
}

/** What each run must show, judged from Herald's health first and then from the page. */
const PLAN = [
  ...scenarios.flatMap(name => name === 'restart'
    ? [
      { name, mode: 'replay', scenario: 'evening', file: 'simulated-restart-before', bindings: true, arrival: 'forward', compare: 'before' },
      { name, mode: 'replay', scenario: 'evening', file: 'simulated-restart-after', bindings: true, arrival: 'reverse', compare: 'after' },
      { name, mode: 'replay', scenario: 'evening', file: null, bindings: false, arrival: 'reverse', compare: 'control' },
    ]
    : [{ name, mode: 'replay', scenario: name, file: `simulated-${name}` }]),
  ...(live ? [{ name: 'live', mode: 'dev', file: 'live' }] : []),
];

const ready = {
  evening: s => s.available && s.frame?.streamLive && s.frame.present >= 6 && s.frame.named >= 3,
  quiet: s => s.available && s.frame?.streamLive && s.frame.present >= 1,
  // Every evening talker has spoken and nobody has left yet (the first departure is at two minutes).
  restart: s => s.available && s.frame?.streamLive && s.frame.present >= 10 && s.frame.named >= 5,
  offline: s => s.available && s.frame?.connection === 'offline',
  stale: s => s.available && s.frame?.connection === 'stale',
  unavailable: s => !s.available && s.reason === 'simulated_outage',
  // An authorized real source has published its first frame; an unauthorized one has settled on its refusal.
  live: s => s.available ? s.frame !== null : s.condition !== 'configured' && s.condition !== 'connecting',
};

/** Reached through globalThis: the shared lint config declares only a few globals. */
const timeoutSignal = ms => globalThis.AbortSignal.timeout(ms);

async function health() {
  try {
    const response = await fetch(HEALTH, { signal: timeoutSignal(2_000) });
    return response.ok ? (await response.json()).source : null;
  } catch {
    return null;
  }
}

/** The public frame a new subscriber receives: slots, presence and permitted names only. */
async function currentFrame() {
  const controller = new globalThis.AbortController();
  const signal = globalThis.AbortSignal.any([controller.signal, timeoutSignal(10_000)]);
  try {
    const response = await fetch(STREAM, { signal });
    if (!response.ok || !response.body) throw new Error(`presence stream answered ${response.status}`);
    const decoder = new globalThis.TextDecoder();
    let buffered = '';
    for await (const chunk of response.body) {
      buffered += decoder.decode(chunk, { stream: true });
      const line = buffered.split('\n').find(entry => entry.startsWith('data: ') && buffered.includes(`${entry}\n\n`));
      if (line) return JSON.parse(line.slice(6));
    }
    throw new Error('presence stream ended before a frame');
  } finally {
    controller.abort();
  }
}

/** Where each lit window is and whose name it carries; synthetic names only (the replay's talkers). */
function seating(frame) {
  return frame.windows.filter(window => window.present).map(window => `${window.slot}:${window.publicName ?? '-'}`).sort();
}

async function until(test, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await test();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

/** Starts Herald (replay or dev) and resolves once its health answers. Output is kept, never printed raw. */
async function startHerald(run, scratch) {
  if (await health()) throw new Error('something already answers on 127.0.0.1:5194; stop it first');
  const command = run.mode === 'replay'
    ? ['replay', '--scenario', run.scenario, ...(run.arrival ? ['--arrival', run.arrival] : []), ...(run.bindings ? ['--bindings', scratch] : [])]
    : ['dev'];
  const env = { ...process.env, HERALD_KINGDOM_SEED: seed, HERALD_KINGDOM_TIER: tier, HERALD_KINGDOM_FIRST_YEAR: firstYear, HERALD_KINGDOM_YEAR: year };
  const child = spawn(process.execPath, ['dist/herald.mjs', ...command], { cwd: HERALD, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let exited = null;
  child.on('exit', code => { exited = code ?? 1; });
  child.stdout.resume();
  child.stderr.resume();
  const stop = async () => {
    if (exited !== null) return;
    const gone = new Promise(done => child.once('exit', done));
    child.kill('SIGTERM');
    const deadline = globalThis.setTimeout(() => child.kill('SIGKILL'), 15_000);
    try { await gone; } finally { globalThis.clearTimeout(deadline); }
  };
  try {
    await until(async () => { if (exited !== null) throw new Error(`herald ${command[0]} exited (${exited})`); return health(); }, 60_000, `herald ${command[0]}`);
    return { stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

function expectPage(run, source, page) {
  const problems = [];
  const lit = page.activeWindows > 0;
  if (run.mode === 'replay') {
    if (run.name === 'unavailable') {
      if (page.ribbon !== 'CONNECTION LOST') problems.push(`ribbon ${page.ribbon}, expected CONNECTION LOST`);
      if (lit) problems.push('windows still lit after the source went away');
    } else {
      if (page.ribbon !== 'SIMULATED') problems.push(`ribbon ${page.ribbon}, expected SIMULATED`);
      if ((run.name === 'evening' || run.name === 'quiet' || run.name === 'restart') && !lit) problems.push('no lit windows');
      if (run.name === 'stale' && lit) problems.push('windows lit while the source is stale');
    }
  } else {
    if (page.ribbon === 'SIMULATED') problems.push('the real source shows SIMULATED');
    if (!source.available && page.ribbon !== 'CONNECTION LOST') problems.push(`unavailable real source shows ${page.ribbon}`);
    if (!source.available && lit) problems.push('windows lit while the real source is unavailable');
    if (source.available && source.frame) {
      // Main's ribbon reads the frame: fresh is LIVE CHAT, offline rests, stale is a lost connection.
      const connection = source.frame.connection;
      const ribbon = { fresh: 'LIVE CHAT', offline: 'STREAM RESTING', stale: 'CONNECTION LOST' }[connection];
      if (page.ribbon !== ribbon) problems.push(`real ${connection} source shows ${page.ribbon}, expected ${ribbon}`);
      if (connection === 'stale' && lit) problems.push('windows lit while the real source is stale');
    }
  }
  if (source.available && source.frame && page.activeWindows > source.frame.present) problems.push(`${page.activeWindows} windows lit for ${source.frame.present} present`);
  if (!(source.available && source.frame?.streamLive && source.frame.connection === 'fresh') && page.beaconFieldVisited > 0) problems.push('castle beacon lit without a fresh live broadcast');
  if (run.name === 'quiet' && page.names.length) problems.push('a quiet (unnamed) window was named');
  if (run.mode === 'replay') for (const name of page.names) if (!SYNTHETIC_NAMES.has(name)) problems.push('an unexpected window name appeared');
  if (page.errors.length) problems.push(`page errors: ${page.errors.join(' | ')}`);
  return problems;
}

async function settle(page) {
  await page.evaluate(() => new Promise(done => window.requestAnimationFrame(() => window.requestAnimationFrame(done))));
  await page.waitForFunction(() => window.__chatdomKingdom.stats.fieldSettled, null, { timeout: 120_000 });
  // Window lights fade toward the frame; capture once the lit count has held still for two seconds.
  let previous = -1;
  for (let held = 0; held < 2;) {
    await sleep(1_000);
    const count = await page.evaluate(() => window.__chatdomKingdom.stats.activeWindows);
    held = count === previous ? held + 1 : 0;
    previous = count;
  }
}

async function shoot(browser, run, path, sizes, kingdomId) {
  const query = new URLSearchParams({ source: 'herald', seed, tier, firstYear, year, hour: String(hour), camera: 'hero' });
  if (kingdomId) query.set('kingdom', kingdomId);
  if (run.mode === 'replay') query.set('presenceOrigin', 'simulated');
  const page = await browser.newPage({ viewport: { width: sizes[0][0], height: sizes[0][1] } });
  const errors = [];
  // A refused stream (503 while unavailable) is the adapter's expected input, not a page failure.
  const expected = text => /presence-data|EventSource|status of 503/.test(text);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !expected(message.text())) errors.push(message.text()); });
  const results = [];
  try {
    await page.goto(`${base}${path}?${query}`);
    await page.waitForFunction(() => window.__chatdomReady === true && window.__chatdomKingdom?.stats.ready && window.__chatdomKingdom.stats.fieldUploads > 0 && window.__chatdomKingdom.stats.fieldSettled, null, { timeout: 300_000 });
    // The kingdom page says CONNECTING, the stream view "Finding the kingdom", until the adapter has an answer.
    await page.waitForFunction(() => !/CONNECTING|FINDING THE KINGDOM/.test(document.querySelector('.source-ribbon')?.textContent?.toUpperCase() ?? ''), null, { timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await settle(page);
      const source = await health();
      const state = await page.evaluate(() => ({
        // The kingdom page's ribbon is the label itself; the stream view titles it (with a note on stage) and
        // shows no mark at all while chat is live. Both reduce to the adapter's label.
        ribbon: (() => {
          const ribbon = document.querySelector('.source-ribbon');
          if (!ribbon) return document.querySelector('[data-source="live"]') ? 'LIVE CHAT' : '';
          return (ribbon.querySelector('strong') ?? ribbon).textContent.trim().toUpperCase();
        })(),
        names: [...document.querySelectorAll('.window-name')].map(label => [...label.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join('').trim()),
        activeWindows: window.__chatdomKingdom.stats.activeWindows,
        beaconFieldVisited: window.__chatdomKingdom.stats.beaconFieldVisited,
        label: window.__chatdomKingdom.stats.source,
      }));
      const problems = expectPage(run, source ?? { available: false }, { ...state, errors });
      const file = join(OUT, `${run.file}-${tier}${path === '/stream' ? '-stream' : ''}@${width}x${height}.png`);
      await page.screenshot({ path: file });
      results.push({
        file: file.slice(OUT.length + 1), ribbon: state.ribbon, adapterLabel: state.label, litWindows: state.activeWindows,
        namedLabels: state.names.length, source: summary(source), problems,
      });
    }
  } finally {
    await page.close();
  }
  return results;
}

/** Herald health without anything that could identify a person: conditions and counts only. */
function summary(source) {
  if (!source) return null;
  const frame = source.frame;
  return {
    origin: source.origin, condition: source.condition, available: source.available, reason: source.reason,
    frame: frame && { connection: frame.connection, streamLive: frame.streamLive, present: frame.present, named: frame.named, windows: frame.windows },
  };
}

await mkdir(OUT, { recursive: true });
const release = await acquireCaptureLock();
let scratch, browser;
const seatings = {};
const report = { base, layout: { seed, tier, firstYear: Number(firstYear), year: Number(year) }, hour, at: new Date().toISOString(), runs: [] };
let failed = false;
try {
  scratch = await mkdtemp(join(tmpdir(), 'herald-shots-bindings-'));
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  for (const run of PLAN) {
    const herald = await startHerald(run, scratch);
    try {
      const reached = await until(async () => { const s = await health(); return s && ready[run.name](s) ? s : null; }, 120_000, `${run.name} to reach its moment`);
      const kingdomId = reached.available ? (await currentFrame()).kingdomId : null;
      process.stdout.write(`${run.file ?? `restart-${run.compare}`}: herald ${reached.condition}${reached.frame ? ` · ${reached.frame.connection} · ${reached.frame.present} lit` : ''}\n`);
      const entry = { run: run.file ?? `restart-${run.compare}` };
      if (run.compare) {
        const seated = seating(await currentFrame());
        seatings[run.compare] = seated;
        entry.restart = { arrival: run.arrival, durableTable: run.bindings, litWindows: seated.length, named: seated.filter(seat => !seat.endsWith(':-')).length };
        process.stdout.write(`  ${entry.run}: ${seated.length} lit · arrival ${run.arrival} · ${run.bindings ? 'scratch table' : 'memory only'}\n`);
      }
      if (run.file) {
        const shots = [
          ...await shoot(browser, run, '/', [[1440, 900], [390, 844]], kingdomId),
          ...await shoot(browser, run, '/stream', [[1920, 1080]], kingdomId),
        ];
        for (const shot of shots) {
          process.stdout.write(`  ${shot.file}: ${shot.ribbon} · ${shot.litWindows} lit · ${shot.namedLabels} named${shot.problems.length ? ` · FAIL ${shot.problems.join('; ')}` : ''}\n`);
          failed ||= shot.problems.length > 0;
        }
        entry.shots = shots;
      }
      report.runs.push(entry);
    } finally {
      await herald.stop();
    }
  }
  if (seatings.before) {
    const same = (a, b) => a && b && a.length === b.length && a.every((seat, index) => seat === b[index]);
    const stable = same(seatings.before, seatings.after);
    const moved = !same(seatings.before, seatings.control);
    report.restart = { stable, controlMoved: moved };
    process.stdout.write(`restart: ${stable ? 'every lit window and name kept its slot' : 'FAIL slots moved after the restart'} · control without the table ${moved ? 'moved them' : 'FAIL did not move them (the check proves nothing)'}\n`);
    failed ||= !stable || !moved;
  }
} finally {
  try { await browser?.close(); } finally {
    try {
      if (scratch) await rm(scratch, { recursive: true, force: true });
      await writeFile(join(OUT, `report-${tier}.json`), `${JSON.stringify(report, null, 2)}\n`);
    } finally { await release(); }
  }
}
process.stdout.write(`${failed ? 'FAILED' : 'ok'} · shots/herald/report-${tier}.json\n`);
process.exitCode = failed ? 1 : 0;
