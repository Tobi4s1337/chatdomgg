// pnpm --filter @chatdom/audio demo
//
// Runs the kingdom audio library in real Chrome on its own Vite dev server (first free port in 5170–5199, stopped at
// the end): locked and rejected unlock, a trusted click, every finished family audible, mute and zero volume, the
// beacon interrupted by mute and by a real context suspension, the phrase bridge, the crowd, disposal (also during
// an unlock) and the console. Then it renders the complete sequence at full volume through the same graph in an
// OfflineAudioContext and writes shots/audio/kingdom-sequence.wav, kingdom-waveform.png, kingdom-sequence.json and
// the bench at 1440×900 and 390×844. Exits non-zero if any check fails.
/* global performance, btoa, DOMException -- used inside page.evaluate and addInitScript, in the browser */
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const out = join(root, 'shots/audio');
const assets = join(root, 'packages/audio/src/assets/kenney');
mkdirSync(out, { recursive: true });

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
const db = peak => (peak <= 1e-6 ? 'silent' : `${(20 * Math.log10(peak)).toFixed(1)} dBFS`);

/** Starts Vite on the first port in 5170–5199 that is free right now; never touches a server it did not start. */
async function startServer() {
  for (let port = 5170; port <= 5199; port++) {
    const server = await createServer({
      root: join(root, 'apps/web'), configFile: join(root, 'apps/web/vite.config.ts'), logLevel: 'error',
      server: { host: '127.0.0.1', port, strictPort: true },
      optimizeDeps: { entries: ['src/audio-bench/index.html'] },
    });
    try { await server.listen(); return { server, port }; }
    catch (error) { await server.close(); if (error?.code !== 'EADDRINUSE') throw error; }
  }
  throw new Error('no free port in 5170–5199');
}

// ---------------------------------------------------------------------------------------------------------------
// The sequence: every family on its own with its surface name, then together, the crowd, the mute and the
// interruption. Times in seconds. Segments say where the render must have energy and where it must be silent.
// ---------------------------------------------------------------------------------------------------------------
const MATERIALS = ['wood', 'stone', 'earth', 'metal', 'glass', 'fabric'];
const script = [], segments = [];
const add = (at, cue, options) => script.push(options ? { at, cue, options } : { at, cue });
const segment = (label, from, to, expect) => segments.push({ label, from, to, expect });

[['wood', 0.5], ['brass', 2.5], ['parchment', 4.5]].forEach(([ui, at]) => {
  for (let i = 0; i < 3; i++) add(at + i * 0.6, 'wood', ui === 'wood' ? undefined : { ui });
  segment(`${ui} control ×3`, at, at + 1.6, 'sound');
});
[7, 9, 11].forEach(at => add(at, 'light'));
segment('light ×3', 7, 12.9, 'sound');
add(13, 'wave'); segment('wave', 13, 15.8, 'sound');
add(16, 'beacon'); segment('beacon', 16, 21, 'sound');
MATERIALS.forEach((material, index) => {
  const at = 22 + index * 2;
  [0, 0.44, 0.88, 1.32].forEach((dt, step) => add(at + dt, 'step', { material, pan: step % 2 ? 0.12 : -0.12 }));
  segment(`step ${material}`, at, at + 1.5, 'sound');
});
MATERIALS.forEach((material, index) => {
  const at = 35 + index * 2.2;
  add(at, 'material', { material }); add(at + 0.55, 'place', { material }); add(at + 1.35, 'remove', { material });
  segment(`choose/set/lift ${material}`, at, at + 1.7, 'sound');
});
// Together: a knock, a window, the street and the beacon, as the kingdom plays them.
add(49, 'wood'); add(49.7, 'light'); add(51.6, 'wave'); add(54.6, 'beacon');
segment('together: knock, light, wave, beacon', 49, 59.4, 'sound');
// The stress burst: 120 far footsteps in 1.8 s on every surface, your own steps, building, a control, the beacon.
for (let i = 0; i < 120; i++) {
  add(60 + i * 0.015, 'step', { material: MATERIALS[i % 6], distance: 6 + ((i * 7) % 31), pan: (((i * 37) % 21) - 10) / 10 });
}
[0.05, 0.5, 0.95, 1.4].forEach((dt, i) => add(60 + dt, 'step', { material: 'stone', pan: i % 2 ? 0.12 : -0.12 }));
add(60.3, 'place', { material: 'metal' }); add(60.52, 'wood'); add(60.91, 'beacon'); add(61.2, 'wave'); add(61.4, 'wood', { ui: 'brass' });
segment('stress burst', 60, 66, 'sound');
// Mute at the beacon's crest: calls while muted are refused; after unmute nothing comes back until a new knock.
add(67, 'beacon');
script.push({ at: 67.7, settings: { muted: true } });
add(68, 'wood'); add(68.2, 'step', { material: 'stone' });
script.push({ at: 68.6, settings: { muted: false } });
add(70.2, 'wood', { ui: 'parchment' });
segment('beacon before mute', 67, 67.7, 'sound');
segment('muted, then unmuted: silence', 67.75, 70.15, 'silence');
segment('a new page after unmute', 70.2, 70.6, 'sound');
// The browser suspends the context at the beacon's crest; when it runs again, nothing replays.
add(71.5, 'beacon');
script.push({ at: 72.2, interrupt: true });
add(74, 'wood');
segment('beacon before interruption', 71.5, 72.2, 'sound');
segment('interrupted: silence', 72.21, 73.95, 'silence');
segment('a new knock after it runs again', 74, 74.4, 'sound');
const DURATION = 75.5;

