// The Forge ritual's sound, checked in real Chrome through the real graph. Run from the repository root after
// `pnpm build`:
//   node apps/web/src/forge-ritual-bench/audio-demo.mjs [--base-url http://127.0.0.1:5176]
// Holds the shared host capture lock before any preview or browser starts, and releases it in `finally`.
//
// Live (the bench as host, a trusted click making the context): the ceremony heard once per stage, a scrub over the
// strike and arrival that plays nothing, a duplicate-frame hold, mute during the strike with no replay on unmute,
// zero volume, a real context suspension through the cooling with no backlog on resume, the refusal cough and its
// coalescing, two anvils overlapping, voice/source bounds and the console. The live host bus is recorded through an
// AudioWorklet tap to live.wav. Then the complete sequence is rendered through the same adapters offline at volume 1
// to sequence.wav, waveform.png, spectrum.png and audio.json (peak, duration, segment levels, node bounds, checks).
/* global AudioWorkletNode, Blob, btoa -- used inside page.evaluate, in the browser */
import { chromium } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { URL } from 'node:url';
import { CAPTURE_PORTS } from '../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { closeCapturePreview, startCapturePreview } from '../../../../packages/testing/preview.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const OUT = 'shots/forge-ritual';
const report = { port: null, checks: [], errors: [], live: {}, render: {} };
const check = (name, ok, detail = '') => {
  report.checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const db = peak => (peak <= 1e-6 ? 'silent' : `${(20 * Math.log10(peak)).toFixed(1)} dBFS`);

/** Probe only ports available to capture-owned servers. */
async function freePort() {
  for (const port of CAPTURE_PORTS) {
    const free = await new Promise(resolve => { const s = createServer().once('error', () => resolve(false)).once('listening', () => s.close(() => resolve(true))).listen(port, '127.0.0.1'); });
    if (free) return port;
  }
  throw new Error('No safe capture port available.');
}

// The offline sequence, in seconds. Each anvil is shown main's local frames for its segments; null between them.
const SEQUENCE = {
  duration: 76,
  anvils: [
    { ritual: 'demo-ceremony', segments: [
      { from: 0, to: 22, start: 0 }, // the whole ceremony, alone
      { from: 27, to: 36, start: 9.5 }, // the mute segment: pour → seal → (muted) strike → cool
      { from: 37, to: 49, start: 3, gate: 5 }, // a pending blueprint gate, held twelve seconds
      { from: 50, to: 73, start: 0 }, // two anvils: this one…
    ] },
    { ritual: 'demo-second-anvil', segments: [{ from: 50.7, to: 73.7, start: 0 }] }, // …and another 0.7 s behind
  ],
  actions: [
    { at: 23, anvil: 0, kind: 'refusal', variant: 0 },
    { at: 24.6, anvil: 0, kind: 'refusal', variant: 1 },
    { at: 26, anvil: 0, kind: 'refusal', variant: 2 },
    { at: 0, anvil: 0, kind: 'mix', muted: false, volume: 1 },
    { at: 0, anvil: 1, kind: 'mix', muted: false, volume: 1 },
    { at: 28.9, anvil: 0, kind: 'mix', muted: true, volume: 1 }, // local 11.4: muted through the stamp and the strike
    { at: 31.6, anvil: 0, kind: 'mix', muted: false, volume: 1 }, // local 14.1: back during the cooling
  ],
};
const SEGMENTS = [
  ['words', .2, 3, 'sound'], ['blueprint lock', 4.6, 5.4, 'sound'], ['pour', 6, 11, 'sound'], ['seal stamp', 11.3, 11.9, 'sound'],
  ['strike', 12.35, 13.4, 'sound'], ['cool', 13.4, 15.5, 'sound'], ['flight', 16, 18.6, 'sound'], ['landing', 18.65, 19.6, 'sound'],
  ['after the landing', 21.2, 22.8, 'quiet'], ['refusal ×3', 23, 27, 'sound'],
  ['muted through strike', 28.95, 31.6, 'silent'], ['unmuted cooling', 31.8, 33, 'sound'],
  ['pending blueprint hold', 40, 49, 'quiet'], ['two anvils', 50, 73.7, 'sound'],
];

const release = await acquireCaptureLock();
let server, browser;
try {
  let base = arg('--base-url');
  if (!base) {
    if (!existsSync('apps/web/dist/index.html')) throw new Error('Run `pnpm build` first; the demo previews the built app.');
    process.env.CHATDOM_SHOT_PORT = String(await freePort());
    const preview = await startCapturePreview();
    server = preview.server; base = preview.base;
  }
  report.port = new URL(base).port;
  console.log(`[forge-ritual audio] from ${base}`);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await mkdir(OUT, { recursive: true });
  // Small: the picture only has to keep the bench's clock moving in step with real time; SwiftShader cost scales
  // with pixels, and frames slower than 100 ms would let attacks expire (honestly, but not what we came to hear).
  const page = await browser.newPage({ viewport: { width: 420, height: 520 } });
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  await page.goto(`${base}/-/forge-ritual?part=chimney&family=hearth&hour=19.5&t=0`);
  await page.waitForFunction(() => window.__chatdomReady || window.__chatdomForgeRitualError, null, { timeout: 240_000 });
  const failure = await page.evaluate(() => window.__chatdomForgeRitualError);
  if (failure) throw new Error(`Bench failed: ${failure}`);

  /** Runs `fn(control)` in the page against the bench's review controls. */
  const bench = fn => page.evaluate(`(${fn})(window.__chatdomForgeRitual)`);
  const sound = () => bench(c => c.sound.report());
  const until = async (predicate, timeout = 90_000) => {
    const start = Date.now();
    for (;;) { const s = await bench(c => c.report()); if (predicate(s)) return s; if (Date.now() - start > timeout) throw new Error('timed out'); await page.waitForTimeout(40); }
  };
  const played = (s, cue) => s.forge.played[cue] ?? 0;
  const outcomes = (s, cue) => s.forge.events.filter(e => e.cue === cue).map(e => e.outcome);

  check('before any gesture there is no context and no sound', (await sound()).state === 'off');
  await page.getByRole('button', { name: 'Hear the forge' }).click();
  const on = await sound();
  check('a trusted click makes and starts the host context; the Forge layer mounts on its bus', on.state === 'running' && on.forge?.audible === true, on.state);

  // Record the live host bus through a worklet tap, so the real graph's output can be heard afterwards.
  await page.evaluate(async () => {
    const { context, bus } = window.__chatdomForgeRitual.sound.host();
    const source = `class Tap extends AudioWorkletProcessor { process(inputs) { const i = inputs[0]; if (i && i.length) this.port.postMessage([i[0].slice(), (i[1] ?? i[0]).slice()]); return true; } } registerProcessor('forge-demo-tap', Tap);`;
    await context.audioWorklet.addModule(URL.createObjectURL(new Blob([source], { type: 'application/javascript' })));
    const tap = new AudioWorkletNode(context, 'forge-demo-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    const sink = context.createGain(); sink.gain.value = 0;
    bus.connect(tap); tap.connect(sink); sink.connect(context.destination);
    window.__forgeTap = { chunks: [], tap, rate: context.sampleRate };
    tap.port.onmessage = event => window.__forgeTap.chunks.push(event.data);
  });

  // 1. The whole ceremony, live, at the bench's real frame rate.
  await bench(c => c.seek(0));
  await page.getByRole('button', { name: 'Play' }).click();
  await until(r => r.t > .05, 15_000).catch(async () => { throw new Error(`Play did not start the bench clock: ${JSON.stringify(await bench(c => c.report()))} ${report.errors.join(' | ')}`); });
  let peakLive = 0;
  const watch = async (until, timeout = 180_000) => { const begun = Date.now(); for (;;) { if (Date.now() - begun > timeout) throw new Error(`live ceremony: the bench clock stopped advancing at ${JSON.stringify(await bench(c => c.report()))}`); const s = await sound(); peakLive = Math.max(peakLive, s.peak); const r = await bench(c => c.report()); if (until(r)) return s; await page.waitForTimeout(30); } };
  const ceremonyStart = Date.now();
  await watch(r => r.t >= 21.6);
  report.live.ceremonyWallSeconds = +((Date.now() - ceremonyStart) / 1000).toFixed(1);
  console.log(`[forge-ritual audio] live ceremony took ${report.live.ceremonyWallSeconds} s of wall time for 21.6 s`);
  await page.getByRole('button', { name: 'Pause' }).click();
  let s = await sound();
  const stages = ['glint', 'gather', 'lock', 'clank', 'bubble', 'drip', 'stamp', 'ribbon', 'lift', 'swing', 'strike', 'quench', 'tick', 'launch', 'land', 'creak'];
  report.live.ceremony = Object.fromEntries(stages.map(cue => [cue, played(s, cue)]));
  report.live.ceremonyOutcomes = s.forge.events.filter(e => e.outcome !== 'played').map(e => `${e.cue}:${e.outcome}`);
  check('live: the ceremony sounds every hero moment exactly once', ['gather', 'lock', 'stamp', 'strike', 'quench', 'launch', 'land'].every(cue => played(s, cue) === 1), JSON.stringify(report.live.ceremony));
  check('live: the ceremony is audible on the host bus and stays under the ceiling', peakLive > .01 && peakLive < .95, db(peakLive));
  check('live: voices and sources stay within 12 and 32', s.forge.peakVoices <= 12 && s.forge.peakSources <= 32, `${s.forge.peakVoices} voices, ${s.forge.peakSources} sources`);

  // 2. A scrub across the strike, flight and arrival plays none of it; a held identical frame never repeats a strike.
  const before = s;
  await bench(c => c.seek(11.0)); await page.waitForTimeout(300);
  await bench(c => c.seek(19.7)); await page.waitForTimeout(400);
  s = await sound();
  check('scrub over strike and arrival: nothing from the jump is heard', played(s, 'strike') === played(before, 'strike') && played(s, 'land') === played(before, 'land'),
    s.forge.events.slice(-8).map(e => `${e.cue}:${e.outcome}`).join(' '));
  await bench(c => c.seek(12.2)); await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Play' }).click();
  await until(r => r.t >= 12.5); await page.getByRole('button', { name: 'Pause' }).click();
  const struck = played(await sound(), 'strike');
  await page.waitForTimeout(2000);
  s = await sound();
  check('a strike plays once, then two seconds of the same frame never strike again', struck === played(before, 'strike') + 1 && played(s, 'strike') === struck, `${struck} → ${played(s, 'strike')}`);

  // 3. Mute during the strike: silence at once, the strike consumed silently, no replay on unmute.
  await bench(c => c.seek(11.4)); await page.waitForTimeout(250);
  await page.getByRole('button', { name: 'Play' }).click();
  await until(r => r.t >= 11.75);
  await page.getByRole('button', { name: 'Mute the forge' }).click();
  // The master falls 60 dB in 30 ms; the analyser holds the last 43 ms, so read it once that window has turned over.
  await page.waitForTimeout(150);
  let mutedPeak = 0;
  for (let i = 0; i < 8; i++) { mutedPeak = Math.max(mutedPeak, (await sound()).peak); await page.waitForTimeout(40); }
  await until(r => r.t >= 13.2); await page.getByRole('button', { name: 'Pause' }).click();
  s = await sound();
  check('muted: the host bus is silent 150 ms after the press', mutedPeak < 1e-4, db(mutedPeak));
  check('muted: the strike is consumed silently, never queued', outcomes(s, 'strike').at(-1) === 'silent', outcomes(s, 'strike').join(','));
  await page.getByRole('button', { name: 'Hear the forge' }).click();
  await page.waitForTimeout(600);
  const unmuted = await sound();
  check('unmuted: nothing missed replays', played(unmuted, 'strike') === played(s, 'strike') && unmuted.forge.voices <= 1, `${unmuted.forge.voices} voice(s) after unmute`);
  await bench(c => c.sound.mix(false, 0)); await page.waitForTimeout(80);
  check('zero volume is silence and is reported as not audible', (await sound()).forge.audible === false);
  await bench(c => c.sound.mix(false, .65));

  // 4. A real suspension of the host context through the cooling and flight: no backlog on resume.
  await bench(c => c.seek(12.9)); await page.waitForTimeout(250);
  await page.getByRole('button', { name: 'Play' }).click();
  await until(r => r.t >= 13.1);
  await page.evaluate(() => window.__chatdomForgeRitual.sound.host().context.suspend());
  const ticksAtSuspend = played(await sound(), 'tick');
  await until(r => r.t >= 19.5);
  await page.getByRole('button', { name: 'Pause' }).click();
  const suspended = await sound();
  await page.evaluate(() => window.__chatdomForgeRitual.sound.host().context.resume());
  await page.waitForTimeout(500);
  s = await sound();
  check('suspended: cooling ticks, launch and arrival are consumed silently', suspended.state === 'suspended' && played(suspended, 'tick') === ticksAtSuspend && outcomes(suspended, 'land').at(-1) === 'silent',
    `${suspended.forge.events.filter(e => e.outcome === 'silent').length} silent`);
  check('resumed: no backlog plays and no voice is left running', played(s, 'land') === played(suspended, 'land') && s.forge.voices === 0 && s.peak < 1e-4, `${s.forge.voices} voices [${s.forge.sounding.join(',')}], ${db(s.peak)}`);

  // 5. The refusal cough, a duplicate of it, and two anvils overlapping on one layer.
  await page.getByRole('button', { name: 'Cough' }).click();
  await page.waitForTimeout(1500);
  await bench(c => { c.sound.refusal(1); c.sound.refusal(2); return null; });
  s = await sound();
  check('refusal: each beat coughs once; a second beat in the same 50 ms is coalesced', (s.forge.played.refusal ?? 0) === 2 && outcomes(s, 'refusal').includes('coalesced'), outcomes(s, 'refusal').join(','));
  await page.waitForTimeout(1500);
  await bench(c => c.sound.second(.35));
  await bench(c => c.seek(11.2)); await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Play' }).click();
  let layerPeak = 0, layerSources = 0, duoPeak = 0;
  for (const begun = Date.now(); ;) {
    if (Date.now() - begun > 120_000) throw new Error('two anvils: the bench clock stopped advancing');
    const r = await bench(c => c.report()), d = await sound();
    layerPeak = Math.max(layerPeak, d.forge.layerVoices); layerSources = Math.max(layerSources, d.forge.layerSources); duoPeak = Math.max(duoPeak, d.peak);
    if (r.t >= 14) break;
    await page.waitForTimeout(25);
  }
  await page.getByRole('button', { name: 'Pause' }).click();
  s = await sound();
  check('two anvils: both strikes are heard, the layer stays bounded and under the ceiling',
    (s.secondForge?.played.strike ?? 0) === 1 && layerPeak <= 12 && layerSources <= 32 && duoPeak < .95, `${layerPeak} voices, ${layerSources} sources, ${db(duoPeak)}`);
  await bench(c => c.sound.second(null));

  // The live recording, written as heard on the host bus.
  const live = await page.evaluate(() => {
    const { chunks, rate } = window.__forgeTap, n = chunks.reduce((sum, [l]) => sum + l.length, 0);
    const left = new Float32Array(n), right = new Float32Array(n);
    let o = 0, peak = 0;
    for (const [l, r] of chunks) { left.set(l, o); right.set(r, o); o += l.length; }
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    const bytes = new ArrayBuffer(44 + n * 4), view = new DataView(bytes);
    const text = (at, value) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
    text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, rate, true);
    view.setUint32(28, rate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) for (const [c, data] of [[0, left], [1, right]]) { const v = Math.max(-1, Math.min(1, data[i])); view.setInt16(44 + i * 4 + c * 2, v < 0 ? v * 32768 : v * 32767, true); }
    const u8 = new Uint8Array(bytes); let binary = '';
    for (let i = 0; i < u8.length; i += 0x8000) binary += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return { wav: btoa(binary), seconds: n / rate, peak };
  });
  await writeFile(`${OUT}/live.wav`, Buffer.from(live.wav, 'base64'));
  report.live.recording = { path: `${OUT}/live.wav`, seconds: +live.seconds.toFixed(2), peak: +live.peak.toFixed(4) };
  check('live recording captured from the real host bus', live.seconds > 20 && live.peak > .01 && live.peak < .95, `${live.seconds.toFixed(1)} s, ${db(live.peak)}`);

  // The complete sequence, offline through the same adapters at volume 1.
  const rendered = await page.evaluate(plan => window.__chatdomForgeRitual.sound.render(plan), SEQUENCE);
  const wav = Buffer.from(rendered.wav, 'base64');
  await writeFile(`${OUT}/sequence.wav`, wav);
  const rate = rendered.rate, frames = (wav.length - 44) / 4;
  const sample = (i, c) => wav.readInt16LE(44 + i * 4 + c * 2) / 32768;
  let peak = 0;
  for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(sample(i, 0)), Math.abs(sample(i, 1)));
  const level = (from, to) => {
    let max = 0, sum = 0, n = 0;
    for (let i = Math.floor(from * rate); i < Math.min(frames, Math.floor(to * rate)); i++) { const v = Math.max(Math.abs(sample(i, 0)), Math.abs(sample(i, 1))); max = Math.max(max, v); sum += v * v; n++; }
    return { peak: max, rms: Math.sqrt(sum / Math.max(1, n)) };
  };
  report.render = { path: `${OUT}/sequence.wav`, seconds: +(frames / rate).toFixed(2), rate, peak: +peak.toFixed(4), peakDb: db(peak), segments: [], adapters: rendered.inspections.map(i => ({ played: i.played, peakVoices: i.peakVoices, peakSources: i.peakSources, skipped: i.events.filter(e => e.outcome !== 'played').map(e => `${e.cue}:${e.outcome}`) })) };
  check('sequence: duration and a peak below 0.95 at volume 1', Math.abs(frames / rate - SEQUENCE.duration) < .01 && peak < .95 && peak > .05, `${(frames / rate).toFixed(2)} s, ${db(peak)}`);
  for (const [label, from, to, expect] of SEGMENTS) {
    const { peak: p, rms } = level(from, to);
    report.render.segments.push({ label, from, to, expect, peak: +p.toFixed(4), rmsDb: rms > 0 ? +(20 * Math.log10(rms)).toFixed(1) : null });
    const ok = expect === 'sound' ? p > .004 : expect === 'silent' ? p < 1e-4 : p < .05;
    check(`sequence: ${label} is ${expect}`, ok, `${db(p)} peak, rms ${rms > 0 ? (20 * Math.log10(rms)).toFixed(1) : '-∞'} dB`);
  }
  const [solo, duo] = rendered.inspections;
  check('sequence: the muted strike was consumed silently and the hold never struck', (solo.played.strike ?? 0) === 2 && solo.events.some(e => e.cue === 'strike' && e.outcome === 'silent'), JSON.stringify(solo.played));
  const lost = report.render.adapters.flatMap(a => a.skipped).filter(x => x.endsWith(':budget'));
  check('sequence: two whole ceremonies together lose nothing to the budget', lost.length === 0, lost.join(' ') || 'none');
  check('sequence: two anvils 0.7 s apart are both heard, within the layer bounds', (duo.played.strike ?? 0) === 1 && solo.peakVoices <= 12 && solo.peakSources <= 32, `${solo.peakVoices} voices, ${solo.peakSources} sources`);

  const wave = spawnSync('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', '-i', `${OUT}/sequence.wav`, '-filter_complex', "showwavespic=s=1800x360:split_channels=1:colors=#e8b46a|#9fc3d8:scale=sqrt,drawgrid=w=iw*10/76:h=0:color=#ffffff22", '-frames:v', '1', `${OUT}/waveform.png`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
  check('waveform written', wave.status === 0, wave.error ? String(wave.error) : wave.stderr.trim());
  const spectrum = spawnSync('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', '-i', `${OUT}/sequence.wav`, '-lavfi', 'showspectrumpic=s=1800x520:legend=1:scale=log:fscale=log:color=fire', `${OUT}/spectrum.png`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000 });
  check('spectrum written', spectrum.status === 0, spectrum.error ? String(spectrum.error) : spectrum.stderr.trim());
  await page.close();
  check('no console, page or worker errors', report.errors.length === 0, report.errors.join(' | '));
  report.result = report.checks.every(c => c.ok) ? 'passed' : 'failed';
  if (report.result !== 'passed') process.exitCode = 1;
} catch (error) {
  report.result = 'failed'; report.failure = String(error?.stack ?? error); process.exitCode = 1;
  console.error(report.failure);
  if (report.errors.length) console.error(`page errors:\n${report.errors.join('\n')}`);
} finally {
  await browser?.close();
  if (server) await closeCapturePreview(server);
  await release();
  await mkdir(OUT, { recursive: true });
  await writeFile(`${OUT}/audio.json`, JSON.stringify(report, null, 2));
}
