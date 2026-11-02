// nice -n 19 node apps/studio/sound/ambience/render.mjs            render everything, mix, measure, write the manifest
// nice -n 19 node apps/studio/sound/ambience/render.mjs --mix-only  re-mix and re-measure from the rendered layers
// nice -n 19 node apps/studio/sound/ambience/render.mjs --probe     list the observed channels' biomes and lands
// nice -n 19 node apps/studio/sound/ambience/render.mjs name ...    render only the named layers, then mix and measure
// nice -n 19 node apps/studio/sound/ambience/render.mjs --survey    render 300 s of the land at dusk and night and list
//                                                                  every call, to choose each bed's stretch of realm time
//
// Builds the bench (main.ts) before taking the capture lock, then holds the lock only for one short headless
// Chromium session on the first free capture port: each layer is rendered in an OfflineAudioContext and handed back
// as raw Float32 samples. With the browser and server closed and the lock released, Node writes the WAVs, mixes the
// two beds into seamless 30 s loops, measures everything with ffmpeg (EBU R128, true peak, astats), writes the
// edit-ready copies, the spectrograms, measurements.json and apps/studio/sound/ambience.json.
/* global AbortSignal -- Node's own global */
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { CAPTURE_PORTS } from '../../../../packages/testing/capture-ports.mjs';

const bench = dirname(fileURLToPath(import.meta.url));
const MEDIA = '/srv/chatdom/media/teaser/audio/ambience';
const RAW = join(MEDIA, 'raw'), LAYERS = join(RAW, 'layers'), EDIT = join(MEDIA, 'edit'), PICS = join(MEDIA, 'spectrograms');
const MANIFEST = join(bench, '..', 'ambience.json');
const RATE = 48000;
const BED_LUFS = -28, BED_TP_LIMIT = -6.5, HERO_TP = -6;
const log = message => console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
for (const dir of [RAW, LAYERS, EDIT, PICS]) mkdirSync(dir, { recursive: true });

// ---------------------------------------------------------------------------------------------------------------
// What to render. Channel 4363967 is the observed meadow-soul Genesis fixture (spec 39); its coastal-harbour land
// gives the sea and harbour, and the meadow chorus gives blackbirds at dusk and owls at night.
// ---------------------------------------------------------------------------------------------------------------
const COAST = '4363967';
const LOOP = 30, FADE = 4; // a bed is LOOP seconds, rendered LOOP + FADE and folded into a seamless loop

/** A passer-by on the cobbles: steps along a straight line past the ear, the nearest point mid-way. */
function passer({ at, steps, pace, near, far, from, to, material }) {
  return Array.from({ length: steps }, (_, i) => {
    const x = steps > 1 ? i / (steps - 1) : 0.5, jitter = ((i * 37) % 11 - 5) * 0.006;
    return {
      at: Number((at + i * pace + jitter).toFixed(3)), cue: 'step',
      options: { material, distance: Number((near + (far - near) * Math.abs(2 * x - 1) ** 1.3).toFixed(2)), pan: Number((from + (to - from) * x).toFixed(3)) },
    };
  });
}

