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
  const capture = take.capture === 'webcodecs' ? `webcodecs ${take.encoder?.codec ?? ''} ${take.encoder?.hardwareAcceleration ?? ''} ${take.encoder?.bitrateMode ?? ''}`.trim() : `screenshot ${take.format}${take.alpha ? ' alpha' : ''}`;
  const verified = take.verify ? (take.verify.ok ? `${take.verify.masterFrames} frames, ${take.verify.masterSize}` : `FAILED: ${take.verify.problems.join('; ')}`) : '';
  const master = take.verify?.ok ? `\`${take.verify.master.replace('/srv/chatdom/media/teaser/', '')}\`` : files ? `${files} frame files` : '';
  const fpm = (take.runs ?? []).length > 1 ? take.runs.map(r => r.framesPerMinute).join(' / ') : take.framesPerMinute ?? '';
  rows.push(`| \`${name}\` | ${kind} | ${take.build ?? '(before TS11)'} | \`${take.url}\` | ${take.width * (take.scale ?? 1)}×${take.height * (take.scale ?? 1)} | ${capture} | ${take.frames.length}/${expected} | ${exact ? 'exact' : 'GAPS'} | ${take.complete ? 'complete' : 'partial'} | ${verified} | ${master} | ${fpm} | ${String(take.renderer ?? '').replace(/\|/g, '/')} | ${take.started?.slice(0, 16) ?? ''} |`);
}
const body = `# Takes

Every take in \`${TAKES}\` (outside git), from its sidecar. Written by \`node apps/studio/edit/takes-md.mjs\` at build
\`${commit}\` of this worktree. "exact" means every frame's virtual clock value is n/fps with no gap or repeat; frame
counts are recorded against (to − from) × fps, and "Verified master" is the frame count ffprobe reads back from the
encoded master (\`apps/studio/rig/verify.mjs\`). GPU takes ran on Tobias's RTX 5080 through \`chatdom-pc-lease\`; studio
takes are DOM-only frames rendered here. "Build" is the worktree commit the take was rendered from ("+" when the studio
or the web app had uncommitted changes). Frames/min lists each lease's rate for takes shot in chunks.

| Take | Where | Build | Route | Pixels | Capture | Frames | Clock | State | Verified master | Media | Frames/min | Renderer | Started |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}
`;
writeFileSync(OUT, body);
process.stdout.write(`${OUT}: ${rows.length} takes\n`);
