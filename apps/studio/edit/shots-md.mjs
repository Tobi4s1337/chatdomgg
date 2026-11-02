// Writes work/lanes/teaser/SHOTS.md from the shot scripts, so the shot list Tobias approves and the one the
// studio renders are the same list.   node apps/studio/edit/shots-md.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { FILM, TAKES_DIR } from '../rig/film.mjs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STUDIO = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO = resolve(STUDIO, '../..');
const OUT = join(REPO, 'work/lanes/teaser/SHOTS.md');
const HEAD = join(STUDIO, 'edit/shots-head.md');

const { createServer } = await import('vite');
const vite = await createServer({ root: STUDIO, configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const { SHOTS } = await vite.ssrLoadModule('/src/shot-list/list.ts');
await vite.close();

const time = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(0).padStart(2, '0')}`;
const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
function source(shot) {
  const k = shot.kingdom;
  const page = shot.page ? `studio page (${shot.page.theatre?.[0]?.v ? 'theatre' : 'normal'} layout)` : '';
  if (!k) return page;
  const kingdom = k.kind === 'take' ? `GPU take \`${k.take}\` from frame ${k.in} (\`${k.route}\`)` : k.kind === 'still' ? `still \`${k.src}\`, moved` : `clip \`${k.src}\``;
  return [page, kingdom].filter(Boolean).join(' → ');
}

/** A film take's state from its sidecar: verified (with the master's size), partial, or not shot yet. */
function filmState(name) {
  const take = FILM.find(t => t.take === name);
  const file = join(TAKES_DIR, name, 'take.json');
  const route = take ? ` (\`${take.url}\`)` : '';
  if (!existsSync(file)) return `\`${name}\` not shot yet${route}`;
  const t = JSON.parse(readFileSync(file, 'utf8'));
  if (t.verify?.ok) return `\`${name}\` verified, ${t.verify.masterFrames} frames at ${t.verify.masterSize}`;
  return `\`${name}\` ${t.complete ? 'recorded, not verified' : `partial (${t.frames.length} frames)`}`;
}
const film = s => (s.film ?? []).map(u => `${filmState(u.take)} from ${Number(u.in.toFixed(2))} s`).filter((x, i, all) => all.indexOf(x) === i).join('; ');

const rows = SHOTS.map(s => `| ${s.id} | ${time(s.cut[0])}–${time(s.cut[1])} | **${cell(s.title)}.** ${cell(s.picture)} | ${s.narration ? `“${cell(s.narration)}”` : ''} | ${cell(source(s))} | ${cell(film(s))} | ${cell(s.hooks.join('; '))} | ${s.status}${s.kingdom && 'note' in s.kingdom && s.kingdom.note ? ` — ${cell(s.kingdom.note)}` : ''}${s.doubts ? ` Doubt: ${cell(s.doubts)}` : ''} |`);
const total = Math.max(...SHOTS.map(s => s.cut[1]));
const staged = SHOTS.filter(s => s.status === 'staged').length;
const body = `${readFileSync(HEAD, 'utf8').trim()}

## The list (generated from \`apps/studio/src/shot-list/list.ts\`)

${SHOTS.length} shots, ${time(total)} before the end card's tail; ${staged} staged on today's build, ${SHOTS.length - staged} stand-ins.

| # | Cut | Shot | Narration | Rough cut source | Film take (first cut) | Hooks | Status |
|---|---|---|---|---|---|---|---|
${rows.join('\n')}
`;
writeFileSync(OUT, body);
process.stdout.write(`${OUT}: ${SHOTS.length} shots\n`);