const LAYER_TASKS = {
  'evening-land': {
    kind: 'land', channel: COAST, character: 'coastal-harbour', hour: 19.5, towardsForest: 70, height: 3, realmOffsetSeconds: 174,
    weather: { wind: 0.3, rain: 0, snow: 0, storm: 0, fog: 0, wet: 0 }, seconds: LOOP + FADE, preroll: 8,
  },
  'evening-murmur': { kind: 'murmur', seconds: LOOP + FADE, seed: 0x7e5e, talkers: 12, air: 1400 },
  'evening-fire': { kind: 'fire', seconds: LOOP + FADE, seed: 0x4ea7, size: 0.3, distance: 0.55, pan: -0.35 },
  'evening-steps': {
    kind: 'kingdom', seconds: LOOP + FADE, seed: 0x57e9, script: [
      ...passer({ at: 6.2, steps: 14, pace: 0.53, near: 4.5, far: 15, from: -0.8, to: 0.75, material: 'stone' }),
      ...passer({ at: 15.4, steps: 11, pace: 0.58, near: 11, far: 20, from: 0.7, to: -0.55, material: 'stone' }),
      ...passer({ at: 21.6, steps: 9, pace: 0.5, near: 15, far: 22, from: -0.3, to: 0.5, material: 'wood' }),
    ],
  },
  'night-land': {
    kind: 'land', channel: COAST, character: 'coastal-harbour', hour: 23.2, towardsForest: 70, height: 3, realmOffsetSeconds: 237,
    weather: { wind: 0.28, rain: 0, snow: 0, storm: 0, fog: 0.35, wet: 0 }, seconds: LOOP + FADE, preroll: 8,
  },
  'night-fire': { kind: 'fire', seconds: LOOP + FADE, seed: 0xb2a5, size: 0.75, distance: 0.4, pan: 0.3 },

  'hero-light': { kind: 'kingdom', seconds: 4, seed: 11, script: [{ at: 0.05, cue: 'light' }] },
  'hero-wave': { kind: 'kingdom', seconds: 5, seed: 12, script: [{ at: 0.05, cue: 'wave' }] },
  'hero-beacon': { kind: 'kingdom', seconds: 8, seed: 13, script: [{ at: 0.05, cue: 'beacon' }] },
  'hero-crowd-murmur': { kind: 'moment', seconds: 5.5, cues: [{ cue: 'crowd-murmur', at: 0.05 }] },
  'hero-crowd-cheer': { kind: 'moment', seconds: 6.5, cues: [{ cue: 'crowd-cheer', at: 0.05 }] },
  'hero-horn': { kind: 'moment', seconds: 3, cues: [{ cue: 'horn', at: 0.05 }] },
  'hero-cart-roll': { kind: 'moment', seconds: 5, cues: [{ cue: 'cart-roll', at: 0.05 }] },
  'hero-festival-drum': { kind: 'moment', seconds: 4, cues: [{ cue: 'festival-drum', at: 0.05 }] },
  // The Forge: the hammer lifting at the end of the seal, the swing, the strike and its ring; then the anvil is clear.
  'hero-forge-strike': { kind: 'forge', from: 11.75, to: 12.7, lead: 0.4, seconds: 8.5 },
  // Flight and landing: the release, the air along the arc, the contact on the roof, the creak; then nothing.
  'hero-forge-landing': { kind: 'forge', from: 15.5, to: 21, lead: 0.3, seconds: 8.5 },
  // The whole ritual on the authored 21 s schedule: words, blueprint, pour, seal, strike, cool, flight, landing.
  'hero-forge-ritual': { kind: 'forge', from: 0, to: 21, lead: 0.5, seconds: 29 },
};

