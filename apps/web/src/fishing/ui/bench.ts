import { FISH_SPECIES } from '../../../../../packages/content/src/fish/species';
import { formatLength, formatWeight } from '../../bag/words';
import { itemPortrait } from '../../bag/portrait';
import { mountFishingUiStaged } from './mount';
import { STAMP_SETTLE_MS, tagTimeline } from './logic';
import type { CatchTag, FishingBeat, FishingUi, WorldTag } from './types';

type BenchState = 'all' | 'tag' | 'fight' | 'prompt';
type BenchWindow = Window & { __chatdomReady?: boolean; __chatdomPierUi?: FishingUi; __chatdomPierUiBeats?: { beat: FishingBeat; at: number }[] };

/* A small deterministic sequence so the backdrop is the same in every still. */
function sequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

/** A lake at dusk with a pier running out into it: enough of the world to judge the overlay's contrast and placement. */
function paintDusk(canvas: HTMLCanvasElement): void {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx || width <= 0 || height <= 0) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const horizon = height * 0.54, sunX = width * 0.64;

  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#1b1e3d'); sky.addColorStop(0.42, '#3a3561'); sky.addColorStop(0.78, '#8a5470'); sky.addColorStop(1, '#e09a62');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, width, horizon + 1);
  const glow = ctx.createRadialGradient(sunX, horizon, 0, sunX, horizon, width * 0.42);
  glow.addColorStop(0, '#ffd59acc'); glow.addColorStop(0.25, '#f2a26a66'); glow.addColorStop(1, '#f2a26a00');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, width, horizon + 1);

  const random = sequence(7);
  ctx.fillStyle = '#2b2238';
  ctx.beginPath(); ctx.moveTo(0, horizon);
  for (let x = 0; x <= width + 12; x += 12) ctx.lineTo(x, horizon - 10 - Math.sin(x / width * 5.2) * 14 - random() * 9 - (x < width * 0.3 ? 18 : 0));
  ctx.lineTo(width, horizon); ctx.closePath(); ctx.fill();

  const water = ctx.createLinearGradient(0, horizon, 0, height);
  water.addColorStop(0, '#6b4865'); water.addColorStop(0.3, '#3b3354'); water.addColorStop(1, '#151a2f');
  ctx.fillStyle = water; ctx.fillRect(0, horizon, width, height - horizon);
  for (let i = 0; i < 180; i += 1) {
    const depth = random(), y = horizon + 3 + depth * depth * (height - horizon);
    const spread = 40 + depth * width * 0.22, x = sunX + (random() - 0.5) * spread * 2;
    const length = 8 + random() * (30 + depth * 60);
    ctx.strokeStyle = `rgba(255, ${190 + Math.round(random() * 40)}, ${130 + Math.round(random() * 40)}, ${(0.5 - depth * 0.4) * (0.4 + random() * 0.6)})`;
    ctx.lineWidth = 1 + depth * 1.6;
    ctx.beginPath(); ctx.moveTo(x - length / 2, y); ctx.lineTo(x + length / 2, y); ctx.stroke();
  }

  /* The pier, in silhouette, running out from the near shore. */
  const end = { x: width * 0.42, y: height * 0.63 };
  ctx.fillStyle = '#1f1714';
  ctx.beginPath(); ctx.moveTo(-width * 0.05, height); ctx.lineTo(width * 0.3, height); ctx.lineTo(end.x + width * 0.02, end.y); ctx.lineTo(end.x - width * 0.06, end.y); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#120d0c'; ctx.lineWidth = 3;
  for (let k = 0; k <= 6; k += 1) {
    const t = k / 6, xl = -width * 0.05 + (end.x - width * 0.06 + width * 0.05) * t, xr = width * 0.3 + (end.x + width * 0.02 - width * 0.3) * t, y = height + (end.y - height) * t;
    const post = 26 * (1 - t) + 6;
    ctx.beginPath(); ctx.moveTo(xl, y); ctx.lineTo(xl, y + post); ctx.moveTo(xr, y); ctx.lineTo(xr, y + post); ctx.stroke();
    if (k % 2 === 1) {
      const lx = xr, ly = y - (40 * (1 - t) + 12);
      ctx.beginPath(); ctx.moveTo(lx, y); ctx.lineTo(lx, ly); ctx.stroke();
      const lamp = ctx.createRadialGradient(lx, ly, 0, lx, ly, 46 * (1 - t) + 14);
      lamp.addColorStop(0, '#ffe2a6'); lamp.addColorStop(0.16, '#ffc56f99'); lamp.addColorStop(1, '#ffb05a00');
      ctx.fillStyle = lamp; ctx.fillRect(lx - 70, ly - 70, 140, 140);
      ctx.fillStyle = '#1f1714';
    }
  }
}