// ---------------------------------------------------------------------------------------------------------------
const { server, port } = await startServer();
console.log(`dev server on 127.0.0.1:${port} (started by this demo, stopped at the end)`);
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const errors = [], warnings = [];
const result = { port, checks, segments: [], live: {} };
try {
  const url = `http://127.0.0.1:${port}/src/audio-bench/index.html`;
  async function open(width, height) {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`${width}: ${message.text()}`);
      if (message.type() === 'warning') warnings.push(`${width}: ${message.text()}`);
    });
    page.on('pageerror', error => errors.push(`${width}: ${error.message}`));
    // Demo instrumentation only: remember each real AudioContext so the demo can suspend it like the browser does,
    // and, while `__demoRefuse` is set, refuse resume() the way a browser without a user gesture does. SIMULATED:
    // headless Chrome does not enforce the autoplay policy, so its refusal has to be emulated here.
    await page.addInitScript(() => {
      const Native = window.AudioContext, contexts = [];
      window.__demoContexts = contexts;
      window.__demoRefuse = null;
      window.AudioContext = class extends Native {
        constructor(...args) { super(...args); contexts.push(this); if (window.__demoRefuse) void Native.prototype.suspend.call(this); }
        resume() {
          if (window.__demoRefuse === 'reject') return Promise.reject(new DOMException('SIMULATED refusal', 'NotAllowedError'));
          if (window.__demoRefuse === 'park') return new Promise(() => {});
          return super.resume();
        }
      };
    });
    await page.goto(url);
    await page.waitForFunction(() => window.__chatdomReady === true);
    return page;
  }
  const text = (page, id) => page.getByTestId(id).textContent();
  /** Peak of the live master output over `ms`, read from the library's own analyser. */
  const listen = (page, ms) => page.evaluate(async ms => {
    const audio = window.__chatdomAudio, inspect = window.__chatdomAudioInspect, until = performance.now() + ms;
    let peak = 0;
    while (performance.now() < until) { peak = Math.max(peak, inspect(audio).level()); await new Promise(r => setTimeout(r, 5)); }
    return peak;
  }, ms);

  const page = await open(1440, 900);

  // Locked; then unlocks the browser refuses (SIMULATED: parked like Chrome without a gesture, then rejected).
  const locked = await page.evaluate(() => ({ cue: window.__chatdomAudio.cue('wood'), state: window.__chatdomAudio.getState().status }));
  check('locked before any gesture: cue refused', !locked.cue && locked.state === 'locked' && await text(page, 'audio-status') === 'Locked', JSON.stringify(locked));
  for (const refusal of ['park', 'reject']) {
    const rejected = await page.evaluate(async refusal => {
      window.__demoRefuse = refusal;
      const started = performance.now(), answer = await window.__chatdomAudio.unlock();
      return { answer, state: window.__chatdomAudio.getState().status, ms: Math.round(performance.now() - started), cue: window.__chatdomAudio.cue('light') };
    }, refusal);
    check(`SIMULATED ${refusal === 'park' ? 'parked' : 'rejected'} resume: unlock not claimed`,
      !rejected.answer && rejected.state === 'locked' && !rejected.cue && await text(page, 'audio-status') === 'Locked' && await text(page, 'audio-audible') === 'No',
      `unlock() → ${rejected.answer} after ${rejected.ms} ms, ${rejected.state}`);
  }
  await page.evaluate(() => { window.__demoRefuse = null; });

  // A trusted click wakes it.
  await page.getByRole('button', { name: 'Wake the sound' }).click();
  await page.waitForFunction(() => window.__chatdomAudio.getState().status === 'ready');
  const awake = await page.evaluate(() => ({
    context: window.__chatdomAudioInspect(window.__chatdomAudio).contextState, rate: window.__demoContexts.at(-1).sampleRate,
    samples: window.__chatdomAudioInspect(window.__chatdomAudio).samples,
  }));
  check('trusted click → ready, context running, foley decoded',
    awake.context === 'running' && awake.samples.state === 'ready' && await text(page, 'audio-status') === 'Ready' && await text(page, 'audio-audible') === 'Yes',
    `${awake.samples.loaded}/${awake.samples.total} recordings, ${(awake.samples.decodedBytes / 1048576).toFixed(2)} MiB decoded at ${awake.rate} Hz`);
  result.live.decodedBytes = awake.samples.decodedBytes;
  result.live.sampleRate = awake.rate;

  // Every finished family, at the default volume, measured at the live master.
  const families = await page.evaluate(async () => {
    const audio = window.__chatdomAudio, inspect = window.__chatdomAudioInspect, rows = {};
    const keys = ['wood:wood', 'wood:brass', 'wood:parchment', 'light', 'wave', 'beacon',
      ...['step', 'place', 'remove', 'material'].flatMap(cue => ['wood', 'stone', 'earth', 'metal', 'glass', 'fabric'].map(m => `${cue}:${m}`))];
    for (const key of keys) {
      const [cue, surface] = key.split(':');
      const options = cue === 'wood' ? { ui: surface } : surface ? { material: surface } : {};
      const played = audio.cue(cue, options);
      let peak = 0;
      const until = performance.now() + (cue === 'beacon' ? 1600 : cue === 'wave' || cue === 'light' ? 900 : 420);
      while (performance.now() < until) { peak = Math.max(peak, inspect(audio).level()); await new Promise(r => setTimeout(r, 5)); }
      rows[key] = { played, peak: Number(peak.toFixed(4)) };
    }
    return rows;
  });
  const quiet = Object.entries(families).filter(([, row]) => !row.played || row.peak < 0.01);
  check(`all ${Object.keys(families).length} families audible at the live master`, quiet.length === 0,
    quiet.length ? `not audible: ${quiet.map(([key]) => key).join(', ')}` : `peaks ${Math.min(...Object.values(families).map(r => r.peak))}–${Math.max(...Object.values(families).map(r => r.peak))} at volume 0.65`);
  result.live.families = families;
  await page.waitForTimeout(3500);

  // Mute and zero volume.
  const mute = await page.evaluate(async () => {
    const audio = window.__chatdomAudio, inspect = window.__chatdomAudioInspect;
    audio.setSettings({ muted: true });
    const refused = [audio.cue('wood'), audio.cue('step', { material: 'stone' }), audio.cue('beacon')];
    await new Promise(r => setTimeout(r, 60));
    let peak = 0;
    for (let i = 0; i < 40; i++) { peak = Math.max(peak, inspect(audio).level()); await new Promise(r => setTimeout(r, 8)); }
    audio.setSettings({ muted: false });
    const back = audio.cue('wood');
    await new Promise(r => setTimeout(r, 400));
    audio.setSettings({ volume: 0 });
    const zero = audio.cue('light');
    audio.setSettings({ volume: 0.65 });
    return { refused, peak, back, zero };
  });
  check('muted: cues refused and the output is silent', mute.refused.every(answer => !answer) && mute.peak === 0, `peak ${db(mute.peak)}`);
  check('unmuted plays again; volume 0 refuses', mute.back && !mute.zero);

  // Mid-beacon mute through the bench's own card: nothing returns after unmute.
  await page.locator('[data-run=interrupt]').click();
  await page.waitForTimeout(2600);
  const muteMid = await page.evaluate(() => Object.fromEntries(['before', 'held', 'after'].map(k => [k, document.querySelector(`[data-testid=interrupt-${k}]`).textContent])));
  check('beacon muted at its crest: silent after unmute (bench card)', muteMid.before !== 'silent' && muteMid.after === 'silent', JSON.stringify(muteMid));

  // Mid-beacon suspension of the real context, resumed by a trusted click.
  const suspended = await page.evaluate(async () => {
    const audio = window.__chatdomAudio, inspect = window.__chatdomAudioInspect, context = window.__demoContexts.at(-1);
    const played = audio.cue('beacon');
    let before = 0;
    for (let until = performance.now() + 700; performance.now() < until;) { before = Math.max(before, inspect(audio).level()); await new Promise(r => setTimeout(r, 5)); }
    await context.suspend();
    await new Promise(r => setTimeout(r, 50));
    return { played, before, state: audio.getState().status, cue: audio.cue('wood') };
  });
  const shown = await page.waitForFunction(() => document.querySelector('[data-testid=audio-status]').textContent === 'Suspended', null, { timeout: 2000 })
    .then(() => 'Suspended', () => 'not shown');
  check('real suspension mid-beacon → suspended, cues refused', suspended.played && suspended.state === 'suspended' && !suspended.cue && shown === 'Suspended',
    `beacon at ${db(suspended.before)} before; status ${suspended.state}, shown ${shown}, cue → ${suspended.cue}`);
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Wake the sound' }).click();
  await page.waitForFunction(() => window.__chatdomAudio.getState().status === 'ready');
  const afterResume = await listen(page, 1500);
  const resumedCue = await page.evaluate(() => window.__chatdomAudio.cue('wood'));
  const resumedPeak = await listen(page, 300);
  check('resumed by a click: nothing replays, then a new knock plays', afterResume === 0 && resumedCue && resumedPeak > 0.01,
    `1.5 s after resume ${db(afterResume)}, new knock ${db(resumedPeak)}`);

  // The phrase bridge: a consumer phrase through the same mixer; bounds fail explicitly.
  const phrase = await page.evaluate(async () => {
    const audio = window.__chatdomAudio, play = window.__chatdomAudioPhrase, inspect = window.__chatdomAudioInspect;
    const chime = { key: 'demo:two-partials', build(voice) {
      const body = voice.gain(1);
      voice.chain(body, voice.out);
      voice.partial(body, 'triangle', 293.66, voice.t, 0.01, 0.05, 0.25);
      voice.partial(body, 'sine', 440, voice.t + 0.05, 0.01, 0.03, 0.2);
    } };
    const played = play(audio, chime, { delay: 0.05 });
    const sources = inspect(audio).sources;
    let peak = 0;
    for (let until = performance.now() + 500; performance.now() < until;) { peak = Math.max(peak, inspect(audio).level()); await new Promise(r => setTimeout(r, 5)); }
    let oversized = 'played';
    try { play(audio, { key: 'demo:too-many', build(voice) { for (let i = 0; i < 30; i++) voice.osc('sine', 300, voice.t, voice.t + 0.1).connect(voice.out); } }); }
    catch (error) { oversized = error.constructor.name; }
    let tooLong = 'played';
    try { play(audio, { key: 'demo:too-long', build(voice) { voice.osc('sine', 300, voice.t, voice.t + 9).connect(voice.out); } }); }
    catch (error) { tooLong = error.constructor.name; }
    const badDelay = play(audio, chime, { delay: Number.NaN });
    audio.setSettings({ muted: true });
    const muted = play(audio, { ...chime, key: 'demo:muted' });
    audio.setSettings({ muted: false });
    await new Promise(r => setTimeout(r, 400));
    return { played, sources, peak, oversized, tooLong, badDelay, muted, after: inspect(audio).sources };
  });
  check('phrase bridge: plays through the mixer, bounds throw, refusals are false',
    phrase.played && phrase.peak > 0.005 && phrase.oversized === 'RangeError' && phrase.tooLong === 'RangeError' && !phrase.badDelay && !phrase.muted && phrase.after === 0,
    `${phrase.sources} sources, ${db(phrase.peak)}, oversized → ${phrase.oversized}, 9 s → ${phrase.tooLong}`);

  // The crowd through the bench's button.
  await page.locator('[data-run=crowd]').click();
  await page.waitForTimeout(2300);
  const crowd = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-testid^=crowd-]')].map(n => [n.dataset.testid.slice(6), n.textContent])));
  check('crowd: control answered and beacon lit inside 16 voices / 64 layers',
    crowd.control === 'answered' && crowd.beacon === 'lit' && Number.parseInt(crowd.voices) <= 16 && Number.parseInt(crowd.layers) <= 64, JSON.stringify(crowd));
  await page.waitForTimeout(5200);
  const drained = await page.evaluate(() => { const i = window.__chatdomAudioInspect(window.__chatdomAudio); return { voices: i.voices, sources: i.sources }; });
  check('every voice and layer released after the crowd and the beacon', drained.voices === 0 && drained.sources === 0, JSON.stringify(drained));

  // The ceremony, for the bench shots.
  await page.locator('[data-run=ceremony]').click();
  await page.waitForTimeout(4600);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(out, 'kingdom-bench@1440x900.png') });
  await page.locator('.ab-interrupt').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(out, 'kingdom-bench-interrupt@1440x900.png') });

  // The complete sequence at full volume, through the same families, mixer and mix path, offline.
  const rendered = await page.evaluate(async ({ script, segments, duration }) => {
    // Seeded, so the same variations and noise come out every run.
    let seed = 20261030;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const render = await window.__chatdomAudioRender(script, { duration, settings: { volume: 1 }, random });
    const { buffer, played } = render, rate = buffer.sampleRate, left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    let peak = 0;
    for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    const measured = segments.map(s => {
      let p = 0, sum = 0;
      const a = Math.floor(s.from * rate), b = Math.min(left.length, Math.floor(s.to * rate));
      for (let i = a; i < b; i++) { const v = Math.max(Math.abs(left[i]), Math.abs(right[i])); p = Math.max(p, v); sum += left[i] * left[i] + right[i] * right[i]; }
      return { ...s, peak: p, rms: Math.sqrt(sum / Math.max(1, 2 * (b - a))) };
    });
    // 16-bit PCM stereo WAV of exactly what was rendered.
    const bytes = new Uint8Array(44 + left.length * 4), view = new DataView(bytes.buffer);
    const tag = (at, s) => { for (let i = 0; i < 4; i++) bytes[at + i] = s.charCodeAt(i); };
    tag(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, rate, true);
    view.setUint32(28, rate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, left.length * 4, true);
    for (let i = 0; i < left.length; i++) {
      view.setInt16(44 + i * 4, Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), true);
      view.setInt16(46 + i * 4, Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), true);
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { peak, duration: buffer.duration, rate, played, measured, wav: btoa(binary) };
  }, { script, segments, duration: DURATION });
  writeFileSync(join(out, 'kingdom-sequence.wav'), Buffer.from(rendered.wav, 'base64'));
  result.render = { peak: rendered.peak, duration: rendered.duration, sampleRate: rendered.rate };
  check('full-volume render peaks below 0.95', rendered.peak < 0.95, `peak ${rendered.peak.toFixed(3)} (${db(rendered.peak)}), ${rendered.duration.toFixed(1)} s at ${rendered.rate} Hz`);
  for (const s of rendered.measured) {
    const ok = s.expect === 'sound' ? s.peak > 0.01 : s.peak === 0;
    result.segments.push({ ...s, peak: Number(s.peak.toFixed(4)), rms: Number(s.rms.toFixed(5)) });
    check(`render ${s.from.toFixed(2)}–${s.to.toFixed(2)} s ${s.label}`, ok, `${s.expect}: peak ${db(s.peak)}`);
  }
  const refusedWhileMuted = rendered.played.filter(p => p.at >= 67.7 && p.at < 68.6);
  check('render: calls while muted were refused, every other call accounted for', refusedWhileMuted.length === 2 && refusedWhileMuted.every(p => !p.played),
    `${rendered.played.filter(p => p.played).length} of ${rendered.played.length} calls played (crowd steps held back by the budget)`);
  // Controls and the beacon have reserved room; the rest of the burst plays only if the mix has space for it.
  const burst = rendered.played.filter(p => p.at >= 60 && p.at < 62 && p.cue !== 'step');
  check('render: controls and the beacon played inside the burst', burst.filter(p => p.cue === 'wood' || p.cue === 'beacon').every(p => p.played),
    burst.map(p => `${p.cue}@${p.at} ${p.played ? 'played' : 'held back'}`).join(', '));

  // Disposal: the bench's own button, then disposal during an unlock on a fresh instance.
  await page.getByRole('button', { name: 'Close the sound' }).click();
  const closed = await page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 100));
    return { state: window.__chatdomAudio.getState().status, cue: window.__chatdomAudio.cue('wood'), context: window.__demoContexts.at(-1).state };
  });
  check('dispose: closed, cues refused, context closed', closed.state === 'disposed' && !closed.cue && closed.context === 'closed' && await text(page, 'audio-status') === 'Closed', JSON.stringify(closed));
  await page.getByRole('button', { name: 'New instance' }).click();
  const during = await page.evaluate(async () => {
    const audio = window.__chatdomAudio, pending = audio.unlock();
    audio.dispose();
    const answer = await pending;
    await new Promise(r => setTimeout(r, 100));
    return { answer, state: audio.getState().status, cue: audio.cue('wood'), context: window.__demoContexts.at(-1).state };
  });
  check('dispose during unlock: answers false and stays closed', !during.answer && during.state === 'disposed' && !during.cue && during.context === 'closed', JSON.stringify(during));
  await page.close();

  // Phone-sized bench: woken by a tap, the ceremony played.
  const phone = await open(390, 844);
  await phone.getByRole('button', { name: 'Wake the sound' }).click();
  await phone.waitForFunction(() => window.__chatdomAudio.getState().status === 'ready');
  await phone.locator('[data-run=ceremony]').click();
  await phone.waitForTimeout(1200);
  await phone.evaluate(() => window.scrollTo(0, 0));
  await phone.screenshot({ path: join(out, 'kingdom-bench@390x844.png') });
  await phone.waitForTimeout(3600);
  await phone.locator('.ab-interrupt').scrollIntoViewIfNeeded();
  await phone.locator('[data-run=interrupt]').click();
  await phone.waitForTimeout(2600);
  await phone.screenshot({ path: join(out, 'kingdom-bench-interrupt@390x844.png') });
  await phone.close();

  check('no console errors or page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  await server.close();
  console.log(`dev server on ${port} stopped`);
}

