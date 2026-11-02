/**
 * Dev stills only: the real kingdom page on a stills fixture, staged from the URL so that a plain screenshot tool (the
 * real-GPU `chatdom-pc shot`, which can only open a URL and wait for `__chatdomReady`) and the SwiftShader runner take
 * the same pictures. stills.mjs swaps this in for main.tsx on its own dev server; it is never in the build or a route.
 *
 * Query: still=<name> (see STILLS) · realm=<realm origin>. `window.__chatdomReady` is true only once the named still
 * is staged and settled. `window.__chatdomStills.stage(name)` restages without a reload (the SwiftShader runner).
 */
import { subscribeSpeech } from '../labels/bus';
import { render } from 'solid-js/web';
import { createComponent } from 'solid-js';
import '../../style.css';
import Kingdom from '../../kingdom';
import { connectRealm, type RealmClient } from '../../realm/client';
import type { RealmChatFeed } from '../../realm/adapters/chat';
import { compileFoundedScene, foundedGroundAt } from '@chatdom/world/founded-collision';
import type { KingdomPresenceFrame, PresenceFeed, Vec3 } from '@chatdom/shared';
import type { RealmFoundedManifest } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from '@chatdom/world';
import { WORLD_FIXTURE_KINGDOM } from '@chatdom/shared/world-fixtures';
import { sharedPlaySettings } from '../../play/settings';
import type { StillSpot } from './fixture';
import { routeHome, streetGraph, trailStops, type HomeRoute } from '../../play/map/route';
import { activeWayHome } from '../../play/way-home-runtime';

interface FixtureInfo {
  readonly land: 'town' | 'hamlet' | 'grand';
  readonly manifest: RealmFoundedManifest;
  readonly spots: Readonly<Record<'street' | 'slope' | 'stairs' | 'floor', StillSpot | null>>;
  readonly beside: readonly Vec3[];
  readonly speakers: readonly number[];
  /** Open standing spots the runner holds for the crowd still. */
  readonly crowd: number;
}

interface Still {
  readonly spot: 'street' | 'slope' | 'stairs' | 'floor';
  readonly view: 'third' | 'first';
  /** Drawn bodies on the drawn ground (after F07), or at the physics height (before). */
  readonly drawnGround: boolean;
  /** The evidence camera: the spot's close sole camera, a wide view over the street, a high one over a crowd, or the walk's own camera. */
  readonly camera: 'walk' | 'close' | 'wide' | 'high' | 'trail';
  readonly others: boolean;
  /** 'near': the six homes nearest the street speak every four seconds; 'town': every lit home, at a big channel's rate. */
  readonly chat: false | 'near' | 'town';
  /** More walkers the runner joins and stands in the streets around (the crowd still). */
  readonly crowd?: number;
  /** The lantern path home (PL12): where along a long route home the walker stands, and the trail is lit from there. */
  readonly lantern?: 'start' | 'middle' | 'door';
}

const walkStill = (view: Still['view']): Still => ({ spot: 'street', view, drawnGround: true, camera: 'walk', others: true, chat: 'near' });
const sole = (spot: Still['spot'], drawnGround: boolean): Still => ({ spot, view: 'third', drawnGround, camera: 'close', others: false, chat: false });
export const STILLS: Readonly<Record<string, Still>> = {
  third: walkStill('third'),
  first: walkStill('first'),
  dusk: { spot: 'street', view: 'third', drawnGround: true, camera: 'wide', others: true, chat: 'near' },
  // The 5,000-chatter town: the largest town the founding makes (Willowmere, 240 homes) with every home lit and speaking
  // at the rate a 5,000-viewer chat runs at, and 120 more people walking, so past the nearest 64 they are simple figures.
  crowd: { spot: 'street', view: 'third', drawnGround: true, camera: 'high', others: true, chat: 'town', crowd: 120 },
  'slope-before': sole('slope', false), 'slope-after': sole('slope', true),
  'stairs-before': sole('stairs', false), 'stairs-after': sole('stairs', true),
  'floor-before': sole('floor', false), 'floor-after': sole('floor', true),
  // The lantern path home at dusk, from three points of one route: its start, halfway, and the last stretch to the door.
  'lantern-start': { spot: 'street', view: 'third', drawnGround: true, camera: 'trail', others: false, chat: false, lantern: 'start' },
  'lantern-middle': { spot: 'street', view: 'third', drawnGround: true, camera: 'trail', others: false, chat: false, lantern: 'middle' },
  'lantern-door': { spot: 'street', view: 'third', drawnGround: true, camera: 'trail', others: false, chat: false, lantern: 'door' },
};