/** Bed layers: each stem is set to a level before the sum (LUFS of the stem alone, or a plain dB gain). */
const BEDS = {
  'bed-evening-town': [
    { layer: 'evening-land', lufs: -30 },
    { layer: 'evening-murmur', lufs: -37.5 },
    { layer: 'evening-fire', lufs: -40 },
    { layer: 'evening-steps', db: 8 },
  ],
  'bed-night-town': [
    { layer: 'night-land', lufs: -30 },
    { layer: 'night-fire', lufs: -36 },
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// WAV in and out (32-bit float raw, 24-bit PCM edit copies are written by ffmpeg).
// ---------------------------------------------------------------------------------------------------------------
function writeFloatWav(file, channels, rate = RATE) {
  const frames = channels[0].length, count = channels.length, dataBytes = frames * count * 4;
  const buffer = Buffer.alloc(12 + 26 + 12 + 8 + dataBytes);
  let o = 0;
  const text = s => { buffer.write(s, o, 'ascii'); o += 4; };
  const u32 = v => { buffer.writeUInt32LE(v, o); o += 4; }, u16 = v => { buffer.writeUInt16LE(v, o); o += 2; };
  text('RIFF'); u32(buffer.length - 8); text('WAVE');
  text('fmt '); u32(18); u16(3); u16(count); u32(rate); u32(rate * count * 4); u16(count * 4); u16(32); u16(0);
  text('fact'); u32(4); u32(frames);
  text('data'); u32(dataBytes);
  for (let i = 0; i < frames; i++) for (let c = 0; c < count; c++) { buffer.writeFloatLE(channels[c][i], o); o += 4; }
  writeFileSync(file, buffer);
}

function readFloatWav(file) {
  const bytes = readFileSync(file);
  let at = 12, channels = 2, data = 0, size = 0, format = 3;
  while (at + 8 <= bytes.length) {
    const id = bytes.toString('ascii', at, at + 4), length = bytes.readUInt32LE(at + 4);
    if (id === 'fmt ') { format = bytes.readUInt16LE(at + 8); channels = bytes.readUInt16LE(at + 10); }
    if (id === 'data') { data = at + 8; size = length; break; }
    at += 8 + length + (length % 2);
  }
  if (format !== 3) throw new Error(`${file}: expected 32-bit float`);
  const frames = size / (4 * channels), out = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) out[c][i] = bytes.readFloatLE(data + (i * channels + c) * 4);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// ffmpeg, always under nice and at most four threads.
// ---------------------------------------------------------------------------------------------------------------
function ffmpeg(args) {
  const result = spawnSync('nice', ['-n', '19', 'ffmpeg', '-hide_banner', '-nostdin', '-threads', '4', '-filter_threads', '2', ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}\n${result.stderr.slice(-2000)}`);
  return result.stderr;
}

function measure(file) {
  const text = ffmpeg(['-nostats', '-loglevel', 'verbose', '-i', file, '-af', 'ebur128=peak=true:framelog=verbose,astats=measure_perchannel=none', '-f', 'null', '-']);
  const summary = text.slice(text.lastIndexOf('Summary:'));
  const num = (re, source = summary) => { const m = re.exec(source); return m ? Number(m[1]) : null; };
  const frames = [...text.matchAll(/t:\s*([\d.]+)\s+TARGET.*?M:\s*(-?[\d.]+|-inf)\s+S:\s*(-?[\d.]+|-inf)/g)]
    .map(m => ({ t: Number(m[1]), m: Number(m[2]), s: Number(m[3]) }));
  const overall = text.slice(text.lastIndexOf('Overall'));
  const shortTerm = frames.filter(f => f.t >= 3 && Number.isFinite(f.s)).map(f => f.s);
  const momentary = frames.filter(f => Number.isFinite(f.m)).map(f => f.m);
  const stats = list => {
    if (!list.length) return null;
    const mean = list.reduce((a, b) => a + b, 0) / list.length;
    return { min: round(Math.min(...list)), max: round(Math.max(...list)), sd: round(Math.sqrt(list.reduce((a, b) => a + (b - mean) ** 2, 0) / list.length)) };
  };
  const clock = /Duration: (\d+):(\d+):([\d.]+)/.exec(text), duration = clock ? round(Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]), 3) : null;
  return {
    integratedLufs: num(/I:\s*(-?[\d.]+) LUFS/), loudnessRangeLu: num(/LRA:\s*(-?[\d.]+) LU/), truePeakDbtp: num(/Peak:\s*(-?[\d.]+) dBFS/),
    samplePeakDbfs: num(/Peak level dB:\s*(-?[\d.]+|-inf)/, overall), rmsDbfs: num(/RMS level dB:\s*(-?[\d.]+|-inf)/, overall),
    dcOffset: num(/DC offset:\s*(-?[\d.]+)/, overall), flatFactor: num(/Flat factor:\s*(-?[\d.]+)/, overall), peakCount: num(/Peak count:\s*(\d+)/, overall),
    momentaryLufs: stats(momentary), shortTermLufs: stats(shortTerm), duration,
  };
}
const round = (v, digits = 1) => Number(v.toFixed(digits));

function spectrogram(file, png, title, size = '1600x600') {
  ffmpeg(['-loglevel', 'error', '-y', '-i', file, '-lavfi',
    `showspectrumpic=s=${size}:legend=1:mode=combined:fscale=log:scale=log:drange=100,drawtext=text='${title}':x=20:y=8:fontcolor=white:fontsize=18`, png]);
}

// ---------------------------------------------------------------------------------------------------------------
// The browser session.
// ---------------------------------------------------------------------------------------------------------------
async function session(names, probeOnly) {
  const outDir = await mkdtemp(join(tmpdir(), 'chatdom-teaser-ambience-'));
  const report = {};
  try {
    log('building the bench');
    await build({ root: bench, configFile: false, logLevel: 'error', base: './', build: { outDir, emptyOutDir: true, target: 'es2022' } });
    report.buildFingerprint = createHash('sha256').update(await readFile(join(outDir, 'index.html'))).digest('hex').slice(0, 16);
    const signal = AbortSignal.timeout(10 * 60 * 1000);
    const release = await acquireCaptureLock({ signal });
    log('capture lock acquired');
    let server, browser;
    try {
      for (const port of CAPTURE_PORTS) {
        try { server = await preview({ root: bench, configFile: false, logLevel: 'error', build: { outDir }, preview: { host: '127.0.0.1', port, strictPort: true } }); break; }
        catch (error) { if (!/already in use|EADDRINUSE/.test(String(error))) throw error; }
      }
      if (!server) throw new Error('no free capture port');
      const port = server.httpServer.address().port;
      log(`preview on 127.0.0.1:${port}`);
      browser = await chromium.launch({ headless: true, timeout: 30000, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(`http://127.0.0.1:${port}/`, { timeout: 30000 });
      await page.waitForFunction(() => window.ambienceReady === true, null, { timeout: 60000 });
      report.channels = await page.evaluate(() => window.probeAmbience());
      report.scene = await page.evaluate(channel => window.sceneAmbience(channel, 'coastal-harbour'), COAST);
      if (process.argv.includes('--survey')) {
        const base = { kind: 'land', channel: COAST, character: 'coastal-harbour', seconds: 300, preroll: 4, height: 3 };
        const fair = { wind: 0.3, rain: 0, snow: 0, storm: 0, fog: 0, wet: 0 }, mist = { wind: 0.28, rain: 0, snow: 0, storm: 0, fog: 0.35, wet: 0 };
        const tasks = [{ ...base, hour: 19.5, weather: fair, towardsForest: 70 }, { ...base, hour: 23.2, weather: mist, towardsForest: 70 }];
        const rows = await page.evaluate(t => window.surveyAmbience(t), tasks);
        writeFileSync(join(MEDIA, 'survey.json'), JSON.stringify(rows, null, 2));
        for (const row of rows) console.log(JSON.stringify({ hour: row.task.hour, calls: row.info.calls, timeline: row.info.timeline.filter(e => !['slap', 'rigging', 'hull', 'mooring'].includes(e.call)) }));
        return report;
      }
      if (probeOnly) { console.log(JSON.stringify({ channels: report.channels, scene: report.scene }, null, 2)); return report; }
      report.layers = {};
      for (const name of names) {
        const result = await page.evaluate(task => window.renderAmbience(task), LAYER_TASKS[name]);
        const channels = result.channels.map(b64 => { const bytes = Buffer.from(b64, 'base64'); return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4); });
        writeFloatWav(join(LAYERS, `${name}.wav`), channels, result.sampleRate);
        report.layers[name] = { renderMs: result.renderMs, frames: result.frames, info: result.info };
        log(`rendered ${name} (${(result.frames / result.sampleRate).toFixed(2)} s in ${result.renderMs} ms)`);
      }
      report.consoleErrors = errors;
    } finally {
      try { await browser?.close(); } finally {
        try { if (server) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve())); }
        finally { await release(); log('browser and server closed, lock released'); }
      }
    }
  } finally { await rm(outDir, { recursive: true, force: true }); }
  return report;
}

