// node packages/audio/src/genesis-biomes/bench/listen.mjs [scenario-name ...]
//
// Renders the Genesis landscape sound in real Chrome (OfflineAudioContext, the live layer and graph) for the three
// composition targets and writes, under shots/genesis-sound/: one WAV per scenario, a log-frequency spectrogram,
// loudness (EBU R128 via ffmpeg), the speech-band share, a repetition check and what played, plus the stream mix:
// the land in the stream profile under a SIMULATED voice (flite) at −16 LUFS and a SIMULATED game bed at −24 LUFS.
// Uses the first free capture port (packages/testing/capture-ports.mjs) and stops its server at the end.
import { Buffer } from 'node:buffer';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { CAPTURE_PORTS } from '../../../../testing/capture-ports.mjs';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const bench = fileURLToPath(new URL('.', import.meta.url));
const out = join(root, 'shots/genesis-sound');
mkdirSync(out, { recursive: true });

const COAST = '63920635', RIVER = '4363967', MOUNTAIN = '154972160';
const FAIR = { wind: 0.4, rain: 0, snow: 0, storm: 0, fog: 0, wet: 0 };
export const SCENARIOS = [
  // The three lands as you first hear them, standing in the plaza on a fair day.
  { name: 'coast-day-plaza', channel: COAST, character: 'coastal-harbour', seconds: 45, hour: 10.5, weather: FAIR },
  { name: 'river-day-plaza', channel: RIVER, character: 'river-valley', seconds: 45, hour: 10.5, weather: FAIR },
  { name: 'mountain-day-plaza', channel: MOUNTAIN, character: 'mountain-pass', seconds: 45, hour: 10.5, weather: { ...FAIR, wind: 0.55 } },
  // Places.
  { name: 'coast-harbour-edge', channel: COAST, character: 'coastal-harbour', seconds: 40, hour: 15, weather: { ...FAIR, wind: 0.55 }, ear: 'harbour' },
  { name: 'river-bank-dusk', channel: RIVER, character: 'river-valley', seconds: 45, hour: 19.6, weather: { ...FAIR, wind: 0.2 }, ear: 'river' },
  { name: 'mountain-pass-gale', channel: MOUNTAIN, character: 'mountain-pass', seconds: 40, hour: 13, weather: { ...FAIR, wind: 0.85 }, ear: 'pass' },
  // Time and weather.
  { name: 'coast-night-fog', channel: COAST, character: 'coastal-harbour', seconds: 40, hour: 1.5, weather: { wind: 0.15, rain: 0, snow: 0, storm: 0, fog: 0.85, wet: 0.2 }, ear: 'harbour' },
  { name: 'coast-storm', channel: COAST, character: 'coastal-harbour', seconds: 50, hour: 16, weather: { wind: 0.9, rain: 0.9, snow: 0, storm: 0.9, fog: 0, wet: 1 } },
  { name: 'river-night', channel: RIVER, character: 'river-valley', seconds: 45, hour: 23, weather: { ...FAIR, wind: 0.15 }, ear: 'river' },
  { name: 'river-rain', channel: RIVER, character: 'river-valley', seconds: 40, hour: 11, weather: { wind: 0.45, rain: 0.75, snow: 0, storm: 0, fog: 0.1, wet: 1 }, ear: 'river' },
  { name: 'mountain-dawn', channel: MOUNTAIN, character: 'mountain-pass', seconds: 45, hour: 6, weather: { ...FAIR, wind: 0.3 } },
  { name: 'mountain-snow', channel: MOUNTAIN, character: 'mountain-pass', seconds: 40, hour: 14, weather: { wind: 0.5, rain: 0, snow: 0.8, storm: 0, fog: 0.3, wet: 0.2 } },
  // Transitions: a whole day in 90 s with a shower passing; walking from the plaza to the water.
  { name: 'river-day-sweep', channel: RIVER, character: 'river-valley', seconds: 90, hour: [4.5, 23.5],
    weather: [{ ...FAIR, wind: 0.2 }, { wind: 0.5, rain: 0.8, snow: 0, storm: 0.1, fog: 0, wet: 1 }, { ...FAIR, wind: 0.3, wet: 0.3 }] },
  { name: 'coast-walk', channel: COAST, character: 'coastal-harbour', seconds: 50, hour: 9, weather: FAIR, ear: 'walk-coast' },
  // The seeded weather as it really comes, no override: one realm afternoon at the mountain.
  { name: 'mountain-seeded', channel: MOUNTAIN, character: 'mountain-pass', seconds: 40, hour: 14.5 },
  // Lifecycle: mute and unmute, a duck, the ceremony's redraw to another land, the stream profile, a seek back.
  { name: 'lifecycle', channel: COAST, character: 'coastal-harbour', seconds: 50, hour: 11, weather: FAIR,
    actions: [{ t: 8, action: 'mute' }, { t: 12, action: 'unmute' }, { t: 18, action: 'duck' }, { t: 25, action: 'select-mountain' },
      { t: 36, action: 'stream' }, { t: 43, action: 'seek-back' }] },
  // The stream mix bed: the river valley in the stream profile, used under the SIMULATED voice and game.
  { name: 'stream-bed', channel: RIVER, character: 'river-valley', seconds: 45, hour: 19.2, weather: { ...FAIR, wind: 0.35 }, profile: 'stream' },
  // Determinism: the same 12 s twice.
  { name: 'determinism-a', channel: MOUNTAIN, character: 'mountain-pass', seconds: 12, hour: 8, weather: { ...FAIR, wind: 0.6 } },
  { name: 'determinism-b', channel: MOUNTAIN, character: 'mountain-pass', seconds: 12, hour: 8, weather: { ...FAIR, wind: 0.6 } },
];