// Waveform with the segments marked: amber where sound is expected, grey bands where silence is.
const W = 1800, scale = W / DURATION;
const marks = segments.map(s => s.expect === 'silence'
  ? `drawbox=x=${Math.round(s.from * scale)}:y=36:w=${Math.max(2, Math.round((s.to - s.from) * scale))}:h=300:color=0x7f8c99@0.28:t=fill`
  : `drawbox=x=${Math.round(s.from * scale)}:y=30:w=2:h=6:color=0xf2b45a@0.9:t=fill`);
const labels = [[0.5, 'controls'], [7, 'light'], [13, 'wave'], [16, 'beacon'], [22, 'walk ×6'], [35, 'build ×6'], [49, 'together'], [60, 'burst'], [67, 'mute'], [71.5, 'interrupt']]
  .map(([at, label]) => `drawtext=fontfile=/usr/share/fonts/truetype/lato/Lato-Medium.ttf:text='${label}':x=${Math.round(at * scale) + 3}:y=12:fontsize=15:fontcolor=0xe8d6ad`);
const ticks = Array.from({ length: Math.floor((DURATION - 2) / 5) + 1 }, (_, i) =>
  `drawtext=fontfile=/usr/share/fonts/truetype/lato/Lato-Medium.ttf:text='${i * 5}s':x=${Math.round(i * 5 * scale) + 2}:y=346:fontsize=13:fontcolor=0x9a8a6c`);