// ---------------------------------------------------------------------------------------------------------------
// Mixing and finishing.
// ---------------------------------------------------------------------------------------------------------------
/** A 2nd-order Butterworth high-pass at 35 Hz on a bed: nothing an edit wants lives below it. */
const HIGHPASS_HZ = 35;
function highpass(channel) {
  const w = 2 * Math.PI * HIGHPASS_HZ / RATE, q = Math.SQRT1_2, alpha = Math.sin(w) / (2 * q), cos = Math.cos(w), a0 = 1 + alpha;
  const b0 = (1 + cos) / 2 / a0, b1 = -(1 + cos) / a0, b2 = b0, a1 = -2 * cos / a0, a2 = (1 - alpha) / a0;
  const out = new Float32Array(channel.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < channel.length; i++) { const x = channel[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; out[i] = y; }
  return out;
}

/** Folds LOOP + FADE seconds into a seamless LOOP: the last FADE seconds cross-fade (equal power) into the first. */
function foldLoop(channel) {
  const n = LOOP * RATE, x = FADE * RATE, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (i < x) { const a = (Math.PI / 2) * (i / x); out[i] = channel[i] * Math.sin(a) + channel[n + i] * Math.cos(a); }
    else out[i] = channel[i];
  }
  return out;
}

function mixBed(name, layers) {
  const sum = [new Float32Array((LOOP + FADE) * RATE), new Float32Array((LOOP + FADE) * RATE)], applied = [];
  for (const spec of layers) {
    const file = join(LAYERS, `${spec.layer}.wav`), stem = readFloatWav(file);
    let gainDb = spec.db ?? 0;
    if (spec.lufs !== undefined) gainDb = spec.lufs - measure(file).integratedLufs;
    const g = 10 ** (gainDb / 20);
    for (let c = 0; c < 2; c++) for (let i = 0; i < sum[c].length; i++) sum[c][i] += (stem[c][i] ?? 0) * g;
    applied.push({ layer: spec.layer, gainDb: round(gainDb, 2), ...(spec.lufs !== undefined ? { stemLufsTarget: spec.lufs } : {}) });
  }
  const looped = sum.map(highpass).map(foldLoop), file = join(RAW, `${name}.wav`);
  writeFloatWav(file, looped);
  // Seam check: the jump from the last sample to the first, against the typical sample-to-sample step.
  const steps = [];
  for (let i = 1; i < looped[0].length; i += 97) steps.push(Math.abs(looped[0][i] - looped[0][i - 1]));
  steps.sort((a, b) => a - b);
  const seam = Math.max(...looped.map(ch => Math.abs(ch[0] - ch[ch.length - 1])));
  return { file, applied, seam: { jump: Number(seam.toExponential(2)), medianStep: Number(steps[steps.length >> 1].toExponential(2)) } };
}