/** Lines a second from a chat of about 5,000 people (a busy evening, not a hype train). */
const TOWN_LINES_PER_SECOND = 15;
const TOWN_LINES = ['gg', 'LETS GO', 'hi chat!', 'who else is walking right now?', 'the market looks so cosy tonight',
  'first time here, this is lovely', 'my house has a blue door now', 'anyone at the forge?', 'that was clean', 'lol',
  'evening from the coast 🌊', 'I can see your lantern from mine', 'brb tea', 'raid soon?', 'the castle at dusk though'];
const LINES = ['Evening, everyone!', 'the lanterns are on along our street', 'Who is coming to the campfire?',
  'Rowan, your roof looks amazing', 'just got home 🌿', 'that raid last night was something'];
// Never the walkers' names (Rowan, Wren, Juniper): someone out walking is not also chatting from home.
const NAMES = ['Sage', 'Moss', 'Hazel', 'Bramble', 'Clover', 'Finch'];

type KingdomTestWindow = Window & {
  __chatdomReady?: boolean;
  __chatdomKingdom?: { stats: { ready: boolean; fieldSettled?: boolean; activeWindows?: number; citizens?: number }; attachWalk(binding: unknown): Promise<void>; detachWalk(): void;
    pose(eye: Vec3 | null, target?: Vec3, fov?: number): void };
  __chatdomWalk?: { ready: boolean; owner: string; walkers: number; self: { x: number; y: number; z: number } | null; person: string; camera: { distance: number } };
  __chatdomStills?: { stage(name: string): Promise<void>; current: string | null; error: string | null; facts: Record<string, unknown> | null };
};
const page = window as KingdomTestWindow;
// Where the page has got to, for the runner's message when a still does not settle in time.
const progress = (step: string) => { (window as Window & { __chatdomStillsProgress?: string }).__chatdomStillsProgress = `${step} (${Math.round(performance.now() / 1000)} s)`; };
progress('loading the scene');
const query = new URLSearchParams(location.search);
const endpoint = query.get('realm') ?? '';

// The kingdom says it is ready once it has drawn; a still is ready only once it is staged and settled.
let kingdomReady = false, staged = false;
Object.defineProperty(page, '__chatdomReady', { configurable: true, get: () => kingdomReady && staged, set: value => { kingdomReady = !!value; } });

// Anything that fails while the page sets up (a refused ticket, a scene that will not load) ends the run at once
// instead of leaving the runner waiting out its timeout under the shared capture lock.
const stagePending = async () => { throw new Error('Stills: the page failed while setting up'); };
addEventListener('unhandledrejection', event => {
  page.__chatdomStills ??= { stage: stagePending, current: null, error: null, facts: null };
  page.__chatdomStills.error ??= String(event.reason?.message ?? event.reason);
});

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
let chatting: Still['chat'] = false, chatRound = 0, heard = 0;
// What the scene publishes for the label layer: the last frame that carried any line (for a failed still's message).
let published = 0, lastLines = '';
let speechCanvas: HTMLCanvasElement | null = null, lastAt = 0;
const ownership = () => { const layer = document.querySelector('.walk-people-labels'), canvas = speechCanvas;
  return JSON.stringify({ layers: document.querySelectorAll('.walk-people-labels').length, canvases: document.querySelectorAll('canvas').length,
    connected: canvas?.isConnected, sameParent: !!layer && canvas?.parentElement === layer.parentElement, visibility: canvas?.style.visibility,
    canvasParent: canvas?.parentElement?.className, layerParent: layer?.parentElement?.className, age: Math.round(performance.now() - lastAt) }); };
