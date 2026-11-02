/**
 * Dev stills only: the real kingdom page on a stills fixture, staged from the URL so that a plain screenshot tool (the
 * real-GPU `chatdom-pc shot`, which can only open a URL and wait for `__chatdomReady`) and the SwiftShader runner take
 * the same pictures. stills.mjs swaps this in for main.tsx on its own dev server; it is never in the build or a route.
 *
 * Query: still=<name> (see STILLS) · realm=<realm origin>. `window.__chatdomReady` is true only once the named still
 * is staged and settled. `window.__chatdomStills.stage(name)` restages without a reload (the SwiftShader runner).
 */
import { render } from 'solid-js/web';
import { createComponent } from 'solid-js';
import '../../style.css';
import Kingdom from '../../kingdom';
import { connectRealm, type RealmClient } from '../../realm/client';
import type { RealmChatFeed } from '../../realm/adapters/chat';
import { compileFoundedScene } from '@chatdom/world/founded-collision';
import type { KingdomPresenceFrame, PresenceFeed, Vec3 } from '@chatdom/shared';
import type { RealmFoundedManifest } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import { WORLD_FIXTURE_KINGDOM } from '@chatdom/shared/world-fixtures';
import { sharedPlaySettings } from '../../play/settings';
import type { StillSpot } from './fixture';

interface FixtureInfo {
  readonly land: 'town' | 'hamlet';
  readonly manifest: RealmFoundedManifest;
  readonly spots: Readonly<Record<'street' | 'slope' | 'stairs' | 'floor', StillSpot | null>>;
  readonly beside: readonly Vec3[];
  readonly speakers: readonly number[];
}

interface Still {
  readonly spot: 'street' | 'slope' | 'stairs' | 'floor';
  readonly view: 'third' | 'first';
  /** Drawn bodies on the drawn ground (after F07), or at the physics height (before). */
  readonly drawnGround: boolean;
  /** The evidence camera: the spot's close sole camera, a wide view over the street, or the walk's own camera. */
  readonly camera: 'walk' | 'close' | 'wide';
  readonly others: boolean;
  readonly chat: boolean;
}

const walkStill = (view: Still['view']): Still => ({ spot: 'street', view, drawnGround: true, camera: 'walk', others: true, chat: true });
const sole = (spot: Still['spot'], drawnGround: boolean): Still => ({ spot, view: 'third', drawnGround, camera: 'close', others: false, chat: false });
export const STILLS: Readonly<Record<string, Still>> = {
  third: walkStill('third'),
  first: walkStill('first'),
  dusk: { spot: 'street', view: 'third', drawnGround: true, camera: 'wide', others: true, chat: true },
  'slope-before': sole('slope', false), 'slope-after': sole('slope', true),
  'stairs-before': sole('stairs', false), 'stairs-after': sole('stairs', true),
  'floor-before': sole('floor', false), 'floor-after': sole('floor', true),
};

const LINES = ['Evening, everyone!', 'the lanterns are on along our street', 'Who is coming to the campfire?',
  'Rowan, your roof looks amazing', 'just got home 🌿', 'that raid last night was something'];
const NAMES = ['Juniper', 'Moss', 'Hazel', 'Bramble', 'Clover', 'Finch'];

type KingdomTestWindow = Window & {
  __chatdomReady?: boolean;
  __chatdomKingdom?: { stats: { ready: boolean; fieldSettled?: boolean; activeWindows?: number; citizens?: number }; attachWalk(binding: unknown): Promise<void>; detachWalk(): void;
    pose(eye: Vec3 | null, target?: Vec3, fov?: number): void };
  __chatdomWalk?: { ready: boolean; owner: string; self: { x: number; y: number; z: number } | null; person: string; camera: { distance: number } };
  __chatdomStills?: { stage(name: string): Promise<void>; current: string | null; error: string | null; facts: Record<string, unknown> | null };
};
const page = window as KingdomTestWindow;
const query = new URLSearchParams(location.search);
const endpoint = query.get('realm') ?? '';

