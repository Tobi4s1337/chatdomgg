// One still per moment on the stream view (1920×1080), fired through the real path while the page watches.
//   node scripts/live/stills.mjs [homes] [raid] [cheer] [hype]      (default: all four, in that order)
// Each still holds the shared capture lock only for its own page; stills land in work/evidence/live-twitch/.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../packages/testing/capture-lock.mjs';
import { BENCH, ROOT, sleep } from './lib.mjs';

const OUT = join(ROOT, 'work/evidence/live-twitch');
const URL = `http://127.0.0.1:${BENCH.webPort}/stream?source=realm&kingdom=${BENCH.kingdomId}`;
// When to shoot: after the command prints `cue`, wait `after` ms for the beat to reach its peak.
const MOMENTS = {
  // The stage held on its window shot (`camera=window`, an OBS setting): the lit homes read at street distance.
  homes: { command: ['chatters.mjs', '--count', '40', '--pace', '150'], cue: /windows lit at once/, after: 1_500, query: '&camera=window' },
  raid: { command: ['raid.mjs', '--viewers', '140'], cue: /reached kingdom/, after: 7_500 },
  cheer: { command: ['cheer.mjs', '--bits', '5000'], cue: /reached kingdom/, after: 5_000 },
  // The dragon's shot is the summoning: it wakes over the lair and takes the sky before the fight begins.
  hype: { command: ['hype.mjs', '--level', '5', '--fighters', '16'], cue: /the dragon is summoned/, after: 6_000 },
};
const chosen = process.argv.slice(2).filter(name => name in MOMENTS);
mkdirSync(OUT, { recursive: true });

for (const name of chosen.length ? chosen : Object.keys(MOMENTS)) {
  const moment = MOMENTS[name];
  const release = await acquireCaptureLock({ priority: 'lane' });
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(URL + (moment.query ?? ''), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 150_000 });
    await sleep(2_500);
    const fired = performance.now();
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(ROOT, 'scripts/live', moment.command[0]), ...moment.command.slice(1)], { stdio: ['ignore', 'pipe', 'inherit'] });
      let shot = false, out = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', async chunk => {
        out += chunk; process.stdout.write(chunk);
        if (shot || !moment.cue.test(out)) return;
        shot = true;
        try {
          await sleep(moment.after);
          const file = join(OUT, `${name}@1920x1080.png`);
          // What the director is looking at, so a still that misses its subject says so.
          const shotNow = await page.evaluate(() => window.__chatdomStream?.director ?? null).catch(() => null);
          // A software-rendered 1080p frame with the dragon in it can take most of a minute.
          await page.screenshot({ path: file, timeout: 150_000 });
          if (shotNow) console.info(`  shot: ${JSON.stringify(shotNow).slice(0, 240)}`);
          console.info(`  still: ${file} (${Math.round(performance.now() - fired)} ms after firing)`);
          resolve();
        } catch (error) { child.kill('SIGTERM'); reject(error); }
      });
      child.once('exit', code => { if (!shot) reject(new Error(`${name}: the command ended (${code}) before its cue`)); });
    });
  } finally {
    await browser.close();
    await release();
  }
}