subscribeSpeech((canvas, frame) => { speechCanvas = canvas; lastAt = frame.at; published++; if (frame.speech.length) lastLines = JSON.stringify(frame.speech.map(line => ({ slot: line.slot, from: line.from,
  d: line.distance?.toFixed(1), v: line.visibility, x: line.x?.toFixed(0), y: line.y?.toFixed(0) }))); });
const say = (slot: number, text: string) => {
  const at = Date.now();
  const cue = { version: 1, id: `stills-${chatRound}-${slot}-${heard}`, kingdomId: WORLD_FIXTURE_KINGDOM, epoch, origin: 'simulated', slot,
    asOf: at, expiresAt: at + 9_000, parts: [{ kind: 'text', text }] };
  for (const receive of chatListeners) { receive({ type: 'chat', cue } as never); heard++; }
};
// The town's chat: lines arrive at random (a Poisson stream), each from a random lit home.
const homesLit = () => founded.plan.homes.filter(home => present.has(home.slot));
setInterval(() => {
  if (chatting !== 'town') return;
  chatRound++;
  const lit = homesLit();
  let lines = 0;
  for (let p = Math.random(), limit = Math.exp(-TOWN_LINES_PER_SECOND * .25); p > limit; p *= Math.random()) lines++;
  for (let i = 0; i < lines && lit.length; i++) say(lit[Math.floor(Math.random() * lit.length)]!.slot, TOWN_LINES[Math.floor(Math.random() * TOWN_LINES.length)]!);
}, 250);
const speak = () => {
  if (chatting !== 'near') return;
  chatRound++;
  info.speakers.filter(slot => present.has(slot)).forEach((slot, index) => say(slot, LINES[index % LINES.length]!));
};
setInterval(speak, 4_000);

// The person's own settings are restored when the page goes, so a still never changes how they walk.
const settings = sharedPlaySettings(), before = settings.current.view;
addEventListener('pagehide', () => settings.set({ view: before }));

progress('opening the kingdom');
render(() => createComponent(Kingdom, { founded, presenceFeed, chatFeed, kingdomName: info.land === 'hamlet' ? 'Brackenfold' : 'Willowmere' }), document.getElementById('root')!);
await until(() => kingdomReady && !!page.__chatdomKingdom?.stats.ready, 300_000, 'the kingdom opening');

const ticket = async () => (await fetch(`${endpoint}/reference/session`, { method: 'POST' })).json();
const join = () => connectRealm(endpoint, { kingdomId: info.manifest.kingdomId, resumeScope: crypto.randomUUID(), ticket }, collision);
progress('joining the realm');
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