// The kingdom says it is ready once it has drawn; a still is ready only once it is staged and settled.
let kingdomReady = false, staged = false;
Object.defineProperty(page, '__chatdomReady', { configurable: true, get: () => kingdomReady && staged, set: value => { kingdomReady = !!value; } });

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(test: () => boolean, ms: number, what: string | (() => string)) {
  const end = performance.now() + ms;
  while (!test()) {
    if (performance.now() > end) throw new Error(`Stills: ${typeof what === 'string' ? what : what()} did not happen within ${ms} ms`);
    await sleep(50);
  }
}

const raw = await (await fetch('/__stills/scene')).text();
const info = await (await fetch('/__stills/fixture')).json() as FixtureInfo;
const founded = JSON.parse(raw) as RealmFoundedScene;
const collision = compileFoundedScene(founded);

// Who is here: the hamlet is nine people (three walking, six chatting from home); the town has every home lit.
const epoch = `stills:${info.land}`;
const present = new Set(info.land === 'hamlet' ? info.speakers.slice(0, 6) : founded.plan.homes.map(home => home.slot));
const since = Date.now() - 120_000;
let sequence = 0;
const presenceFrame = (): KingdomPresenceFrame => ({ version: 1, kingdomId: WORLD_FIXTURE_KINGDOM, epoch, sequence: sequence++, asOf: Date.now(),
  origin: 'simulated', streamLive: true, connection: 'fresh',
  windows: founded.plan.homes.map((home, index) => ({ slot: home.slot, present: present.has(home.slot),
    publicName: present.has(home.slot) ? NAMES[index % NAMES.length]! : null, since })) });
const presenceFeed: PresenceFeed = { label: 'SIMULATED', subscribe(receive) {
  receive(presenceFrame());
  const timer = setInterval(() => receive(presenceFrame()), 10_000);
  return () => clearInterval(timer);
} };
const chatListeners = new Set<Parameters<RealmChatFeed['subscribe']>[0]>();
const chatFeed: RealmChatFeed = { subscribe(receive) { chatListeners.add(receive); return () => { chatListeners.delete(receive); }; } };
let chatting = false, chatRound = 0;
const speak = () => {
  if (!chatting) return;
  chatRound++;
  info.speakers.filter(slot => present.has(slot)).forEach((slot, index) => {
    const at = Date.now();
    const cue = { version: 1, id: `stills-${chatRound}-${slot}`, kingdomId: WORLD_FIXTURE_KINGDOM, epoch, origin: 'simulated', slot,
      asOf: at, expiresAt: at + 9_000, parts: [{ kind: 'text', text: LINES[index % LINES.length]! }] };
    for (const receive of chatListeners) receive({ type: 'chat', cue } as never);
  });
};
setInterval(speak, 4_000);

// The person's own settings are restored when the page goes, so a still never changes how they walk.
const settings = sharedPlaySettings(), before = settings.current.view;
addEventListener('pagehide', () => settings.set({ view: before }));

render(() => createComponent(Kingdom, { founded, presenceFeed, chatFeed }), document.getElementById('root')!);
await until(() => kingdomReady && !!page.__chatdomKingdom?.stats.ready, 300_000, 'the kingdom opening');

const ticket = async () => (await fetch(`${endpoint}/reference/session`, { method: 'POST' })).json();
const join = () => connectRealm(endpoint, { kingdomId: info.manifest.kingdomId, resumeScope: crypto.randomUUID(), ticket }, collision);
const self = await join();
const peers: RealmClient[] = [];
for (let i = 0; i < 2; i++) peers.push(await join());
setInterval(() => {
  for (const peer of peers) peer.tick(performance.now(), { moveX: 0, moveZ: 0, buttons: 0, yaw: 0, collisionRevision: collision.revision });
}, 50);
const place = async (client: RealmClient, at: Vec3) => {
  const response = await fetch(`${endpoint}/stills/place?id=${encodeURIComponent(client.selfId)}&x=${at[0]}&y=${at[1]}&z=${at[2]}`);
  if (!response.ok) throw new Error(`Stills: the realm would not place a walker at ${at.join(', ')}`);
};
const far = (index: number): Vec3 => info.beside[info.beside.length - 1 - index] ?? info.spots.street!.feet;