function catchTag(portrait: Promise<CanvasImageSource | null>): CatchTag {
  const pike = FISH_SPECIES.find(entry => entry.id === 'fish:moonlit-pike');
  return {
    name: pike?.name ?? 'Moonlit Pike',
    lore: pike?.lore ?? 'The old fishers lower their voices when its pale jaw breaks the water.',
    weight: formatWeight(3870), length: formatLength(912), rarity: pike?.rarity ?? 'rare',
    personalFirst: true, kingdomFirst: true, portrait,
  };
}

/**
 * Dev-only review surface for the pier's overlay: every state at once over a dusky lake, or one state alone with
 * `?state=tag|fight|prompt`. `still=1` skips every animation. It never opens a session or touches a kingdom.
 */
export function mountFishingUiBench(host: HTMLElement, query: URLSearchParams): () => void {
  const W = window as BenchWindow;
  W.__chatdomReady = false;
  W.__chatdomPierUiBeats = [];
  const raw = query.get('state');
  const state: BenchState = raw === 'tag' || raw === 'fight' || raw === 'prompt' ? raw : 'all';
  const still = query.get('still') === '1';
  const compact = query.has('compact') ? query.get('compact') !== '0' : host.clientWidth < 640;
  const started = performance.now();

  const stage = document.createElement('div');
  stage.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#151a2f';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  stage.appendChild(canvas);
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.appendChild(stage);
  paintDusk(canvas);
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => paintDusk(canvas)) : null;
  resize?.observe(stage);

  const ui = mountFishingUiStaged(stage, {
    compact, kingdomName: 'Willowmere',
    onBeat: beat => { W.__chatdomPierUiBeats?.push({ beat, at: Math.round(performance.now() - started) }); },
  }, { hold: true, still });
  W.__chatdomPierUi = ui;

  if (state === 'all' || state === 'prompt') ui.prompt({ label: 'Hold to reel · ease off when it runs', key: compact ? 'Tap' : 'Click' });
  if (state === 'all' || state === 'fight') ui.fight({ tension: 0.7, progress: 0.42, phase: 'run', tired: false });
  if (state === 'all') ui.note('The kingdom is keeping your catch.');
  // The tag's print is the real voxel fish, drawn as the kingdom draws it, at the size the walking HUD asks for.
  const portrait = state === 'all' || state === 'tag' ? itemPortrait('fish:moonlit-pike', 288).catch(() => null) : Promise.resolve(null);
  if (state === 'all' || state === 'tag') ui.caught(catchTag(portrait));

  const tags: WorldTag[] = [
    { id: 'bench-saoirse', x: 0, y: 0, text: 'saoirse_k caught a Bell Minnow', first: false, visible: true },
    { id: 'bench-juniper', x: 0, y: 0, text: 'Juniper caught a Lantern Eel', first: true, visible: true },
  ];
  let frame = 0;
  const tick = (): void => {
    if (state === 'all') {
      const w = stage.clientWidth, h = stage.clientHeight;
      tags[0] = { ...tags[0]!, x: w * (compact ? 0.3 : 0.27), y: h * (compact ? 0.62 : 0.7) };
      tags[1] = { ...tags[1]!, x: w * (compact ? 0.58 : 0.42), y: h * (compact ? 0.5 : 0.58) };
      ui.worldTags(tags);
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const timeline = tagTimeline(true, true, reduced);
  const settleMs = still ? 0 : state === 'all' || state === 'tag' ? (timeline.stamps[timeline.stamps.length - 1]?.impact ?? timeline.slideIn) + STAMP_SETTLE_MS + 120 : 320;
  let readyTimer = 0, alive = true;
  const fonts = document.fonts?.ready ?? Promise.resolve();
  requestAnimationFrame(() => {
    void Promise.all([fonts, portrait]).then(() => {
      if (!alive) return;
      const wait = Math.max(0, settleMs - (performance.now() - started));
      readyTimer = window.setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => { if (alive) W.__chatdomReady = true; })), wait);
    });
  });

  return () => {
    alive = false;
    cancelAnimationFrame(frame);
    window.clearTimeout(readyTimer);
    resize?.disconnect();
    ui.dispose();
    stage.remove();
    if (W.__chatdomPierUi === ui) delete W.__chatdomPierUi;
  };
}