let attachedGround: string | null = null;
// The lantern stills' route: from the street spot to the first home whose way there is a long walk (90 to 170 m).
let lanternRoute: HomeRoute | null = null;
function lanternWay(from: Vec3): HomeRoute {
  if (lanternRoute) return lanternRoute;
  const graph = streetGraph(founded.plan);
  const routes = founded.plan.homes.map(home => routeHome(founded.plan, graph, from, home.id)).filter((route): route is HomeRoute => !!route);
  lanternRoute = routes.find(route => route.length > 90 && route.length < 170) ?? routes.sort((a, b) => b.length - a.length)[0] ?? null;
  if (!lanternRoute) throw new Error('Stills: no street reaches any home');
  return lanternRoute;
}
/** The point `metres` along a route, and the heading along it there. */
function along(route: HomeRoute, metres: number): { feet: Vec3; heading: number } {
  let walked = 0;
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1]!, b = route.points[i]!, span = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (walked + span >= metres || i === route.points.length - 1) {
      const t = span > 0 ? Math.min(1, Math.max(0, (metres - walked) / span)) : 0;
      return { feet: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], heading: Math.atan2(b[0] - a[0], b[2] - a[2]) };
    }
    walked += span;
  }
  return { feet: route.points[0]!, heading: 0 };
}
async function stage(name: string) {
  staged = false;
  const still = STILLS[name];
  if (!still) throw new Error(`Stills: no still named ${name}`);
  const base = info.spots[still.spot];
  if (!base) throw new Error(`Stills: the ${info.land} has no ${still.spot} spot`);
  const route = still.lantern ? lanternWay(base.feet) : null;
  const kingdom = page.__chatdomKingdom!;
  progress(`staging ${name}: placing the walkers`);
  kingdom.pose(null);
  settings.set({ view: still.view });
  let spot: StillSpot = base;
  if (route) {
    // The route's points carry the street's height, not the half-metre physics ground, and a stall may stand on the
    // street: stand on the physics ground under the route, nudged along it until the realm finds the spot clear.
    const wanted = still.lantern === 'start' ? 3 : still.lantern === 'middle' ? route.length * .5 : Math.max(3, route.length - 12);
    let placed: StillSpot | null = null;
    search: for (const nudge of [0, 1.5, -1.5, 3, -3, 5, -5, 8, -8]) {
      const point = along(route, Math.max(0, Math.min(route.length, wanted + nudge)));
      const ground = foundedGroundAt(founded.plan, point.feet[0], point.feet[2])[1];
      for (const y of [ground, point.feet[1], ground + .5, ground + 1]) {
        const feet: Vec3 = [point.feet[0], y, point.feet[2]];
        if (await place(self, feet).then(() => true, () => false)) { placed = { ...base, feet, heading: point.heading }; break search; }
      }
    }
    if (!placed) throw new Error(`Stills: nowhere to stand on the way home near ${Math.round(wanted)} m`);
    spot = placed;
  } else await place(self, spot.feet);
  for (const [index, peer] of peers.entries()) await place(peer, still.others ? info.beside[index * 3] ?? far(index) : far(index));
  const attachKey = `${still.drawnGround}:${route?.plotId ?? ''}`;
  if (attachedGround !== attachKey) {
    if (attachedGround !== null) kingdom.detachWalk();
    await kingdom.attachWalk({ client: self, collision, manifest: info.manifest, heading: spot.heading, drawnGround: still.drawnGround,
      ...(route ? { stillsHome: route.plotId } : {}) });
    attachedGround = attachKey;
  }
  progress(`staging ${name}: waiting to stand at the ${still.spot}`);
  await until(() => {
    const walk = page.__chatdomWalk;
    return !!walk?.ready && !!walk.self && Math.hypot(walk.self.x - spot.feet[0], walk.self.z - spot.feet[2]) < .3 && walk.person === still.view;
  }, 60_000, () => `standing at the ${still.spot} (walk: ${JSON.stringify({ ready: page.__chatdomWalk?.ready, owner: page.__chatdomWalk?.owner,
    self: page.__chatdomWalk?.self, person: page.__chatdomWalk?.person })})`);
  progress(`staging ${name}: the boom settling`);
  // The boom has swung all the way (frames are slow without a GPU, and its ease is capped per frame).
  let last = -1, steady = 0;
  await until(() => {
    const distance = page.__chatdomWalk!.camera.distance;
    steady = Math.abs(distance - last) < .005 ? steady + 1 : 0; last = distance;
    return steady >= 4 && (still.view === 'first' ? distance < .05 : distance > .5);
  }, 120_000, () => `the ${still.view}-person boom settling (distance ${last})`);
  if (still.crowd) {
    progress(`staging ${name}: the crowd arriving`);
    const response = await fetch(`${endpoint}/stills/crowd?n=${still.crowd}`);
    if (!response.ok) throw new Error(`Stills: the crowd did not join (${await response.text()})`);
    const { joined } = await response.json() as { joined: number };
    await until(() => (page.__chatdomWalk?.walkers ?? 0) >= joined + 3, 120_000, () => `the crowd arriving (${page.__chatdomWalk?.walkers} of ${joined + 3})`);
  }
  chatting = still.chat;
  speak();
  if (still.camera === 'close') kingdom.pose([...spot.close!.eye], [...spot.close!.target], spot.close!.fov);
  if (still.camera === 'wide') {
    const homes = founded.plan.homes.filter(home => info.speakers.includes(home.slot));
    const target: Vec3 = [homes.reduce((s, h) => s + h.position[0], 0) / homes.length, spot.feet[1] + 2,
      homes.reduce((s, h) => s + h.position[2], 0) / homes.length];
    const away = Math.atan2(spot.feet[0] - target[0], spot.feet[2] - target[2]);
    // Over the shoulders and no further: the bubbles' reach (28 m at the usual density) is measured from this camera.
    kingdom.pose([spot.feet[0] + Math.sin(away) * 3, spot.feet[1] + 3.5, spot.feet[2] + Math.cos(away) * 3], target, 50);
  }
  if (still.camera === 'high') {
    // Above and behind the walker, looking down the street it faces: the crowd near and far, and the lit homes beyond.
    const fx = Math.sin(spot.heading), fz = Math.cos(spot.heading);
    kingdom.pose([spot.feet[0] - fx * 11, spot.feet[1] + 9, spot.feet[2] - fz * 11], [spot.feet[0] + fx * 14, spot.feet[1] + 1, spot.feet[2] + fz * 14], 55);
  }
  if (still.camera === 'trail' && route) {
    // Lit from where you stand, then seen from over your shoulder down the street toward the lanterns ahead.
    const way = activeWayHome();
    if (!way?.lights.light()) throw new Error('Stills: the way home would not light');
    const stops = trailStops(way.map()?.route ?? route);
    const ahead = stops[Math.min(stops.length - 1, 2)]?.position ?? route.door;
    const fx = Math.sin(spot.heading), fz = Math.cos(spot.heading);
    kingdom.pose([spot.feet[0] - fx * 5.5, spot.feet[1] + 3.1, spot.feet[2] - fz * 5.5], [ahead[0], ahead[1] + 1.2, ahead[2]], 58);
    // Every lantern has kindled (about a tenth of a second each) before the shutter.
    await until(() => (way.trail.debug.litLanterns ?? 0) >= Math.max(1, way.trail.debug.lanterns - 1), 60_000, 'the lanterns kindling');
  }
  // The boom eases, the drawn ground settles and bubbles rise; then the lighting must have settled too.
  progress(`staging ${name}: the lighting settling`);
  await sleep(3_500);
  await until(() => page.__chatdomKingdom!.stats.fieldSettled !== false, 120_000, 'the lighting settling');
  // A chat still waits for a bubble to rise and ease fully in, never shooting in the gap between two lines. Under a
  // loaded software renderer a frame can stall for seconds and the label layer rightly lets the lines go, so the wait
  // is soft: it records what it saw (with why, in the facts) and the still is taken either way.
  progress(`staging ${name}: waiting for a bubble`);
  let bubbleWait: string | null = null;
  if (chatting) await until(() => [...document.querySelectorAll<HTMLElement>('.is-speech')].some(bubble => Number(getComputedStyle(bubble).opacity) > .95),
    30_000, '').catch(() => { bubbleWait = `no bubble within 30 s: heard ${heard}, speech frames ${published}, ownership ${ownership()}, last lines ${lastLines || 'none'}`; });
  const stats = page.__chatdomKingdom!.stats;
  page.__chatdomStills!.facts = { ...(route ? { lantern: { plot: route.plotId, metres: Math.round(route.length), lanterns: activeWayHome()?.trail.debug.lanterns,
    lit: activeWayHome()?.trail.debug.litLanterns, doorGlow: activeWayHome()?.trail.debug.doorGlow } } : {}), activeWindows: stats.activeWindows, citizens: stats.citizens, walkers: page.__chatdomWalk?.walkers, heard, person: page.__chatdomWalk?.person,
    boom: page.__chatdomWalk?.camera.distance, bubbles: document.querySelectorAll('.is-speech').length, ...(bubbleWait ? { bubbleWait } : {}) };
  page.__chatdomStills!.current = name;
  staged = true;
}

page.__chatdomStills = { stage, current: null, error: page.__chatdomStills?.error ?? null, facts: null };
const first = query.get('still');
if (first) await stage(first).catch(error => { page.__chatdomStills!.error = String(error?.message ?? error); throw error; });
