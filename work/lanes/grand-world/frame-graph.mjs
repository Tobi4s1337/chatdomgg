// Frame-time graph of a pc-perf.mjs record (or one view of a capture-walk.mjs record) as an SVG beside it.
//
//   node work/lanes/grand-world/frame-graph.mjs <record.json> [--view <name>] [--out <file.svg>]
//
// Every frame interval is plotted in order, on a scale to 50 ms with the 60 fps (16.7 ms) and 30 fps (33.3 ms)
// lines drawn; frames past the scale are pinned to its top and marked. The title carries the record's label,
// renderer, size and its p50 / p95 / p99 / worst, so a graph is never read without its numbers.
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1]; };
const source = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!source) throw new Error('usage: <record.json> [--view name] [--out file.svg]');
const record = JSON.parse(readFileSync(source, 'utf8'));
const view = flag('view');
// A walk record keeps its views per run (one run per size).
const run = view ? (record.runs ?? [record]).find(r => (r.views ?? []).some(v => v.name === view)) : null;
const frames = view ? run?.views.find(v => v.name === view)?.frames : record.frames;
if (run?.size && !record.viewport) { const [w, h] = String(run.size).split('x').map(Number); record.viewport = { width: w, height: h }; }
if (!frames?.intervals?.length) throw new Error(`no frame intervals in ${source}${view ? ` for view ${view}` : ''}`);
const out = flag('out') ?? source.replace(/\.json$/, `${view ? `-${view}` : ''}-frames.svg`);

const W = 1200, H = 300, PAD = { left: 48, right: 12, top: 44, bottom: 28 }, SCALE = 50;
const t = frames.intervals, plotW = W - PAD.left - PAD.right, plotH = H - PAD.top - PAD.bottom;
const x = i => PAD.left + (i / Math.max(1, t.length - 1)) * plotW;
const y = ms => PAD.top + plotH - (Math.min(ms, SCALE) / SCALE) * plotH;
// One point per pixel column at most, keeping each column's worst frame so no hitch is averaged away.
const columns = new Map();
t.forEach((ms, i) => { const c = Math.round(x(i)); if (!(columns.get(c)?.ms >= ms)) columns.set(c, { ms, i }); });
const points = [...columns.values()].sort((a, b) => a.i - b.i).map(p => `${x(p.i).toFixed(1)},${y(p.ms).toFixed(1)}`).join(' ');
const over = [...columns.values()].filter(p => p.ms > SCALE);
const f = n => Number(n).toFixed(1);
const title = [record.label ?? '', view ?? '', record.viewport ? `${record.viewport.width}×${record.viewport.height}` : '', record.renderer ?? '']
  .filter(Boolean).join(' · ').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const stats = `${frames.frames ?? t.length} frames · p50 ${f(frames.p50)} · p95 ${f(frames.p95)} · p99 ${f(frames.p99)} · worst ${f(frames.worst)} ms · over 16.7 ms: ${frames.over16 ?? t.filter(v => v > 16.7).length}`;
const line = (ms, label, colour) => `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(ms)}" y2="${y(ms)}" stroke="${colour}" stroke-dasharray="4 4"/>`
  + `<text x="${W - PAD.right - 4}" y="${y(ms) - 4}" text-anchor="end" fill="${colour}" font-size="11">${label}</text>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif">
<rect width="${W}" height="${H}" fill="#fbf8f1"/>
<text x="${PAD.left}" y="18" font-size="13" fill="#2b2620">${title}</text>
<text x="${PAD.left}" y="35" font-size="12" fill="#5d564c">${stats}</text>
${[0, 10, 20, 30, 40, 50].map(ms => `<text x="${PAD.left - 6}" y="${y(ms) + 4}" text-anchor="end" font-size="10" fill="#8a8275">${ms}</text>`).join('')}
<line x1="${PAD.left}" x2="${PAD.left}" y1="${PAD.top}" y2="${PAD.top + plotH}" stroke="#c9c1b3"/>
${line(1000 / 60, '16.7 ms (60 fps)', '#b0762a')}${line(1000 / 30, '33.3 ms (30 fps)', '#a8412f')}
<polyline points="${points}" fill="none" stroke="#2f5d7c" stroke-width="1"/>
${over.map(p => `<circle cx="${x(p.i).toFixed(1)}" cy="${y(SCALE)}" r="3" fill="#a8412f"><title>${f(p.ms)} ms</title></circle>`).join('')}
<text x="${PAD.left}" y="${H - 8}" font-size="10" fill="#8a8275">frame order → (one column per pixel, its worst frame)</text>
</svg>
`;
writeFileSync(out, svg);
console.log(`${out} · ${stats}`);
