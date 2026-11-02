/**
 * A dev-only bench for "Your card": the real CardPage on the ledger's right leaf, over a still of a dusk street,
 * answered by the card fixture instead of the realm. Served by the web dev server at /src/play/card/bench.html;
 * never linked from a route and never in the build.
 *
 * Query: state=ready|loading|unavailable|anonymous|nopicture · forged=1 (a forged source with three pieces) · reduced=1
 */
import { render } from 'solid-js/web';
import type { KingdomId } from '@chatdom/shared';
import '@chatdom/ui/kit.css';
import '../ledger/ledger.css';
import backdrop from '../../../../../work/evidence/PL03/street-final@1920x1080.png?url';
import { DEFAULT_PLAY_SETTINGS } from '../settings';
import { ScrollLeaf } from '../ledger/controls';
import { cornerCap, doorMark, flourish } from '../ledger/marks';
import { registerForgedSource, type ForgedThing, type PlayContext, type PlaySettings } from '../slots';
import { CardPage } from './CardPage';
import { loadCitizenFacts } from './facts';
import { FIXTURE_KINGDOM, cardFixtureFetcher, type CardFixtureState } from './fixture';

declare global { interface Window { __chatdomReady?: boolean } }

const query = new URLSearchParams(location.search);
const STATES: readonly CardFixtureState[] = ['ready', 'loading', 'unavailable', 'anonymous', 'nopicture'];
const state = (STATES as readonly string[]).includes(query.get('state') ?? '') ? query.get('state') as CardFixtureState : 'ready';
const reduced = query.get('reduced') === '1';
const stage = document.querySelector<HTMLDivElement>('#stage')!;
stage.style.setProperty('--bench-backdrop', `url("${backdrop}")`);

const settings: PlaySettings = { ...DEFAULT_PLAY_SETTINGS, reducedMotion: reduced };
const self = state === 'anonymous' ? null : { personId: '990300401', publicName: 'MarigoldWren', lookToken: 'tide' };
const ctx: PlayContext = {
  kingdomId: FIXTURE_KINGDOM as KingdomId, self, live: false, mode: self ? 'walking' : 'watching',
  settings: { get: key => settings[key], subscribe: () => () => {} },
  requestCursor: () => ({ release() {}, active: true }), closeLedger() {},
  requestInput: () => ({ active: false, onKey: () => () => {}, onPointer: () => () => {}, release() {} }),
  hideSelf: () => ({ release() {} }),
};

/* ---------------------------------------------------------------- Forged pieces, painted as small voxel renders */

type Voxel = readonly [x: number, y: number, z: number, colour: string];
const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16), c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c(n >> 16)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
};

