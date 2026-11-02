// Full-frame studio frames, drawn as pure functions of t and recorded like page shots:
//   /studio/frame.html?shot=S06      a kingdom shot's real still, moved (stand-ins until the moment is staged)
//   /studio/frame.html?card=title    a title card on a transparent ground (record with --alpha)
// Moves are CSS transforms at subpixel precision, so slow pushes don't stair-step like integer crops.
import '../../../../packages/ui/src/kit.css';
import './frame.css';
import { CARDS } from './cards';
import { findShot } from '../shots';


const query = new URLSearchParams(location.search);
const root = document.getElementById('frame')!;
const smooth = (x: number) => { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u); };
/** Ken Burns moves read best nearly linear, with only a soft start and end. */
const glide = (x: number) => 0.75 * Math.max(0, Math.min(1, x)) + 0.25 * smooth(x);

async function still(id: string) {
  const shot = findShot(id);
  const k = shot.kingdom;
  if (!k || k.kind !== 'still') throw new Error(`${id} has no still`);
  root.className = 'frame-still';
  const img = document.createElement('img');
  img.src = '/' + k.src.replace(/^work\//, '');
  await img.decode();
  const [cx, cy, cw, ch] = k.crop ?? [0, 0, img.naturalWidth, img.naturalHeight];
  root.append(img);
  return {
    duration: shot.duration,
    draw(t: number) {
      const u = glide(t / shot.duration);
      const s = k.from.scale + (k.to.scale - k.from.scale) * u;
      // The crop is the contract: the drift is clamped so the frame never shows anything outside it (cards,
      // captions and chips sit just beyond several crops).
      const room = Math.max(0, (s - 1) / 2), clamp = (v: number) => Math.max(-room, Math.min(room, v));
      const x = clamp(k.from.x + (k.to.x - k.from.x) * u), y = clamp(k.from.y + (k.to.y - k.from.y) * u);
      // Fit the crop to 1920×1080 (cover), then scale about the centre and drift by fractions of the frame.
      const fit = Math.max(1920 / cw, 1080 / ch) * s;
      const left = 960 - (cx + cw / 2) * fit + x * 1920, top = 540 - (cy + ch / 2) * fit + y * 1080;
      img.style.transform = `translate(${left.toFixed(3)}px, ${top.toFixed(3)}px) scale(${fit.toFixed(5)})`;
      // The Atlas stand-in must never show a legible channel name: soften it.
      img.style.filter = id === 'S21' ? 'blur(2.2px) saturate(0.95)' : '';
    },
  };
}

async function card(id: string) {
  const c = CARDS[id];
  if (!c) throw new Error(`No card ${id}`);
  root.className = 'frame-card';
  const scrim = document.createElement('div');
  scrim.className = 'card-scrim';
  const block = document.createElement('div');
  block.className = 'card-block';
  for (const line of c.lines) {
    const el = document.createElement('div');
    el.className = `card-${line.role}`;
    el.textContent = line.text;
    block.append(el);
  }
  root.append(scrim, block);
  await document.fonts.load('400 120px "IM Fell English SC"');
  await document.fonts.load('italic 400 64px "IM Fell English"');
  await document.fonts.load('500 30px Alegreya');
  return {
    duration: c.duration,
    draw(t: number) {
      const enter = smooth((t - c.in) / c.fade), leave = 1 - smooth((t - (c.out - c.fade)) / c.fade);
      const a = Math.min(enter, leave);
      scrim.style.opacity = (a * c.scrim).toFixed(4);
      block.style.opacity = a.toFixed(4);
      // A slow rise and a breath of letter-spacing, like ink settling.
      block.style.transform = `translateY(${((1 - enter) * 14).toFixed(3)}px)`;
      block.style.letterSpacing = `${(0.02 + (1 - enter) * 0.04).toFixed(4)}em`;
    },
  };
}

const view = query.has('card') ? await card(query.get('card')!) : await still(query.get('shot') ?? 'S06');
await document.fonts.ready;
view.draw(Number(query.get('t') ?? 0));
window.__studio = { shot: query.get('card') ?? query.get('shot') ?? '', duration: view.duration, actions: [], ready: true,
  frame: async t => { view.draw(t); } };
window.__chatdomReady = true;