/** Heroes: the render as it is, with the silent tail after the last sound trimmed (keeping 150 ms). */
function finishHero(name) {
  const stem = readFloatWav(join(LAYERS, `${name}.wav`)), floor = 10 ** (-80 / 20);
  let last = 0;
  for (const ch of stem) for (let i = ch.length - 1; i > last; i--) if (Math.abs(ch[i]) > floor) { last = i; break; }
  const end = Math.min(stem[0].length, last + Math.round(0.15 * RATE)), fade = Math.round(0.05 * RATE);
  const out = stem.map(ch => { const o = ch.slice(0, end); for (let i = 0; i < fade && i < o.length; i++) o[o.length - 1 - i] *= i / fade; return o; });
  const file = join(RAW, `${name}.wav`);
  writeFloatWav(file, out);
  return { file };
}

function finish(name, kind) {
  const raw = join(RAW, `${name}.wav`), edit = join(EDIT, `${name}.wav`), before = measure(raw);
  let gainDb, rule;
  if (kind === 'bed') {
    gainDb = BED_LUFS - before.integratedLufs;
    rule = `integrated loudness to ${BED_LUFS} LUFS (linear gain)`;
    if (before.truePeakDbtp + gainDb > BED_TP_LIMIT) { gainDb = BED_TP_LIMIT - before.truePeakDbtp; rule += `, held back to keep true peak at ${BED_TP_LIMIT} dBTP`; }
  } else {
    gainDb = HERO_TP - before.truePeakDbtp;
    rule = `true peak to ${HERO_TP} dBTP (linear gain)`;
  }
  ffmpeg(['-loglevel', 'error', '-y', '-i', raw, '-af', `volume=${gainDb.toFixed(3)}dB`, '-c:a', 'pcm_s24le', '-ar', String(RATE), '-ac', '2', edit]);
  const after = measure(edit);
  spectrogram(edit, join(PICS, `${name}.png`), name, kind === 'bed' ? '1600x600' : '1200x500');
  if (kind === 'bed') {
    // The seam: the loop played twice; a click or a step in level would show at 30 s.
    const twice = join(tmpdir(), `${name}-twice.wav`);
    ffmpeg(['-loglevel', 'error', '-y', '-stream_loop', '1', '-i', edit, '-c:a', 'pcm_s24le', twice]);
    spectrogram(twice, join(PICS, `${name}-loop-twice.png`), `${name} played twice (seam at 30 s)`);
    unlinkSync(twice);
  }
  return { raw, edit, gainDb: round(gainDb, 2), rule, raw_measure: before, edit_measure: after };
}