// Calibration (`listen.mjs solo`): each bed alone at full presence, to set BED_LEVELS against loudness.
const SOLO = [
  ['wind', MOUNTAIN, 'mountain-pass', { ...FAIR, wind: 0.5 }, 'plaza'], ['whistle', MOUNTAIN, 'mountain-pass', { ...FAIR, wind: 0.8 }, 'pass'],
  ['sea', COAST, 'coastal-harbour', FAIR, 'shore'], ['lap', COAST, 'coastal-harbour', FAIR, 'shore'],
  ['river', RIVER, 'river-valley', FAIR, 'river'], ['rush', RIVER, 'river-valley', FAIR, 'weir'],
  ['rain', RIVER, 'river-valley', { ...FAIR, rain: 0.7, wet: 1 }, 'plaza'], ['foliage', RIVER, 'river-valley', { ...FAIR, wind: 0.6 }, 'forest'],
  ['crickets', RIVER, 'river-valley', { ...FAIR, wind: 0.1 }, 'forest', 23], ['grasshoppers', RIVER, 'river-valley', { ...FAIR, wind: 0.1 }, 'forest', 13],
  ['floor', RIVER, 'river-valley', FAIR, 'plaza'], ['calls', COAST, 'coastal-harbour', FAIR, 'harbour'],
].map(([bed, channel, character, weather, ear, hour]) => ({ name: `solo-${bed}`, channel, character, seconds: 20, hour: hour ?? 11, weather, ear, solo: [bed] }));

async function startServer() {
  for (const port of CAPTURE_PORTS) {
    const server = await createServer({
      root: bench, configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port, strictPort: true, fs: { allow: [root] } },
    });
    try { await server.listen(); return { server, port }; }
    catch (error) { await server.close(); if (error?.code !== 'EADDRINUSE' && !/already in use/.test(String(error?.message))) throw error; }
  }
  throw new Error('no free capture port');
}

function r128(file) {
  // ffmpeg writes the ebur128 log to stderr.
  const text = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-loglevel', 'verbose', '-i', file, '-af', 'ebur128=peak=true:framelog=verbose', '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).stderr;
  const momentary = [...text.matchAll(/M:\s*(-?[\d.]+)/g)].map(m => Number(m[1])).filter(Number.isFinite);
  const shortTerm = [...text.matchAll(/S:\s*(-?[\d.]+)/g)].map(m => Number(m[1])).filter(Number.isFinite);
  const summary = text.slice(text.lastIndexOf('Summary:'));
  const num = re => { const m = re.exec(summary); return m ? Number(m[1]) : null; };
  return {
    integrated: num(/I:\s*(-?[\d.]+) LUFS/), range: num(/LRA:\s*(-?[\d.]+) LU/), truePeak: num(/Peak:\s*(-?[\d.]+) dBFS/),
    maxMomentary: momentary.length ? Math.max(...momentary) : null, maxShortTerm: shortTerm.length ? Math.max(...shortTerm) : null,
  };
}

