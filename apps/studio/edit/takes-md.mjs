// Writes work/lanes/teaser/TAKES.md from every take's sidecar (take.json) in the media folder: route and params,
// resolution, frames recorded against frames expected, the renderer string, frames per minute, and whether every
// frame's clock value is exactly n/fps (no dropped or doubled frames).   node apps/studio/edit/takes-md.mjs
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const TAKES = '/srv/chatdom/media/teaser/takes';
const OUT = join(REPO, 'work/lanes/teaser/TAKES.md');
const commit = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: REPO }).toString().trim(); } catch { return '?'; } })();

const rows = [];
for (const name of readdirSync(TAKES).sort()) {
  const file = join(TAKES, name, 'take.json');
  if (!existsSync(file)) continue;
  const take = JSON.parse(readFileSync(file, 'utf8'));
  const expected = Math.round((take.to - take.from) * take.fps);
  const step = 1000 / take.fps;
  const first = take.frames[0]?.clock ?? 0;
  // Clock values must advance by exactly one frame each: no frame dropped, none doubled.
  const exact = take.frames.every((f, i) => Math.abs(f.clock - (first + i * step)) < 1e-6) && take.frames.every((f, i) => f.frame === i);
  const files = readdirSync(join(TAKES, name)).filter(f => /^\d{6}\.(png|jpg)$/.test(f)).length;
  const kind = take.gpu ? 'GPU' : 'studio (DOM)';
  rows.push(`| \`${name}\` | ${kind} | \`${take.url}\` | ${take.width}×${take.height}@${take.scale ?? 1}x ${take.format}${take.alpha ? ' alpha' : ''} | ${take.frames.length}/${expected} (${files} files) | ${exact ? 'exact' : 'GAPS'} | ${take.complete ? 'complete' : 'partial'} | ${take.framesPerMinute ?? ''} | ${String(take.renderer ?? '').replace(/\|/g, '/')} | ${take.started?.slice(0, 16) ?? ''} |`);
}
const body = `# Takes

Every take in \`${TAKES}\` (outside git), from its sidecar. Written by \`node apps/studio/edit/takes-md.mjs\` at build
\`${commit}\` of this worktree. "exact" means every frame's virtual clock value is n/fps with no gap or repeat; frame
counts are recorded against (to − from) × fps. GPU takes ran on Tobias's RTX 5080 through \`chatdom-pc-lease\`; studio
takes are DOM-only frames rendered here.

| Take | Where | Route | Size | Frames | Clock | State | Frames/min | Renderer | Started |
|---|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}
`;
writeFileSync(OUT, body);
process.stdout.write(`${OUT}: ${rows.length} takes\n`);