// ---------------------------------------------------------------------------------------------------------------
const args = process.argv.slice(2);
const probeOnly = args.includes('--probe') || args.includes('--survey'), mixOnly = args.includes('--mix-only');
const named = args.filter(a => !a.startsWith('--'));
for (const name of named) if (!LAYER_TASKS[name]) throw new Error(`unknown layer ${name}; known: ${Object.keys(LAYER_TASKS).join(', ')}`);
const reportFile = join(MEDIA, 'render-session.json');
let sessionReport = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) : { layers: {} };
if (!mixOnly) {
  const report = await session(named.length ? named : Object.keys(LAYER_TASKS), probeOnly);
  if (probeOnly) process.exit(0);
  sessionReport = { ...sessionReport, ...report, layers: { ...sessionReport.layers, ...report.layers }, rendered: new Date().toISOString() };
  writeFileSync(reportFile, JSON.stringify(sessionReport, null, 2));
}
const missing = Object.keys(LAYER_TASKS).filter(name => !existsSync(join(LAYERS, `${name}.wav`)));
if (missing.length) throw new Error(`layers not rendered yet: ${missing.join(', ')}`);

const results = {};
for (const [name, layers] of Object.entries(BEDS)) {
  const mix = mixBed(name, layers);
  results[name] = { kind: 'bed', mix: mix.applied, seam: mix.seam, ...finish(name, 'bed') };
  log(`${name}: ${JSON.stringify({ I: results[name].edit_measure.integratedLufs, TP: results[name].edit_measure.truePeakDbtp, S: results[name].edit_measure.shortTermLufs, seam: mix.seam })}`);
}
for (const name of Object.keys(LAYER_TASKS).filter(n => n.startsWith('hero-'))) {
  finishHero(name);
  results[name] = { kind: 'hero', ...finish(name, 'hero') };
  log(`${name}: ${JSON.stringify({ I: results[name].edit_measure.integratedLufs, TP: results[name].edit_measure.truePeakDbtp, dur: results[name].edit_measure.duration })}`);
}
for (const name of Object.keys(LAYER_TASKS).filter(n => !n.startsWith('hero-'))) {
  spectrogram(join(LAYERS, `${name}.wav`), join(PICS, `layer-${name}.png`), `layer ${name} (raw)`, '1200x500');
}
writeFileSync(join(MEDIA, 'measurements.json'), JSON.stringify({ measured: new Date().toISOString(), session: sessionReport, results }, null, 2));
const { writeManifest } = await import('./manifest.mjs');
writeManifest({ results, sessionReport, tasks: LAYER_TASKS, beds: BEDS, manifestFile: MANIFEST, media: MEDIA });
log(`wrote ${MANIFEST}`);
