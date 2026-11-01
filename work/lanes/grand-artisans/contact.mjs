/** Labelled, bounded review sheets from published capture manifests; never reads pending PNGs. */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const directory = process.env.ARTISAN_OUTPUT ?? 'shots/grand-artisans/fixed-713a05b';
const output = process.env.ARTISAN_CONTACT_OUTPUT ?? 'work/evidence/grand-artisans/fixed-713a05b';
await mkdir(output, { recursive: true });
const records = [];
for (const name of await readdir(directory)) if (name.endsWith('.png.json')) {
  const record = JSON.parse(await readFile(resolve(directory, name), 'utf8'));
  const task = JSON.parse(record.key);
  records.push({ ...record, task });
}
records.sort((a,b) => a.capturedAt.localeCompare(b.capturedAt));
const sheets = [];
for (let start = 0; start < records.length; start += 8) {
  const group = records.slice(start, start + 8);
  const number = String(start / 8 + 1).padStart(2, '0');
  const path = `${output}/contact-${number}.png`;
  const filters = group.map(({task},i) => {
    const label = [task.kit, task.crop ?? '', ['tree','forest'].includes(task.kit) ? task.species : '', task.view, task.size].filter(Boolean).join(' ');
    return `[${i}:v]scale=480:394:force_original_aspect_ratio=decrease,pad=480:440:(ow-iw)/2:0:color=0x242331,setsar=1,drawtext=text='${label.replace(/[^a-zA-Z0-9_ x-]/g,'')}':x=12:y=411:fontsize=17:fontcolor=white[t${i}]`;
  });
  const layout = group.map((_,i) => `${i % 4 * 480}_${Math.floor(i / 4) * 440}`).join('|');
  filters.push(group.map((_,i)=>`[t${i}]`).join('') + (group.length === 1 ? 'null[out]' : `xstack=inputs=${group.length}:layout=${layout}:fill=0x242331[out]`));
  const args = ['-y','-loglevel','error','-filter_complex_threads','1', ...group.flatMap(record=>['-i',resolve(record.path)]), '-filter_complex',filters.join(';'),'-map','[out]','-frames:v','1','-threads','1',path];
  const result = spawnSync('ffmpeg',args,{encoding:'utf8'});
  if (result.status !== 0) throw new Error(result.stderr);
  sheets.push({path,complete:group.length===8,images:group.map(({path,imageHash,key,sourceHash})=>({path,imageHash,key,sourceHash}))});
}
await writeFile(`${output}/index.json`,JSON.stringify(sheets,null,2)+'\n');
console.log(JSON.stringify({images:records.length,sheets:sheets.map(({path,complete})=>({path,complete}))}));
