import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const dir = '/tmp/chatdom-soul-audio';
const files = JSON.parse(await readFile(`${dir}/measurements.json`, 'utf8')).map(row => `${row.name}.wav`);
const report = [];
for (const name of files) {
  const input = `${dir}/${name}`;
  const result = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', input, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  const summary = result.stderr.slice(result.stderr.lastIndexOf('Summary:'));
  const integrated = summary.match(/I:\s*(-?[\d.]+) LUFS/), peak = summary.match(/Peak:\s*(-?[\d.]+) dBFS/);
  report.push({ name, integratedLUFS: integrated ? Number(integrated[1]) : null, truePeakDbfs: peak ? Number(peak[1]) : null });
  const image = `${dir}/${name.replace('.wav', '-spectrogram.png')}`;
  const spectral = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', input, '-lavfi', 'showspectrumpic=s=1200x512:legend=1:scale=log', '-frames:v', '1', image], { encoding: 'utf8' });
  if (spectral.status !== 0) throw new Error(spectral.stderr);
}
await writeFile(`${dir}/loudness.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
