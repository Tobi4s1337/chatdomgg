import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const source = '/tmp/chatdom-soul-audio';
const target = 'work/evidence/soul';
const stills = [
  ['dawn@1440x900.png', '06:00 · Bread round and chimney smoke'],
  ['noon@1440x900.png', '12:00 · The working day'],
  ['rain@1440x900.png', '14:00 · Rain on tile and puddles'],
  ['lamplighter@1440x900.png', '18:45 · The lamplighter’s round'],
  ['dusk@1440x900.png', '19:30 · Civic lamps at dusk'],
  ['night@1440x900.png', '23:00 · A clear quiet night'],
  ['snow@1440x900.png', 'Winter · Snow on roofs and peaks'],
  ['phone@390x844.png', 'Phone · 390 × 844'],
  ['stream@1920x1080.png', 'Stream composition · 1920 × 1080'],
];
// Do not publish a gallery assembled from stale drafts or mixed browser builds.
const fingerprint = createHash('sha256').update(await readFile('apps/web/dist/index.html')).digest('hex');
for (const [file] of stills) {
  const name = file.split('@')[0];
  const capture = JSON.parse(await readFile(`${target}/capture-${name}.json`, 'utf8'));
  if (capture.file !== file || capture.buildFingerprint !== fingerprint || !capture.frame || capture.overflow) {
    throw new Error(`Missing or stale still: ${file}`);
  }
  await readFile(`${target}/${file}`);
}
await mkdir(`${target}/audio`, { recursive: true });
const measurements = JSON.parse(await readFile(`${source}/measurements.json`, 'utf8'));
for (const row of measurements) {
  const result = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', `${source}/${row.name}.wav`, '-c:a', 'libopus', '-b:a', '64k', `${target}/audio/${row.name}.ogg`], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}
for (const name of ['measurements.json', 'lifecycle.json', 'stall.json', 'duck.json', 'loudness.json']) {
  await copyFile(`${source}/${name}`, `${target}/audio/${name === 'loudness.json' ? 'analysis.json' : name}`);
}
const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
await writeFile(`${target}/index.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Chatdom · A kingdom’s day</title><style>body{margin:40px auto;max-width:1100px;padding:0 20px;background:#222c35;color:#f1e3ca;font:17px/1.55 Georgia,serif}h1,h2{font-weight:400}small{color:#c7b38d}figure{margin:30px 0}img{width:100%;height:auto}figcaption{padding:8px 0}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px;border-bottom:1px solid #746348}audio{width:min(330px,100%)}a{color:#ecc58d}</style><h1>A kingdom’s day</h1><p><strong>SIMULATED review.</strong> Authored Hearth homes, civic keepers and an absolute kingdom clock. Citizen windows remain unlit when their people are absent. Weather overrides in the rain and snow stills are deliberate review controls.</p><p>These images were opened and judged with the look workflow. Audio uses the same WebAudio graph as the interactive review: four biomes at four hours, with a stream comparison for each. The files and measurements demonstrate rendered signal and lifecycle; subjective listening on speakers remains unverified.</p><p>The live civic/clock binding and real walk/stream demonstration remain pending. Stars are not visible in this overhead framing; rain, night colour and the very quiet mixes still need the reviews recorded below.</p><p><a href="visual-review.md">Visual findings and limits</a> · <a href="../../lanes/soul/needs-main.md">Main-owned integration needs</a> · <a href="../../lanes/soul/decisions.md">Decisions and verification boundaries</a> · <a href="audio/measurements.json">Signal and source budgets</a> · <a href="audio/analysis.json">LUFS and peak measurements</a></p><h2>Dawn to night</h2>${stills.map(([file, label]) => `<figure><a href="${file}"><img loading="lazy" src="${file}" alt="${escape(label)}"></a><figcaption>${escape(label)}</figcaption></figure>`).join('')}<h2>A short listen</h2><p>Play all clips at the same volume. Stream clips should sit quietly under speech; no volume normalization has been applied.</p><table><thead><tr><th>Biome · hour · profile</th><th>Listen</th><th>Peak dBFS</th></tr></thead><tbody>${measurements.map(row => `<tr><td>${escape(row.name)}</td><td><audio controls preload="none" src="audio/${escape(row.name)}.ogg"></audio></td><td>${(20 * Math.log10(row.peak)).toFixed(1)}</td></tr>`).join('')}</tbody></table></html>`);
console.log(`Wrote ${measurements.length} short listens and ${target}/index.html`);
