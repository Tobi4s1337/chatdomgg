/**
 * Dev rounds only: the real kingdom entry (`KingdomEntry` with the live entry source) on a founded kingdom in the
 * lane's own realm, for `round.mjs`. It builds this in place of main.tsx into a scratch folder and serves it beside the
 * session routes the entry asks for; it is never a route and never in the product build.
 *
 * Without `shot` it is simply the kingdom walk (the SwiftShader round drives it with real keys). With `shot=<name>` it
 * is one still for a browser that can only open a URL and wait (the real-GPU `chatdom-pc shot`):
 * `window.__chatdomReady` turns true only once this page's walker is seated at the fire, the operator has moved the
 * round to the moment named for that still (`/__round/go`), and the view has settled. Views:
 * - `seated`: your own seated walk, with the fire's carved HUD, as a person at the fire sees it;
 * - `wide`: the clearing from outside the ring, the interface hidden (the place, not the HUD);
 * - `stream`: the same kind of framing at stream size with the fire's stream plate (`StreamOverlay`, public frame
 *   only) and nothing of the walk's interface.
 *
 * The kingdom's source ribbon is hidden in every still: the lane's in-memory realm writes no presence outbox, so it
 * would always read "Connection lost" for a reason that is the operator's, not the fire's.
 */
import { render } from 'solid-js/web';
import { createComponent } from 'solid-js';
import '../style.css';
import KingdomEntry from '../kingdom-entry';
import { createLiveKingdomEntrySource } from '../kingdom-entry/live';
import type { KingdomId, Vec3 } from '@chatdom/shared';
import { createCampfireSession, type CampfireRoomPort } from './session';
import { StreamOverlay } from './StreamOverlay';
import './campfire.css';

interface DoorInfo { readonly kingdomId: KingdomId; readonly kingdomName: string; readonly endpoint: string; readonly notice: string }
interface RoundShot { readonly view: 'seated' | 'wide' | 'stream'; readonly eye?: Vec3; readonly target?: Vec3; readonly fov?: number }
interface RoundReport { shot: string | null; stage: string; error: string | null }
type RoundWindow = Window & {
  __chatdomReady?: boolean;
  __chatdomWalk?: { ready?: boolean; owner?: string };
  __chatdomKingdom?: { pose(eye: Vec3 | null, target?: Vec3, fov?: number): void; interactionDebug?(): { self?: { mode?: string } | null } | null };
  __gatherRound?: RoundReport;
};
interface PlaySlots { registerWalkFeature(provider: { readonly id: string; mount(walk: { readonly room: CampfireRoomPort }): () => void }): () => void }

const page = window as RoundWindow;
const params = new URLSearchParams(location.search);
const name = params.get('shot');
const report: RoundReport = page.__gatherRound = { shot: name, stage: 'opening', error: null };
addEventListener('error', event => { report.error ??= String(event.message); });
addEventListener('unhandledrejection', event => { report.error ??= String(event.reason?.message ?? event.reason); });

let kingdomReady = false, posed = !name;
Object.defineProperty(page, '__chatdomReady', { configurable: true, get: () => kingdomReady && posed, set: value => { kingdomReady = !!value; } });

const [info, shots] = await Promise.all([
  fetch('/__door/info', { cache: 'no-store' }).then(response => response.json() as Promise<DoorInfo>),
  name ? fetch('/__round/info', { cache: 'no-store' }).then(response => response.json() as Promise<Readonly<Record<string, RoundShot>>>) : Promise.resolve({}),
]);
const shot = name ? (shots as Readonly<Record<string, RoundShot>>)[name] : undefined;
if (name && !shot) throw new Error(`Round still: no shot named ${name}`);

const chrome = document.createElement('style');
chrome.textContent = '.kingdom-seal{display:none!important}' + (shot && shot.view !== 'seated'
  ? '.kingdom-heading,.kingdom-controls,.kingdom-caption,.kingdom-chronicle-button,.stream-signature,.kingdom-entry-notice,.pl-hud,.pl-region,.pl-prompt,.walk-overlook,.campfire-walk-hud{display:none!important}' : '');
document.head.append(chrome);

// The stream plate, on the same kingdom room the walk moves in, opened without a private view.
if (shot?.view === 'stream') {
  const slots = import.meta.glob<Partial<PlaySlots>>('../play/slots.ts', { eager: true })['../play/slots.ts'];
  if (!slots?.registerWalkFeature) throw new Error('Round still: play\'s walk feature slot is not in this build');
  slots.registerWalkFeature({ id: 'campfire-round-stream', mount: walk => {
    const session = createCampfireSession(walk.room, { private: false });
    const host = document.createElement('div');
    host.className = 'campfire-round-stream';
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5';
    document.body.append(host);
    const off = render(() => createComponent(StreamOverlay, { session }), host);
    return () => { off(); host.remove(); session.dispose(); };
  } });
}

const open = createLiveKingdomEntrySource({ kingdomId: info.kingdomId, kingdomName: info.kingdomName, origin: 'simulated',
  notice: info.notice, endpoint: info.endpoint, storage: sessionStorage });
render(() => createComponent(KingdomEntry, { open }), document.getElementById('root')!);

if (name && shot) {
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (test: () => boolean, ms: number, what: string) => {
    const end = performance.now() + ms;
    while (!test()) {
      if (performance.now() > end) throw new Error(`Round still ${name}: ${what} did not happen within ${ms} ms`);
      await sleep(100);
    }
  };
  report.stage = 'walking';
  await until(() => kingdomReady && page.__chatdomWalk?.ready === true && page.__chatdomWalk.owner === 'walking', 240_000, 'the walk opening');
  report.stage = 'seating';
  await until(() => { const mode = page.__chatdomKingdom?.interactionDebug?.()?.self?.mode; return !!mode && mode !== 'standing'; }, 120_000, 'sitting at the fire');
  if (shot.view === 'seated') await until(() => !!document.querySelector('[data-campfire-hud]'), 60_000, 'the fire\'s HUD');
  report.stage = 'waiting';
  // Tell the operator this page sits at the fire, and wait for it to bring the round to this still's moment.
  for (;;) {
    const answer = await fetch(`/__round/go?shot=${encodeURIComponent(name)}`, { cache: 'no-store' }).then(response => response.json() as Promise<{ go: boolean }>).catch(() => ({ go: false }));
    if (answer.go) break;
    await sleep(250);
  }
  if (shot.eye && shot.target) page.__chatdomKingdom?.pose([...shot.eye], [...shot.target], shot.fov ?? 43);
  report.stage = 'settling';
  // The reveal and the lanterns ease; the light field follows a new view.
  await sleep(shot.view === 'seated' ? 2_500 : 4_000);
  report.stage = 'ready';
  posed = true;
}