let attachedGround: boolean | null = null;
async function stage(name: string) {
  staged = false;
  const still = STILLS[name];
  if (!still) throw new Error(`Stills: no still named ${name}`);
  const spot = info.spots[still.spot];
  if (!spot) throw new Error(`Stills: the ${info.land} has no ${still.spot} spot`);
  const kingdom = page.__chatdomKingdom!;
  kingdom.pose(null);
  settings.set({ view: still.view });
  await place(self, spot.feet);
  for (const [index, peer] of peers.entries()) await place(peer, still.others ? info.beside[index * 3] ?? far(index) : far(index));
  if (attachedGround !== still.drawnGround) {
    if (attachedGround !== null) kingdom.detachWalk();
    await kingdom.attachWalk({ client: self, collision, manifest: info.manifest, heading: spot.heading, drawnGround: still.drawnGround });
    attachedGround = still.drawnGround;
  }
  await until(() => {
    const walk = page.__chatdomWalk;
    return !!walk?.ready && !!walk.self && Math.hypot(walk.self.x - spot.feet[0], walk.self.z - spot.feet[2]) < .3 && walk.person === still.view;
  }, 60_000, () => `standing at the ${still.spot} (walk: ${JSON.stringify({ ready: page.__chatdomWalk?.ready, owner: page.__chatdomWalk?.owner,
    self: page.__chatdomWalk?.self, person: page.__chatdomWalk?.person })})`);
  // The boom has swung all the way (frames are slow without a GPU, and its ease is capped per frame).
  let last = -1, steady = 0;
  await until(() => {
    const distance = page.__chatdomWalk!.camera.distance;
    steady = Math.abs(distance - last) < .005 ? steady + 1 : 0; last = distance;
    return steady >= 4 && (still.view === 'first' ? distance < .05 : distance > .5);
  }, 120_000, () => `the ${still.view}-person boom settling (distance ${last})`);
  chatting = still.chat;
  if (chatting) speak();
  if (still.camera === 'close') kingdom.pose([...spot.close!.eye], [...spot.close!.target], spot.close!.fov);
  if (still.camera === 'wide') {
    const homes = founded.plan.homes.filter(home => info.speakers.includes(home.slot));
    const target: Vec3 = [homes.reduce((s, h) => s + h.position[0], 0) / homes.length, spot.feet[1] + 2,
      homes.reduce((s, h) => s + h.position[2], 0) / homes.length];
    const away = Math.atan2(spot.feet[0] - target[0], spot.feet[2] - target[2]);
    kingdom.pose([spot.feet[0] + Math.sin(away) * 6, spot.feet[1] + 4.5, spot.feet[2] + Math.cos(away) * 6], target, 50);
  }
  // The boom eases, the drawn ground settles and bubbles rise; then the lighting must have settled too.
  await sleep(3_500);
  await until(() => page.__chatdomKingdom!.stats.fieldSettled !== false, 120_000, 'the lighting settling');
  const stats = page.__chatdomKingdom!.stats;
  page.__chatdomStills!.facts = { activeWindows: stats.activeWindows, citizens: stats.citizens, person: page.__chatdomWalk?.person,
    boom: page.__chatdomWalk?.camera.distance, bubbles: document.querySelectorAll('.is-speech').length };
  page.__chatdomStills!.current = name;
  staged = true;
}

page.__chatdomStills = { stage, current: null, error: null, facts: null };
const first = query.get('still');
if (first) await stage(first).catch(error => { page.__chatdomStills!.error = String(error?.message ?? error); throw error; });
