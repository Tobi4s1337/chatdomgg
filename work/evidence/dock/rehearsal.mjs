// One invocation holds the shared capture lock for one still or one short UI clip.
// This HTTP fixture models acknowledgements only. It does not connect to a kingdom.
import { createServer, request as httpRequest } from 'node:http';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const out = fileURLToPath(new URL('./', import.meta.url));
const [scenario = 'ready', dimensions = '318x900', format = 'still', extent = 'viewport'] = process.argv.slice(2);
const sizes = { '318x900': [318, 900], '390x844': [390, 844], '1440x900': [1440, 900] };
if (!sizes[dimensions] || !['still', 'clip'].includes(format) || !['viewport', 'full'].includes(extent)) throw Error('Usage: node work/evidence/dock/capture.mjs <scenario> <318x900|390x844|1440x900> <still|clip> <viewport|full>');
const actions = { open: 'Open the gate', close: 'Close the gate', fire: 'Light the fire', raid: 'Welcome Hollowbrook', crown: 'Crown Robin', knight: 'Knight Robin', moment: 'Play Skyfire' };
if (!['ready', 'anonymous', 'declined', 'forbidden', 'expired', 'fault', 'offline', 'unavailable', 'real-unavailable', 'moderator', 'empty', 'pending', 'refused', 'unknown', 'undo', 'sessionreplace', 'signout', 'ambiguous', ...Object.keys(actions)].includes(scenario)) throw Error('Unknown scenario');
const kinds = ['gate-open', 'gate-close', 'fire-light', 'raid-welcome', 'citizen-crown', 'citizen-knight', 'moment-play', 'undo'];
let revision = 1;
const csrfToken = 'fixture-csrf-token-0123456789abcdef';
let authenticated = !['anonymous', 'declined', 'expired'].includes(scenario);
let scope = 'simulated-session-scope-one';
let undoable = [];
let town = { gate: scenario === 'close' ? 'open' : 'closed', fire: 'unlit', presenceLabel: 'A few lights are gathering', growthLabel: 'A new home is taking shape.', comingLabel: 'Visitors are on the road.' };
function state() { return { kingdom: { id: '129634568', name: 'Willowmere' }, principal: { role: scenario === 'moderator' ? 'moderator' : 'broadcaster', displayName: 'Tobias' }, town, raids: scenario === 'empty' ? [] : [{ id: 'raid1', name: 'Hollowbrook' }], citizens: scenario === 'empty' ? [] : [{ id: 'citizen1', name: 'Robin' }], moments: scenario === 'empty' ? [] : [{ id: 'sky', name: 'Skyfire', available: true, reason: '' }], capabilities: kinds.map(kind => ({ kind, allowed: scenario !== 'moderator', reason: scenario === 'moderator' ? 'Only the monarch can do this.' : '' })), revision: String(revision), undoable }; }
const base = { version: 1, mode: 'SIMULATED', signInUrl: '/api/realm/auth/start?returnTo=%2Fdock' };
let handleDock, apiRunner;
let vite;
const server = createServer(async (req, res) => {
  if (!req.url?.startsWith('/api/')) { vite.middlewares(req, res, () => { res.writeHead(404).end(); }); return; }
  if (handleDock && req.url?.startsWith('/api/dock/')) {
    // Real API handler, simulated session lookup, and no realm bridge configured.
    await handleDock(req, res, { config: { mode: 'simulated', secureCookies: false, publicOrigin: 'http://dock.capture' }, pool: { query: async () => ({ rows: [{ person_id: '129634568', session_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }] }) } });
    return;
  }
  res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store');
  if (req.url === '/api/realm/session' && req.method === 'GET') {
    const expectedCookie = scope.endsWith('-two') ? 'rehearsal-session-2' : 'rehearsal-session';
    const hasCookie = (req.headers.cookie ?? '').split(/;\s*/).includes(`chatdom_session=${expectedCookie}`);
    res.end(JSON.stringify(authenticated && hasCookie ? { version: 1, status: 'authenticated', csrfToken, resumeScope: scope, expiresAt: Date.now() + 3600000 } : { version: 1, status: 'anonymous' })); return;
  }
  if (req.url === '/api/realm/signout' && req.method === 'POST') {
    if (!authenticated || !/chatdom_session=rehearsal-session/.test(req.headers.cookie ?? '') || req.headers['x-csrf-token'] !== csrfToken) { res.writeHead(403).end(JSON.stringify({ version: 1, status: 'refused', message: 'SIMULATED: sign-out refused.' })); return; }
    authenticated = false; res.setHeader('set-cookie', 'chatdom_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
    res.end(JSON.stringify({ version: 1, status: 'signed-out' })); return;
  }
  if (req.url?.startsWith('/api/dock/status')) {
    if (scenario === 'fault' || scenario === 'offline') { res.destroy(); return; }
    if (scenario === 'anonymous' || scenario === 'expired') { res.writeHead(401).end(JSON.stringify({ ...base, status: 'anonymous', message: 'Sign in with Twitch to open the dock.' })); return; }
    if (scenario === 'forbidden') { res.writeHead(403).end(JSON.stringify({ ...base, status: 'forbidden', message: 'This dock is for the broadcaster and their moderators.' })); return; }
    if (scenario === 'unavailable') { res.writeHead(503).end(JSON.stringify({ ...base, status: 'unavailable', message: 'The kingdom is not connected to the dock yet.' })); return; }
    res.end(JSON.stringify({ ...base, status: 'ready', message: 'Rehearsal fixture connected.', csrfToken, ...state() })); return;
  }
  if (req.url === '/api/dock/actions' && req.method === 'POST') {
    let data = ''; for await (const chunk of req) data += chunk;
    const action = JSON.parse(data);
    if (!authenticated || req.headers['x-csrf-token'] !== csrfToken || action.expectedRevision !== String(revision)) { res.writeHead(409).end(JSON.stringify({ version: 1, status: 'refused', message: 'SIMULATED: stale rehearsal action.' })); return; }
    await new Promise(resolve => setTimeout(resolve, scenario === 'pending' ? 3500 : 650));
    if (scenario === 'ambiguous') { res.destroy(); return; }
    if (scenario === 'refused' || scenario === 'unknown') { res.writeHead(scenario === 'refused' ? 409 : 503).end(JSON.stringify({ version: 1, status: scenario, message: `SIMULATED rehearsal ${scenario}; no stream is connected.` })); return; }
    if (action.kind === 'gate-open') town = { ...town, gate: 'open' };
    if (action.kind === 'gate-close') town = { ...town, gate: 'closed' };
    if (action.kind === 'fire-light') town = { ...town, fire: 'lit' };
    revision++;
    undoable = action.kind === 'undo' ? [] : [{ id: `simulated-${revision}`, kind: action.kind, label: 'opening the gate' }];
    res.end(JSON.stringify({ version: 1, status: 'accepted', receipt: `simulated-${revision}`, witness: { actionId: action.id, kingdomId: action.kingdomId, origin: 'simulated', streamEventId: `fixture-${revision}` }, message: `SIMULATED rehearsal acknowledged: ${action.kind}. No stream is connected.`, state: state() })); return;
  }
  res.writeHead(404).end('{}');
});

await mkdir(out, { recursive: true });
let browser;
const socketDirectory = await mkdtemp(join(tmpdir(), 'chatdom-dock-capture-'));
const socketPath = join(socketDirectory, 'bridge.sock');
try {
  if (scenario === 'real-unavailable') {
    const { runnerImport } = await import('vite');
    const imported = await runnerImport(`${root}/apps/api/src/dock/index.ts`, { root: `${root}/apps/api`, configFile: false, logLevel: 'warn', server: { middlewareMode: true, hmr: false, ws: false } });
    handleDock = imported.module.handleDock; apiRunner = imported.runner;
    delete process.env.DOCK_REALM_URL;
  }
  vite = await createViteServer({ root: `${root}/apps/dock`, configFile: `${root}/apps/dock/vite.config.ts`, server: { middlewareMode: true, hmr: false, ws: false, allowedHosts: ['dock.capture'] }, appType: 'spa', logLevel: 'error' });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  const origin = 'http://dock.capture';
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--unsafely-treat-insecure-origin-as-secure=http://dock.capture'] });
  const [width, height] = sizes[dimensions];
  const context = await browser.newContext({ viewport: { width, height }, ...(format === 'clip' ? { recordVideo: { dir: out, size: { width, height } } } : {}) });
  await context.route(`${origin}/**`, async route => {
    const request = route.request(), url = new URL(request.url());
    try {
      const response = await new Promise((resolve, reject) => {
        const upstream = httpRequest({ socketPath, path: `${url.pathname}${url.search}`, method: request.method(), headers: { ...request.headers(), host: 'dock.capture' } }, result => {
          const chunks = []; result.on('data', chunk => chunks.push(chunk)); result.on('end', () => resolve({ status: result.statusCode, headers: result.headers, body: Buffer.concat(chunks) })); result.on('error', reject);
        });
        upstream.on('error', reject); upstream.end(request.postDataBuffer() ?? undefined);
      });
      const headers = Object.fromEntries(Object.entries(response.headers).filter(([key, value]) => value !== undefined && !['transfer-encoding', 'connection', 'content-length'].includes(key)).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value]));
      await route.fulfill({ status: response.status, headers, body: response.body });
    } catch { await route.abort('failed'); }
  });
  if (authenticated) await context.addCookies([{ name: 'chatdom_session', value: 'rehearsal-session', url: origin }]);
  const page = await context.newPage();
  const errors = []; let posts = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const expectedFailure = ['forbidden', 'unavailable', 'real-unavailable', 'fault', 'offline', 'ambiguous', 'refused', 'unknown'].includes(scenario)
      && /Failed to load resource/.test(message.text()) && /\/api\/dock\//.test(message.location().url);
    if (!expectedFailure) errors.push(message.text());
  });
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/dock/actions')) posts++; });
  await page.goto(`${origin}/dock/?rehearsal=1${['declined', 'expired'].includes(scenario) ? `&signin=${scenario}` : ''}`);
  await page.waitForFunction(() => window.__chatdomReady === true);
  await page.getByText('Opening the throne').waitFor({ state: 'hidden' });
  await page.locator('.summary').first().waitFor();
  await page.getByText('SIMULATED', { exact: true }).first().waitFor();
  if (scenario === 'ready') await page.getByText('A few lights are gathering').waitFor();
  if (actions[scenario] || ['ambiguous', 'pending', 'refused', 'unknown', 'undo', 'sessionreplace'].includes(scenario)) {
    const title = actions[scenario] ?? actions.open;
    await page.getByRole('button', { name: new RegExp(title) }).click();
    if (scenario === 'ambiguous') {
      await page.getByText('The reply was lost.', { exact: false }).waitFor();
      await page.reload(); await page.waitForFunction(() => window.__chatdomReady === true);
      await page.getByText('An action may have reached the kingdom.', { exact: false }).waitFor();
      if (await page.getByRole('button', { name: /Open the gate/ }).isEnabled()) throw Error('Uncertain action unlocked after reload');
      if (posts !== 1) throw Error(`Expected one action POST, saw ${posts}`);
    }
    else if (scenario === 'pending') await page.getByRole('button', { name: /Sending/ }).waitFor();
    else if (scenario === 'refused' || scenario === 'unknown') {
      await page.getByText(`SIMULATED rehearsal ${scenario}`, { exact: false }).waitFor();
      if (scenario === 'unknown') { await page.reload(); await page.waitForFunction(() => window.__chatdomReady === true); await page.getByText('An action may have reached the kingdom.', { exact: false }).waitFor(); if (posts !== 1) throw Error('Unknown outcome was retried'); }
    } else {
      await page.getByText('SIMULATED rehearsal acknowledged:', { exact: false }).waitFor();
      if (scenario === 'undo' || scenario === 'sessionreplace') {
        if (scenario === 'sessionreplace') { scope = 'simulated-session-scope-two'; undoable = []; await context.addCookies([{ name: 'chatdom_session', value: 'rehearsal-session-2', url: origin }]); }
        await page.reload(); await page.waitForFunction(() => window.__chatdomReady === true);
        if (scenario === 'undo') {
          await page.getByRole('button', { name: /Undo opening the gate/ }).click();
          await page.getByText('SIMULATED rehearsal acknowledged: undo', { exact: false }).waitFor();
          await page.reload(); await page.waitForFunction(() => window.__chatdomReady === true);
          if (await page.getByRole('button', { name: /Undo opening the gate/ }).count()) throw Error('Undone act remained available after reload');
        }
        else if (await page.getByRole('button', { name: /Undo opening the gate/ }).count()) throw Error('Previous session undo leaked into new session');
      }
    }
  }
  if (scenario === 'signout') { await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await page.getByText('You signed out of the throne.').waitFor(); await page.getByText('Take your place').waitFor(); }
  if (scenario === 'ready') {
    const focused = page.getByRole('button', { name: /Welcome Hollowbrook/ });
    await focused.focus();
    await page.waitForTimeout(10500);
    if (!await focused.evaluate(element => element === document.activeElement)) throw Error('Action lost focus during status poll');
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) throw Error('Horizontal document overflow');
  if (errors.length) throw Error(`Browser errors: ${errors.join('; ')}`);
  if (format === 'still') await page.screenshot({ path: `${out}/${scenario}-${dimensions}-${extent}.png`, fullPage: extent === 'full' });
  else { await page.waitForTimeout(scenario === 'pending' ? 4000 : 1000); const video = page.video(); await page.close(); await context.close(); await rename(await video.path(), `${out}/${scenario}-${dimensions}.webm`); }
  if (scenario === 'pending' && format === 'still') await page.waitForTimeout(4000);
  await context.close().catch(() => {});
  console.log(`Captured ${scenario} ${dimensions} ${format}; SIMULATED UI fixture only.`);
} finally {
  await browser?.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await vite?.close();
  await apiRunner?.close?.();
  await rm(socketDirectory, { recursive: true, force: true });
}
