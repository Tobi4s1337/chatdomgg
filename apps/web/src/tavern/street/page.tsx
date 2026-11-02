/**
 * Dev stills only: the real kingdom page on a founded kingdom, with the evidence camera at the tavern's street door.
 * `games/street-still.mjs` builds this in place of main.tsx into a scratch folder and serves it with the scene and the
 * camera from memory; it is never a route and never in the product build.
 *
 * Query: shot=<name>. `window.__chatdomReady` turns true only once that framing is posed and the light has settled,
 * so the real-GPU `chatdom-pc shot` (which can only open a URL and wait) takes the same picture every time.
 *
 * Nobody walks here: no walker and no simulated crowd. The homes are lit as on a full evening, without names, so
 * the street reads as lived in; the page's chrome is hidden because the still is of the place, not the interface.
 */
import { render } from 'solid-js/web';
import { createComponent } from 'solid-js';
import '../../style.css';
import Kingdom from '../../kingdom';
import type { KingdomPresenceFrame, PresenceFeed, Vec3 } from '@chatdom/shared';
import type { RealmFoundedScene } from '@chatdom/world';

interface StreetShot { readonly eye: Vec3; readonly target: Vec3; readonly fov: number; readonly hour: number }
interface StreetInfo { readonly kingdomName: string; readonly shots: Readonly<Record<string, StreetShot>> }

type StreetWindow = Window & {
  __chatdomReady?: boolean;
  __chatdomKingdom?: { stats: { ready: boolean; fieldSettled?: boolean }; pose(eye: Vec3 | null, target?: Vec3, fov?: number): void; hour(value: number): void };
  __chatdomStreet?: { error: string | null; shot: string | null };
};
const page = window as StreetWindow;
page.__chatdomStreet = { error: null, shot: null };
addEventListener('unhandledrejection', event => { page.__chatdomStreet!.error ??= String(event.reason?.message ?? event.reason); });

let kingdomReady = false, posed = false;
Object.defineProperty(page, '__chatdomReady', { configurable: true, get: () => kingdomReady && posed, set: value => { kingdomReady = !!value; } });

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(test: () => boolean, ms: number, what: string) {
  const end = performance.now() + ms;
  while (!test()) {
    if (performance.now() > end) throw new Error(`Street still: ${what} did not happen within ${ms} ms`);
    await sleep(50);
  }
}

const name = new URLSearchParams(location.search).get('shot') ?? 'street';
const [founded, info] = await Promise.all([
  fetch('/__street/scene').then(response => response.json() as Promise<RealmFoundedScene>),
  fetch('/__street/info').then(response => response.json() as Promise<StreetInfo>),
]);
const shot = info.shots[name];
if (!shot) throw new Error(`Street still: no shot named ${name}`);

// A full evening: every home lit, no names, the stream offline (the kingdom keeps its own evening).
const since = Date.now() - 600_000;
let sequence = 0;
const frame = (): KingdomPresenceFrame => ({ version: 1, kingdomId: founded.kingdomId, epoch: 'street-still', sequence: sequence++, asOf: Date.now(),
  origin: 'simulated', streamLive: false, connection: 'offline',
  windows: founded.plan.homes.map(home => ({ slot: home.slot, present: true, publicName: null, since })) });
const presenceFeed: PresenceFeed = { label: 'SIMULATED', subscribe(receive) { receive(frame()); return () => {}; } };

const chrome = document.createElement('style');
chrome.textContent = '.kingdom-heading,.kingdom-seal,.kingdom-controls,.kingdom-caption,.kingdom-chronicle-button,.stream-signature,.window-names,.kingdom-vignette{display:none!important}';
document.head.append(chrome);

render(() => createComponent(Kingdom, { founded, presenceFeed, kingdomName: info.kingdomName }), document.getElementById('root')!);
await until(() => kingdomReady && !!page.__chatdomKingdom?.stats.ready, 240_000, 'the kingdom opening');
const kingdom = page.__chatdomKingdom!;
kingdom.hour(shot.hour);
kingdom.pose([...shot.eye], [...shot.target], shot.fov);
// The hour eases toward its target and the light field follows the new view.
await sleep(6_000);
await until(() => kingdom.stats.fieldSettled !== false, 120_000, 'the light settling');
await sleep(1_500);
page.__chatdomStreet!.shot = name;
posed = true;