function readWav(file) {
  // Walks the RIFF chunks: ffmpeg writes a LIST chunk before the data.
  const bytes = readFileSync(file), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12, channels = 2, rate = 48000, data = 44, size = bytes.length - 44;
  while (at + 8 <= bytes.length) {
    const id = bytes.toString('ascii', at, at + 4), length = view.getUint32(at + 4, true);
    if (id === 'fmt ') { channels = view.getUint16(at + 10, true); rate = view.getUint32(at + 12, true); }
    if (id === 'data') { data = at + 8; size = Math.min(length, bytes.length - data); break; }
    at += 8 + length + (length % 2);
  }
  const frames = Math.floor(size / (2 * channels)), mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += view.getInt16(data + (i * channels + c) * 2, true) / 32768;
    mono[i] = sum / channels;
  }
  return { mono, rate };
}

/** Share of energy in the 300–3400 Hz speech band, by a simple FFT-free band split (two biquads). */
function speechShare({ mono, rate }) {
  const band = biquadBandpass(mono, rate, Math.sqrt(300 * 3400), Math.sqrt(300 * 3400) / (3400 - 300));
  let all = 0, inBand = 0;
  for (let i = 0; i < mono.length; i++) { all += mono[i] ** 2; inBand += band[i] ** 2; }
  return all > 0 ? inBand / all : 0;
}
function biquadBandpass(x, rate, f0, q) {
  const w = (2 * Math.PI * f0) / rate, alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
  const b0 = alpha / a0, b2 = -alpha / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - alpha) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
  return y;
}

/**
 * Repetition: the envelope (50 ms RMS frames) correlated with itself at every lag from 2 s to half the render. A
 * looped bed shows a strong peak at its loop length; an unrepeating land stays low.
 */
function repetition({ mono, rate }) {
  const hop = Math.round(rate * 0.05), frames = Math.floor(mono.length / hop), env = new Float64Array(frames);
  for (let f = 0; f < frames; f++) { let s = 0; for (let i = 0; i < hop; i++) s += mono[f * hop + i] ** 2; env[f] = Math.log10(1e-9 + Math.sqrt(s / hop)); }
  // The envelope's change frame to frame: slow swells (a wave, a gust) do not read as repetition, a loop does.
  for (let f = frames - 1; f > 0; f--) env[f] -= env[f - 1];
  env[0] = 0;
  let best = { lag: 0, r: 0 };
  for (let lag = 40; lag < frames / 2; lag++) {
    let num = 0, da = 0, db = 0;
    for (let f = 0; f + lag < frames; f++) { num += env[f] * env[f + lag]; da += env[f] ** 2; db += env[f + lag] ** 2; }
    const r = num / Math.sqrt(da * db || 1);
    if (r > best.r) best = { lag: lag * 0.05, r };
  }
  return { strongestLagSeconds: Number(best.lag.toFixed(2)), correlation: Number(best.r.toFixed(3)) };
}

function spectrogram(file, png, title) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-lavfi',
    `showspectrumpic=s=1400x520:mode=combined:fscale=log:scale=log:color=intensity:legend=1:drange=90,drawtext=text='${title}':x=20:y=8:fontcolor=white:fontsize=20`, png]);
}

