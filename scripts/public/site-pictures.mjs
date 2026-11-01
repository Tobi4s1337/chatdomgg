// The story page's pictures: real engine captures, cropped to their slot and encoded as WebP at the widths the page
// asks for. Run it again after a re-shoot; it overwrites apps/web/src/site/img/ and prints each file's size.
//
//   node scripts/public/site-pictures.mjs [--only <id>]
//
// Sources are the hero and Atlas frames shot on a real GPU (work/evidence/front-door/fd10/gpu/), the kingdom stills
// in /srv/chatdom-stills/site/img/ and other lanes' evidence. Crops cut away the old stream-view chrome (corner
// marks, the kingdom plaque, the frame) so a picture shows only the kingdom itself.
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const out = join(root, 'apps/web/src/site/img');
const gpu = join(root, 'work/evidence/front-door/fd10/gpu');
const stills = '/srv/chatdom-stills/site/img';
const evidence = join(root, 'work/evidence');

const FULL = [1920, 1440, 960], FRAMED = [1280, 800], PANEL = [640, 400];
/** id: source, crop [x, y, w, h] in source pixels, output widths, WebP quality. */
const PICTURES = [
  { id: 'hero-a', src: `${gpu}/y120.webp`, crop: [0, 72, 1920, 1008], widths: FULL, quality: 72 },
  { id: 'hero-b', src: `${gpu}/y90.webp`, crop: [0, 72, 1920, 1008], widths: FULL, quality: 72 },
  { id: 'hero-c', src: `${gpu}/y150.webp`, crop: [0, 72, 1920, 1008], widths: FULL, quality: 72 },
  { id: 'hero-phone', src: `${gpu}/portrait-a.webp`, crop: [0, 140, 780, 1548], widths: [780, 520], quality: 74 },
  { id: 'streets', src: `${stills}/1935-windows-haze.png`, crop: [12, 60, 1896, 940], widths: FULL, quality: 74 },
  { id: 'forge-a', src: `${stills}/0845-forge-crucible-pair.png`, crop: [8, 24, 944, 456], widths: [944, 640], quality: 80 },
  { id: 'forge-b', src: `${stills}/0845-forge-crucible-pair.png`, crop: [968, 24, 944, 456], widths: [944, 640], quality: 80 },
  { id: 'growth-a', src: `${evidence}/growth/before-wide@1920x1080.png`, crop: [0, 60, 1600, 820], widths: FRAMED, quality: 78 },
  { id: 'growth-b', src: `${evidence}/growth/after-wide@1920x1080.png`, crop: [0, 60, 1600, 820], widths: FRAMED, quality: 78 },
  { id: 'cheer', src: `${evidence}/live-twitch/cheer@1920x1080.png`, crop: [12, 60, 1896, 940], widths: FRAMED, quality: 76 },
  { id: 'hype', src: `${evidence}/live-twitch/hype@1920x1080.png`, crop: [12, 60, 1896, 940], widths: FRAMED, quality: 76 },
  { id: 'raid', src: `${evidence}/live-twitch/raid@1920x1080.png`, crop: [12, 60, 1896, 940], widths: FRAMED, quality: 76 },
  { id: 'atlas', src: `${gpu}/map-big.webp`, crop: [560, 80, 1560, 960], widths: [1560, 1040], quality: 78 },
  { id: 'hiw-read', src: `${gpu}/map-big.webp`, crop: [1290, 470, 640, 400], widths: PANEL, quality: 80 },
  { id: 'hiw-continents', src: `${gpu}/map-big.webp`, crop: [870, 840, 600, 375], widths: PANEL, quality: 80 },
  { id: 'hiw-glow', src: `${stills}/1935-windows-haze.png`, crop: [1130, 620, 720, 450], widths: PANEL, quality: 80 },
  { id: 'hiw-door', src: `${evidence}/live-twitch/homes@1920x1080.png`, crop: [360, 620, 720, 450], widths: PANEL, quality: 80 },
];

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
mkdirSync(out, { recursive: true });
let total = 0;
for (const picture of PICTURES) {
  if (only && picture.id !== only) continue;
  const [x, y, w, h] = picture.crop;
  for (const width of picture.widths) {
    const file = join(out, `${picture.id}-${width}.webp`);
    execFileSync('nice', ['-n', '10', 'ffmpeg', '-loglevel', 'error', '-y', '-i', picture.src,
      '-vf', `crop=${w}:${h}:${x}:${y},scale=${width}:-2:flags=lanczos`,
      '-c:v', 'libwebp', '-quality', String(picture.quality), '-compression_level', '6', '-preset', 'picture', file]);
    const size = statSync(file).size;
    total += size;
    console.log(`${picture.id}-${width}.webp  ${(size / 1024).toFixed(0)} KB`);
  }
}
console.log(`total ${(total / 1024).toFixed(0)} KB`);
