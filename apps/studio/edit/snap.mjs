// Snaps every shot boundary to the music: chapter starts land exactly on their bar, every other cut on the
// nearest beat. Writes apps/studio/edit/snap.json, which render.mjs applies to the edit.
//   node apps/studio/edit/snap.mjs [apps/studio/sound/temp-bed.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STUDIO = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const music = JSON.parse(readFileSync(process.argv[2] ?? join(STUDIO, 'sound/temp-bed.json'), 'utf8'));
const { createServer } = await import('vite');
const vite = await createServer({ root: STUDIO, configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const { SHOTS } = await vite.ssrLoadModule('/src/shots/list.ts');
await vite.close();

const beats = music.beats.map(b => typeof b === 'number' ? b : b.time);
const firstShot = new Map();
for (const chapter of music.chapters) { const id = /^S\d\d/.exec(chapter.shots ?? '')?.[0]; if (id) firstShot.set(id, chapter.start); }
const nearest = t => beats.reduce((best, b) => Math.abs(b - t) < Math.abs(best - t) ? b : best, beats[0]);
const cut = (id, t) => firstShot.has(id) ? firstShot.get(id) : nearest(t);
const shots = {};
for (const [i, shot] of SHOTS.entries()) {
  const start = cut(shot.id, shot.cut[0]);
  const next = SHOTS[i + 1];
  const end = next ? cut(next.id, next.cut[0]) : nearest(shot.cut[1]);
  shots[shot.id] = [Number(start.toFixed(4)), Number(end.toFixed(4))];
}
writeFileSync(join(STUDIO, 'edit/snap.json'), JSON.stringify({ music: music.files?.normalised ?? null, bpm: music.tempo?.bpm, shots }, null, 1) + '\n');
for (const [id, [a, b]] of Object.entries(shots)) process.stdout.write(`${id} ${a.toFixed(2)}–${b.toFixed(2)} (${(b - a).toFixed(2)} s)\n`);
