// The Atlas's material sound under real browser autoplay rules, without a map or a service:
// node apps/web/src/atlas/checks/sound-unlock-checks.mjs
// Runs the real module with real input in Chrome under two audio start rules. Headless Chrome on this host starts
// every AudioContext whatever its autoplay flags, and headless Firefox has no audio device at all, so the rules are
// enforced in the page around Chrome's real AudioContext: 'sticky' (Chrome and Firefox: audio may start any time
// after the page's first gesture, navigator.userActivation.hasBeenActive) and 'gesture' (Safari: audio starts only
// while a real input event is being dispatched; a request outside one stays pending, as the spec says).
// ATLAS_SOUND_BEFORE=<file> also runs an earlier copy of the module for comparison.
/* global performance, navigator, AbortSignal */
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../..');
const out = resolve(root, 'work/evidence/atlas-map', process.env.ATLAS_SOUND_EVIDENCE ?? 'am10-sound-unlock-checks.json');

async function moduleScript(file) {
  const source = await readFile(file, 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  return `${outputText.replace(/^export /gm, '')}\nwindow.AtlasMaterialSound = AtlasMaterialSound;`;
}

// A card answers its selection on pointerdown, as the map's marks and search rows do; a field primes; a press cues.
const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0;font:16px serif">
<button id="select" style="position:absolute;left:40px;top:40px;width:160px;height:60px">Select</button>
<input id="field" style="position:absolute;left:40px;top:140px;width:160px;height:40px">
<button id="press" style="position:absolute;left:40px;top:220px;width:160px;height:60px">Press</button>
<div id="cards"></div></body>`;

function instrument(rule) {
  const log = { strikes: [], contexts: 0, cardAt: [], pressAt: [], refusedStarts: 0 };
  window.__sound = log;
  // A real input event is being dispatched from its capture phase until its task ends.
  let dispatching = false;
  for (const type of ['pointerdown', 'pointerup', 'click', 'keydown', 'keyup', 'touchend']) {
    window.addEventListener(type, event => {
      if (!event.isTrusted) return;
      dispatching = true;
      setTimeout(() => { dispatching = false; }, 0);
    }, true);
  }
  const allowed = () => rule === 'sticky' ? navigator.userActivation.hasBeenActive : dispatching;
  const Native = window.AudioContext;
  const nativeResume = Native.prototype.resume;
  window.AudioContext = class extends Native {
    constructor(...args) {
      super(...args);
      log.contexts++;
      log.context = this;
      this.locked = !allowed();
      if (this.locked) { log.refusedStarts++; void this.suspend(); }
    }
    resume() {
      if (this.locked && !allowed()) { log.refusedStarts++; return new Promise(() => {}); }
      this.locked = false;
      return nativeResume.call(this);
    }
  };
  const create = window.BaseAudioContext.prototype.createOscillator;
  window.BaseAudioContext.prototype.createOscillator = function (...args) {
    log.strikes.push({ at: performance.now(), state: this.state });
    return create.apply(this, args);
  };
}

function wire() {
  const sound = new window.AtlasMaterialSound();
  const log = window.__sound;
  document.getElementById('select').addEventListener('pointerdown', () => {
    log.pressAt.push(performance.now());
    const card = document.createElement('section');
    card.textContent = 'card';
    document.getElementById('cards').append(card);
    log.cardAt.push(performance.now());
    sound.play('wax');
  });
  document.getElementById('press').addEventListener('pointerdown', () => { log.pressAt.push(performance.now()); sound.play('press'); });
  document.getElementById('field').addEventListener('pointerdown', () => sound.prime());
}

const sleep = ms => new Promise(done => setTimeout(done, ms));
async function tap(page, selector) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(90); // a finger's tap holds roughly this long; frames paint in between
  await page.mouse.up();
}
const read = page => page.evaluate(() => ({
  strikes: window.__sound.strikes.length,
  contexts: window.__sound.contexts,
  state: window.__sound.context?.state ?? 'none',
  refusedStarts: window.__sound.refusedStarts,
  cardMs: window.__sound.cardAt.map((at, i) => +(at - window.__sound.pressAt[i]).toFixed(1)),
}));

async function scenario(browser, script, rule, first) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(instrument, rule);
  await page.route('http://atlas.check/', route => route.fulfill({ contentType: 'text/html', body: PAGE }));
  await page.goto('http://atlas.check/');
  await page.addScriptTag({ content: script });
  await page.evaluate(wire);
  if (first === 'field') { await tap(page, '#field'); await sleep(300); }
  await tap(page, '#select');
  await sleep(900);
  const afterSelection = await read(page);
  await tap(page, '#press');
  await sleep(600);
  const afterPress = await read(page);
  await tap(page, '#press');
  await sleep(400);
  const afterSecondPress = await read(page);
  await context.close();
  return { first, afterSelection, afterPress, afterSecondPress, errors };
}

const RULES = [
  { rule: 'sticky', label: 'Chrome and Firefox rule (after the first gesture)' },
  { rule: 'gesture', label: 'Safari rule (only inside a gesture)' },
];

const modules = [{ version: 'current', file: resolve(here, '../ui/material-sound.ts') }];
if (process.env.ATLAS_SOUND_BEFORE) modules.unshift({ version: 'before', file: resolve(process.env.ATLAS_SOUND_BEFORE) });

const release = await acquireCaptureLock({ signal: AbortSignal.timeout(Number(process.env.ATLAS_LOCK_WAIT_MS ?? 1_200_000)) });
const results = [];
const failures = [];
try {
  for (const { version, file } of modules) {
    const script = await moduleScript(file);
    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    try {
      for (const { rule, label } of RULES) {
        for (const first of ['selection', 'field']) {
          const run = await scenario(browser, script, rule, first);
          // What the module promises: a first-selection cue sounds under the sticky rule and may stay silent under the
          // gesture rule (never late); a field tap readies the device; every later gesture sounds; one device; the
          // card is never held by audio; no page errors.
          const expectFirst = first === 'field' || rule === 'sticky';
          const pass = run.errors.length === 0 && run.afterSecondPress.contexts === 1
            && (!expectFirst || run.afterSelection.strikes === 1)
            && run.afterPress.strikes === run.afterSelection.strikes + 1
            && run.afterSecondPress.strikes === run.afterPress.strikes + 1
            && run.afterSecondPress.state === 'running'
            && run.afterSelection.cardMs.every(ms => ms < 20);
          results.push({ version, rule, label, ...run, pass });
          if (version === 'current' && !pass) failures.push(`${rule} first=${first}`);
          console.log(`${pass ? 'ok' : version === 'current' ? 'FAIL' : 'before-fails'} ${version} ${rule} first=${first} ${JSON.stringify({ selection: run.afterSelection, press: run.afterPress.strikes, again: run.afterSecondPress.strikes, state: run.afterSecondPress.state, errors: run.errors })}`);
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await release();
}
await writeFile(out, `${JSON.stringify({ at: new Date().toISOString(), note: 'Real input and the real AudioContext in headless Chrome; both start rules are enforced in the page because headless Chrome here starts audio regardless of autoplay flags. Not a Safari or physical-device run.', results, failures }, null, 2)}\n`);
console.log(failures.length ? `${failures.length} failing: ${failures.join('; ')}` : 'all current checks pass');
process.exit(failures.length ? 1 : 0);
