// Writes work/evidence/teaser/MEDIA.md: what the lane's media folder holds (outside git), with sizes and SHA-256
// sums of every file that isn't a frame of a sequence (sequences are listed by folder: frames, bytes, and the
// sum of their take.json).   node apps/studio/edit/media-md.mjs
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const MEDIA = '/srv/chatdom/media/teaser';
const OUT = join(REPO, 'work/evidence/teaser/MEDIA.md');
const FRAME = /^\d{6}\.(png|jpg)$/;
const mb = n => `${(n / 1e6).toFixed(1)} MB`;
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');

const sequences = [], files = [];
let total = 0;
function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const frames = entries.filter(e => e.isFile() && FRAME.test(e.name));
  if (frames.length) {
    const bytes = frames.reduce((n, e) => n + statSync(join(dir, e.name)).size, 0);
    total += bytes;
    const take = join(dir, 'take.json');
    sequences.push({ dir: relative(MEDIA, dir), frames: frames.length, bytes, take: existsSync(take) ? sha(take).slice(0, 16) : '' });
  }
  for (const e of entries) {
    const path = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'cache') walk(path); else { const n = readdirSync(path).length; files.push({ path: relative(MEDIA, path) + '/', bytes: 0, sum: `${n} cached responses` }); } }
    else if (!FRAME.test(e.name)) { const bytes = statSync(path).size; total += bytes; files.push({ path: relative(MEDIA, path), bytes, sum: bytes < 2e8 ? sha(path) : '(large)' }); }
  }
}
walk(MEDIA);
const body = `# Teaser media (outside git)

\`${MEDIA}\` holds the lane's heavy media: Twitch reference captures and fonts (local rendering only, never committed
or served publicly), GPU takes and studio takes as frame sequences, audio (voice, music, effects) and cuts. This file is
written by \`node apps/studio/edit/media-md.mjs\`. Total: ${mb(total)} (cap 40 GB).

## Frame sequences

| Folder | Frames | Size | take.json SHA-256 (first 16) |
|---|---|---|---|
${sequences.map(s => `| \`${s.dir}\` | ${s.frames} | ${mb(s.bytes)} | ${s.take} |`).join('\n')}

## Files

| File | Size | SHA-256 |
|---|---|---|
${files.map(f => `| \`${f.path}\` | ${f.bytes ? mb(f.bytes) : ''} | ${f.sum} |`).join('\n')}
`;
writeFileSync(OUT, body);
process.stdout.write(`${OUT}: ${sequences.length} sequences, ${files.length} files, ${mb(total)}\n`);
