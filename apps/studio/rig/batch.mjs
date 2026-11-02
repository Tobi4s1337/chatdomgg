// Records studio takes here (DOM only: page plates, moved stills, cards), one job at a time, each under the
// shared capture lock and under `nice`. Never WebGL footage: that renders on the GPU (record.mjs --gpu).
//
//   nice -n 19 node apps/studio/rig/batch.mjs stills|cards|pages|S01,S08,…  [--port 5182]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { record } from './record.mjs';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';

const MEDIA = '/srv/chatdom/media/teaser/takes';
const STILLS = ['S06', 'S07', 'S11', 'S12', 'S15', 'S16', 'S17', 'S18', 'S20', 'S21'];
const PAGES = ['S01', 'S02', 'S03', 'S08', 'S09', 'S10', 'S14'];
const CARDS = ['title', 'close'];

const [what = 'stills'] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const at = process.argv.indexOf('--port');
const port = at > 0 ? Number(process.argv[at + 1]) : 0;
const force = process.argv.includes('--force');
const jobs = [];
const pick = list => what.includes(',') || /^S\d\d$/.test(what) ? what.split(',') : list;
if (what === 'stills' || STILLS.includes(what.split(',')[0])) for (const id of pick(STILLS)) jobs.push({ take: `still-${id}`, url: `/studio/frame.html?shot=${id}`, format: 'jpeg', alpha: false });
if (what === 'cards' || CARDS.includes(what)) for (const id of what === 'cards' ? CARDS : [what]) jobs.push({ take: `card-${id}`, url: `/studio/frame.html?card=${id}`, format: 'png', alpha: true });
if (what === 'pages' || PAGES.includes(what.split(',')[0])) for (const id of pick(PAGES)) jobs.push({ take: `page-${id}`, url: `/studio/?shot=${id}`, format: 'png', alpha: false });

for (const job of jobs) {
  const out = join(MEDIA, job.take);
  if (!force && existsSync(join(out, 'take.json')) && JSON.parse(readFileSync(join(out, 'take.json'), 'utf8')).complete) { console.log(`${job.take}: kept`); continue; }
  const release = await acquireCaptureLock();
  try {
    const take = await record({ ...job, out, port, resume: !force, log: () => {} });
    console.log(`${job.take}: ${take.frames.length} frames, ${take.framesPerMinute} frames/min`);
  } finally { await release(); }
}
