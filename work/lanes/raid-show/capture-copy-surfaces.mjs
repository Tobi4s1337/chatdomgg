// One UI-only contact still of actual private routes at their native viewport sizes.
// No 3D scene, authority write, public API or external service is used.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer, preview } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer as createProbe } from 'node:net';
import { setTimeout, clearTimeout } from 'node:timers';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { startCapturePreview, closeCapturePreview } from '../../../packages/testing/preview.mjs';
import { superviseCapture } from '../../../apps/web/src/twitch-moments-bench/capture-supervisor.mjs';

// A port held by anyone on any address is not ours: another worker's cleanup by port would stop this capture too.
const unheld = port => new Promise(resolve => {
  const probe = createProbe();
  probe.once('error', () => resolve(false));
  probe.listen({ port, host: '0.0.0.0', exclusive: true }, () => probe.close(() => resolve(true)));
});

if (!process.argv.includes('--worker')) {
  await superviseCapture(process.execPath, [fileURLToPath(import.meta.url), '--worker'], { deadlineMs: 3_600_000 });
} else {
  const release = await acquireCaptureLock({ signal: globalThis.AbortSignal.timeout(3_000_000) });
  const life = new globalThis.AbortController();
  let browser, shareRenderer;
  const timer = setTimeout(() => { life.abort(); void browser?.close(); }, 270_000);
  const servers = [];
  const report = { renderer: 'SwiftShader', scenes: false, performanceEvidence: false, errors: [], surfaces: [] };
  try {
    async function serve(kind) {
      // Highest free lane port first: another worker's cleanup has reclaimed 5171 under a running capture.
      for (let port = 5186; port >= 5170; port--) {
        if (!await unheld(port)) continue;
        life.signal.throwIfAborted();
        try {
          if (kind === 'web' && process.env.CHATDOM_RAID_SHOW_DIST) {
            // An alternate build directory (outside the repo) leaves the shared dist alone for captures already queued.
            const server = await preview({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', build: { outDir: process.env.CHATDOM_RAID_SHOW_DIST },
              preview: { host: '127.0.0.1', port, strictPort: true } });
            servers.push(server); return `http://127.0.0.1:${port}`;
          }
          if (kind === 'web') {
            process.env.CHATDOM_RAID_SHOW_PORT = String(port);
            const { server, base } = await startCapturePreview('CHATDOM_RAID_SHOW_PORT');
            servers.push(server); return base;
          }
          const server = await preview({ root: 'apps/dock', configFile: 'apps/dock/vite.config.ts',
            preview: { host: '127.0.0.1', port, strictPort: true } });
          servers.push(server); return `http://127.0.0.1:${port}`;
        } catch (error) { if (!/EADDRINUSE|in use/i.test(String(error))) throw error; }
      }
      throw new Error('No free owned preview port');
    }
    const web = await serve('web'), dock = await serve('dock');
    console.log(`Owned UI previews: ${web}, ${dock}`);
    browser = await chromium.launch({ channel: 'chrome', headless: true,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox',
      // The sheet's own page is route-fulfilled and has no address space; its loopback frames are not a public-to-local request.
      '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests'] });
    const page = await browser.newPage({ viewport: { width: 2880, height: 1792 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => report.errors.push(error.message));
    // Iframe console errors explain a surface that never becomes ready.
    page.on('console', message => { if (message.type() === 'error') (report.console ??= []).push(`${message.location()?.url ?? ''}: ${message.text()}`.slice(0, 400)); });
    // The dock's read-only private HTTP fixtures retain their actual simulated response mode.
    await page.route('**/api/**', route => {
      const url = new URL(route.request().url());
      assert.equal(url.origin, dock);
      assert.equal(route.request().method(), 'GET');
      const body = url.pathname === '/api/realm/session'
        ? { version: 1, status: 'authenticated', expiresAt: Date.now() + 300000, resumeScope: 'private-copy-surface-capture', csrfToken: 'c'.repeat(32) }
        : url.pathname === '/api/dock/status'
          ? { version: 1, status: 'ready', mode: 'SIMULATED', message: 'Ready', signInUrl: '/api/realm/auth/start?returnTo=%2Fdock', csrfToken: 'c'.repeat(32),
            kingdom: { id: '129634568', name: 'Willowmere' }, principal: { role: 'broadcaster', displayName: 'Ash' },
            town: { gate: 'open', fire: 'lit', presenceLabel: 'An evening by the fire', growthLabel: 'The western road', comingLabel: 'Guests at the gate' },
            raids: [], citizens: [], moments: [], capabilities: [], revision: 'copy-proof' }
          : null;
      assert.ok(body, `Unexpected API request: ${url.pathname}`);
      return route.fulfill({ json: body });
    });
    // The card's share picture, answered by the real share handler exactly as the passport's own card capture does
    // (SIMULATED authorities -> passport reader -> composition -> warm Chromium renderer), with no port of its own.
    const ssr = await createServer({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error', appType: 'custom',
      optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false } });
    servers.push(ssr);
    const load = path => ssr.ssrLoadModule(fileURLToPath(new URL(`../../../${path}`, import.meta.url)));
    const [share, chromiumShare, fonts, read, simulated] = await Promise.all([
      load('apps/api/src/passport/share.ts'), load('apps/api/src/passport/chromium.ts'), load('apps/api/src/passport/fonts.ts'),
      load('apps/api/src/passport/read.ts'), load('apps/api/src/passport/simulated.ts')]);
    shareRenderer = chromiumShare.createChromiumPassportImageRenderer();
    const fontFaces = fonts.passportFontFaces();
    const SCENARIO = { shown: { signedIn: true, travelsHidden: false }, hidden: { signedIn: true, travelsHidden: true }, unsigned: { signedIn: false, travelsHidden: false } };
    await page.route('**/-/passport/share.png?**', async route => {
      const url = new URL(route.request().url());
      const authorities = simulated.simulatedPassportAuthorities(url.searchParams.get('fixture') ?? 'many', SCENARIO[url.searchParams.get('state') ?? 'shown'] ?? SCENARIO.shown);
      const handler = share.createPassportShareHttp({ reader: read.createPassportReader(authorities.ports), subject: async () => authorities.key,
        renderer: shareRenderer, clock: () => authorities.now, fontFaces, report: fault => report.errors.push(`share fault: ${JSON.stringify(fault)}`) });
      const answer = await handler.handle(new globalThis.Request(url.href, { method: route.request().method() }));
      const headers = {}; answer.headers.forEach((value, key) => { headers[key] = value; });
      (report.share ??= []).push({ status: answer.status, type: answer.headers.get('content-type') });
      return route.fulfill({ status: answer.status, headers, body: globalThis.Buffer.from(await answer.arrayBuffer()) });
    });
    const gate = query => `${web}/-/raid-gate?backdrop=0&${query}`;
    const welcome = 'bench=simulated&viewer=walker&pick=41000002&walkers=4&join=1&start=1&witness=1&go=1&welcome=1&gift=both';
    const surfaces = [
      { name: 'gate-desktop', width: 1440, height: 900, url: gate('bench=simulated'), finder: true, phase: 'choosing' },
      { name: 'passport-desktop', width: 1440, height: 900, url: `${web}/-/passport?fixture=few&view=1&layout=spread` },
      { name: 'gate-phone', width: 390, height: 844, url: gate('bench=simulated&viewer=walker&pick=41000002&walkers=4'), phase: 'gathering' },
      { name: 'welcome-phone', width: 390, height: 844, url: gate(welcome), phase: 'departed', welcome: true },
      { name: 'passport-phone', width: 390, height: 844, url: `${web}/-/passport?fixture=many&view=3&layout=page` },
      { name: 'card-passport', width: 318, height: 496, url: `${web}/-/passport?surface=card&fixture=few&chrome=0&view=1` },
      { name: 'dock-phone', width: 390, height: 844, url: `${dock}/dock/?rehearsal=1&kingdom=129634568` },
      { name: 'authority-phone', width: 390, height: 844, url: gate('bench=simulated&authority=revoked'), phase: 'authority' },
      { name: 'unbound-phone', width: 390, height: 844, url: gate(''), phase: 'unbound' },
    ];
    // The contact sheet lives on the preview's own origin: an about:blank parent is not a secure context, so its
    // frames would lack crypto.randomUUID and the walker bench would stop before it is ready.
    await page.route(`${web}/__contact`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Contact</title>' }));
    await page.goto(`${web}/__contact`);
    await page.setContent('<style>body{margin:0;background:#171b27;color:#f5e5c6;font:14px Georgia}main{display:flex;flex-wrap:wrap;width:2880px}section{margin:0}p{height:24px;margin:0}iframe{border:0;display:block}</style><main></main>');
    for (const surface of surfaces) {
      await page.evaluate(surface => {
        const section = document.createElement('section');
        const label = document.createElement('p'); label.textContent = `${surface.name} · ${surface.width}×${surface.height}`;
        const frame = document.createElement('iframe'); frame.name = surface.name; frame.width = String(surface.width); frame.height = String(surface.height); frame.src = surface.url;
        section.append(label, frame); document.querySelector('main').append(section);
      }, surface);
      const frame = await page.waitForEvent('framenavigated', { predicate: frame => frame.name() === surface.name, timeout: 20000 }).catch(() => page.frame(surface.name));
      assert.ok(frame);
      console.log(`[capture] ${surface.name}`);
      try {
        await frame.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 90000 });
      } catch (error) {
        report.stuck = { surface: surface.name, url: frame.url(), state: await frame.evaluate(() => ({ ready: window.__chatdomReady,
          gate: window.__chatdomRaidGate?.snapshot?.() ?? null, text: document.body?.innerText?.slice(0, 600) })).catch(cause => String(cause)) };
        await writeFile('work/evidence/raid-show/copy-surfaces.json', JSON.stringify(report, null, 2));
        throw error;
      }
      if (surface.finder) {
        await frame.getByRole('button', { name: 'Choose where to ride' }).click();
        await frame.waitForFunction(() => window.__chatdomRaidGate?.snapshot().phase === 'choosing');
      }
      await frame.evaluate(() => document.fonts.ready);
      const state = await frame.evaluate(() => window.__chatdomRaidGate?.snapshot() ?? null);
      if (surface.phase) assert.equal(state?.phase, surface.phase, surface.name);
      if (state && surface.phase !== 'unbound') assert.equal(state.origin, 'simulated');
      if (surface.welcome) {
        assert.equal(state.welcome.status, 'ready');
        assert.equal(state.welcome.view.offers.length, 2);
        assert.equal(state.welcome.view.offers.filter(offer => offer.receipt !== null).length, 1);
      }
      // Labels are recorded per surface; the contact still is taken either way so every surface can be looked at.
      const labels = await frame.getByText(/simulated/i).count() + await frame.locator('[aria-label*="simulated" i], [title*="simulated" i]').count();
      if (labels) report.labelled = [...(report.labelled ?? []), surface.name];
      const layout = await frame.evaluate(() => {
        const board = document.querySelector('.rg-board')?.getBoundingClientRect();
        return { horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
          boardFits: !board || board.left >= 0 && board.top >= 0 && board.right <= window.innerWidth && board.bottom <= window.innerHeight };
      });
      assert.equal(layout.horizontalOverflow, false, `${surface.name}: horizontal overflow`);
      assert.equal(layout.boardFits, true, `${surface.name}: board fit`);
      report.surfaces.push({ ...surface, url: new URL(surface.url).pathname + new URL(surface.url).search, ...layout,
        phase: state?.phase, origin: state?.origin, welcomeReceipts: surface.welcome ? 1 : undefined });
    }
    assert.deepEqual(report.errors, []);
    // The card asked for its share picture and the real handler answered with one.
    assert.ok(report.share?.some(answer => answer.status === 200 && answer.type === 'image/png'), `share picture: ${JSON.stringify(report.share)}`);
    await mkdir('work/evidence/raid-show', { recursive: true });
    await page.screenshot({ path: 'work/evidence/raid-show/copy-surfaces.png', timeout: 30000 });
    report.result = report.labelled ? 'labels-found' : 'passed';
    await writeFile('work/evidence/raid-show/copy-surfaces.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    if (report.labelled) process.exitCode = 2;
  } finally {
    await shareRenderer?.dispose().catch(() => undefined);
    await browser?.close();
    for (const server of servers.reverse()) await ('ssrLoadModule' in server ? server.close() : closeCapturePreview(server));
    clearTimeout(timer); await release();
  }
}
