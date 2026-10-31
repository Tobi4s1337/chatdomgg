/* global btoa:readonly, OfflineAudioContext:readonly */
// Renders every procedural moment cue through the real sound port in Chrome's OfflineAudioContext, under the shared
// capture lock, and checks that what is heard fits the cue's declared length (so the natural finish never clips a
// ringing tail) and that cancelling a cue mid-flight silences it, tails included, within a tenth of a second.
//   node apps/web/src/twitch-moments-bench/sound-check.mjs [--port 5198]
// Writes shots/twitch-moments/sound/<cue>.wav, a spectrogram per cue and sheet-sound.png; exits 1 on any failure.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertCapturePort } from '../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const port = Number(option('--port') ?? 5198);
assertCapturePort(port, { name: '--port' });
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const output = `${root}shots/twitch-moments/sound`;

let server, browser, release, results;
try {
  release = await acquireCaptureLock();
  server = await createServer({ root: `${root}apps/web`, configFile: `${root}apps/web/vite.config.ts`, logLevel: 'error',
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  // A same-origin document that loads nothing else, so the module import below is the only code on the page.
  await page.goto(`http://127.0.0.1:${port}/src/twitch-moments/sound.ts`, { waitUntil: 'domcontentloaded' });
  results = await page.evaluate(async () => {
    const { createProceduralMomentSound, CUE_LENGTH_MS } = await import('/src/twitch-moments/sound.ts');
    const RATE = 48_000, WINDOW = 480; // 10 ms analysis windows
    const db = x => (x > 0 ? 20 * Math.log10(x) : -200);
    /** Mono RMS per window, in dBFS. */
    function envelope(buffer) {
      const a = buffer.getChannelData(0), b = buffer.getChannelData(1), out = [];
      for (let i = 0; i < a.length; i += WINDOW) {
        let sum = 0; const end = Math.min(a.length, i + WINDOW);
        for (let j = i; j < end; j++) sum += (a[j] * a[j] + b[j] * b[j]) / 2;
        out.push(db(Math.sqrt(sum / (end - i))));
      }
      return out;
    }
    function wav(buffer) {
      const frames = buffer.length, bytes = new DataView(new ArrayBuffer(44 + frames * 4)), a = buffer.getChannelData(0), b = buffer.getChannelData(1);
      const text = (at, s) => { for (let i = 0; i < s.length; i++) bytes.setUint8(at + i, s.charCodeAt(i)); };
      text(0, 'RIFF'); bytes.setUint32(4, 36 + frames * 4, true); text(8, 'WAVEfmt '); bytes.setUint32(16, 16, true);
      bytes.setUint16(20, 1, true); bytes.setUint16(22, 2, true); bytes.setUint32(24, RATE, true); bytes.setUint32(28, RATE * 4, true);
      bytes.setUint16(32, 4, true); bytes.setUint16(34, 16, true); text(36, 'data'); bytes.setUint32(40, frames * 4, true);
      for (let i = 0; i < frames; i++) for (const [c, data] of [[0, a], [1, b]]) bytes.setInt16(44 + i * 4 + c * 2, Math.max(-1, Math.min(1, data[i])) * 0x7fff, true);
      let binary = ''; const u8 = new Uint8Array(bytes.buffer);
      for (let i = 0; i < u8.length; i += 0x8000) binary += String.fromCharCode(...u8.subarray(i, i + 0x8000));
      return btoa(binary);
    }
    async function render(cue, cancelAt) {
      const seconds = CUE_LENGTH_MS[cue] / 1000 + 2;
      const context = new OfflineAudioContext(2, Math.ceil(RATE * seconds), RATE);
      const sound = createProceduralMomentSound({ context: () => ({ context, destination: context.destination }), now: () => 0, gain: () => 1 });
      const cancel = sound.play(cue, 100, 1);
      if (cancelAt !== undefined) context.suspend(cancelAt).then(() => { cancel(); context.resume(); });
      const buffer = await context.startRendering();
      await new Promise(r => setTimeout(r, 150));
      return { buffer, active: cancelAt === undefined ? null : sound.active };
    }
    const out = [];
    for (const cue of Object.keys(CUE_LENGTH_MS)) {
      const declared = CUE_LENGTH_MS[cue], { buffer } = await render(cue);
      const env = envelope(buffer), peak = Math.max(...env);
      // Where the sound is last within 60 dB of its own peak, from the 100 ms start offset.
      let last = 0; env.forEach((v, i) => { if (v > peak - 60) last = i; });
      const heardMs = (last + 1) * 10 - 100;
      // The natural finish disconnects the cue 200 ms after its declared length: what is left there would be cut.
      const cutWindow = Math.round((100 + declared + 200) / 10);
      const atCut = Math.max(...env.slice(cutWindow, cutWindow + 5)) - peak;
      // Cancel at 40% of the cue: everything after cancel + 100 ms must be below -80 dBFS (tails included).
      // OfflineAudioContext suspends on 128-frame render quanta.
      const cancelSec = Math.round((0.1 + declared * 0.4 / 1000) * RATE / 128) * 128 / RATE;
      const cancelled = await render(cue, cancelSec);
      const cenv = envelope(cancelled.buffer), from = Math.ceil((cancelSec + 0.1) * 100);
      const afterCancel = Math.max(-200, ...cenv.slice(from));
      out.push({ cue, declared, peak: Math.round(peak * 10) / 10, heardMs, atCut: Math.round(atCut * 10) / 10,
        afterCancel: Math.round(afterCancel * 10) / 10, activeAfterCancel: cancelled.active, wav: wav(buffer) });
    }
    return out;
  });
} finally {
  await browser?.close();
  await server?.close();
  await release?.();
}

await mkdir(output, { recursive: true });
const failures = [], tiles = [];
console.log('cue                 declared  heard   peak dBFS  at cut (dB re peak)  after cancel dBFS  live after cancel');
for (const r of results) {
  const wavPath = `${output}/${r.cue}.wav`, png = `${output}/${r.cue}.png`;
  await writeFile(wavPath, Buffer.from(r.wav, 'base64'));
  const fits = r.heardMs <= r.declared + 200, silentAtCut = r.atCut < -45, silenced = r.afterCancel < -80, released = r.activeAfterCancel === 0;
  if (!fits || !silentAtCut) failures.push(`${r.cue}: heard ${r.heardMs} ms against ${r.declared} ms declared (${r.atCut} dB left at the cut)`);
  if (!silenced || !released) failures.push(`${r.cue}: ${r.afterCancel} dBFS after cancel, ${r.activeAfterCancel} cues still live`);
  if (r.peak > -0.1) failures.push(`${r.cue}: clips at ${r.peak} dBFS`);
  console.log(`${r.cue.padEnd(20)}${String(r.declared).padStart(8)}${String(r.heardMs).padStart(7)}${String(r.peak).padStart(11)}${String(r.atCut).padStart(21)}${String(r.afterCancel).padStart(19)}${String(r.activeAfterCancel).padStart(19)}`);
  const label = `drawtext=text='${r.cue} ${r.declared} ms':x=8:y=8:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-lavfi',
    `showspectrumpic=s=480x160:legend=0:scale=log:fscale=log:color=intensity,${label}`, png]);
  tiles.push(png);
}
// Three spectrograms across; a short last row is padded with dark tiles.
const across = 3, rows = [];
for (let i = 0; i < tiles.length; i += across) rows.push(tiles.slice(i, i + across));
const rowPaths = rows.map((row, i) => {
  const path = `${output}/row-${i}.png`, pad = across - row.length;
  const inputs = row.flatMap(p => ['-i', p]);
  const filter = `${row.map((_, j) => `[${j}:v]`).join('')}hstack=inputs=${row.length}${pad ? `,pad=${480 * across}:160:0:0:color=0x15121a` : ''}[out]`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, ...(row.length > 1 || pad ? ['-filter_complex', filter, '-map', '[out]'] : []), path]);
  return path;
});
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...rowPaths.flatMap(p => ['-i', p]), '-filter_complex', `vstack=inputs=${rowPaths.length}`, `${root}shots/twitch-moments/sheet-sound.png`]);
console.log('Sheet shots/twitch-moments/sheet-sound.png');
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
