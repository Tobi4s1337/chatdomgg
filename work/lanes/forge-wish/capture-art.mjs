import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';

// Run the GPU branch only inside chatdom-pc-lease. The CPU fallback takes one still, no timings.
const gpu = process.argv[2] === 'gpu', port = gpu ? 5192 : 5171;
const output = 'work/evidence/forge-wish/contact-sheets';
const release = gpu ? async () => {} : await acquireCaptureLock({ signal: AbortSignal.timeout(120_000) });
let server, browser;
let cleanup;
function closeOwned() {
  return cleanup ??= (async () => {
    if (server && server.exitCode === null && server.signalCode === null) {
      const closed = once(server, 'close');
      try { process.kill(-server.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      await closed;
    }
    await browser?.close();
    await release();
  })();
}
// The preview owns a separate group for precise cleanup. Also close it if the outer lease times out.
process.once('SIGTERM', () => { void closeOwned().finally(() => process.exit(143)); });
process.once('SIGINT', () => { void closeOwned().finally(() => process.exit(130)); });
try {
  await mkdir(output, { recursive: true });
  server = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: 'apps/web', stdio: ['ignore', 'pipe', 'inherit'], detached: true });
  let exited = false, listening = false;
  server.stdout.on('data', chunk => { if (chunk.toString().includes(`:${port}`)) listening = true; });
  server.once('exit', () => { exited = true; });
  const start = Date.now();
  while (true) {
    if (exited || Date.now() - start > 20_000) throw new Error('Owned art preview failed to start.');
    try { if (listening && (await fetch(`http://127.0.0.1:${port}/src/forge-wish-bench/index.html`)).ok) break; } catch { /* wait for own preview */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (gpu) {
    const reports = [];
    for (const [name, query, size] of [
      ['moon-piece-hearth', 'view=piece&style=hearth&motif=crescent-moon&hour=14', '1440x900'],
      ['moon-home-hearth', 'view=home&style=hearth&motif=crescent-moon&hour=14', '1440x900'],
      ['moon-home-tide', 'view=home&style=tide&motif=crescent-moon&hour=19', '390x844'],
      ['moon-home-grove', 'view=home&style=grove&motif=crescent-moon&hour=19', '1440x900'],
      ['dragon-home', 'view=home&style=hearth&motif=sleeping-dragon&hour=19', '1440x900'],
      ['owl-piece', 'view=piece&style=hearth&motif=watchful-owl&hour=14', '1440x900'],
    ]) {
      const shot = spawn('chatdom-pc', ['shot', `http://localhost:${port}/src/forge-wish-bench/index.html?${query}`, `${output}/gpu-${name}@${size}.png`, '--size', size, '--timeout', '45', '--settle', '1'], { stdio: ['ignore', 'pipe', 'inherit'] });
      let report = '';
      shot.stdout.on('data', chunk => { report += chunk.toString(); process.stdout.write(chunk); });
      const [code] = await once(shot, 'close');
      if (code !== 0 || !report.includes(' · ready · ') || /swiftshader|llvmpipe|software/i.test(report)) throw new Error(`Ready real-GPU still required: ${name}`);
      reports.push(report.trim());
    }
    await writeFile(`${output}/gpu-capture.txt`, reports.join('\n') + '\n');
  } else {
    const { chromium } = await import('@playwright/test');
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/src/forge-wish-bench/index.html?view=piece&style=hearth&motif=crescent-moon&hour=14`);
    await page.waitForFunction(() => window.__chatdomReady === true || window.__chatdomForgeWishError, undefined, { timeout: 60_000 });
    const error = await page.evaluate(() => window.__chatdomForgeWishError);
    if (error || errors.length) throw new Error(error ?? errors.join('; '));
    await page.screenshot({ path: `${output}/swiftshader-moon-piece@1440x900.png` });
  }
} finally {
  await closeOwned();
}