/** Unit cubes in the world's three-quarter view: lit top, warm left, shaded right, a faint dark seam on every edge. */
function paintVoxels(canvas: HTMLCanvasElement, voxels: readonly Voxel[], glow?: string) {
  const g = canvas.getContext('2d');
  if (!g) throw new Error('No 2D context');
  const project = (x: number, y: number, z: number) => [x - z, (x + z) / 2 - y] as const;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y, z] of voxels) for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1], [0, 1, 0], [1, 1, 0], [0, 1, 1], [1, 1, 1]] as const) {
    const [px, py] = project(x + dx, y + dy, z + dz);
    minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
  }
  const size = canvas.width, pad = size * .1, a = Math.min((size - pad * 2) / (maxX - minX), (size - pad * 2) / (maxY - minY));
  const ox = (size - (maxX - minX) * a) / 2 - minX * a, oy = (size - (maxY - minY) * a) / 2 - minY * a + size * .02;
  const P = (x: number, y: number, z: number) => { const [px, py] = project(x, y, z); return [ox + px * a, oy + py * a] as const; };
  g.clearRect(0, 0, size, size);
  if (glow) {
    const [gx, gy] = P(...voxelCentre(voxels));
    const light = g.createRadialGradient(gx, gy, 0, gx, gy, size * .5);
    light.addColorStop(0, `${glow}88`); light.addColorStop(.45, `${glow}26`); light.addColorStop(1, `${glow}00`);
    g.fillStyle = light; g.fillRect(0, 0, size, size);
  }
  // A soft contact shadow under the piece.
  const [sx, sy] = P(voxelCentre(voxels)[0], 0, voxelCentre(voxels)[2]);
  const shadow = g.createRadialGradient(sx, sy + a * .4, 0, sx, sy + a * .4, a * 4);
  shadow.addColorStop(0, '#00000066'); shadow.addColorStop(1, '#00000000');
  g.fillStyle = shadow; g.beginPath(); g.ellipse(sx, sy + a * .4, a * 4.2, a * 2.1, 0, 0, Math.PI * 2); g.fill();
  const face = (points: readonly (readonly [number, number])[], fill: string) => {
    g.beginPath(); points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
    g.fillStyle = fill; g.fill(); g.strokeStyle = '#1d110930'; g.lineWidth = Math.max(.6, a * .05); g.stroke();
  };
  const filled = new Set(voxels.map(([x, y, z]) => `${x},${y},${z}`));
  const has = (x: number, y: number, z: number) => filled.has(`${x},${y},${z}`);
  for (const [x, y, z, colour] of [...voxels].sort((p, q) => p[0] + p[1] + p[2] - (q[0] + q[1] + q[2]) || p[1] - q[1])) {
    if (!has(x, y + 1, z)) face([P(x, y + 1, z), P(x + 1, y + 1, z), P(x + 1, y + 1, z + 1), P(x, y + 1, z + 1)], shade(colour, 1.08));
    if (!has(x, y, z + 1)) face([P(x, y, z + 1), P(x + 1, y, z + 1), P(x + 1, y + 1, z + 1), P(x, y + 1, z + 1)], shade(colour, .8));
    if (!has(x + 1, y, z)) face([P(x + 1, y, z), P(x + 1, y + 1, z), P(x + 1, y + 1, z + 1), P(x + 1, y, z + 1)], shade(colour, .6));
  }
}
function voxelCentre(voxels: readonly Voxel[]): [number, number, number] {
  let x = 0, y = 0, z = 0;
  for (const voxel of voxels) { x += voxel[0]; y += voxel[1]; z += voxel[2]; }
  return [x / voxels.length + .5, y / voxels.length + .5, z / voxels.length + .5];
}

function lantern(): Voxel[] {
  const iron = '#4f4540', brass = '#c99f5b', flame = '#ffc46b', glass = '#f3a54a', out: Voxel[] = [];
  for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) out.push([x, 0, z, iron]);
  for (let y = 1; y <= 4; y++) for (const [x, z] of [[0, 0], [4, 0], [0, 4], [4, 4]] as const) out.push([x, y, z, brass]);
  for (let y = 1; y <= 4; y++) for (let x = 1; x < 4; x++) for (let z = 1; z < 4; z++) out.push([x, y, z, x === 2 && z === 2 && y < 4 ? flame : glass]);
  for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) out.push([x, 5, z, iron]);
  for (let x = 1; x < 4; x++) for (let z = 1; z < 4; z++) out.push([x, 6, z, brass]);
  out.push([2, 7, 2, iron], [2, 8, 2, brass]);
  return out;
}

function kettleHelm(): Voxel[] {
  const copper = '#b8693a', rim = '#8a4a26', brass = '#d9b36a', out: Voxel[] = [];
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) {
    const r = Math.hypot(x, z);
    if (r <= 4.3 && r > 3.2) out.push([x + 4, 0, z + 4, rim]);
    for (let y = 1; y <= 4; y++) if (r <= Math.sqrt(Math.max(0, 3.6 ** 2 - (y - .6) ** 2)) + .25) out.push([x + 4, y, z + 4, y === 2 && (x + z) % 3 === 0 ? brass : copper]);
  }
  out.push([4, 5, 4, brass], [4, 6, 4, brass], [3, 6, 4, brass], [5, 6, 4, brass]);
  return out;
}

const DAY = 86_400_000;
const PIECES: readonly ForgedThing[] = [
  { id: 'forged:lantern', title: 'Lantern of the Long Night', plaque: 'Lit for the night the raid came in from the marsh.', forgedAt: Date.UTC(2026, 10, 1, 21, 4),
    paint: canvas => paintVoxels(canvas, lantern(), '#ffb45a') },
  { id: 'forged:helm', title: 'Kettle Helm', plaque: 'For the tavern’s loudest singer.', forgedAt: Date.UTC(2026, 10, 1, 21, 4) - 9 * DAY,
    paint: canvas => paintVoxels(canvas, kettleHelm()) },
  { id: 'forged:oath', title: 'The Heron Oath', plaque: 'Sworn at the campfire, kept by the lane.', forgedAt: Date.UTC(2026, 9, 3, 20, 30) },
];
if (query.get('forged') === '1') registerForgedSource({ id: 'bench', mine: async () => PIECES });