async function main() {
  const only = process.argv.slice(2);
  const all = [...SCENARIOS, ...SOLO];
  const scenarios = only.length ? all.filter(s => only.some(name => s.name.startsWith(name))) : SCENARIOS;
  const { server, port } = await startServer();
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const report = { generated: new Date().toISOString(), port, note: 'Inputs: observed Genesis fixtures (spec 39); listener paths, hours and forced weather are SIMULATED test inputs.', scenarios: [] };
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${port}/index.html`);
    await page.waitForFunction(() => window.genesisReady === true, null, { timeout: 120_000 });
    report.seededDays = await page.evaluate(() => ({
      coast: window.seededDay('63920635', 'coastal-harbour'), river: window.seededDay('4363967', 'river-valley'), mountain: window.seededDay('154972160', 'mountain-pass'),
    }));
    for (const scenario of scenarios) {
      const result = await page.evaluate(s => window.renderGenesis(s), scenario);
      const file = join(out, `${scenario.name}.wav`);
      writeFileSync(file, Buffer.from(result.wav, 'base64'));
      const wav = readWav(file);
      const entry = {
        name: scenario.name, seconds: result.seconds, renderMs: result.renderMs, peakDbfs: Number((20 * Math.log10(result.peak || 1e-9)).toFixed(1)),
        loudness: r128(file), speechBandShare: Number(speechShare(wav).toFixed(3)), repetition: repetition(wav),
        played: result.played, snapshots: result.snapshots.map(snapshot => ({ ...snapshot, targets: undefined })),
        events: result.events.slice(-24),
      };
      spectrogram(file, join(out, `${scenario.name}.png`), scenario.name);
      report.scenarios.push(entry);
      console.log(`${scenario.name}: I ${entry.loudness.integrated} LUFS, max M ${entry.loudness.maxMomentary}, peak ${entry.peakDbfs} dBFS, speech ${entry.speechBandShare}, rep r=${entry.repetition.correlation}@${entry.repetition.strongestLagSeconds}s, render ${result.renderMs} ms`);
      console.log(`   played ${JSON.stringify(result.played)}`);
    }
    const a = join(out, 'determinism-a.wav'), b = join(out, 'determinism-b.wav');
    if (scenarios.some(s => s.name === 'determinism-a') && scenarios.some(s => s.name === 'determinism-b')) {
      // Chrome's renderer may round a float differently between runs; the sound itself must not change.
      const wa = readFileSync(a), wb = readFileSync(b);
      let differing = 0, worst = 0;
      for (let i = 44; i < Math.min(wa.length, wb.length); i += 2) { const d = Math.abs(wa.readInt16LE(i) - wb.readInt16LE(i)); if (d) { differing++; worst = Math.max(worst, d); } }
      report.determinism = { sameLength: wa.length === wb.length, differingSamples: differing, worstLsb: worst };
      console.log(`determinism: ${differing} samples differ, worst ${worst} LSB of 16-bit`);
    }
    if (scenarios.some(s => s.name === 'stream-bed')) report.streamMix = streamMix();
    report.consoleErrors = errors;
  } finally {
    await browser.close();
    await server.close();
  }
  writeFileSync(join(out, 'listen.json'), JSON.stringify(report, null, 2));
  console.log(`wrote ${join(out, 'listen.json')}`);
}

/**
 * The stream check. A SIMULATED streamer voice (flite, loudness-normalised to −16 LUFS, the usual stream target)
 * and a SIMULATED game bed (shaped pink noise with a slow pulse at −24 LUFS) are mixed with the land in the stream
 * profile at the kingdom's default volume, then measured: how far the land sits under the voice in the speech band.
 */
function streamMix() {
  const voice = join(out, 'simulated-voice.wav'), game = join(out, 'simulated-game.wav'), bed = join(out, 'stream-bed.wav'), mixFile = join(out, 'stream-mix.wav');
  const text = 'Welcome back, chat. SIMULATED voice line for the mix check. We are heading down to the river tonight, so grab a lantern. '
    + 'If you just followed, your house is being built on Old Row right now. Let us see what the weather does.';
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `flite=text='${text}':voice=slt`, '-af',
    'aresample=48000,apad=whole_dur=45,loudnorm=I=-16:TP=-1.5:LRA=7', '-ac', '2', '-ar', '48000', '-t', '45', voice]);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.4:duration=45:seed=7', '-af',
    'lowpass=f=6000,highpass=f=60,tremolo=f=1.6:d=0.5,aresample=48000,loudnorm=I=-24:TP=-3', '-ac', '2', '-ar', '48000', '-t', '45', game]);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', voice, '-i', game, '-i', bed, '-filter_complex',
    '[0][1][2]amix=inputs=3:normalize=0:duration=longest', '-ar', '48000', mixFile]);
  spectrogram(mixFile, join(out, 'stream-mix.png'), 'stream-mix (SIMULATED voice + game)');
  const speechBand = file => { const wav = readWav(file); const band = biquadBandpass(wav.mono, wav.rate, Math.sqrt(300 * 3400), Math.sqrt(300 * 3400) / 3100); let e = 0; for (const v of band) e += v * v; return e / band.length; };
  const db = ratio => Number((10 * Math.log10(ratio)).toFixed(1));
  const voiceBand = speechBand(voice), bedBand = speechBand(bed), gameBand = speechBand(game);
  return {
    voice: r128(voice), game: r128(game), bed: r128(bed), mix: r128(mixFile),
    bedUnderVoiceInSpeechBandDb: db(voiceBand / bedBand), gameUnderVoiceInSpeechBandDb: db(voiceBand / gameBand),
  };
}

await main();