const ffmpeg = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(out, 'kingdom-sequence.wav'), '-filter_complex',
  `[0:a]showwavespic=s=${W}x300:split_channels=0:colors=0xe8b25a:scale=lin[w];color=c=0x1d2c36:s=${W}x370:d=1[bg];[bg][w]overlay=0:36,${[...marks, ...labels, ...ticks].join(',')}`,
  '-frames:v', '1', join(out, 'kingdom-waveform.png')], { encoding: 'utf8' });
check('waveform written', ffmpeg.status === 0, ffmpeg.stderr.trim());

const shipped = readdirSync(assets).filter(name => name.endsWith('.wav'));
result.bytes = { files: shipped.length, shipped: shipped.reduce((sum, name) => sum + statSync(join(assets, name)).size, 0), decoded: result.live.decodedBytes };
check('shipped recordings ≤ 4 MiB, decoded ≤ 16 MiB', result.bytes.shipped <= 4 * 1048576 && result.bytes.decoded <= 16 * 1048576,
  `${result.bytes.files} files, ${result.bytes.shipped.toLocaleString('en')} bytes shipped, ${result.bytes.decoded.toLocaleString('en')} bytes decoded at ${result.live.sampleRate} Hz`);
result.warnings = warnings;
writeFileSync(join(out, 'kingdom-sequence.json'), `${JSON.stringify(result, null, 2)}\n`);

const failed = checks.filter(item => !item.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed. Render peak ${result.render?.peak.toFixed(3)} at full volume, ${result.render?.duration.toFixed(1)} s.`);
console.log('shots/audio/kingdom-sequence.wav, kingdom-waveform.png, kingdom-sequence.json, kingdom-bench{,-interrupt}@{1440x900,390x844}.png');
process.exit(failed.length ? 1 : 0);