/* ---------------------------------------------------------------- The leaf */

const fixture = cardFixtureFetcher(state);
const load: typeof loadCitizenFacts = state === 'loading'
  ? (_id, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  : (id, signal) => loadCitizenFacts(id, signal, fixture);

function Bench() {
  return <div class="pl-ledger cd-kit" data-phase="open" data-reduced={reduced ? 'true' : undefined}>
    <div class="pl-scrim" />
    <div class="pl-book">
      <div class="pl-boards" aria-hidden="true">
        <span class="pl-corner" data-corner="tl">{cornerCap()}</span><span class="pl-corner" data-corner="tr">{cornerCap()}</span>
        <span class="pl-corner" data-corner="bl">{cornerCap()}</span><span class="pl-corner" data-corner="br">{cornerCap()}</span>
        <span class="pl-clasp" />
      </div>
      <div class="pl-leaves">
        <div class="pl-leaf pl-leaf-contents">
          <header class="pl-title">
            <p class="pl-eyebrow">{self ? `Kept by ${self.publicName}` : 'Kept for a visitor'}</p>
            <h2 class="pl-name">The Ledger</h2>
            {flourish()}
          </header>
          <nav class="pl-contents" aria-label="Pages of the ledger">
            <div class="pl-tabs" role="tablist" aria-orientation="vertical">
              {['Your card', 'Settings', 'The way home', 'Help'].map((title, i) => <button type="button" role="tab" class="pl-tab" aria-selected={i === 0 ? 'true' : 'false'}>
                <span class="pl-tab-name">{title}</span><span class="pl-tab-leader" aria-hidden="true" />
                <span class="pl-tab-folio" aria-hidden="true">{['i', 'ii', 'iii', 'iv'][i]}</span>
              </button>)}
            </div>
          </nav>
          <div class="pl-way-back">
            <button type="button" class="pl-back">
              <span class="pl-back-mark">{doorMark()}</span>
              <span class="pl-back-words"><span class="pl-back-title">Back to the street</span><span class="pl-back-hint">Click to walk on</span></span>
            </button>
            <p class="pl-escape-hint" aria-hidden="true">Escape closes the ledger</p>
          </div>
        </div>
        <div class="pl-gutter" aria-hidden="true" />
        <section class="pl-leaf pl-leaf-page" role="tabpanel">
          <header class="pl-page-head"><p class="pl-eyebrow">Folio i</p><h2 class="pl-page-title">Your card</h2></header>
          <ScrollLeaf label="Your card" class="pl-page-scroll">
            <div class="pl-page-body" data-page="card">
              <CardPage ctx={ctx} cue={() => {}} reducedMotion={() => reduced} load={load} />
            </div>
          </ScrollLeaf>
          <p class="pl-folio-foot" aria-hidden="true">i</p>
        </section>
      </div>
    </div>
  </div>;
}

render(() => <Bench />, stage);

/** Drawn once the fonts are in, the fixture has answered, the picture has loaded and the entrance has settled. */
void (async () => {
  await document.fonts.ready;
  const settled = state === 'loading' ? '[data-state="loading"]' : `[data-state]:not([data-state="loading"])`;
  const until = async (check: () => boolean) => { for (let i = 0; i < 200 && !check(); i++) await new Promise(r => setTimeout(r, 25)); };
  await until(() => !!document.querySelector(`.pl-card${settled}`));
  if (query.get('forged') === '1' && state !== 'loading') await until(() => !!document.querySelector('.pl-card-shelf'));
  const picture = document.querySelector<HTMLImageElement>('.pl-card-picture');
  if (picture && !picture.complete) await new Promise(resolve => { picture.addEventListener('load', resolve, { once: true }); picture.addEventListener('error', resolve, { once: true }); });
  await new Promise(resolve => setTimeout(resolve, reduced ? 300 : 1100));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  window.__chatdomReady = true;
})();
